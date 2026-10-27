import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRenderer,nextTick} from 'vue';
import {parse,compileScript} from 'vue/compiler-sfc';
import type {ViteDevServer} from 'vite';
type Node={tag:string;text:string;props:Record<string,any>;children:Node[];parent:Node|null};
const node=(tag:string,text=''):Node=>({tag,text,props:{},children:[],parent:null});
const renderer=createRenderer<Node,Node>({createElement:tag=>node(tag),createText:text=>node('#text',text),createComment:text=>node('#comment',text),setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;n.children=[];},parentNode:n=>n.parent,nextSibling:n=>{const children=n.parent?.children||[];return children[children.indexOf(n)+1]||null;},patchProp:(n,key,_old,value)=>{n.props[key]=value;},insert:(n,p,anchor)=>{if(n.parent){const old=n.parent.children;old.splice(old.indexOf(n),1);}n.parent=p;const i=anchor?p.children.indexOf(anchor):-1;if(i<0)p.children.push(n);else p.children.splice(i,0,n);},remove:n=>{if(n.parent){const list=n.parent.children;list.splice(list.indexOf(n),1);n.parent=null;}}});
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
const textOf=(n:Node):string=>n.tag==='#comment'?'':n.text+n.children.map(textOf).join('');
const tick=async()=>{await nextTick();await new Promise<void>(r=>setImmediate(r));await nextTick();};
const button=(root:Node,text:string)=>{const found=all(root).find(n=>n.tag==='button'&&textOf(n).includes(text));assert.ok(found,'Missing button '+text);return found;};
let vite:ViteDevServer,cacheDir:string,Dashboard:any;
test.before(async()=>{const {createServer,transformWithEsbuild}=await import('vite');cacheDir=await mkdtemp(resolve(tmpdir(),'quote-dashboard-ui-'));vite=await createServer({root:resolve('apps/pc'),cacheDir,configFile:false,plugins:[{name:'dashboard-client-sfc',async transform(source,id){if(!id.endsWith('.vue'))return;const {descriptor}=parse(source,{filename:id});const compiled=compileScript(descriptor,{id:'test',inlineTemplate:true,templateOptions:{ssr:false,compilerOptions:{hoistStatic:false,cacheHandlers:false}}});return transformWithEsbuild(compiled.content,id,{loader:'ts'});}}],optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error',server:{middlewareMode:true,hmr:{server:createHttpServer()}},appType:'custom'});Dashboard=(await vite.ssrLoadModule('/src/components/SalesDashboard.vue')).default;});
test.after(async()=>{await vite?.close();if(cacheDir)await rm(cacheDir,{recursive:true,force:true});});
function data(){return {asOf:'2026-10-24T02:00:00Z',businessDate:'2026-10-24',notices:{unreadTotal:24,newPurchases:{total:23,limit:20,items:[{kind:'hospital_purchase',eventId:'purchase-event',orderId:'purchase-order',orderNo:'NEW-PURCHASE',hospitalName:'新需求医院',revisionNo:1,occurredAt:'2026-10-24T01:00:00Z'}]},newSupplierQuotes:{total:1,limit:20,items:[{kind:'supplier_quote',eventId:'supplier-event',orderId:'supplier-order',orderNo:'NEW-SUPPLIER',hospitalName:'新报价医院',revisionNo:1,manufacturerName:'厂家甲',occurredAt:'2026-10-24T01:00:00Z'}]}},tasks:{total:28,limit:20,counts:{review:22,inquiry:1,ready:2,pricing:1,exported:1,sent:1},items:[{orderId:'order',orderNo:'CG-REAL',hospitalName:'接口测试医院',receivedDate:'2026-10-01',revisionNo:2,stage:'ready',lineCount:3,validSupplierCount:1}]},receivables:{outstandingCount:13,outstandingBalance:'1234.56',dueCount:2,dueBalance:'100.00',overdueCount:3,overdueBalance:'200.00',pausedCount:1,pausedBalance:'300.00',followUpCount:11,limit:10,items:[{receivableId:'ar',orderId:'order',orderNo:'CG-REAL',hospitalName:'接口测试医院',dueDate:'2026-10-22',amount:'400.00',paid:'100.00',balance:'300.00',overdueDays:2,paused:true}]}};}
function mount(get:(path:string)=>Promise<unknown>,post:(path:string,body:any)=>Promise<unknown>=async()=>{throw Error('unexpected write');}){const root=node('root'),events:{name:string;value:any}[]=[],app=renderer.createApp(Dashboard,{api:{get,post},onOpenOrder:(value:any)=>events.push({name:'order',value}),onCreatePurchase:()=>events.push({name:'create',value:true}),onOpenReceivables:()=>events.push({name:'receivables',value:true}),onOpenFinance:(value:any)=>events.push({name:'finance',value}),onFailure:(value:any)=>events.push({name:'failure',value}),onBusyChanged:(value:any)=>events.push({name:'busy',value})});const instance=app.mount(root) as any;return {root,app,events,instance};}
test('工作台显示接口全量总数、展示范围、暂停催收和真实金额，点击进入真实业务',async()=>{const paths:string[]=[],m=mount(async(path)=>{paths.push(path);return data();});try{await tick();assert.deepEqual(paths,["/sales/dashboard"]);const text=textOf(m.root);assert.match(text,/报价待办/);assert.match(text,/回款跟进/);assert.match(text,/共 28 单/);assert.match(text,/前 20 单/);assert.match(text,/共 11 单/);assert.match(text,/前 10 单/);assert.match(text,/1,234.56/);assert.match(text,/暂停催收/);assert.match(text,/不催收/);assert.match(text,/100.00/);assert.match(text,/300.00/);assert.match(text,/2026-10-24 10:00:00/);assert.match(text,/需确认提前计价/);await button(m.root,'进入计价').props.onClick();await button(m.root,'新建采购单').props.onClick();await button(m.root,'全部采购单').props.onClick();await button(m.root,'回款台账').props.onClick();await button(m.root,'处理异常').props.onClick();assert.deepEqual(m.events.filter(e=>!['busy','failure'].includes(e.name)),[{name:'order',value:'order'},{name:'create',value:true},{name:'order',value:undefined},{name:'receivables',value:true},{name:'finance',value:{orderId:'order',receivableId:'ar'}}]);}finally{m.app.unmount();}});
test('读取失败明确报错可刷新；卸载后迟到的失败不会覆盖新会话或发业务事件',async()=>{const m=mount(async()=>{throw new Error('读取失败测试');});await tick();assert.match(textOf(m.root),/读取失败测试/);assert.ok(m.events.some(e=>e.name==='failure'));m.app.unmount();let reject!:(e:Error)=>void;const pending=mount(()=>new Promise((_r,j)=>{reject=j;}));await tick();pending.app.unmount();reject(new Error('过期请求'));await tick();assert.equal(pending.events.filter(e=>e.name==='failure').length,0);assert.equal(pending.events.at(-1)?.value,false);});

test('PC站内角标显示全量和事件链接，只有显式确认当前展示事件才写已读',async()=>{
 const writes:any[]=[],m=mount(async()=>data(),async(path,body)=>{writes.push({path,body});return {acknowledged:body.events};});
 try{await tick();assert.match(textOf(m.root),/新采购单.*23/);assert.match(textOf(m.root),/新厂家报价.*1/);await button(m.root,'查看新采购单').props.onClick();await button(m.root,'查看厂家报价').props.onClick();assert.deepEqual(m.events.filter(e=>e.name==='order').map(e=>e.value),['purchase-order','supplier-order']);assert.equal(writes.length,0);
 await button(m.root,'将当前展示提示标记已读').props.onClick();assert.deepEqual(writes,[{path:'/sales/dashboard/notices/ack',body:{events:[{kind:'hospital_purchase',eventId:'purchase-event'},{kind:'supplier_quote',eventId:'supplier-event'}]}}]);
 }finally{m.app.unmount();}
});
test('PC已读响应未知保留角标及原事件重试，成功后刷新保留新到提示',async()=>{
 const writes:any[]=[],next=data();next.notices={unreadTotal:1,newPurchases:{total:1,limit:20,items:[{...next.notices.newPurchases.items[0],eventId:'arriving-event'}]},newSupplierQuotes:{total:0,limit:20,items:[]}};let reads=0;
 const m=mount(async()=>++reads===1?data():next,async(path,body)=>{writes.push({path,body:JSON.parse(JSON.stringify(body))});if(writes.length===1)throw Error('网络结果未知');return {acknowledged:body.events};});
 try{await tick();await button(m.root,'将当前展示提示标记已读').props.onClick();assert.match(textOf(m.root),/标记结果未确认/);assert.match(textOf(m.root),/新采购单.*23/);await button(m.root,'重试已读标记').props.onClick();assert.deepEqual(writes[0],writes[1]);assert.equal(reads,2);assert.match(textOf(m.root),/新采购单.*1/);assert.ok(!textOf(m.root).includes('标记结果未确认'));
 }finally{m.app.unmount();}
});
test('PC卸载后迟到已读回执不发刷新或成功事件，读取及写入期间禁止重复动作',async()=>{
 let finish!:(v:unknown)=>void,reads=0;const m=mount(async()=>{reads++;return data();},()=>new Promise(r=>{finish=r;}));await tick();const work=button(m.root,'将当前展示提示标记已读').props.onClick();await tick();assert.equal(button(m.root,'正在标记…').props.disabled,true);m.app.unmount();const failures=m.events.filter(e=>e.name==='failure').length;finish({acknowledged:[{kind:'hospital_purchase',eventId:'purchase-event'},{kind:'supplier_quote',eventId:'supplier-event'}]});await work;await tick();assert.equal(reads,1);assert.equal(m.events.filter(e=>e.name==='failure').length,failures);
});

test('PC rejected old event can refresh then acknowledge the newly displayed event',async()=>{
 for(const status of [400,403,404]){
  const initial=data(),next=data(),writes:any[]=[];initial.notices={unreadTotal:1,newPurchases:{total:0,limit:20,items:[]},newSupplierQuotes:{total:1,limit:20,items:[{...initial.notices.newSupplierQuotes.items[0],eventId:'old-S'}]}};next.notices={...initial.notices,newSupplierQuotes:{total:1,limit:20,items:[{...initial.notices.newSupplierQuotes.items[0],eventId:'new-N'}]}};let reads=0;
  const m=mount(async()=>++reads===1?initial:next,async(_path,body)=>{writes.push(JSON.parse(JSON.stringify(body)));if(writes.length===1)throw Object.assign(Error('event rejected'),{status});return {acknowledged:body.events};});
  try{await tick();await button(m.root,'将当前展示提示标记已读').props.onClick();assert.match(textOf(m.root),/提示或权限已变化，请重新读取核对/);assert.ok(!textOf(m.root).includes('重试已读标记'));await button(m.root,'刷新').props.onClick();await button(m.root,'将当前展示提示标记已读').props.onClick();assert.deepEqual(writes.map(w=>w.events),[[{kind:'supplier_quote',eventId:'old-S'}],[{kind:'supplier_quote',eventId:'new-N'}]],'definitive '+status+' must release only the rejected old batch');}
  finally{m.app.unmount();}
 }
});
test('PC refresh preserves the exact original ACK after network, 5xx or 408 unknown outcomes',async()=>{
 for(const status of [undefined,500,408]){const initial=data(),next=data(),writes:any[]=[];next.notices={unreadTotal:1,newPurchases:{total:1,limit:20,items:[{...next.notices.newPurchases.items[0],eventId:'new-N'}]},newSupplierQuotes:{total:0,limit:20,items:[]}};let reads=0;const m=mount(async()=>++reads===1?initial:next,async(_path,body)=>{writes.push(JSON.parse(JSON.stringify(body)));if(writes.length===1)throw Object.assign(Error('unknown outcome'),{status});return {acknowledged:body.events};});
  try{await tick();await button(m.root,'将当前展示提示标记已读').props.onClick();await button(m.root,'刷新').props.onClick();assert.match(textOf(m.root),/标记结果未确认/);await button(m.root,'重试已读标记').props.onClick();assert.deepEqual(writes[0],writes[1]);assert.ok(!JSON.stringify(writes[1]).includes('new-N'));}
  finally{m.app.unmount();}
 }
});

test('PC unknown response codes preserve original ACK IDs even when carrying 2xx or 4xx statuses',async()=>{
 for(const failure of [{status:200,code:'RESPONSE_UNKNOWN'},{status:400,code:'RESPONSE_UNKNOWN'},{status:404,code:'RESPONSE_UNKNOWN'},{status:409,code:'BUSY_RETRY_REQUIRED'},{status:400,code:'REQUEST_TIMEOUT'},{status:400,code:'NETWORK_ERROR'},{status:400,code:'CUSTOM_UNKNOWN'},{status:400,code:'VALIDATION_FAILED',unknown:true}]){
  const initial=data(),next=data(),writes:any[]=[];next.notices={unreadTotal:1,newPurchases:{total:1,limit:20,items:[{...next.notices.newPurchases.items[0],eventId:'new-N'}]},newSupplierQuotes:{total:0,limit:20,items:[]}};let reads=0;
  const m=mount(async()=>++reads===1?initial:next,async(_path,body)=>{writes.push(JSON.parse(JSON.stringify(body)));if(writes.length===1)throw Object.assign(Error('unknown provider outcome'),failure);return {acknowledged:body.events};});
  try{await tick();await button(m.root,'将当前展示提示标记已读').props.onClick();assert.match(textOf(m.root),/标记结果未确认/,JSON.stringify(failure));await button(m.root,'刷新').props.onClick();await button(m.root,'重试已读标记').props.onClick();assert.deepEqual(writes[0],writes[1],JSON.stringify(failure));assert.ok(!JSON.stringify(writes[1]).includes('new-N'));}
  finally{m.app.unmount();}
 }
});
