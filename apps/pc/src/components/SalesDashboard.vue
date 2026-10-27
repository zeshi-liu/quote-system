<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import type {DashboardNoticeRef,DashboardNoticeReceipt,DashboardStage,SalesDashboard} from '../../../../packages/contracts/src/dashboard';
import type {PcApi} from '../api';
const props=defineProps<{api:Pick<PcApi,'get'|'post'>;locked?:boolean}>();
const emit=defineEmits<{busyChanged:[value:boolean];failure:[message:string];openOrder:[orderId?:string];createPurchase:[];openReceivables:[];openFinance:[target:{orderId:string;receivableId:string}]}>();
const data=ref<SalesDashboard|null>(null),loading=ref(false),error=ref(''),acknowledging=ref(false),ackError=ref(''),pendingAck=ref<DashboardNoticeRef[]|null>(null);
const busy=computed(()=>loading.value||acknowledging.value);
const shownEvents=computed(()=>data.value?[...data.value.notices.newPurchases.items,...data.value.notices.newSupplierQuotes.items].map(({kind,eventId})=>({kind,eventId})):[]);
const emitBusy=()=>emit('busyChanged',busy.value);
let disposed=false,generation=0;
const stages:{key:DashboardStage;label:string;action:string}[]=[{key:'review',label:'待校对',action:'校对采购单'},{key:'inquiry',label:'厂家报价中',action:'查看询价'},{key:'ready',label:'可计价',action:'进入计价'},{key:'pricing',label:'报价草稿',action:'继续计价'},{key:'exported',label:'已导出待发送',action:'查看报价'},{key:'sent',label:'已发送待确认',action:'登记医院确认'}];
const stage=(key:DashboardStage)=>stages.find(s=>s.key===key)!;
// Format exact decimal strings without losing cents on totals larger than one order.
const money=(value:string)=>value.replace(/\B(?=(\d{3})+(?!\d))/g,',');
const time=(value:string)=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
async function refresh(){
 const ticket=++generation,api=props.api;data.value=null;error.value='';loading.value=true;emitBusy();
 try{const result=await api.get<SalesDashboard>('/sales/dashboard');if(disposed||ticket!==generation||api!==props.api)return;data.value=result;}
 catch(e){if(disposed||ticket!==generation||api!==props.api)return;error.value=e instanceof Error?e.message:'工作台读取失败，请刷新重试。';emit('failure',error.value);}
 finally{if(!disposed&&ticket===generation){loading.value=false;emitBusy();}}
}
function openOrder(id?:string){if(!busy.value&&!props.locked)emit('openOrder',id);}
async function acknowledge(){
 if(busy.value||props.locked)return;
 const events=pendingAck.value||shownEvents.value;if(!events.length)return;
 const api=props.api;pendingAck.value=events.map(e=>({...e}));acknowledging.value=true;ackError.value='';emitBusy();
 try{const receipt=await api.post<DashboardNoticeReceipt>('/sales/dashboard/notices/ack',{events:pendingAck.value});if(disposed||api!==props.api)return;
  if(JSON.stringify(receipt?.acknowledged)!==JSON.stringify(events))throw Error('已读回执无法核实');
  pendingAck.value=null;ackError.value='';await refresh();
 }catch(e){if(!disposed&&api===props.api){const failure=(e||{}) as {status?:number;code?:string;unknown?:boolean},status=failure.status,code=typeof failure.code==='string'?failure.code:'';const outcomeUnknown=failure.unknown===true||code.endsWith('_UNKNOWN')||code.includes('TIMEOUT')||['NETWORK_ERROR','BUSY_RETRY_REQUIRED'].includes(code);if(typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<500&&status!==408&&!outcomeUnknown){pendingAck.value=null;ackError.value='提示或权限已变化，请重新读取核对。';}else ackError.value='标记结果未确认，角标尚未改动；可按原事件重试，或重新读取核实。';}}
 finally{if(!disposed&&api===props.api){acknowledging.value=false;emitBusy();}}
}
onMounted(refresh);watch(()=>props.api,()=>{pendingAck.value=null;ackError.value='';acknowledging.value=false;void refresh();});
onBeforeUnmount(()=>{disposed=true;generation++;emit('busyChanged',false);});
defineExpose({refresh,canLeave:()=>!busy.value});
</script>
<template>
 <section class="sales-dashboard" :aria-busy="busy">
  <header class="heading"><div><h1>工作台</h1><p class="muted">我负责的订单<span v-if="data"> · 北京时间 {{ data.businessDate }}</span></p></div><div class="dashboard-actions"><button :disabled="busy||locked" @click="refresh">刷新</button><button class="primary" :disabled="busy||locked" @click="emit('createPurchase')">＋ 新建采购单</button></div></header>
  <p v-if="loading" class="loading" role="status">正在读取报价待办与回款余额…</p>
  <p v-else-if="error" class="error" role="alert">{{ error }}<button :disabled="busy||locked" @click="refresh">重试</button></p>
  <template v-else-if="data">
   <section class="dashboard-notices" aria-label="站内新提示"><div class="dashboard-section-heading"><h2>站内提示 <span class="notice-badge">{{ data.notices.unreadTotal }}</span></h2><button :disabled="busy||locked||!pendingAck&&!shownEvents.length" @click="acknowledge">{{acknowledging?'正在标记…':pendingAck?'重试已读标记':'将当前展示提示标记已读'}}</button></div>
    <p v-if="ackError" class="error" role="alert">{{ackError}}</p><div class="dashboard-notice-columns">
     <section><h3>新采购单 <span class="notice-badge">{{data.notices.newPurchases.total}}</span></h3><p class="dashboard-meta">未读全量 · 展示前 {{data.notices.newPurchases.limit}} 条，点开订单不会自动标记已读。</p><p v-if="!data.notices.newPurchases.total" class="muted">暂无新采购单提示。</p><article v-for="item in data.notices.newPurchases.items" :key="item.eventId" class="dashboard-notice-row"><span>{{item.hospitalName}} · {{item.orderNo}}</span><button class="text-button" :disabled="busy||locked" @click="openOrder(item.orderId)">查看新采购单 →</button></article></section>
     <section><h3>新厂家报价 <span class="notice-badge">{{data.notices.newSupplierQuotes.total}}</span></h3><p class="dashboard-meta">未读全量 · 展示前 {{data.notices.newSupplierQuotes.limit}} 条，仅含当前修订有效报价。</p><p v-if="!data.notices.newSupplierQuotes.total" class="muted">暂无新厂家报价提示。</p><article v-for="item in data.notices.newSupplierQuotes.items" :key="item.eventId" class="dashboard-notice-row"><span>{{item.hospitalName}} · {{item.manufacturerName}} · {{item.orderNo}}</span><button class="text-button" :disabled="busy||locked" @click="openOrder(item.orderId)">查看厂家报价 →</button></article></section>
    </div>
   </section>
   <div class="dashboard-summary" aria-label="报价处理阶段"><div v-for="s in stages" :key="s.key"><span>{{ s.label }}</span><strong>{{ data.tasks.counts[s.key] }}</strong></div></div>
   <div class="dashboard-columns">
    <section class="dashboard-tasks" aria-labelledby="quote-tasks-title"><div class="dashboard-section-heading"><h2 id="quote-tasks-title">报价待办</h2><button class="text-button" :disabled="busy||locked" @click="openOrder()">全部采购单 →</button></div><p class="muted dashboard-list-note">共 {{ data.tasks.total }} 单 · 按处理阶段优先、实际接收日期先后展示前 {{ data.tasks.limit }} 单</p>
     <p v-if="!data.tasks.total" class="empty">暂无待处理报价订单。</p>
     <article v-for="task in data.tasks.items" :key="task.orderId" class="dashboard-task"><div class="dashboard-row"><strong>{{ task.hospitalName }}</strong><span class="dashboard-stage">{{ stage(task.stage).label }}</span></div><p class="dashboard-meta">{{ task.orderNo }} · R{{ task.revisionNo }} · {{ task.receivedDate }} 接收</p><div class="dashboard-row"><span class="muted">{{ task.lineCount }} 味药<span v-if="task.stage==='ready'"> · {{ task.validSupplierCount }} 家有效厂家<span v-if="task.validSupplierCount===1">，需确认提前计价</span></span></span><button class="text-button" :disabled="busy||locked" @click="openOrder(task.orderId)">{{ stage(task.stage).action }} →</button></div></article>
    </section>
    <section class="dashboard-receivables" aria-labelledby="receivable-title"><div class="dashboard-section-heading"><h2 id="receivable-title">回款跟进</h2><button class="text-button" :disabled="busy||locked" @click="emit('openReceivables')">回款台账 →</button></div><p class="muted">未收余额 · {{ data.receivables.outstandingCount }} 单</p><p class="dashboard-balance">¥{{ money(data.receivables.outstandingBalance) }}</p><p class="dashboard-meta">含未到期；暂停催收 {{ data.receivables.pausedCount }} 单，¥{{ money(data.receivables.pausedBalance) }}</p>
     <div class="dashboard-due-summary"><div><span>今日到期 · {{ data.receivables.dueCount }} 单</span><strong>¥{{ money(data.receivables.dueBalance) }}</strong></div><div class="dashboard-overdue"><span>逾期 · {{ data.receivables.overdueCount }} 单</span><strong>¥{{ money(data.receivables.overdueBalance) }}</strong></div></div><p class="dashboard-meta">今日到期、逾期金额均不含暂停催收。</p>
     <p class="muted dashboard-list-note">到期及逾期共 {{ data.receivables.followUpCount }} 单 · 展示前 {{ data.receivables.limit }} 单</p><p v-if="!data.receivables.followUpCount" class="empty">暂无到期或逾期未收订单。</p>
     <article v-for="item in data.receivables.items" :key="item.receivableId" class="dashboard-due-row"><div class="dashboard-row"><strong>{{ item.hospitalName }}</strong><strong>¥{{ money(item.balance) }}</strong></div><p class="dashboard-meta">{{ item.orderNo }} · 到期 {{ item.dueDate }}</p><p class="dashboard-meta">应收 ¥{{ money(item.amount) }} · 已收 ¥{{ money(item.paid) }}</p><div class="dashboard-row"><span :class="{'dashboard-overdue':item.overdueDays>0&&!item.paused}">{{ item.paused?'暂停催收 · 不催收':item.overdueDays>0?'逾期 '+item.overdueDays+' 天':'今日到期' }}</span><button class="text-button" :disabled="busy||locked" @click="emit('openFinance',{orderId:item.orderId,receivableId:item.receivableId})">{{ item.paused?'处理异常':'账期 / 异常' }} →</button></div></article>
     <button class="text-button dashboard-all-receivables" :disabled="busy||locked" @click="emit('openReceivables')">查看全部回款台账 →</button>
    </section>
   </div><p class="footnote">数据截至北京时间 {{ time(data.asOf) }} · 报价完成后的未收款继续纳入回款跟进。</p>
  </template>
 </section>
