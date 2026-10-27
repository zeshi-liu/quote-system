import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as createHttpServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const base=process.cwd(),load=p=>import(pathToFileURL(base+p).href);
const {createRenderer,nextTick,h,reactive}=await load('/apps/pc/node_modules/vue/dist/vue.runtime.esm-bundler.js');
const {parse,compileScript}=await load('/apps/pc/node_modules/vue/compiler-sfc/index.js');
const {createServer,transformWithEsbuild}=await load('/apps/pc/node_modules/vite/dist/node/index.js');
const node=(tag,text='')=>{const n={tag,text,props:{},children:[],parent:null,tagName:tag.toUpperCase(),value:'',checked:false,addEventListener(){}};Object.defineProperty(n,'options',{get:()=>n.children.filter(c=>c.tag==='option')});return n};
const renderer=createRenderer({createElement:tag=>node(tag),createText:text=>node('#text',text),createComment:text=>node('#comment',text),setText:(n,t)=>n.text=t,setElementText:(n,t)=>{n.text=t;n.children=[]},parentNode:n=>n.parent,nextSibling:n=>{const a=n.parent?.children||[];return a[a.indexOf(n)+1]||null},patchProp:(n,k,o,v)=>{n.props[k]=v;if(['value','checked','type','multiple'].includes(k))n[k]=v},insert:(n,p,a)=>{if(n.parent){const c=n.parent.children;c.splice(c.indexOf(n),1)}n.parent=p;const i=a?p.children.indexOf(a):-1;i<0?p.children.push(n):p.children.splice(i,0,n)},remove:n=>{n.parent?.children.splice(n.parent.children.indexOf(n),1);n.parent=null}});
const all=n=>[n,...n.children.flatMap(all)],text=n=>n.tag==='#comment'?'':n.text+n.children.map(text).join('');
const tick=async()=>{for(let i=0;i<5;i++){await nextTick();await new Promise(setImmediate)}};
const button=(r,s)=>all(r).find(n=>n.tag==='button'&&text(n)===s);
async function click(r,s){const n=button(r,s);assert.ok(n,'Missing '+s);assert.ok(!n.props.disabled,'Disabled '+s);const result=n.props.onClick({});await tick();await result;await tick();}
const field=(r,label)=>{const l=all(r).find(n=>n.tag==='label'&&text(n).startsWith(label));assert.ok(l,'Missing field '+label);return all(l).find(n=>['input','textarea','select'].includes(n.tag))};
async function set(r,label,value){field(r,label).props['onUpdate:modelValue'](value);await tick();}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const storage=new Map(),localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
let nativePrompts=0;
globalThis.window={localStorage,confirm:()=>{nativePrompts++;return true},addEventListener(){},removeEventListener(){}};
globalThis.document={activeElement:null};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,_options,fn)=>fn()}}});
const cacheDir=await mkdtemp(join(tmpdir(),'quote-pc-delivery-review-'));
const vite=await createServer({root:base+'/apps/pc',cacheDir,configFile:false,plugins:[{name:'delivery-component-test',async transform(s,id){if(!id.endsWith('.vue'))return;const {descriptor}=parse(s,{filename:id}),c=compileScript(descriptor,{id:'delivery-test',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false,cacheHandlers:false}}});return transformWithEsbuild(c.content,id,{loader:'ts'})}}],optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error',server:{middlewareMode:true,hmr:{server:createHttpServer()}},appType:'custom'});
test.after(async()=>{await vite.close();await rm(cacheDir,{recursive:true,force:true})});
const {BusinessOperations}=await vite.ssrLoadModule('/src/business-pending.ts');
const order=(extra={})=>({id:'o',orderNo:'ORDER-1',hospitalId:'h',hospitalName:'测试医院',receivedDate:'2026-10-26',purchaserUserId:'p',writable:true,revisionId:'r',revisionNo:1,version:7,status:'quote_sent',lines:[],tasks:[],draftId:null,quoteId:'q',...extra});
const version=(extra={})=>({id:'v',quoteId:'q',orderId:'o',versionNo:2,version:11,status:'sent',document:{schemaVersion:1,quoteNo:'QUOTE-1',versionNo:2,hospitalName:'测试医院',sellerName:'供货公司',quoteDate:'2026-10-26',salespersonName:'销售',contact:'联系人',validUntil:'2026-11-01',taxNote:'含税',notes:'',lines:[{position:1,name:'药品',spec:'规格',unit:'kg',quantity:'2.00',status:'priced',unitPrice:'12.00',amount:'24.00',remark:''}],total:'24.00'},firstExportedAt:'2026-10-26T00:00:00Z',useInvalidatedAt:null,firstSentAt:'2026-10-26T01:00:00Z',hospitalConfirmedAt:null,recordedAt:null,backfillReason:null,occupied:false,eligible:true,blockReason:null,requiresLossAcknowledgement:false,files:[{id:'f',format:'pdf',filename:'报价.pdf',createdAt:'2026-10-26T00:00:00Z'}],sends:[],receivable:null,...extra});
function operations(write=async()=>({id:'v',quoteId:'q',orderId:'o'})){storage.clear();return new BusinessOperations('test-user',async()=>({status:'not_found'}),write,localStorage,()=>crypto.randomUUID(),async(_name,fn)=>fn())}
async function panel({initial=version(),get,ops=operations(),extra={}}={}){
 storage.clear();nativePrompts=0;let server=initial;const reads=[],events=[],failures=[];
 const api={get:async p=>{reads.push(p);if(get)return get(p,server);return p.endsWith('/quote-versions')?{quoteId:server.quoteId,items:[structuredClone(server)]}:structuredClone(server)},post:async()=>({}),write:async()=>({})};
 const props=reactive({api,order:order(),operations:ops,userId:'test-user',locked:false,...extra});
 const Component=(await vite.ssrLoadModule('/src/components/QuoteDelivery.vue')).default,root=node('root');
 const app=renderer.createApp({render:()=>h(Component,{...props,onBusyChanged:v=>events.push(['busy',v]),onChanged:()=>events.push(['changed']),onFailure:e=>failures.push(e)})});app.config.warnHandler=()=>{};app.mount(root);await tick();
 return{root,app,props,events,failures,reads,server:v=>{server=v}};
}
async function beginReview(m){await set(m.root,'实际确认日期','2026-10-26');await set(m.root,'实际确认时间','15:30:45');await set(m.root,'延迟补录原因','医院已电话确认');const start=button(m.root,'登记最终确认');start.props.onClick({});await tick();assert.ok(button(m.root,'确认登记'),'first click must open review before submitting');}

