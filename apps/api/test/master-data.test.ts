import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {verify} from '@node-rs/argon2';
import {offlineSocketOptions} from '../../../scripts/pglite-options';
import {Database} from '../src/db/database';
import {passwordHash,secretHash,type Actor} from '../src/auth/auth';
import {CoreStore} from '../src/core/store';
import {MasterDataService} from '../src/master-data/service';
import {AdminIdentityService,initializeAdmin} from '../src/master-data/identity';
import {HandoffService} from '../src/master-data/handoff';
import {PurchaseService} from '../src/core/purchases';
import {SupplierService} from '../src/core/suppliers';
import {PricingService} from '../src/core/pricing';
import {comparison} from '../src/core/read-model';
let db:Database,dir:string,wasm:PGlite|undefined,socket:PGLiteSocketServer|undefined,adminDb:Database|undefined,schema:string|undefined,store:CoreStore,master:MasterDataService,identity:AdminIdentityService,handoff:HandoffService;
const instant=new Date('2026-10-26T02:00:00Z');let now=new Date(instant);
async function actor(role='salesperson',channel='pc'):Promise<Actor>{const id=randomUUID(),s=randomUUID();await db.query('INSERT INTO users(id,login_name,name,role,password_hash) VALUES($1,$2,$2,$3,$4)',[id,'fixture-'+id,role,await passwordHash('fixture-password-123')]);await db.query('INSERT INTO auth_sessions(id,user_id,token_hash,channel,expires_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6)',[s,id,secretHash(randomUUID()),channel,new Date(now.getTime()+86400000),now]);return {id,name:'fixture-'+id,role:role as any,channel:channel as any,sessionId:s};}
async function fixture(owner:Actor){const h=randomUUID(),p=randomUUID();await db.query("INSERT INTO hospitals(id,name,sales_user_id) VALUES($1,'测试医院',$2)",[h,owner.id]);await db.query("INSERT INTO users(id,name,role) VALUES($1,'测试采购员','hospital')",[p]);await db.query('INSERT INTO hospital_purchasers(user_id,hospital_id) VALUES($1,$2)',[p,h]);return {h,p};}
async function order(owner:Actor,h:{h:string;p:string},status='draft'){const id=randomUUID(),r=randomUUID();await db.query("INSERT INTO purchase_orders(id,order_no,hospital_id,purchaser_user_id,sales_user_id,original_sales_user_id,received_date,payment_term_days,created_at,status) VALUES($1,$2,$3,$4,$5,$5,'2026-10-01',90,$6,$7)",[id,'CG-'+id,h.h,h.p,owner.id,now,status]);await db.query('INSERT INTO purchase_order_revisions(id,purchase_order_id) VALUES($1,$2)',[r,id]);return {id,r};}
const code=(expected:string)=>(e:any)=>e.code===expected;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'quote-master-data-'));if(process.env.TEST_DB_MODE==='pglite'){wasm=await PGlite.create(join(dir,'wasm'));socket=new PGLiteSocketServer({db:wasm,port:25451,...offlineSocketOptions});await socket.start();db=new Database('postgresql://postgres:postgres@127.0.0.1:25451/postgres',1);}else{assert.ok(process.env.TEST_DATABASE_URL);assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname,'/quote_core_test');adminDb=new Database(process.env.TEST_DATABASE_URL);schema='master_data_'+randomUUID().replaceAll('-','');await adminDb.query('CREATE SCHEMA "'+schema+'"');db=new Database(process.env.TEST_DATABASE_URL,8,schema);}await db.migrate();store=new CoreStore(db,()=>now);master=new MasterDataService(store);identity=new AdminIdentityService(store);handoff=new HandoffService(store);});
beforeEach(()=>{now=new Date(instant);});
after(async()=>{await db?.close();if(adminDb&&schema){await adminDb.query('DROP SCHEMA "'+schema+'" CASCADE');await adminDb.close();}await socket?.stop();await wasm?.close();if(dir)await rm(dir,{recursive:true,force:true});});

test('部署初始化只建立首个管理员，临时密码仍须本人设置且不能覆盖既有账号',async()=>{
 const input={loginName:'initial-admin',name:'初始管理员',phone:'13900000000'},result=await initializeAdmin(store,input);assert.ok(result.temporaryPassword.length>=20);assert.equal(result.user.role,'admin');assert.equal(result.user.passwordSetupRequired,true);await assert.rejects(()=>initializeAdmin(store,input),code('ADMIN_ALREADY_INITIALIZED'));const row=(await db.query('SELECT password_hash FROM users WHERE id=$1',[result.user.id])).rows[0];assert.ok(await verify(row.password_hash,result.temporaryPassword));assert.ok(!JSON.stringify((await db.query("SELECT details FROM audit_records WHERE action='admin.initialize'")).rows).includes(result.temporaryPassword));
});

