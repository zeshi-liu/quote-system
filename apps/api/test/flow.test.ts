import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import {offlineSocketOptions} from '../../../scripts/pglite-options';
import { Database } from '../src/db/database';
import { createApp } from '../src/app';
import { seedTrial } from '../../../scripts/seed-trial';
import { AuthService, newSecret, secretHash } from '../src/auth/auth';

let pg: EmbeddedPostgres, db: Database, app: Awaited<ReturnType<typeof createApp>>, dir: string, base: string, token: string, seed: any;
let now = new Date('2026-10-22T02:00:00Z');
let wasm:PGlite|undefined,wasmServer:PGLiteSocketServer|undefined;
let externalAdmin:Database|undefined,testSchema:string|undefined;
const password = 'trial-test-only-12345';
async function request(path: string, method='GET', body?: unknown, auth=token, key=randomUUID()) {
  const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),'Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result = await response.json() as any;
  return {status:response.status,...result};
}
async function ok(path: string, method='GET', body?: unknown, auth=token, key=randomUUID()) {
  const r=await request(path,method,body,auth,key);assert.ok(r.status<300,JSON.stringify(r));return r.data;
}
async function order() {
  return ok('/sales/purchase-orders','POST',{hospitalId:seed.hospitalId,purchaserUserId:seed.purchaserId,receivedDate:'2026-10-21',lines:[{name:'黄芪',spec:'斜片',quantity:'12.50',checked:true},{name:'党参',spec:'',quantity:'20.00',checked:true}]});
}
async function freeze(o:any) { return ok(`/sales/purchase-orders/${o.id}/revisions/${o.revisionId}/freeze`,'POST',{expectedVersion:o.version}); }
async function task(o:any,slotNo:number) {return ok(`/sales/purchase-order-revisions/${o.revisionId}/supplier-tasks`,'POST',{expectedVersion:o.version,slotNo,manufacturerId:seed.manufacturerIds[slotNo-1]});}
async function link(o:any,slot:number) {return ok(`/supplier-tasks/${o.tasks.find((t:any)=>t.slotNo===slot).id}/generate-link`,'POST',{expectedVersion:o.version});}
async function supplier(l:any) {
 const raw=new URL(l.url).hash.slice(7);return (await ok('/supplier/session','POST',{token:decodeURIComponent(raw)},'')).sessionToken;
}
async function submit(o:any,auth:string,first='26.50',second:string|null=null) {
 return ok('/supplier/quote','POST',{validUntil:'2026-10-25',lines:o.lines.map((l:any,i:number)=>({purchaseLineId:l.id,status:(i===0?first:second)===null?'unavailable':'quoted',unitPrice:i===0?first:second}))},auth);
}
before(async()=>{
 process.env.LC_ALL='C';
 dir=await mkdtemp(join(tmpdir(),'quote-core-test-'));
 if(process.env.TEST_DB_MODE==='pglite'){
  wasm=await PGlite.create(join(dir,'wasm'));wasmServer=new PGLiteSocketServer({db:wasm,port:25439,...offlineSocketOptions});await wasmServer.start();db=new Database('postgresql://postgres:postgres@127.0.0.1:25439/postgres',1);
 }else if(process.env.TEST_DATABASE_URL){
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.pathname,'/quote_core_test','外部集成测试只允许专用 quote_core_test 数据库');
  externalAdmin=new Database(process.env.TEST_DATABASE_URL);testSchema='core_test_'+randomUUID().replaceAll('-','');await externalAdmin.query('CREATE SCHEMA "'+testSchema+'"');db=new Database(process.env.TEST_DATABASE_URL,8,testSchema);
 }else{
 const startupLog:string[]=[];
 pg=new EmbeddedPostgres({databaseDir:join(dir,'pg'),port:25439,user:'postgres',password:'local-test-postgres',persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-c','lc_messages=C','-c','lc_monetary=C','-c','lc_numeric=C','-c','lc_time=C'],onLog:message=>startupLog.push(message),onError:error=>console.error('postgres:',error)});
 await pg.initialise();try{await pg.start();}catch{throw new Error(startupLog.join('').slice(-5000));}
 db=new Database('postgresql://postgres:local-test-postgres@127.0.0.1:25439/postgres');
 }
 await db.migrate();
 seed=await seedTrial(db,password);
 app=await createApp({databaseUrl:'',supplierWebUrl:'http://localhost:5174',trialPasswordLogin:true,production:false,wechatAppId:'',wechatAppSecret:'',allowedOrigins:[]},db,()=>now);
 await app.listen(0,'127.0.0.1');base=(await app.getUrl())+'/api/v1';
 token=(await ok('/auth/trial/password-login','POST',{loginName:'trial.sales',password},'')).token;
});
after(async()=>{await app?.close();await db?.close();if(externalAdmin&&testSchema){await externalAdmin.query('DROP SCHEMA "'+testSchema+'" CASCADE');await externalAdmin.close();}await wasmServer?.stop();await wasm?.close();await pg?.stop();if(dir)await rm(dir,{recursive:true,force:true});});
test('真实账号、微信未配置、权限与采购冻结校验',async()=>{
 assert.equal((await request('/auth/miniapp/login','POST',{loginCode:'fake-code'},'')).error.code,'WECHAT_NOT_CONFIGURED');
 assert.equal((await request('/sales/purchase-orders','GET',undefined,'')).status,401);
 const invalid=await request('/sales/purchase-orders','POST',{hospitalId:seed.hospitalId,purchaserUserId:seed.purchaserId,receivedDate:'2026-10-23',lines:[{name:'黄芪',spec:'',quantity:'0.001',checked:true}]});assert.equal(invalid.status,400);
 let o=await order();assert.equal(o.paymentTermDays,90);o=await freeze(o);
 assert.equal((await request(`/sales/purchase-orders/${o.id}/revisions/${o.revisionId}/lines`,'PUT',{expectedVersion:o.version,lines:o.lines.map(({unit,...line}:any)=>line)})).status,409);
 const alien=await db.query("INSERT INTO users(login_name,name,role) VALUES('alien','其他销售','salesperson') RETURNING id");
 await db.query('UPDATE hospitals SET sales_user_id=$1 WHERE id=$2',[alien.rows[0].id,seed.hospitalId]);
 assert.equal((await ok(`/sales/purchase-orders/${o.id}`)).writable,true);
 assert.equal((await request('/sales/purchase-orders','POST',{hospitalId:seed.hospitalId,purchaserUserId:seed.purchaserId,receivedDate:'2026-10-21',lines:[{name:'黄芪',spec:'',quantity:'1',checked:true}]})).status,403);
 await db.query('UPDATE hospitals SET sales_user_id=$1 WHERE id=$2',[seed.salesId,seed.hospitalId]);
});
test('采购→两家H5→比价→计价保存，后到价仅主动采用，重询立即使旧基准失效',async()=>{
 let o=await freeze(await order());o=await task(o,1);o=await task(o,2);
 const la=await link(o,1);o=await ok(`/sales/purchase-orders/${o.id}`);const lb=await link(o,2);
 const sa=await supplier(la),sb=await supplier(lb);
 const form=await ok('/supplier/quote','GET',undefined,sa);assert.equal(form.lines.length,2);assert.equal('hospitalName' in form,false);assert.equal('tasks' in form,false);
 const incomplete=await request('/supplier/quote','POST',{validUntil:'2026-10-25',lines:[]},sa);assert.equal(incomplete.status,400);
 await submit(o,sa);o=await ok(`/sales/purchase-orders/${o.id}`);
 assert.equal((await request(`/sales/purchase-orders/${o.id}/enter-pricing`,'POST',{expectedVersion:o.version,allowEarly:false})).status,409);
 let d=await ok(`/sales/purchase-orders/${o.id}/enter-pricing`,'POST',{expectedVersion:o.version,allowEarly:true});assert.equal(d.lines[0].basePrice,'26.50');assert.equal(d.lines[1].kind,'blocked');
 const edit=()=>d.lines.map((l:any)=>({purchaseLineId:l.purchaseLineId,baseSupplierQuoteLineId:l.baseSupplierQuoteLineId,selectionMode:l.selectionMode,markupMethod:l.basePrice?'fixed':null,parameterValue:l.basePrice?'3.00':null,finalPrice:l.basePrice?'29.50':null,finalConfirmed:!!l.basePrice,lossReason:''}));
 d=await ok(`/quotes/${d.quoteId}/versions/${d.id}/draft`,'PATCH',{expectedVersion:d.version,hospitalValidUntil:'2026-10-25',lines:edit()});assert.equal(d.lines[0].recommendedPrice,'29.50');
 await submit(o,sb,'25.80',null);
 let unchanged=await ok(`/sales/purchase-orders/${o.id}/draft`);assert.equal(unchanged.lines[0].basePrice,'26.50');assert.equal(unchanged.lines[0].finalPrice,'29.50');
 assert.equal(unchanged.lines[1].kind,'blocked','后到缺货结果不能自动改变草稿已采用结论');
 const comparison=await ok(`/sales/purchase-orders/${o.id}/comparison`);assert.equal(comparison.lines[0].lowestPrice,'25.80');assert.equal(comparison.lines[1].kind,'missing');
 d=await ok(`/quotes/${d.quoteId}/versions/${d.id}/adopt-latest-supplier-quotes`,'POST',{expectedVersion:unchanged.version});assert.equal(d.lines[0].basePrice,'25.80');assert.equal(d.lines[0].finalPrice,'29.50');assert.equal(d.lines[0].finalConfirmed,false);
 o=await ok(`/sales/purchase-orders/${o.id}`);const b=o.tasks.find((t:any)=>t.slotNo===2);
 await ok(`/supplier-tasks/${b.id}/requote`,'POST',{expectedVersion:o.version,expectedSubmissionId:b.submissionId,reason:'厂家核对后重报'});
 d=await ok(`/sales/purchase-orders/${o.id}/draft`);assert.equal(d.lines[0].baseValid,false);assert.equal(d.lines[0].finalPrice,'29.50');assert.equal(d.readyForNextStep,false);
 d=await ok(`/quotes/${d.quoteId}/versions/${d.id}/draft`,'PATCH',{expectedVersion:d.version,hospitalValidUntil:d.hospitalValidUntil,lines:edit().map((l:any)=>({...l,parameterValue:l.markupMethod?'5.00':null,finalConfirmed:false}))});assert.equal(d.lines[0].recommendedPrice,null,'失效基准不得生成新的推荐价');
 assert.equal((await request('/supplier/quote','GET',undefined,sb)).status,410);
});
test('幂等不重复创建；重放链接仅元信息；旧链接/会话立即失效；冻结行在数据库不可改',async()=>{
 const key=randomUUID(),input={hospitalId:seed.hospitalId,purchaserUserId:seed.purchaserId,receivedDate:'2026-10-21',lines:[{name:'白术',spec:'',quantity:'1',checked:true}]};
 const [a,b]=await Promise.all([ok('/sales/purchase-orders','POST',input,token,key),ok('/sales/purchase-orders','POST',input,token,key)]);assert.equal(a.id,b.id);
 assert.equal((await request('/sales/purchase-orders','POST',{...input,receivedDate:'2026-10-20'},token,key)).status,409);
 let o=await task(await freeze(a),1);const t=o.tasks[0],k=randomUUID();const l=await ok(`/supplier-tasks/${t.id}/generate-link`,'POST',{expectedVersion:o.version},token,k);
 const replay=await ok(`/supplier-tasks/${t.id}/generate-link`,'POST',{expectedVersion:o.version},token,k);assert.equal(replay.linkId,l.linkId);assert.equal(replay.url,undefined);assert.equal(replay.originalUnavailable,true);
 const s=await supplier(l);o=await ok(`/sales/purchase-orders/${o.id}`);
 await ok(`/supplier-tasks/${t.id}/regenerate-link`,'POST',{expectedVersion:o.version,expectedLinkId:l.linkId,reason:'原链接已关闭'});
 assert.equal((await request('/supplier/quote','GET',undefined,s)).status,410);
 await assert.rejects(()=>db.query('UPDATE purchase_order_lines SET quantity=2 WHERE id=$1',[o.lines[0].id]));
 const draft=await order();await assert.rejects(()=>db.query('UPDATE purchase_order_lines SET revision_id=$2,position=99 WHERE id=$1',[o.lines[0].id,draft.revisionId]),'冻结行不能通过迁移到草稿修订绕过保护');
});
test('厂家并发提交只记一次；报价有效期与链接48小时分别校验',async()=>{
 let o=await task(await freeze(await order()),1);const l=await link(o,1),s=await supplier(l);
 const key=randomUUID(),body={validUntil:'2026-10-25',lines:o.lines.map((x:any)=>({purchaseLineId:x.id,status:'quoted',unitPrice:'1.00'}))};
 const [a,b]=await Promise.all([ok('/supplier/quote','POST',body,s,key),ok('/supplier/quote','POST',body,s,key)]);assert.equal(a.submitted.id,b.submitted.id);
 const originalToken=token;
 now=new Date('2026-10-24T02:00:00Z');token=(await ok('/auth/trial/password-login','POST',{loginName:'trial.sales',password},'')).token;assert.equal((await request('/supplier/quote','GET',undefined,s)).status,410);
 assert.equal((await ok(`/sales/purchase-orders/${o.id}/comparison`)).submittedCount,1);
 now=new Date('2026-10-26T00:00:00Z');token=(await ok('/auth/trial/password-login','POST',{loginName:'trial.sales',password},'')).token;const c=await ok(`/sales/purchase-orders/${o.id}/comparison`);assert.equal(c.submittedCount,0);assert.equal(c.lines[0].kind,'blocked');
 now=new Date('2026-10-22T02:00:00Z');token=originalToken;
});
test('锁等待跨午夜后必须再次校验厂家有效至日',async()=>{
 let o=await task(await freeze(await order()),1);const l=await link(o,1),s=await supplier(l);
 const held=await db.pool.connect();now=new Date('2026-10-22T15:59:59Z');
 if(process.env.TEST_DB_MODE!=='pglite'){await held.query('BEGIN');await held.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE',[o.id]);}
 const pending=request('/supplier/quote','POST',{validUntil:'2026-10-22',lines:o.lines.map((x:any)=>({purchaseLineId:x.id,status:'quoted',unitPrice:'1.00'}))},s);
 const start=Date.now();let waiting=false;
 while(!waiting&&Date.now()-start<3000){waiting=process.env.TEST_DB_MODE==='pglite'?db.pool.waitingCount>0:!!(await db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%purchase_orders%FOR UPDATE%' AND pid<>pg_backend_pid()")).rowCount;if(!waiting)await new Promise<void>(resolve=>setImmediate(resolve));}
 now=new Date('2026-10-22T16:00:00Z');if(process.env.TEST_DB_MODE!=='pglite')await held.query('ROLLBACK');held.release();assert.ok(waiting,'提交须实际进入连接/根锁等待');
 try{const result=await pending;assert.equal(result.status,400);assert.equal((await ok('/supplier/quote','GET',undefined,s)).submitted,null);}finally{now=new Date('2026-10-22T02:00:00Z');}
});
test('业务交接后创建请求和链接操作回执不可绕过当前读取权限',async()=>{
 const input={hospitalId:seed.hospitalId,purchaserUserId:seed.purchaserId,receivedDate:'2026-10-21',lines:[{name:'白芍',spec:'',quantity:'1',checked:true}]},k=randomUUID();
 const o=await ok('/sales/purchase-orders','POST',input,token,k);let linked=await task(await freeze(await order()),1);const lk=randomUUID();await ok(`/supplier-tasks/${linked.tasks[0].id}/generate-link`,'POST',{expectedVersion:linked.version},token,lk);
 const alien=(await db.query("INSERT INTO users(login_name,name,role) VALUES('handoff','新负责销售','salesperson') RETURNING id")).rows[0].id;
 await db.query('UPDATE purchase_orders SET sales_user_id=$1 WHERE id=ANY($2::uuid[])',[alien,[o.id,linked.id]]);await db.query('UPDATE hospitals SET sales_user_id=$1 WHERE id=$2',[alien,seed.hospitalId]);
 try{assert.equal((await request('/sales/purchase-orders','POST',input,token,k)).status,404);assert.equal((await request('/operations/'+lk)).status,404);}finally{await db.query('UPDATE hospitals SET sales_user_id=$1 WHERE id=$2',[seed.salesId,seed.hospitalId]);}
});
test('旧厂家入口等待根锁期间被撤销，读表单和交换会话均须拒绝',async()=>{
 let o=await task(await freeze(await order()),1);const l=await link(o,1),s=await supplier(l),raw=decodeURIComponent(new URL(l.url).hash.slice(7));
 const held=await db.pool.connect();await held.query('BEGIN');await held.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE',[o.id]);
 const read=request('/supplier/quote','GET',undefined,s),exchange=request('/supplier/session','POST',{token:raw},'');
 let waiting=false;const start=Date.now();
 while(!waiting&&Date.now()-start<3000){waiting=process.env.TEST_DB_MODE==='pglite'?db.pool.waitingCount>=2:Number((await db.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%purchase_orders%FOR SHARE%' AND pid<>pg_backend_pid()")).rows[0].count)>=2;if(!waiting)await new Promise<void>(resolve=>setImmediate(resolve));}
 try{await held.query("UPDATE supplier_links SET status='revoked' WHERE id=$1",[l.linkId]);await held.query('COMMIT');}finally{held.release();}
 assert.ok(waiting,'两个旧入口须实际进入根锁/连接等待');
 const responses=await Promise.all([read,exchange]);assert.deepEqual(responses.map(r=>r.status),[410,410]);
});
test('绑定凭证一次性、冲突与过期拒绝，撤销或停用后会话失效',async()=>{
 const auth=new AuthService(db,{databaseUrl:'',supplierWebUrl:'',trialPasswordLogin:true,production:false,wechatAppId:'test-app',wechatAppSecret:'unused-test-secret',allowedOrigins:[]},()=>now);
 const ticket=async(openId:string,expired=false)=>{const raw=newSecret();await db.query('INSERT INTO bind_tickets(token_hash,app_id,open_id,expires_at) VALUES($1,$2,$3,$4)',[secretHash(raw),'test-app',openId,new Date(now.getTime()+(expired?-1:600000))]);return raw;};
 const first=await ticket('test-open-id'),bound=await auth.bindSales({bindTicket:first,loginName:'trial.sales',password},'binding-test');
 assert.equal(bound.user.id,seed.salesId);assert.equal(bound.channel,'mini');
 await assert.rejects(()=>auth.bindSales({bindTicket:first,loginName:'trial.sales',password},'binding-test'),(e:any)=>e.code==='BIND_TICKET_INVALID');
 const expired=await ticket('expired-test-open-id',true);await assert.rejects(()=>auth.bindSales({bindTicket:expired,loginName:'trial.sales',password},'binding-test'),(e:any)=>e.code==='BIND_TICKET_INVALID');
 const clash=await ticket('different-test-open-id');await assert.rejects(()=>auth.bindSales({bindTicket:clash,loginName:'trial.sales',password},'binding-test'),(e:any)=>e.code==='IDENTITY_BINDING_CONFLICT');
 const actor=await auth.authenticate(bound.token);await auth.logout(actor);assert.equal((await request('/sales/bootstrap','GET',undefined,bound.token)).status,401);
 const second=await auth.bindSales({bindTicket:await ticket('test-open-id'),loginName:'trial.sales',password},'binding-test');
 await db.query('UPDATE users SET active=false WHERE id=$1',[seed.salesId]);
 try{assert.equal((await request('/sales/bootstrap','GET',undefined,second.token)).status,401);}finally{await db.query('UPDATE users SET active=true WHERE id=$1',[seed.salesId]);}
});
