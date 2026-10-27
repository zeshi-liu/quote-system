import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryActions, deliveryDocumentPresentation, deliveryTotal, formatShanghaiTimestamp, exportJobPresentation, resolveDownloadUrl, resolveExportJob, shanghaiDateTimeToIso, shanghaiNowParts } from './delivery-domain';

test('hospital confirmation date and time are interpreted in Shanghai, independent of device timezone',()=>{
 assert.equal(shanghaiDateTimeToIso('2026-10-23','16:35'),'2026-10-23T08:35:00.000Z');
 assert.equal(shanghaiDateTimeToIso('2026-10-23','16:35:48'),'2026-10-23T08:35:48.000Z');
 assert.equal(shanghaiDateTimeToIso('2026-01-01','00:00'),'2025-12-31T16:00:00.000Z');
 assert.equal(shanghaiDateTimeToIso('2024-02-29','23:59'),'2024-02-29T15:59:00.000Z');
});
test('confirmation date and time reject impossible or ambiguous calendar values',()=>{
 for(const [date,time] of [['2026-02-29','12:00'],['2026-04-31','12:00'],['2026-13-01','12:00'],['2026-10-23','24:00'],['2026-10-23','12:60'],['2026-10-23','12:00:60'],['2026-10-23',''],['2026-1-01','09:00'],['','09:00']])assert.throws(()=>shanghaiDateTimeToIso(date,time),date+' '+time);
});
test('all missing total remains inapplicable rather than becoming zero',()=>{
 assert.equal(deliveryTotal(null,true),'不适用（全部缺货）');
 assert.equal(deliveryTotal(null,false),'待完成计价');
 assert.equal(deliveryTotal('0.00'),'¥ 0.00');
 assert.equal(deliveryTotal('120.50'),'¥ 120.50');
});
test('queued, running, failed and unknown export results never claim a successful file',()=>{
 for(const state of ['queued','running','failed','unknown',null])assert.equal(exportJobPresentation(state).success,false,String(state));
 assert.equal(exportJobPresentation('succeeded').success,true);
 assert.match(exportJobPresentation('queued').label,/排队/);
 assert.match(exportJobPresentation('running').label,/生成/);
 assert.match(exportJobPresentation(null).label,/核对/);
});
test('unwritable, pending, occupied and historical versions disable delivery writes',()=>{
 const current={writable:true,locked:false,current:true,occupied:false,eligible:true,status:'sent',hasFiles:true,hasDraft:false} as const;
 assert.equal(deliveryActions(current).confirm,true);
 for(const guard of [{writable:false},{locked:true},{current:false},{occupied:true}]){
  const result=deliveryActions({...current,...guard});
  assert.deepEqual(Object.values(result),[false,false,false,false,false,false]);
 }
});
test('expired sent versions permit actual confirmation backfill but prevent new exports and sends',()=>{
 const actions=deliveryActions({writable:true,locked:false,current:true,occupied:false,eligible:false,status:'sent',hasFiles:true,hasDraft:false});
 assert.equal(actions.export,false);assert.equal(actions.send,false);assert.equal(actions.confirm,true);assert.equal(actions.next,true);
 const draft=deliveryActions({writable:true,locked:false,current:true,occupied:false,eligible:true,status:'draft',hasFiles:false,hasDraft:true});
 assert.equal(draft.edit,true);assert.equal(draft.send,false);assert.equal(draft.confirm,false);assert.equal(draft.next,false);
});

test('local download tickets resolve against the API origin without duplicating its API prefix',()=>{
 assert.equal(resolveDownloadUrl('/api/v1/files/download/ticket','http://127.0.0.1:3000/api/v1'),'http://127.0.0.1:3000/api/v1/files/download/ticket');
 assert.equal(resolveDownloadUrl('https://private.cos.example/file?signature=value','https://api.example/api/v1'),'https://private.cos.example/file?signature=value');
 assert.equal(resolveDownloadUrl('/api/v1/files/download/ticket','/api/v1'),'/api/v1/files/download/ticket');
 for(const url of ['javascript:alert(1)','data:text/html,bad','//evil.example/file','/\\evil.example/file','https://user:pass@evil.example/file','https://'])assert.throws(()=>resolveDownloadUrl(url,'/api/v1'),url);
});