test('管理员资料白名单、版本及幂等；医院归属维护不改旧订单或账期',async()=>{
 const admin=await actor('admin'),a=await actor(),b=await actor(),h=await fixture(a),o=await order(a,h),key=randomUUID();
 const result=await master.save(admin,key,'hospitals',{id:h.h,expectedVersion:1,name:'新医院名称',salesUserId:b.id,active:true});assert.equal(result.salesUserId,b.id);assert.equal(result.version,2);
 assert.deepEqual(await master.save(admin,key,'hospitals',{id:h.h,expectedVersion:1,name:'新医院名称',salesUserId:b.id,active:true}),result);
 await assert.rejects(()=>master.save(admin,key,'hospitals',{name:'换内容',salesUserId:b.id}),code('IDEMPOTENCY_KEY_REUSED'));
 await assert.rejects(()=>master.save(admin,randomUUID(),'hospitals',{id:h.h,expectedVersion:1,name:'冲突',salesUserId:b.id,active:true}),code('VERSION_CONFLICT'));
 await assert.rejects(()=>master.save(admin,randomUUID(),'hospitals',{id:h.h,expectedVersion:2,name:'越权字段',salesUserId:b.id,paymentTermDays:1}));
 assert.equal((await db.query('SELECT sales_user_id FROM purchase_orders WHERE id=$1',[o.id])).rows[0].sales_user_id,a.id);assert.equal((await db.query('SELECT payment_term_days FROM hospitals WHERE id=$1',[h.h])).rows[0].payment_term_days,90);
 for(const forbidden of [a,await actor('admin','mini'),await actor('hospital')])await assert.rejects(()=>master.save(forbidden,randomUUID(),'manufacturers',{name:'非法厂家'}));
 assert.equal((await db.query("SELECT count(*)::integer n FROM audit_records WHERE action='master.hospitals.save'")).rows[0].n,1);
});
test('商品别名扁平搜索与规格启停；采购员手机号只能属于一家医院',async()=>{
 const admin=await actor('admin'),a=await actor(),h=await fixture(a),h2=await fixture(a);
 const item=await master.save(admin,randomUUID(),'items',{name:'黄芪',aliases:['北芪','黄耆'],category:'根茎',active:true});const variant=await master.save(admin,randomUUID(),'variants',{itemId:item.id,specification:'斜片',origin:'甘肃',grade:'一级',packageDescription:'散装',active:true});
 let rows=await master.searchCatalog(a,{keyword:'北芪'});assert.equal(rows.items.find((x:any)=>x.variantId===variant.id).name,'黄芪');assert.equal(rows.items.find((x:any)=>x.variantId===variant.id).defaultUnit,'kg');assert.equal(rows.items[0].referencePrice,undefined);
 await master.save(admin,randomUUID(),'variants',{id:variant.id,expectedVersion:1,itemId:item.id,specification:'斜片',origin:'甘肃',grade:'一级',packageDescription:'散装',active:false});rows=await master.searchCatalog(a,{keyword:'北芪'});assert.ok(!rows.items.some((x:any)=>x.variantId===variant.id));
 const p=await master.save(admin,randomUUID(),'purchasers',{hospitalId:h.h,name:'王采购',phone:'13800000001',active:true});assert.equal(p.hospitalId,h.h);
 await assert.rejects(()=>master.save(admin,randomUUID(),'purchasers',{hospitalId:h2.h,name:'同号采购',phone:'13800000001',active:true}),code('PHONE_ALREADY_ASSIGNED'));
 const t=await master.save(admin,randomUUID(),'templates',{name:'标准模板',sellerName:'销售方',contactPhone:'010-12345678',fixedNotes:'仅供测试',active:true,isDefault:true});assert.equal(t.isDefault,true);
});
test('临时密码仅首次展示且仅存Argon2哈希；24小时过期、10分钟受限设置并撤销旧会话',async()=>{
 const admin=await actor('admin'),key=randomUUID(),input={loginName:'new-'+randomUUID(),name:'新销售',phone:'13800000002',role:'salesperson'};
 const created=await identity.createUser(admin,key,input);assert.ok(created.temporaryPassword.length>=20);assert.equal(created.user.passwordSetupRequired,true);
 const repeated=await identity.createUser(admin,key,input);assert.equal(repeated.temporaryPassword,undefined);assert.equal(repeated.user.id,created.user.id);
 const row=(await db.query('SELECT * FROM users WHERE id=$1',[created.user.id])).rows[0];assert.ok(row.password_hash.startsWith('$argon2id$'));assert.ok(await verify(row.password_hash,created.temporaryPassword));
 const persisted=JSON.stringify((await db.query('SELECT result FROM operation_requests WHERE actor_id=$1 AND idempotency_key=$2',[admin.id,key])).rows)+JSON.stringify((await db.query('SELECT details FROM audit_records WHERE actor_id=$1',[admin.id])).rows);assert.ok(!persisted.includes(created.temporaryPassword));
 const setup=await identity.verifyTemporaryPassword({loginName:input.loginName,password:created.temporaryPassword});assert.equal(setup.authState,'password_setup_required');assert.ok(!('token' in setup));assert.ok(!('user' in setup));
 now=new Date(instant.getTime()+600001);await assert.rejects(()=>identity.completeSetup({setupTicket:setup.setupTicket,newPassword:'personal-new-password-123'}),code('SETUP_TICKET_INVALID'));
 now=new Date(instant);const fresh=await identity.verifyTemporaryPassword({loginName:input.loginName,password:created.temporaryPassword});await identity.completeSetup({setupTicket:fresh.setupTicket,newPassword:'personal-new-password-123'});await assert.rejects(()=>identity.completeSetup({setupTicket:fresh.setupTicket,newPassword:'personal-another-password-123'}),code('SETUP_TICKET_INVALID'));
 const finished=(await db.query('SELECT * FROM users WHERE id=$1',[created.user.id])).rows[0];assert.equal(finished.password_setup_required,false);assert.equal(finished.temporary_password_expires_at,null);
 const reset=await identity.resetPassword(admin,randomUUID(),created.user.id,{expectedVersion:finished.row_version,reason:'本人申请重置'});now=new Date(instant.getTime()+86400001);await assert.rejects(()=>identity.verifyTemporaryPassword({loginName:input.loginName,password:reset.temporaryPassword}),code('INVALID_CREDENTIALS'));
});
test('停用和角色变更须核对负责医院与未完成事项，最后管理员不可停用',async()=>{
 const admin=await actor('admin'),a=await actor(),h=await fixture(a);await order(a,h);
 await assert.rejects(()=>identity.updateUser(admin,randomUUID(),a.id,{expectedVersion:1,name:a.name,phone:'13800000003',role:'salesperson',active:false}),code('HANDOFF_REQUIRED'));
 await assert.rejects(()=>identity.updateUser(admin,randomUUID(),a.id,{expectedVersion:1,name:a.name,phone:'13800000003',role:'admin',active:true}),code('HANDOFF_REQUIRED'));
 await assert.rejects(()=>identity.updateUser(admin,randomUUID(),admin.id,{expectedVersion:1,name:admin.name,phone:'13800000004',role:'salesperson',active:true}),code('SELF_PRIVILEGE_CHANGE'));
});
test('厂家批次映射预览排除异常行、确认后不可覆盖、系统批次号唯一和整体作废',async()=>{
 const admin=await actor('admin'),m=await master.save(admin,randomUUID(),'manufacturers',{name:'测试厂家',contactName:'李工',contactPhone:'13900000001',active:true});
 const input={manufacturerId:m.id,sourceType:'excel',sourceBatchNo:'厂家可重复号',quotedAt:'2026-10-25',rows:[{品名:'黄芪',单价:'12.30',规格:'斜片'},{品名:'坏行',单价:'0'},{品名:'另药',单价:'19.99'}],mapping:{rawItemName:'品名',referencePrice:'单价',specification:'规格'}};
 const preview=await master.previewSourceBatch(admin,input);assert.equal(preview.invalidRows,1);assert.equal(preview.rows[1].status,'invalid');
 await assert.rejects(()=>master.confirmSourceBatch(admin,randomUUID(),{previewToken:preview.previewToken,acceptedRowNumbers:[1,2]}),code('INVALID_SOURCE_ROWS'));
 const key=randomUUID(),first=await master.confirmSourceBatch(admin,key,{previewToken:preview.previewToken,acceptedRowNumbers:[1,3]});assert.equal(first.status,'confirmed');assert.equal(first.rows.length,2);assert.equal(first.referenceNotice,'仅资料参考，不参与本次报价');assert.deepEqual(await master.confirmSourceBatch(admin,key,{previewToken:preview.previewToken,acceptedRowNumbers:[1,3]}),first);
 const second=await master.confirmSourceBatch(admin,randomUUID(),{previewToken:preview.previewToken,acceptedRowNumbers:[1,3]});assert.notEqual(first.batchNo,second.batchNo);
 await assert.rejects(()=>db.query("UPDATE product_source_lines SET reference_price=99 WHERE batch_id=$1",[first.id]));
 const voided=await master.voidSourceBatch(admin,randomUUID(),first.id,{expectedVersion:1,reason:'厂家资料撤回'});assert.equal(voided.status,'voided');assert.equal((await db.query('SELECT count(*)::integer n FROM product_source_lines WHERE batch_id=$1',[first.id])).rows[0].n,2);
});
test('专项交接须预览同版本和完整范围，失败回滚；完成后只改当前责任并停用',async()=>{
 const admin=await actor('admin'),a=await actor(),b=await actor(),h=await fixture(a),pending=await order(a,h),settled=await order(a,h,'completed');
 const input={fromSalesUserId:a.id,toSalesUserId:b.id,orderIds:[pending.id],hospitalIds:[h.h],reason:'销售离职交接'};
 const preview=await handoff.preview(admin,input);assert.equal(preview.orders.length,1);assert.equal(preview.orders[0].id,pending.id);
 await db.query('UPDATE purchase_orders SET row_version=row_version+1 WHERE id=$1',[pending.id]);await assert.rejects(()=>handoff.execute(admin,randomUUID(),{previewToken:preview.previewToken}),code('VERSION_CONFLICT'));
 assert.equal((await db.query('SELECT sales_user_id FROM hospitals WHERE id=$1',[h.h])).rows[0].sales_user_id,a.id);assert.equal((await db.query('SELECT active FROM users WHERE id=$1',[a.id])).rows[0].active,true);
 const partial=await handoff.preview(admin,{...input,hospitalIds:[]});await assert.rejects(()=>handoff.execute(admin,randomUUID(),{previewToken:partial.previewToken}),code('HANDOFF_INCOMPLETE'));
 const final=await handoff.preview(admin,input),key=randomUUID(),result=await new HandoffService(store).execute(admin,key,{previewToken:final.previewToken});assert.equal(result.deactivated,true);assert.deepEqual(await handoff.execute(admin,key,{previewToken:final.previewToken}),result);
 const current=(await db.query('SELECT * FROM purchase_orders WHERE id=$1',[pending.id])).rows[0];assert.equal(current.sales_user_id,b.id);assert.equal(current.original_sales_user_id,a.id);assert.equal(current.status,'draft');assert.equal(current.payment_term_days,90);assert.equal((await db.query('SELECT sales_user_id FROM purchase_orders WHERE id=$1',[settled.id])).rows[0].sales_user_id,a.id);assert.equal((await db.query('SELECT active FROM users WHERE id=$1',[a.id])).rows[0].active,false);assert.equal((await db.query('SELECT count(*)::integer n FROM sales_handoff_records WHERE purchase_order_id=$1',[pending.id])).rows[0].n,1);
});


