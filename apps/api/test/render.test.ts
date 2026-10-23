import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {renderQuote, exportFilename} from '../src/delivery/render';
import type {QuoteDocument} from '../../../packages/contracts/src';
import {sample} from './render-fixture';
test('真实 XLSX 重开后价格金额为已冻结数值，缺货留空，不含内部成本',async()=>{
 const bytes=await renderQuote(sample,'xlsx');assert.equal(bytes.subarray(0,2).toString(),'PK');
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any);const sheet=workbook.worksheets[0]!;
 const values=sheet.getSheetValues().flat(2);assert.ok(values.includes('黄芪'));assert.ok(values.includes(29.5));assert.ok(values.includes(368.75));assert.ok(values.includes('缺货'));
 assert.ok(!JSON.stringify(values).includes('基准'));assert.ok(!JSON.stringify(values).includes('厂家'));
 const missingRow=sheet.getRows(1,sheet.rowCount)!.find(row=>row.values&&JSON.stringify(row.values).includes('党参'))!;assert.equal(missingRow.getCell(5).value,null);assert.equal(missingRow.getCell(6).value,null);
});
test('全缺货 XLSX 无价格有效期和数字零总额',async()=>{
 const d={...sample,validUntil:null,total:null,lines:sample.lines.map(l=>({...l,status:'missing' as const,unitPrice:null,amount:null}))};
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await renderQuote(d,'xlsx') as any);const values=JSON.stringify(workbook.worksheets[0]!.getSheetValues());assert.ok(values.includes('不适用（全部缺货）'));assert.ok(!values.includes('2026-10-25'));
});
test('PDF 中文长单产生实际多页 PDF，文件名阻止路径及控制字符',async()=>{
 const bytes=await renderQuote({...sample,lines:Array.from({length:100},(_,i)=>({...sample.lines[0]!,position:i+1,name:'黄芪（长品名换行测试）',spec:'规格说明'.repeat(20)}))},'pdf');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1);
 assert.equal(exportFilename({...sample,hospitalName:'../医院\n/危险'},'pdf').includes('/'),false);
});
test('Excel 显式换行长规格和备注分为可见续行，不超过行高上限',async()=>{
 const spec='规格\n'.repeat(60),remark='说明\n'.repeat(100);const book=new ExcelJS.Workbook();await book.xlsx.load(await renderQuote({...sample,lines:[{...sample.lines[0]!,spec,remark}]},'xlsx') as any);const rows=book.worksheets[0]!.getRows(8,book.worksheets[0]!.rowCount-7)!;
 assert.ok(rows.filter(r=>typeof r.getCell(1).value==='number'||String(r.getCell(1).value||'').includes('（续）')).length>1);assert.ok(rows.every(r=>(r.height||15)<=409));
});
