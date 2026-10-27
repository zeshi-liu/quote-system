<script setup lang="ts">
import QuoteLogo from './QuoteLogo.vue';
import {computed,onMounted,onBeforeUnmount,ref,shallowRef,watch} from 'vue';
import type {ExportAccepted,ExportFormat,QuoteDeliveryVersion,OrderView} from '@quote/contracts';
import {fetchDownload,type PcApi} from '../api';
import type {BusinessOperations} from '../business-pending';
import {deliveryActions,deliveryDocumentPresentation,exportJobPresentation,formatShanghaiTimestamp,shanghaiDateTimeToIso,shanghaiNowParts} from '../../../mini/src/delivery-domain';
const props=defineProps<{api:Pick<PcApi,'get'|'post'|'write'|'getImage'>;order:OrderView;operations:BusinessOperations;userId:string;locked:boolean}>();
const emit=defineEmits<{busyChanged:[value:boolean];changed:[];edit:[];failure:[e:unknown]}>();
const versions=ref<QuoteDeliveryVersion[]>([]),selectedId=ref(''),quoteId=ref<string|null>(null),working=ref(false),message=ref(''),risk=ref(false),channel=ref(''),sendRemark=ref(''),confirmedDate=ref(''),confirmedTime=ref(''),backfill=ref(''),reason=ref('');let disposed=false,needsRefresh=false,needsEdit=false;let initialReadStarted=false;
interface ConfirmationReview {scope:number;quoteId:string;versionId:string;expectedVersion:number;hospitalName:string;orderNo:string;quoteNo:string;versionNo:number;totalLabel:string;allMissing:boolean;hospitalConfirmedAt:string;backfillReason:string;submit:()=>Promise<void>;}
const confirmationReview=shallowRef<ConfirmationReview|null>(null);let contextEpoch=0;
const interactionLocked=computed(()=>props.locked||working.value||!!confirmationReview.value||!!props.operations.pending);
watch(()=>working.value||!!confirmationReview.value,value=>{if(!disposed)emit('busyChanged',value);},{flush:'sync'});
watch(()=>[props.userId,props.api,props.operations,props.order.id,props.order.hospitalId,props.order.revisionId,props.order.version,props.order.status,props.order.writable],(next,previous)=>{
 contextEpoch++;confirmationReview.value=null;needsRefresh=false;needsEdit=false;
 if(next.slice(0,6).some((value,i)=>value!==previous[i])){versions.value=[];selectedId.value='';quoteId.value=null;confirmedDate.value='';confirmedTime.value='';backfill.value='';message.value='';initialReadStarted=false;}
},{flush:'sync'});
const current=computed(()=>versions.value.find(v=>v.id===selectedId.value));const summary=computed(()=>deliveryDocumentPresentation(current.value?.document||{total:null,validUntil:null,lines:[]}));
const actions=computed(()=>deliveryActions({writable:props.order.writable&&!['completed','voided'].includes(props.order.status),locked:interactionLocked.value,current:current.value?.quoteId===quoteId.value,occupied:current.value?.occupied??true,quoteOccupied:versions.value.some(v=>v.quoteId===quoteId.value&&v.occupied),eligible:current.value?.eligible??false,status:current.value?.status||'',hasFiles:!!current.value?.files.length,hasDraft:versions.value.some(v=>v.quoteId===quoteId.value&&v.status==='draft')}));
const labels:Record<string,string>={draft:'计价草稿',exported:'已导出',sent:'已发送',confirmed:'已确认',void:'已作废'};
const path=()=>`/quotes/${current.value!.quoteId}/versions/${current.value!.id}`;
watch(()=>[quoteId.value,selectedId.value,current.value?.version,current.value?.status,current.value?.occupied,current.value?.eligible,current.value?.useInvalidatedAt,current.value?.document.total,current.value?.document.quoteNo,current.value?.document.hospitalName,summary.value.allMissing],()=>{confirmationReview.value=null;},{flush:'sync'});
async function load(){
 const scope=contextEpoch,api=props.api,orderId=props.order.id;
 const r=await api.get<{quoteId:string|null;items:QuoteDeliveryVersion[]}>(`/sales/purchase-orders/${orderId}/quote-versions`);
 if(disposed||scope!==contextEpoch)return false;
 quoteId.value=r.quoteId;versions.value=r.items;
 if(!r.items.some(v=>v.id===selectedId.value))selectedId.value=[...r.items].reverse().find(v=>v.quoteId===r.quoteId)?.id||r.items.at(-1)?.id||'';
 const selected=current.value;
 if(selected){const v=await api.get<QuoteDeliveryVersion>(`/quotes/${selected.quoteId}/versions/${selected.id}/preview`);if(disposed||scope!==contextEpoch||selectedId.value!==selected.id)return false;versions.value=versions.value.map(x=>x.id===v.id?v:x);}
 return true;
}
async function run(work:()=>Promise<void>,reviewToCommit?:ConfirmationReview){
 if(disposed||working.value||props.locked||confirmationReview.value&&confirmationReview.value!==reviewToCommit)return;
 const scope=contextEpoch;working.value=true;needsRefresh=false;needsEdit=false;if(reviewToCommit)confirmationReview.value=null;
 try{await work();}catch(e){if(!disposed&&scope===contextEpoch)emit('failure',e);}
 finally{working.value=false;if(!disposed&&scope===contextEpoch){if(needsEdit)emit('edit');else if(needsRefresh)emit('changed');}}
}
async function refresh(){await run(async()=>{if(await load())needsRefresh=true;});}
async function exportFile(format:ExportFormat){await run(async()=>{await props.operations.mutate<ExportAccepted>('导出'+format,path()+'/export','POST',{expectedVersion:current.value!.version,format,lossAcknowledged:risk.value});risk.value=false;await load();message.value='任务已受理，文件生成成功后可下载。';needsRefresh=true;});}
async function sent(){await run(async()=>{await props.operations.mutate('登记发送',path()+'/mark-sent','POST',{expectedVersion:current.value!.version,channel:channel.value,remark:sendRemark.value});await load();needsRefresh=true;});}
function fillNow(){const t=shanghaiNowParts();confirmedDate.value=t.date;confirmedTime.value=t.time;}
function confirm(){
 if(!actions.value.confirm||!current.value||!confirmedDate.value||!confirmedTime.value)return;
 try{const v=current.value,reviewed:ConfirmationReview={scope:contextEpoch,quoteId:v.quoteId,versionId:v.id,expectedVersion:v.version,hospitalName:v.document.hospitalName,orderNo:props.order.orderNo,quoteNo:v.document.quoteNo,versionNo:v.versionNo,totalLabel:summary.value.totalLabel,allMissing:summary.value.allMissing,hospitalConfirmedAt:shanghaiDateTimeToIso(confirmedDate.value,confirmedTime.value),backfillReason:backfill.value,submit:()=>commitConfirmation(reviewed)};confirmationReview.value=reviewed;}
 catch(e){emit('failure',e);}
}
function cancelConfirmation(){if(!working.value)confirmationReview.value=null;}
async function commitConfirmation(reviewed:ConfirmationReview){
 const operations=props.operations;
 if(confirmationReview.value!==reviewed||reviewed.scope!==contextEpoch||props.locked||working.value||operations.pending||current.value?.id!==reviewed.versionId||current.value?.quoteId!==reviewed.quoteId||current.value?.version!==reviewed.expectedVersion)return;
 await run(async()=>{
  await operations.mutate('医院实际确认',`/quotes/${reviewed.quoteId}/versions/${reviewed.versionId}/confirm`,'POST',{expectedVersion:reviewed.expectedVersion,hospitalConfirmedAt:reviewed.hospitalConfirmedAt,backfillReason:reviewed.backfillReason});
  if(disposed||reviewed.scope!==contextEpoch)return;
  if(await load())needsRefresh=true;
 },reviewed);
}
async function versionAction(action:'create-next'|'void'){if(!window.confirm(action==='void'?'作废本版，保留历史资料？':'创建新报价草稿，保留已冻结版本？'))return;await run(async()=>{const r=await props.operations.mutate<QuoteDeliveryVersion>('报价版本'+action,path()+'/'+action,'POST',{expectedVersion:current.value!.version,reason:reason.value});selectedId.value=r.id;reason.value='';await load();needsRefresh=true;if(action==='create-next')needsEdit=true;});}
async function download(file:{id:string;filename:string}){await run(async()=>{const grant=await props.api.post<{url:string}>(`/files/${file.id}/download-url`,{}),blob=await fetchDownload(grant.url),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);});}
function initialize(){if(initialReadStarted||props.locked||disposed)return;initialReadStarted=true;void refresh();}
onMounted(initialize);watch(()=>props.locked,locked=>{if(locked)confirmationReview.value=null;else initialize();});onBeforeUnmount(()=>{disposed=true;contextEpoch++;confirmationReview.value=null;emit('busyChanged',false);});defineExpose({refresh});
</script>
<template>
 <section class="pc-delivery"><div class="heading"><h2>报价预览与交付</h2><button :disabled="interactionLocked" @click="refresh">刷新任务及版本</button></div><p v-if="message" role="status">{{message}}</p>
 <label>报价版本<select v-model="selectedId" :disabled="interactionLocked" @change="refresh"><option v-for="v in versions" :key="v.id" :value="v.id">{{v.document.quoteNo}} · V{{v.versionNo}} · {{labels[v.status]}}</option></select></label><p v-if="!versions.length" class="muted">暂无报价，请先完成计价。</p>
 <template v-if="current"><QuoteLogo v-if="current.document.logo" :api="api" :quote-id="current.quoteId" :version-id="current.id" :logo="current.document.logo" @failure="emit('failure',$event)"/><p class="muted">{{labels[current.status]}} · {{current.document.hospitalName}} · 有效至 {{summary.validityLabel}}</p><p v-if="current.useInvalidatedAt" class="error">本版已失效，禁止再次发送或新的确认；仅可登记符合条件的历史实际确认。</p>
 <div class="table-scroll"><table><thead><tr><th>品名 / 规格</th><th>数量 kg</th><th>单价 元/kg</th><th>金额 元</th><th>备注</th></tr></thead><tbody><tr v-for="l in current.document.lines" :key="l.position"><td>{{l.name}}<small>{{l.spec}}</small></td><td>{{l.quantity}}</td><td>{{l.status==='missing'?'缺货':l.unitPrice||'待完善'}}</td><td>{{l.amount||'—'}}</td><td>{{l.remark||'—'}}</td></tr></tbody></table></div><p class="quote-total">{{summary.totalLabel}}</p><p class="muted">{{current.document.sellerName}} · {{current.document.contact}} · {{current.document.taxNote}}</p>
 <section class="detail-panel"><h2>导出与下载</h2><label v-if="current.requiresLossAcknowledgement" class="inline-check"><input type="checkbox" v-model="risk" :disabled="!actions.export" />已核对低于基准价的亏损风险</label><div class="button-row"><button class="primary" :disabled="!actions.export||current.requiresLossAcknowledgement&&!risk" @click="exportFile('pdf')">导出 PDF</button><button :disabled="!actions.export||current.requiresLossAcknowledgement&&!risk" @click="exportFile('xlsx')">导出 Excel</button><button v-if="actions.edit" :disabled="interactionLocked" @click="emit('edit')">继续计价</button></div>
 <p v-if="current.latestJob">任务：{{exportJobPresentation(current.latestJob.state).label}} · 尝试 {{current.latestJob.attempts}} 次 <span v-if="current.latestJob.error">{{current.latestJob.error}}</span></p><p v-else-if="current.occupied">文件正在生成，请稍后刷新。</p><div v-for="f in current.files" :key="f.id" class="file-row"><span>{{f.filename}}<small>{{formatShanghaiTimestamp(f.createdAt)}}</small></span><button :disabled="interactionLocked" @click="download(f)">下载</button></div></section>
 <section class="detail-panel"><h2>登记线下发送</h2><div class="form-grid"><label>实际发送渠道<input v-model="channel" :disabled="!actions.send" placeholder="微信、当面交付等" maxlength="100" /></label><label>发送备注<input v-model="sendRemark" :disabled="!actions.send" maxlength="500" /></label></div><button :disabled="!actions.send||!channel.trim()" @click="sent">保存发送登记</button><p v-for="s in current.sends" :key="s.id">{{s.channel}} · {{formatShanghaiTimestamp(s.recordedAt)}} · {{s.remark}}</p></section>
 <section class="detail-panel"><h2>{{summary.allMissing?'医院知悉缺货':'医院实际确认'}}</h2><p class="muted">{{summary.allMissing?'全部缺货，完成后不产生应收。':'以最终确认金额建立唯一订单应收。实际确认时间与录入时间分别保存。'}}</p><button :disabled="!actions.confirm" @click="fillNow">填入当前北京时间</button><div class="form-grid"><label>实际确认日期<input type="date" v-model="confirmedDate" :disabled="!actions.confirm" /></label><label>实际确认时间（北京时间）<input type="time" step="1" v-model="confirmedTime" :disabled="!actions.confirm" /></label><label>延迟补录原因<textarea v-model="backfill" :disabled="!actions.confirm" maxlength="500"></textarea></label></div><button class="primary" :disabled="!actions.confirm||!confirmedDate||!confirmedTime" @click="confirm">{{summary.allMissing?'确认已知悉并完成':'登记最终确认'}}</button><section v-if="confirmationReview" class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="hospital-confirmation-review"><h3 id="hospital-confirmation-review">确认登记前复核</h3><p>{{confirmationReview.hospitalName}} · {{confirmationReview.orderNo}}</p><p>{{confirmationReview.quoteNo}} · V{{confirmationReview.versionNo}} · {{confirmationReview.totalLabel}}</p><p>{{confirmationReview.allMissing?'医院已知悉全部缺货，本次完成不产生应收。':'医院已实际接受本版报价，确认登记后按上述金额建立订单应收。'}}</p><p>实际确认：{{formatShanghaiTimestamp(confirmationReview.hospitalConfirmedAt)}}</p><p>补录说明：{{confirmationReview.backfillReason||'未填写'}}</p><div class="button-row"><button :disabled="working" @click="cancelConfirmation">返回修改</button><button class="primary" :disabled="working||locked" @click="confirmationReview.submit">确认登记</button></div></section><p v-if="current.hospitalConfirmedAt">实际确认 {{formatShanghaiTimestamp(current.hospitalConfirmedAt)}}<small>录入 {{formatShanghaiTimestamp(current.recordedAt)}}</small></p><p v-if="current.receivable">应收 ¥{{current.receivable.amount}} · 到期 {{current.receivable.dueDate}}</p></section>
 <section v-if="actions.next||actions.void" class="detail-panel"><h2>版本管理</h2><label>原因<textarea v-model="reason" maxlength="500" :disabled="interactionLocked"></textarea></label><div class="button-row"><button :disabled="!actions.next||!reason.trim()" @click="versionAction('create-next')">创建下一报价版本</button><button :disabled="!actions.void||!reason.trim()" @click="versionAction('void')">作废本报价版本</button></div></section>
 </template></section>
</template>