test('已确认来源批次不能追加新行；只读查询保留已作废历史',async()=>{
 const admin=await actor('admin'),m=await master.save(admin,randomUUID(),'manufacturers',{name:'来源不可追加厂家'}),preview=await master.previewSourceBatch(admin,{manufacturerId:m.id,sourceType:'manual',quotedAt:'2026-10-26',rows:[{rawItemName:'党参',referencePrice:'18.00'}]}),batch=await master.confirmSourceBatch(admin,randomUUID(),{previewToken:preview.previewToken,acceptedRowNumbers:[1]});
 await assert.rejects(()=>db.query("INSERT INTO product_source_lines(batch_id,row_number,raw_item_name,unit,reference_price,status) VALUES($1,2,'非法追加','kg',20,'unmatched')",[batch.id]));
 await master.voidSourceBatch(admin,randomUUID(),batch.id,{expectedVersion:1,reason:'作废测试'});const sales=await actor();assert.equal((await master.sourceBatch(sales,batch.id)).status,'voided');assert.ok((await master.listSourceBatches(sales,{manufacturerId:m.id})).items.some((b:any)=>b.id===batch.id));
 const listed=await master.list(admin,'manufacturers',{keyword:'来源不可追加'});assert.equal(listed.total,1);assert.equal(listed.items[0].contactName,'');
});
test('密码与微信绑定重置即时撤销旧票据和两端会话，重试不再显示临时密码',async()=>{
 const admin=await actor('admin'),sales=await actor(),mini=await actor('salesperson','mini');
 await db.query('UPDATE auth_sessions SET user_id=$2 WHERE id=$1',[mini.sessionId,sales.id]);const binding=(await db.query("INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES('fixture-app',$1,$2) RETURNING id",[randomUUID(),sales.id])).rows[0];
 const resetKey=randomUUID(),input={expectedVersion:1,reason:'本人申请重置'},first=await identity.resetPassword(admin,resetKey,sales.id,input);assert.ok(first.temporaryPassword);assert.equal((await identity.resetPassword(admin,resetKey,sales.id,input)).temporaryPassword,undefined);assert.equal((await db.query('SELECT count(*)::integer n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL',[sales.id])).rows[0].n,0);
 const setup=await identity.verifyTemporaryPassword({loginName:sales.name,password:first.temporaryPassword}),u=(await db.query('SELECT * FROM users WHERE id=$1',[sales.id])).rows[0];
 await identity.resetBinding(admin,randomUUID(),sales.id,{expectedVersion:u.row_version,reason:'遗失微信身份',expectedBindingId:binding.id});assert.equal((await db.query('SELECT count(*)::integer n FROM wechat_identities WHERE user_id=$1',[sales.id])).rows[0].n,0);
 await assert.rejects(()=>identity.completeSetup({setupTicket:setup.setupTicket,newPassword:'changed-password-fixture-123'}),code('SETUP_TICKET_INVALID'));
 await assert.rejects(()=>identity.resetBinding(admin,randomUUID(),sales.id,{expectedVersion:u.row_version+1,reason:'过时绑定',expectedBindingId:binding.id}),code('IDENTITY_BINDING_CHANGED'));
});
test('医院商品查询重查采购员与医院启用状态，不能读取内部来源价和资料列表',async()=>{
 const admin=await actor('admin'),a=await actor(),h=await fixture(a),hospital=await actor('hospital','mini');await db.query('INSERT INTO hospital_purchasers(user_id,hospital_id) VALUES($1,$2)',[hospital.id,h.h]);
 const item=await master.save(admin,randomUUID(),'items',{name:'医院可选党参',aliases:['测试党参']}),variant=await master.save(admin,randomUUID(),'variants',{itemId:item.id,specification:'统片'});
 const rows=await master.searchCatalog(hospital,{keyword:'测试党参'});assert.ok(rows.items.some((r:any)=>r.variantId===variant.id));await assert.rejects(()=>master.list(hospital,'manufacturers',{}));await db.query('UPDATE hospitals SET active=false WHERE id=$1',[h.h]);await assert.rejects(()=>master.searchCatalog(hospital,{keyword:'测试党参'}),code('SESSION_EXPIRED'));
});
test('专项交接包括已完成未收齐及已结清待处理异常，保留财务证据与暂停状态',async()=>{
 const admin=await actor('admin'),a=await actor(),b=await actor(),h=await fixture(a),unpaid=await order(a,h,'completed'),exception=await order(a,h,'completed'),finished=await order(a,h,'completed');
 async function receivable(o:{id:string;r:string},paid:string){const q=(await db.query('INSERT INTO quotes(purchase_order_id,revision_id,created_by,quote_no) VALUES($1,$2,$3,$4) RETURNING id',[o.id,o.r,a.id,'BJ-'+randomUUID()])).rows[0],v=(await db.query('INSERT INTO quote_versions(quote_id,revision_id) VALUES($1,$2) RETURNING id',[q.id,o.r])).rows[0],ar=(await db.query("INSERT INTO receivables(purchase_order_id,confirmed_version_id,amount,payment_term_days,due_date,created_at) VALUES($1,$2,100,90,'2026-12-30',$3) RETURNING id",[o.id,v.id,now])).rows[0];if(paid!=='0')await db.query("INSERT INTO payment_records(receivable_id,amount,paid_date,recorded_by,recorded_by_name_snapshot,recorded_at) VALUES($1,$2,'2026-10-26',$3,$4,$5)",[ar.id,paid,a.id,a.name,now]);return ar.id;}
 const r1=await receivable(unpaid,'30'),r2=await receivable(exception,'100');await receivable(finished,'100');await db.query("INSERT INTO receivable_exceptions(receivable_id,exception_type,reason,recorded_by,recorded_by_name_snapshot,recorded_at) VALUES($1,'refund','退款待核实',$2,$3,$4)",[r2,a.id,a.name,now]);
 const input={fromSalesUserId:a.id,toSalesUserId:b.id,orderIds:[unpaid.id,exception.id],hospitalIds:[h.h],reason:'离职财务责任交接'},preview=await handoff.preview(admin,input);assert.equal(preview.orderCount,2);assert.equal(preview.exceptionCount,1);const before=(await db.query('SELECT * FROM receivables WHERE id=ANY($1::uuid[]) ORDER BY id',[[r1,r2]])).rows;
 await handoff.execute(admin,randomUUID(),{previewToken:preview.previewToken});assert.deepEqual((await db.query('SELECT * FROM receivables WHERE id=ANY($1::uuid[]) ORDER BY id',[[r1,r2]])).rows,before);assert.equal((await db.query('SELECT status FROM receivable_exceptions WHERE receivable_id=$1',[r2])).rows[0].status,'pending_verification');assert.equal((await db.query('SELECT sales_user_id FROM purchase_orders WHERE id=$1',[finished.id])).rows[0].sales_user_id,a.id);
});