</template>
<style scoped>
.dashboard-notices{border-top:1px solid #dce5df;padding-top:18px;margin-top:24px}.dashboard-notice-columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.dashboard-notice-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #e2e9e4;padding:10px 0;font-size:12px}.notice-badge{display:inline-block;min-width:18px;padding:2px 6px;border-radius:12px;background:#eaf2ed;color:#215f46;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}h3{font-size:14px}@media(max-width:650px){.dashboard-notice-columns{grid-template-columns:1fr}.dashboard-notice-row{flex-wrap:wrap}}

.sales-dashboard{padding-top:28px}.dashboard-actions,.dashboard-row,.dashboard-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.dashboard-actions{justify-content:flex-end;flex-wrap:wrap}.dashboard-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));padding:22px 0;border-top:1px solid #dce5df;border-bottom:1px solid #dce5df;margin:22px 0 28px}.dashboard-summary>div{padding:0 18px;border-left:1px solid #e2e9e4}.dashboard-summary>div:first-child{padding-left:0;border-left:0}.dashboard-summary span{font-size:12px;color:#74837a;display:block}.dashboard-summary strong{display:block;font-size:28px;font-weight:500;margin-top:6px;font-variant-numeric:tabular-nums}.dashboard-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(310px,35%);gap:32px}.dashboard-section-heading h2{margin:0}.dashboard-receivables{border-left:1px solid #e2e9e4;padding-left:30px;min-width:0}.dashboard-list-note{font-size:11px;margin:10px 0}.dashboard-task{padding:20px 0;border-bottom:1px solid #e2e9e4}.dashboard-row strong{font-weight:500;font-size:14px;overflow-wrap:anywhere}.dashboard-stage{font-size:11px;background:#eaf2ed;color:#215f46;padding:4px 7px;border-radius:3px;white-space:nowrap}.dashboard-meta{font-size:11px;color:#74837a;line-height:1.7;margin:6px 0}.dashboard-balance{font-size:30px;font-variant-numeric:tabular-nums;line-height:1.4;margin:4px 0;overflow-wrap:anywhere}.dashboard-due-summary{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:20px 0;border-bottom:1px solid #e2e9e4}.dashboard-due-summary span{font-size:11px;color:#74837a;display:block}.dashboard-due-summary strong{font-size:16px;font-weight:500;display:block;margin-top:5px;overflow-wrap:anywhere}.dashboard-overdue{color:#a34c3e}.dashboard-due-row{font-size:11px;padding:16px 0;border-bottom:1px solid #e2e9e4}.dashboard-due-row .dashboard-row strong{font-size:13px}.dashboard-due-row .text-button{font-size:11px}.dashboard-all-receivables{margin-top:12px}@media(max-width:1050px){.dashboard-columns{grid-template-columns:1fr}.dashboard-receivables{border-left:0;border-top:1px solid #e2e9e4;padding:24px 0 0}.dashboard-summary{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px 0}.dashboard-summary>div:nth-child(4){padding-left:0;border-left:0}}@media(max-width:560px){.dashboard-actions{justify-content:flex-start;margin-top:16px}.dashboard-row{align-items:flex-start;flex-wrap:wrap;gap:6px}.dashboard-row .text-button{margin-left:auto}.dashboard-summary>div{padding:0 10px}.dashboard-summary span{font-size:10px}.dashboard-summary strong{font-size:24px}.dashboard-balance{font-size:26px}}
</style>
