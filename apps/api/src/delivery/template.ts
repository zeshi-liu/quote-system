import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {decode as decodeJpeg} from 'jpeg-js';
import type {QuoteDocument} from '../../../../packages/contracts/src';
import {BusinessError,ensure} from '../core/errors';
import type {ObjectStorage} from './storage';
export const MAX_LOGO_BYTES=20*1024*1024;
export type ResolvedQuoteLogo={bytes:Buffer;mimeType:'image/png'|'image/jpeg'};
type Queryable={query(text:string,values?:unknown[]):Promise<{rows:any[]}>};
function logoMetadata(row:any):NonNullable<QuoteDocument['logo']>{
 ensure(row&&row.purpose==='template_logo'&&row.reference_kind==='template'&&!row.order_id&&!row.revision_id&&!row.manufacturer_id&&!row.payment_record_id&&['image/png','image/jpeg'].includes(row.mime_type)&&Number.isSafeInteger(row.byte_size)&&row.byte_size>0&&row.byte_size<=MAX_LOGO_BYTES&&/^[a-f0-9]{64}$/.test(row.sha256),409,'TEMPLATE_LOGO_INVALID','模板 logo 文件用途、类型或大小校验失败');
 ensure(row.mime_type==='image/png'?row.file_type==='png':['jpg','jpeg'].includes(row.file_type),409,'TEMPLATE_LOGO_INVALID','模板 logo 文件类型不符');
 return {fileId:row.id,sha256:row.sha256,mimeType:row.mime_type,byteSize:row.byte_size};
}
/** Select server maintained values while the surrounding export transaction holds its order lock. */
export async function selectQuoteTemplate(c:Queryable){
 const t=(await c.query('SELECT * FROM quote_templates WHERE active AND is_default FOR SHARE')).rows[0];if(!t)return null;
 const logo=t.logo_file_id?logoMetadata((await c.query('SELECT * FROM source_files WHERE id=$1 FOR SHARE',[t.logo_file_id])).rows[0]):undefined;
 return {sellerName:t.seller_name as string,contact:t.contact_phone as string,notes:t.fixed_notes as string,template:{id:t.id as string,version:t.row_version as number},...(logo?{logo}:{})};
}
/** Call only after authorizing access to the quote version. Never return source object keys. */
export async function resolveQuoteLogo(c:Queryable,storage:ObjectStorage,document:QuoteDocument):Promise<ResolvedQuoteLogo|null>{
 if(!document.logo)return null;
 const wanted=document.logo,row=(await c.query('SELECT * FROM source_files WHERE id=$1',[wanted.fileId])).rows[0],actual=logoMetadata(row);
 ensure(actual.fileId===wanted.fileId&&actual.sha256===wanted.sha256&&actual.mimeType===wanted.mimeType&&actual.byteSize===wanted.byteSize,409,'TEMPLATE_LOGO_INVALID','模板 logo 与冻结文件依据不符');
 // Metadata is immutable. Changing the current default template must not change old versions.
 let bytes:Buffer;try{bytes=await storage.read(row.object_key);}catch{throw new BusinessError(503,'TEMPLATE_LOGO_UNAVAILABLE','模板 logo 原文件暂不可用，请联系维护人员');}
 ensure(Buffer.isBuffer(bytes)&&bytes.length===actual.byteSize&&bytes.length<=MAX_LOGO_BYTES&&createHash('sha256').update(bytes).digest('hex')===actual.sha256,503,'TEMPLATE_LOGO_INTEGRITY','模板 logo 原文件完整性校验失败，请联系维护人员');
 return {bytes,mimeType:actual.mimeType};
}
/** Run in the bounded rendering process, before either format embeds an image. */
const crcTable=Array.from({length:256},(_,i)=>{let v=i;for(let n=0;n<8;n++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
const crc32=(b:Buffer)=>{let v=0xffffffff;for(const n of b)v=crcTable[(v^n)&255]!^(v>>>8);return (v^0xffffffff)>>>0;};
export function validateLogoImage(logo:ResolvedQuoteLogo){
 const b=logo.bytes;const invalid=()=>new BusinessError(409,'TEMPLATE_LOGO_INVALID','模板 logo 图片格式损坏或像素超过资源限制');
 if(!Buffer.isBuffer(b)||!b.length||b.length>MAX_LOGO_BYTES)throw invalid();
 let width=0,height=0;
 if(logo.mimeType==='image/png'){
  if(b.length<45||!b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||b.toString('ascii',12,16)!=='IHDR'||b.readUInt32BE(8)!==13)throw invalid();
  width=b.readUInt32BE(16);height=b.readUInt32BE(20);if(!width||!height||width*height>4_000_000)throw invalid();
  // Bound decompression even for a tiny compressed file with forged dimensions.
  const bits=b[24]!,color=b[25]!,channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];if(!channels||!(color===0?[1,2,4,8,16]:color===3?[1,2,4,8]:[8,16]).includes(bits)||b[26]!==0||b[27]!==0||b[28]!>1)throw invalid();
  let p=8,ended=false,headerSeen=false;const data:Buffer[]=[];
  while(p+12<=b.length){const n=b.readUInt32BE(p),kind=b.toString('ascii',p+4,p+8);if(n>b.length-p-12||crc32(b.subarray(p+4,p+8+n))!==b.readUInt32BE(p+8+n))throw invalid();if(kind==='IHDR'){if(headerSeen)throw invalid();headerSeen=true;}if(kind==='PLTE'&&(n<3||n>768||n%3))throw invalid();if(kind==='IDAT')data.push(b.subarray(p+8,p+8+n));p+=12+n;if(kind==='IEND'){if(n||p!==b.length)throw invalid();ended=true;break;}}
  if(!ended||!data.length)throw invalid();
  try{const raw=inflateSync(Buffer.concat(data),{maxOutputLength:Math.min(40*1024*1024,height*(width*8+8)+4096)});const passes=b[28]===0?[[0,0,1,1]]:[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];let offset=0;for(const [x,y,dx,dy] of passes as number[][]){const w=Math.max(0,Math.ceil((width-x!)/dx!)),h=Math.max(0,Math.ceil((height-y!)/dy!));if(!w||!h)continue;const stride=Math.ceil(w*channels*bits/8)+1;for(let row=0;row<h;row++){if(offset>=raw.length||raw[offset]!>4)throw invalid();offset+=stride;}}if(offset!==raw.length)throw invalid();const decoder=require('pngjs') as {PNG:{sync:{read(bytes:Buffer,options:{checkCRC:boolean}):{width:number;height:number;data:Buffer}}}};const decoded=decoder.PNG.sync.read(b,{checkCRC:true});if(decoded.width!==width||decoded.height!==height||decoded.data.length!==width*height*4)throw invalid();}catch{throw invalid();}
 }else if(logo.mimeType==='image/jpeg'){
  if(b.length<8||b.readUInt16BE(0)!==0xffd8||b.readUInt16BE(b.length-2)!==0xffd9)throw invalid();let p=2,scan=false;
  while(p+4<=b.length){if(b[p++]!==255)throw invalid();while(b[p]===255)p++;const marker=b[p++]!;if(marker===0xda){const n=b.readUInt16BE(p);if(n<6||p+n>=b.length-2)throw invalid();scan=true;break;}if(marker===0xd9)break;const n=b.readUInt16BE(p);if(n<2||p+n>b.length)throw invalid();if([0xc0,0xc1,0xc2].includes(marker)){if(n<8)throw invalid();height=b.readUInt16BE(p+3);width=b.readUInt16BE(p+5);}p+=n;}
  if(!scan||!width||!height||width*height>4_000_000)throw invalid();
  try{const decoded=decodeJpeg(b,{useTArray:true,tolerantDecoding:false,maxResolutionInMP:4,maxMemoryUsageInMB:64});if(decoded.width!==width||decoded.height!==height||decoded.data.length!==width*height*4)throw invalid();}catch{throw invalid();}
 }else throw invalid();
 if(!width||!height||width*height>4_000_000)throw invalid();
 return {width,height};
}
