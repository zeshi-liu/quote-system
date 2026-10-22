(() => {
  'use strict';
  const $=id=>document.getElementById(id),clone=value=>structuredClone(value);
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const button=(text,action,cls='btn text')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',action);return b;};
  const money=n=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
  const statusText=v=>v.allMissing&&v.status==='confirmed'?'医院已知悉':statusName[v.status];
  const statusName={draft:'草稿',exported:'已导出未发送',sent:'已登记发送',confirmed:'医院已确认',voided:'已作废'};
  let versions,root,selected,events,now,role,pendingReview,pendingOperation,lastSuccess,sequence=0,resultMessage=null;
  function epoch(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))return null;const normal=value.length===16?value+':00':value,n=Date.parse(normal+'+08:00');if(!Number.isFinite(n)||new Date(n+28800000).toISOString().slice(0,19)!==normal)return null;return n;}
  const timeText=value=>value?value.replace('T',' '):'尚未登记';
  const quoteTotal=version=>version.allMissing?null:version.prices.reduce((sum,p,i)=>sum+(p===null?0n:(p*quantities[i]+50n)/100n),0n);
  const quantities=[3000n,800n,1500n,2000n,1250n],drugNames=['黄芪','甘草','当归','党参','白术'];
  const current=()=>versions.find(version=>version.id===selected);
  const busy=()=>!!pendingOperation;
  const dueDate=()=>new Date(Date.parse(root.received+'T00:00:00Z')+root.termDays*86400000).toISOString().slice(0,10);
  function version(no,status,prices){return {id:'v'+no,no,status,revision:1,allMissing:false,until:'2026-10-19',prices,files:status==='draft'?[]:[{format:'PDF',status:'succeeded'}],firstExport:status==='draft'?null:'2026-10-16T09:'+String((no-1)*20).padStart(2,'0')+':00',sentAt:status==='sent'?'2026-10-16T09:'+String((no-1)*20+10).padStart(2,'0')+':00':null,invalidatedAt:null,closedReason:null};}
  function reset(){
    const mode=$('scenario').value;now='2026-10-16T10:00:00';role=mode==='readonly'?'reader':'owner';versions=[version(1,'sent',[4000n,2080n,9350n,5880n,null]),version(2,'exported',[4100n,2150n,9400n,5950n,null]),version(3,'draft',[4200n,2200n,9500n,6000n,null])];root={revision:1,completed:false,confirmedId:null,received:'2026-10-16',termDays:90,receivable:null,confirmation:null,closed:[]};selected='v2';events=[];pendingReview=null;pendingOperation=null;lastSuccess=null;sequence=0;resultMessage=null;
    if(mode==='two-sent'){versions[1].status='sent';versions[1].sentAt='2026-10-16T09:30:00';}
    if(mode==='surrounding'){versions[0].status='exported';versions[0].sentAt=null;versions[1].status='sent';versions[1].sentAt='2026-10-16T09:30:00';}
    if(mode==='expired'){now='2026-10-20T10:00:00';selected='v1';}
    if(mode==='invalid'){versions[0].invalidatedAt='2026-10-16T09:45:00';versions[1].invalidatedAt='2026-10-16T09:45:00';selected='v1';}
    if(mode==='old'){root.revision=2;selected='v1';}
    if(mode==='voided'){versions[0].status='voided';versions[0].closedReason='报价版本已作废';selected='v1';}
    if(mode==='no-file'){versions[1].status='draft';versions[1].firstExport=null;versions[1].files=[{format:'PDF',status:'failed'}];}
    if(mode==='missing'){versions.forEach(v=>{v.allMissing=true;v.until=null;v.prices=[null,null,null,null,null];});versions[0].status='exported';versions[0].sentAt=null;selected='v1';}
    if(mode==='readonly')selected='v1';
    events.push({title:'样例报价版本已载入',detail:'仅本页虚构数据。发送是销售系统登记，医院确认在线下发生。',at:now,actor:'演示'});
    if(mode==='completed')finalize(versions[0],'2026-10-16T09:30:00','线下确认后补录（虚构）','样例');
    $('outcome').value='success';clearForms();render();
  }
  function clearForms(){$('send-remark').value='';$('send-ack').checked=false;$('actual-time').value='';$('backfill-reason').value='';$('hospital-ack').checked=false;$('send-error').textContent='';$('confirm-error').textContent='';}
  function baseErrors(v){const errors=[];if(role!=='owner')errors.push('当前只读；旧单仍由订单负责销售林销售处理。');if(root.completed)errors.push('订单已有最终确认，不能另选版本或重新发送。');if(v.revision!==root.revision)errors.push('本报价属于旧采购修订 R'+v.revision+'，当前为 R'+root.revision+'，更早实际时间也不能绕过。');if(v.status==='voided')errors.push('本版本已作废，保留历史但不能发送或确认。');return errors;}
  function sendErrors(v){const errors=baseErrors(v);if(v.status!=='exported')errors.push(v.status==='sent'?'已登记发送，不重复生成首发记录。':'只能登记已有成功导出的未发送版本。');if(!v.firstExport||!v.files.some(file=>file.status==='succeeded'))errors.push('尚无成功导出文件；导出受理或失败不能作为发送依据。');if(v.invalidatedAt)errors.push('基准已失效，不能在失效后补标发送。');if(!v.allMissing&&epoch(now)>=epoch(v.until+'T00:00:00')+86400000)errors.push('当前价格已过期，不能通过倒填发送时间补标。');return errors;}
  function confirmationBaseErrors(v){const errors=baseErrors(v);if(v.status!=='sent'||!v.sentAt)errors.push('须先有本版本有效的发送登记。');if(!v.firstExport||!v.files.some(file=>file.status==='succeeded'))errors.push('须有本版本成功导出记录。');return errors;}
  function confirmationErrors(v,actual,reason){
    const errors=confirmationBaseErrors(v),at=epoch(actual),recorded=epoch(now);if(at===null){errors.push('请填写合法的医院实际确认或知悉时间（北京时间）。');return errors;}
    if(at>recorded)errors.push('实际确认时间不能在未来。');if(v.firstExport&&at<epoch(v.firstExport))errors.push('实际确认不能早于本版本首次成功导出。');
    if(!v.allMissing&&at>=epoch(v.until+'T00:00:00')+86400000)errors.push('实际确认发生在原医院报价有效期之外，不能接受。');
    if(v.invalidatedAt&&at>=epoch(v.invalidatedAt))errors.push('实际确认必须严格早于基准首次失效时间；等于失效时刻也不接受。');
    if(at<recorded&&!reason.trim())errors.push('实际时间早于录入时刻，必须填写延迟补录原因。');return errors;
  }
  function record(title,detail,actor='林销售'){events.unshift({title,detail,actor,at:now});}
  function qualifier(v){if(v.revision!==root.revision)return '旧采购修订';if(v.status==='voided')return v.closedReason||'已作废';if(v.invalidatedAt)return '基准失效：'+timeText(v.invalidatedAt);if(!v.allMissing&&epoch(now)>=epoch(v.until+'T00:00:00')+86400000)return v.status==='sent'?'已过期，可核对更早实际确认':'已过期，不能登记发送或确认';return '';}
  function selectVersion(id){if(busy())return;selected=id;clearForms();render();}
  function buildVersion(v,mobile=false){
    const chosen=v.id===selected,select=button('V'+v.no,()=>selectVersion(v.id),'version-select');select.prepend(el('span','selection-dot'));select.disabled=busy();select.setAttribute('aria-label','选择 V'+v.no);const price=quoteTotal(v),note=qualifier(v),files=v.files.filter(file=>file.status==='succeeded').length;
    if(mobile){const row=el('section','mobile-version'+(chosen?' selected':'')),top=el('div','mobile-version-top'),facts=el('div','mobile-version-facts'),bottom=el('div','mobile-version-bottom');top.append(select,el('span','status-badge '+v.status,statusText(v)));facts.append(el('strong','',price===null?'全部缺货':money(price)+' 元'),el('span','',v.until?'有效至 '+v.until:'价格有效期不适用'));bottom.append(el('span','',files+' 个成功导出 / '+(v.sentAt?'已登记发送':'未发送')),button('查看内容',()=>showVersion(v),'btn text'));row.append(top,facts,bottom);if(note)row.append(el('div','secondary-line danger',note));return row;}
    const tr=el('tr',chosen?'selected':'');tr.dataset.version=v.id;const first=el('td');first.append(select);const status=el('td');status.append(el('div','status-badge '+v.status,statusText(v)));if(note)status.append(el('div','secondary-line danger',note));const file=el('td');file.append(el('div','',files+' 个成功导出'),el('div','secondary-line',v.sentAt?'登记 '+timeText(v.sentAt):'未登记发送'));const view=el('td');view.append(button('查看内容',()=>showVersion(v),'btn text'));if(files)view.append(button('历史文件回执',()=>showFiles(v),'btn text version-read-link'));tr.append(first,status,el('td','money',price===null?'全部缺货':money(price)),el('td','money',v.until||'不适用'),file,view);return tr;
  }
  function renderCompletion(){
    $('completion-facts').replaceChildren();if(!root.completed){$('completion-title').textContent='尚未登记医院确认';$('completion-note').textContent='导出和发送都不会创建应收。完成前将核对医院实际接受的具体版本。';return;}
    const v=versions.find(item=>item.id===root.confirmedId),ar=root.receivable,facts=el('div','completion-grid');$('completion-title').textContent='V'+v.no+' 已完成'+(v.allMissing?' · 医院已知悉缺货':' · 医院已接受报价');
    const values=[['医院实际'+(v.allMissing?'知悉':'确认'),timeText(root.confirmation.actual)],['系统录入时间',timeText(root.confirmation.recorded)],['确认版本金额',v.allMissing?'不适用（全部缺货）':money(quoteTotal(v))+' 元'],['回款状态',ar?'未回款 · 尚未结清':'无应收，不需回款']];values.forEach(([label,value])=>{const part=el('div');part.append(el('small','',label),el('strong','',value));facts.append(part);});
    if(ar){[['应收来源','V'+v.no+' 医院最终确认报价'],['应收 / 未收',money(ar.amount)+' / '+money(ar.amount-ar.paid)+' 元'],['有效已收',money(ar.paid)+' 元'],['到期日',ar.due]].forEach(([label,value])=>{const part=el('div');part.append(el('small','',label),el('strong','',value));facts.append(part);});}
    $('completion-facts').append(facts);if(root.closed.length)$('completion-facts').append(el('div','closure-note','已作废其他未发送版本：'+root.closed.map(item=>'V'+item.no+'（原'+statusName[item.oldStatus]+'）').join('、')+'。文件与历史保留；其他已发送版本保持只读。'));
    if(root.confirmation.reason)$('completion-facts').append(el('div','closure-note','补录原因：'+root.confirmation.reason+' / 操作人：林销售'));
    $('completion-note').textContent=ar?'报价流程已完成，回款仍独立跟进。账期从 '+root.received+' 起算 '+root.termDays+' 天；本页没有录入任何实际回款。':'本单全部缺货，只登记知悉完成，不建立 0 元应收；原采购需求与历史仍保留。';
  }
  function render(){
    const v=current(),issues=baseErrors(v),readonly=role!=='owner'||root.completed||v.revision!==root.revision||v.status==='voided',blocking=busy();$('identity').textContent=role==='owner'?'林销售 · 当前订单负责人':'陈销售 · 医院现负责人 / 旧单只读';$('demo-clock').textContent='演示时钟：'+timeText(now)+' · 北京时间';$('order-state').textContent=root.completed?'报价已完成':'报价未完成';$('source-facts').textContent='接收 '+root.received+' / 本单 '+root.termDays+' 天 / 到期 '+dueDate();
    $('state-notice').classList.toggle('good',root.completed);$('state-notice').textContent=role!=='owner'?'医院转给陈销售后，仅新订单归陈销售；本旧单仍由林销售操作，历史署名保留。':root.completed?(versions.find(item=>item.id===root.confirmedId).allMissing?'缺货知悉已登记；未发送版本已关闭，本单不建立应收。':'最终确认已固定为 V'+versions.find(item=>item.id===root.confirmedId).no+'；未发送版本已关闭，回款状态单独跟进。'):v.revision!==root.revision?'当前采购已换 R'+root.revision+'；旧 R'+v.revision+' 报价不能因更早实际时间恢复确认资格。':'请先选择医院实际收到和接受的版本。系统只登记线下事实，不自动发送微信。';
    $('versions-body').replaceChildren(...versions.map(v=>buildVersion(v)));$('versions-mobile').replaceChildren(...versions.map(v=>buildVersion(v,true)));$('selected-title').textContent='V'+v.no+' · '+statusText(v);$('selected-amount').textContent=v.allMissing?'本单全部缺货':'¥ '+money(quoteTotal(v));
    const fields=[['采购修订','R'+v.revision],['首次成功导出',v.firstExport?timeText(v.firstExport):'尚无'],['系统发送登记',v.sentAt?timeText(v.sentAt):'尚无'],['价格有效至',v.until?v.until+'（含当日）':'不适用（全部缺货）'],['基准首次失效',v.invalidatedAt?timeText(v.invalidatedAt):'未失效']];$('selected-facts').replaceChildren(...fields.flatMap(([label,value])=>[el('dt','',label),el('dd','',value)]));$('panel-alert').textContent=root.completed?'':issues.length?issues.join(' '):['draft','exported'].includes(v.status)?sendErrors(v).join(' '):qualifier(v)||'';
    $('send-form').hidden=readonly||!['exported','draft'].includes(v.status);$('confirm-form').hidden=readonly||v.status!=='sent';$('readonly-panel').hidden=!readonly&&['exported','draft','sent'].includes(v.status);$('readonly-copy').textContent=(root.completed?'医院反馈已登记完成，本版本只读；仍可查阅原内容与历史。':issues.join(' '))||'只能查阅本版本；没有发送或确认操作。';
    $('sent-record-time').textContent=timeText(now);['send-remark','send-ack'].forEach(id=>$(id).disabled=blocking||!!sendErrors(v).length);$('review-send').disabled=blocking||!!sendErrors(v).length;
    if(!readonly&&v.status==='draft')$('panel-alert').textContent='当前尚非已成功导出的版本，不能登记发送；请先完成导出。';
    $('confirm-form-title').textContent=v.allMissing?'登记医院已知悉全部缺货':'登记医院已接受报价';$('confirm-instructions').textContent=v.allMissing?'登记医院实际知悉的时间；完成后不建立应收。':'实际确认须在原有效期内。销售过期后补录时，仍保留实际时间及延迟原因。';$('actual-time-label').textContent='医院实际'+(v.allMissing?'知悉':'确认')+'时间（北京时间）';$('hospital-ack-copy').textContent=v.allMissing?'医院已明确知悉本版本全部缺货。':'医院已明确接受本版本报价。';$('actual-time').max=now;$('actual-help').textContent='首次导出 '+timeText(v.firstExport)+(v.invalidatedAt?'；实际确认须早于 '+timeText(v.invalidatedAt):'；不得填写未来时间。');
    ['actual-time','backfill-reason','hospital-ack','use-now','review-confirm'].forEach(id=>$(id).disabled=blocking||!!confirmationBaseErrors(v).length);updateReasonLabel();
    $('scenario').disabled=blocking;$('outcome').disabled=blocking;$('replay-request').disabled=blocking||!lastSuccess;renderCompletion();renderEvents();renderOperation();
  }
  function updateReasonLabel(){const value=epoch($('actual-time').value);$('reason-label').textContent='补录原因'+(value!==null&&value<epoch(now)?'（必填）':'（实际时间早于录入时必填）');}
  function renderEvents(){$('event-count').textContent=String(events.length);$('events-list').replaceChildren(...events.map(event=>{const row=el('div','event-row'),content=el('div');content.append(el('strong','',event.title),el('p','',event.detail));row.append(el('div','event-time',timeText(event.at)),content,el('div','event-actor',event.actor));return row;}));}
  function renderOperation(){const result=pendingOperation?{title:pendingOperation.status==='unknown'?'提交结果待核对':'正在登记，请稍候',copy:pendingOperation.status==='unknown'?'只查询本次请求，不自动重试，也尚未显示成功状态。':'本地演示处理中；版本状态和应收尚未提前改变。'}:resultMessage;$('operation-result').hidden=!result;$('query-operation').hidden=pendingOperation?.status!=='unknown';if(result){$('operation-title').textContent=result.title;$('operation-copy').textContent=result.copy;$('operation-result').classList.toggle('failed',!!result.failed);}}
  function info(title,parts){$('info-title').textContent=title;$('info-body').replaceChildren(...parts);$('info-dialog').showModal();}
  function showVersion(v){const table=el('table','review-table'),head=el('tr');['药品','数量 kg','供货','最终单价','金额 元'].forEach(text=>head.append(el('th','',text)));const thead=el('thead');thead.append(head);table.append(thead);const tbody=el('tbody');v.prices.forEach((price,i)=>{const tr=el('tr');tr.append(el('td','',drugNames[i]),el('td','',money(quantities[i])),el('td','',price===null?'缺货':'可供货'),el('td','',price===null?'—':money(price)),el('td','',price===null?'—':money((price*quantities[i]+50n)/100n)));tbody.append(tr);});table.append(tbody);info('V'+v.no+' · 本版本内容',[el('p','info-note','原冻结最终报价，5 行全部保留；不显示厂家成本。'+(v.allMissing?'本单全部缺货，不设价格有效期。':'原有效至 '+v.until+'（含当日）。')),table]);}
  function showFiles(v){info('V'+v.no+' · 历史文件回执',[el('p','info-note','仅演示已有成功导出记录，不提供真实文件下载。历史查阅不能恢复发送或确认资格。'),...v.files.map(file=>el('div','detail-row',file.format+' / '+(file.status==='succeeded'?'成功导出（演示）':'导出失败')+' / 杏林医院_BJ-20261016-HOSP01-001_V'+v.no+(file.format==='PDF'?'.pdf':'.xlsx')))]);}
  function finalize(v,actual,reason,actor='林销售'){
    // The production design requires one locked transaction; here the local sample changes together.
    if(root.completed)return;
    root.closed=versions.filter(other=>other.id!==v.id&&['draft','exported'].includes(other.status)).map(other=>({no:other.no,oldStatus:other.status}));
    versions.forEach(other=>{if(other.id!==v.id&&['draft','exported'].includes(other.status)){other.status='voided';other.closedReason='医院最终确认 V'+v.no+' 后关闭未发送版本';}});
    v.status='confirmed';root.completed=true;root.confirmedId=v.id;root.confirmation={actual,recorded:now,reason};
    root.receivable=v.allMissing?null:{id:'AR-DEMO-001',versionId:v.id,amount:quoteTotal(v),paid:0n,due:dueDate()};
    record('V'+v.no+(v.allMissing?' 已登记医院知悉并完成':' 已登记医院确认并完成'),'实际 '+timeText(actual)+'；系统录入 '+timeText(now)+(reason?'；补录原因：'+reason:'')+'。'+(v.allMissing?'全缺货，不建立应收。':'应收 '+money(quoteTotal(v))+' 元，到期 '+dueDate()+'；回款仍未结清。'),actor);
  }
  function impactRows(values){return values.map(([label,value])=>{const row=el('div','detail-row');row.append(el('strong','',label),el('span','',value));return row;});}
  function openReview(payload){
    const v=current();pendingReview=payload;$('review-ack').checked=false;$('submit-operation').disabled=true;
    $('review-title').textContent=payload.kind==='send'?'核对 V'+v.no+' 发送登记':'确认医院最终选择 V'+v.no;
    const rows=[['医院 / 订单','杏林医院 / CG-20261016-001'],['所选报价版本','V'+v.no+' / 采购 R'+v.revision],['本版本金额',v.allMissing?'不适用（全部缺货）':money(quoteTotal(v))+' 元']];
    if(payload.kind==='send')rows.push(['发送渠道','微信（销售线下发送）'],['系统登记时间',timeText(now)],['说明',payload.remark||'未填写']);
    else rows.push(['医院实际'+(v.allMissing?'知悉':'确认'),timeText(payload.actual)],['系统录入时间',timeText(now)],['补录原因',payload.reason||'与录入时刻相同，无延迟补录'],['应收结果',v.allMissing?'不建立应收':money(quoteTotal(v))+' 元；到期 '+dueDate()]);
    const parts=impactRows(rows);
    if(payload.kind==='send')parts.push(el('p','impact-note','仅登记这一个版本已线下发送；不会发送微信，也不会创建应收。'));
    else{
      const closing=versions.filter(other=>other.id!==v.id&&['draft','exported'].includes(other.status));
      parts.push(el('div','impact-note',closing.length?'同时作废所有其他未发送版本：'+closing.map(other=>'V'+other.no+'（'+statusName[other.status]+'）').join('、')+'。文件与历史保留。':'没有其他未发送版本需要作废。'));
      parts.push(el('p','info-note','最终确认后不能改选另一报价版本；其他已发送版保留只读。'+(v.allMissing?'本单全部缺货，需求明细保留。':'报价完成与回款结清独立跟进。')));
    }
    $('review-body').replaceChildren(...parts);$('review-ack-copy').textContent=payload.kind==='send'?'我已核对具体版本，确认登记线下发送。':'我已核对医院实际接受的版本、时间及以上影响。';$('review-dialog').showModal();
  }
  function failOperation(operation,errors){
    pendingOperation=null;resultMessage={title:'本次登记未成功',copy:errors.join(' '),failed:true};
    record('登记未成功',operation.id+' / '+errors.join(' '));render();
  }
  function resolveOperation(operation){
    if(pendingOperation!==operation)return;
    const payload=operation.payload,v=versions.find(item=>item.id===payload.versionId);
    if(operation.outcome==='failure'){failOperation(operation,['演示明确失败，未改变发送、最终确认或应收。可核对后重新登记。']);return;}
    if(operation.outcome==='revision'){root.revision=2;record('采购已换为 R2','原 R1 版本保留历史，不能继续发送或确认。','演示并发');}
    if(operation.outcome==='basis'){v.invalidatedAt||=now;record('所选基准已重新询价','首次失效 '+timeText(v.invalidatedAt)+'；只有真实发生在此之前的合格确认仍可补录。','演示并发');}
    if(operation.outcome==='confirmed'){
      const other=versions.find(item=>item.id!==v.id&&confirmationErrors(item,now,'').length===0);
      if(other)finalize(other,now,'','演示并发');
    }
    const errors=payload.kind==='send'?sendErrors(v):confirmationErrors(v,payload.actual,payload.reason);
    if(errors.length){failOperation(operation,errors);return;}
    if(payload.kind==='send'){
      v.status='sent';v.sentAt=now;record('V'+v.no+' 已登记线下发送','渠道：微信；系统登记 '+timeText(now)+(payload.remark?'；说明：'+payload.remark:'')+'。未建立应收。');
    }else finalize(v,payload.actual,payload.reason);
    lastSuccess={id:operation.id,kind:payload.kind,versionNo:v.no,recorded:now};pendingOperation=null;
    resultMessage={title:payload.kind==='send'?'V'+v.no+' 发送登记成功':'V'+v.no+' 医院反馈登记成功',copy:operation.id+' / '+(payload.kind==='send'?'现在可登记医院对本版本的确认或知悉。':v.allMissing?'已完成知悉登记，不建立应收。':'本版本已成为最终确认版，应收已在样例中建立，回款仍需跟进。')};clearForms();render();
  }
  $('send-form').addEventListener('submit',event=>{
    event.preventDefault();if(busy())return;const v=current(),errors=sendErrors(v);if(!$('send-ack').checked)errors.push('请确认已将本版本文件线下发送。');$('send-error').textContent=errors.join(' ');if(errors.length)return;
    openReview({kind:'send',versionId:v.id,remark:$('send-remark').value.trim()});
  });
  $('confirm-form').addEventListener('submit',event=>{
    event.preventDefault();if(busy())return;const v=current(),actual=$('actual-time').value,reason=$('backfill-reason').value.trim(),errors=confirmationErrors(v,actual,reason);if(!$('hospital-ack').checked)errors.push('请确认医院已明确'+(v.allMissing?'知悉本版本全部缺货。':'接受本版本报价。'));$('confirm-error').textContent=errors.join(' ');if(errors.length)return;
    openReview({kind:'confirm',versionId:v.id,actual:actual.length===16?actual+':00':actual,reason});
  });
  $('review-ack').addEventListener('change',()=>{$('submit-operation').disabled=!$('review-ack').checked;});
  $('cancel-review').addEventListener('click',()=>{pendingReview=null;$('review-dialog').close();});
  $('review-dialog').addEventListener('cancel',()=>{pendingReview=null;});
  $('submit-operation').addEventListener('click',()=>{
    if(!$('review-ack').checked||!pendingReview||busy())return;
    const payload=clone(pendingReview),outcome=$('outcome').value;
    if(outcome==='confirmed'&&!versions.some(v=>v.id!==payload.versionId&&confirmationErrors(v,now,'').length===0)){
      $('review-body').append(el('p','error','此样例没有另一合格的已发送版；请返回并切换“V1、V2 都已发送”，再演示另一版先完成。'));return;
    }
    pendingReview=null;$('review-dialog').close();const operation={id:'OP'+String(++sequence).padStart(3,'0'),status:'pending',payload,outcome};pendingOperation=operation;resultMessage=null;render();
    setTimeout(()=>{if(pendingOperation!==operation)return;if(outcome==='unknown'){operation.status='unknown';render();}else resolveOperation(operation);},420);
  });
  $('query-operation').addEventListener('click',()=>{
    const operation=pendingOperation;if(!operation||operation.status!=='unknown')return;operation.status='querying';render();setTimeout(()=>resolveOperation(operation),300);
  });
  $('replay-request').addEventListener('click',()=>{if(busy()||!lastSuccess)return;resultMessage={title:'已返回上次成功结果',copy:lastSuccess.id+' / V'+lastSuccess.versionNo+' / 原登记 '+timeText(lastSuccess.recorded)+'。本次未新增发送记录、最终确认或应收。'};render();});
  $('use-now').addEventListener('click',()=>{$('actual-time').value=now;updateReasonLabel();});
  $('actual-time').addEventListener('input',updateReasonLabel);$('scenario').addEventListener('change',reset);
  $('close-info').addEventListener('click',()=>$('info-dialog').close());
  $('show-facts').addEventListener('click',()=>info('原采购与账期快照',impactRows([['原接收日期',root.received],['订单保存账期',root.termDays+' 天'],['到期日',dueDate()],['操作权限','原订单负责销售：林销售；医院新负责人陈销售可只读'],['起算说明','从原采购接收日期起算，不从发送或确认日重新计算；医院默认值变化不追改此单。']])));
  if(location.protocol==='http:'||location.protocol==='https:')document.querySelectorAll('a[href]').forEach(a=>{const href=a.getAttribute('href');if(/^[a-z][a-z0-9-]*\.html(?:#.*)?$/.test(href))a.setAttribute('href','/files/'+href);});
  reset();
})();
