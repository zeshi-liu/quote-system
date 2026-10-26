import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
const rootPath=process.cwd();
const load=path=>import(pathToFileURL(rootPath+path).href);
const {createRenderer,nextTick}=await load('/apps/mini/node_modules/vue/dist/vue.runtime.esm-bundler.js');
const {parse,compileScript}=await load('/apps/mini/node_modules/vue/compiler-sfc/index.js');
const {createServer,transformWithEsbuild}=await load('/apps/mini/node_modules/vite/dist/node/index.js');
const node=(tag,text='')=>({tag,text,props:{},children:[],parent:null,tagName:tag.toUpperCase(),value:'',checked:false,addEventListener(){}});
const renderer=createRenderer({createElement:tag=>node(tag),createText:text=>node('#text',text),createComment:text=>node('#comment',text),setText:(n,t)=>n.text=t,setElementText:(n,t)=>{n.text=t;n.children=[]},parentNode:n=>n.parent,nextSibling:n=>{const a=n.parent?.children||[];return a[a.indexOf(n)+1]||null},patchProp:(n,k,o,v)=>{n.props[k]=v;if(['value','checked','type','multiple'].includes(k))n[k]=v},insert:(n,p,a)=>{if(n.parent){let s=n.parent.children;s.splice(s.indexOf(n),1)}n.parent=p;let i=a?p.children.indexOf(a):-1;i<0?p.children.push(n):p.children.splice(i,0,n)},remove:n=>{n.parent?.children.splice(n.parent.children.indexOf(n),1);n.parent=null}});
const all=n=>[n,...n.children.flatMap(all)],txt=n=>n.tag==='#comment'?'':n.text+n.children.map(txt).join('');
const tick=async()=>{for(let i=0;i<4;i++){await nextTick();await new Promise(setImmediate)}};

