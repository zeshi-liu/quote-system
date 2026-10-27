import type {ArchiveDetail,ArchiveFilters,ArchiveHospital,ArchiveOrder,ArchivePage,PriceHistory,PriceHistoryMatch,QuoteDocument} from '@quote/contracts';
export type ReadRequest=<T>(path:string)=>Promise<T>;
export interface ArchiveFilterForm {hospitalId:string;receivedFrom:string;receivedTo:string;keyword:string;status:string;ownership:string;payment:string;pageSize:number;}
export function archiveFilterForm(filters:ArchiveFilters={}):ArchiveFilterForm{return {hospitalId:filters.hospitalId||'',receivedFrom:filters.receivedFrom||'',receivedTo:filters.receivedTo||'',keyword:filters.keyword||'',status:filters.status||'',ownership:filters.ownership||'',payment:filters.payment||'',pageSize:filters.pageSize||20};}
export function isFiltersDirty(form:ArchiveFilterForm,applied:ArchiveFilters):boolean{const saved=archiveFilterForm(applied);return (Object.keys(saved) as (keyof ArchiveFilterForm)[]).some(key=>form[key]!==saved[key]);}
export function restoreAppliedFilters(form:ArchiveFilterForm,applied:ArchiveFilters):void{Object.assign(form,archiveFilterForm(applied));}

