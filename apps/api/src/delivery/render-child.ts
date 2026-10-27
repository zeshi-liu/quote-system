import {renderQuote,type RenderDocument} from './render';
import type {ExportFormat} from '../../../../packages/contracts/src';
process.once('message',async(input:{document:RenderDocument;format:ExportFormat})=>{
 try{const bytes=await renderQuote(input.document,input.format);if(bytes.length>20*1024*1024)throw new Error('导出文件超过限制');process.send?.({ok:true,bytes},()=>process.exit(0));}
 catch(error:any){process.send?.({ok:false,...(error?.code==='TEMPLATE_LOGO_INVALID'?{error:error.code}:{})},()=>process.exit(1));}
});