// The real root and child SFCs run against a fake uni transport; this is not browser/device acceptance.
const storage=new Map();let calls=[],role='salesperson',deferWrite=false,completeWrite;
const created={id:'new-order',orderNo:'NEW-01',version:1,lines:[],writable:true,submissionSource:'hospital_self',receivedDate:'2026-10-26',status:'draft',revisionId:'r1'};
globalThis.document={activeElement:null};globalThis.indexedDB={open(){throw new Error('This test must not read file bytes');}};
globalThis.uni={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),request:o=>{
 const path=o.url.split('/api/v1')[1];calls.push({path,method:o.method,data:o.data,header:o.header});
 if(path==='/unknown-write'){const finish=()=>o.fail({});if(deferWrite)completeWrite=finish;else setImmediate(finish);return;}
 let data;
 if(path==='/auth/me')data={id:'u',name:'测试',role};
 else if(path==='/auth/logout')data={};
 else if(path==='/files/query')data={items:[]};
 else if(path==='/sales/bootstrap')data={hospitals:[{id:'h',name:'测试医院',purchasers:[]}],manufacturers:[]};
 else if(path==='/sales/purchase-orders')data={items:[]};
 else if(path==='/sales/receivable-reminders/config')data={available:false};
 else if(path.startsWith('/sales/receivable-reminders?')||path.startsWith('/sales/historical-orders?'))data={items:[],total:0,page:1,pageSize:20,asOf:'2026-10-26T00:00:00Z'};
 else if(path==='/sales/hospitals/h/payment-term')data={hospitalId:'h',paymentTermDays:90,version:1};
 else if(path==='/hospital/bootstrap')data={hospital:{id:'h',name:'测试医院'},purchaser:{id:'u',name:'采购员'}};
 else if(path.startsWith('/hospital/purchase-orders?'))data={items:[],total:0,page:1};
 else if(path==='/hospital/purchase-suggestions')data={common:[],recent:[]};
 else if(path==='/hospital/purchase-orders'&&o.method==='POST'||path==='/hospital/purchase-orders/new-order')data=created;
 else throw new Error('Unexpected fake route '+path);
 setImmediate(()=>o.success({statusCode:200,data:{data}}));
}};
let vite,cacheDir,App,api;
test.before(async()=>{
 cacheDir=await mkdtemp(join(tmpdir(),'quote-mini-logout-'));
 vite=await createServer({root:rootPath+'/apps/mini',cacheDir,configFile:false,plugins:[{name:'logout-client',async transform(s,id){if(!id.endsWith('.vue'))return;const {descriptor}=parse(s,{filename:id}),c=compileScript(descriptor,{id:'logout',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false,cacheHandlers:false,isCustomElement:tag=>['view','text','picker','checkbox','checkbox-group','scroll-view'].includes(tag)}}});return transformWithEsbuild(c.content,id,{loader:'ts'});}}],optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error',server:{middlewareMode:true,hmr:{server:createHttpServer()}},appType:'custom'});
 App=(await vite.ssrLoadModule('/src/pages/index/index.vue')).default;api=await vite.ssrLoadModule('/src/api.ts');
});
test.after(async()=>{await vite?.close();await rm(cacheDir,{recursive:true,force:true});delete globalThis.uni;delete globalThis.document;delete globalThis.indexedDB;});
const button=(root,label)=>{const n=all(root).find(n=>n.tag==='button'&&txt(n).includes(label));assert.ok(n,'missing '+label);return n;};
const click=async(root,label)=>{const n=button(root,label);assert.equal(!!n.props.disabled,false,label+' should be enabled');await n.props.onClick({});await tick();};
async function mount(userRole='salesperson',sourcePending=null){
 storage.clear();calls=[];deferWrite=false;role=userRole;api.setSession(null);api.setSession({user:{id:'logout-'+role,name:'测试',role},token:'old-token'});if(sourcePending)storage.set('quote-source-pending-v1:logout-'+role,JSON.stringify(sourcePending));
 const root=node('root'),app=renderer.createApp(App);app.config.warnHandler=()=>{};app.mount(root);await tick();return{root,app};
}
for(const page of ['hospital','finance','historical'])test(page+' unsaved child form prevents silent logout until explicit discard',async()=>{
 const {root,app}=await mount(page==='hospital'?'hospital':'salesperson');try{
 if(page==='hospital'){await click(root,'新建采购单');await click(root,'手工添加');}
 if(page==='finance'){await click(root,'账期与催收');await click(root,'维护默认账期');all(root).find(n=>n.tag==='input'&&n.props.type==='number').props['onUpdate:modelValue']('60');await tick();}
 if(page==='historical'){await click(root,'历史纸单补录');await click(root,'新建历史补录');all(root).find(n=>n.tag==='input'&&n.props.placeholder==='未知留空').props['onUpdate:modelValue']('原纸单-001');await tick();}
 const before=calls.length;await click(root,'退出');assert.ok(api.session.value,'dirty '+page+' must keep session');assert.equal(calls.slice(before).some(c=>c.path==='/auth/logout'),false,'dirty '+page+' must not dispatch logout');assert.match(txt(root),/保存|放弃/);
 await click(root,page==='hospital'?'放弃未保存修改':'放弃本次修改');await click(root,'退出');assert.equal(api.session.value,null,'explicit discard permits logout');assert.equal(calls.filter(c=>c.path==='/auth/logout').length,1);
 }finally{app.unmount();}
});
test('in-flight operation blocks logout, unknown outcome permits logout and retains original user descriptor',async()=>{
 const {root,app}=await mount('hospital');try{
 await click(root,'新建采购单');await click(root,'手工添加');deferWrite=true;
 const mutation=api.mutate('未知操作','/unknown-write','POST',{originalAmount:'40.00'});assert.equal(api.operationInFlight.value,true);await tick();
 const exit=button(root,'退出');assert.equal(exit.props.disabled,true);await exit.props.onClick({});await tick();assert.ok(api.session.value);assert.equal(calls.some(c=>c.path==='/auth/logout'),false);
 completeWrite();await assert.rejects(mutation);await tick();const original=JSON.stringify(api.pending.value),saved=JSON.stringify(storage.get('quote-pending-logout-hospital'));assert.ok(original);assert.equal(api.operationInFlight.value,false);
 await click(root,'退出');assert.equal(api.session.value,null);assert.equal(JSON.stringify(storage.get('quote-pending-logout-hospital')),saved);assert.equal(calls.filter(c=>c.path==='/unknown-write').length,1);
 api.setSession({user:{id:'other',name:'其他',role:'hospital'},token:'other-token'});await tick();const before=calls.filter(c=>c.path==='/unknown-write').length;await assert.rejects(api.retryOperation(),/缺少|没有|旧操作/);assert.equal(calls.filter(c=>c.path==='/unknown-write').length,before,'other account must not dispatch old pending');assert.equal(storage.has('quote-pending-other'),false);
 api.setSession({user:{id:'logout-hospital',name:'原采购员',role:'hospital'},token:'new-token'});assert.equal(JSON.stringify(api.pending.value),original,'original account recovers exact descriptor');
 }finally{app.unmount();}
});

test('source recovery descriptor survives logout and a stale source retry cannot dispatch under another account',async()=>{
 const sourcePending={version:1,userId:'logout-hospital',key:'source-original-key',reference:{kind:'purchase_revision',orderId:'new-order',revisionId:'r1'},action:'parse',path:'/parsing/jobs',fileId:'original-file',body:{fileId:'original-file',parserType:'ocr'}};
 const {root,app}=await mount('hospital',sourcePending);try{
 assert.match(txt(root),/上次原单操作结果待核实/);const staleRetry=button(root,'原请求重试').props.onClick,saved=storage.get('quote-source-pending-v1:logout-hospital');await click(root,'退出');assert.equal(api.session.value,null);assert.equal(storage.get('quote-source-pending-v1:logout-hospital'),saved);
 api.setSession({user:{id:'other-source',name:'其他采购员',role:'hospital'},token:'other-source-token'});await tick();await staleRetry({});await tick();assert.equal(calls.some(c=>c.path==='/parsing/jobs'),false,'disposed source retry must not use new account credentials');assert.equal(storage.get('quote-source-pending-v1:logout-hospital'),saved);assert.equal(storage.has('quote-source-pending-v1:other-source'),false);
 }finally{app.unmount();}
});