test('delivery refresh emits changed after unlock only on successful reads and renders Chinese export states',async()=>{
 const m=await panel();try{
  assert.deepEqual(m.events.slice(-2),[['busy',false],['changed']]);
  for(const [state,label] of [['queued','排队中'],['running','正在生成文件'],['succeeded','文件已成功生成'],['failed','导出失败']]){m.server(version({latestJob:{id:'j',orderId:'o',versionId:'v',state,attempts:1,error:null,fileId:null,retryAt:null}}));await click(m.root,'刷新任务及版本');assert.match(text(m.root),new RegExp(label));assert.doesNotMatch(text(m.root),new RegExp('任务：'+state));}
  const changed=m.events.filter(e=>e[0]==='changed').length;m.props.api={...m.props.api,get:async()=>{throw Error('读取失败')}};await tick();await click(m.root,'刷新任务及版本');assert.equal(m.events.filter(e=>e[0]==='changed').length,changed);assert.equal(m.failures.at(-1).message,'读取失败');
 }finally{m.app.unmount()}
});

test('hospital confirmation requires an in-page review, cancellation writes nothing and keeps entered values',async()=>{
 const writes=[],m=await panel({ops:operations(async(...args)=>{writes.push(args);return{id:'v'}})});try{
  await beginReview(m);assert.equal(nativePrompts,0);assert.deepEqual(writes,[]);assert.match(text(m.root),/确认登记前复核/);assert.match(text(m.root),/测试医院/);assert.match(text(m.root),/ORDER-1/);assert.match(text(m.root),/QUOTE-1.*V2/);assert.match(text(m.root),/¥ 24.00/);assert.match(text(m.root),/2026-10-26 15:30:45 北京时间/);assert.match(text(m.root),/医院已电话确认/);
  assert.equal(field(m.root,'实际确认日期').props.disabled,true);assert.equal(button(m.root,'刷新任务及版本').props.disabled,true);assert.deepEqual(m.events.at(-1),['busy',true]);
  await click(m.root,'返回修改');assert.deepEqual(writes,[]);assert.equal(field(m.root,'实际确认日期').value,'2026-10-26');assert.equal(field(m.root,'延迟补录原因').value,'医院已电话确认');assert.equal(field(m.root,'实际确认日期').props.disabled,false);assert.deepEqual(m.events.at(-1),['busy',false]);
 }finally{m.app.unmount()}
});

