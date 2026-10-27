<script setup lang="ts">
import {computed,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {beijingTime,createHistoryState,HistoryController} from '@quote/archive-client';
import {request} from '../api';
const props=defineProps<{hospitalId:string;orderId:string;name:string;spec:string;locked:boolean}>();
const emit=defineEmits<{(e:'busy-changed',value:boolean):void;(e:'failure',value:unknown):void}>();
const state=reactive(createHistoryState()),opened=ref(false);
const controller=new HistoryController(request,state,e=>emit('failure',e));
watch(()=>[props.hospitalId,props.orderId,props.name,props.spec],()=>{opened.value=false;controller.setContext(props.hospitalId&&props.orderId&&props.name?{hospitalId:props.hospitalId,orderId:props.orderId,name:props.name,spec:props.spec}:null);},{immediate:true});
watch(()=>state.loading,v=>emit('busy-changed',v),{flush:'sync',immediate:true});
const locked=computed(()=>props.locked||state.loading);
async function load(){if(locked.value||!state.context)return;opened.value=true;await controller.load();}
onBeforeUnmount(()=>{controller.dispose();emit('busy-changed',false);});
</script>
<template>
 <view class="history-reference"><view class="heading"><text>同院历史参考</text><button :disabled="locked||!state.context" @click="load">{{state.loading?'正在读取…':opened?'重新读取':'查看最近 3 单'}}</button></view><text class="scope">文本匹配参考 · 同医院、同品名及规格、kg；只读查阅。</text>
  <template v-if="opened"><text v-if="state.loading" class="message">正在读取同院历史…</text><text v-if="state.error" class="error">读取失败：{{state.error}}；可重新读取。</text><template v-if="state.history"><text v-if="!state.history.items.length" class="message">暂无匹配的已发送或已确认历史订单。</text><view v-for="item in state.history.items" :key="item.versionId" class="reference"><text class="quote">{{item.quoteNo}} · R{{item.revisionNo}} / V{{item.versionNo}}</text><text class="small">{{item.orderNo}} · 报价日期 {{item.quoteDate}}</text><text class="small">{{item.confirmedAt?'已确认 · '+beijingTime(item.confirmedAt):'已发送 · '+beijingTime(item.sentAt)}}</text><scroll-view scroll-x class="history-scroll"><view class="history-table"><view class="table-row table-head"><text>品名 / 规格</text><text>历史数量 kg</text><text>历史单价 元/kg</text></view><view v-for="line in item.lines" :key="line.purchaseLineId" class="table-row"><text>{{line.name}} / {{line.spec||'未提供规格'}}</text><text>{{line.quantity}}</text><text>{{line.status==='missing'?'缺货':line.unitPrice===null?'价格未知':line.unitPrice}}</text></view></view></scroll-view></view></template><text class="scope bottom">每个历史订单只展示服务器选定的一个代表版本；同名同行全部保留。参考不会改写当前基准、推荐价或最终价。</text></template>
 </view>
</template>
<style scoped>
.history-reference{padding:20px 0;margin:14px 0;border-top:1px solid #dfe7e1;border-bottom:1px solid #dfe7e1;min-width:0;overflow:hidden}.heading{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px;font-weight:550}.heading button{margin:0;background:transparent;color:#215f46;font-size:11px;padding:7px 0;line-height:24px;border:0;min-height:38px;flex-shrink:0}.heading button:after{border:0}.heading button[disabled]{opacity:.45}.scope{display:block;font-size:10px;color:#7d8b80;line-height:1.7}.message,.error{display:block;font-size:12px;line-height:1.7;padding:16px 0}.error{color:#9b3e32}.reference{padding:17px 0;border-top:1px solid #e6ece7;margin-top:15px}.quote{display:block;font-size:12px;font-weight:550;overflow-wrap:anywhere}.small{display:block;font-size:10px;color:#7d8b80;line-height:1.8;margin-top:3px}.history-scroll{width:100%;max-width:100%;margin-top:12px;overflow:hidden}.history-table{width:460px;font-size:11px}.table-row{display:grid;grid-template-columns:1.4fr 1fr 1fr;border-bottom:1px solid #e0e8e2;line-height:1.7}.table-row>text{padding:10px 8px;overflow-wrap:anywhere}.table-head{background:#f3f6f3;color:#74887a;font-size:10px}.bottom{margin-top:12px}
</style>