test('交接和来源预览凭证绑定管理员、随机凭证及有效期，不能拿另一预览改范围',async()=>{
 const admin=await actor('admin'),other=await actor('admin'),a=await actor(),b=await actor(),h=await fixture(a),o=await order(a,h),preview=await handoff.preview(admin,{fromSalesUserId:a.id,toSalesUserId:b.id,orderIds:[o.id],hospitalIds:[h.h],reason:'离职'});
 await assert.rejects(()=>handoff.execute(other,randomUUID(),{previewToken:preview.previewToken}),code('PREVIEW_INVALID'));await assert.rejects(()=>handoff.execute(admin,randomUUID(),{previewToken:preview.previewToken.slice(0,-8)+'tampered'}),code('PREVIEW_INVALID'));
 const m=await master.save(admin,randomUUID(),'manufacturers',{name:'预览时效测试'}),p=await master.previewSourceBatch(admin,{manufacturerId:m.id,sourceType:'manual',quotedAt:'2026-10-26',rows:[{rawItemName:'白术',referencePrice:'30.00'}]});
 now=new Date(instant.getTime()+900001);await assert.rejects(()=>master.confirmSourceBatch(admin,randomUUID(),{previewToken:p.previewToken,acceptedRowNumbers:[1]}),code('PREVIEW_INVALID'));await assert.rejects(()=>handoff.execute(admin,randomUUID(),{previewToken:preview.previewToken}),code('PREVIEW_INVALID'));
 assert.equal((await db.query('SELECT active FROM users WHERE id=$1',[a.id])).rows[0].active,true);
});
test('同键并发资料创建只产生一笔结果和审计，账号停用后旧Actor立即无效',async()=>{
 const admin=await actor('admin'),key=randomUUID(),input={name:'资料幂等并发'+randomUUID()};const [first,second]=await Promise.all([master.save(admin,key,'manufacturers',input),master.save(admin,key,'manufacturers',input)]);assert.deepEqual(first,second);assert.equal((await db.query('SELECT count(*)::integer n FROM manufacturers WHERE name=$1',[input.name])).rows[0].n,1);
 const sales=await actor(),result=await identity.updateUser(admin,randomUUID(),sales.id,{expectedVersion:1,name:sales.name,phone:'13800000009',role:'salesperson',active:false});assert.equal(result.user.active,false);await assert.rejects(()=>master.list(sales,'items',{}),code('SESSION_EXPIRED'));await assert.rejects(()=>identity.updateUser(sales,randomUUID(),admin.id,{expectedVersion:1,name:admin.name,phone:'13800000008',role:'admin',active:true}));
});
test('厂家来源行的异常预览和未选有效行仍有永久原始校对依据',async()=>{
 const admin=await actor('admin'),m=await master.save(admin,randomUUID(),'manufacturers',{name:'来源留痕测试'}),p=await master.previewSourceBatch(admin,{manufacturerId:m.id,sourceType:'manual',quotedAt:'2026-10-26',rows:[{rawItemName:'白术',referencePrice:'30'},{rawItemName:'异常来源价',referencePrice:'bad'},{rawItemName:'未选择行',referencePrice:'20'}]}),batch=await master.confirmSourceBatch(admin,randomUUID(),{previewToken:p.previewToken,acceptedRowNumbers:[1]});assert.equal(batch.previewSnapshot.rows.length,3);assert.equal(batch.previewSnapshot.rows[1].status,'invalid');assert.equal(batch.previewSnapshot.rows[1].referencePrice,'bad');assert.equal(batch.rows.length,1);
});

