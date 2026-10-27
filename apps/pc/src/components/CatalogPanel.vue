<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue';
import type {PcApi} from '../api';
import {CatalogReader,type CatalogVariant} from '../../../../packages/master-client/src';
import SourceBatches from './SourceBatches.vue';
const props=defineProps<{api:Pick<PcApi,'get'|'post'|'write'>;userId:string;readonly?:boolean;locked?:boolean;selectable?:boolean}>(),emit=defineEmits<{(e:'busy-changed',v:boolean):void;(e:'failure',v:unknown):void;(e:'choose',value:CatalogVariant):void}>();
const reader=reactive(new CatalogReader(p=>props.api.get(p))),keyword=ref(''),busy=ref(false),error=ref(''),mode=ref<'catalog'|'sources'>('catalog'),sourceVariant=ref<CatalogVariant|null>(null),sources=ref<InstanceType<typeof SourceBatches>|null>(null),childBusy=ref(false);let disposed=false;
const locked=computed(()=>!!props.locked||busy.value||childBusy.value);
watch(()=>busy.value||childBusy.value,v=>emit('busy-changed',v),{immediate:true});
async function refresh(){if(locked.value)return;if(mode.value==='sources')return sources.value?.refresh();busy.value=true;error.value='';try{await reader.search(keyword.value);}catch(e){error.value=(e as Error).message;emit('failure',e);}finally{if(!disposed)busy.value=false;}}
function choose(id:string){if(locked.value||!props.selectable)return;try{emit('choose',reader.choose(id));}catch(e){error.value=(e as Error).message;}}
function viewSources(id:string){if(locked.value)return;try{sourceVariant.value=reader.choose(id);mode.value='sources';}catch(e){error.value=(e as Error).message;}}
function clearSourceVariant(){if(locked.value)return;sourceVariant.value=null;}
function switchMode(v:'catalog'|'sources'){if(locked.value)return;mode.value=v;}
defineExpose({refresh,canLeave:()=>!busy.value&&!childBusy.value&&(sources.value?.canLeave()??true)});
onMounted(()=>void refresh());onBeforeUnmount(()=>{disposed=true;reader.items=[];emit('busy-changed',false);});
</script>
<template>
 <section class="catalog-panel"><div class="heading"><div><p class="eyebrow">统一商品资料</p><h1>商品与来源参考</h1><p class="muted">标准商品与规格不保存本次价格；每次询价继续使用厂家本次提交。</p></div><span class="scope">资料只读查阅</span></div>
 <nav class="section-tabs" aria-label="资料查询"><button :class="{selected:mode==='catalog'}" :disabled="locked" @click="switchMode('catalog')">启用商品 / 规格</button><button :class="{selected:mode==='sources'}" :disabled="locked" @click="switchMode('sources')">厂家历史来源批次</button></nav>
 <template v-if="mode==='catalog'"><form class="catalog-search" @submit.prevent="refresh"><label>品名、别名、规格或产地<input v-model="keyword" maxlength="100" :disabled="locked" placeholder="例如：当归、川归"/></label><button class="primary" :disabled="locked">查询商品</button></form><p v-if="error" class="error" role="alert">{{error}}</p><p v-if="busy" role="status">正在查询商品资料…</p><p class="filter-note">每次最多展示 100 个启用规格；结果达到上限时，请补充关键词缩小范围。未找到合适规格时，可在采购录入中手工填写。</p><div class="table-scroll"><table><thead><tr><th>标准品名 / 别名</th><th>分类</th><th>规格</th><th>产地 / 等级</th><th>包装 / 单位</th><th>来源资料</th><th v-if="selectable">加入采购</th></tr></thead><tbody><tr v-for="row in reader.items" :key="row.variantId"><td><strong>{{row.name}}</strong><small>{{row.aliases.join('、')||'无别名'}}</small></td><td>{{row.category||'—'}}</td><td>{{row.specification||'常用规格'}}</td><td>{{row.origin||'—'}}<small>{{row.grade||'—'}}</small></td><td>{{row.packageDescription||'—'}}<small>{{row.defaultUnit}}</small></td><td><button :disabled="locked" @click="viewSources(row.variantId)">查看来源</button></td><td v-if="selectable"><button :disabled="locked" @click="choose(row.variantId)">选择此规格</button></td></tr><tr v-if="!busy&&!reader.items.length"><td :colspan="selectable?7:6" class="empty">暂无匹配的启用商品规格。</td></tr></tbody></table></div><p class="muted">当前展示 {{reader.items.length}} 个规格{{reader.items.length===100?'（已达查询上限）':''}}。</p></template>
 <template v-else><section v-if="sourceVariant" class="filter-note source-link"><p>当前关联规格：<strong>{{sourceVariant.name}} · {{sourceVariant.specification||'常用规格'}}</strong> · {{sourceVariant.origin||'未填产地'}} / {{sourceVariant.grade||'未填等级'}}。仅查询实际确认行已关联此规格的批次，包含整批作废历史。</p><button :disabled="locked" @click="clearSourceVariant">取消规格关联，查看全部来源批次</button></section><SourceBatches :key="sourceVariant?.variantId||'all'" ref="sources" :api="api" :user-id="userId" :item-variant="sourceVariant||undefined" readonly :locked="!!props.locked" @busy-changed="childBusy=$event" @failure="emit('failure',$event)"/></template>
 </section>
</template>
<style scoped>.catalog-search{display:flex;gap:14px;align-items:end;margin:24px 0}.catalog-search label{flex:1;max-width:620px}.catalog-search button{height:39px}.catalog-panel table{min-width:720px}.catalog-panel strong{font-size:14px}.catalog-panel .error{margin:18px 0}</style>
