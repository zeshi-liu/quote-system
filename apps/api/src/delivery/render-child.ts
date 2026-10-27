import {renderQuote} from './render';
import type {QuoteDocument,ExportFormat} from '../../../../packages/contracts/src';
process.once('message',async(input:{document:QuoteDocument;format:ExportFormat})=>{
 try{const bytes=await renderQuote(input.document,input.format);if(bytes.length>20*1024*1024)throw new Error('导出文件超过限制');process.send?.({ok:true,bytes},()=>process.exit(0));}
 catch{process.send?.({ok:false},()=>process.exit(1));}
});