test('原生PG：医院归属维护先锁销售身份，不能与在途业务的用户→医院锁顺序死锁',{skip:process.env.TEST_DB_MODE==='pglite'},async()=>{
 const admin=await actor('admin'),a=await actor(),b=await actor(),h=await fixture(a),owner=await db.pool.connect();let pending:Promise<any>|undefined;
 try{
  await owner.query('BEGIN');await owner.query("SET LOCAL statement_timeout='1500ms'");const pid=(await owner.query('SELECT pg_backend_pid() pid')).rows[0].pid;await owner.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[a.id]);
  pending=master.save(admin,randomUUID(),'hospitals',{id:h.h,expectedVersion:1,name:'并发归属测试',salesUserId:b.id,active:true}).then(result=>({result}),error=>({error}));
  let blocked=false;for(let n=0;n<100;n++){blocked=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity s WHERE s.datname=current_database() AND $1::integer=ANY(pg_blocking_pids(s.pid))) AS blocked",[pid])).rows[0].blocked;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(blocked,'应在真实锁竞争时触发医院归属维护');
  // The in-flight business operation can finish its hospital read while admin waits on the user.
  await owner.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE',[h.h]);await owner.query('COMMIT');const outcome=await pending;assert.ifError(outcome.error);assert.equal(outcome.result.salesUserId,b.id);
 }finally{await owner.query('ROLLBACK');owner.release();if(pending)await pending;}
});


