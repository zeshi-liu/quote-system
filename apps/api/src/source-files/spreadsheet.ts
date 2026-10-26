import * as XLSX from 'xlsx';
import type {RawParseRow} from '../../../../packages/contracts/src/source-files';
import {ensure} from '../core/errors';
import {validateFile,zipEntries} from './validation';
/** Data extraction only: never call an HTML exporter, evaluator, macro engine or fetch. */
export function parseSpreadsheet(bytes:Buffer,fileName:string,mimeType:string):RawParseRow[]{
 const type=validateFile(fileName,mimeType,bytes);ensure(['xlsx','xls','csv'].includes(type),400,'UNSUPPORTED_WORKBOOK','仅解析表格文件');
 if(type==='xlsx')for(const e of zipEntries(bytes)){
  ensure(!/vbaProject|macrosheets|externalLinks/i.test(e.name),400,'UNSAFE_WORKBOOK','工作簿含宏或外部引用，请另存为纯数据表');
  if(/\.rels$/i.test(e.name))ensure(!/TargetMode\s*=\s*["']External["']/i.test(e.data().toString('utf8')),400,'UNSAFE_WORKBOOK','工作簿含外部链接，请移除后重传');
 }
 const wb=XLSX.read(bytes,{type:'buffer',raw:true,cellFormula:true,cellHTML:false,cellStyles:false,cellNF:false,bookVBA:true,bookFiles:true,bookDeps:false,sheetRows:1002,codepage:type==='csv'?65001:undefined});
 ensure(!wb.vbaraw,400,'UNSAFE_WORKBOOK','工作簿含宏，请另存为纯数据表');
 const cfb=(wb as any).cfb||((wb as any).CFB);ensure(!cfb?.FullPaths?.some((p:string)=>/VBA|_VBA_PROJECT|Macros/i.test(p)),400,'UNSAFE_WORKBOOK','工作簿含宏，请另存为纯数据表');
 ensure(wb.SheetNames.length>0&&wb.SheetNames.length<=20,400,'PARSE_RESOURCE_LIMIT','工作表数量须为 1–20');
 const sheet=wb.Sheets[wb.SheetNames[0]],ref=sheet?.['!fullref']||sheet?.['!ref'];if(!ref)return [];
 const range=XLSX.utils.decode_range(ref);ensure(range.e.r<1001&&range.e.c<64,400,'PARSE_RESOURCE_LIMIT','单表最多 1000 数据行及一行表头、64 列；请拆分文件');
 const rows:RawParseRow[]=[];
 for(let row=0;row<=range.e.r;row++){
  const cells:string[]=[],errors:string[]=[];
  for(let col=0;col<=range.e.c;col++){
   const cell=sheet[XLSX.utils.encode_cell({r:row,c:col})] as XLSX.CellObject|undefined;let text='';
   if(cell){if(cell.f){errors.push(`第 ${col+1} 列含公式，须人工替换为原始值`);}else if(cell.t==='e'){errors.push(`第 ${col+1} 列为错误值`);}else if(cell.v!==undefined&&cell.v!==null){text=String(cell.v);if(/^\s*[=+@]/.test(text)){errors.push(`第 ${col+1} 列疑似公式，须人工核对`);text='';}}
    if(cell.l)errors.push(`第 ${col+1} 列含链接，须移除后核对`);
   }
   ensure(text.length<=2000,400,'PARSE_RESOURCE_LIMIT','单元格文本超过 2000 字符');cells.push(text);
  }
  if(cells.some(x=>x.trim())||errors.length)rows.push({rowNumber:row+1,cells,errors});
 }
 return rows;
}
