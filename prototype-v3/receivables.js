(() => {
  'use strict';
  const $=id=>document.getElementById(id),today='2026-10-20',recordedAt=today+' 10:00:00',pageSize=5,maxMoney=999999999999n;
  const names={lin:'林销售',chen:'陈销售',zhou:'周销售',admin:'内部管理员',hospital:'医院采购员'};
  const hospitals={h1:{name:'杏林医院',owner:'chen'},h2:{name:'和济中医院',owner:'lin'},h3:{name:'青禾医院',owner:'chen'},h4:{name:'松泉医院',owner:'zhou'}};
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const button=(label,action,cls='btn text')=>{const node=el('button',cls,label);node.type='button';node.addEventListener('click',action);return node;};
  const money=n=>(n/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(n%100n).toString().padStart(2,'0');
  const dateAdd=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  function cents(value){if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value))return null;const [whole,fraction='']=value.split('.');const n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));return n<=maxMoney?n:null;}
  function receipt(id,amount,paidDate,extra={}){return {id,amount,paidDate,type:'payment',status:'active',actor:'林销售',recordedAt:paidDate+' 10:00:00',remark:'',proof:null,...extra};}
  function order(id,hospital,owner,received,amount,extra={}){return {id,hospital,owner,received,amount,term:90,originalTerm:90,history:false,version:1,payments:[],exception:null,quoteVersion:'V1',...extra};}
  const orders=[
    order('CG-20261016-001','h1','lin','2026-10-16',394490n),
    order('CG-20261001-005','h1','chen','2026-10-01',512000n,{payments:[receipt('HK-1005-01',512000n,'2026-10-10',{actor:'陈销售',recordedAt:'2026-10-10 11:00:00'})]}),
    order('LS-20260722-001','h1','lin','2026-07-22',480000n,{history:true,unknownResults:true,originalAmount:500000n,payments:[receipt('LS-0722-OPEN',100000n,null,{type:'historical_opening',recordedAt:'2026-10-19 14:00:00',remark:'核实的历史累计；逐笔支付日期未知。'}),receipt('HK-0722-01',50000n,today,{status:'voided',recordedAt:today+' 09:00:00',voidedAt:today+' 09:05:00',reason:'回款金额误录，保留原记录后重录。'}),receipt('HK-0722-02',100000n,today,{recordedAt:today+' 09:10:00'})]}),
    order('CG-20260721-006','h2','lin','2026-07-21',800000n,{originalTerm:60,termChange:{at:'2026-09-01 10:00:00',reason:'按医院原约定核实本单为 90 天，单独更正本单。'},exception:{at:'2026-10-19 15:20:00',reason:'医院提出取消/退款请求，销售线下核实中，尚无退款结论。'},payments:[receipt('HK-0721-01',300000n,'2026-10-01')]}),
    order('CG-20260720-007','h1','lin','2026-07-20',600000n,{payments:[receipt('HK-0720-01',600000n,'2026-10-10',{recordedAt:'2026-10-10 13:00:00'})]}),
    order('CG-20260901-009','h3','lin','2026-09-01',110000n),
    order('CG-20260902-010','h4','zhou','2026-09-02',920000n),
    order('CG-20260720-011','h2','lin','2026-07-20',320000n,{payments:[receipt('HK-0720-11',50000n,'2026-10-18')]}),
    order('LS-20260801-003','h2','lin','2026-08-01',0n,{history:true,unknownResults:true})
  ];
  let role='lin',filters={},page=1,matches=[],detailId=null,proof=false,stale=false,pending=null,lastSuccess=null,sequence=1;
  const receipts=new Map();
  const readable=o=>!!o&&role!=='hospital'&&(role==='admin'||o.owner===role||hospitals[o.hospital].owner===role);
  const writable=o=>readable(o)&&role!=='admin'&&o.owner===role;
  const paid=o=>o.payments.filter(p=>p.status==='active').reduce((sum,p)=>sum+p.amount,0n),balance=o=>o.amount-paid(o),due=o=>dateAdd(o.received,o.term);
  function status(o){if(balance(o)===0n)return '已结清';const d=due(o);return d===today?'今日到期':d<today?'逾期 '+Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(d+'T00:00:00Z'))/86400000)+' 天':'未到期';}
  function facts(values,cls='review-facts'){const dl=el('dl',cls);values.forEach(([label,value])=>{const row=el('div');row.append(el('dt','',label),el('dd','',value));dl.append(row);});return dl;}
  function info(title,paragraphs){$('info-title').textContent=title;$('info-body').replaceChildren(...paragraphs.map(p=>el('p','audit-note',p)));$('info-dialog').showModal();}
  function showOperation(title,copy,failed=false,query=false){$('operation-result').hidden=false;$('operation-result').classList.toggle('failed',failed);$('operation-title').textContent=title;$('operation-copy').textContent=copy;$('query-result').hidden=!query;}
  function clearOperation(){$('operation-result').hidden=true;$('operation-title').textContent='';$('operation-copy').textContent='';$('query-result').hidden=true;}
  function resetForm(){proof=false;stale=false;pending=null;['payment-amount','payment-date','payment-remark','payment-error'].forEach(id=>{if('value' in $(id))$(id).value='';else $(id).textContent='';});clearOperation();}
  function resetFilters(){['hospital-filter','keyword','due-start','due-end'].forEach(id=>$(id).value='');$('owner-filter').value=role==='admin'?'all':'mine';$('state-filter').value='open';$('exception-filter').value='all';filters={owner:role==='admin'?'all':'mine',state:'open',exception:'all'};page=1;$('filter-error').textContent='';}
  function fillHospitals(){const ids=[...new Set(orders.filter(readable).map(o=>o.hospital))];$('hospital-filter').replaceChildren(el('option','','全部医院'));$('hospital-filter').firstChild.value='';ids.forEach(id=>{const node=el('option','',hospitals[id].name);node.value=id;$('hospital-filter').append(node);});}
  function isMatch(o){
    if(filters.owner==='mine'&&!writable(o)||filters.owner==='readonly'&&writable(o)||filters.hospital&&o.hospital!==filters.hospital)return false;
    if(filters.keyword&&!o.id.toLowerCase().includes(filters.keyword.toLowerCase()))return false;
    if(filters.start&&due(o)<filters.start||filters.end&&due(o)>filters.end)return false;
    const rest=balance(o),d=due(o),s=filters.state;
    if(s==='open'&&rest===0n||s==='settled'&&rest!==0n||s==='due'&&!(rest>0n&&d===today)||s==='overdue'&&!(rest>0n&&d<today)||s==='future'&&!(rest>0n&&d>today))return false;
    if(filters.exception==='paused'&&!o.exception||filters.exception==='normal'&&o.exception)return false;return true;
  }
  function query(){matches=orders.filter(readable).filter(isMatch).sort((a,b)=>due(a).localeCompare(due(b))||a.id.localeCompare(b.id));page=Math.max(1,Math.min(page,Math.ceil(matches.length/pageSize)||1));renderList();}
  function item(o,mobile=false){
    const action=button('查看与登记',()=>openDetail(o.id));action.dataset.order=o.id;if(!writable(o)||balance(o)===0n)action.textContent='查看明细';
    if(mobile){const article=el('article','ledger-item'),head=el('div','ledger-item-head'),identity=el('div');identity.append(el('div','hospital-name',hospitals[o.hospital].name),el('div','order-number',o.id));head.append(identity,el('span','tag',status(o)));const grid=el('div','ledger-item-facts');[['应收 / 元',money(o.amount)],['有效已收 / 元',money(paid(o))],['未收 / 元',money(balance(o))],['到期日',due(o)]].forEach(([label,value])=>{const cell=el('div');cell.append(el('small','',label),el('div','',value));grid.append(cell);});const foot=el('div','ledger-item-foot');foot.append(el('span',o.exception?'paused':'',names[o.owner]+' · '+(writable(o)?'本人负责':'只读')+(o.exception?' · 暂停催收':'')),action);article.append(head,grid,foot);return article;}
    const row=el('tr'),identity=el('td');identity.append(el('div','hospital-name',hospitals[o.hospital].name),el('div','order-number',o.id),el('div','ledger-minor',o.history?'历史补录 · 已核实':'报价已完成 · 最终 '+o.quoteVersion));
    const account=el('td');account.append(el('div','',due(o)),el('div','ledger-minor'+(balance(o)>0n&&due(o)<=today?' warn':''),status(o)));if(o.exception)account.append(el('div','ledger-minor paused','异常 · 暂停催收'));
    const owner=el('td');owner.append(el('div','',names[o.owner]),el('div','ledger-minor',writable(o)?'本人负责':'只读旧单'));const a=el('td');a.append(action);row.append(identity,el('td','amount-value',money(o.amount)),el('td','amount-value',money(paid(o))),el('td','amount-value outstanding',money(balance(o))),account,owner,a);return row;
  }
  function renderList(){
    $('identity').textContent=names[role]+(role==='admin'?' · 全量业务只读':'');$('owner-filter').disabled=role==='admin';$('scope-note').textContent=role==='admin'?'可查全量应收，业务只读。':'可查本人订单及当前负责医院的旧单；旧单操作仍归订单负责人。';
    $('result-count').textContent='符合筛选 '+matches.length+' 单';const values=[['应收合计',matches.reduce((sum,o)=>sum+o.amount,0n)],['有效已收合计',matches.reduce((sum,o)=>sum+paid(o),0n)],['未收余额合计',matches.reduce((sum,o)=>sum+balance(o),0n)]];
    $('ledger-totals').replaceChildren(...values.map(([label,value],i)=>{const part=el('div',i===2?'balance':'');part.append(el('small','',label+' / 元'),el('strong','',money(value)));return part;}));
    const slice=matches.slice((page-1)*pageSize,page*pageSize);$('ledger-body').replaceChildren(...slice.map(o=>item(o)));$('ledger-mobile').replaceChildren(...slice.map(o=>item(o,true)));$('ledger-body').closest('.ledger-scroll').classList.add('list-table');$('empty-state').hidden=matches.length!==0;$('page-count').textContent='第 '+page+' / '+(Math.ceil(matches.length/pageSize)||1)+' 页 · 每页 '+pageSize+' 单';$('previous').disabled=page===1;$('next').disabled=page*pageSize>=matches.length;
  }
  function getDetail(){const o=orders.find(o=>o.id===detailId);return readable(o)?o:null;}
  function openDetail(id){const o=orders.find(o=>o.id===id);if(!readable(o))return;detailId=id;resetForm();$('list-view').hidden=true;$('detail-view').hidden=false;renderDetail();window.scrollTo(0,0);$('detail-hospital').tabIndex=-1;$('detail-hospital').focus({preventScroll:true});}
  function summary(o){const values=[['应收金额',o.amount,o.history?'已核实历史最终金额':'医院最终确认 '+o.quoteVersion],['有效已收',paid(o),'仅有效回款；作废不计'],['未收余额',balance(o),balance(o)===0n?'已结清，停止提醒':'部分回款不改变到期日']];$('account-summary').replaceChildren(...values.map(([label,value,note],i)=>{const part=el('div',i===2?'outstanding':'');part.append(el('small','',label+' / 元'),el('strong','',money(value)),el('span','',note));return part;}));}
  function renderRecords(o){
    $('opening-note').hidden=!o.payments.some(p=>p.type==='historical_opening');$('opening-note').textContent='历史累计已收仅计一次；实际支付日期未知。后续登记不得重复包含这些旧款。';
    if(!o.payments.length){$('payment-records').replaceChildren(el('p','audit-note','尚无回款记录。'));return;}
    const wrap=el('div','ledger-scroll'),table=el('table','record-table'),thead=el('thead'),tr=el('tr'),tbody=el('tbody');['金额 / 类型','实际回款日期','录入与留痕','状态'].forEach(h=>tr.append(el('th','',h)));thead.append(tr);
    o.payments.forEach(p=>{const row=el('tr',p.status==='voided'?'voided':'');row.dataset.payment=p.id;const amount=el('td');amount.append(el('div','amount-value',money(p.amount)),el('small','',p.type==='historical_opening'?'历史累计已收':'逐笔回款'));const date=el('td','',p.paidDate||'未知（历史累计）'),audit=el('td');audit.append(el('div','',p.actor+' · '+p.recordedAt),el('small','',p.id));if(p.remark)audit.append(el('small','',p.remark));if(p.proof)audit.append(button('查看凭证说明',()=>info('虚构凭证',[p.proof+'；仅作原型展示，无真实文件或下载。'])));if(p.status==='voided')audit.append(el('small','',p.voidedAt+' · '+p.actor+' 作废；原因：'+p.reason));row.append(amount,date,audit,el('td','',p.status==='voided'?'已作废，不计入':'有效'));tbody.append(row);});table.append(thead,tbody);wrap.append(table);$('payment-records').replaceChildren(wrap);
  }
  function renderAudit(o){const nodes=[];function audit(title,copy){const row=el('div','audit-item');row.append(el('strong','',title),el('p','',copy));nodes.push(row);}
    audit(o.history?'历史纸单核实金额':'医院最终确认报价',o.history?'核实依据：医院采购员核对清单及对账记录。逐行确认和缺货结果未知，保留未知，不据 0 元推断全缺货。':'最终确认 '+o.quoteVersion+'，应收 '+money(o.amount)+' 元；后续未发送版本已作废，原文件和历史保留。');
    if(o.originalAmount!==undefined)audit('历史金额录入更正',money(o.originalAmount)+' → '+money(o.amount)+' 元；林销售 · 2026-10-20 08:30。依据医院电话对账更正误录，原金额保留；回款、到期日不变。');
    if(o.termChange)audit('本单账期调整',o.originalTerm+' → '+o.term+' 天；原到期日 '+dateAdd(o.received,o.originalTerm)+' → '+due(o)+'。林销售 · '+o.termChange.at+'；原因：'+o.termChange.reason);
    if(o.exception)audit('取消/退款待处理 · 暂停自动催收',o.exception.at+' · 林销售；'+o.exception.reason+'应收、已收和未收完整保留，不表示退款或应收冲销。');
    $('source-audit').replaceChildren(...nodes);
  }
  function renderDetail(){const o=getDetail();if(!o){closeDetail();return;}
    $('detail-number').textContent=o.id;$('detail-hospital').textContent=hospitals[o.hospital].name;$('detail-source').textContent=(o.history?'历史补录已核实':'医院最终报价已确认，报价流程已完成')+' · 当前订单负责人 '+names[o.owner];$('detail-state').textContent=status(o)+(o.exception?' · 暂停催收':'');
    $('detail-notice').textContent=!writable(o)?'此订单仅供当前账号查阅；回款登记仍由 '+names[o.owner]+' 处理。':o.exception?'异常仅暂停自动催收；可登记核实的新回款，登记不会解除异常。':balance(o)===0n?'本单已结清，停止提醒；原应收、回款和到期日继续保留。':'登记前请核对本单未收余额；报价完成后仍需继续跟进回款。';summary(o);
    const termValues=[['实际接收日',o.received],['原始账期',o.originalTerm+' 天'],['当前生效账期',o.term+' 天'],['到期日',due(o)],['当前订单负责人',names[o.owner]],['跟进状态',o.exception?'异常暂停':status(o)]];
    $('term-facts').className='term-facts';$('term-facts').replaceChildren(...termValues.map(([label,value])=>{const part=el('div');part.append(el('small','',label),el('strong','',value));return part;}));
    $('reminder-note').textContent=balance(o)===0n?'已结清，无待回款提醒。':o.exception?'异常暂停自动催收；仍在台账可查。新增回款或调整账期不自动解除异常。':due(o)>today?'未到期，暂未进入到期提醒；到期当天 00:00 起出现在到期列表。':'负责人 '+names[o.owner]+'：当日 09:00 起进入自动催收评估，逾期每日评估。样例微信未订阅，不影响站内待回款可查；本原型未发送通知。';
    renderRecords(o);renderAudit(o);renderForm();}
  function inputErrors(o){const errors=[],amount=cents($('payment-amount').value.trim()),date=$('payment-date').value;
    if(amount===null)errors.push('金额须为最多两位小数的十进制数，最大 9,999,999,999.99 元。');else if(amount<=0n)errors.push('本次回款金额必须大于 0。');else if(amount>balance(o))errors.push('金额超过当前未收 '+money(balance(o))+' 元，请核对金额或订单。');
    if(!validDate(date))errors.push('请填写有效的实际回款日期。');else if(date>today)errors.push('实际回款日期不能在未来。');return {errors,amount,date};}
  function renderForm(){const o=getDetail();if(!o)return;const waiting=!!pending,canWrite=writable(o)&&balance(o)>0n&&!waiting&&!stale;
    $('payment-fields').disabled=!canWrite;$('review-payment').disabled=!canWrite;$('review-payment').textContent=!writable(o)?'只读，无法登记':balance(o)===0n?'已结清':'复核并登记';$('refresh-account').hidden=!stale||!writable(o);
    $('back').disabled=waiting;$('demo-role').disabled=waiting;$('demo-outcome').disabled=waiting;$('replay').disabled=!lastSuccess||waiting||!writable(o);$('proof-state').textContent=proof?'已选虚构凭证：本次转账回单_示例.jpg':'未附凭证';$('proof-toggle').textContent=proof?'移除虚构凭证':'选用虚构凭证';$('amount-help').textContent='当前最多可登记 '+money(balance(o))+' 元。';$('payment-date').max=today;
    const amount=cents($('payment-amount').value.trim()),valid=amount!==null&&amount>0n&&amount<=balance(o);$('payment-impact').replaceChildren();[['当前未收',money(balance(o))+' 元'],['登记后未收',valid?money(balance(o)-amount)+' 元':'待核对金额']].forEach(([label,value])=>{const row=el('div');row.append(el('span','',label),el('strong','',value));$('payment-impact').append(row);});
  }
  function reviewPayment(event){event.preventDefault();const o=getDetail();if(!o||!writable(o)||pending||stale||balance(o)===0n)return;const {errors,amount,date}=inputErrors(o);$('payment-error').textContent=errors.join('\n');if(errors.length)return;
    const payload={requestId:'DEMO-HK-'+String(sequence++).padStart(4,'0'),id:o.id,version:o.version,actor:role,amount,date,remark:$('payment-remark').value.trim(),proof:proof?'本次转账回单_示例.jpg':null};$('review-dialog').payload=payload;
    $('review-body').replaceChildren(facts([['医院 / 订单',hospitals[o.hospital].name+' / '+o.id],['当前应收 / 已收',money(o.amount)+' / '+money(paid(o))+' 元'],['本次新回款',money(amount)+' 元'],['实际回款日期',date],['登记后未收',money(balance(o)-amount)+' 元'],['原到期日',due(o)+'（本次不改变）'],['记录人 / 系统时间',names[role]+' / '+recordedAt],['备注',payload.remark||'未填写'],['凭证',payload.proof||'未附凭证']]));if(o.exception)$('review-body').append(el('p','impact-note','当前暂停催收，回款入账后继续保持异常状态。'));if(o.history)$('review-body').append(el('p','impact-note','历史累计及已有有效回款已计入余额，请勿把它们再次登记为新回款。'));
    $('review-ack').checked=false;$('confirm-payment').disabled=true;$('review-dialog').showModal();
  }
  function closeDetail(){if(pending)return;$('detail-view').hidden=true;$('list-view').hidden=false;detailId=null;resetForm();$('demo-role').disabled=false;$('demo-outcome').disabled=false;query();window.scrollTo(0,0);}
  function applyPayment(payload){
    if(receipts.has(payload.requestId))return {ok:true,receipt:receipts.get(payload.requestId),replayed:true};
    const o=orders.find(o=>o.id===payload.id);if(!writable(o)||payload.actor!==role)return {ok:false,kind:'permission',message:'订单负责人已变化，当前账号无登记权限。未新增本次回款。'};
    if(o.version!==payload.version)return {ok:false,kind:'conflict',message:'订单余额已变化，本次未登记。请载入最新余额并重新复核，原输入保留。'};
    if(payload.amount<=0n||payload.amount>balance(o)||!validDate(payload.date)||payload.date>today)return {ok:false,kind:'invalid',message:'当前金额或日期不符合规则，本次未登记。'};
    const payment=receipt(payload.requestId,payload.amount,payload.date,{actor:names[role],recordedAt,remark:payload.remark,proof:payload.proof});o.payments.push(payment);o.version++;const result={id:o.id,paymentId:payment.id,amount:payload.amount,balance:balance(o),due:due(o),paused:!!o.exception};receipts.set(payload.requestId,result);return {ok:true,receipt:result};
  }
  function finish(result,payload){pending=null;if(result.ok){lastSuccess=payload;stale=false;$('payment-amount').value='';$('payment-date').value='';$('payment-remark').value='';proof=false;$('payment-error').textContent='';renderDetail();const r=result.receipt;showOperation(result.replayed?'原回执已找回，未重复登记':'本次回款已登记（演示）',r.paymentId+' · '+money(r.amount)+' 元；登记后未收 '+money(r.balance)+' 元。到期日仍为 '+r.due+(r.paused?'；异常暂停保持。':'。'));}else{stale=result.kind==='conflict';renderDetail();showOperation('本次未登记',result.message,true);}renderForm();}
  function confirmPayment(){const payload=$('review-dialog').payload;if(!payload||!$('review-ack').checked)return;$('review-dialog').close();$('review-dialog').payload=null;const outcome=$('demo-outcome').value;
    if(outcome==='failure'){showOperation('登记未成功','明确失败，未新增回款。输入已保留，可检查后重新复核。',true);return;}
    if(outcome==='unknown'){pending=payload;showOperation('本次结果待核对','暂不改动已收与余额。请核对同一请求结果，勿再次录入或换单重试。',false,true);renderForm();return;}
    const o=orders.find(o=>o.id===payload.id);
    if(outcome==='conflict'){const amount=balance(o)<10000n?balance(o):10000n;if(amount>0n){o.payments.push(receipt('OTHER-'+payload.requestId,amount,today,{recordedAt:today+' 09:59:59',remark:'演示：另一会话先登记的回款。'}));o.version++;}}
    if(outcome==='handoff'){o.owner=role==='lin'?'chen':'lin';o.version++;}
    finish(applyPayment(payload),payload);
  }
  $('filter-form').addEventListener('submit',event=>{event.preventDefault();const start=$('due-start').value,end=$('due-end').value;if(start&&(!validDate(start))||end&&(!validDate(end))||start&&end&&start>end){$('filter-error').textContent='请核对到期日范围，开始日不能晚于结束日。';return;}$('filter-error').textContent='';filters={owner:$('owner-filter').value,hospital:$('hospital-filter').value,state:$('state-filter').value,exception:$('exception-filter').value,start,end,keyword:$('keyword').value.trim()};page=1;query();});
  $('reset-filters').addEventListener('click',()=>{resetFilters();query();});$('previous').addEventListener('click',()=>{page--;renderList();});$('next').addEventListener('click',()=>{page++;renderList();});$('back').addEventListener('click',closeDetail);
  $('demo-role').addEventListener('change',()=>{if(pending)return;role=$('demo-role').value;detailId=null;resetForm();lastSuccess=null;['review-dialog','info-dialog'].forEach(id=>{if($(id).open)$(id).close();});$('review-dialog').payload=null;$('detail-view').hidden=true;$('list-view').hidden=false;$('account-summary').replaceChildren();$('payment-records').replaceChildren();$('source-audit').replaceChildren();$('business-content').hidden=role==='hospital';$('access-denied').hidden=role!=='hospital';$('identity').textContent=names[role];$('replay').disabled=true;fillHospitals();resetFilters();query();});
  $('payment-form').addEventListener('submit',reviewPayment);$('payment-amount').addEventListener('input',()=>{if(!pending){$('payment-error').textContent='';clearOperation();renderForm();}});$('payment-date').addEventListener('input',()=>{$('payment-error').textContent='';});$('proof-toggle').addEventListener('click',()=>{if($('payment-fields').disabled)return;proof=!proof;renderForm();});
  $('review-ack').addEventListener('change',()=>{$('confirm-payment').disabled=!$('review-ack').checked;});$('cancel-review').addEventListener('click',()=>{$('review-dialog').close();$('review-dialog').payload=null;});$('confirm-payment').addEventListener('click',confirmPayment);
  $('review-dialog').addEventListener('cancel',()=>{$('review-dialog').payload=null;});$('close-info').addEventListener('click',()=>$('info-dialog').close());
  $('query-result').addEventListener('click',()=>{if(!pending)return;const payload=pending;finish(applyPayment(payload),payload);});
  $('refresh-account').addEventListener('click',()=>{stale=false;$('demo-outcome').value='success';clearOperation();$('payment-error').textContent='已载入最新余额，请核对后再次打开复核。';renderDetail();});
  $('replay').addEventListener('click',()=>{if(!lastSuccess||pending)return;const o=orders.find(o=>o.id===lastSuccess.id);if(!writable(o))return;const result=receipts.get(lastSuccess.requestId);if(!result)return;info('同一请求原回执',[result.paymentId+' · '+money(result.amount)+' 元。该请求已成功，未再次新增回款。','原回执登记后余额 '+money(result.balance)+' 元；当前余额 '+money(balance(o))+' 元，以当前台账为准。']);});
  $('excluded').addEventListener('click',()=>info('尚无正式应收的订单',['本台账仅列正式应收，不列尚未确认报价或尚未核实的历史草稿。','明确全缺货完成单无应收；金额为 0 但逐行结果未知的已核实历史单可有 0 元应收，显示已结清，不推断全部缺货。','缺资料或原账期未知的历史纸单继续待核实，不用当前默认 90 天推算到期日。此处只解释入账范围，完整订单在历史档案中查阅。']));

  document.querySelectorAll('a[href]').forEach(a=>a.addEventListener('click',event=>{if(pending){event.preventDefault();info('先核对本次结果',['本次回款结果尚待核对，请先使用“核对本次结果”取得同一请求的结果，再继续切换页面。']);}}));
  if(location.protocol.startsWith('http'))document.querySelectorAll('a[href]').forEach(a=>{const href=a.getAttribute('href');if(!href.startsWith('/')&&!href.startsWith('#')&&!href.includes('://'))a.href='/files/'+href;});
  fillHospitals();resetFilters();query();
})();
