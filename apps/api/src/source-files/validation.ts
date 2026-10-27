import {z} from 'zod';
import {inflateRawSync} from 'node:zlib';
import {TextDecoder} from 'node:util';
import {ensure} from '../core/errors';
export const MAX_BYTES=20*1024*1024;
export const sourceReference=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('purchase_revision'),orderId:z.uuid(),revisionId:z.uuid()}).strict(),
 z.object({kind:z.literal('historical_order'),orderId:z.uuid()}).strict(),
 z.object({kind:z.literal('payment_record'),orderId:z.uuid(),paymentRecordId:z.uuid()}).strict(),
 z.object({kind:z.literal('manufacturer'),manufacturerId:z.uuid()}).strict(),
 z.object({kind:z.literal('template')}).strict()
]);
export const mappingSchema=z.object({headerRow:z.number().int().min(0).max(1001),columns:z.object({name:z.number().int().min(0).max(63),quantity:z.number().int().min(0).max(63),spec:z.number().int().min(0).max(63).optional(),unit:z.number().int().min(0).max(63).optional(),remark:z.number().int().min(0).max(63).optional(),sourcePrice:z.number().int().min(0).max(63).optional()}).strict()}).strict().refine(v=>new Set(Object.values(v.columns)).size===Object.values(v.columns).length,'字段不能映射同一列');
/** Read central directory before inflation, bounding both declared and actual expanded data. */
export function zipEntries(bytes:Buffer){
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50){end=p;break;}
 ensure(end>=0,400,'FILE_CONTENT_MISMATCH','XLSX 压缩结构无效');
 const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16);ensure(count>0&&count<=5000&&start<end,400,'PARSE_RESOURCE_LIMIT','表格压缩结构超过限制');
 const entries:{name:string;data:()=>Buffer}[]=[];let p=start,expanded=0;
 for(let n=0;n<count;n++){
  ensure(p+46<=end&&bytes.readUInt32LE(p)===0x02014b50,400,'FILE_CONTENT_MISMATCH','XLSX 压缩目录无效');
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),compressed=bytes.readUInt32LE(p+20),size=bytes.readUInt32LE(p+24),nl=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),local=bytes.readUInt32LE(p+42);
  ensure(p+46+nl+extra+comment<=end&&!(flags&1)&&[0,8].includes(method),400,'UNSUPPORTED_WORKBOOK','加密或不支持的压缩格式');
  const name=bytes.toString('utf8',p+46,p+46+nl);expanded+=size;
  ensure(size<=40*1024*1024&&expanded<=80*1024*1024&&(size<=1024*1024||size<=Math.max(1,compressed)*300),400,'PARSE_RESOURCE_LIMIT','表格解压后超过资源限制');
  ensure(!name.includes('..')&&!name.startsWith('/')&&!name.includes('\\'),400,'FILE_CONTENT_MISMATCH','压缩文件路径无效');
  entries.push({name,data:()=>{ensure(local+30<=bytes.length&&bytes.readUInt32LE(local)===0x04034b50,400,'FILE_CONTENT_MISMATCH','压缩内容无效');const offset=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);ensure(offset+compressed<=start,400,'FILE_CONTENT_MISMATCH','压缩内容越界');const raw=bytes.subarray(offset,offset+compressed),value=method===0?raw:inflateRawSync(raw,{maxOutputLength:Math.max(1,size)});ensure(value.length===size,400,'FILE_CONTENT_MISMATCH','表格解压长度无效');return value;}});p+=46+nl+extra+comment;
 }
 ensure(p===end,400,'FILE_CONTENT_MISMATCH','压缩目录长度无效');return entries;
}
export function validateFile(name:string,mime:string,bytes:Buffer){
 ensure(bytes.length>0&&bytes.length<=MAX_BYTES,bytes.length>MAX_BYTES?413:400,'FILE_SIZE_LIMIT','单文件须为 1 字节至 20MB');
 const ext=name.split('.').pop()?.toLowerCase();
 const mimes:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv'};
 ensure(ext&&mimes[ext]===mime,400,'FILE_TYPE_NOT_ALLOWED','文件后缀与 MIME 须为允许且相符的类型');
 if(ext==='png'){ensure(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR',400,'FILE_CONTENT_MISMATCH','PNG 内容与后缀不符');ensure(bytes.readUInt32BE(16)*bytes.readUInt32BE(20)<=40_000_000,400,'PARSE_RESOURCE_LIMIT','图片像素超过限制');}
 else if(ext==='jpg'||ext==='jpeg')ensure(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255,400,'FILE_CONTENT_MISMATCH','JPEG 内容与后缀不符');
 else if(ext==='xls')ensure(bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')),400,'FILE_CONTENT_MISMATCH','XLS 须为真实二进制工作簿');
 else if(ext==='xlsx'){ensure(bytes.length>=22&&bytes.readUInt32LE(0)===0x04034b50,400,'FILE_CONTENT_MISMATCH','XLSX 内容与后缀不符');const entries=zipEntries(bytes);ensure(entries.some(e=>e.name==='[Content_Types].xml')&&entries.some(e=>e.name==='xl/workbook.xml'),400,'FILE_CONTENT_MISMATCH','文件不是 XLSX 工作簿');}
 else{let s='';try{s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{ensure(false,400,'CSV_ENCODING','CSV 须使用 UTF-8 编码');}ensure(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)&&!/^\s*</.test(s),400,'FILE_CONTENT_MISMATCH','CSV 须为文本表格');}
 return ext as 'png'|'jpg'|'jpeg'|'xlsx'|'xls'|'csv';
}
