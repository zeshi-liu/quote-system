<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import type {DashboardNoticeRef,DashboardNoticeReceipt,DashboardStage,SalesDashboard} from '../../../../packages/contracts/src/dashboard';
import {request,session} from '../api';
const props=defineProps<{locked?:boolean}>();
const emit=defineEmits<{busyChanged:[value:boolean];failure:[error:unknown];openOrder:[orderId?:string];createPurchase:[];openReceivables:[];openFinance:[target:{orderId:string;receivableId:string}]}>();
const data=ref<SalesDashboard|null>(null),loading=ref(false),error=ref(''),acknowledging=ref(false),ackError=ref(''),pendingAck=ref<DashboardNoticeRef[]|null>(null);
const busy=computed(()=>loading.value||acknowledging.value),shownEvents=computed(()=>data.value?[...data.value.notices.newPurchases.items,...data.value.notices.newSupplierQuotes.items].map(({kind,eventId})=>({kind,eventId})):[]);
const emitBusy=()=>emit('busyChanged',busy.value);
const identity=()=>[session.value?.user.id,session.value?.token,session.value?.user.role].join(':');
let disposed=false,generation=0;
const current=(scope:string)=>!disposed&&scope===identity()&&session.value?.user.role==='salesperson';
const stages:{key:DashboardStage;label:string;action:string}[]=[{key:'review',label:'待校对',action:'校对采购单'},{key:'inquiry',label:'厂家报价中',action:'查看询价'},{key:'ready',label:'可计价',action:'进入计价'},{key:'pricing',label:'报价草稿',action:'继续计价'},{key:'exported',label:'已导出待发送',action:'查看报价'},{key:'sent',label:'已发送待确认',action:'登记医院确认'}];
const stage=(key:DashboardStage)=>stages.find(s=>s.key===key)!;
const money=(value:string)=>value.replace(/\B(?=(\d{3})+(?!\d))/g,',');
const time=(value:string)=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
async function refresh(){
 const ticket=++generation,scope=identity();data.value=null;error.value='';if(!current(scope))return;loading.value=true;emitBusy();
 try{const result=await request<SalesDashboard>('/sales/dashboard');if(!current(scope)||ticket!==generation)return;
  if(!result?.tasks?.counts||!Array.isArray(result.tasks.items)||!result.receivables||!result.notices?.newPurchases||!result.notices.newSupplierQuotes)throw Error('工作台响应尚未核实，请重新读取。');data.value=result;
 }catch(e){if(!current(scope)||ticket!==generation)return;error.value=e instanceof Error?e.message:'工作台读取失败，请重试。';emit('failure',e);}
 finally{if(!disposed&&ticket===generation){loading.value=false;emitBusy();}}
}
function openOrder(id?:string){if(!busy.value&&!props.locked)emit('openOrder',id);}
async function acknowledge(){
 if(busy.value||props.locked)return;const events=pendingAck.value||shownEvents.value;if(!events.length)return;
 const scope=identity();pendingAck.value=events.map(e=>({...e}));acknowledging.value=true;ackError.value='';emitBusy();
 try{const receipt=await request<DashboardNoticeReceipt>('/sales/dashboard/notices/ack','POST',{events:pendingAck.value});if(!current(scope))return;
  if(JSON.stringify(receipt?.acknowledged)!==JSON.stringify(events))throw Error('已读回执无法核实');pendingAck.value=null;await refresh();
 }catch(e){if(!current(scope))return;const failure=(e||{}) as {status?:number;code?:string;unknown?:boolean},status=failure.status,code=typeof failure.code==='string'?failure.code:'';const outcomeUnknown=failure.unknown===true||code.endsWith('_UNKNOWN')||code.includes('TIMEOUT')||['NETWORK_ERROR','BUSY_RETRY_REQUIRED'].includes(code);if(typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<500&&status!==408&&!outcomeUnknown){pendingAck.value=null;ackError.value='提示或权限已变化，请重新读取核对。';if(status===401)emit('failure',e);}else ackError.value='标记结果未确认，角标尚未改动；可按原事件重试，或重新读取核实。';}
 finally{if(current(scope)){acknowledging.value=false;emitBusy();}}
}
onMounted(refresh);watch(identity,()=>{generation++;data.value=null;error.value='';pendingAck.value=null;ackError.value='';loading.value=false;acknowledging.value=false;emitBusy();},{flush:'sync'});
onBeforeUnmount(()=>{disposed=true;generation++;emit('busyChanged',false);});
defineExpose({refresh,canLeave:()=>!busy.value});
</script>
<template>
 <view class="sales-dashboard" :aria-busy="busy">
  <view class="heading"><view><text>工作台</text><view class="muted">我负责的订单<text v-if="data"> · 北京时间 {{ data.businessDate }}</text></view></view><view class="dashboard-actions"><button :disabled="busy||locked" @click="refresh">刷新</button><button class="primary" :disabled="busy||locked" @click="emit('createPurchase')">＋ 新建采购单</button></view></view>
  <view v-if="loading" class="loading" role="status">正在读取报价待办与回款余额…</view>
  <view v-else-if="error" class="error" role="alert">{{ error }}<button :disabled="busy||locked" @click="refresh">重试</button></view>
  <template v-else-if="data">
   <view class="dashboard-notices" aria-label="站内新提示"><view class="dashboard-section-heading"><text>站内提示 <text class="notice-badge">{{ data.notices.unreadTotal }}</text></text><button :disabled="busy||locked||!pendingAck&&!shownEvents.length" @click="acknowledge">{{acknowledging?'正在标记…':pendingAck?'重试已读标记':'将当前展示提示标记已读'}}</button></view>
    <view v-if="ackError" class="error" role="alert">{{ackError}}</view><view class="dashboard-notice-columns">
     <view><text>新采购单 <text class="notice-badge">{{data.notices.newPurchases.total}}</text></text><view class="dashboard-meta">未读全量 · 展示前 {{data.notices.newPurchases.limit}} 条，点开订单不会自动标记已读。</view><view v-if="!data.notices.newPurchases.total" class="muted">暂无新采购单提示。</view><view v-for="item in data.notices.newPurchases.items" :key="item.eventId" class="dashboard-notice-row"><text>{{item.hospitalName}} · {{item.orderNo}}</text><button class="text-button" :disabled="busy||locked" @click="openOrder(item.orderId)">查看新采购单 →</button></view></view>
     <view><text>新厂家报价 <text class="notice-badge">{{data.notices.newSupplierQuotes.total}}</text></text><view class="dashboard-meta">未读全量 · 展示前 {{data.notices.newSupplierQuotes.limit}} 条，仅含当前修订有效报价。</view><view v-if="!data.notices.newSupplierQuotes.total" class="muted">暂无新厂家报价提示。</view><view v-for="item in data.notices.newSupplierQuotes.items" :key="item.eventId" class="dashboard-notice-row"><text>{{item.hospitalName}} · {{item.manufacturerName}} · {{item.orderNo}}</text><button class="text-button" :disabled="busy||locked" @click="openOrder(item.orderId)">查看厂家报价 →</button></view></view>
    </view>
   </view>
   <view class="dashboard-summary" aria-label="报价处理阶段"><view v-for="s in stages" :key="s.key"><text>{{ s.label }}</text><text>{{ data.tasks.counts[s.key] }}</text></view></view>
   <view class="dashboard-columns">
    <view class="dashboard-tasks" aria-labelledby="quote-tasks-title"><view class="dashboard-section-heading"><text id="quote-tasks-title">报价待办</text><button class="text-button" :disabled="busy||locked" @click="openOrder()">全部订单 →</button></view><view class="muted dashboard-list-note">共 {{ data.tasks.total }} 单 · 按处理阶段优先、实际接收日期先后展示前 {{ data.tasks.limit }} 单</view>
     <view v-if="!data.tasks.total" class="empty">暂无待处理报价订单。</view>
     <view v-for="task in data.tasks.items" :key="task.orderId" class="dashboard-task"><view class="dashboard-row"><text>{{ task.hospitalName }}</text><text class="dashboard-stage">{{ stage(task.stage).label }}</text></view><view class="dashboard-meta">{{ task.orderNo }} · R{{ task.revisionNo }} · {{ task.receivedDate }} 接收</view><view class="dashboard-row"><text class="muted">{{ task.lineCount }} 味药<text v-if="task.stage==='ready'"> · {{ task.validSupplierCount }} 家有效厂家<text v-if="task.validSupplierCount===1">，需确认提前计价</text></text></text><button class="text-button" :disabled="busy||locked" @click="openOrder(task.orderId)">{{ stage(task.stage).action }} →</button></view></view>
    </view>
    <view class="dashboard-receivables" aria-labelledby="receivable-title"><view class="dashboard-section-heading"><text id="receivable-title">回款跟进</text><button class="text-button" :disabled="busy||locked" @click="emit('openReceivables')">回款台账 →</button></view><view class="muted">未收余额 · {{ data.receivables.outstandingCount }} 单</view><view class="dashboard-balance">¥{{ money(data.receivables.outstandingBalance) }}</view><view class="dashboard-meta">含未到期；暂停催收 {{ data.receivables.pausedCount }} 单，¥{{ money(data.receivables.pausedBalance) }}</view>
     <view class="dashboard-due-summary"><view><text>今日到期 · {{ data.receivables.dueCount }} 单</text><text>¥{{ money(data.receivables.dueBalance) }}</text></view><view class="dashboard-overdue"><text>逾期 · {{ data.receivables.overdueCount }} 单</text><text>¥{{ money(data.receivables.overdueBalance) }}</text></view></view><view class="dashboard-meta">今日到期、逾期金额均不含暂停催收。</view>
     <view class="muted dashboard-list-note">到期及逾期共 {{ data.receivables.followUpCount }} 单 · 展示前 {{ data.receivables.limit }} 单</view><view v-if="!data.receivables.followUpCount" class="empty">暂无到期或逾期未收订单。</view>
     <view v-for="item in data.receivables.items" :key="item.receivableId" class="dashboard-due-row"><view class="dashboard-row"><text>{{ item.hospitalName }}</text><text>¥{{ money(item.balance) }}</text></view><view class="dashboard-meta">{{ item.orderNo }} · 到期 {{ item.dueDate }}</view><view class="dashboard-meta">应收 ¥{{ money(item.amount) }} · 已收 ¥{{ money(item.paid) }}</view><view class="dashboard-row"><text :class="{'dashboard-overdue':item.overdueDays>0&&!item.paused}">{{ item.paused?'暂停催收 · 不催收':item.overdueDays>0?'逾期 '+item.overdueDays+' 天':'今日到期' }}</text><button class="text-button" :disabled="busy||locked" @click="emit('openFinance',{orderId:item.orderId,receivableId:item.receivableId})">{{ item.paused?'处理异常':'账期 / 异常' }} →</button></view></view>
     <button class="text-button dashboard-all-receivables" :disabled="busy||locked" @click="emit('openReceivables')">查看全部回款台账 →</button>
    </view>
   </view><view class="footnote">数据截至北京时间 {{ time(data.asOf) }} · 报价完成后的未收款继续纳入回款跟进。</view>
  </template>
 </view>