test('来源价0.01仅可查资料，本次10/12报价的最低与基准为10、固定加3推荐及最终为13',async()=>{
 const admin=await actor('admin'),sales=await actor(),h=await fixture(sales);
 const item=await master.save(admin,randomUUID(),'items',{name:'黄芪',aliases:['本次计价隔离用北芪']}),variant=await master.save(admin,randomUUID(),'variants',{itemId:item.id,specification:'斜片'});
 const first=await master.save(admin,randomUUID(),'manufacturers',{name:'计价隔离甲厂'}),second=await master.save(admin,randomUUID(),'manufacturers',{name:'计价隔离乙厂'});
 const preview=await master.previewSourceBatch(admin,{manufacturerId:first.id,sourceType:'manual',quotedAt:'2026-10-26',rows:[{rawItemName:item.name,specification:variant.specification,itemVariantId:variant.id,referencePrice:'0.01'}]}),source=await master.confirmSourceBatch(admin,randomUUID(),{previewToken:preview.previewToken,acceptedRowNumbers:[1]});
 assert.equal(source.rows[0].itemVariantId,variant.id);assert.equal(source.rows[0].status,'valid');
 const purchases=new PurchaseService(store),suppliers=new SupplierService(store,{databaseUrl:'',supplierWebUrl:'http://127.0.0.1:5174',trialPasswordLogin:false,production:false,wechatAppId:'',wechatAppSecret:'',allowedOrigins:[]}),pricing=new PricingService(store);
 let current=await purchases.create(sales,randomUUID(),{hospitalId:h.h,purchaserUserId:h.p,receivedDate:'2026-10-26',lines:[{name:item.name,spec:variant.specification,quantity:'2.00',checked:true}]});
 current=await purchases.freeze(sales,randomUUID(),current.id,current.revisionId,{expectedVersion:current.version});
 for(const offer of [{slotNo:1 as const,manufacturer:first,price:'10.00'},{slotNo:2 as const,manufacturer:second,price:'12.00'}]){
  current=await suppliers.createTask(sales,randomUUID(),current.revisionId,{expectedVersion:current.version,slotNo:offer.slotNo,manufacturerId:offer.manufacturer.id});
  const task=current.tasks.find(t=>t.slotNo===offer.slotNo)!;
  const link=await suppliers.link(sales,randomUUID(),task.id,'generate',{expectedVersion:current.version}),token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('token');assert.ok(token);
  const supplierSession=await suppliers.exchange({token});await suppliers.submit(supplierSession.sessionToken,randomUUID(),{validUntil:'2026-11-01',lines:current.lines.map(line=>({purchaseLineId:line.id,status:'quoted',unitPrice:offer.price}))});
  current=await purchases.get(sales,current.id) as typeof current;
 }
 const compared=await db.transaction(async c=>comparison(c,await store.root(c,sales,current.id),now));assert.equal(compared.submittedCount,2);assert.deepEqual(compared.lines[0].cells.map(cell=>cell.price),['10.00','12.00']);assert.equal(compared.lines[0].lowestPrice,'10.00');
 const lowest=compared.lines[0].cells.find(cell=>cell.price==='10.00')!,draft=await pricing.enter(sales,randomUUID(),current.id,{expectedVersion:compared.orderVersion,allowEarly:false});
 assert.equal(draft.lines[0].baseSupplierQuoteLineId,lowest.supplierQuoteLineId);assert.equal(draft.lines[0].basePrice,'10.00');assert.equal(draft.lines[0].adoptedLowestPrice,'10.00');
 const saved=await pricing.save(sales,randomUUID(),draft.quoteId,draft.id,{expectedVersion:draft.version,hospitalValidUntil:'2026-11-01',lines:draft.lines.map(line=>({purchaseLineId:line.purchaseLineId,baseSupplierQuoteLineId:line.baseSupplierQuoteLineId,selectionMode:line.selectionMode,markupMethod:'fixed',parameterValue:'3.00',finalPrice:'13.00',finalConfirmed:true,lossReason:''}))});
 assert.equal(saved.lines[0].basePrice,'10.00');assert.equal(saved.lines[0].recommendedPrice,'13.00');assert.equal(saved.lines[0].finalPrice,'13.00');assert.equal(saved.lines[0].finalConfirmed,true);assert.equal(saved.total,'26.00');assert.equal(saved.readyForNextStep,true);
 const adopted=await pricing.adopt(sales,randomUUID(),saved.quoteId,saved.id,{expectedVersion:saved.version});assert.equal(adopted.lines[0].adoptedLowestPrice,'10.00');assert.equal(adopted.lines[0].basePrice,'10.00');assert.equal(adopted.lines[0].recommendedPrice,'13.00');assert.equal(adopted.lines[0].finalPrice,'13.00');assert.equal(adopted.total,'26.00');
 const reference=await master.sourceBatch(sales,source.id);assert.equal(reference.status,'confirmed');assert.equal(reference.rows[0].referencePrice,'0.01');assert.equal(reference.referenceNotice,'仅资料参考，不参与本次报价');
});

