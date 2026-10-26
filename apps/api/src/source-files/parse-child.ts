import {parseSpreadsheet} from './spreadsheet';
process.once('message',(m:any)=>{try{if(!Buffer.isBuffer(m?.bytes)||m.bytes.length>20*1024*1024)throw Error('invalid input');const rows=parseSpreadsheet(m.bytes,m.fileName,m.mimeType);process.send?.({ok:true,rows});}catch(e:any){process.send?.({ok:false,code:typeof e?.code==='string'?e.code:'INVALID_WORKBOOK'});}finally{process.disconnect?.();}});
