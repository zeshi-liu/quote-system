import type {Actor,AuthService} from './auth/auth';
import type {CoreStore} from './core/store';
import {FinanceControlService} from './finance-control/service';
import {SourceFileService} from './source-files/service';
import {ParserService} from './source-files/parser';
import type {ObjectStorage} from './delivery/storage';
import {missing,ensure} from './core/errors';
import {uuid} from './core/validation';
import {MasterDataService,type MasterDataKind} from './master-data/service';
import {AdminIdentityService} from './master-data/identity';
import {HandoffService} from './master-data/handoff';
import {HistoricalService} from './historical/service';
import {AnalyticsService} from './analytics/service';
import {HospitalService} from './hospital/service';
import {HospitalAuthService} from './hospital/auth';
import {PurchaseLifecycleService} from './core/purchase-lifecycle';
import {DashboardService} from './core/dashboard';
export interface FeatureResponse {data?:unknown;status?:number;binary?:{bytes:Buffer;fileName:string;mimeType:string};}
/** Additional domains share the existing authenticated transport and CSRF gate. */
export class FeatureService {
 readonly dashboard:DashboardService;readonly lifecycle:PurchaseLifecycleService;readonly finance:FinanceControlService;readonly files:SourceFileService;readonly parser:ParserService;readonly master:MasterDataService;readonly identity:AdminIdentityService;readonly handoffs:HandoffService;readonly historical:HistoricalService;readonly analytics:AnalyticsService;readonly hospital:HospitalService;readonly hospitalAuth:HospitalAuthService;
 constructor(readonly store:CoreStore,storage:ObjectStorage,auth:AuthService){
  this.finance=new FinanceControlService(store,{appId:process.env.WECHAT_APP_ID||'',templateId:process.env.WECHAT_REMINDER_TEMPLATE_ID||''});this.files=new SourceFileService(store,storage);this.parser=new ParserService(this.files);
  this.master=new MasterDataService(store,(c,a,id,ref)=>this.files.requireReference(c,a,id,ref));this.identity=new AdminIdentityService(store);this.handoffs=new HandoffService(store);
  this.historical=new HistoricalService(store,this.files);this.lifecycle=new PurchaseLifecycleService(store);this.dashboard=new DashboardService(store);
  this.analytics=new AnalyticsService(store);
  this.hospital=new HospitalService(store,this.files);this.hospitalAuth=new HospitalAuthService(auth);
  store.resultAuthorizer=async(c,actor,operation,result)=>{
   if(operation.startsWith('source-files.')){if(!result?.id)throw missing();await this.files.requireReference(c,actor,result.id);return true;}
   if(operation.startsWith('source-parsing.')){let fileId=result?.fileId;if(!fileId&&result?.jobId)fileId=(await c.query('SELECT file_id FROM source_parsing_jobs WHERE id=$1',[result.jobId])).rows[0]?.file_id;if(!fileId)throw missing();await this.files.requireReference(c,actor,fileId);return true;}
   return false;
  };
 }
 hospitalPurpose(path:string){return path.startsWith('/hospital/')||path==='/catalog/variants'||path.startsWith('/files/')||path.startsWith('/parsing/')||['/auth/me','/auth/logout'].includes(path);}
 async route(actor:Actor,key:string,path:string,method:string,body:unknown,query:Record<string,unknown>):Promise<FeatureResponse|undefined>{let m:RegExpMatchArray|null;
  if(actor.role==='hospital')ensure(this.hospitalPurpose(path),403,'HOSPITAL_PURPOSE_FORBIDDEN','医院仅可使用本人采购需求入口');
  if(method==='POST'&&(m=path.match(/^\/sales\/purchase-orders\/([^/]+)\/(revisions|void)$/)))return {data:await (m[2]==='revisions'?this.lifecycle.revise(actor,key,m[1],body):this.lifecycle.void(actor,key,m[1],body))};
  if(path==='/sales/dashboard'&&method==='GET')return {data:await this.dashboard.get(actor)};
  if(path==='/hospital/bootstrap'&&method==='GET')return {data:await this.hospital.bootstrap(actor)};
  if(path==='/hospital/purchase-suggestions'&&method==='GET')return {data:await this.hospital.suggestions(actor)};
  if(path==='/hospital/purchase-orders'){if(method==='GET')return {data:await this.hospital.list(actor,query)};if(method==='POST')return {data:await this.hospital.create(actor,key,body)};}
  if((m=path.match(/^\/hospital\/purchase-orders\/([^/]+)$/))){if(method==='GET')return {data:await this.hospital.get(actor,m[1])};if(method==='PUT')return {data:await this.hospital.save(actor,key,m[1],body)};}
  if((m=path.match(/^\/hospital\/purchase-orders\/([^/]+)\/submit$/))&&method==='POST')return {data:await this.hospital.submit(actor,key,m[1],body)};
  if(path.startsWith('/admin/'))ensure(actor.role==='admin'&&actor.channel==='pc',403,'ADMIN_PC_REQUIRED','仅管理员 PC 可使用管理功能');
  if(path==='/sales/analytics/query'&&method==='POST')return {data:await this.analytics.query(actor,body)};
  if((m=path.match(/^\/sales\/analytics\/snapshots\/([^/]+)\/orders$/))&&method==='GET')return {data:await this.analytics.orders(actor,m[1],query)};
  if(path==='/sales/historical-orders'){if(method==='GET')return {data:await this.historical.list(actor,query)};if(method==='POST')return {data:await this.historical.create(actor,key,body)};}
  if((m=path.match(/^\/sales\/historical-orders\/([^/]+)$/))){if(method==='GET')return {data:await this.historical.detail(actor,m[1])};if(['PATCH','PUT'].includes(method))return {data:await this.historical.save(actor,key,m[1],body)};}
  if((m=path.match(/^\/sales\/historical-orders\/([^/]+)\/(verify|amount-corrections|void)$/))&&method==='POST')return {data:m[2]==='verify'?await this.historical.verify(actor,key,m[1],body):m[2]==='amount-corrections'?await this.historical.correctAmount(actor,key,m[1],body):await this.historical.void(actor,key,m[1],body)};
  if((m=path.match(/^\/admin\/master-data\/([^/]+)$/))){if(method==='GET'){const q={...query,...query.includeInactive!==undefined?{includeInactive:query.includeInactive==='true'}:{},...query.page?{page:Number(query.page)}:{},...query.pageSize?{pageSize:Number(query.pageSize)}:{}};return {data:await this.master.list(actor,m[1] as MasterDataKind,q)};}if(method==='POST')return {data:await this.master.save(actor,key,m[1] as MasterDataKind,body)};}
  if(path==='/catalog/variants'&&method==='GET')return {data:await this.master.searchCatalog(actor,{...query,...query.limit?{limit:Number(query.limit)}:{}})};
  if(path==='/admin/users'){if(method==='GET')return {data:await this.identity.listUsers(actor)};if(method==='POST')return {data:await this.identity.createUser(actor,key,body)};}
  if((m=path.match(/^\/admin\/users\/([^/]+)$/))&&method==='POST')return {data:await this.identity.updateUser(actor,key,m[1],body)};
  if((m=path.match(/^\/admin\/users\/([^/]+)\/(reset-password|reset-binding)$/))&&method==='POST')return {data:m[2]==='reset-password'?await this.identity.resetPassword(actor,key,m[1],body):await this.identity.resetBinding(actor,key,m[1],body)};
  if(path==='/admin/source-batches/preview'&&method==='POST')return {data:await this.master.previewSourceBatch(actor,body)};
  if(path==='/admin/source-batches/confirm'&&method==='POST')return {data:await this.master.confirmSourceBatch(actor,key,body)};
  if((m=path.match(/^\/admin\/source-batches\/([^/]+)\/void$/))&&method==='POST')return {data:await this.master.voidSourceBatch(actor,key,m[1],body)};
  if(path==='/source-batches'&&method==='GET')return {data:await this.master.listSourceBatches(actor,{...query,...query.page?{page:Number(query.page)}:{},...query.pageSize?{pageSize:Number(query.pageSize)}:{}})};
  if((m=path.match(/^\/source-batches\/([^/]+)$/))&&method==='GET')return {data:await this.master.sourceBatch(actor,m[1])};
  if(path==='/admin/sales-handoffs/preview'&&method==='POST')return {data:await this.handoffs.preview(actor,body)};
  if(path==='/admin/sales-handoffs'&&method==='POST')return {data:await this.handoffs.execute(actor,key,body)};
  if((m=path.match(/^\/sales\/hospitals\/([^/]+)\/payment-term$/))){if(method==='GET')return {data:await this.finance.hospitalTerm(actor,m[1])};if(['POST','PATCH'].includes(method))return {data:await this.finance.setHospitalTerm(actor,key,m[1],body)};}
  if((m=path.match(/^\/sales\/purchase-orders\/([^/]+)\/payment-term-adjustments$/))){if(method==='GET')return {data:await this.finance.terms(actor,m[1])};if(method==='POST')return {data:await this.finance.adjustTerm(actor,key,m[1],body)};}
  if((m=path.match(/^\/sales\/receivables\/([^/]+)\/exceptions$/))){if(method==='GET')return {data:await this.finance.exceptions(actor,m[1])};if(method==='POST')return {data:await this.finance.addException(actor,key,m[1],body)};}
  if((m=path.match(/^\/sales\/receivables\/([^/]+)\/exceptions\/([^/]+)\/resolve$/))&&method==='POST')return {data:await this.finance.resolveException(actor,key,m[1],m[2],body)};
  if(path==='/sales/receivable-reminders'&&method==='GET')return {data:await this.finance.reminders(actor,query)};
  if(path==='/sales/receivable-reminders/config'&&method==='GET'){await this.store.db.transaction(c=>this.store.active(c,actor));return {data:{available:!!process.env.WECHAT_APP_ID&&!!process.env.WECHAT_APP_SECRET&&!!process.env.WECHAT_REMINDER_TEMPLATE_ID&&process.env.REMINDER_SEND_WECHAT==='true',templateId:process.env.WECHAT_REMINDER_TEMPLATE_ID||undefined}};}
  if(path==='/sales/receivable-reminders/subscriptions'&&method==='POST')return {data:await this.finance.recordSubscription(actor,key,body)};
  if(path==='/files/upload'&&method==='POST')return {data:await this.files.upload(actor,key,body)};
  if(path==='/files/query'&&method==='POST')return {data:await this.files.list(actor,body)};
  if((m=path.match(/^\/files\/([^/]+)\/metadata$/))&&method==='GET')return {data:await this.files.get(actor,m[1])};
  if((m=path.match(/^\/files\/([^/]+)\/download-url$/))&&method==='POST'){
   uuid.parse(m[1]);
   const exists=(await this.store.db.query('SELECT id FROM source_files WHERE id=$1',[m[1]])).rowCount;if(exists){const g=await this.files.downloadGrant(actor,m[1]);return {data:{...g,url:'/api/v1'+g.downloadPath}};}
  }
  if((m=path.match(/^\/files\/([^/]+)\/content$/))&&method==='GET'){ensure(typeof query.token==='string',401,'DOWNLOAD_TOKEN_REQUIRED','缺少临时下载凭证');return {binary:await this.files.download(actor,m[1],query.token)};}
  if(path==='/parsing/jobs'&&method==='POST')return {data:await this.parser.create(actor,key,body),status:202};
  if((m=path.match(/^\/parsing\/jobs\/([^/]+)$/))&&method==='GET')return {data:await this.parser.get(actor,m[1])};
  if((m=path.match(/^\/parsing\/jobs\/([^/]+)\/(retry|preview|apply-lines)$/))&&method==='POST')return {data:m[2]==='retry'?await this.parser.retry(actor,key,m[1],body):m[2]==='preview'?await this.parser.preview(actor,m[1],body):await this.parser.apply(actor,key,m[1],body),status:m[2]==='retry'?202:200};
  return undefined;
 }
}