test('final confirmation submits its reviewed snapshot once and releases the parent lock before changed',async()=>{
 const gate=deferred(),writes=[],m=await panel({ops:operations(async(...args)=>{writes.push(args);return gate.promise})});try{
  await beginReview(m);await set(m.root,'实际确认日期','2026-10-27');await set(m.root,'延迟补录原因','不应覆盖已复核内容');const final=button(m.root,'确认登记'),submit=final.props.onClick({});await tick();final.props.onClick({});await tick();assert.equal(writes.length,1);assert.equal(button(m.root,'确认登记')?.props.disabled??true,true);
  assert.deepEqual(writes[0].slice(0,3),['/quotes/q/versions/v/confirm','POST',{expectedVersion:11,hospitalConfirmedAt:'2026-10-26T07:30:45.000Z',backfillReason:'医院已电话确认'}]);
  m.server(version({status:'confirmed',version:12,hospitalConfirmedAt:'2026-10-26T07:30:45.000Z'}));gate.resolve({id:'v',quoteId:'q',orderId:'o'});await submit;await tick();assert.deepEqual(m.events.slice(-2),[['busy',false],['changed']]);assert.equal(m.props.operations.pending,null);
 }finally{m.app.unmount()}
});

test('a canceled review handler cannot submit a later review',async()=>{
 const writes=[],m=await panel({ops:operations(async(...args)=>{writes.push(args);return{id:'v',quoteId:'q',orderId:'o'}})});try{await beginReview(m);const stale=button(m.root,'确认登记').props.onClick;await click(m.root,'返回修改');await set(m.root,'实际确认时间','16:00:00');await click(m.root,'登记最终确认');await stale({});await tick();assert.deepEqual(writes,[]);assert.ok(button(m.root,'确认登记'));await click(m.root,'确认登记');assert.equal(writes.length,1);assert.equal(writes[0][2].hospitalConfirmedAt,'2026-10-26T08:00:00.000Z');}finally{m.app.unmount()}
});

test('review invalidates when order, account, operations, permission or version context changes',async()=>{
 for(const change of [m=>{m.props.order={...m.props.order,id:'other'}},m=>{m.props.order={...m.props.order,hospitalId:'other'}},m=>{m.props.order={...m.props.order,revisionId:'next'}},m=>{m.props.order={...m.props.order,version:8}},m=>{m.props.order={...m.props.order,writable:false}},m=>{m.props.userId='other-account'},m=>{m.props.operations=operations()}]){
  const writes=[],m=await panel({ops:operations(async(...args)=>{writes.push(args);return{id:'v'}})});try{await beginReview(m);const stale=button(m.root,'确认登记').props.onClick;change(m);await tick();assert.equal(button(m.root,'确认登记'),undefined);await stale({});await tick();assert.deepEqual(writes,[]);}finally{m.app.unmount()}
 }
});

test('review invalidates when the displayed quote version or amount changes',async()=>{
 for(const change of [v=>{v.version++},v=>{v.document.total='25.00'}]){const live=reactive(version()),writes=[],m=await panel({get:async p=>p.endsWith('/quote-versions')?{quoteId:'q',items:[live]}:live,ops:operations(async(...args)=>{writes.push(args);return{id:'v'}})});try{await beginReview(m);const stale=button(m.root,'确认登记').props.onClick;change(live);await tick();assert.equal(button(m.root,'确认登记'),undefined);await stale({});await tick();assert.deepEqual(writes,[]);}finally{m.app.unmount()}}
});