test('current Beijing shortcut preserves seconds and handles the UTC date boundary',()=>{
 assert.deepEqual(shanghaiNowParts(Date.parse('2026-10-23T16:35:48.250Z')),{date:'2026-10-24',time:'00:35:48'});
});
test('an export occupying another version in the same quote blocks creation of a new version',()=>{
 const actions=deliveryActions({writable:true,locked:false,current:true,occupied:false,quoteOccupied:true,eligible:true,status:'sent',hasFiles:true,hasDraft:false});
 assert.equal(actions.next,false);assert.equal(actions.confirm,true);
});
test('a void current version can seed a new draft without reactivating its content',()=>{
 const current={writable:true,locked:false,current:true,occupied:false,quoteOccupied:false,eligible:false,status:'void',hasFiles:false,hasDraft:false};
 const actions=deliveryActions(current);
 assert.equal(actions.next,true);
 assert.deepEqual([actions.edit,actions.export,actions.send,actions.confirm,actions.void],[false,false,false,false,false]);
 for(const guard of [{current:false},{writable:false},{locked:true},{occupied:true},{quoteOccupied:true},{hasDraft:true}])assert.equal(deliveryActions({...current,...guard}).next,false,JSON.stringify(guard));
});

test('historical confirmation, record and invalidation timestamps retain seconds in Beijing time',()=>{
 assert.equal(formatShanghaiTimestamp('2026-10-23T16:35:48.250Z'),'2026-10-24 00:35:48 北京时间');
 assert.equal(formatShanghaiTimestamp(null),'—');
});

test('server latest jobs restore queued, running and failed states without a local task reference',async()=>{
 for(const state of ['queued','running','failed'] as const){
  const serverJob={id:'server-job',orderId:'order-id',versionId:'version-id',state,attempts:2,error:state==='failed'?'生成文件超时':null,fileId:null,retryAt:null};
  const restored=await resolveExportJob({id:'version-id',latestJob:serverJob},undefined,async()=>{throw new Error('Server task must not need a local reference');});
  assert.deepEqual(restored,serverJob);assert.equal(exportJobPresentation(restored?.state||null).success,false);
  if(state==='failed')assert.equal(restored?.error,'生成文件超时');
 }
});
test('an explicit server null task supersedes a stale local reference, while an omitted field supports older APIs',async()=>{
 let calls=0;const oldJob={id:'local-job',orderId:'order-id',versionId:'version-id',state:'succeeded' as const,attempts:1,error:null,fileId:'file-id',retryAt:null};
 const fetchJob=async(id:string)=>{calls++;assert.equal(id,'local-job');return oldJob;};
 assert.equal(await resolveExportJob({id:'version-id',latestJob:null},'local-job',fetchJob),null);assert.equal(calls,0);
 assert.deepEqual(await resolveExportJob({id:'version-id'},'local-job',fetchJob),oldJob);assert.equal(calls,1);
 assert.equal(await resolveExportJob({id:'version-id'},undefined,fetchJob),null);assert.equal(calls,1);
});

test('unpriced supply lines remain an unfinished quotation rather than all missing',()=>{
 const view=deliveryDocumentPresentation({total:null,validUntil:null,lines:[{status:'priced',unitPrice:null,amount:null}]});
 assert.equal(view.allMissing,false);assert.equal(view.totalLabel,'待完成计价');assert.equal(view.validityLabel,'待设置/核对有效期');
});
test('a partially priced mixed draft marks its saved sum as provisional',()=>{
 const view=deliveryDocumentPresentation({total:'20.00',validUntil:null,lines:[{status:'priced',unitPrice:'10.00',amount:'20.00'},{status:'priced',unitPrice:null,amount:null},{status:'missing',unitPrice:null,amount:null}]});
 assert.equal(view.allMissing,false);assert.equal(view.totalLabel,'草稿暂计 ¥ 20.00（待完善）');assert.equal(view.validityLabel,'待设置/核对有效期');
});
test('all missing documents alone use the inapplicable amount and validity labels',()=>{
 const view=deliveryDocumentPresentation({total:null,validUntil:null,lines:[{status:'missing',unitPrice:null,amount:null}]});
 assert.equal(view.allMissing,true);assert.equal(view.totalLabel,'不适用（全部缺货）');assert.equal(view.validityLabel,'不适用（全部缺货）');
 assert.equal(deliveryDocumentPresentation({total:null,validUntil:null,lines:[]}).allMissing,false);
});
test('a zero decimal total and completed priced document keep their numerical meaning',()=>{
 const view=deliveryDocumentPresentation({total:'0.00',validUntil:'2026-10-24',lines:[{status:'priced',unitPrice:'0.00',amount:'0.00'}]});
 assert.equal(view.allMissing,false);assert.equal(view.totalLabel,'¥ 0.00');assert.equal(view.validityLabel,'2026-10-24（含当天，北京时间）');
 const normal=deliveryDocumentPresentation({total:'120.50',validUntil:'2026-10-24',lines:[{status:'priced',unitPrice:'120.50',amount:'120.50'}]});
 assert.equal(normal.totalLabel,'¥ 120.50');
});