export function encodedQuery(values:Record<string,unknown>,keepEmpty=false):string{return Object.entries(values).filter(([,v])=>v!==undefined&&v!==null&&(keepEmpty||v!=='')).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');}
export function archiveQuery(filters:ArchiveFilters){return '/sales/order-archive?'+encodedQuery({...filters,page:Math.max(1,filters.page||1),pageSize:Math.min(50,Math.max(1,filters.pageSize||20))});}
export interface ArchiveState {mode:'list'|'detail';applied:ArchiveFilters;page:ArchivePage|null;detail:ArchiveDetail|null;selectedId:string;hospitals:ArchiveHospital[];listLoading:boolean;detailLoading:boolean;hospitalsLoading:boolean;listError:string;detailError:string;hospitalsError:string;}
export function createArchiveState():ArchiveState{return {mode:'list',applied:{page:1,pageSize:20},page:null,detail:null,selectedId:'',hospitals:[],listLoading:false,detailLoading:false,hospitalsLoading:false,listError:'',detailError:'',hospitalsError:''};}
export class ArchiveController {
 private epochs={list:0,detail:0,hospitals:0};private disposed=false;
 constructor(private read:ReadRequest,public state:ArchiveState=createArchiveState(),private onFailure:(e:unknown)=>void=()=>{}){}
 clear(){this.epochs.list++;this.epochs.detail++;this.epochs.hospitals++;Object.assign(this.state,createArchiveState());}
 dispose(){this.clear();this.disposed=true;}
 async query(filters:ArchiveFilters=this.state.applied,page=1){if(this.disposed)return;const epoch=++this.epochs.list;this.epochs.detail++;Object.assign(this.state,{mode:'list',detail:null,selectedId:'',detailLoading:false,page:null,listError:'',listLoading:true,applied:{...filters,page:Math.max(1,page),pageSize:Math.min(50,filters.pageSize||20)}});
  try{const value=await this.read<ArchivePage>(archiveQuery(this.state.applied));if(!this.disposed&&epoch===this.epochs.list)this.state.page=value;}catch(e){if(!this.disposed&&epoch===this.epochs.list){this.state.page=null;this.state.listError=message(e);this.onFailure(e);}}finally{if(!this.disposed&&epoch===this.epochs.list)this.state.listLoading=false;}}
 async move(page:number){return this.query(this.state.applied,page);}
 async open(id:string){if(this.disposed)return;const epoch=++this.epochs.detail;this.epochs.list++;Object.assign(this.state,{mode:'detail',selectedId:id,detail:null,detailError:'',detailLoading:true,listLoading:false});try{const value=await this.read<ArchiveDetail>('/sales/order-archive/'+encodeURIComponent(id));if(!this.disposed&&epoch===this.epochs.detail)this.state.detail=value;}catch(e){if(!this.disposed&&epoch===this.epochs.detail){this.state.detail=null;this.state.detailError=message(e);this.onFailure(e);}}finally{if(!this.disposed&&epoch===this.epochs.detail)this.state.detailLoading=false;}}
 async back(){return this.query(this.state.applied,this.state.applied.page||1);}
 async hospitals(){if(this.disposed)return;const epoch=++this.epochs.hospitals;Object.assign(this.state,{hospitals:[],hospitalsError:'',hospitalsLoading:true});try{const value=await this.read<{items:ArchiveHospital[]}>('/sales/order-archive/hospitals');if(!this.disposed&&epoch===this.epochs.hospitals)this.state.hospitals=value.items;}catch(e){if(!this.disposed&&epoch===this.epochs.hospitals){this.state.hospitals=[];this.state.hospitalsError=message(e);this.onFailure(e);}}finally{if(!this.disposed&&epoch===this.epochs.hospitals)this.state.hospitalsLoading=false;}}
}
function message(e:unknown){return e instanceof Error?e.message:'读取失败，请重试';}
export function confirmationAmount(order:ArchiveOrder){return order.confirmation==='pending'?'待医院确认':order.confirmation==='all_missing'?'不适用（全部缺货）':order.confirmedTotal===null?'确认金额未知':'¥ '+order.confirmedTotal;}
export function receivableLabel(order:ArchiveOrder){const r=order.receivable;return r?({open:'有未收余额',due:'今日到期',overdue:'逾期未收',settled:'已结清'}[r.state]):order.confirmation==='all_missing'?'不产生应收（全部缺货）':'尚无应收';}
export function canProcessOrder(order:Pick<ArchiveOrder,'writable'|'status'>){return order.writable&&!['completed','voided'].includes(order.status);}
export function confirmedDocument(detail:ArchiveDetail){if(detail.order.confirmation==='pending')return null;return [...detail.quotes].filter(q=>q.hospitalConfirmedAt).sort((a,b)=>(b.hospitalConfirmedAt||'').localeCompare(a.hospitalConfirmedAt||''))[0]?.document||null;}
export function documentTotal(document:QuoteDocument){if(document.lines.length>0&&document.lines.every(l=>l.status==='missing'))return '不适用（全部缺货）';if(document.total===null)return '待完成计价';return document.lines.some(l=>l.status==='priced'&&(l.unitPrice===null||l.amount===null))?'暂计 ¥ '+document.total+'（尚有待计价行）':'¥ '+document.total;}
export function lineById(detail:ArchiveDetail,id:string){return detail.revisions.flatMap(r=>r.lines).find(l=>l.id===id);}
export function beijingTime(value:string|null|undefined){if(!value)return '—';const time=Date.parse(value);return Number.isFinite(time)?new Date(time+8*3600000).toISOString().replace('T',' ').slice(0,19)+' 北京时间':'时间未知';}
export const orderStatuses=[['draft','采购草稿'],['frozen','厂家询价'],['quote_draft','计价草稿'],['quote_exported','已导出报价'],['quote_sent','已发送报价'],['completed','已完成'],['voided','已作废']] as const;
export function orderStatus(value:string){return orderStatuses.find(s=>s[0]===value)?.[1]||value;}
export const paymentFilters=[['','全部回款情况'],['none','尚无应收 / 不适用'],['outstanding','有未收余额'],['due','今日到期'],['overdue','逾期未收'],['settled','已结清']] as const;
export interface HistoryContext {hospitalId:string;name:string;spec:string;orderId:string;itemId?:string|null;itemVariantId?:string|null;}
export function priceHistoryQuery(c:HistoryContext){return '/sales/price-history?'+encodedQuery({hospitalId:c.hospitalId,name:c.name,spec:c.spec||'',unit:'kg',excludeOrderId:c.orderId,itemId:c.itemId||undefined,itemVariantId:c.itemVariantId||undefined},true);}
export function historyMatchLabel(match:PriceHistoryMatch|undefined){return ({variant_exact:'同商品规格 · kg',item_spec_exact:'同标准商品及规格文本 · kg',item_fallback:'同标准商品 · 降级参考',text_exact:'品名及规格文本匹配 · kg'})[match||'text_exact'];}
export interface HistoryState {context:HistoryContext|null;history:PriceHistory|null;loading:boolean;error:string;}
export function createHistoryState():HistoryState{return {context:null,history:null,loading:false,error:''};}
export class HistoryController {
 private epoch=0;private disposed=false;
 constructor(private read:ReadRequest,public state:HistoryState=createHistoryState(),private onFailure:(e:unknown)=>void=()=>{}){}
 setContext(context:HistoryContext|null){this.epoch++;Object.assign(this.state,{context:context?{...context}:null,history:null,loading:false,error:''});}
 dispose(){this.setContext(null);this.disposed=true;}
 async load(){if(this.disposed||!this.state.context)return;const epoch=++this.epoch,context={...this.state.context};Object.assign(this.state,{history:null,loading:true,error:''});try{const value=await this.read<PriceHistory>(priceHistoryQuery(context));if(!this.disposed&&epoch===this.epoch)this.state.history=value;}catch(e){if(!this.disposed&&epoch===this.epoch){this.state.history=null;this.state.error=message(e);this.onFailure(e);}}finally{if(!this.disposed&&epoch===this.epoch)this.state.loading=false;}}
}

export * from './panels';