test('合法1000行来源预览用短凭证确认单行，服务重建后仍完整保存原始校对依据',async()=>{
 const admin=await actor('admin'),m=await master.save(admin,randomUUID(),'manufacturers',{name:'大批次预览厂家'});
 const row={rawItemName:'药'.repeat(98),specification:'规'.repeat(200),origin:'产'.repeat(200),grade:'级'.repeat(200),remark:'注'.repeat(500),referencePrice:'12.30'};
 const preview=await master.previewSourceBatch(admin,{manufacturerId:m.id,sourceType:'manual',quotedAt:'2026-10-26',rows:Array.from({length:1000},()=>({...row}))});assert.equal(preview.totalRows,1000);assert.equal(preview.invalidRows,0);
 const restarted=new MasterDataService(store),batch=await restarted.confirmSourceBatch(admin,randomUUID(),{previewToken:preview.previewToken,acceptedRowNumbers:[1]});
 assert.ok(preview.previewToken.length<=200,'确认凭证必须有固定短上限，不能携带整份预览');assert.equal(batch.rows.length,1);assert.equal(batch.rows[0].referencePrice,'12.30');assert.equal(batch.previewSnapshot.rows.length,1000);assert.equal(batch.previewSnapshot.rawRows.length,1000);assert.deepEqual(batch.previewSnapshot.rawRows[999],row);assert.equal(batch.previewSnapshot.rows[999].remark,row.remark);
});

test('持久预览只存凭证哈希且绑定用途与当前权限、认证版本',async()=>{
 const admin=await actor('admin'),a=await actor(),b=await actor(),h=await fixture(a),o=await order(a,h),m=await master.save(admin,randomUUID(),'manufacturers',{name:'预览身份版本厂家'}),input={manufacturerId:m.id,sourceType:'manual',quotedAt:'2026-10-26',rows:[{rawItemName:'党参',referencePrice:'10.00'}]};
 const source=await master.previewSourceBatch(admin,input),transfer=await handoff.preview(admin,{fromSalesUserId:a.id,toSalesUserId:b.id,orderIds:[o.id],hospitalIds:[h.h],reason:'预览用途隔离'});
 const stored=(await db.query('SELECT * FROM master_data_previews WHERE token_hash=$1',[secretHash(source.previewToken)])).rows[0];assert.equal(stored.actor_id,admin.id);assert.equal(stored.purpose,'manufacturer-source');assert.equal(stored.auth_version,1);assert.equal(stored.access_scope_version,1);assert.equal(stored.payload.rows[0].referencePrice,'10.00');assert.ok(!JSON.stringify(stored).includes(source.previewToken));
 await assert.rejects(()=>handoff.execute(admin,randomUUID(),{previewToken:source.previewToken}),code('PREVIEW_INVALID'));await assert.rejects(()=>master.confirmSourceBatch(admin,randomUUID(),{previewToken:transfer.previewToken,acceptedRowNumbers:[1]}),code('PREVIEW_INVALID'));
 await db.query('UPDATE users SET access_scope_version=access_scope_version+1 WHERE id=$1',[admin.id]);await assert.rejects(()=>master.confirmSourceBatch(admin,randomUUID(),{previewToken:source.previewToken,acceptedRowNumbers:[1]}),code('PREVIEW_INVALID'));
 const fresh=await master.previewSourceBatch(admin,input);await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[admin.id]);const sessionId=randomUUID();await db.query("INSERT INTO auth_sessions(id,user_id,token_hash,channel,expires_at,last_seen_at) VALUES($1,$2,$3,'pc',$4,$5)",[sessionId,admin.id,secretHash(randomUUID()),new Date(now.getTime()+86400000),now]);
 await assert.rejects(()=>master.confirmSourceBatch({...admin,sessionId},randomUUID(),{previewToken:fresh.previewToken,acceptedRowNumbers:[1]}),code('PREVIEW_INVALID'));
});

test('生成预览每次最多清理200条过期凭证，不扩大为无界删除',async()=>{
 const admin=await actor('admin'),m=await master.save(admin,randomUUID(),'manufacturers',{name:'有界预览清理厂家'}),expired=Array.from({length:202},(_,n)=>secretHash(admin.id+':expired:'+n));
 await db.query("INSERT INTO master_data_previews(token_hash,actor_id,purpose,auth_version,access_scope_version,payload,created_at,expires_at) SELECT hash,$2,'manufacturer-source',1,1,'{}',$3,$4 FROM unnest($1::text[]) hash",[expired,admin.id,new Date(instant.getTime()-1800000),new Date(instant.getTime()-1)]);
 const preview=await master.previewSourceBatch(admin,{manufacturerId:m.id,sourceType:'manual',quotedAt:'2026-10-26',rows:[{rawItemName:'党参',referencePrice:'10.00'}]});assert.equal(preview.previewToken.length,43);
 assert.equal((await db.query('SELECT count(*)::integer n FROM master_data_previews WHERE token_hash=ANY($1::text[])',[expired])).rows[0].n,2);
});