test('late confirmation results and failures cannot update a different order or unmounted account',async()=>{
 for(const fail of [false,true]){for(const unmount of [false,true]){const gate=deferred(),m=await panel({ops:operations(()=>gate.promise)});await beginReview(m);const submit=button(m.root,'确认登记').props.onClick({});await tick();const changed=m.events.filter(e=>e[0]==='changed').length,reads=m.reads.length;
  if(unmount)m.app.unmount();else{m.props.order={...m.props.order,id:'other',orderNo:'ORDER-OTHER'};await tick()}
  if(fail)gate.reject(Error('旧账号请求失败'));else gate.resolve({id:'v',quoteId:'q',orderId:'o'});await submit;await tick();assert.equal(m.events.filter(e=>e[0]==='changed').length,changed);assert.deepEqual(m.failures,[]);assert.equal(m.reads.length,reads);if(!unmount)m.app.unmount();
 }}
});

test('all-missing review explicitly completes without a receivable amount',async()=>{
 const missing=version();missing.document.total=null;missing.document.validUntil=null;missing.document.lines=missing.document.lines.map(l=>({...l,status:'missing',unitPrice:null,amount:null}));const m=await panel({initial:missing});try{await set(m.root,'实际确认日期','2026-10-26');await set(m.root,'实际确认时间','15:30');await click(m.root,'确认已知悉并完成');assert.match(text(m.root),/不适用（全部缺货）/);assert.match(text(m.root),/不产生应收/);assert.doesNotMatch(text(m.root),/¥\s*0(?:\.00)?/);assert.ok(button(m.root,'确认登记'));assert.equal(nativePrompts,0);}finally{m.app.unmount()}
});

test('unknown confirmation retains the original pending operation and blocks a replacement write',async()=>{
 const writes=[],ops=operations(async(...args)=>{writes.push(args);throw Object.assign(Error('结果未知'),{code:'RESPONSE_UNKNOWN'})}),m=await panel({ops});try{await beginReview(m);await click(m.root,'确认登记');assert.equal(writes.length,1);assert.ok(ops.pending);const original=structuredClone(ops.pending);assert.equal(original.body.hospitalConfirmedAt,'2026-10-26T07:30:45.000Z');assert.equal(m.failures.at(-1).message,'结果未知');m.props.locked=true;await tick();assert.equal(button(m.root,'登记最终确认').props.disabled,true);await ops.check();assert.deepEqual(ops.pending,original);await assert.rejects(()=>ops.retry(),/结果未知/);assert.deepEqual(writes[1],writes[0]);assert.deepEqual(ops.pending,original);}finally{m.app.unmount()}
});

