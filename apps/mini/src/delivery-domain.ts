import type { ExportJob } from '@quote/contracts';
/** The input is a Beijing wall-clock time, never a device-local Date string. */
export function shanghaiDateTimeToIso(date:string,time:string):string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}(?::\d{2})?$/.test(time))throw new Error('请选择有效的实际确认日期和时间（北京时间）。');
 const [year,month,day]=date.split('-').map(Number),[hour,minute,second=0]=time.split(':').map(Number);
 const wall=new Date(Date.UTC(year,month-1,day,hour,minute,second));
 if(year<1000||wall.getUTCFullYear()!==year||wall.getUTCMonth()!==month-1||wall.getUTCDate()!==day||hour>23||minute>59||second>59)throw new Error('实际确认日期或时间无效，请重新选择。');
 return new Date(wall.getTime()-8*3600000).toISOString();
}
export function deliveryTotal(total:string|null,allMissing=false,partial=false):string{
 if(allMissing)return '不适用（全部缺货）';
 if(total===null)return '待完成计价';
 return partial?'草稿暂计 ¥ '+total+'（待完善）':'¥ '+total;
}
export function deliveryDocumentPresentation(document:{total:string|null;validUntil:string|null;lines:readonly {status:'priced'|'missing';unitPrice:string|null;amount:string|null}[]}){
 const allMissing=document.lines.length>0&&document.lines.every(line=>line.status==='missing');
 const partial=document.lines.some(line=>line.status==='priced'&&(line.unitPrice===null||line.amount===null));
 return {allMissing,totalLabel:deliveryTotal(document.total,allMissing,partial),validityLabel:allMissing?'不适用（全部缺货）':document.validUntil?document.validUntil+'（含当天，北京时间）':'待设置/核对有效期'};
}
export function exportJobPresentation(state:string|null):{label:string;success:boolean} {
 const labels:Record<string,string>={queued:'排队中，尚未生成文件',running:'正在生成文件',succeeded:'文件已成功生成',failed:'导出失败，请核对原因后重试'};
 return {label:state&&labels[state]||'导出结果待核对，请刷新状态',success:state==='succeeded'};
}
export type DeliveryActionContext={writable:boolean;locked:boolean;current:boolean;occupied:boolean;quoteOccupied?:boolean;eligible:boolean;status:string;hasFiles:boolean;hasDraft:boolean};
export function deliveryActions(c:DeliveryActionContext){
 const manageable=c.writable&&!c.locked&&c.current&&!c.occupied&&c.status!=='confirmed';
 const active=manageable&&c.status!=='void';
 const frozen=['exported','sent'].includes(c.status);
 return {
  edit:active&&c.status==='draft',
  export:active&&c.eligible,
  send:active&&c.eligible&&frozen&&c.hasFiles,
  confirm:active&&c.status==='sent'&&c.hasFiles,
  next:manageable&&(frozen||c.status==='void')&&!c.hasDraft&&!c.quoteOccupied,
  void:active&&['draft','exported','sent'].includes(c.status),
 };
}
export function resolveDownloadUrl(value:string,apiBase:string):string {
 const absolute=/^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#]|$)/i;
 const unsafe=/[\\\u0000-\u0020]/;
 if(!unsafe.test(value)&&absolute.test(value))return value;
 if(!unsafe.test(value)&&/^\/(?!\/)/.test(value)){
  const origin=!unsafe.test(apiBase)&&absolute.test(apiBase)?apiBase.match(/^https?:\/\/[^/]+/i)?.[0]:null;
  if(origin)return origin+value;
  if(!unsafe.test(apiBase)&&/^\/(?!\/)/.test(apiBase))return value;
 }
 throw new Error('下载地址无效，请重新获取文件。');
}
export function shanghaiNowParts(now:number=Date.now()):{date:string;time:string}{
 const stamp=new Date(now+8*3600000).toISOString();
 return {date:stamp.slice(0,10),time:stamp.slice(11,19)};
}
export function exportJobStorageKey(orderId:string,versionId:string):string{return 'quote-export-job-'+orderId+'-'+versionId;}
export function formatShanghaiTimestamp(value:string|null):string{return value?new Date(new Date(value).getTime()+8*3600000).toISOString().replace('T',' ').slice(0,19)+' 北京时间':'—';}
export async function resolveExportJob(preview:{id:string;latestJob?:ExportJob|null},localJobId:unknown,fetchJob:(id:string)=>Promise<ExportJob>):Promise<ExportJob|null>{
 if('latestJob' in preview)return preview.latestJob??null;
 return typeof localJobId==='string'&&localJobId?fetchJob(localJobId):null;
}
