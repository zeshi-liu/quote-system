import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {performance} from 'node:perf_hooks';
import type {Actor} from '../auth/auth';
import {stable,type Client} from '../core/store';
import {ensure,missing} from '../core/errors';
import {decimal} from '../core/money';
import type {ParsingJob,RawParseRow,ParsePreview,ParsedCandidate,SpreadsheetFieldMapping} from '../../../../packages/contracts/src/source-files';
import {SourceFileService} from './service';
import {mappingSchema} from './validation';
import {parseInChild,ParseFailure} from './parse-worker';
import {TencentOcrAdapter,type OcrAdapter,type OcrResult} from './ocr';
const rawSchema=z.array(z.object({rowNumber:z.number().int().min(1).max(1001),cells:z.array(z.string().max(2000)).max(64),errors:z.array(z.string().max(300)).max(64)}).strict()).max(1001).refine(rows=>new Set(rows.map(r=>r.rowNumber)).size===rows.length,'解析行号重复');
export class ParserService {
 readonly ocr:OcrAdapter;
 constructor(readonly files:SourceFileService,readonly options:{ocr?:OcrAdapter;timeoutMs?:number;signal?:AbortSignal;spreadsheet?:(bytes:Buffer,name:string,mime:string)=>Promise<RawParseRow[]>}={}){this.ocr=options.ocr||new TencentOcrAdapter();}
 private dto(row:any):ParsingJob{return {id:row.id,fileId:row.file_id,status:row.status,parserType:row.parser_type,attempts:row.attempts,errorCode:row.error_code,errorMessage:row.error_message,retryable:row.retryable,resultUnknown:row.result_unknown,rawRows:row.raw_rows,confidence:row.confidence===null?null:Number(row.confidence),createdAt:new Date(row.created_at).toISOString(),completedAt:row.completed_at?new Date(row.completed_at).toISOString():null,applied:!!row.applied_result};}
 private async authorized(c:Client,actor:Actor,id:string,write=false){z.uuid().parse(id);const j=(await c.query('SELECT * FROM source_parsing_jobs WHERE id=$1',[id])).rows[0];if(!j)throw missing();const f=await this.files.requireReference(c,actor,j.file_id,undefined,write);return {j,f};}
 async create(actor:Actor,key:string,input:unknown){const {fileId}=z.object({fileId:z.uuid()}).strict().parse(input),f=await this.files.get(actor,fileId);return this.files.mutate(actor,key,'source-parsing.create',{fileId},f.reference,async c=>{const file=await this.files.requireReference(c,actor,fileId,undefined,true);ensure(['purchase_image','purchase_excel','manufacturer_source'].includes(file.purpose),400,'PARSING_PURPOSE_FORBIDDEN','该附件用途不支持采购或来源解析');let j=(await c.query('SELECT * FROM source_parsing_jobs WHERE file_id=$1',[fileId])).rows[0];if(!j)j=(await c.query('INSERT INTO source_parsing_jobs(file_id,created_by,parser_type,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(file_id) DO NOTHING RETURNING *',[fileId,actor.id,file.purpose==='purchase_image'?'ocr':'spreadsheet',this.files.core.clock()])).rows[0];if(!j)j=(await c.query('SELECT * FROM source_parsing_jobs WHERE file_id=$1',[fileId])).rows[0];return this.dto(j);});}
 get(actor:Actor,id:string){return this.files.core.db.transaction(async c=>this.dto((await this.authorized(c,actor,id)).j));}
 async retry(actor:Actor,key:string,id:string,input:unknown={}){
  const {acknowledgeUnknown}=z.object({acknowledgeUnknown:z.boolean().optional()}).strict().parse(input),job=await this.get(actor,id),f=await this.files.get(actor,job.fileId);
  return this.files.mutate(actor,key,'source-parsing.retry',{jobId:id,acknowledgeUnknown:!!acknowledgeUnknown},f.reference,async c=>{await this.authorized(c,actor,id,true);const j=(await c.query('SELECT * FROM source_parsing_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0];ensure(j.status==='failed'&&j.retryable&&j.attempts<5,409,'PARSING_RETRY_FORBIDDEN','仅可重试允许重试且未超出五次的失败任务');ensure(!j.result_unknown||acknowledgeUnknown,409,'OCR_UNKNOWN_REQUIRES_REVIEW','上次 OCR 结果未知，须人工核对并确认后重试');return this.dto((await c.query("UPDATE source_parsing_jobs SET status='pending',error_code=NULL,error_message=NULL,retryable=false,result_unknown=false,completed_at=NULL,lease_until=NULL WHERE id=$1 RETURNING *",[id])).rows[0]);});
 }
 private candidates(job:ParsingJob,mapping:SpreadsheetFieldMapping):ParsePreview{
  ensure(job.status==='succeeded'&&Array.isArray(job.rawRows),409,'PARSING_NOT_READY','解析尚未成功，请查看任务状态或手工录入');
  const rows:ParsedCandidate[]=job.rawRows.filter(row=>row.rowNumber>mapping.headerRow).map(row=>{
   const field=(n:number|undefined)=>n===undefined?'':(row.cells[n]||'').trim(),name=field(mapping.columns.name),spec=field(mapping.columns.spec),unit=mapping.columns.unit===undefined?'kg':field(mapping.columns.unit),remark=field(mapping.columns.remark),errors=[...row.errors];let quantity:string|null=null,sourcePrice:string|null=null;
   if(!name||name.length>100)errors.push('品名须为 1–100 字符');if(spec.length>200)errors.push('规格最多 200 字符');if(remark.length>500)errors.push('备注最多 500 字符');
   try{quantity=decimal(field(mapping.columns.quantity),true).toFixed(2);}catch{errors.push('数量须大于 0、最多两位小数并在允许范围内');}
   if(unit!=='kg')errors.push('单位须人工换算并核对为 kg');
   if(mapping.columns.sourcePrice!==undefined){try{sourcePrice=decimal(field(mapping.columns.sourcePrice),true).toFixed(2);}catch{errors.push('来源参考价无效，仅供查询且不进入计价');}}
   return {rowNumber:row.rowNumber,name,spec,quantity,unit,remark,sourcePrice,checked:false,errors};
  });return {fileId:job.fileId,jobId:job.id,rows,validRows:rows.filter(r=>!r.errors.length).length,invalidRows:rows.filter(r=>r.errors.length).length,requiresHumanReview:true};
 }
 async preview(actor:Actor,id:string,input:unknown){const mapping=mappingSchema.parse(input);return this.candidates(await this.get(actor,id),mapping);}
 async apply(actor:Actor,key:string,id:string,input:unknown){
  const v=z.object({expectedVersion:z.number().int().positive(),mapping:mappingSchema,rowNumbers:z.array(z.number().int().positive()).min(1).max(200).refine(a=>new Set(a).size===a.length).optional()}).strict().parse(input),job=await this.get(actor,id),file=await this.files.get(actor,job.fileId);
  ensure(file.reference.kind==='purchase_revision',400,'PARSING_PURPOSE_FORBIDDEN','来源表格只可导入来源批次，不能直接进入采购或计价');const ref=file.reference;
  return this.files.mutate(actor,key,'source-parsing.apply',{jobId:id,...v},ref,async(c,root)=>{
   const {j}=await this.authorized(c,actor,id,true),hash=createHash('sha256').update(stable({mapping:v.mapping,rowNumbers:v.rowNumbers?[...v.rowNumbers].sort((a,b)=>a-b):null})).digest('hex');
   if(j.applied_result){ensure(j.applied_hash===hash,409,'PARSING_ALREADY_APPLIED','该任务已按其他映射应用，请查看原候选行');return j.applied_result as {orderId:string;jobId:string;lineIds:string[];rowVersion:number};}
   this.files.core.checkVersion(root.row_version,v.expectedVersion);const p=this.candidates(this.dto(j),v.mapping),rows=v.rowNumbers?p.rows.filter(r=>v.rowNumbers!.includes(r.rowNumber)):p.rows;
   ensure(rows.length>0&&rows.length<=200&&(!v.rowNumbers||rows.length===v.rowNumbers.length),400,'PARSE_ROW_LIMIT','请选择 1–200 个有效候选行');ensure(rows.every(r=>r.errors.length===0&&r.quantity),400,'PARSE_ROWS_INVALID','存在无效行，请修正源表或选择有效行；也可手工录入');
   const existing=(await c.query('SELECT count(*)::int AS n,COALESCE(max(position),-1)::int AS pos FROM purchase_order_lines WHERE revision_id=$1',[ref.revisionId])).rows[0];ensure(existing.n+rows.length<=200,400,'PURCHASE_ROW_LIMIT','采购单最多 200 行');
   const lineIds:string[]=[];for(let n=0;n<rows.length;n++){const row=rows[n],lineId=randomUUID();await c.query('INSERT INTO purchase_order_lines(id,revision_id,position,name,spec,quantity,checked,source_file_id,parsing_job_id,source_row_number,purchase_remark,source_type) VALUES($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11)',[lineId,ref.revisionId,existing.pos+1+n,row.name,row.spec,row.quantity,file.id,id,row.rowNumber,row.remark,j.parser_type==='ocr'?'ocr':'excel']);lineIds.push(lineId);}
   await this.files.core.bump(c,ref.orderId);const result={orderId:ref.orderId,jobId:id,lineIds,rowVersion:root.row_version+1};await c.query('UPDATE source_parsing_jobs SET applied_result=$2,applied_hash=$3 WHERE id=$1',[id,JSON.stringify(result),hash]);await this.files.core.audit(c,ref.orderId,actor.id,'source-parsing.apply',{jobId:id,fileId:file.id,lineIds,checked:false});return result;
  });
 }
 /** Expired OCR leases are unknown outcomes and never automatically call the vendor again. */
 async recover(){const now=this.files.core.clock();await this.files.core.db.query("UPDATE source_parsing_jobs SET status='failed',error_code=CASE WHEN parser_type='ocr' THEN 'OCR_RESULT_UNKNOWN' ELSE 'PARSE_INTERRUPTED' END,error_message=CASE WHEN parser_type='ocr' THEN 'OCR 结果未知，请人工核对后显式重试' ELSE '解析进程中断，可手工重试' END,retryable=attempts<5,result_unknown=parser_type='ocr',completed_at=$1,lease_until=NULL WHERE status='processing' AND lease_until<=$1",[now]);}
 async claim(){return this.files.core.db.transaction(async c=>{const row=(await c.query("SELECT * FROM source_parsing_jobs WHERE status='pending' AND attempts<5 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];if(!row)return null;const j=(await c.query("UPDATE source_parsing_jobs SET status='processing',attempts=attempts+1,claim_generation=claim_generation+1,lease_until=$2,error_code=NULL,error_message=NULL WHERE id=$1 RETURNING *",[row.id,new Date(this.files.core.clock().getTime()+60000)])).rows[0],f=(await c.query('SELECT * FROM source_files WHERE id=$1',[j.file_id])).rows[0];return {j,f};});}
 async runOnce(){
  await this.recover();const claim=await this.claim();if(!claim)return false;const {j,f}=claim;
  const controller=new AbortController(),signal=this.options.signal?AbortSignal.any([controller.signal,this.options.signal]):controller.signal;
  const budgetMs=Math.max(1,Math.min(this.options.timeoutMs??20000,20000)),deadline=performance.now()+budgetMs,stale=Symbol('stale-parse-claim');
  let vendorStarted=false,rejectBoundary!:(reason:unknown)=>void;
  const failure=(timeout:boolean)=>j.parser_type==='ocr'&&vendorStarted
   ?new ParseFailure('OCR_RESULT_UNKNOWN',timeout?'OCR 总时限已到，结果未知；请人工核对后再重试':'OCR 已中断，结果未知；请人工核对后再重试',true,true)
   :new ParseFailure(timeout?'PARSE_TIMEOUT':'PARSE_INTERRUPTED',timeout?'源文件读取或解析超过总时限，可手工重试':'源文件读取或解析已中断，可手工重试',true);
  const boundary=new Promise<never>((_resolve,reject)=>{rejectBoundary=reject;});
  const abortFailure=()=>signal.reason instanceof ParseFailure?signal.reason:failure(false);
  const onAbort=()=>rejectBoundary(abortFailure());
  signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(failure(true)),budgetMs);
  const check=()=>{if(!signal.aborted&&performance.now()>=deadline)controller.abort(failure(true));if(signal.aborted)throw abortFailure();};
  if(signal.aborted)onAbort();
  try{
   const work=async():Promise<OcrResult|typeof stale>=>{
    check();const bytes=await this.files.storage.read(f.object_key);check();
    ensure(bytes.length===f.byte_size&&createHash('sha256').update(bytes).digest('hex')===f.sha256,503,'STORAGE_INTEGRITY','原文件完整性校验失败');check();
    // Storage can outlive its caller. Never start a parser/vendor after recovery or a newer claim.
    const current=await this.files.core.db.query("SELECT id FROM source_parsing_jobs WHERE id=$1 AND claim_generation=$2 AND status='processing' AND lease_until>$3",[j.id,j.claim_generation,this.files.core.clock()]);
    check();if(!current.rowCount)return stale;
    if(j.parser_type==='ocr'){vendorStarted=true;return this.ocr.recognize(bytes,signal);}
    return {rows:await (this.options.spreadsheet?this.options.spreadsheet(bytes,f.file_name,f.mime_type):parseInChild(bytes,f.file_name,f.mime_type,{timeoutMs:Math.max(1,deadline-performance.now()),signal})),confidence:null};
   };
   const result=await Promise.race([work(),boundary]);if(result===stale)return true;check();
   const rows=rawSchema.parse(result.rows);ensure(Buffer.byteLength(JSON.stringify(rows))<=8*1024*1024&&(result.confidence===null||typeof result.confidence==='number'&&result.confidence>=0&&result.confidence<=1),400,'PARSE_RESOURCE_LIMIT','解析输出超过限制');check();
   await this.files.core.db.query("UPDATE source_parsing_jobs SET status='succeeded',raw_rows=$3,confidence=$4,completed_at=$5,lease_until=NULL,retryable=false,result_unknown=false WHERE id=$1 AND claim_generation=$2 AND status='processing' AND lease_until>$5",[j.id,j.claim_generation,JSON.stringify(rows),result.confidence,this.files.core.clock()]);
  }catch(e){const failed=e instanceof ParseFailure?e:new ParseFailure('PARSING_FAILED','文件解析失败，原文件已保留；请手工录入或核对后重试',true);await this.files.core.db.query("UPDATE source_parsing_jobs SET status='failed',error_code=$3,error_message=$4,retryable=$5,result_unknown=$6,completed_at=$7,lease_until=NULL WHERE id=$1 AND claim_generation=$2 AND status='processing' AND lease_until>$7",[j.id,j.claim_generation,failed.code,failed.message,failed.retryable&&j.attempts<5,failed.resultUnknown,this.files.core.clock()]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);controller.abort();}
  return true;
 }
}