const pricingDraft=()=>({id:'v',quoteId:'q',orderId:'o',version:11,lines:[{purchaseLineId:'l',name:'药品',spec:'规格',quantity:'1.00',kind:'priced',baseValid:true,basePrice:'10.00',finalPrice:'12.00',finalConfirmed:true,markupMethod:null,parameterValue:null,recommendedPrice:null,publicRemark:'',lossReason:'',baseSupplierQuoteLineId:'s',selectionMode:'auto'}],maxValidUntil:'2026-11-01',hospitalValidUntil:'2026-11-01'});
async function workbench(){
 storage.clear();let currentOrder=order({status:'quote_draft',draftId:'v',tasks:[{id:'a',slotNo:1,manufacturerName:'厂家甲',status:'pending',validUntil:null,linkId:'link-a',submissionId:null},{id:'b',slotNo:2,manufacturerName:'厂家乙',status:'submitted',validUntil:'2026-11-01',linkId:'link-b',submissionId:'sub'}]}),currentVersion=version({status:'draft',files:[],occupied:true,latestJob:{id:'j',orderId:'o',versionId:'v',state:'queued',attempts:0,error:null,fileId:null,retryAt:null}});const reads=[],writes=[],busy=[];
 const api={get:async p=>{reads.push(p);await new Promise(setImmediate);if(p==='/sales/bootstrap')return{hospitals:[{id:'h',name:'测试医院',purchasers:[{id:'p',name:'采购员'}]}],manufacturers:[]};if(p==='/sales/purchase-orders')return{items:[structuredClone(currentOrder)]};if(p==='/sales/purchase-orders/o')return structuredClone(currentOrder);if(p.endsWith('/comparison'))return{lines:[],submittedCount:2};if(p.endsWith('/draft'))return pricingDraft();if(p.endsWith('/quote-versions'))return{quoteId:'q',items:[structuredClone(currentVersion)]};if(p.endsWith('/preview'))return structuredClone(currentVersion);throw Error(p)},post:async()=>({}),write:async(...args)=>{writes.push(args);return pricingDraft()}};
 const Component=(await vite.ssrLoadModule('/src/components/SalesWorkbench.vue')).default,root=node('root'),app=renderer.createApp(Component,{api,userId:'test-user',onBusyChanged:v=>busy.push(v)});app.config.warnHandler=()=>{};app.mount(root);await tick();await click(root,'处理订单');return{root,app,reads,writes,busy,server:(o,v)=>{if(o)currentOrder=o;if(v)currentVersion=v},order:()=>structuredClone(currentOrder)};
}
test('workbench shows Chinese supplier states and a real saved pricing notice',async()=>{
 const m=await workbench();try{assert.match(text(m.root),/待提交/);assert.match(text(m.root),/已提交/);assert.doesNotMatch(text(m.root),/pending|submitted/);const updated=m.order();updated.tasks[0].status='requote';updated.tasks[1].status='cancelled';m.server(updated);await click(m.root,'刷新厂家报价');assert.match(text(m.root),/重询中/);assert.match(text(m.root),/已取消/);
  await click(m.root,'计价草稿');const price=all(m.root).find(n=>n.tag==='input'&&n.value==='12.00');price.props['onUpdate:modelValue']('13.00');price.props.onInput({});await tick();assert.match(text(m.root),/有未保存修改/);await click(m.root,'保存并预览报价');assert.match(text(m.root),/计价草稿已保存/);assert.doesNotMatch(text(m.root),/有未保存修改/);assert.equal(m.writes.length,1);
 }finally{m.app.unmount()}
});

test('refreshing export completion updates parent order status without a refresh loop',async()=>{
 const m=await workbench();try{await click(m.root,'预览与交付');assert.match(text(m.root),/ORDER-1 · R1 · 计价中/);m.server({...m.order(),status:'quote_exported',draftId:null},version({status:'exported',latestJob:{id:'j',orderId:'o',versionId:'v',state:'succeeded',attempts:1,error:null,fileId:'f',retryAt:null}}));const before=m.reads.filter(p=>p==='/sales/purchase-orders/o').length;await click(m.root,'刷新任务及版本');assert.match(text(m.root),/ORDER-1 · R1 · 已导出/);assert.equal(m.reads.filter(p=>p==='/sales/purchase-orders/o').length,before+1);const total=m.reads.length;await tick();assert.equal(m.reads.length,total);}finally{m.app.unmount()}
});

test('review locks outer workbench navigation and can still submit without a self-lock deadlock',async()=>{
 const m=await workbench();try{m.server({...m.order(),status:'quote_sent',draftId:null},version());await click(m.root,'预览与交付');await set(m.root,'实际确认日期','2026-10-26');await set(m.root,'实际确认时间','15:30');await click(m.root,'登记最终确认');assert.equal(button(m.root,'近期订单').props.disabled,true);assert.equal(button(m.root,'采购明细').props.disabled,true);assert.equal(m.busy.at(-1),true);await click(m.root,'返回修改');assert.equal(button(m.root,'近期订单').props.disabled,false);await click(m.root,'登记最终确认');await click(m.root,'确认登记');assert.equal(m.writes.length,1);assert.equal(m.writes[0][0],'/quotes/q/versions/v/confirm');assert.equal(button(m.root,'近期订单').props.disabled,false);}finally{m.app.unmount()}
});
