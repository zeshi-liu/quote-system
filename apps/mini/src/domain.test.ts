import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageOrder, pricingInputs, recommendation, restoreMarkup, validPositive } from './domain';
import { committedOperationNotice, recordOperation, replayDescriptor, retainPending } from './pending';
import { retainPending as retainSupplierPending } from '../../supplier-h5/src/pending';
test('currency recommendations round once using exact decimals',()=>{
 assert.equal(recommendation('0.10','fixed','0.20'),'0.30');
 assert.equal(recommendation('38.50','percent','15'),'44.28');
 assert.equal(recommendation('12.34','multiplier','1.25'),'15.43');
});
test('mobile decimal entries reject exponent and excessive decimals',()=>{
 for(const value of ['0','-1','1.001','1e2','',' 2']) assert.equal(validPositive(value),false,value);
 for(const value of ['0.01','2','2.50']) assert.equal(validPositive(value),true,value);
});
test('preview rejects parameters the server cannot save',()=>{
 for(const [method,value] of [['percent','1.001'],['fixed','01'],['multiplier','0.99']] as const) assert.throws(()=>recommendation('20.00',method,value));
 assert.throws(()=>recommendation('9999999999.99','fixed','0.01'));
 assert.equal(validPositive('01'),false);
});
test('undo markup preserves later final price and manufacturer edits',()=>{
 const current={basePrice:'20.00',baseSupplierQuoteLineId:'new-base',finalPrice:'99.00',finalConfirmed:true,markupMethod:'percent' as const,parameterValue:'10',recommendedPrice:'22.00'};
 const restored=restoreMarkup(current,{markupMethod:'fixed',parameterValue:'5',recommendedPrice:'15.00'});
 assert.equal(restored.finalPrice,'99.00');assert.equal(restored.finalConfirmed,true);assert.equal(restored.baseSupplierQuoteLineId,'new-base');
 assert.equal(restored.markupMethod,'fixed');assert.equal(restored.recommendedPrice,'25.00');
});
test('refresh replays the original request key and body after later form edits',()=>{
 const form={lines:[{name:'黄芪',quantity:'2.00'}]};
 const saved=recordOperation('original-key','创建采购单','/sales/purchase-orders','POST',form);
 form.lines[0].quantity='99.00';
 const replay=replayDescriptor(JSON.parse(JSON.stringify(saved)));
 assert.equal(replay?.key,'original-key');assert.equal(replay?.path,'/sales/purchase-orders');
 assert.equal((replay?.data.lines as typeof form.lines)[0].quantity,'2.00');
});
test('legacy unknown operations cannot be replayed with a new fabricated request',()=>{
 assert.equal(replayDescriptor({key:'legacy-key',label:'创建采购单'}),null);
});
test('auth and link failure on a retry cannot discard the original unknown operation',()=>{
 for(const retain of [retainPending,retainSupplierPending]){
  for(const status of [401,403,410,503,408,undefined])assert.equal(retain(status,false),true,String(status));
  assert.equal(retain(409,true),true);assert.equal(retain(400,false),false);assert.equal(retain(409,false),false);
 }
});

test('completed and voided orders cannot resume inquiry or pricing even when ownership is writable',()=>{
 for(const status of ['completed','voided'])assert.equal(canManageOrder({status,writable:true}),false);
 assert.equal(canManageOrder({status:'quote_draft',writable:false}),false);
 assert.equal(canManageOrder({status:'quote_draft',writable:true}),true);
});
test('pricing save keeps public line remarks separate from private loss reasons',()=>{
 const lines=[{purchaseLineId:'line',baseSupplierQuoteLineId:null,selectionMode:'auto' as const,markupMethod:null,parameterValue:null,finalPrice:'10.00',finalConfirmed:true,lossReason:'内部低价审批',publicRemark:'医院可见备注'}];
 const input=pricingInputs(lines)[0];
 assert.equal(input.publicRemark,'医院可见备注');assert.equal(input.lossReason,'内部低价审批');
 assert.equal(pricingInputs([{...lines[0],publicRemark:undefined}])[0].publicRemark,'');
});

test('recovered export acceptance asks to check file generation rather than claiming task success',()=>{
 const operation=recordOperation('key','导出报价 PDF','/quotes/quote-id/versions/version-id/export','POST',{});
 const notice=committedOperationNotice(operation);
 assert.match(notice,/已受理/);assert.match(notice,/核对文件生成结果/);assert.doesNotMatch(notice,/成功/);
 assert.match(committedOperationNotice({...operation,path:'/sales/purchase-orders'}),/操作已成功/);
});
