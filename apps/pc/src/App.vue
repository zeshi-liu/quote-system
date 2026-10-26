<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,reactive,ref,watch,nextTick} from 'vue';
import type {ArchiveFilters,ArchiveOrder} from '@quote/contracts';
import {ArchiveController,archiveFilterForm,isFiltersDirty,restoreAppliedFilters,archivePanels,archiveTabs,archiveGroups,beijingTime,canProcessOrder,confirmationAmount,createArchiveState,orderStatus,orderStatuses,paymentFilters,receivableLabel,type ArchiveTab} from '@quote/archive-client';
import {PcApi,PcApiFailure,fetchDownload} from './api';
import Receivables from './components/Receivables.vue';
import SalesWorkbench from './components/SalesWorkbench.vue';
import SalesDashboard from './components/SalesDashboard.vue';
import FinanceWorkspace from './components/FinanceWorkspace.vue';
import AdminWorkspace from './components/AdminWorkspace.vue';
import CatalogPanel from './components/CatalogPanel.vue';
import HistoricalOrders from './components/HistoricalOrders.vue';
import HospitalAnalytics from './components/HospitalAnalytics.vue';
import SourceFiles from './components/SourceFiles.vue';
import {readSourcePending,sourceOperationTarget,type SourceReference} from '../../../packages/source-client/src';
import type {FinanceTarget} from '../../../packages/finance-client/src';
const view=ref<'archive'|'receivables'|'workbench'|'finance'|'history'|'analytics'|'admin'|'catalog'|'sourceRecovery'|'home'>('archive'),receivablesBusy=ref(false),receivablesDirty=ref(false),businessBusy=ref(false),financeBusy=ref(false),auxiliaryBusy=ref(false),sourceRecovery=ref<SourceReference|null>(null),historyInitial=ref<string>(),financeTarget=ref<FinanceTarget|null>(null);
const dashboardRef=ref<InstanceType<typeof SalesDashboard>|null>(null),workbenchRef=ref<InstanceType<typeof SalesWorkbench>|null>(null);
const viewLabels={archive:'历史订单',receivables:'回款台账',workbench:'报价工作台',finance:'账期与催收',history:'历史纸单补录',analytics:'医院分析',admin:'资料与账号管理',catalog:'商品与来源参考',sourceRecovery:'原单操作核对',home:'待办工作台'};
const archiveSourceActivity=reactive<Record<string,boolean>>({});
const state=reactive(createArchiveState()),tab=ref<ArchiveTab>('source'),loginName=ref(''),password=ref(''),error=ref(''),booting=ref(true),working=ref(false);
const setupTicket=ref(''),newPassword=ref(''),loginNotice=ref('');
let controller:ArchiveController;
const api=reactive(new PcApi(fetch,()=>{controller?.clear();tab.value='source';password.value='';view.value='archive';receivablesBusy.value=false;}));
controller=new ArchiveController(path=>api.get(path),state);
const blank=()=>archiveFilterForm();
const filters=reactive(blank());
const filtersDirty=computed(()=>isFiltersDirty(filters,state.applied));
const busy=computed(()=>booting.value||working.value||receivablesBusy.value||receivablesDirty.value||businessBusy.value||financeBusy.value||auxiliaryBusy.value||Object.values(archiveSourceActivity).some(Boolean)||state.listLoading||state.detailLoading||state.hospitalsLoading);
const pages=computed(()=>state.page?Math.max(1,Math.ceil(state.page.total/state.page.pageSize)):1);
const activeGroup=computed(()=>archiveGroups.find(g=>g.sections.includes(tab.value))!);
const panels=computed(()=>state.detail?archivePanels(state.detail)[tab.value]:[]);
const files=computed(()=>state.detail?.quotes.flatMap(q=>q.files.map(f=>({...f,version:q.quoteNo+' · R'+q.revisionNo+' / V'+q.versionNo})))||[]);
watch(()=>state.selectedId,()=>{tab.value='source';});
function applied(){return {...filters} as ArchiveFilters;}
async function openWorkbench(id?:string,create=false){if(busy.value)return;view.value='workbench';await nextTick();await workbenchRef.value?.openFromHome(id,create);}
async function openDashboardOrder(id?:string){if(id)return openWorkbench(id);if(busy.value)return;view.value='archive';Object.assign(filters,blank());await controller.query(applied());}
async function showArchive(){if(busy.value)return;view.value='archive';if(state.mode==='detail'&&state.selectedId)await controller.open(state.selectedId);else await controller.back();}
function showFinance(target:FinanceTarget|null=null){if(busy.value)return;financeTarget.value=target;view.value='finance';}
async function query(){if(busy.value)return;error.value='';await controller.query(applied());}
async function reset(){if(busy.value)return;Object.assign(filters,blank());await query();}
async function back(){if(busy.value)return;restoreAppliedFilters(filters,state.applied);await controller.back();}
async function move(page:number){if(busy.value)return;restoreAppliedFilters(filters,state.applied);await controller.move(page);}
async function run(work:()=>Promise<void>){if(busy.value)return;working.value=true;error.value='';try{await work();}catch(e){error.value=e instanceof Error?e.message:'操作未完成，请重试。';}finally{working.value=false;}}
function failure(value:unknown){error.value=value instanceof Error?value.message:'读取失败，请重试。';if((value as {status?:number})?.status===401){controller.clear();api.user=null;}}
async function openArchiveOrder(id:string){if(busy.value)return;view.value='archive';await controller.open(id);}
async function initialize(){await Promise.all([controller.hospitals(),controller.query(applied())]);const user=api.user;if(!user)return;sourceRecovery.value=sourceOperationTarget(readSourcePending(user.id,localStorage));if(sourceRecovery.value){view.value='sourceRecovery';return;}if(localStorage.getItem('history-quote-pc-business-pending-'+user.id)){view.value='history';return;}if(user.role==='admin'){view.value=localStorage.getItem('admin-quote-pc-business-pending-'+user.id)?'admin':'archive';return;}view.value=localStorage.getItem('finance-quote-pc-business-pending-'+user.id)?'finance':localStorage.getItem('quote-pc-payment-pending-'+user.id)?'receivables':localStorage.getItem('quote-pc-business-pending-'+user.id)?'workbench':'home';}
async function login(){await run(async()=>{try{await api.login(loginName.value,password.value);}catch(e){if(e instanceof PcApiFailure&&e.code==='PASSWORD_SETUP_REQUIRED'){const r=await api.post<{setupTicket:string}>('/auth/password/temporary-login',{loginName:loginName.value,password:password.value});setupTicket.value=r.setupTicket;password.value='';loginNotice.value='临时凭证已核实，请设置本人新密码。';return;}throw e;}password.value='';Object.assign(filters,blank());await initialize();});}
async function completePassword(){await run(async()=>{await api.post('/auth/password/complete-setup',{setupTicket:setupTicket.value,newPassword:newPassword.value});setupTicket.value='';newPassword.value='';loginNotice.value='新密码已保存，请重新登录。';});}
async function logout(){await run(()=>api.logout());}
async function download(file:{id:string;filename:string}){await run(async()=>{const ticket=await api.post<{url:string;expiresAt:string}>('/files/'+encodeURIComponent(file.id)+'/download-url',{});const url=new URL(ticket.url,window.location.origin);if(!['http:','https:'].includes(url.protocol))throw new Error('下载地址无效，请重试。');const objectUrl=URL.createObjectURL(await fetchDownload(url.href)),link=document.createElement('a');link.href=objectUrl;link.download=file.filename;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);});}
function access(order:ArchiveOrder){return canProcessOrder(order)?'订单负责销售（本页只读）':order.writable?'只读（'+orderStatus(order.status)+'）':'其他负责人 · 只读';}
onMounted(async()=>{try{await api.restore();await initialize();}catch(e){if(!(e instanceof PcApiFailure&&e.status===401))error.value=e instanceof Error?e.message:'无法核实登录状态，请重新加载。';}finally{booting.value=false;}});
onBeforeUnmount(()=>controller.dispose());
</script>
<template>
 <div class="pc-app">
  <header class="masthead"><a class="brand" href="./">饮片报价<span>{{viewLabels[view]}}</span></a><div v-if="api.user" class="identity"><span>{{api.user.name}} · {{api.user.role==='admin'?'管理员':'销售员'}}</span><button :disabled="busy" @click="logout">退出登录</button></div></header>
  <main v-if="!api.user" class="login">
   <p class="eyebrow">内部业务档案</p><h1>登录</h1><p class="muted">使用内部账号查阅采购、报价与应收记录。</p>
   <p v-if="booting" role="status">正在核实登录状态…</p>
   <form v-else-if="setupTicket" @submit.prevent="completePassword"><label>本人新密码（15–128 字符）<input v-model="newPassword" type="password" autocomplete="new-password" minlength="15" maxlength="128" :disabled="busy" required /></label><button class="primary" :disabled="busy||newPassword.length<15">设置新密码</button></form>
   <form v-else @submit.prevent="login"><label>内部账号<input v-model="loginName" autocomplete="username" :disabled="busy" required /></label><label>密码<input v-model="password" type="password" autocomplete="current-password" :disabled="busy" required /></label><button class="primary" :disabled="busy||!loginName||!password">{{working?'正在登录…':'登录'}}</button></form>
   <p v-if="loginNotice" role="status">{{loginNotice}}</p>
   <p v-if="error" class="error" role="alert">{{error}}</p>
  </main>
  <main v-else class="workspace">
   <nav class="main-navigation" aria-label="主导航"><button v-if="api.user.role==='salesperson'" :class="{selected:view==='home'}" :disabled="busy" @click="view='home'">待办工作台</button><button v-if="api.user.role==='salesperson'" :class="{selected:view==='workbench'}" :disabled="busy" @click="openWorkbench()">采购与报价</button><button :class="{selected:view==='archive'}" :disabled="busy" @click="showArchive">历史订单</button><button :class="{selected:view==='receivables'}" :disabled="busy" @click="view='receivables'">回款台账</button><button :class="{selected:view==='finance'}" :disabled="busy" @click="showFinance()">账期与催收</button><button :class="{selected:view==='history'}" :disabled="busy" @click="historyInitial=undefined;view='history'">历史纸单补录</button><button :class="{selected:view==='analytics'}" :disabled="busy" @click="view='analytics'">医院分析</button><button :class="{selected:view==='catalog'}" :disabled="busy" @click="view='catalog'">商品与来源参考</button><button v-if="api.user.role==='admin'" :class="{selected:view==='admin'}" :disabled="busy" @click="view='admin'">资料与账号管理</button></nav>
   <p class="breadcrumb">{{api.user.role==='admin'?'管理员':'销售'}} / {{viewLabels[view]}}<span>北京时间</span></p>
   <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="receivablesDirty" class="filter-note" role="status">有未保存回款内容，请先登记或明确放弃当前输入，再切换页面。</p>
   <Receivables v-if="view==='receivables'" :key="api.user.id" :api="api" :user-id="api.user.id" :admin="api.user.role==='admin'" :locked="working||booting" @busy-changed="receivablesBusy=$event" @dirty-changed="receivablesDirty=$event" @manage-finance="showFinance" />
   <SalesDashboard v-if="view==='home'&&api.user.role==='salesperson'" :key="api.user.id" ref="dashboardRef" :api="api" :locked="working||booting" @busy-changed="businessBusy=$event" @failure="error=$event" @open-order="openDashboardOrder" @create-purchase="openWorkbench(undefined,true)" @open-receivables="view='receivables'" @open-finance="showFinance"/>
   <SalesWorkbench ref="workbenchRef" v-if="view==='workbench'&&api.user.role==='salesperson'" :key="api.user.id" :api="api" :user-id="api.user.id" @busy-changed="businessBusy=$event" @manage-finance="showFinance" />
   <FinanceWorkspace v-if="view==='finance'" :key="api.user.id" :api="api" :user-id="api.user.id" :admin="api.user.role==='admin'" :initial-target="financeTarget||undefined" :locked="working||booting" @busy-changed="financeBusy=$event" @failure="error=$event instanceof Error?$event.message:'读取失败'" />
   <HistoricalOrders v-if="view==='history'" :key="api.user.id" :api="api" :user-id="api.user.id" :admin="api.user.role==='admin'" :initial-order-id="historyInitial" :locked="working||booting" @busy-changed="auxiliaryBusy=$event" @failure="failure" @open-finance="showFinance" />
   <HospitalAnalytics v-if="view==='analytics'" :key="api.user.id" :api="api" :admin="api.user.role==='admin'" :locked="working||booting" @busy-changed="auxiliaryBusy=$event" @failure="failure" @open-order="openArchiveOrder" />
   <CatalogPanel v-if="view==='catalog'" :key="api.user.id" :api="api" :user-id="api.user.id" readonly :locked="working||booting" @busy-changed="auxiliaryBusy=$event" @failure="failure" />
   <AdminWorkspace v-if="view==='admin'&&api.user.role==='admin'" :key="api.user.id" :api="api" :user-id="api.user.id" :locked="working||booting" @busy-changed="auxiliaryBusy=$event" @failure="failure" />
   <section v-if="view==='sourceRecovery'&&sourceRecovery" class="detail-panel"><h1>原单操作核对</h1><p>本机保留了上次上传或解析操作。请先核对原操作结果，再继续其他业务。</p><SourceFiles :key="api.user.id" :api="api" :user-id="api.user.id" :reference="sourceRecovery" :locked="working||booting" @busy-changed="auxiliaryBusy=$event" @failure="failure" /></section>
   <template v-if="view==='archive'">
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
     <div class="table-scroll"><table class="orders"><thead><tr><th>医院 / 采购单</th><th>实际接收 / 状态</th><th>最终确认金额</th><th>系统应收 / 未收（元）</th><th>到期 / 回款情况</th><th>当前 / 原订单负责人</th><th>查阅</th></tr></thead><tbody><tr v-for="item in state.page.items" :key="item.id"><td><strong>{{item.hospitalName}}</strong><small>{{item.orderNo}} · R{{item.revisionNo}}</small><small v-if="item.matchedRevisions.length">命中采购修订 {{item.matchedRevisions.map(n=>'R'+n).join('、')}}</small></td><td>{{item.receivedDate}}<small>{{orderStatus(item.status)}} · {{item.source==='historical_backfill'?'历史补录':item.source==='hospital_self'?'医院录入':'销售代录'}}</small></td><td>{{confirmationAmount(item)}}</td><td>{{item.receivable?item.receivable.amount+' / '+item.receivable.balance:'—'}}</td><td>{{item.receivable?.dueDate||'—'}}<small>{{receivableLabel(item)}}</small></td><td>{{item.owner.name}} / {{item.originalOwner.name}}<small>{{access(item)}}</small></td><td><button class="text-button" :disabled="busy" @click="controller.open(item.id)">查看详情 →</button></td></tr><tr v-if="!state.page.items.length"><td colspan="7" class="empty">没有符合当前筛选的订单。</td></tr></tbody></table></div>
     <div class="pagination"><label>每页<select v-model.number="filters.pageSize" :disabled="busy" @change="query"><option :value="20">20 条</option><option :value="50">50 条</option></select></label><span>第 {{state.page.page}} / {{pages}} 页</span><button :disabled="busy||state.page.page<=1" @click="move(state.page!.page-1)">上一页</button><button :disabled="busy||state.page.page>=pages" @click="move(state.page!.page+1)">下一页</button></div>
    </template>
    <p class="footnote">档案包含未完成及已作废记录；订单数不作为需求统计。历史档案不限最近三次报价。</p>
   </template>
   <template v-else>
    <button :disabled="busy" @click="back">← 返回原筛选列表</button><p v-if="state.detailLoading" class="loading" role="status">正在读取档案详情…</p><p v-if="state.detailError" class="error" role="alert">详情读取失败：{{state.detailError}} <button :disabled="busy" @click="controller.open(state.selectedId)">重新读取</button></p>
    <template v-if="state.detail"><div class="heading detail-heading"><div><p class="eyebrow">{{state.detail.order.hospitalName}}</p><h1>{{state.detail.order.orderNo}}</h1><p class="muted">{{orderStatus(state.detail.order.status)}} · 实际接收 {{state.detail.order.receivedDate||'待核实'}} · {{state.detail.order.source==='historical_backfill'?'历史补录':state.detail.order.source==='hospital_self'?'医院录入':'销售代录'}}</p></div><span class="scope">本页只读</span></div><div class="button-row"><button v-if="state.detail.order.entryMode==='historical_backfill'" :disabled="busy" @click="historyInitial=state.detail.order.id;view='history'">补录资料与核实记录</button><button v-else-if="canProcessOrder(state.detail.order)" :disabled="busy" @click="openWorkbench(state.detail.order.id)">继续采购与报价</button></div><div class="facts order-facts"><div><span>当前订单负责人</span><strong>{{state.detail.order.owner.name}}</strong></div><div><span>原订单负责人</span><strong>{{state.detail.order.originalOwner.name}}</strong></div><div><span>最终确认金额</span><strong>{{confirmationAmount(state.detail.order)}}</strong></div><div><span>应收情况</span><strong>{{receivableLabel(state.detail.order)}}</strong></div></div>
     <nav class="detail-tabs" aria-label="档案详情分栏"><button v-for="group in archiveGroups" :key="group.label" :class="{selected:activeGroup===group}" :disabled="busy" @click="tab=group.sections[0]">{{group.label}}</button></nav><nav v-if="activeGroup.sections.length>1" class="section-tabs" aria-label="详情内容"><button v-for="section in activeGroup.sections" :key="section" :class="{selected:tab===section}" :disabled="busy" @click="tab=section">{{archiveTabs.find(t=>t[0]===section)?.[1]}}</button></nav>
     <section v-for="(panel,index) in panels" :key="tab+'-'+index" class="detail-panel"><h2>{{panel.title}}</h2><p v-if="panel.note" class="muted panel-note">{{panel.note}}</p><dl v-if="panel.facts" class="panel-facts"><div v-for="fact in panel.facts" :key="fact[0]"><dt>{{fact[0]}}</dt><dd>{{fact[1]}}</dd></div></dl><div class="table-scroll" v-if="panel.columns&&panel.rows?.length"><table><thead><tr><th v-for="column in panel.columns" :key="column">{{column}}</th></tr></thead><tbody><tr v-for="(row,i) in panel.rows" :key="i"><td v-for="(cell,j) in row" :key="j">{{cell}}</td></tr></tbody></table></div><details v-if="panel.references?.length" class="references"><summary>引用信息</summary><dl class="panel-facts"><div v-for="(reference,j) in panel.references" :key="j"><dt>{{reference[0]}}</dt><dd>{{reference[1]}}</dd></div></dl></details></section>
     <section v-if="tab==='source'" class="detail-panel"><h2>原始采购资料</h2><SourceFiles v-if="state.detail.historical" :api="api" :user-id="api.user.id" :reference="{kind:'historical_order',orderId:state.detail.order.id}" readonly :locked="working||booting" @busy-changed="archiveSourceActivity['history']=$event" @failure="failure"/><template v-else><div v-for="revision in state.detail.revisions" :key="revision.id"><h3>R{{revision.revisionNo}} 原始资料</h3><SourceFiles :api="api" :user-id="api.user.id" :reference="{kind:'purchase_revision',orderId:state.detail.order.id,revisionId:revision.id}" readonly :locked="working||booting" @busy-changed="archiveSourceActivity[revision.id]=$event" @failure="failure"/></div></template></section>
     <section v-if="tab==='files'&&files.length" class="detail-panel"><h2>下载已生成文件</h2><div v-for="file in files" :key="file.id" class="file-row"><div><strong>{{file.filename}}</strong><small>{{file.version}} · {{beijingTime(file.createdAt)}}</small></div><button :disabled="busy" @click="download(file)">{{working?'正在准备…':'下载 '+file.format.toUpperCase()}}</button></div></section>
    </template>
   </template>
   </template>
  </main>
 </div>
</template>
