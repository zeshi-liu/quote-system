import {createHash,createHmac} from 'node:crypto';
import type {RawParseRow} from '../../../../packages/contracts/src/source-files';
import {ParseFailure} from './parse-worker';
export interface OcrResult {rows:RawParseRow[];confidence:number|null;}
export interface OcrAdapter {recognize(bytes:Buffer,signal:AbortSignal):Promise<OcrResult>;}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const hmac=(key:string|Buffer,s:string)=>createHmac('sha256',key).update(s).digest();
const fail=(message:string):never=>{throw new ParseFailure('OCR_INVALID_RESPONSE',message,true);};
/** Preserve literal cell text. Merged/overlapping/non-table areas require manual review. */
function tableRows(payload:any):OcrResult {
 if(!Array.isArray(payload?.TableDetections))return fail('OCR 未返回表格结构，原图已保留，请手工录入');
 if(payload.TableDetections.length>20)throw new ParseFailure('OCR_RESOURCE_LIMIT','OCR 表格数量超过 20，请拆分图片');
 const rows:RawParseRow[]=[],confidences:number[]=[];let offset=0,totalCells=0,coveredCells=0;
 for(const table of payload.TableDetections){
  if(!Array.isArray(table?.Cells))return fail('OCR 单元格结构无效，原图已保留，请手工录入');
  totalCells+=table.Cells.length;if(totalCells>64064)throw new ParseFailure('OCR_RESOURCE_LIMIT','OCR 单元格数量超过限制，请拆分图片');
  if(table.Type===0||table.Type===null){
   for(const cell of table.Cells){
    if(!cell||typeof cell.Text!=='string'||cell.Text.length>2000)return fail('OCR 原文无效或超过 2000 字符，请手工录入');
    if(offset>=1001)throw new ParseFailure('OCR_RESOURCE_LIMIT','OCR 原文行数超过限制，请拆分图片');
    rows.push({rowNumber:++offset,cells:[cell.Text],errors:['非表格或结构未确定的原文仅供核对，请手工录入采购字段']});
    if(typeof cell.Confidence==='number'&&Number.isFinite(cell.Confidence)&&cell.Confidence>=0&&cell.Confidence<=100)confidences.push(cell.Confidence);
   }
   continue;
  }
  if(![1,2].includes(table.Type))return fail('OCR 未返回可用表格类型，请手工录入');
  const byRow=new Map<number,RawParseRow>(),occupied=new Set<string>();let maxRow=-1,maxColumn=0;
  const rowAt=(index:number)=>{let row=byRow.get(index);if(!row){row={rowNumber:offset+index+1,cells:[],errors:[]};byRow.set(index,row);}return row;};
  const error=(row:RawParseRow,text:string)=>{if(!row.errors.includes(text))row.errors.push(text);};
  for(const cell of table.Cells){
   if(!cell||typeof cell.Text!=='string'||cell.Text.length>2000)return fail('OCR 单元格原文无效或超过 2000 字符，请手工录入');
   const {RowTl:r,ColTl:c,RowBr:br,ColBr:bc}=cell;
   if(![r,c,br,bc].every(Number.isInteger)||r<0||c<0||br<=r||bc<=c)return fail('OCR 单元格坐标无效，请手工核对');
   if(br>1001||bc>64||offset+br>1001)throw new ParseFailure('OCR_RESOURCE_LIMIT','OCR 最多 1000 数据行及一行表头、64 列，请拆分图片');
   coveredCells+=(br-r)*(bc-c);if(coveredCells>64064)throw new ParseFailure('OCR_RESOURCE_LIMIT','OCR 合并区域展开超过限制，请拆分图片或手工录入');
   maxRow=Math.max(maxRow,br-1);maxColumn=Math.max(maxColumn,bc);
   const first=rowAt(r);first.cells[c]=first.cells[c]===undefined?cell.Text:first.cells[c]+'\n'+cell.Text;
   for(let ri=r;ri<br;ri++){
    const row=rowAt(ri);if(br-r>1||bc-c>1)error(row,'存在合并单元格，请手工拆分核对后录入');
    for(let ci=c;ci<bc;ci++){const key=ri+':'+ci;if(occupied.has(key))error(row,'存在重叠单元格，请手工核对后录入');occupied.add(key);}
   }
   if(/^\s*[=+@]/.test(cell.Text))error(first,'识别原文疑似公式，请人工核对为原始值');
   if(typeof cell.Confidence==='number'&&Number.isFinite(cell.Confidence)&&cell.Confidence>=0&&cell.Confidence<=100)confidences.push(cell.Confidence);
  }
  for(const [_,row] of [...byRow.entries()].sort((a,b)=>a[0]-b[0])){row.cells=Array.from({length:maxColumn},(_,i)=>row.cells[i]??'');rows.push(row);}
  offset+=maxRow+1;
 }
 if(!rows.length)throw new ParseFailure('OCR_NO_TABLE','未识别到可用单元格，原图已保留，请手工录入',true);
 return {rows,confidence:confidences.length?confidences.reduce((a,b)=>a+b,0)/confidences.length/100:null};
}
/** Tencent table OCR V3 / TC3. The vendor's Excel Data is never loaded or executed. */
export class TencentOcrAdapter implements OcrAdapter {
 constructor(readonly options:{secretId?:string;secretKey?:string;region?:string;fetch?:typeof fetch;clock?:()=>Date}={}){}
 async recognize(bytes:Buffer,signal:AbortSignal):Promise<OcrResult>{
  const secretId=this.options.secretId??process.env.TENCENT_OCR_SECRET_ID,secretKey=this.options.secretKey??process.env.TENCENT_OCR_SECRET_KEY;
  if(!secretId||!secretKey)throw new ParseFailure('OCR_NOT_CONFIGURED','OCR 尚未配置，请手工录入或联系维护人员配置',true);
  const base64=bytes.toString('base64');if(base64.length>10*1024*1024)throw new ParseFailure('OCR_IMAGE_TOO_LARGE','OCR 编码后图片须不超过 10MB；原文件已保留，请换较小图片或手工录入');
  const timestamp=Math.floor((this.options.clock?.()||new Date()).getTime()/1000),date=new Date(timestamp*1000).toISOString().slice(0,10),host='ocr.tencentcloudapi.com',action='RecognizeTableAccurateOCR',type='application/json; charset=utf-8',body=JSON.stringify({ImageBase64:base64,UseNewModel:false}),headers='content-type;host;x-tc-action';
  const canonical=`POST\n/\n\ncontent-type:${type}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n\n${headers}\n${digest(body)}`,scope=`${date}/ocr/tc3_request`,stringToSign=`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`,signature=createHmac('sha256',hmac(hmac(hmac('TC3'+secretKey,date),'ocr'),'tc3_request')).update(stringToSign).digest('hex');
  let payload:any;
  try{
   const response=await (this.options.fetch||fetch)('https://ocr.tencentcloudapi.com/',{method:'POST',signal,redirect:'error',headers:{'Content-Type':type,Host:host,'X-TC-Action':action,'X-TC-Version':'2018-11-19','X-TC-Timestamp':String(timestamp),'X-TC-Region':this.options.region??process.env.TENCENT_OCR_REGION??'ap-guangzhou',Authorization:`TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${headers}, Signature=${signature}`},body});
   if(!response.ok)throw new ParseFailure('OCR_RESULT_UNKNOWN','OCR 响应异常，可能已产生调用；核对后再手工重试',true,true);
   const chunks:Uint8Array[]=[];let size=0;const reader=response.body?.getReader();if(!reader)throw Error('missing body');while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>8*1024*1024){await reader.cancel();throw Error('oversized response');}chunks.push(r.value);}payload=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.Response;
  }catch(e){if(e instanceof ParseFailure)throw e;throw new ParseFailure('OCR_RESULT_UNKNOWN','OCR 结果未知，原图已保留；核对后再手工重试',true,true);}
  if(payload?.Error){const code=String(payload.Error.Code||'');throw new ParseFailure('OCR_REJECTED','OCR 服务拒绝本次请求，请核对凭据、配额或图片后手工重试',/RequestLimitExceeded|ResourceUnavailable|InternalError|AuthFailure/.test(code));}
  return tableRows(payload);
 }
}
