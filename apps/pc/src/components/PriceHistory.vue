<script setup lang="ts">
import {computed,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {beijingTime,createHistoryState,HistoryController,historyMatchLabel} from '@quote/archive-client';
import type {PcApi} from '../api';
import type {PriceReference} from '@quote/contracts';
import Decimal from 'decimal.js';
import {validPositive} from '../../../mini/src/domain';
const props=defineProps<{api:Pick<PcApi,'get'>;hospitalId:string;orderId:string;name:string;spec:string;itemId?:string|null;itemVariantId?:string|null;finalPrice?:string|null;locked?:boolean}>();
const emit=defineEmits<{(e:'busy-changed',value:boolean):void;(e:'failure',value:unknown):void}>();
const state=reactive(createHistoryState()),opened=ref(false);
const controller=new HistoryController(path=>props.api.get(path),state,e=>emit('failure',e));
watch(()=>[props.api,props.hospitalId,props.orderId,props.name,props.spec,props.itemId,props.itemVariantId],()=>{opened.value=false;controller.setContext(props.hospitalId&&props.orderId&&props.name?{hospitalId:props.hospitalId,orderId:props.orderId,name:props.name,spec:props.spec,itemId:props.itemId||null,itemVariantId:props.itemVariantId||null}:null);},{immediate:true,flush:'sync'});
watch(()=>state.loading,v=>emit('busy-changed',v),{flush:'sync',immediate:true});
const locked=computed(()=>props.locked||state.loading);
function signed(value:Decimal){const rounded=value.toDecimalPlaces(2,Decimal.ROUND_HALF_UP);return (rounded.isPositive()&&!rounded.isZero()?'+':'')+rounded.toFixed(2);}
function comparison(line:PriceReference['lines'][number]){
 const reason=line.unitDifference||line.unit!=='kg'?'单位不同，无法比较':line.status==='missing'?'历史缺货，无法比较':line.unitPrice===null?'历史价格未知，无法比较':!validPositive(line.unitPrice)?'历史价格无效，无法比较':!props.finalPrice?'本次最终价未填写，无法比较':!validPositive(props.finalPrice)?'本次最终价无效，无法比较':'';
 if(reason)return {difference:reason,rate:reason};
 const difference=new Decimal(props.finalPrice!).minus(line.unitPrice!);
 return {difference:signed(difference),rate:signed(difference.div(line.unitPrice!).times(100))+'%'};
}
const references=computed(()=>state.history?.items.map(item=>({...item,lines:item.lines.map(line=>({...line,...comparison(line)}))}))||[]);
async function load(){if(locked.value||!state.context)return;opened.value=true;await controller.load();}
onBeforeUnmount(()=>{controller.dispose();emit('busy-changed',false);});
</script>
<template>
 <section class="history-reference detail-panel" aria-label="同院历史参考">
  <div class="history-heading"><div><h2>同院历史参考 · {{name}} / {{spec||'未提供规格'}}</h2><p class="muted">同医院 · {{itemId||itemVariantId?'商品身份优先匹配，降级记录标示规格或单位差异。':'同品名及规格、kg 的文本匹配参考。'}}每张采购单仅取一个代表版本：已确认优先，否则最近已发送，最多 3 单。</p></div><button :disabled="locked||!state.context" @click="load">{{state.loading?'正在读取…':opened?'重新读取':'查看最近 3 单'}}</button></div>
  <template v-if="opened">
   <p v-if="state.loading" role="status">正在读取同院历史…</p><p v-if="state.error" class="error" role="alert">读取失败：{{state.error}}；可重新读取。</p>
   <template v-if="state.history"><p v-if="!state.history.items.length" class="muted">暂无匹配的已发送或已确认历史订单。</p>
    <article v-for="item in references" :key="item.versionId" class="reference">
     <h3>{{item.quoteNo}} · R{{item.revisionNo}} / V{{item.versionNo}}<small>{{historyMatchLabel(item.match)}}</small></h3><p class="muted">{{item.orderNo}} · 报价日期 {{item.quoteDate}} · {{item.confirmedAt?'已确认 · '+beijingTime(item.confirmedAt):'已发送 · '+beijingTime(item.sentAt)}}</p>
     <div class="table-scroll"><table><thead><tr><th>品名 / 规格</th><th>历史数量 / 单位</th><th>历史单价 / 单位</th><th>与本次差额 元/kg（本次−历史）</th><th>差异比例（相对历史）</th></tr></thead><tbody><tr v-for="line in item.lines" :key="line.purchaseLineId"><td>{{line.name}}<small>{{line.spec||'未提供规格'}}</small><small v-if="line.specDifference" class="warning">规格差异：本次 {{spec||'未提供规格'}}；历史 {{line.spec||'未提供规格'}}</small><small v-if="line.unitDifference" class="warning">单位差异：本次 kg；历史 {{line.unit||'未记录单位'}}</small></td><td>{{line.quantity}} {{line.unit||'未记录单位'}}</td><td>{{line.status==='missing'?'缺货':line.unitPrice===null?'价格未知':line.unitPrice+' 元/'+(line.unit||'未知单位')}}</td><td>{{line.difference}}</td><td>{{line.rate}}</td></tr></tbody></table></div>
    </article>
   </template>
  </template>
  <p class="muted">只读参考，同名同行全部保留；不会改写当前基准、推荐价或最终价。当前计价仍以本次有效厂家报价为基准。</p>
 </section>
</template>
<style scoped>
.history-reference{margin:20px 0;min-width:0}.history-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.history-heading h2{margin-top:0}.history-heading button{flex-shrink:0}.reference{border-top:1px solid #dfe7e1;padding-top:16px;margin-top:16px}.reference h3{font-size:15px;margin:0;overflow-wrap:anywhere}.reference .muted{line-height:1.7}.history-reference>p:last-child{margin-bottom:0;line-height:1.7}
</style>
