<script setup lang="ts">
import QuoteLogo from './QuoteLogo.vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ExportAccepted, ExportFormat, ExportJob, QuoteDeliveryVersion } from '@quote/contracts';
import { downloadFile, mutate, pending, request } from '../api';
import { deliveryActions, deliveryDocumentPresentation, exportJobPresentation, exportJobStorageKey, formatShanghaiTimestamp, resolveExportJob, shanghaiDateTimeToIso, shanghaiNowParts } from '../delivery-domain';

const props=defineProps<{orderId:string;writable:boolean;locked?:boolean}>();
const emit=defineEmits<{changed:[];editDraft:[];busyChanged:[value:boolean];failure:[error:unknown]}>();
const versions=ref<QuoteDeliveryVersion[]>([]),selectedId=ref(''),currentQuoteId=ref<string|null>(null);
const working=ref(false),loaded=ref(false),message=ref('');
const job=ref<ExportJob|null>(null),lossAcknowledged=ref(false),channel=ref(''),sendRemark=ref('');
const confirmationDate=ref(''),confirmationTime=ref(''),backfillReason=ref(''),nextReason=ref(''),voidReason=ref('');
let disposed=false,initialAttempted=false,refreshAfter=false,editAfter=false;
const selected=computed(()=>versions.value.find(v=>v.id===selectedId.value));
const documentSummary=computed(()=>deliveryDocumentPresentation(selected.value?.document||{total:null,validUntil:null,lines:[]}));
const blocked=computed(()=>working.value||!!props.locked||!!pending.value);
const isCurrent=computed(()=>!!selected.value&&selected.value.quoteId===currentQuoteId.value);
const hasDraft=computed(()=>versions.value.some(v=>v.quoteId===currentQuoteId.value&&v.status==='draft'));
const actions=computed(()=>deliveryActions({writable:props.writable,locked:blocked.value,current:isCurrent.value,occupied:selected.value?.occupied??true,quoteOccupied:versions.value.some(v=>v.quoteId===currentQuoteId.value&&v.occupied),eligible:selected.value?.eligible??false,status:selected.value?.status||'',hasFiles:!!selected.value?.files.length,hasDraft:hasDraft.value}));
const labels:Record<QuoteDeliveryVersion['status'],string>={draft:'计价草稿',exported:'已导出 · 版本冻结',sent:'已登记发送',confirmed:'医院已确认',void:'已作废'};
const versionLabels=computed(()=>versions.value.map(v=>v.document.quoteNo+' · V'+v.versionNo+' · '+labels[v.status]));
const selectedIndex=computed(()=>Math.max(0,versions.value.findIndex(v=>v.id===selectedId.value)));
const jobState=computed(()=>exportJobPresentation(job.value?.state||null));
const path=()=>'/quotes/'+selected.value!.quoteId+'/versions/'+selected.value!.id;
const jobKey=(versionId:string)=>exportJobStorageKey(props.orderId,versionId);
const stamp=formatShanghaiTimestamp;
async function perform(work:()=>Promise<void>){
 if(blocked.value||disposed)return;
 working.value=true;refreshAfter=false;editAfter=false;emit('busyChanged',true);message.value='';let failure:unknown;
 try{await work();}catch(e){failure=e;}finally{working.value=false;if(!disposed){emit('busyChanged',false);if(failure)emit('failure',failure);else if(editAfter)emit('editDraft');else if(refreshAfter)emit('changed');}}
}
async function load(){
 const response=await request<{quoteId:string|null;items:QuoteDeliveryVersion[]}>('/sales/purchase-orders/'+props.orderId+'/quote-versions');
 if(disposed)return;
 currentQuoteId.value=response.quoteId;versions.value=response.items;
 if(!versions.value.some(v=>v.id===selectedId.value))selectedId.value=[...versions.value].reverse().find(v=>v.quoteId===response.quoteId)?.id||versions.value.at(-1)?.id||'';
 if(selected.value){
  const preview=await request<QuoteDeliveryVersion>(path()+'/preview');
  if(disposed)return;
  versions.value=versions.value.map(v=>v.id===preview.id?preview:v);
  const savedId=uni.getStorageSync(jobKey(preview.id));
  job.value=await resolveExportJob(preview,savedId,id=>request<ExportJob>('/jobs/'+id));
 }
 loaded.value=true;
}
async function refresh(){await perform(async()=>{await load();if(!disposed)refreshAfter=true;});}
async function selectVersion(event:unknown){
 const index=Number((event as {detail:{value:string}}).detail.value);
 await perform(async()=>{selectedId.value=versions.value[index]?.id||'';job.value=null;lossAcknowledged.value=false;await load();});
}
async function exportQuote(format:ExportFormat){
 if(!actions.value.export)return;
 await perform(async()=>{
  const version=selected.value!;
  await mutate<ExportAccepted>('导出报价 '+format.toUpperCase(),path()+'/export','POST',{expectedVersion:version.version,format,lossAcknowledged:lossAcknowledged.value});
  lossAcknowledged.value=false;
  await load();if(!disposed){message.value='导出任务已受理；请刷新任务状态，文件生成成功后才能下载。';refreshAfter=true;}
 });
}
async function markSent(){
 if(!actions.value.send||!channel.value.trim())return;
 await perform(async()=>{await mutate('登记线下发送',path()+'/mark-sent','POST',{expectedVersion:selected.value!.version,channel:channel.value,remark:sendRemark.value});await load();if(!disposed){message.value='线下发送记录已保存。';refreshAfter=true;}});
}
function fillCurrentConfirmation(){if(!actions.value.confirm)return;const current=shanghaiNowParts();confirmationDate.value=current.date;confirmationTime.value=current.time;}
async function confirmHospital(){
 if(!actions.value.confirm)return;
 await perform(async()=>{
  const actual=shanghaiDateTimeToIso(confirmationDate.value,confirmationTime.value);
  const accepted=await new Promise<boolean>(resolve=>uni.showModal({title:documentSummary.value.allMissing?'确认医院已知悉缺货？':'登记医院最终确认？',content:documentSummary.value.allMissing?'本单全部缺货，完成后不产生应收。':'将以本版最终总额 '+documentSummary.value.totalLabel+' 建立订单应收；确认后订单只读，其他未发送版本将作废。',confirmColor:'#216349',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
  if(!accepted)return;
  await mutate('登记医院实际确认',path()+'/confirm','POST',{expectedVersion:selected.value!.version,hospitalConfirmedAt:actual,backfillReason:backfillReason.value});
  await load();if(!disposed){message.value='医院实际确认已保存。';refreshAfter=true;}
 });
}
async function createNext(){
 if(!actions.value.next||!nextReason.value.trim())return;
 await perform(async()=>{const next=await mutate<QuoteDeliveryVersion>('创建下一报价版本',path()+'/create-next','POST',{expectedVersion:selected.value!.version,reason:nextReason.value});selectedId.value=next.id;await load();if(!disposed){refreshAfter=true;editAfter=true;}});
}
async function voidVersion(){
 if(!actions.value.void||!voidReason.value.trim())return;
 await perform(async()=>{
  const accepted=await new Promise<boolean>(resolve=>uni.showModal({title:'作废本报价版本？',content:'报价内容、文件和操作记录继续保留，作废后不能再发送或确认。',confirmColor:'#216349',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
  if(!accepted)return;
  await mutate('作废报价版本',path()+'/void','POST',{expectedVersion:selected.value!.version,reason:voidReason.value});await load();if(!disposed){message.value='报价版本已作废，历史记录保留。';refreshAfter=true;}
 });
}
async function download(id:string,format:ExportFormat,filename:string){await perform(async()=>{await downloadFile(id,format,filename);if(!disposed)message.value='已发起文件下载或打开，请核对文件后自行发送给医院。';});}
watch(()=>props.locked,value=>{if(!value&&!initialAttempted&&!working.value&&!pending.value){initialAttempted=true;void perform(load);}},{immediate:true});
defineExpose({refresh});
onBeforeUnmount(()=>{disposed=true;emit('busyChanged',false);});
</script>

<template>
 <view class="delivery">
  <view class="heading"><view><text class="eyebrow">{{selected?.document.hospitalName||'医院报价'}}</text><text class="title">报价交付</text></view><button class="link" :disabled="blocked" @click="refresh">刷新状态</button></view>
  <text v-if="!loaded" class="subtle">{{working?'正在读取报价版本…':'请刷新读取报价版本。'}}</text>
  <text v-else-if="!versions.length" class="subtle">暂无报价版本，请先完成计价并保存。</text>
  <template v-if="selected">
   <label class="field"><text>报价版本</text><picker :range="versionLabels" :value="selectedIndex" :disabled="blocked" @change="selectVersion"><view class="select">{{versionLabels[selectedIndex]}} ⌄</view></picker></label>
   <view class="status"><text>{{labels[selected.status]}}</text><text v-if="!isCurrent" class="subtle">旧采购修订 · 历史只读</text><text v-else-if="!writable" class="subtle">当前订单只读</text></view>
   <text v-if="selected.useInvalidatedAt" class="warning">基准已于 {{stamp(selected.useInvalidatedAt)}} 失效；历史文件保留，新确认须严格早于失效时间。</text>
   <view v-if="selected.occupied" class="notice">服务器正在生成文件，本版暂时占用。请等待后刷新状态；排队和生成中均不代表成功。</view>
   <text v-else-if="selected.blockReason&&selected.status!=='confirmed'&&selected.status!=='void'" class="warning">{{selected.blockReason}}</text>
   <view class="preview-head"><text class="section-title">医院报价预览</text><text class="subtle">{{selected.document.quoteNo}} · V{{selected.versionNo}}</text></view>
   <QuoteLogo v-if="selected.document.logo" :quote-id="selected.quoteId" :version-id="selected.id" :logo="selected.document.logo" @failure="emit('failure',$event)"/><view class="document-meta"><text>报价日期 {{selected.document.quoteDate}}</text><text>{{selected.document.sellerName}}</text><text>销售 {{selected.document.salespersonName}} · {{selected.document.contact||'未填写联系电话'}}</text></view>
   <scroll-view scroll-x class="table-scroll"><view class="quote-table">
    <view class="table-row table-head"><text>品名 / 规格</text><text>数量 kg</text><text>单价 元/kg</text><text>金额 元</text><text>公开备注</text></view>
    <view v-for="line in selected.document.lines" :key="line.position" class="table-row"><view><text class="drug">{{line.name}}</text><text class="subtle">{{line.spec||'未提供规格'}}</text></view><text class="number">{{line.quantity}}</text><text class="number">{{line.status==='missing'?'缺货':line.unitPrice||'—'}}</text><text class="number">{{line.status==='missing'?'—':line.amount||'—'}}</text><text class="remark">{{line.remark||'—'}}</text></view>
   </view></scroll-view>
   <view class="total"><text>报价总额</text><text>{{documentSummary.totalLabel}}</text></view>
   <view class="document-meta"><text>医院报价有效至 {{documentSummary.validityLabel}}</text><text>税注：{{selected.document.taxNote||'—'}}</text><text v-if="selected.document.notes">备注：{{selected.document.notes}}</text></view>
   <view v-if="actions.edit" class="section"><button class="secondary full" :disabled="blocked" @click="emit('editDraft')">返回编辑当前草稿</button><text class="subtle small">首次成功导出后本版冻结；后续修改需创建下一版本。</text></view>
   <view class="section">
    <text class="section-title">导出与下载</text>
    <label v-if="selected.requiresLossAcknowledgement" class="check-row" @click="actions.export&&(lossAcknowledged=!lossAcknowledged)"><checkbox :checked="lossAcknowledged" :disabled="blocked||!actions.export" color="#216349"/><text>已核对本次低于基准价的亏损风险</text></label>
    <view class="button-row"><button class="primary" :disabled="!actions.export||(selected.requiresLossAcknowledgement&&!lossAcknowledged)" @click="exportQuote('pdf')">导出 PDF</button><button class="secondary" :disabled="!actions.export||(selected.requiresLossAcknowledgement&&!lossAcknowledged)" @click="exportQuote('xlsx')">导出 Excel</button></view>
    <view v-if="job" class="job"><text :class="{warning:job.state==='failed'}">{{jobState.label}}</text><text class="subtle small">已尝试 {{job.attempts}} 次{{job.retryAt&&job.state!=='succeeded'?' · 下次处理 '+stamp(job.retryAt):''}}</text><text v-if="job.error" class="warning small">{{job.error}}</text><button class="link" :disabled="blocked" @click="refresh">刷新任务状态</button></view>
    <text v-else-if="selected.occupied" class="subtle small">已恢复服务器占用状态，请刷新核对结果。</text>
    <text v-if="!selected.files.length" class="subtle small">暂无成功生成的文件。</text>
    <view v-for="file in selected.files" :key="file.id" class="file-row"><view><text>{{file.filename}}</text><text class="subtle small">{{stamp(file.createdAt)}}</text></view><button class="link" :disabled="blocked" @click="download(file.id,file.format,file.filename)">打开 / 下载</button></view>
   </view>
   <view class="section">
    <text class="section-title">登记线下发送</text><text class="subtle small">请先将文件自行发给医院，再登记实际使用的渠道。</text>
    <label class="field"><text>发送渠道</text><input v-model="channel" :disabled="!actions.send" maxlength="100" placeholder="例如：微信、邮件、当面交付" /></label>
    <label class="field"><text>发送备注（选填）</text><textarea v-model="sendRemark" :disabled="!actions.send" maxlength="500" placeholder="填写本次发送情况" /></label>
    <button class="primary full" :disabled="!actions.send||!channel.trim()" @click="markSent">保存发送登记</button>
    <view v-for="send in selected.sends" :key="send.id" class="record"><text>{{send.channel}} · {{stamp(send.recordedAt)}}</text><text v-if="send.remark" class="subtle">{{send.remark}}</text></view>
   </view>
   <view class="section">
    <text class="section-title">{{documentSummary.allMissing?'医院知悉缺货与完成':'医院实际确认'}}</text>
    <text class="notice">{{documentSummary.allMissing?'全部缺货，医院知悉后完成，不产生应收。':'应收以医院最终确认的本版总额建立，账期按订单保存的实际接收日期及自然日账期计算。'}}</text>
    <text v-if="selected.status==='sent'&&!selected.eligible" class="subtle small">允许登记失效前或原有效期内真实发生的确认；是否符合补录条件由服务器核对。</text>
    <button class="link" :disabled="!actions.confirm" @click="fillCurrentConfirmation">填入当前北京时间</button><text class="subtle small">请核对真实发生时间，可修改日期和时分秒后再登记。</text>
    <view class="two"><label class="field"><text>实际确认日期（北京时间）</text><picker mode="date" :value="confirmationDate" :disabled="!actions.confirm" @change="confirmationDate=($event as any).detail.value"><view class="select">{{confirmationDate||'选择实际日期'}}</view></picker></label><label class="field"><text>实际确认时间（北京时间）</text><input v-model="confirmationTime" :disabled="!actions.confirm" maxlength="8" placeholder="例如 16:35:48" /></label></view>
    <label class="field"><text>补录原因（跨日、当前过期或基准已失效时必填）</text><textarea v-model="backfillReason" :disabled="!actions.confirm" maxlength="500" placeholder="填写延迟登记的实际原因" /></label>
    <button class="primary full" :disabled="!actions.confirm||!confirmationDate||!confirmationTime" @click="confirmHospital">{{documentSummary.allMissing?'确认已知悉缺货并完成':'登记医院最终确认'}}</button>
    <view v-if="selected.hospitalConfirmedAt" class="record"><text>实际确认 {{stamp(selected.hospitalConfirmedAt)}}</text><text class="subtle">录入 {{stamp(selected.recordedAt)}}</text><text v-if="selected.backfillReason" class="subtle">补录原因：{{selected.backfillReason}}</text></view>
    <view v-if="selected.receivable" class="receivable"><text>订单应收 ¥ {{selected.receivable.amount}}</text><text>到期日 {{selected.receivable.dueDate}}</text></view>
   </view>
   <view v-if="writable&&isCurrent&&selected.status!=='confirmed'" class="section">
    <text class="section-title">版本管理</text><text class="subtle small">{{selected.status==='void'?'本版已作废，原内容和记录保持只读。可创建新的报价草稿，重新核对当前厂家基准和最终报价。':'冻结版本保留原内容。创建下一版本后，须重新核对当前厂家基准和最终报价。'}}</text>
    <label class="field"><text>创建下一版本的原因</text><textarea v-model="nextReason" :disabled="!actions.next" maxlength="500" placeholder="填写修改原因" /></label><button class="secondary full" :disabled="!actions.next||!nextReason.trim()" @click="createNext">创建下一版本并计价</button>
    <text v-if="hasDraft&&selected.status!=='draft'" class="subtle small">已有计价草稿，请从版本选择中打开该草稿。</text>
    <label v-if="selected.status!=='void'" class="field"><text>作废本版本的原因</text><textarea v-model="voidReason" :disabled="!actions.void" maxlength="500" placeholder="填写作废原因" /></label><button v-if="selected.status!=='void'" class="link danger" :disabled="!actions.void||!voidReason.trim()" @click="voidVersion">作废本报价版本</button>
   </view>
  </template>
  <text v-if="message" class="notice" role="status">{{message}}</text>
 </view>
</template>

<style scoped>
.delivery{padding:18px 0;color:#243129;font-size:14px}.heading,.status,.preview-head,.total,.file-row,.receivable{display:flex;justify-content:space-between;align-items:center;gap:14px}.title{display:block;font-size:26px;font-weight:600;letter-spacing:-.7px;margin:4px 0 18px}.eyebrow,.subtle{display:block;color:#748077;font-size:13px}.small{font-size:12px}.section-title{font-size:16px;font-weight:600}.status{padding:10px 0;font-weight:600}.status .subtle{font-weight:400}.preview-head{margin:24px 0 12px}.document-meta{display:grid;gap:4px;font-size:12px;color:#526058;line-height:1.7}.table-scroll{width:100%;margin:18px 0}.quote-table{min-width:760px;font-variant-numeric:tabular-nums}.table-row{display:grid;grid-template-columns:minmax(170px,2fr) 95px 110px 110px minmax(180px,2fr);gap:16px;padding:14px 10px;border-bottom:1px solid #e0e7df;align-items:start;font-size:13px}.table-head{background:#f4f7f3;color:#748077;font-size:12px}.table-row>text:nth-child(2),.table-row>text:nth-child(3),.table-row>text:nth-child(4),.number{text-align:right}.drug{display:block;font-weight:550}.remark{white-space:pre-wrap;overflow-wrap:anywhere}.total{font-size:16px;font-weight:600;margin:16px 0}.section{border-top:1px solid #e0e7df;margin-top:24px;padding-top:22px}.section>.subtle{margin-top:8px}.field{display:block;margin:16px 0;min-width:0}.field>text{display:block;color:#526058;font-size:12px;margin-bottom:6px}.field input,.select,.field textarea{box-sizing:border-box;background:#fff;border:1px solid #cdd9ce;border-radius:5px;min-height:46px;line-height:24px;padding:10px 12px;width:100%;font-size:14px;color:#243129}.field textarea{height:88px}.select{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.two .field{margin-bottom:0}.button-row{display:flex;gap:12px;margin:16px 0}.full{width:100%}button{min-height:44px;padding:10px 14px;line-height:24px;border-radius:5px;transition:background .16s,opacity .16s;margin:0;font-size:14px;white-space:normal}button[disabled]{opacity:.45}.primary{background:#216349;color:#fff;flex:1}.secondary{background:#fff;border:1px solid #cdd9ce;color:#216349;flex:1}.link{background:transparent;color:#216349;padding:8px 0;font-size:12px;flex:none}.danger,.warning{color:#a04435}.warning{display:block;font-size:12px;margin:10px 0}.notice{padding:12px;background:#edf4ef;color:#216349;font-size:12px;display:block;margin:14px 0;border-left:2px solid #216349}.check-row{display:flex;gap:8px;align-items:center;font-size:12px;min-height:48px}.job{border-left:2px solid #cdd9ce;padding:8px 12px;margin:16px 0}.file-row{border-bottom:1px solid #e0e7df;padding:14px 0}.file-row>view{min-width:0;overflow-wrap:anywhere}.record{padding:14px 0;border-bottom:1px solid #e0e7df;font-size:12px}.record>text{display:block}.receivable{padding:14px 0;color:#216349;font-weight:600}@media(min-width:700px){.delivery{max-width:720px;margin:auto}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
