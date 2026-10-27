import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {offlineSocketOptions} from '../../../scripts/pglite-options';
import {Database} from '../src/db/database';
import {createApp} from '../src/app';
import {AuthService,passwordHash,secretHash} from '../src/auth/auth';
import {CoreStore} from '../src/core/store';
import type {ObjectStorage} from '../src/delivery/storage';
import {configuration} from '../src/config';

const origin='http://127.0.0.1:5176',password='pc-security-fixture-only-123',instant=new Date('2026-10-23T02:00:00Z');
let now=new Date(instant),db:Database,app:Awaited<ReturnType<typeof createApp>>,base:string,dir:string,wasm:PGlite|undefined,socket:PGLiteSocketServer|undefined,adminDb:Database|undefined,schema:string|undefined;
const content=Buffer.from('role-version-test');
const storage:ObjectStorage={async put(){},async read(){return content;},async remove(){},async signedDownload(){return null;}};
interface Browser {cookies:Map<string,string>;csrf:string;origin:string;setCookies:string[];}
const browser=(allowed=origin):Browser=>({cookies:new Map(),csrf:'',origin:allowed,setCookies:[]});
const sessionToken=(b:Browser)=>b.cookies.get('quote_session_dev')||b.cookies.get('__Host-quote_session')||'';
async function wire(path:string,method='GET',body?:unknown,b?:Browser,extra:Record<string,string>={},url=base){const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(b?{Cookie:[...b.cookies].map(([k,v])=>k+'='+v).join('; '),Origin:b.origin,'X-CSRF-Token':b.csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});if(b){b.setCookies=r.headers.getSetCookie();for(const value of b.setCookies){const pair=value.split(';')[0],i=pair.indexOf('=');if(/Max-Age=0/i.test(value))b.cookies.delete(pair.slice(0,i));else b.cookies.set(pair.slice(0,i),pair.slice(i+1));}}return {status:r.status,...await r.json() as any};}
async function ok(path:string,method='GET',body?:unknown,b?:Browser,extra:Record<string,string>={},url=base){const r=await wire(path,method,body,b,extra,url);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
async function user(role='salesperson'){const id=randomUUID(),name='安全账号'+randomUUID();await db.query('INSERT INTO users(id,login_name,name,role,password_hash) VALUES($1,$2,$2,$3,$4)',[id,name,role,await passwordHash(password)]);return {id,name,role};}
async function bearer(u:any){const token=randomUUID(),s=(await db.query("INSERT INTO auth_sessions(user_id,token_hash,channel,expires_at,last_seen_at) VALUES($1,$2,'mini',$3,$4) RETURNING id",[u.id,secretHash(token),new Date(now.getTime()+30*86400000),now])).rows[0];return {token,sessionId:s.id};}
async function login(u:any,b=browser(),url=base){b.csrf=(await ok('/auth/csrf','GET',undefined,b,{},url)).csrf;const data=await ok('/auth/pc/password-login','POST',{loginName:u.name,password},b,{},url);assert.equal(data.token,undefined);b.csrf=data.csrf;return {b,data};}
before(async()=>{dir=await mkdtemp(join(tmpdir(),'quote-pc-auth-test-'));if(process.env.TEST_DB_MODE==='pglite'){wasm=await PGlite.create(join(dir,'wasm'));socket=new PGLiteSocketServer({db:wasm,port:25448,...offlineSocketOptions});await socket.start();db=new Database('postgresql://postgres:postgres@127.0.0.1:25448/postgres',1);}else{assert.ok(process.env.TEST_DATABASE_URL);assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname,'/quote_core_test');adminDb=new Database(process.env.TEST_DATABASE_URL);schema='pc_auth_test_'+randomUUID().replaceAll('-','');await adminDb.query('CREATE SCHEMA "'+schema+'"');db=new Database(process.env.TEST_DATABASE_URL,8,schema);}await db.migrate();app=await createApp({databaseUrl:'',supplierWebUrl:'',trialPasswordLogin:false,production:false,wechatAppId:'',wechatAppSecret:'',allowedOrigins:[origin]},db,()=>now,{storage});await app.listen(0,'127.0.0.1');base=(await app.getUrl())+'/api/v1';});
beforeEach(()=>{now=new Date(instant);});
after(async()=>{await app?.close();await db?.close();if(adminDb&&schema){await adminDb.query('DROP SCHEMA "'+schema+'" CASCADE');await adminDb.close();}await socket?.stop();await wasm?.close();if(dir)await rm(dir,{recursive:true,force:true});});

