import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BusinessOperations} from './business-pending';
function storage(){const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
test('PC 写入结果未知、刷新和未找到回执仍保留同一输入及 key，核实正确回执后才能清除',async()=>{
 const s=storage(),calls:any[]=[];let committed=false;
 const read=async<T>()=>({status:committed?'committed':'not_found',...(committed?{result:{id:'order-a',version:2,status:'draft',revisionId:'r1',lines:[]}}:{})}) as T;
 const write=async<T>(path:string,method:string,body:unknown,key:string)=>{calls.push({path,method,body,key});throw new Error('网络中断');};
 const first=new BusinessOperations('a',read,write,s,()=> 'original-key');
 await assert.rejects(()=>first.mutate('保存采购单','/sales/purchase-orders/order-a/revisions/r1/lines','PUT',{expectedVersion:1,lines:[{name:'黄芪'}]}));
 const reload=new BusinessOperations('a',read,write,s);assert.equal(await reload.check(),'not_found');
 await assert.rejects(()=>reload.retry());assert.deepEqual(calls[0],calls[1]);
 await assert.rejects(()=>reload.mutate('另一操作','/sales/purchase-orders', 'POST',{}));
 committed=true;assert.equal(await reload.check(),'committed');assert.equal(reload.pending,null);
});
test('PC 无关订单的回执不能清掉原操作，后续核实仍使用原键',async()=>{
 const s=storage();const p=new BusinessOperations('a',async<T>()=>({status:'committed',result:{id:'order-b'}}) as T,async<T>()=>({id:'order-b'}) as T,s,()=> 'keep-me');
 await assert.rejects(()=>p.mutate('冻结','/sales/purchase-orders/order-a/revisions/r1/freeze','POST',{expectedVersion:1}));
 await assert.rejects(()=>p.check());assert.equal(p.pending?.key,'keep-me');
});
test('明确业务拒绝允许修正重新提交，401/403/404及服务器未知仍保留；待核实资料按账号隔离',async()=>{
 const s=storage();for(const status of [400,409,422]){const p=new BusinessOperations('a'+status,async<T>()=>({}) as T,async()=>{throw Object.assign(new Error('拒绝'),{status});},s);await assert.rejects(()=>p.mutate('保存','/sales/purchase-orders','POST',{}));assert.equal(p.pending,null);}
 for(const status of [401,403,404,500]){const p=new BusinessOperations('a'+status,async<T>()=>({}) as T,async()=>{throw Object.assign(new Error('未知'),{status});},s);await assert.rejects(()=>p.mutate('保存','/sales/purchase-orders','POST',{}));assert.ok(p.pending);}
 assert.equal(new BusinessOperations('other',async<T>()=>({}) as T,async<T>()=>({}) as T,s).pending,null);
});
test('新建回执核对医院、采购员与接收日期，损坏本机记录拒绝静默丢弃',async()=>{
 const s=storage(),p=new BusinessOperations('a',async<T>()=>({}) as T,async<T>()=>({id:'new',hospitalId:'wrong',purchaserUserId:'p',receivedDate:'2026-10-26'}) as T,s);
 await assert.rejects(()=>p.mutate('新建','/sales/purchase-orders','POST',{hospitalId:'h',purchaserUserId:'p',receivedDate:'2026-10-26',lines:[]}));assert.ok(p.pending);
 s.setItem('quote-pc-business-pending-b','corrupted');assert.throws(()=>new BusinessOperations('b',async<T>()=>({}) as T,async<T>()=>({}) as T,s));
});
test('本机持久保存失败时不发请求、不留下可直接重试的未持久操作',async()=>{let calls=0;const s={getItem:()=>null,setItem(){throw new Error('存储空间不足');},removeItem(){}};const p=new BusinessOperations('a',async<T>()=>({}) as T,async<T>()=>{calls++;return {} as T;},s);await assert.rejects(()=>p.mutate('保存','/sales/purchase-orders','POST',{}));assert.equal(calls,0);assert.equal(p.pending,null);await assert.rejects(()=>p.retry());assert.equal(calls,0);});
test('同单锁繁忙返回409仍保留原键和原文，避免将可能仍在执行的操作当作明确拒绝',async()=>{const s=storage(),p=new BusinessOperations('busy',async<T>()=>({status:'not_found'}) as T,async()=>{throw Object.assign(new Error('同单锁繁忙'),{status:409,code:'BUSY_RETRY_REQUIRED'});},s,()=> 'busy-original');await assert.rejects(()=>p.mutate('登记','/sales/purchase-orders','POST',{hospitalId:'h'}));assert.equal(p.pending?.key,'busy-original');assert.equal(await p.check(),'not_found');assert.equal(JSON.parse(s.getItem('quote-pc-business-pending-busy')!).body.hospitalId,'h');});
test('独立复核快照随原键持久保存，重试只发送原业务body且不带metadata',async()=>{const s=storage(),sent:any[]=[],metadata={handoff:{from:'a',to:'b',orderIds:['o1']}},body={previewToken:'short-token'};const p=new BusinessOperations('meta',async<T>()=>({status:'not_found'}) as T,async<T>(path,method,value,key)=>{sent.push({path,method,value,key});throw new Error('断网');},s,()=> 'metadata-key');await assert.rejects(()=>p.mutate('交接','/admin/handoffs/execute','POST',body,metadata));metadata.handoff.orderIds.push('tampered');assert.deepEqual(p.pending?.metadata,{handoff:{from:'a',to:'b',orderIds:['o1']}});const reloaded=new BusinessOperations('meta',async<T>()=>({status:'not_found'}) as T,async<T>(path,method,value,key)=>{sent.push({path,method,value,key});throw new Error('断网');},s);await assert.rejects(()=>reloaded.retry());assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[0].value,body);assert.deepEqual(reloaded.pending?.metadata,{handoff:{from:'a',to:'b',orderIds:['o1']}});});
test('正确的新建回执可按原键交回界面，恢复后能打开原采购单而不重复新建',async()=>{const s=storage(),receipt={id:'created-order',version:1,status:'draft',hospitalId:'h',purchaserUserId:'p',receivedDate:'2026-10-26'},op=new BusinessOperations('created',async<T>()=>({status:'committed',result:receipt}) as T,async()=>{throw new Error('响应未知');},s,()=> 'create-original');await assert.rejects(()=>op.mutate('新建采购单','/sales/purchase-orders','POST',{hospitalId:'h',purchaserUserId:'p',receivedDate:'2026-10-26',lines:[]}));assert.equal(await op.check(),'committed');assert.equal(op.pending,null);assert.deepEqual(op.resultFor('create-original'),receipt);assert.equal(op.resultFor('other-key'),undefined);});
test('迟到回执不清除另一个标签页后来保存的待核实记录',async()=>{const s=storage();let release!:(value:any)=>void,started!:()=>void;const writing=new Promise<void>(r=>started=r);const p=new BusinessOperations('tabs',async<T>()=>({status:'not_found'}) as T,async<T>()=>new Promise<T>(r=>{release=r;started();}),s,()=> 'old-key'),body={hospitalId:'h',purchaserUserId:'p',receivedDate:'2026-10-26',lines:[]};const result=p.mutate('新建','/sales/purchase-orders','POST',body),other={key:'new-key',label:'另一标签页',method:'POST',path:'/sales/purchase-orders',body};await writing;s.setItem('quote-pc-business-pending-tabs',JSON.stringify(other));release({id:'original-order',status:'draft',version:1,...body});await assert.rejects(result,/标签页|变化/);assert.deepEqual(JSON.parse(s.getItem('quote-pc-business-pending-tabs')!),other);});
test('预先打开的第二标签页不能覆盖第一标签页结果未知的原操作',async()=>{
 const s=storage(),body={hospitalId:'h',purchaserUserId:'p',receivedDate:'2026-10-26',lines:[]};let writes=0;
 const read=async<T>()=>({status:'not_found'}) as T,write=async<T>()=>{writes++;throw new Error('响应丢失');};
 const first=new BusinessOperations('multi',read,write,s,()=> 'first-original'),second=new BusinessOperations('multi',read,write,s,()=> 'second-new');
 await assert.rejects(()=>first.mutate('新建原订单','/sales/purchase-orders','POST',body));
 await assert.rejects(()=>second.mutate('另一订单','/sales/purchase-orders','POST',{...body,receivedDate:'2026-10-25'}),/标签页|核实/);
 assert.equal(writes,1);assert.equal(JSON.parse(s.getItem('quote-pc-business-pending-multi')!).key,'first-original');
 assert.equal(second.pending?.key,'first-original');assert.deepEqual(second.pending?.body,body);
});
test('同时提交的两页面在持久占用锁内复查，只派发第一个原操作',async()=>{
 const s=storage();let chain=Promise.resolve(),writes=0;const names:string[]=[];
 const lock=async<T>(name:string,action:()=>T)=>{names.push(name);const old=chain;let release!:()=>void;chain=new Promise<void>(r=>release=r);await old;try{return action();}finally{release();}};
 const read=async<T>()=>({status:'not_found'}) as T,write=async<T>()=>{writes++;throw new Error('响应未知');},body={hospitalId:'h',purchaserUserId:'p',receivedDate:'2026-10-26'};
 const a=new BusinessOperations('simultaneous',read,write,s,()=> 'a',lock),b=new BusinessOperations('simultaneous',read,write,s,()=> 'b',lock);
 const results=await Promise.allSettled([a.mutate('新建A','/sales/purchase-orders','POST',body),b.mutate('新建B','/sales/purchase-orders','POST',body)]);
 assert.equal(results.every(r=>r.status==='rejected'),true);assert.equal(writes,1);assert.deepEqual(names,['quote-pc-business-pending-simultaneous','quote-pc-business-pending-simultaneous']);assert.equal(a.pending?.key,'a');assert.equal(b.pending?.key,'a');
});
test('无法取得页面锁时拒绝新写入并保留已有持久资料',async()=>{
 const s=storage();let writes=0;const op=new BusinessOperations('lock-failure',async<T>()=>({}) as T,async<T>()=>{writes++;return {} as T;},s,()=> 'never-sent',async()=>{throw new Error('页面锁不可用');});
 await assert.rejects(()=>op.mutate('新建','/sales/purchase-orders','POST',{}),/页面锁/);assert.equal(writes,0);assert.equal(s.getItem('quote-pc-business-pending-lock-failure'),null);assert.equal(op.pending,null);
});