</template>
<style scoped>
.sales-dashboard{padding:18px 0 24px;border-bottom:1px solid #dce5df}.heading>view:first-child>text:first-child{display:block;font-size:26px;font-weight:600}.muted,.dashboard-meta,.dashboard-list-note,.footnote{font-size:12px;color:#74837a;line-height:1.7}.dashboard-actions,.dashboard-row,.dashboard-section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.dashboard-actions{margin:14px 0}.dashboard-actions button{flex:1}.dashboard-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 12px;border-top:1px solid #dce5df;border-bottom:1px solid #dce5df;padding:20px 0;margin:20px 0}.dashboard-summary>view>text{display:block;font-size:11px;color:#74837a}.dashboard-summary>view>text:last-child{font-size:25px;color:#243129;font-variant-numeric:tabular-nums}.dashboard-notices{border-top:1px solid #dce5df;padding-top:16px;margin-top:16px}.dashboard-notice-columns>view{padding-top:14px}.dashboard-section-heading>text{font-size:17px;font-weight:600}.notice-badge{display:inline-block;min-width:18px;padding:2px 6px;border-radius:12px;background:#eaf2ed;color:#215f46;text-align:center;font-size:12px}.dashboard-notice-row,.dashboard-task,.dashboard-due-row{padding:14px 0;border-bottom:1px solid #e2e9e4;font-size:13px}.dashboard-notice-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.dashboard-notice-row>text{flex:1;min-width:140px}.dashboard-stage{background:#eaf2ed;color:#215f46;padding:3px 6px;font-size:11px}.dashboard-meta{margin:6px 0}.dashboard-receivables{padding-top:24px;margin-top:16px}.dashboard-balance{font-size:28px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;margin:4px 0}.dashboard-due-summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 0;border-bottom:1px solid #e2e9e4}.dashboard-due-summary text{display:block;font-size:12px}.dashboard-due-summary text:last-child{font-size:17px;margin-top:6px}.dashboard-overdue{color:#a34c3e}.footnote{padding-top:18px}.text-button{background:transparent;color:#216349;font-size:12px;padding:7px 3px}.primary{background:#216349;color:white}.error{background:#fbf3ef;color:#a04435;padding:12px;white-space:pre-wrap}.empty,.loading{font-size:13px;color:#74837a;padding:20px 0}button{min-height:40px;line-height:22px;margin:0;font-size:12px;border-radius:5px}button[disabled]{opacity:.45}
</style>