test('角色升降并改回原角色，中间未发请求，旧Bearer和CoreStore Actor也永久失效',async()=>{
 const u=await user(),s=await bearer(u),auth=app.get(AuthService),actor=await auth.authenticate(s.token);
 await db.query("UPDATE users SET role='admin' WHERE id=$1",[u.id]);await db.query("UPDATE users SET role='salesperson' WHERE id=$1",[u.id]);
 assert.equal((await wire('/auth/me','GET',undefined,undefined,{Authorization:'Bearer '+s.token})).status,401);
 await assert.rejects(()=>db.transaction(c=>new CoreStore(db,()=>now).active(c,actor)),(e:any)=>e.status===401);
});
test('开发配置允许PC默认5176来源，生产只接受显式可信HTTPS来源',()=>{const keys=['NODE_ENV','DATABASE_URL','SUPPLIER_WEB_URL','ALLOWED_ORIGINS','TRIAL_PASSWORD_LOGIN','DEV_PGLITE'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{for(const key of keys)delete process.env[key];process.env.DATABASE_URL='postgresql://fixture@127.0.0.1/fixture';assert.ok(configuration().allowedOrigins.includes(origin));assert.ok(configuration().allowedOrigins.includes('http://localhost:5176'));process.env.NODE_ENV='production';process.env.SUPPLIER_WEB_URL='https://supplier.example';assert.throws(()=>configuration(),/ALLOWED_ORIGINS/);process.env.ALLOWED_ORIGINS=origin;assert.throws(()=>configuration(),/HTTPS/);process.env.ALLOWED_ORIGINS='https://quote.example';assert.deepEqual(configuration().allowedOrigins,['https://quote.example']);}finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
async function proxyApp(trustedProxyIps:string[]|undefined,run:(url:string)=>Promise<void>){
 const instance=await createApp({databaseUrl:'',supplierWebUrl:'',trialPasswordLogin:false,production:false,wechatAppId:'',wechatAppSecret:'',allowedOrigins:[origin],trustedProxyIps},db,()=>now,{storage});
 try{await instance.listen(0,'127.0.0.1');await run((await instance.getUrl())+'/api/v1');}finally{await instance.close();}
}
test('可信代理配置默认关闭，仅允许明确IP且拒绝通配、CIDR、别名与跳数',()=>{
 const keys=['NODE_ENV','DATABASE_URL','TRUSTED_PROXY_IPS'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{delete process.env.NODE_ENV;process.env.DATABASE_URL='postgresql://fixture@127.0.0.1/fixture';delete process.env.TRUSTED_PROXY_IPS;assert.deepEqual(configuration().trustedProxyIps,[]);
  process.env.TRUSTED_PROXY_IPS='172.30.90.2, ::1';assert.deepEqual(configuration().trustedProxyIps,['172.30.90.2','::1']);
  for(const invalid of ['true','1','loopback','0.0.0.0/0','172.16.0.0/12','proxy.example','0.0.0.0','::']){process.env.TRUSTED_PROXY_IPS=invalid;assert.throws(()=>configuration(),/TRUSTED_PROXY_IPS/,invalid);}
 }finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});
test('默认及非可信直连忽略伪造XFF，轮换来源头不能绕过微信限流',async()=>{
 for(const trusted of [undefined,['192.0.2.50']])await proxyApp(trusted,async url=>{
  for(let n=0;n<15;n++)assert.equal((await wire('/auth/miniapp/login','POST',{loginCode:'offline-only'},undefined,{'X-Forwarded-For':'198.51.100.'+(n+1)},url)).status,503);
  const limited=await wire('/auth/miniapp/login','POST',{loginCode:'offline-only'},undefined,{'X-Forwarded-For':'203.0.113.200'},url);assert.equal(limited.status,429);assert.equal(limited.error.code,'RATE_LIMITED');
 });
});
test('可信代理仅接受覆盖后的单IP，微信限流按客户隔离且拒绝多跳伪造',async()=>{
 await proxyApp(['127.0.0.1'],async url=>{
  for(const forwarded of ['203.0.113.5, 198.51.100.10','invalid','198.51.100.10:1234']){const invalid=await wire('/auth/miniapp/login','POST',{loginCode:'offline-only'},undefined,{'X-Forwarded-For':forwarded},url);assert.equal(invalid.status,400);assert.equal(invalid.error.code,'INVALID_FORWARDED_FOR');}
  for(let n=0;n<15;n++)assert.equal((await wire('/auth/miniapp/login','POST',{loginCode:'offline-only'},undefined,{'X-Forwarded-For':'198.51.100.10'},url)).status,503);
  assert.equal((await wire('/auth/miniapp/login','POST',{loginCode:'offline-only'},undefined,{'X-Forwarded-For':'198.51.100.10'},url)).status,429);
  for(const client of ['198.51.100.11','2001:db8::1'])assert.equal((await wire('/auth/miniapp/login','POST',{loginCode:'offline-only'},undefined,{'X-Forwarded-For':client},url)).status,503);
 });
});
test('可信代理下同一销售账号的不同客户登录限流相互隔离',async()=>{
 await proxyApp(['::ffff:127.0.0.1'],async url=>{
  const u=await user(),a=browser(),b=browser(),first={'X-Forwarded-For':'198.51.100.10'},second={'X-Forwarded-For':'198.51.100.11'};
  b.csrf=(await ok('/auth/csrf','GET',undefined,b,second,url)).csrf;
  for(let n=0;n<15;n++){a.csrf=(await ok('/auth/csrf','GET',undefined,a,first,url)).csrf;const denied=await wire('/auth/pc/password-login','POST',{loginName:u.name,password:'incorrect-fixture-only'},a,first,url);assert.equal(denied.status,401,JSON.stringify(denied));}
  a.csrf=(await ok('/auth/csrf','GET',undefined,a,first,url)).csrf;
  assert.equal((await wire('/auth/pc/password-login','POST',{loginName:u.name,password},a,first,url)).status,429);
  assert.equal((await wire('/auth/pc/password-login','POST',{loginName:u.name,password},b,second,url)).status,200);
 });
});
test('PC登录必须先取得预会话CSRF并验证可信Origin，不能用SameSite或Host替代',async()=>{
 const u=await user(),body={loginName:u.name,password};assert.equal((await wire('/auth/pc/password-login','POST',body)).status,403);
 const b=browser();b.csrf=(await ok('/auth/csrf','GET',undefined,b)).csrf;assert.ok(b.csrf);assert.equal((await wire('/auth/pc/password-login','POST',body,b,{Origin:'https://evil.example'})).status,403);assert.equal((await wire('/auth/pc/password-login','POST',body,b,{'X-CSRF-Token':'wrong'})).status,403);assert.equal((await wire('/auth/pc/password-login','POST',body,b,{Origin:''})).status,403);
 const pre=b.cookies.get('quote_pre_dev'),csrf=b.csrf,data=await ok('/auth/pc/password-login','POST',body,b);assert.equal(data.token,undefined);assert.equal(data.channel,'pc');assert.notEqual(data.csrf,csrf);assert.ok(sessionToken(b));assert.equal(b.cookies.has('quote_pre_dev'),false);assert.ok(pre);const row=(await db.query('SELECT token_hash,csrf_hash FROM auth_sessions WHERE token_hash=$1',[secretHash(sessionToken(b))])).rows[0];assert.equal(row.csrf_hash,secretHash(data.csrf));assert.notEqual(row.token_hash,sessionToken(b));b.csrf=data.csrf;assert.equal((await ok('/auth/me','GET',undefined,b)).channel,'pc');
});
test('PC Cookie与Bearer通道不可混用，错误Cookie也不能退回有效Bearer',async()=>{
 const u=await user(),s=await bearer(u),{b}=await login(u),token=sessionToken(b);
 assert.equal((await wire('/auth/me','GET',undefined,undefined,{Authorization:'Bearer '+token})).status,403);
 const wrong=browser();wrong.cookies.set('quote_session_dev',s.token);assert.equal((await wire('/auth/me','GET',undefined,wrong)).status,403);
 const both=browser();both.cookies.set('quote_session_dev','invalid-cookie');assert.equal((await wire('/auth/me','GET',undefined,both,{Authorization:'Bearer '+s.token})).status,401);
 assert.equal((await wire('/auth/me','GET',undefined,undefined,{Authorization:'Bearer '+s.token})).status,200);
});
test('PC所有变更含只读下载授权、未知未来POST和退出都校验Origin与当前CSRF',async()=>{
 const {b}=await login(await user());for(const path of ['/files/'+randomUUID()+'/download-url','/future/business-write','/auth/logout']){assert.equal((await wire(path,'POST',{},b,{'X-CSRF-Token':''})).status,403,path);assert.equal((await wire(path,'POST',{},b,{Origin:'https://evil.example'})).status,403,path);}
 assert.equal((await wire('/files/'+randomUUID()+'/download-url','POST',{},b)).status,404);
 await ok('/auth/logout','POST',{},b);assert.equal(b.cookies.has('quote_session_dev'),false);assert.ok(b.setCookies.some(v=>v.startsWith('quote_session_dev=')&&/Max-Age=0/i.test(v)));assert.equal((await wire('/auth/me','GET',undefined,b)).status,401);
});
test('PC重新登录轮换会话与CSRF，旧预会话、旧令牌和旧CSRF不可复用',async()=>{
 const u=await user(),{b}=await login(u),oldToken=sessionToken(b),oldCsrf=b.csrf;
 const data=await ok('/auth/pc/password-login','POST',{loginName:u.name,password},b);assert.notEqual(sessionToken(b),oldToken);assert.notEqual(data.csrf,oldCsrf);b.csrf=data.csrf;
 const previous=browser();previous.cookies.set('quote_session_dev',oldToken);assert.equal((await wire('/auth/me','GET',undefined,previous)).status,401);assert.equal((await wire('/auth/logout','POST',{},b,{'X-CSRF-Token':oldCsrf})).status,403);
 b.csrf=(await ok('/auth/csrf','GET',undefined,b)).csrf;assert.equal((await wire('/auth/logout','POST',{},b)).status,200);
 const expired=browser();expired.csrf=(await ok('/auth/csrf','GET',undefined,expired)).csrf;now=new Date(instant.getTime()+600000);assert.equal((await wire('/auth/pc/password-login','POST',{loginName:u.name,password},expired)).status,403);
});
test('PC sales变admin或admin降为sales及改回，都要求重新登录；停用/密码变更也不复活旧会话',async()=>{
 for(const startRole of ['salesperson','admin']){const u=await user(startRole),{b}=await login(u);await db.query('UPDATE users SET role=$2 WHERE id=$1',[u.id,startRole==='admin'?'salesperson':'admin']);await db.query('UPDATE users SET role=$2 WHERE id=$1',[u.id,startRole]);assert.equal((await wire('/sales/order-archive','GET',undefined,b)).status,401);}
 for(const mutation of ["active=false","password_hash='changed-fixture-hash'"]){const u=await user(),{b}=await login(u);await db.query('UPDATE users SET '+mutation+' WHERE id=$1',[u.id]);if(mutation==='active=false')await db.query('UPDATE users SET active=true WHERE id=$1',[u.id]);assert.equal((await wire('/auth/me','GET',undefined,b)).status,401);}
});
test('生产Cookie固定__Host名称和Secure属性，不依赖反向代理后的HTTP协议且不返回token',async()=>{
 const prod=await createApp({databaseUrl:'',supplierWebUrl:'https://supplier.example',trialPasswordLogin:false,production:true,wechatAppId:'',wechatAppSecret:'',allowedOrigins:['https://quote.example']},db,()=>now,{storage});try{await prod.listen(0,'127.0.0.1');const url=(await prod.getUrl())+'/api/v1',b=browser('https://quote.example'),u=await user();b.csrf=(await ok('/auth/csrf','GET',undefined,b,{},url)).csrf;assert.ok(b.setCookies.some(v=>v.startsWith('__Host-quote_pre=')&&/; Secure/i.test(v)&&/; HttpOnly/i.test(v)&&/; SameSite=Lax/i.test(v)&&/; Path=\//i.test(v)&&!/Domain=/i.test(v)));const data=await ok('/auth/pc/password-login','POST',{loginName:u.name,password},b,{},url);assert.equal(data.token,undefined);assert.ok(b.setCookies.some(v=>v.startsWith('__Host-quote_session=')&&/; Secure/i.test(v)&&/; HttpOnly/i.test(v)&&/; SameSite=Lax/i.test(v)&&!/Domain=/i.test(v)));assert.equal(b.cookies.has('quote_session_dev'),false);b.csrf=data.csrf;assert.equal((await wire('/auth/logout','POST',{},b,{Origin:origin},url)).status,403);}finally{await prod.close();}
});
test('角色改回后已有下载票据也失效，不能从票据重新构造新权限Actor',async()=>{
 const u=await user(),p=await user('hospital'),h=randomUUID(),order=randomUUID(),revision=randomUUID(),q=randomUUID(),v=randomUUID(),attempt=randomUUID(),file=randomUUID();await db.query("INSERT INTO hospitals(id,name,sales_user_id) VALUES($1,'安全测试医院',$2)",[h,u.id]);await db.query('INSERT INTO hospital_purchasers(user_id,hospital_id) VALUES($1,$2)',[p.id,h]);await db.query("INSERT INTO purchase_orders(id,order_no,hospital_id,purchaser_user_id,sales_user_id,original_sales_user_id,received_date,payment_term_days,created_at) VALUES($1,$2,$3,$4,$5,$5,'2026-10-23',30,$6)",[order,'CG-'+randomUUID(),h,p.id,u.id,instant]);await db.query('INSERT INTO purchase_order_revisions(id,purchase_order_id) VALUES($1,$2)',[revision,order]);await db.query('INSERT INTO quotes(id,purchase_order_id,revision_id,created_by,quote_no) VALUES($1,$2,$3,$4,$5)',[q,order,revision,u.id,'BJ-'+randomUUID()]);await db.query('INSERT INTO quote_versions(id,quote_id,revision_id) VALUES($1,$2,$3)',[v,q,revision]);await db.query("INSERT INTO quote_export_attempts(id,version_id,order_id,revision_id,generation,input_version,format,document,basis_evidence,snapshot_hash,state,created_at,deadline) VALUES($1,$2,$3,$4,1,1,'pdf','{}','{}','fixture','succeeded',$5,$5)",[attempt,v,order,revision,instant]);await db.query("INSERT INTO quote_files(id,export_id,version_id,object_key,filename,sha256,size,content_type,format,created_at) VALUES($1,$2,$3,'safe-file','safe.pdf',$4,$5,'application/pdf','pdf',$6)",[file,attempt,v,createHash('sha256').update(content).digest('hex'),content.length,instant]);const {b}=await login(u),download=await ok('/files/'+file+'/download-url','POST',{},b);assert.equal((await fetch(new URL(download.url,base))).status,200);await db.query("UPDATE users SET role='admin' WHERE id=$1",[u.id]);await db.query("UPDATE users SET role='salesperson' WHERE id=$1",[u.id]);assert.equal((await fetch(new URL(download.url,base))).status,401);
});
test('同浏览器PC Cookie不能阻断独立厂家Bearer，也不能代替厂家凭证',async()=>{
 const u=await user(),{b}=await login(u),p=await user('hospital'),h=randomUUID(),order=randomUUID(),revision=randomUUID(),line=randomUUID(),m=randomUUID(),task=randomUUID(),link=randomUUID(),raw=randomUUID();
 await db.query("INSERT INTO hospitals(id,name,sales_user_id) VALUES($1,'厂家同源医院',$2)",[h,u.id]);await db.query('INSERT INTO hospital_purchasers(user_id,hospital_id) VALUES($1,$2)',[p.id,h]);await db.query("INSERT INTO purchase_orders(id,order_no,hospital_id,purchaser_user_id,sales_user_id,original_sales_user_id,received_date,payment_term_days,created_at,status) VALUES($1,$2,$3,$4,$5,$5,'2026-10-23',30,$6,'frozen')",[order,'CG-'+randomUUID(),h,p.id,u.id,instant]);await db.query('INSERT INTO purchase_order_revisions(id,purchase_order_id) VALUES($1,$2)',[revision,order]);await db.query("INSERT INTO purchase_order_lines(id,revision_id,position,name,spec,quantity,checked) VALUES($1,$2,0,'黄芪','斜片',1,true)",[line,revision]);await db.query("UPDATE purchase_order_revisions SET status='frozen' WHERE id=$1",[revision]);await db.query("INSERT INTO manufacturers(id,name) VALUES($1,'厂家同源测试')",[m]);await db.query('INSERT INTO supplier_tasks(id,revision_id,manufacturer_id,slot_no) VALUES($1,$2,$3,1)',[task,revision,m]);await db.query('INSERT INTO supplier_links(id,task_id,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',[link,task,secretHash(raw),new Date(now.getTime()+48*3600000),now]);
 const capability=(await ok('/supplier/session','POST',{token:raw},b)).sessionToken;
 assert.equal((await wire('/supplier/quote','GET',undefined,b,{Authorization:'Bearer '+capability})).status,200);
 assert.equal((await wire('/supplier/quote','GET',undefined,b)).status,410);
 assert.equal((await wire('/supplier/quote','GET',undefined,b,{Authorization:'Bearer '+sessionToken(b)})).status,410);
 b.cookies.set('quote_session_dev','expired-or-invalid-cookie');assert.equal((await wire('/h5/supplier-quote','GET',undefined,b,{Authorization:'Bearer '+capability})).status,200);
 const body={validUntil:'2026-10-25',lines:[{purchaseLineId:line,status:'quoted',unitPrice:'20.00'}]},key=randomUUID();assert.equal((await wire('/supplier/quote','POST',body,b,{Authorization:'Bearer '+capability,'Idempotency-Key':key,'X-CSRF-Token':''})).status,200);assert.equal((await wire('/operations/'+key,'GET',undefined,b,{Authorization:'Bearer '+capability})).status,200);
});
test('过期或角色变化的PC Cookie被清理，下一次可取得全新登录预会话',async()=>{
 for(const change of ['expire','role']){const u=await user(),{b}=await login(u);if(change==='expire')now=new Date(instant.getTime()+8*3600000);else await db.query("UPDATE users SET role='admin' WHERE id=$1",[u.id]);assert.equal((await wire('/auth/csrf','GET',undefined,b)).status,401);assert.equal(b.cookies.has('quote_session_dev'),false);b.csrf=(await ok('/auth/csrf','GET',undefined,b)).csrf;assert.ok(b.cookies.has('quote_pre_dev'));const current=(await db.query('SELECT role FROM users WHERE id=$1',[u.id])).rows[0].role;const data=await ok('/auth/pc/password-login','POST',{loginName:u.name,password},b);assert.equal(data.user.role,current);assert.equal(data.token,undefined);now=new Date(instant);}
});
