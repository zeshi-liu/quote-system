<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,reactive,ref,watch} from 'vue';
import type {ArchiveFilters,ArchiveOrder} from '@quote/contracts';
import {ArchiveController,archiveFilterForm,isFiltersDirty,restoreAppliedFilters,archivePanels,archiveTabs,archiveGroups,beijingTime,canProcessOrder,confirmationAmount,createArchiveState,orderStatus,orderStatuses,paymentFilters,receivableLabel,type ArchiveTab} from '@quote/archive-client';
import {PcApi,PcApiFailure,fetchDownload} from './api';
const state=reactive(createArchiveState()),tab=ref<ArchiveTab>('source'),loginName=ref(''),password=ref(''),error=ref(''),booting=ref(true),working=ref(false);
let controller:ArchiveController;
const api=reactive(new PcApi(fetch,()=>{controller?.clear();tab.value='source';password.value='';}));
controller=new ArchiveController(path=>api.get(path),state);
const blank=()=>archiveFilterForm();
const filters=reactive(blank());
const filtersDirty=computed(()=>isFiltersDirty(filters,state.applied));
const busy=computed(()=>booting.value||working.value||state.listLoading||state.detailLoading||state.hospitalsLoading);
const pages=computed(()=>state.page?Math.max(1,Math.ceil(state.page.total/state.page.pageSize)):1);
const activeGroup=computed(()=>archiveGroups.find(g=>g.sections.includes(tab.value))!);
const panels=computed(()=>state.detail?archivePanels(state.detail)[tab.value]:[]);
const files=computed(()=>state.detail?.quotes.flatMap(q=>q.files.map(f=>({...f,version:q.quoteNo+' · R'+q.revisionNo+' / V'+q.versionNo})))||[]);
watch(()=>state.selectedId,()=>{tab.value='source';});
function applied(){return {...filters} as ArchiveFilters;}
async function query(){if(busy.value)return;error.value='';await controller.query(applied());}
async function reset(){if(busy.value)return;Object.assign(filters,blank());await query();}
async function back(){if(busy.value)return;restoreAppliedFilters(filters,state.applied);await controller.back();}
async function move(page:number){if(busy.value)return;restoreAppliedFilters(filters,state.applied);await controller.move(page);}
async function run(work:()=>Promise<void>){if(busy.value)return;working.value=true;error.value='';try{await work();}catch(e){error.value=e instanceof Error?e.message:'操作未完成，请重试。';}finally{working.value=false;}}
async function initialize(){await Promise.all([controller.hospitals(),controller.query(applied())]);}
async function login(){await run(async()=>{await api.login(loginName.value,password.value);password.value='';Object.assign(filters,blank());await initialize();});}
async function logout(){await run(()=>api.logout());}
async function download(file:{id:string;filename:string}){await run(async()=>{const ticket=await api.post<{url:string;expiresAt:string}>('/files/'+encodeURIComponent(file.id)+'/download-url',{});const url=new URL(ticket.url,window.location.origin);if(!['http:','https:'].includes(url.protocol))throw new Error('下载地址无效，请重试。');const objectUrl=URL.createObjectURL(await fetchDownload(url.href)),link=document.createElement('a');link.href=objectUrl;link.download=file.filename;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);});}
function access(order:ArchiveOrder){return canProcessOrder(order)?'订单负责销售（本页只读）':order.writable?'只读（'+orderStatus(order.status)+'）':'其他负责人 · 只读';}
onMounted(async()=>{try{await api.restore();await initialize();}catch(e){if(!(e instanceof PcApiFailure&&e.status===401))error.value=e instanceof Error?e.message:'无法核实登录状态，请重新加载。';}finally{booting.value=false;}});
onBeforeUnmount(()=>controller.dispose());
</script>
<template>
 <div class="pc-app">
  <header class="masthead"><a class="brand" href="./">饮片报价<span>历史订单</span></a><div v-if="api.user" class="identity"><span>{{api.user.name}} · {{api.user.role==='admin'?'管理员':'销售员'}}</span><button :disabled="busy" @click="logout">退出登录</button></div></header>
  <main v-if="!api.user" class="login">
   <p class="eyebrow">内部业务档案</p><h1>登录</h1><p class="muted">使用内部账号查阅采购、报价与应收记录。</p>
   <p v-if="booting" role="status">正在核实登录状态…</p>
   <form v-else @submit.prevent="login"><label>内部账号<input v-model="loginName" autocomplete="username" :disabled="busy" required /></label><label>密码<input v-model="password" type="password" autocomplete="current-password" :disabled="busy" required /></label><button class="primary" :disabled="busy||!loginName||!password">{{working?'正在登录…':'登录'}}</button></form>
   <p v-if="error" class="error" role="alert">{{error}}</p>
  </main>
  <main v-else class="workspace">
   <p class="breadcrumb">{{api.user.role==='admin'?'管理员':'销售'}} / 历史订单<span>北京时间</span></p>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <template v-if="state.mode==='list'">
    <div class="heading"><div><p class="eyebrow">订单档案</p><h1>历史订单</h1><p class="muted">按采购单查找所有修订、报价版本和留痕。</p></div><span class="scope">{{api.user.role==='admin'?'全量业务 · 只读':'本人订单与当前负责医院历史 · 本页只读'}}</span></div>
    <form class="filters" @submit.prevent="query">
     <label>医院<select v-model="filters.hospitalId" :disabled="busy"><option value="">全部可查看医院</option><option v-for="h in state.hospitals" :key="h.id" :value="h.id">{{h.name}}</option></select></label>
     <label>实际接收日期（起）<input type="date" v-model="filters.receivedFrom" :disabled="busy" /></label><label>实际接收日期（止）<input type="date" v-model="filters.receivedTo" :disabled="busy" /></label>
     <label class="keyword">单号、报价号、药品或规格<input type="search" v-model="filters.keyword" maxlength="100" placeholder="包含所有采购修订" :disabled="busy" /></label>
     <label>业务状态<select v-model="filters.status" :disabled="busy"><option value="">全部状态</option><option v-for="s in orderStatuses" :key="s[0]" :value="s[0]">{{s[1]}}</option></select></label>
     <label>查看范围<select v-model="filters.ownership" :disabled="busy"><option value="">全部可查看</option><option value="mine">我负责的订单</option><option value="readonly">其他负责人（只读）</option></select></label>
     <label>回款情况<select v-model="filters.payment" :disabled="busy"><option v-for="p in paymentFilters" :key="p[0]" :value="p[0]">{{p[1]}}</option></select></label>
     <div class="filter-actions"><button type="submit" class="primary" :disabled="busy">{{state.listLoading?'正在查询…':'查询'}}</button><button type="button" :disabled="busy" @click="reset">清空筛选</button></div>
    </form>
    <p v-if="filtersDirty" class="filter-note" role="status">筛选已修改，点击查询后生效；当前结果仍按已查询条件显示。</p>
    <p v-if="state.hospitalsError" class="error" role="alert">医院筛选读取失败：{{state.hospitalsError}} <button :disabled="busy" @click="controller.hospitals()">重试</button></p>
    <p v-if="state.listError" class="error" role="alert">查询失败：{{state.listError}} <button :disabled="busy" @click="back">重新查询</button></p>
    <p v-if="state.listLoading" class="loading" role="status">正在读取订单档案…</p>
    <template v-if="state.page&&!state.listLoading">
     <div class="result-head"><strong>共 {{state.page.total}} 张采购单</strong><span>实际接收日期、单号倒序 · {{beijingTime(state.page.asOf)}}</span></div>
     <div class="table-scroll"><table class="orders"><thead><tr><th>医院 / 采购单</th><th>实际接收 / 状态</th><th>最终确认金额</th><th>系统应收 / 未收（元）</th><th>到期 / 回款情况</th><th>当前 / 原订单负责人</th><th>查阅</th></tr></thead><tbody><tr v-for="item in state.page.items" :key="item.id"><td><strong>{{item.hospitalName}}</strong><small>{{item.orderNo}} · R{{item.revisionNo}}</small><small v-if="item.matchedRevisions.length">命中采购修订 {{item.matchedRevisions.map(n=>'R'+n).join('、')}}</small></td><td>{{item.receivedDate}}<small>{{orderStatus(item.status)}} · 销售代录</small></td><td>{{confirmationAmount(item)}}</td><td>{{item.receivable?item.receivable.amount+' / '+item.receivable.balance:'—'}}</td><td>{{item.receivable?.dueDate||'—'}}<small>{{receivableLabel(item)}}</small></td><td>{{item.owner.name}} / {{item.originalOwner.name}}<small>{{access(item)}}</small></td><td><button class="text-button" :disabled="busy" @click="controller.open(item.id)">查看详情 →</button></td></tr><tr v-if="!state.page.items.length"><td colspan="7" class="empty">没有符合当前筛选的订单。</td></tr></tbody></table></div>
     <div class="pagination"><label>每页<select v-model.number="filters.pageSize" :disabled="busy" @change="query"><option :value="20">20 条</option><option :value="50">50 条</option></select></label><span>第 {{state.page.page}} / {{pages}} 页</span><button :disabled="busy||state.page.page<=1" @click="move(state.page!.page-1)">上一页</button><button :disabled="busy||state.page.page>=pages" @click="move(state.page!.page+1)">下一页</button></div>
    </template>
    <p class="footnote">档案包含未完成及已作废记录；订单数不作为需求统计。历史档案不限最近三次报价。</p>
   </template>
   <template v-else>
    <button :disabled="busy" @click="back">← 返回原筛选列表</button><p v-if="state.detailLoading" class="loading" role="status">正在读取档案详情…</p><p v-if="state.detailError" class="error" role="alert">详情读取失败：{{state.detailError}} <button :disabled="busy" @click="controller.open(state.selectedId)">重新读取</button></p>
    <template v-if="state.detail"><div class="heading detail-heading"><div><p class="eyebrow">{{state.detail.order.hospitalName}}</p><h1>{{state.detail.order.orderNo}}</h1><p class="muted">{{orderStatus(state.detail.order.status)}} · 实际接收 {{state.detail.order.receivedDate}} · 销售代录</p></div><span class="scope">本页只读</span></div><div class="facts order-facts"><div><span>当前订单负责人</span><strong>{{state.detail.order.owner.name}}</strong></div><div><span>原订单负责人</span><strong>{{state.detail.order.originalOwner.name}}</strong></div><div><span>最终确认金额</span><strong>{{confirmationAmount(state.detail.order)}}</strong></div><div><span>应收情况</span><strong>{{receivableLabel(state.detail.order)}}</strong></div></div>
     <nav class="detail-tabs" aria-label="档案详情分栏"><button v-for="group in archiveGroups" :key="group.label" :class="{selected:activeGroup===group}" :disabled="busy" @click="tab=group.sections[0]">{{group.label}}</button></nav><nav v-if="activeGroup.sections.length>1" class="section-tabs" aria-label="详情内容"><button v-for="section in activeGroup.sections" :key="section" :class="{selected:tab===section}" :disabled="busy" @click="tab=section">{{archiveTabs.find(t=>t[0]===section)?.[1]}}</button></nav>
     <section v-for="(panel,index) in panels" :key="tab+'-'+index" class="detail-panel"><h2>{{panel.title}}</h2><p v-if="panel.note" class="muted panel-note">{{panel.note}}</p><dl v-if="panel.facts" class="panel-facts"><div v-for="fact in panel.facts" :key="fact[0]"><dt>{{fact[0]}}</dt><dd>{{fact[1]}}</dd></div></dl><div class="table-scroll" v-if="panel.columns&&panel.rows?.length"><table><thead><tr><th v-for="column in panel.columns" :key="column">{{column}}</th></tr></thead><tbody><tr v-for="(row,i) in panel.rows" :key="i"><td v-for="(cell,j) in row" :key="j">{{cell}}</td></tr></tbody></table></div><details v-if="panel.references?.length" class="references"><summary>引用信息</summary><dl class="panel-facts"><div v-for="(reference,j) in panel.references" :key="j"><dt>{{reference[0]}}</dt><dd>{{reference[1]}}</dd></div></dl></details></section>
     <section v-if="tab==='files'&&files.length" class="detail-panel"><h2>下载已生成文件</h2><div v-for="file in files" :key="file.id" class="file-row"><div><strong>{{file.filename}}</strong><small>{{file.version}} · {{beijingTime(file.createdAt)}}</small></div><button :disabled="busy" @click="download(file)">{{working?'正在准备…':'下载 '+file.format.toUpperCase()}}</button></div></section>
    </template>
   </template>
  </main>
 </div>
</template>