test('原生PG：跨到期时预览清理跳过执行中的凭证，两条真实交接事务均推进',{skip:process.env.TEST_DB_MODE==='pglite'},async()=>{
 const admin=await actor('admin'),a=await actor(),b=await actor(),h=await fixture(a),o=await order(a,h),input={fromSalesUserId:a.id,toSalesUserId:b.id,orderIds:[o.id],hospitalIds:[h.h],reason:'预览清理锁序回归'},initial=await handoff.preview(admin,input);
 function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
 const readDone=gate(),continueExecution=gate(),cleanupSent=gate();
 // These clients execute every real SQL statement. Only statement boundaries are gated.
 function tracedDatabase(onQuery:(sql:string,pending:Promise<any>)=>Promise<any>){const traced=Object.create(db) as Database;traced.transaction=action=>db.transaction(c=>action(new Proxy(c,{get(target,property,receiver){if(property==='query')return (sql:string,values?:unknown[])=>onQuery(sql,target.query(sql,values));return Reflect.get(target,property,receiver);}})));return traced;}
 const executionStore=new CoreStore(tracedDatabase(async(sql,pending)=>{const result=await pending;if(sql.startsWith('SELECT p.payload FROM master_data_previews')){readDone.release();await continueExecution.promise;}return result;}),()=>now);
 const cleanupStore=new CoreStore(tracedDatabase(async(sql,pending)=>{if(sql.includes('DELETE FROM master_data_previews'))cleanupSent.release();return pending;}),()=>now);
 const execution=new HandoffService(executionStore).execute(admin,randomUUID(),{previewToken:initial.previewToken}).then(result=>({result,error:null}),error=>({result:null,error}));let next:Promise<any>|undefined;
 try{
  await Promise.race([readDone.promise,execution.then(outcome=>{assert.ifError(outcome.error);throw new Error('执行事务未到达预览读取屏障');})]);
  // The old ticket was checked before expiry and remains share-locked by execute.
  now=new Date(instant.getTime()+900001);
  next=new HandoffService(cleanupStore).preview(admin,input).then(result=>({result,error:null}),error=>({result:null,error}));
  await Promise.race([cleanupSent.promise,next.then(outcome=>{assert.ifError(outcome.error);throw new Error('预览事务未到达清理屏障');})]);
  // preview now holds the source/target user SHARE locks; execute holds the ticket SHARE lock.
  continueExecution.release();const [completed,created]=await Promise.all([execution,next]);assert.ifError(completed.error);assert.ifError(created.error);assert.equal(completed.result?.deactivated,true);assert.equal(created.result.previewToken.length,43);
  assert.equal((await db.query('SELECT count(*)::integer n FROM master_data_previews WHERE token_hash=$1',[secretHash(initial.previewToken)])).rows[0].n,1,'清理须跳过仍被执行事务持有的过期凭证');assert.equal((await db.query('SELECT sales_user_id FROM purchase_orders WHERE id=$1',[o.id])).rows[0].sales_user_id,b.id);
 }finally{continueExecution.release();await Promise.allSettled([execution,...(next?[next]:[])]);}
});
test('来源规格关联仅匹配实际确认行，保留作废历史、厂家事实与组合筛选分页',async()=>{
 const admin=await actor('admin'),sales=await actor(),m1=await master.save(admin,randomUUID(),'manufacturers',{name:'规格来源甲厂家'}),m2=await master.save(admin,randomUUID(),'manufacturers',{name:'规格来源乙厂家'}),item=await master.save(admin,randomUUID(),'items',{name:'关联查询药品'}),v1=await master.save(admin,randomUUID(),'variants',{itemId:item.id,specification:'片'}),v2=await master.save(admin,randomUUID(),'variants',{itemId:item.id,specification:'段'});
 async function batch(manufacturerId:string,rows:any[],acceptedRowNumbers:number[]){const p=await master.previewSourceBatch(admin,{manufacturerId,sourceType:'manual',quotedAt:'2026-10-26',rows});return master.confirmSourceBatch(admin,randomUUID(),{previewToken:p.previewToken,acceptedRowNumbers});}
 const matched=await batch(m1.id,[{rawItemName:'药品甲',referencePrice:'10',itemVariantId:v1.id},{rawItemName:'药品乙',referencePrice:'11',itemVariantId:v1.id}],[1,2]);
 const previewOnly=await batch(m1.id,[{rawItemName:'未纳入片',referencePrice:'12',itemVariantId:v1.id},{rawItemName:'已纳入段',referencePrice:'13',itemVariantId:v2.id}],[2]);
 const otherManufacturer=await batch(m2.id,[{rawItemName:'药品丙',referencePrice:'14',itemVariantId:v1.id}],[1]);
 const rows=await master.listSourceBatches(sales,{itemVariantId:v1.id,pageSize:100});assert.deepEqual(new Set(rows.items.map((r:any)=>r.id)),new Set([matched.id,otherManufacturer.id]));assert.ok(!rows.items.some((r:any)=>r.id===previewOnly.id));assert.equal(rows.items.find((r:any)=>r.id===matched.id).manufacturerName,m1.name);
 const filtered=await master.listSourceBatches(sales,{itemVariantId:v1.id,manufacturerId:m1.id,batchNo:matched.batchNo,quotedFrom:'2026-10-26',quotedTo:'2026-10-26'});assert.deepEqual(filtered.items.map((r:any)=>r.id),[matched.id]);
 const first=await master.listSourceBatches(sales,{itemVariantId:v1.id,page:1,pageSize:1}),second=await master.listSourceBatches(sales,{itemVariantId:v1.id,page:2,pageSize:1});assert.equal(first.items.length,1);assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);
 await master.voidSourceBatch(admin,randomUUID(),matched.id,{expectedVersion:1,reason:'历史资料撤回'});assert.equal((await master.listSourceBatches(sales,{itemVariantId:v1.id,manufacturerId:m1.id})).items[0].status,'voided');const detail=await master.sourceBatch(sales,matched.id);assert.equal(detail.manufacturerName,m1.name);assert.equal(detail.rows.length,2);assert.equal(detail.referenceNotice,'仅资料参考，不参与本次报价');
 await assert.rejects(()=>master.listSourceBatches(sales,{itemVariantId:'not-a-uuid'}));await assert.rejects(async()=>master.listSourceBatches(await actor('hospital','mini'),{itemVariantId:v1.id}));
});
