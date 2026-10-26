import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRenderer,h,nextTick,reactive} from 'vue';
import {parse,compileScript} from 'vue/compiler-sfc';
import type {ViteDevServer} from 'vite';

type Node={tag:string;text:string;props:Record<string,any>;children:Node[];parent:Node|null};
const node=(tag:string,text=''):Node=>({tag,text,props:{},children:[],parent:null});
const renderer=createRenderer<Node,Node>({createElement:tag=>node(tag),createText:text=>node('#text',text),createComment:text=>node('#comment',text),setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;n.children=[];},parentNode:n=>n.parent,nextSibling:n=>{const c=n.parent?.children||[];return c[c.indexOf(n)+1]||null;},patchProp:(n,key,_old,value)=>{n.props[key]=value;},insert:(n,p,anchor)=>{if(n.parent){const old=n.parent.children;old.splice(old.indexOf(n),1);}n.parent=p;const i=anchor?p.children.indexOf(anchor):-1;i<0?p.children.push(n):p.children.splice(i,0,n);},remove:n=>{if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);}});
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
const text=(n:Node):string=>n.tag==='#comment'?'':n.text+n.children.map(text).join('');
const find=(n:Node,tag:string,label:string)=>{const found=all(n).find(v=>v.tag===tag&&text(v).includes(label));assert.ok(found,`missing ${tag} ${label}: ${text(n)}`);return found;};
const tick=async()=>{await nextTick();await new Promise<void>(r=>setImmediate(r));await nextTick();};
const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const reference={kind:'purchase_revision',orderId:'a',revisionId:'ra'};
const file=(ref=reference,type='png')=>({id:'f',reference:ref,fileName:'private.'+type,fileType:type,mimeType:type==='png'?'image/png':'text/csv',purpose:type==='png'?'purchase_image':'purchase_excel',byteSize:4,uploadedBy:'u',createdAt:'2026-10-26T00:00:00Z',parentFileId:null});
const job={id:'j',fileId:'f',status:'succeeded',parserType:'spreadsheet',attempts:1,rawRows:[{rowNumber:1,cells:['名','量'],errors:[]}],confidence:null,applied:false};
const originalFetch=globalThis.fetch;
let servers:ViteDevServer[]=[],dirs:string[]=[],Pc:any,MiniH5:any,MiniNative:any,h5Api:any,nativeApi:any;
const storage=new Map<string,any>();
let requestHandler:(path:string,body:any,method:string)=>Promise<any>;
let nativeDownload:any;
const presentations:string[]=[];
const fakeUni={getStorageSync:(k:string)=>storage.get(k),setStorageSync:(k:string,v:any)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k),request:(o:any)=>{void requestHandler(new URL(o.url).pathname.replace('/api/v1',''),o.data,o.method).then(data=>o.success({statusCode:200,data:{data}}),()=>o.fail({}));},downloadFile:(o:any)=>{nativeDownload=o;},previewImage:()=>presentations.push('image'),openDocument:(o:any)=>{presentations.push('document');o.success();}};
const login=(id='u',token='token-u',role='salesperson')=>({token,user:{id,role,name:id}});
async function createClient(platform:'H5'|'MP-WEIXIN'){
 const {createServer,transformWithEsbuild}=await import('vite');const cacheDir=await mkdtemp(resolve(tmpdir(),'quote-source-boundary-'));dirs.push(cacheDir);
 const vite=await createServer({root:resolve('.'),cacheDir,configFile:false,plugins:[{name:'source-boundary',enforce:'pre',async transform(source,id){
  // Replace persistent storage I/O only; controllers, operations, adapters and SFCs remain real.
  if(id.endsWith('/packages/source-client/src/assets.ts'))return `const values=new Map();const assets=()=>({put:async(k,v)=>{await globalThis.__sourceAssetWait?.('put');values.set(k,v)},read:async(k)=>{await globalThis.__sourceAssetWait?.('read');return Buffer.from(await values.get(k).arrayBuffer()).toString('base64')},remove:async(k)=>{values.delete(k)}});export const createIndexedDbAssets=assets;export const createPersistentFileAssets=assets;`;
  if(id.endsWith('/apps/mini/src/source-files.ts'))return source.replace(/\s*\/\/ #ifdef ([^\n]+)\n([\s\S]*?)\s*\/\/ #endif/g,(_match,p,body)=>p.trim()===platform?'\n'+body:'');
  if(!id.endsWith('.vue'))return;const {descriptor}=parse(source,{filename:id});const script=compileScript(descriptor,{id:'source-boundary',inlineTemplate:true,templateOptions:{ssr:false,compilerOptions:{hoistStatic:false,cacheHandlers:false,isCustomElement:(tag:string)=>['view','text','checkbox','scroll-view','picker'].includes(tag)}}});return transformWithEsbuild(script.content,id,{loader:'ts'});
 }}],optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error',server:{middlewareMode:true,hmr:{server:createHttpServer()}},appType:'custom'});servers.push(vite);return vite;
}
test.before(async()=>{
 (globalThis as any).uni=fakeUni;(globalThis as any).wx={getFileSystemManager:()=>({}),env:{USER_DATA_PATH:'/test'},shareFileMessage:(o:any)=>{presentations.push('share');o.success();}};
 (globalThis as any).localStorage={getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)};
 (globalThis as any).document={createElement:()=>({style:{},type:'',files:[] as File[],onchange:null as null|(()=>void),click(){if(this.type==='file'){this.files=[new File(['data'],'a.csv',{type:'text/csv'})];this.onchange?.();}else presentations.push('download');},remove(){}}),body:{appendChild(){}}};
 storage.set('quote-session',login());
 const h5=await createClient('H5'),native=await createClient('MP-WEIXIN');
 Pc=(await h5.ssrLoadModule('/apps/pc/src/components/SourceFiles.vue')).default;
 MiniH5=(await h5.ssrLoadModule('/apps/mini/src/components/SourceFiles.vue')).default;h5Api=await h5.ssrLoadModule('/apps/mini/src/api.ts');
 MiniNative=(await native.ssrLoadModule('/apps/mini/src/components/SourceFiles.vue')).default;nativeApi=await native.ssrLoadModule('/apps/mini/src/api.ts');
});
test.beforeEach(()=>{storage.clear();delete (globalThis as any).__sourceAssetWait;presentations.length=0;nativeDownload=undefined;h5Api.setSession(login());nativeApi.setSession(login());requestHandler=async (p,b)=>p==='/files/query'?{items:[file(b)]}:p.includes('download-url')?{url:'/api/v1/files/f/content?token=grant'}:assert.fail('Unexpected request '+p);});
test.after(async()=>{globalThis.fetch=originalFetch;await Promise.all(servers.map(v=>v.close()));await Promise.all(dirs.map(d=>rm(d,{recursive:true,force:true})));for(const key of ['uni','wx','document','localStorage'])delete (globalThis as any)[key];});
function mount(Component:any,extra:Record<string,any>={}){const props=reactive({reference:{...reference},userId:'u',...extra});const root=node('root'),failures:any[]=[];const app=renderer.createApp({render:()=>h(Component,{...props,onFailure:(e:any)=>failures.push(e)})});for(const tag of ['checkbox','scroll-view','picker'])app.component(tag,{setup(_p:any,{slots}:any){return ()=>h(tag,{},slots.default?.());}});app.mount(root);return {root,props,app,failures};}
for(const platform of ['h5','native'] as const){for(const invalidation of ['identity','token','reference','unmount'] as const){test(`mini ${platform} does not present private file after pending download and ${invalidation}`,async()=>{
 const api=platform==='h5'?h5Api:nativeApi;const waiting=deferred<Blob>();globalThis.fetch=(async()=>({ok:true,blob:()=>waiting.promise})) as any;
 const m=mount(platform==='h5'?MiniH5:MiniNative);await tick();const opened=find(m.root,'button','查看原图').props.onClick();await tick();
 if(invalidation==='identity')api.setSession(login('other','token-other'));else if(invalidation==='token')api.setSession(login('u','new-token'));else if(invalidation==='reference')m.props.reference={kind:'purchase_revision',orderId:'b',revisionId:'rb'};else m.app.unmount();await tick();
 if(platform==='h5')waiting.resolve(new Blob(['private']));else nativeDownload.success({statusCode:200,tempFilePath:'/private-old.png'});await opened;await tick();assert.deepEqual(presentations,[]);assert.deepEqual(m.failures,[]);if(invalidation!=='unmount')m.app.unmount();
 });}
 test(`mini ${platform} ignores late download error after identity changes`,async()=>{const api=platform==='h5'?h5Api:nativeApi;const waiting=deferred<Response>();globalThis.fetch=(()=>waiting.promise) as typeof fetch;const m=mount(platform==='h5'?MiniH5:MiniNative);await tick();const opened=find(m.root,'button','查看原图').props.onClick();await tick();api.setSession(login('other','other-token'));await tick();if(platform==='h5')waiting.reject(new Error('old error'));else nativeDownload.fail({});await opened;await tick();assert.deepEqual(m.failures,[]);assert.ok(!text(m.root).includes('old error'));m.app.unmount();});
}
test('PC selection stops after old controller upload completes across identity/reference change',async()=>{
 const first=deferred<any>(),uploads:any[]=[];let current=reference;const api={get:async()=>({version:4}),post:async(path:string,body:any)=>{if(path==='/files/query')return {items:[]};if(path==='/files/upload'){uploads.push(body);if(uploads.length===1)return first.promise;return {...file(current,'csv'),fileName:body.fileName,uploadedBy:'other'};}assert.fail(path);}};
 const m=mount(Pc,{api});await tick();const input=all(m.root).find(n=>n.tag==='input'&&n.props.type==='file')!;const selected=input.props.onChange({target:{files:[new File(['data'],'a.csv',{type:'text/csv'}),new File(['data'],'b.csv',{type:'text/csv'})]}});await tick();assert.equal(uploads.length,1);current={kind:'purchase_revision',orderId:'b',revisionId:'rb'};m.props.reference=current;m.props.userId='other';await tick();first.resolve({...file(reference,'csv'),fileName:'a.csv'});await selected;await tick();assert.equal(uploads.length,1,'second old selected file must not upload under the replacement controller');m.app.unmount();
});
async function applyFromUi(Component:any,mini:boolean,orderVersion:unknown,override?:number,role='salesperson'){
 const calls:{path:string;body:any}[]=[];const handler=async(path:string,body:any)=>{calls.push({path,body});if(path==='/files/query')return {items:[file(reference,'csv')]};if(path==='/parsing/jobs')return {...job};if(path.endsWith('/preview'))return {fileId:'f',jobId:'j',rows:[{rowNumber:2,name:'测试',quantity:'1.00',unit:'kg',errors:[],checked:false}],validRows:1,invalidRows:0};if(path.endsWith('/apply-lines'))return {orderId:'a',jobId:'j',lineIds:['line'],rowVersion:8};if(path.includes('/purchase-orders/'))return {version:orderVersion};assert.fail(path);};requestHandler=handler;if(mini)h5Api.setSession(login('u','token-u',role));
 const m=mount(Component,{...(mini?{}:{api:{get:handler,post:handler}}),...(override===undefined?{}:{orderVersion:override})});await tick();await find(m.root,'button',mini?'解析表格':'解析表格').props.onClick();await tick();if(mini){await find(m.root,'button','字段映射与候选').props.onClick();await tick();}await find(m.root,'button','预览字段映射').props.onClick();await tick();const check=all(m.root).find(n=>(n.tag==='checkbox'||n.tag==='input')&&n.props.checked===false)!;await (mini?check.props.onClick():check.props.onChange({target:{checked:true}}));await tick();await find(m.root,'button',mini?'加入选中':'将选中').props.onClick();await tick();return {...m,calls};
}
for(const client of ['pc','mini-sales','mini-hospital'] as const){test(`${client} source candidates use actual order version contract`,async()=>{const m=await applyFromUi(client==='pc'?Pc:MiniH5,client!=='pc',7,undefined,client==='mini-hospital'?'hospital':'salesperson');try{assert.equal(m.calls.find(c=>c.path.endsWith('/apply-lines'))?.body.expectedVersion,7);assert.ok(m.calls.some(c=>c.path===`${client==='mini-hospital'?'/hospital':'/sales'}/purchase-orders/a`));}finally{m.app.unmount();}});
 test(`${client} rejects malformed order version before apply`,async()=>{for(const version of [undefined,0,-1,1.5,'7',null]){const m=await applyFromUi(client==='pc'?Pc:MiniH5,client!=='pc',version,undefined,client==='mini-hospital'?'hospital':'salesperson');try{assert.ok(!m.calls.some(c=>c.path.endsWith('/apply-lines')),`invalid version ${version} must not write`);assert.match(text(m.root),/版本/);}finally{m.app.unmount();}}});}

for(const platform of ['h5','native-share','native-document'] as const){test(`mini ${platform} does not download/share/open document after session changes`,async()=>{
 const native=platform!=='h5',api=native?nativeApi:h5Api,waiting=deferred<Blob>(),oldShare=(globalThis as any).wx.shareFileMessage;
 if(platform==='native-document')delete (globalThis as any).wx.shareFileMessage;
 requestHandler=async(p,b)=>p==='/files/query'?{items:[file(b,'csv')]}:{url:'/api/v1/files/f/content?token=grant'};
 globalThis.fetch=(async()=>({ok:true,blob:()=>waiting.promise})) as any;
 const m=mount(native?MiniNative:MiniH5);try{await tick();const opened=find(m.root,'button','下载原表').props.onClick();await tick();api.setSession(login('other','token-other'));await tick();if(native)nativeDownload.success({statusCode:200,tempFilePath:'/old.csv'});else waiting.resolve(new Blob(['private']));await opened;assert.deepEqual(presentations,[]);assert.deepEqual(m.failures,[]);}finally{m.app.unmount();(globalThis as any).wx.shareFileMessage=oldShare;}
 });}
for(const platform of ['h5','native'] as const){test(`mini ${platform} presents original image when its page and session are current`,async()=>{globalThis.fetch=(async()=>new Response('private')) as typeof fetch;const m=mount(platform==='h5'?MiniH5:MiniNative);try{await tick();const opened=find(m.root,'button','查看原图').props.onClick();await tick();if(platform==='native')nativeDownload.success({statusCode:200,tempFilePath:'/current.png'});await opened;assert.deepEqual(presentations,['image']);assert.deepEqual(m.failures,[]);}finally{m.app.unmount();}});}
for(const target of ['share','document'] as const){test(`mini native ${target} remains available to current session and ignores a late callback failure after token change`,async()=>{const callback=deferred<any>(),oldShare=(globalThis as any).wx.shareFileMessage,oldDocument=fakeUni.openDocument;if(target==='share')(globalThis as any).wx.shareFileMessage=(o:any)=>{presentations.push('share');callback.resolve(o);};else{delete (globalThis as any).wx.shareFileMessage;fakeUni.openDocument=(o:any)=>{presentations.push('document');callback.resolve(o);};}requestHandler=async(p,b)=>p==='/files/query'?{items:[file(b,'csv')]}:{url:'/api/v1/files/f/content?token=grant'};const m=mount(MiniNative);try{await tick();const opened=find(m.root,'button','下载原表').props.onClick();await tick();nativeDownload.success({statusCode:200,tempFilePath:'/current.csv'});const options=await callback.promise;assert.deepEqual(presentations,[target]);nativeApi.setSession(login('u','new-token'));await tick();options.fail({});await opened;assert.deepEqual(m.failures,[]);}finally{m.app.unmount();(globalThis as any).wx.shareFileMessage=oldShare;fakeUni.openDocument=oldDocument;}});}
for(const client of ['pc','mini'] as const){test(`${client} explicit orderVersion is validated and avoids fallback read`,async()=>{const m=await applyFromUi(client==='pc'?Pc:MiniH5,client==='mini',undefined,9);try{assert.equal(m.calls.find(c=>c.path.endsWith('/apply-lines'))?.body.expectedVersion,9);assert.ok(!m.calls.some(c=>c.path.includes('/purchase-orders/')));}finally{m.app.unmount();}const invalid=await applyFromUi(client==='pc'?Pc:MiniH5,client==='mini',7,0);try{assert.ok(!invalid.calls.some(c=>c.path.endsWith('/apply-lines')));assert.match(text(invalid.root),/版本/);}finally{invalid.app.unmount();}});}

for(const boundary of ['put','read'] as const){for(const invalidation of ['identity','token'] as const){test(`mini actual transport does not send stale file after deferred ${boundary} and ${invalidation}`,async()=>{
 const gate=deferred<void>(),entered=deferred<void>(),writes:{body:any;token:string}[]=[];
 (globalThis as any).__sourceAssetWait=async(phase:string)=>{if(phase===boundary){entered.resolve();await gate.promise;}};
 requestHandler=async(p,b)=>{if(p==='/files/query')return {items:[]};if(p.startsWith('/operations/'))return {status:'not_found'};if(p==='/files/upload'){writes.push({body:b,token:h5Api.session.value.token});return {...file(b.reference,'csv'),fileName:b.fileName,uploadedBy:h5Api.session.value.user.id};}assert.fail(p);};
 const m=mount(MiniH5);await tick();const uploading=find(m.root,'button','Excel / CSV').props.onClick();await Promise.race([entered.promise,uploading.then(()=>assert.fail('upload ended before entering asset boundary'))]);
 h5Api.setSession(invalidation==='identity'?login('other','other-token'):login('u','replacement-token'));if(invalidation==='identity')m.props.userId='other';await tick();gate.resolve();await uploading;await tick();assert.equal(writes.length,0,'no file write may use the replacement session');const saved=JSON.parse(storage.get('quote-source-pending-v1:u'));assert.equal(saved.userId,'u');assert.deepEqual(saved.reference,reference);assert.equal(storage.has('quote-source-pending-v1:other'),false);const oldKey=saved.key;m.app.unmount();
 delete (globalThis as any).__sourceAssetWait;h5Api.setSession(login());const restored=mount(MiniH5);try{await tick();await find(restored.root,'button','核对原操作').props.onClick();await tick();assert.equal(writes.length,0);await find(restored.root,'button','原请求重试').props.onClick();await tick();assert.equal(writes.length,1);assert.equal(writes[0].token,'token-u');assert.equal(writes[0].body.base64,'ZGF0YQ==');assert.deepEqual(writes[0].body.reference,reference);assert.equal(storage.has('quote-source-pending-v1:u'),false);assert.ok(oldKey);}finally{restored.app.unmount();}
 });}}
