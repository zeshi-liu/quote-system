import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purchaseLines,supplierInput} from '../src/core/validation';
test('MVP 支持完整200行采购和厂家逐行提交，第201行明确拒绝而不截断',()=>{
 const lines=Array.from({length:200},(_,i)=>({name:'药品'+i,spec:'规格',quantity:'1.00',checked:true}));
 assert.equal(purchaseLines.parse(lines).length,200);assert.throws(()=>purchaseLines.parse([...lines,lines[0]]));
 const quoteLines=lines.map(()=>({purchaseLineId:randomUUID(),status:'quoted',unitPrice:'10.00'}));
 assert.equal(supplierInput.parse({validUntil:'2026-11-01',lines:quoteLines}).lines.length,200);
 assert.throws(()=>supplierInput.parse({validUntil:'2026-11-01',lines:[...quoteLines,{...quoteLines[0],purchaseLineId:randomUUID()}]}));
});
