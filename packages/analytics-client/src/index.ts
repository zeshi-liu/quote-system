import type {AnalyticsFilters,AnalyticsSnapshot,AnalyticsOrderPage,AnalyticsDrillFilters,AnalyticsCoverage,AnalyticsPeriodMetrics} from '../../contracts/src/analytics';
export type Read=<T>(path:string)=>Promise<T>;
export type Query=<T>(path:string,body:unknown)=>Promise<T>;
export interface AnalyticsState {snapshot:AnalyticsSnapshot|null;drill:AnalyticsOrderPage|null;selection:AnalyticsDrillFilters|null;loading:boolean;drillLoading:boolean;error:string;drillError:string;hospitals:{id:string;name:string}[];hospitalError:string;hospitalLoading:boolean;form:AnalyticsFilters;trend:'demand'|'confirmation';}
export function createAnalyticsState(now=new Date()):AnalyticsState {const date=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);return {snapshot:null,drill:null,selection:null,loading:false,drillLoading:false,error:'',drillError:'',hospitals:[],hospitalError:'',hospitalLoading:false,form:{receivedFrom:date.slice(0,4)+'-01-01',receivedTo:date,groupBy:'month'},trend:'demand'};}
export const analyticsBusy=(state:AnalyticsState)=>state.loading||state.drillLoading||state.hospitalLoading;
export function quantityLabel(value:string|null,c:AnalyticsCoverage,kind:'confirmed'|'missing') {if(value===null)return c.pendingOrders>0&&!c.confirmedOrders?'待确认':'未知';const unknown=kind==='confirmed'?c.confirmedUnknownLines:c.missingUnknownLines;return value+' kg'+(unknown>0||c.pendingOrders>0?'（已知部分）':'');}
export function coverageLabel(c:AnalyticsCoverage){return `确认量：已知 ${c.confirmedKnownLines} 行 / 未知 ${c.confirmedUnknownLines} 行；缺货量：已知 ${c.missingKnownLines} 行 / 未知 ${c.missingUnknownLines} 行；待确认 ${c.pendingOrders} 单（${c.pendingLines} 行）。`;}
export const beijingTime=(iso:string)=>iso?new Date(new Date(iso).getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ')+' 北京时间':'';
const message=(e:unknown)=>e instanceof Error?e.message:'读取失败，请重试。';
const invalidating=(e:unknown)=>['ANALYTICS_SCOPE_CHANGED','ANALYTICS_SNAPSHOT_EXPIRED','SESSION_EXPIRED','NOT_FOUND','ROLE_FORBIDDEN','UNAUTHENTICATED'].includes((e as {code?:string})?.code||'');
export class AnalyticsController {
 private epoch=0;private drillEpoch=0;private hospitalEpoch=0;private disposed=false;
 constructor(private read:Read,private post:Query,readonly state:AnalyticsState=createAnalyticsState(),private failure:(e:unknown)=>void=()=>{},private clock=()=>new Date()){}
 private clearSnapshot(){this.drillEpoch++;Object.assign(this.state,{snapshot:null,drill:null,selection:null,drillLoading:false,drillError:''});}
 expire(){if(this.state.snapshot&&new Date(this.state.snapshot.expiresAt)<=this.clock()){this.clearSnapshot();this.state.error='分析查询已到期，请整组刷新图表和订单。';return true;}return false;}
 async query(filters:AnalyticsFilters=this.state.form){if(this.disposed)return;const epoch=++this.epoch;this.clearSnapshot();Object.assign(this.state,{loading:true,error:''});const body={...filters,hospitalId:filters.hospitalId||undefined,name:filters.name?.trim()||undefined,spec:filters.spec?.trim()||undefined};
  try{const result=await this.post<AnalyticsSnapshot>('/sales/analytics/query',body);if(this.disposed||epoch!==this.epoch)return;if(!result?.snapshotId||!result.charts||!result.summary||!result.expiresAt||!result.filters)throw new Error('分析响应不完整，请重新查询。');this.state.snapshot=result;}
  catch(e){if(!this.disposed&&epoch===this.epoch){this.state.error=message(e);this.failure(e);}}finally{if(!this.disposed&&epoch===this.epoch)this.state.loading=false;}}
 async drill(selection:AnalyticsDrillFilters,page=1){if(this.disposed||this.expire()||!this.state.snapshot)return;const snapshot=this.state.snapshot,epoch=++this.drillEpoch;Object.assign(this.state,{drill:null,drillLoading:true,drillError:'',selection:{...selection,page,pageSize:20}});const query=Object.entries(this.state.selection!).filter(([,v])=>v!==undefined).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');
  try{const result=await this.read<AnalyticsOrderPage>('/sales/analytics/snapshots/'+encodeURIComponent(snapshot.snapshotId)+'/orders?'+query);if(this.disposed||epoch!==this.drillEpoch||this.state.snapshot?.snapshotId!==snapshot.snapshotId)return;if(result.snapshotId!==snapshot.snapshotId||!Array.isArray(result.items)||result.asOf!==snapshot.asOf)throw new Error('订单列表与图表时点不一致，请整组刷新。');this.state.drill=result;}
  catch(e){if(!this.disposed&&epoch===this.drillEpoch){if(invalidating(e)){this.clearSnapshot();this.state.error=message(e);}else this.state.drillError=message(e);this.failure(e);}}finally{if(!this.disposed&&epoch===this.drillEpoch)this.state.drillLoading=false;}}
 async move(page:number){if(this.state.selection)return this.drill(this.state.selection,page);}
 closeDrill(){this.drillEpoch++;Object.assign(this.state,{drill:null,selection:null,drillError:'',drillLoading:false});}
 async hospitals(){if(this.disposed)return;const epoch=++this.hospitalEpoch;Object.assign(this.state,{hospitalLoading:true,hospitalError:'',hospitals:[]});try{const result=await this.read<{items:{id:string;name:string}[]}>('/sales/order-archive/hospitals');if(!this.disposed&&epoch===this.hospitalEpoch)this.state.hospitals=result.items;}catch(e){if(!this.disposed&&epoch===this.hospitalEpoch){this.state.hospitalError=message(e);this.failure(e);}}finally{if(!this.disposed&&epoch===this.hospitalEpoch)this.state.hospitalLoading=false;}}
 async bootstrap(){await Promise.all([this.hospitals(),this.query()]);}
 dispose(){this.disposed=true;this.epoch++;this.hospitalEpoch++;this.clearSnapshot();Object.assign(this.state,{loading:false,hospitalLoading:false});}
}
/** Display an inclusive date range while the API retains an exclusive end bound. */
export function periodRangeLabel(row:Pick<AnalyticsPeriodMetrics,'periodStart'|'periodEnd'>) {
 const inclusiveEnd=new Date(row.periodEnd+'T00:00:00Z');inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate()-1);
 return row.periodStart+' 至 '+inclusiveEnd.toISOString().slice(0,10);
}
export const periodOrderNotice=(row:Pick<AnalyticsPeriodMetrics,'orders'>)=>row.orders===0?'期间无符合筛选订单':'';
export function drillPeriodLabel(snapshot:AnalyticsSnapshot|null,selection:AnalyticsDrillFilters|null) {
 if(!snapshot||!selection?.period||!['demandTrend','confirmationTrend'].includes(selection.chart))return '';
 const rows=selection.chart==='confirmationTrend'?snapshot.charts.confirmationTrend:snapshot.charts.demandTrend;
 const row=rows.find(r=>r.period===selection.period);return row?periodRangeLabel(row):'';
}
/** Geometry only: metric arithmetic stays on the server in decimal strings. */
export function barWidth(value:string|number|null,max:number){return value===null?0:Math.max(0,Math.min(100,Number(value)/Math.max(1,max)*100));}
export function trendPoints(rows:AnalyticsPeriodMetrics[],confirmed:boolean){const max=Math.max(1,...rows.map(r=>Number(confirmed?r.confirmedQuantity:r.demandQuantity)||0));return rows.map((r,i)=>({period:r.period,label:periodRangeLabel(r),notice:periodOrderNotice(r),value:confirmed?r.confirmedQuantity:r.demandQuantity,x:rows.length===1?330:115+i*230,y:180-(Number(confirmed?r.confirmedQuantity:r.demandQuantity)||0)/max*140}));}
