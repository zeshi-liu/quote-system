(() => {
  'use strict';
  const $=id=>document.getElementById(id),clone=x=>structuredClone(x),today='2026-10-20',clock='2026-10-20 10:00:00',max=999999999999n;
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const button=(text,fn,cls='btn text')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
  const money=n=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
  function decimal(value,positive=false){const s=value.trim();if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(s))return null;const [whole,fraction='']=s.split('.'),n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));return n>max||(positive?n<=0n:n<0n)?null:n;}
  function dateValue(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')return null;const n=Date.parse(value+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?n:null;}
  function dueDate(s){if(dateValue(s.received)===null||!/^\d+$/.test(s.term))return null;const days=Number(s.term);if(!Number.isSafeInteger(days)||days>2147483647)return null;const n=dateValue(s.received)+days*86400000;if(!Number.isFinite(n)||Math.abs(n)>8640000000000000)return null;const out=new Date(n).toISOString().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(out)?out:null;}
  const names={lin:'林销售',chen:'陈销售',admin:'内部管理员',hospital:'医院采购员'},hospitalNames={h2:'和济中医院',h5:'春和医院'};
  const fields={hospital:'hospital-id',paper:'paper-number',received:'received-date',term:'original-term',confirmed:'confirmed-date',handler:'original-handler',amount:'final-amount',opening:'opening-paid',basis:'verification-basis',note:'verification-note'};
  let root,attachments=[],role='lin',pending=null,review=null,lastSuccess=null,sequence=0,lineSequence=0,message=null,stale=false;
  const busy=()=>!!pending,canRead=()=>role!=='hospital',canWrite=()=>canRead()&&role===root.owner&&root.source==='history'&&root.phase==='draft';
  const emptyLine=()=>({drug:'',spec:'',quantity:'',supply:'unknown',confirmedQuantity:'',price:''});
  function seedData(){return {hospital:'h2',paper:'',received:'2026-07-22',term:'90',confirmed:'',handler:'',amount:'4800.00',opening:'1000.00',basis:'医院采购员电话核对的采购清单、对账金额及销售留存记录。',note:'原纸单已遗失；已核实药品、采购数量、实际接收日期、原账期、整单金额和累计已收。逐行确认结果及实际确认日期无法还原，保留未知。',attachments:[],lines:[{drug:'黄芪',spec:'斜片',quantity:'30.00',supply:'unknown',confirmedQuantity:'',price:''},{drug:'甘草',spec:'薄片',quantity:'8.00',supply:'unknown',confirmedQuantity:'',price:''},{drug:'当归',spec:'全归片',quantity:'15.00',supply:'unknown',confirmedQuantity:'',price:''}]};}
  function reset(){
    role=$('role').value;const mode=$('scenario').value,s=seedData();root={id:'LS-20260722-DEMO-001',source:'history',owner:'lin',phase:'draft',version:1,saved:null,createdAt:'2026-10-18 15:20:00',savedAt:'2026-10-18 15:20:00',verification:null,receivable:null,payment:null,orderCount:0};pending=null;review=null;lastSuccess=null;sequence=0;lineSequence=0;message=null;stale=false;
    if(mode==='incomplete'){s.term='';s.lines[1].quantity='';s.basis='';s.note='原纸单遗失，采购数量与当时约定账期仍需核对。';}
    if(mode==='new'){Object.keys(fields).forEach(key=>s[key]='');s.lines=[emptyLine()];root.id=null;root.createdAt=null;root.savedAt=null;root.version=0;}
    if(mode==='missing'){s.amount='0.00';s.opening='0.00';s.lines.forEach(line=>{line.supply='missing';line.confirmedQuantity='0.00';});s.note='采购需求齐全，医院已知悉所有药品均缺货；原材料核实为整单金额 0.00、未收款，不建立应收。';}
    if(mode==='zero'){s.amount='0.00';s.opening='0.00';s.note='整单最终金额已核实为 0.00，逐行确认结果未知；不能据此认定全部缺货。';}
    if(mode==='normal')root.source='normal';if(mode==='voided')root.phase='voided';if(mode!=='new')root.saved=clone(s);
    if(mode==='verified')finalize(s);
    $('outcome').value='success';clearErrors();applyForm(s);render();
  }
  function applyForm(s){Object.entries(fields).forEach(([key,id])=>$(id).value=s[key]);attachments=clone(s.attachments);$('lines').replaceChildren(...s.lines.map(line=>makeLine(line)));renderAttachments();}
  function collect(){const s={};Object.entries(fields).forEach(([key,id])=>s[key]=$(id).value);s.attachments=clone(attachments);s.lines=[...document.querySelectorAll('.line-row')].map(row=>{const value={};row.querySelectorAll('[data-field]').forEach(input=>value[input.dataset.field]=input.value);return value;});return s;}
  const dirty=()=>!root.saved||JSON.stringify(collect())!==JSON.stringify(root.saved);
  const allMissing=s=>s.lines.length>0&&s.lines.every(line=>line.supply==='missing');
  function makeLine(data){
    const index=++lineSequence,row=el('div','line-row');
    [['drug','药品 / 原品名','text'],['spec','原规格（选填）','text'],['quantity','采购量 / kg','decimal'],['supply','确认供货结果','select'],['confirmedQuantity','确认量 / kg（可未知）','decimal'],['price','最终单价 元/kg（可未知）','decimal']].forEach(([key,label,type])=>{
      const field=el('label','line-field',label),input=el(type==='select'?'select':'input');input.dataset.field=key;input.id='line-'+index+'-'+key;input.setAttribute('aria-label',label+' 第'+index+'行');
      if(type==='select')[['unknown','未知'],['priced','可供货'],['missing','缺货']].forEach(([value,text])=>{const option=el('option','',text);option.value=value;input.append(option);});else{input.type='text';if(type==='decimal')input.inputMode='decimal';input.placeholder=key==='quantity'?'必填':key==='price'||key==='confirmedQuantity'?'未知留空':'';}
      input.value=data[key];if(key==='supply')input.addEventListener('change',()=>{const quantity=row.querySelector('[data-field=confirmedQuantity]'),price=row.querySelector('[data-field=price]');if(input.value==='missing'){quantity.value='0.00';price.value='';}else if(input.value==='unknown')quantity.value='';render();});field.append(input);row.append(field);
    });
    const remove=button('×',()=>{if(!canWrite()||busy())return;row.remove();render();},'remove-line');remove.dataset.edit='true';remove.setAttribute('aria-label','删除第'+index+'行');row.append(remove);return row;
  }
  function validate(s,verify){
    const errors=[],add=(section,msg)=>errors.push({section,msg});if(!hospitalNames[s.hospital])add('资料','请选择允许补录的医院。');
    if(!s.received){if(verify)add('资料','实际接收日期必填。');}else if(dateValue(s.received)===null||s.received>today)add('资料','实际接收日期须合法且不能晚于演示今天。');
    if(s.term===''){if(verify)add('资料','原约定账期未知，需核实后填写；不能套用默认 90 天。');}else if(!/^\d+$/.test(s.term)||!Number.isSafeInteger(Number(s.term))||Number(s.term)>2147483647||(dateValue(s.received)!==null&&!dueDate(s)))add('资料','账期须为非负整数自然天，且到期日能在本页日历范围内表达。');
    if(s.confirmed&&(dateValue(s.confirmed)===null||s.confirmed>today))add('资料','实际确认/知悉日期须合法且不能在未来。');if(verify&&s.confirmed&&s.received&&s.confirmed<s.received)add('资料','实际确认/知悉日期不能早于实际接收日期。');
    if(verify&&!s.lines.length)add('明细','至少填写一味药及采购数量。');let lineSum=0n,knownAmounts=s.lines.length>0;
    s.lines.forEach((line,i)=>{
      const prefix='第 '+(i+1)+' 行：',quantity=decimal(line.quantity,true),confirmed=decimal(line.confirmedQuantity),price=decimal(line.price,true);
      if(verify&&!line.drug.trim())add('明细',prefix+'药品名称必填。');if(!line.quantity.trim()){if(verify)add('明细',prefix+'采购数量必填，单位 kg。');}else if(quantity===null)add('明细',prefix+'采购数量须为范围内正数，最多两位小数。');
      if(!['unknown','priced','missing'].includes(line.supply))add('明细',prefix+'供货结果不合法。');if(line.confirmedQuantity.trim()&&confirmed===null)add('明细',prefix+'确认数量须为范围内非负数，最多两位小数。');if(line.price.trim()&&price===null)add('明细',prefix+'已知最终单价须为范围内正数，最多两位小数。');
      if(verify&&line.supply==='unknown'&&line.confirmedQuantity.trim())add('明细',prefix+'供货结果未知时不填推定确认量。');if(verify&&quantity!==null&&confirmed!==null&&confirmed>quantity)add('明细',prefix+'确认数量不能超过采购数量。');
      if(line.supply==='missing'){if(verify&&(confirmed!==0n||line.price.trim()))add('明细',prefix+'明确缺货的确认量为 0、单价留空。');}
      else if(line.supply==='priced'&&price!==null&&confirmed!==null){const lineAmount=(price*confirmed+50n)/100n;lineSum+=lineAmount;if(verify&&lineAmount>max)add('金额',prefix+'已知行金额超过存储范围。');}else knownAmounts=false;
    });
    const amount=decimal(s.amount),opening=decimal(s.opening);
    [['amount','最终确认金额',amount],['opening','历史累计已收',opening]].forEach(([key,label,value])=>{if(!s[key].trim()){if(verify)add('金额',label+'必须明确填写，0 与未知不同。');}else if(value===null)add('金额',label+'须为范围内非负金额，最多两位小数。');});
    if(verify&&amount!==null&&opening!==null&&opening>amount)add('金额','历史累计已收超过最终金额，请核对，不能截断或自动增加应收。');if(verify&&allMissing(s)&&amount!==null&&amount!==0n)add('金额','所有行明确缺货时，已核实整单金额须为 0；有矛盾需先核对。');
    if(verify&&lineSum>max)add('金额','已知逐行金额合计超过存储范围。');else if(verify&&knownAmounts&&amount!==null&&lineSum!==amount)add('金额','已知行金额合计 '+money(lineSum)+' 元与最终金额不一致，请先核对。');else if(verify&&!knownAmounts&&amount!==null&&lineSum>amount)add('金额','已知行金额已超过整单最终金额，其他行未知也不能绕过矛盾核对。');
    if(verify&&!s.basis.trim())add('依据','核实依据必填；附件不能替代文字。');if(verify&&!s.note.trim())add('依据','核实说明必填；原单遗失也需说明。');return errors;
  }
  function clearErrors(){$('form-errors').hidden=true;$('form-errors').replaceChildren();}
  function showErrors(errors){$('form-errors').hidden=!errors.length;const list=el('ul');errors.forEach(error=>list.append(el('li','',typeof error==='string'?error:error.msg)));$('form-errors').replaceChildren(list);}
  function renderAttachments(){
    $('attachments').replaceChildren(...(attachments.length?attachments.map(file=>{const row=el('div','attachment-item'),name=el('div');name.append(el('strong','',file),el('small','','虚构佐证材料，仅在当前页面内使用'));const actions=el('div','attachment-actions'),view=button('查看样例',()=>{if(!canRead())return;info('虚构佐证材料',[el('p','info-note','示例对账资料：药品清单、实际接收日期及整单金额由销售与医院核实。本示例不是实际文件，不含真实医院数据，不上传或下载。')]);});view.dataset.view='true';const remove=button('移除',()=>{if(!canWrite()||busy())return;attachments=attachments.filter(value=>value!==file);renderAttachments();render();});remove.dataset.edit='true';actions.append(view,remove);row.append(name,actions);return row;}):[el('p','empty-attachments','暂无附件；纸单遗失时可填写核实依据与说明后办理。')]));
  }
  function coverage(s){const knownSupply=s.lines.filter(line=>line.supply!=='unknown').length,knownQuantity=s.lines.filter(line=>line.supply==='missing'||line.supply==='priced'&&line.confirmedQuantity.trim()).length;return {knownSupply,knownQuantity,text:'供货结果已知 '+knownSupply+' / '+s.lines.length+' 行；确认数量已知 '+knownQuantity+' / '+s.lines.length+' 行。'+(s.confirmed?'实际确认日期已填写。':'实际确认日期未知，不计入确认日期趋势。')};}
  function render(){
    const s=collect(),read=canRead(),write=canWrite(),blocking=busy(),verified=root.phase==='verified',errors=validate(s,true),amount=decimal(s.amount),opening=decimal(s.opening),due=dueDate(s),missing=allMissing(s),isDirty=dirty();
    $('business-content').hidden=!read;$('access-denied').hidden=read;$('identity').textContent=names[role]+(role==='chen'?(role===root.owner?' · 当前订单负责人':' · 医院交接后旧单只读'):role==='admin'?' · 全量业务只读':'');
    $('phase-label').textContent=verified?'已核实生效':root.phase==='voided'?'已作废':root.source==='normal'?'普通新单，不可核实':'待核实';$('record-identity').textContent=(root.id||'新记录 · 尚未保存')+' / 负责销售 '+names[root.owner]+' / '+(root.source==='history'?'专用历史来源':'正常业务来源')+' / 资料版本 '+root.version;
    $('state-notice').textContent=root.source!=='history'?'此记录是普通新单，须按正常询价与报价流程处理，不能通过历史核实跳过。':root.phase==='voided'?'记录已作废，只保留查阅；不能恢复核实或建立应收。':verified?'本次资料已核实封存，原金额、依据和实际日期不能直接覆盖。回款及历史金额录入更正使用后续专用页面。':!write?'本单由 '+names[root.owner]+' 负责，当前身份仅可查阅，不能保存、核实或代为修改。':stale?'资料版本已变化，本次提交未写入；保留当前输入，载入最新保存稿后重新核对。':'先保存草稿，再核实生效。未核实资料不计入台账、提醒和正式统计；原账期未知时保持待核实。';
    $('business-fields').disabled=!read||blocking;document.querySelectorAll('#business-fields input,#business-fields select,#business-fields textarea').forEach(input=>input.disabled=!write||blocking);
    document.querySelectorAll('.line-row').forEach(row=>{const supply=row.querySelector('[data-field=supply]').value;row.querySelector('[data-field=confirmedQuantity]').disabled=!write||blocking||supply!=='priced';row.querySelector('[data-field=price]').disabled=!write||blocking||supply==='missing';});document.querySelectorAll('[data-edit],#add-line,#add-attachment').forEach(b=>b.disabled=!write||blocking);document.querySelectorAll('[data-view]').forEach(b=>b.disabled=!read||blocking);
    $('save-draft').disabled=!write||blocking||stale;$('verify').disabled=!write||blocking||stale||!root.saved||isDirty;$('backfill-form').querySelector('.action-bar').hidden=!write;$('reload-saved').disabled=!root.saved||blocking||root.phase!=='draft';['scenario','role','outcome'].forEach(id=>$(id).disabled=blocking);$('replay').disabled=blocking||!lastSuccess||!read;
    $('save-state').textContent=verified?'已封存，只读':stale?'需要重新核对':isDirty?'尚有未保存资料':'当前资料已保存';$('save-help').textContent=isDirty?'保存当前资料后才能核实，不会直接创建应收。':'可补齐资料并再次保存；核实前会完整复核影响。';
    $('summary-title').textContent=verified?'已核实结果':'核实后预计结果';$('summary-status').textContent=verified?missing?'需求已纳入，无应收':'已纳入台账与需求统计':'尚未核实';
    const facts=[['最终金额',amount===null?'待核实':money(amount)+' 元'],['历史累计已收',opening===null?'待核实':money(opening)+' 元'],['未收余额',amount!==null&&opening!==null&&opening<=amount?money(amount-opening)+' 元':'待核对'],['原账期到期日',due||'待核实'],['应收记录',verified?root.receivable?'1 笔':'无（全部缺货）':missing?'核实后不建立':'核实成功后才建立']];$('summary-facts').replaceChildren(...facts.map(([label,value])=>{const row=el('div');row.append(el('span','',label),el('strong','',value));return row;}));
    $('summary-note').textContent=missing?'所有行明确缺货，核实完成不建 0 元应收。':amount===0n?'整单金额为 0 不等于全部缺货；未知逐行结果仍留空，不推算供货。':'金额以医院历史最终确认金额为准；未知单价不从整单金额倒推。';
    $('checklist').replaceChildren(...['资料','明细','金额','依据'].map(section=>{const group=errors.filter(e=>e.section===section);return el('li',group.length?'':'good',({资料:'医院、实际日期与原账期',明细:'药品、数量与已知行结果',金额:'最终金额与历史已收',依据:'核实依据及说明'})[section]+(group.length?' · '+group.length+' 项待核对':' · 已齐全'));}));$('coverage').textContent=coverage(s).text;$('audit').textContent='系统补录人：林销售 / '+(root.createdAt||'尚未保存')+'。最近保存：'+(root.savedAt||'尚无')+(root.verification?'；核实人：'+root.verification.actor+' / '+root.verification.at:'；尚未核实。');
    renderMessage();renderSuccess();
  }
  function renderMessage(){const result=pending?{title:pending.status==='unknown'?'本次结果待核对':'正在提交，请稍候',copy:pending.status==='unknown'?'只核对原请求，不重新提交或提前显示入账。':'本页尚未修改保存状态、核实或应收。'}:message;$('operation-result').hidden=!result;$('query-result').hidden=pending?.status!=='unknown';if(result){$('operation-title').textContent=result.title;$('operation-copy').textContent=result.copy;$('operation-result').classList.toggle('failed',!!result.failed);}}
  function renderSuccess(){
    $('success-result').hidden=root.phase!=='verified'||!canRead();if(root.phase!=='verified')return;const s=root.saved,ar=root.receivable,pay=root.payment,parts=[el('h3','',ar?'历史资料已核实，回款独立跟进':'历史资料已核实，全部缺货不建应收')],grid=el('div','result-grid');
    [['需求归期',s.received],['已核实订单次数','1 次'],['应收 / 已收 / 未收',ar?[ar.amount,pay?.amount||0n,ar.amount-(pay?.amount||0n)].map(money).join(' / ')+' 元':'不适用（全部缺货）'],['原账期 / 到期',s.term+' 天 / '+dueDate(s)],['核实人 / 时间',root.verification.actor+' / '+root.verification.at],['历史累计回款记录',pay?'1 条 / 实际逐笔日期未知':'0 条（未创建 0 元回款）']].forEach(([label,value])=>{const part=el('div');part.append(el('small','',label),el('strong','',value));grid.append(part);});parts.push(grid,el('p','',coverage(s).text+' 本次不生成厂家任务、普通报价版本或虚假发送记录。'),el('p','',ar?'应收仅关联本单已核实历史资料；后续新回款到台账逐笔登记。本页不发送催收消息，也不补发历史每日提醒。':'采购需求保留、确认可供货量为 0；本单不进入待回款。'));$('success-result').replaceChildren(...parts);
  }
  function finalize(s,actor=names.lin){
    if(root.phase==='verified')return;root.saved=clone(s);root.phase='verified';root.version++;root.verification={actor,at:clock,basis:s.basis.trim(),note:s.note.trim()};root.orderCount=1;
    root.receivable=allMissing(s)?null:{id:'AR-DEMO-001',amount:decimal(s.amount),due:dueDate(s)};root.payment=decimal(s.opening)>0n?{id:'PAY-DEMO-001',amount:decimal(s.opening),type:'historical_opening',paidDate:null,recordedAt:clock}:null;
  }
  function info(title,parts){if(!canRead())return;$('info-title').textContent=title;$('info-body').replaceChildren(...parts);$('info-dialog').showModal();}
  function reviewFacts(values){const list=el('dl','review-facts');values.forEach(([label,value])=>{const row=el('div');row.append(el('dt','',label),el('dd','',value));list.append(row);});return list;}
  function openReview(kind){
    if(!canRead()||busy())return;const s=kind==='verify'?clone(root.saved):clone(root.saved);review={kind,snapshot:s,version:root.version};$('review-ack').checked=false;$('confirm-operation').disabled=true;
    $('review-title').textContent=kind==='verify'?'核实历史资料并生效':'载入最新保存稿';$('confirm-operation').textContent=kind==='verify'?'确认核实':'确认载入';$('review-ack-copy').textContent=kind==='verify'?'我已核对医院、采购需求、原账期、金额及已有回款，确认以上依据与说明。':'我已核对，载入最新稿并放弃当前未保存输入。';
    if(kind==='reload'){$('review-body').replaceChildren(el('p','info-note','当前输入会被最新保存稿替换。资料版本 '+root.version+'；请载入后再次核对再提交。'));}
    else{
      const body=reviewFacts([['医院 / 记录',hospitalNames[s.hospital]+' / '+root.id],['实际接收 / 原账期',s.received+' / '+s.term+' 个自然日'],['到期日',dueDate(s)],['最终金额 / 已收 / 未收',[decimal(s.amount),decimal(s.opening),decimal(s.amount)-decimal(s.opening)].map(money).join(' / ')+' 元'],['核实依据',s.basis.trim()],['核实说明',s.note.trim()],['原经办人',s.handler.trim()||'未知，不伪造'],['材料',s.attachments.length?s.attachments.join('、'):'无附件，保留文字核实记录'],['核实人 / 系统时间',names[role]+' / '+clock]]),wrap=el('div','review-lines-wrap'),table=el('table','review-lines'),head=el('tr');['药品','采购量 kg','供货结果','确认量 kg'].forEach(t=>head.append(el('th','',t)));const thead=el('thead');thead.append(head);table.append(thead);const tbody=el('tbody');s.lines.forEach(line=>{const row=el('tr');[line.drug,line.quantity,{unknown:'未知',priced:'可供货',missing:'缺货'}[line.supply],line.confirmedQuantity||'未知'].forEach(t=>row.append(el('td','',t)));tbody.append(row);});table.append(tbody);wrap.append(table);
      $('review-body').replaceChildren(body,wrap,el('div','impact-note',allMissing(s)?'本单所有行明确缺货：计一次需求，不建应收，不建 0 元回款。':'核实后封存本次资料、计一次需求并建立一笔应收。'+(decimal(s.opening)>0n?'仅建立一条历史累计已收，逐笔支付日期保留未知。':'历史累计已收为 0，不创建 0 元回款记录。')),el('p','info-note',coverage(s).text+' 核实后不直接覆盖原资料；本页所有结果均为虚构演示。'));
    }
    $('review-dialog').showModal();
  }
  function start(kind,snapshot,version){if(!root.saved&&['conflict','handoff'].includes($('outcome').value)){showErrors(['请先正常保存新建草稿，再演示既有记录的版本或负责人变化。']);return;}const operation={id:'OP'+String(++sequence).padStart(3,'0'),kind,snapshot:clone(snapshot),version,status:'pending',outcome:$('outcome').value};pending=operation;message=null;clearErrors();render();setTimeout(()=>{if(pending!==operation)return;if(operation.outcome==='unknown'){operation.status='unknown';render();}else settle(operation);},400);}
  function settle(operation){
    if(pending!==operation)return;const failures=[];
    if(operation.outcome==='conflict'){root.version++;if(root.saved)root.saved.note+='（演示：另一会话已补充核实说明）';stale=true;}
    if(operation.outcome==='handoff'){root.owner='chen';lastSuccess=null;}
    if(operation.outcome==='failure')failures.push('演示明确失败，未保存或核实；原输入保留。');if(!canWrite())failures.push('当前身份、订单负责人或来源状态已不允许本次操作。');if(operation.version!==root.version)failures.push('资料版本已变化，本次未写入；需载入最新保存稿重新核对。');failures.push(...validate(operation.snapshot,operation.kind==='verify').map(e=>e.msg));
    if(failures.length){pending=null;message={title:'本次提交未成功',copy:failures.join(' '),failed:true};render();return;}
    if(operation.kind==='save'){root.saved=clone(operation.snapshot);root.id||='LS-DEMO-NEW-001';root.createdAt||=clock;root.savedAt=clock;root.version++;}
    else finalize(operation.snapshot,names[role]);
    lastSuccess={id:operation.id,kind:operation.kind,version:root.version};pending=null;message={title:operation.kind==='save'?'草稿已保存（演示）':'历史资料已核实（演示）',copy:operation.id+' / '+(operation.kind==='save'?'仅存档，不创建应收或回款。':'本单只核实一次，保存核实人、时间及本次依据。')};applyForm(root.saved);render();
  }
  $('backfill-form').addEventListener('input',()=>{if(!busy()){clearErrors();render();}});
  $('backfill-form').addEventListener('change',()=>{if(!busy()){clearErrors();render();}});
  $('save-draft').addEventListener('click',()=>{if(!canWrite()||busy()||stale)return;const s=collect(),errors=validate(s,false);showErrors(errors);if(!errors.length)start('save',s,root.version);});
  $('backfill-form').addEventListener('submit',event=>{event.preventDefault();if(!canWrite()||busy()||stale)return;if(!root.saved||dirty()){showErrors(['请先保存本次资料，再核实。']);return;}const errors=validate(root.saved,true);showErrors(errors);if(!errors.length)openReview('verify');});
  $('add-line').addEventListener('click',()=>{if(!canWrite()||busy())return;$('lines').append(makeLine(emptyLine()));render();});
  $('add-attachment').addEventListener('click',()=>{if(!canWrite()||busy())return;const name='虚构医院对账佐证.txt';if(attachments.includes(name)){info('材料已存在',[el('p','info-note','同一虚构附件只列一次，不因重复选择增加订单、应收或回款。')]);return;}attachments.push(name);renderAttachments();render();});
  $('reload-saved').addEventListener('click',()=>{if(root.saved&&!busy()&&root.phase==='draft')openReview('reload');});
  $('review-ack').addEventListener('change',()=>{$('confirm-operation').disabled=!$('review-ack').checked;});
  $('cancel-review').addEventListener('click',()=>{review=null;$('review-dialog').close();});$('review-dialog').addEventListener('cancel',()=>{review=null;});
  $('confirm-operation').addEventListener('click',()=>{if(!$('review-ack').checked||!review||busy())return;const payload=review;review=null;$('review-dialog').close();if(payload.kind==='reload'){applyForm(root.saved);stale=false;clearErrors();message={title:'已载入最新保存稿',copy:'请重新核对当前资料，再决定保存或核实。'};render();return;}start('verify',payload.snapshot,payload.version);});
  $('query-result').addEventListener('click',()=>{const operation=pending;if(!operation||operation.status!=='unknown')return;operation.status='querying';render();setTimeout(()=>settle(operation),250);});
  $('replay').addEventListener('click',()=>{if(!lastSuccess||busy()||!canRead())return;message={title:'已返回原成功结果',copy:lastSuccess.id+' / 原资料版本 '+lastSuccess.version+'。未新增核实、应收、回款或订单次数。'};render();});
  $('scenario').addEventListener('change',reset);$('role').addEventListener('change',()=>{role=$('role').value;lastSuccess=null;if($('info-dialog').open)$('info-dialog').close();if(root.saved)applyForm(root.saved);clearErrors();render();});$('close-info').addEventListener('click',()=>$('info-dialog').close());
  if(location.protocol==='http:'||location.protocol==='https:')document.querySelectorAll('a[href]').forEach(a=>{const href=a.getAttribute('href');if(/^[a-z][a-z0-9-]*\.html(?:#.*)?$/.test(href))a.setAttribute('href','/files/'+href);});
  reset();
})();
