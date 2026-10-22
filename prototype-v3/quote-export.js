(() => {
  'use strict';
  const $=id=>document.getElementById(id),clone=value=>structuredClone(value);
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const button=(text,handler,cls='btn text')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',handler);return b;};
  const money=n=>n===null?'—':(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
  const amount=line=>line.supply==='priced'?(line.qty*line.price+50n)/100n:null;
  const allMissing=q=>q.lines.every(line=>line.supply==='missing');
  const total=q=>q.lines.reduce((sum,line)=>sum+(amount(line)||0n),0n);
  const quantity=q=>q.lines.reduce((sum,line)=>sum+line.qty,0n);
  const publicQuote=()=>frozen||quote;
  const canEditDraft=()=>!frozen&&!root.completed&&!root.voided&&root.revision===quote.revision;
  let quote,frozen,root,records,active,pendingFormat,page=0,sequence=0,retired=null,lateCandidate=false,clock='2026-10-16';
  const statuses={accepted:'已受理',generating:'生成中',checking:'完成检查中',unknown:'结果待核对',succeeded:'成功（演示）',failed:'失败（演示）'};
  function baseQuote(){
    const data=[['黄芪','斜片',3000n,4000n,3700n],['甘草','薄片',800n,2080n,1780n],['当归','全归片',1500n,9350n,9050n],['党参','段',2000n,5880n,5580n],['白术','',1250n,2920n,2620n]];
    return {seller:'示例饮片供应公司',hospital:'杏林医院',sales:'林销售',contact:'138 **** 0000（虚构）',orderNo:'CG-20261016-001',quoteNo:'BJ-20261016-HOSP01-001',version:1,revision:1,date:'2026-10-16',until:'2026-10-19',lines:data.map(([name,spec,qty,price,base],i)=>({name,spec,qty,price,base,baseUntil:i===1?'2026-10-20':'2026-10-19',basisCurrent:true,confirmed:true,supply:i===4?'missing':'priced',missingEvidence:i===4,lossReason:'',remark:i===4?'本次缺货':''}))};
  }
  function reset(){
    const mode=$('scenario').value;quote=baseQuote();frozen=null;root={revision:1,completed:false,voided:false,basisInvalid:false};records=[];active=null;pendingFormat=null;retired=null;lateCandidate=false;sequence=0;clock='2026-10-16';page=0;
    if(['priced','loss'].includes(mode))quote.lines[4].supply='priced';
    if(mode==='loss'){quote.lines[0].price=3699n;quote.lines[0].lossReason='本次协商价格，已核对亏损（虚构）';}
    if(mode==='missing'){quote.lines.forEach(line=>{line.supply='missing';line.price=null;line.base=null;line.missingEvidence=true;line.remark='本次缺货';});quote.until=null;}
    if(mode==='blocked'){quote.lines[4].supply='pending';quote.lines[4].price=null;quote.lines[4].base=null;quote.lines[4].missingEvidence=false;quote.lines[4].remark='待厂家结果';}
    if(mode==='long'){
      const names=['黄芪','甘草','当归','党参','白术','茯苓','陈皮','白芍','川芎','熟地黄','生地黄','麦冬','天冬','山药','山茱萸','泽泻','牡丹皮','桂枝','干姜','大枣','黄连','黄芩','黄柏','金银花','连翘','板蓝根','桔梗','杏仁','薏苡仁'];
      quote.orderNo='CG-20261016-002';quote.quoteNo='BJ-20261016-HOSP01-002';quote.lines=names.map((name,i)=>({name,spec:i%4===0?'片':'',qty:BigInt(5+i)*100n,price:2200n+BigInt(i)*75n,base:2000n+BigInt(i)*75n,baseUntil:'2026-10-19',basisCurrent:true,confirmed:true,supply:'priced',missingEvidence:false,lossReason:'',remark:''}));
    }
    if(mode==='v2'||mode==='voided'){
      const prior=clone(quote);prior.version=1;records.push(seedRecord(prior,true));quote.version=2;
      if(mode==='voided'){root.completed=true;root.voided=true;frozen=clone(quote);}
    }
    if(['exported','expired','invalid','old'].includes(mode)){frozen=clone(quote);records.push(seedRecord(frozen,false));}
    if(mode==='expired')clock='2026-10-20';if(mode==='invalid')root.basisInvalid=true;if(mode==='old')root.revision=2;
    $('outcome').value='success';$('zoom').value='fit';feedback('');render();
  }
  function filename(q,format){return q.hospital+'_'+q.quoteNo+'_V'+q.version+(format==='PDF'?'.pdf':'.xlsx');}
  function seedRecord(snapshot,sent){return {id:'E'+String(++sequence).padStart(3,'0'),version:snapshot.version,format:'PDF',filename:filename(snapshot,'PDF'),requested:'2026-10-16 09:30',status:'succeeded',snapshot:clone(snapshot),sent,note:sent?'V1 历史已发送样例':'历史成功导出样例'};}
  function guardErrors(){const q=publicQuote(),errors=[];if(root.completed)errors.push('订单已有最终确认，当前未发送版本已关闭。');if(root.voided)errors.push('当前版本已作废，不能继续导出或发送。');if(root.revision!==q.revision)errors.push('当前采购修订为 R'+root.revision+'，此报价属于旧 R'+q.revision+'。');if(root.basisInvalid)errors.push('所选基准厂家报价已失效，须取得新报价并创建或修正当前草稿。');if(!allMissing(q)&&q.until<clock)errors.push('医院报价已过期；原快照及已有成功记录保留，不能再作为有效报价导出或发送。');return errors;}
  function validate(snapshot){
    const errors=guardErrors();snapshot.lines.forEach((line,i)=>{const title=(i+1)+'. '+line.name+'：';if(line.supply==='missing'){if(!line.missingEvidence)errors.push(title+'缺少两家明确缺货依据。');return;}if(line.supply!=='priced'){errors.push(title+'一家无法供货、另一家尚未完整提交，整单等待。');return;}if(!line.basisCurrent||line.base===null||line.baseUntil<clock)errors.push(title+'基准报价不再有效。');if(line.price===null||line.price<=0n||!line.confirmed)errors.push(title+'最终价格不合法或未确认。');if(line.price!==null&&line.base!==null&&line.price<line.base&&!line.lossReason.trim())errors.push(title+'缺少低于基准价的原因。');});
    if(!allMissing(snapshot)){const cap=snapshot.lines.filter(line=>line.supply==='priced').map(line=>line.baseUntil).sort()[0];if(!snapshot.until||snapshot.until<clock||!cap||snapshot.until>cap)errors.push('医院有效期不合法，不能晚于所选基准最早到期日。');}return errors;
  }
  function feedback(text,error=false){$('feedback').textContent=text;$('feedback').classList.toggle('error',error);}
  function info(title,parts){$('info-title').textContent=title;$('info-body').replaceChildren(...parts);$('info-dialog').showModal();}
  function listInfo(title,items){const list=el('ul','info-list');items.forEach(text=>list.append(el('li','',text)));info(title,[list]);}
  function renderPaper(){
    const q=publicQuote(),pages=Math.ceil(q.lines.length/12);page=Math.min(page,pages-1);const start=page*12,lines=q.lines.slice(start,start+12),last=page===pages-1,target=$('quotation');target.replaceChildren();
    const sellerRow=el('div','seller-row'),seller=el('div','seller');seller.append(el('span','seller-mark','饮'),document.createTextNode(q.seller));sellerRow.append(seller,el('span','seller-note','销售报价单'));target.append(sellerRow,el('h3','quote-title','饮片报价单'));
    const meta=el('div','paper-meta');[['医院名称',q.hospital],['报价单号',q.quoteNo],['报价日期',q.date],['报价版本','V'+q.version],['销售联系',q.sales+' / '+q.contact],['报价有效至',q.until?q.until+'（含当日）':'不适用（全部缺货）']].forEach(([label,value])=>{const part=el('div');part.append(el('span','',label+'：'),el('strong','',value));meta.append(part);});target.append(meta);
    const table=el('table'),thead=el('thead'),heading=el('tr'),columns=[['number','序号'],['drug','药品名称'],['specification','规格'],['qty','数量'],['unit','单位'],['supply','供货'],['unit-price','单价（元）'],['amount','金额（元）'],['remark','备注']];columns.forEach(([cls,label])=>heading.append(el('th',cls,label)));thead.append(heading);table.append(thead);const body=el('tbody');
    lines.forEach((line,i)=>{const tr=el('tr'),missing=line.supply==='missing',priced=line.supply==='priced';tr.dataset.index=String(start+i+1);tr.append(el('td','number',String(start+i+1)),el('td','drug',line.name),el('td','specification',line.spec||'未提供'),el('td','qty',money(line.qty)),el('td','unit','kg'),el('td','supply'+(missing?' unavailable':''),priced?'可供货':missing?'缺货':'待结果'),el('td','unit-price',priced?money(line.price):'—'),el('td','amount',priced?money(amount(line)):'—'),el('td','remark',line.remark));body.append(tr);});table.append(body);target.append(table);
    if(last){const summary=el('div','summary'),left=el('div');if(allMissing(q))left.append(el('div','all-missing','本单全部缺货'));left.append(el('div','','共 '+q.lines.length+' 味 / 采购数量 '+money(quantity(q))+' kg'));const right=el('div');right.append(el('small','','报价合计（元）'),el('strong','',allMissing(q)?'不适用（全部缺货）':money(total(q))));summary.append(left,right);target.append(summary,el('p','tax-note','以上报价均为含税价格'));}
    else target.append(el('p','continuation','后续明细见下一页，合计见末页。'));
    const footer=el('div','paper-bottom'),contact=el('div');contact.append(el('p','',q.seller),el('p','',q.sales+' · '+q.contact));footer.append(contact,el('div','paper-page','第 '+(page+1)+' 页 / 共 '+pages+' 页'));target.append(footer);$('page-label').textContent=(page+1)+' / '+pages;$('previous-page').disabled=page===0;$('next-page').disabled=last;fitPaper();
  }
  function fitPaper(){const view=$('paper-viewport'),space=$('paper-space'),actual=$('zoom').value==='actual';view.classList.toggle('actual',actual);const style=getComputedStyle(view),width=view.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),scale=actual?1:Math.min(1,Math.max(.1,width/794));space.style.width=(794*scale)+'px';space.style.height=(1123*scale)+'px';space.style.margin='0 auto';$('quotation').style.transform='scale('+scale+')';}
  function renderRecords(){
    $('record-count').textContent=String(records.length);$('no-records').hidden=!!records.length;$('record-body').replaceChildren(...records.map(record=>{const tr=el('tr'),id=el('td','',record.id+' / V'+record.version),file=el('td','',record.format);file.append(el('div','filename',record.filename));const status=el('td'),label=el('div','record-status'+(record.status==='failed'?' failed':record.status==='succeeded'?'':' waiting'),statuses[record.status]);status.append(label);if(record.note)status.append(el('div','filename',record.note));const actions=el('td');if(record.status==='succeeded')actions.append(button('查看演示回执',()=>showReceipt(record)));else actions.append(el('span','filename','尚无成功文件'));tr.append(id,file,el('td','',record.requested),status,actions);return tr;}));
  }
  function render(){
    const q=publicQuote(),errors=guardErrors(),all=allMissing(q),blocked=validate(q),versionState=root.voided?'已作废':frozen?'已冻结':'草稿';$('quote-id').textContent=q.quoteNo+' · 采购 R'+q.revision+' · '+q.lines.length+' 行全部保留';$('version-label').textContent='V'+q.version+' '+versionState;$('panel-version').textContent='V'+q.version+' · '+(root.voided?'已作废':frozen?'内容已冻结':'尚未冻结');$('send-status').textContent=root.completed?'其他版本已最终确认':'当前版本未发送医院';
    const facts=[['采购修订','R'+q.revision],['明细',q.lines.length+' 行'],['有效至',q.until||'不适用'],['合计',all?'全部缺货':money(total(q))+' 元']];$('version-facts').replaceChildren(...facts.flatMap(([label,value])=>[el('dt','',label),el('dd','',value)]));$('eligibility').textContent=errors.length?'仅历史查阅，导出入口关闭':blocked.length?'整单尚有 '+blocked.length+' 项待处理':'已具备当前整单导出条件';$('eligibility').classList.toggle('error',!!blocked.length);
    let message=errors.length?errors.join(' '):active?'本次导出尚未成功，暂时占用当前版本；不能编辑、重复导出或创建下一版本。':frozen?'V'+q.version+' 内容已冻结；补导其他格式沿用同一价格与有效期，不增加版本号。':'当前仅为预览，尚未冻结。首次成功导出才冻结本版本。';if(lateCandidate)message+=' 厂家出现更低后到价，本冻结版保持原样；如需采用须创建下一版本。';$('state-banner').textContent=message;$('state-banner').className='banner'+(errors.length?' error':active||lateCandidate?' warning':'');
    $('export-help').textContent=active?'先核对本次任务结果，再决定下一步。':frozen?'PDF 与 Excel 重用已冻结内容，每次操作独立留痕。':'确认后占用本草稿；成功完成才冻结。';['export-pdf','export-excel'].forEach(id=>$(id).disabled=!!active||!!errors.length);$('return-pricing').disabled=!!active||(!frozen&&!canEditDraft());$('return-pricing').textContent=frozen?'查看计价只读说明':'返回计价样例';$('new-version').disabled=!!active||root.completed||root.voided||root.revision!==q.revision||!frozen;
    $('next-step').textContent=root.completed?'订单已完成，未发送版本关闭，历史记录保留。':all?'全缺货也需发送；医院知悉后由销售登记完成，不建立应收。':'导出完成仍未发送医院，不创建医院确认或应收。可前往独立的发送与确认样例。';
    $('scenario').disabled=!!active;$('outcome').disabled=!!active;$('advance-job').disabled=!active||active.status==='unknown';$('late-price').disabled=!frozen||!!active||!!errors.length||lateCandidate;$('late-callback').disabled=!retired;$('demo-clock').textContent='演示时钟：'+clock+' '+(clock==='2026-10-20'?'00:00':'10:00')+' · 北京时间';
    $('job-progress').hidden=!active;if(active){const phases={accepted:['1 / 3','已受理','仅创建导出尝试，报价尚未冻结。',12],generating:['2 / 3','正在生成文件','临时结果尚不可下载或发送；版本仍被占用。',48],checking:['3 / 3','正在完成检查','检查日期、基准与当前修订；通过后才成功绑定。',80],unknown:['待核对','结果尚未确定','只查询本次结果，避免盲目重试或重复生成。',85]},current=phases[active.status];$('job-title').textContent=active.format+' · '+current[1];$('job-phase').textContent=current[0];$('job-copy').textContent=current[2];$('progress-fill').style.width=current[3]+'%';$('check-result').hidden=active.status!=='unknown';}
    renderPaper();renderRecords();
  }
  function requestExport(format){
    if(active)return;const snapshot=clone(publicQuote()),errors=validate(snapshot);
    if($('outcome').value==='confirmed'&&snapshot.version!==2)errors.push('请先切换“V2 草稿 / V1 已发送”样例，演示 V1 被确认后关闭 V2。');
    if(errors.length){listInfo('整单尚不能导出',errors);return;}
    pendingFormat=format;$('confirm-title').textContent='开始导出 '+format+'？';const details=[el('div','detail-row',snapshot.hospital+' · '+snapshot.quoteNo+' / V'+snapshot.version),el('div','detail-row',snapshot.lines.length+' 行全部保留：'+snapshot.lines.filter(line=>line.supply==='priced').length+' 行有价，'+snapshot.lines.filter(line=>line.supply==='missing').length+' 行缺货'),el('div','detail-row',allMissing(snapshot)?'本单全部缺货；金额及价格有效期不适用。':'合计 '+money(total(snapshot))+' 元；有效至 '+snapshot.until+'（含当日）'),el('p','',frozen?'本次使用已冻结快照，不新增报价版本，不更改价格及有效期。':'导出期间暂时占用本草稿。完成检查成功后才冻结；预览和请求受理都不代表已经导出成功。')];
    const losses=snapshot.lines.filter(line=>line.supply==='priced'&&line.base!==null&&line.price<line.base);losses.forEach(line=>details.push(el('div','detail-row danger',line.name+' 低于基准价；内部原因：'+line.lossReason)));$('confirm-body').replaceChildren(...details);$('export-ack').checked=false;$('confirm-export').disabled=true;$('ack-copy').textContent=losses.length?'我已核对整单内容与上述亏损风险，继续本次导出。':'我已核对整单内容、有效期和缺货结论，继续本次导出。';$('confirm-dialog').showModal();
  }
  function beginExport(){
    if(active||!pendingFormat||!$('export-ack').checked)return;const format=pendingFormat,snapshot=clone(publicQuote()),errors=validate(snapshot);pendingFormat=null;$('confirm-dialog').close();
    if(errors.length){listInfo('状态已变化，未开始导出',errors);return;}
    const attempt={id:'E'+String(++sequence).padStart(3,'0'),version:snapshot.version,format,filename:filename(snapshot,format),requested:clock+' 10:00:'+String(sequence).padStart(2,'0'),status:'accepted',snapshot,outcome:$('outcome').value,note:'已受理，尚无成功文件',sent:false};records.unshift(attempt);active=attempt;feedback('本次请求已受理，尚未生成成功文件，也未发送医院。');render();
  }
  function fail(attempt,reason){
    if(!active||active.id!==attempt.id)return;attempt.status='failed';attempt.note=reason;if(attempt.outcome==='timeout')retired=attempt.id;active=null;
    const stillEditable=canEditDraft();feedback(reason+' '+(stillEditable?'本次占用已释放，仍为草稿，可返回计价核对后重新发起。':frozen&&!guardErrors().length?'占用已释放，已冻结内容及以前成功记录保留。':'占用已释放，但当前业务状态不允许恢复编辑或继续导出。'),true);render();
  }
  function finish(attempt,queried=false){
    if(!active||active.id!==attempt.id)return;
    if(attempt.outcome==='unknown'&&!queried){attempt.status='unknown';attempt.note='结果未知，先查询本次任务，不自动重新导出';feedback('尚未核实成功或失败，继续占用本版本。请查询同一次导出结果。',true);render();return;}
    if(attempt.outcome==='failure'){fail(attempt,'文件生成失败；未绑定任何成功文件。');return;}
    if(attempt.outcome==='timeout'){fail(attempt,'导出执行已超时回收；本次尝试失效，旧回调不能再提交结果。');return;}
    if(attempt.outcome==='expires'&&!allMissing(attempt.snapshot))clock='2026-10-20';
    if(attempt.outcome==='basis')root.basisInvalid=true;
    if(attempt.outcome==='revision')root.revision=2;
    if(attempt.outcome==='confirmed'){root.completed=true;root.voided=true;}
    const errors=validate(attempt.snapshot);if(errors.length){fail(attempt,'完成检查未通过：'+errors.join(' '));return;}
    if(!frozen)frozen=clone(attempt.snapshot);attempt.status='succeeded';attempt.note='成功绑定本版本快照（演示）；未发送医院';active=null;feedback('导出成功（本地演示）。V'+frozen.version+' 已冻结；可查看演示回执，不提供真实文件下载。');render();
  }
  function advance(){if(!active||active.status==='unknown')return;const attempt=active;if(attempt.status==='accepted'){attempt.status='generating';attempt.note='生成中，临时结果不可作为成功文件';render();return;}if(attempt.status==='generating'){attempt.status='checking';attempt.note='等待完成检查，尚未业务冻结';render();return;}if(attempt.status==='checking')finish(attempt);}
  function showReceipt(record){
    const q=record.snapshot,details=el('dl','receipt-dl');[['任务 / 版本',record.id+' / V'+record.version],['文件格式',record.format==='PDF'?'PDF（设计目标）':'Excel .xlsx（设计目标）'],['目标文件名',record.filename],['请求时间',record.requested],['内容来源','原冻结快照 R'+q.revision+' / V'+q.version],['报价有效至',q.until||'不适用（全部缺货）'],['金额',allMissing(q)?'不适用（全部缺货）':money(total(q))+' 元'],['发送状态',record.sent?'历史样例：已发送':'未发送医院']].forEach(([label,value])=>details.append(el('dt','',label),el('dd','',value)));
    const rows=el('div');q.lines.forEach(line=>rows.append(el('div','detail-row',line.name+' · '+money(line.qty)+' kg · '+(line.supply==='missing'?'缺货 / 单价与金额留空':money(line.price)+' 元/kg / '+money(amount(line))+' 元'))));
    info('导出演示回执',[el('div','download-boundary','这是本地状态回执，不是 PDF / Excel 文件。真实文件生成、COS 成功绑定、下载和 WPS / Excel 打开验证仍待实现。历史访问不代表可以再次发送。'),details,rows]);
  }
  $('scenario').addEventListener('change',reset);$('zoom').addEventListener('change',fitPaper);$('previous-page').addEventListener('click',()=>{if(page>0){page--;renderPaper();}});$('next-page').addEventListener('click',()=>{if((page+1)*12<publicQuote().lines.length){page++;renderPaper();}});
  $('export-pdf').addEventListener('click',()=>requestExport('PDF'));$('export-excel').addEventListener('click',()=>requestExport('Excel'));$('export-ack').addEventListener('change',()=>{$('confirm-export').disabled=!$('export-ack').checked;});$('confirm-export').addEventListener('click',beginExport);
  $('cancel-export').addEventListener('click',()=>{$('confirm-dialog').close();pendingFormat=null;});$('confirm-dialog').addEventListener('cancel',()=>{pendingFormat=null;});$('close-info').addEventListener('click',()=>$('info-dialog').close());$('advance-job').addEventListener('click',advance);$('check-result').addEventListener('click',()=>{if(active?.status==='unknown')finish(active,true);});
  $('late-price').addEventListener('click',()=>{if(!frozen||active||guardErrors().length)return;lateCandidate=true;feedback('模拟发现更低厂家价；已冻结内容保持原样，不自动改写 PDF / Excel。');render();});
  $('late-callback').addEventListener('click',()=>{if(!retired)return;feedback(retired+' 的迟到回调被本地演示拒绝；该尝试已回收，不改当前版本、任务或成功记录。');});
  $('return-pricing').addEventListener('click',()=>{if(active)return;if(frozen){listInfo('当前版本已冻结，只读查看',['不能直接覆盖本版本价格或有效期。','正式应用将进入冻结版只读计价；需改价时创建下一版本。本页不创建真实草稿。']);return;}if(!canEditDraft())return;location.href=location.protocol==='file:'?'pricing-workbench.html':'/files/pricing-workbench.html';});
  $('new-version').addEventListener('click',()=>{if(!frozen||active||root.completed||root.voided||root.revision!==quote.revision)return;listInfo('修改须创建下一报价版本',['保留 V'+frozen.version+' 的原价格、文件及导出记录；不能覆盖冻结内容。','复制上一版最终价作为初值，同时重新加载当前有效厂家报价并重新核对。','本次只审阅预览与导出，不实际创建新版本或发送医院。']);});
  if(location.protocol!=='file:')document.querySelectorAll('a[href]').forEach(link=>{const href=link.getAttribute('href');if(/^[a-z-]+\.html$/.test(href))link.setAttribute('href','/files/'+href);});
  new ResizeObserver(fitPaper).observe($('paper-viewport'));reset();
})();
