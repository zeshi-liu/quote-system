(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const today = '2026-10-16';
  const names = {a:'甲厂',b:'乙厂'};
  const purchase = [
    {id:'l1',name:'黄芪',raw:'黄芪',spec:'斜片',qty:3000n},
    {id:'l2',name:'甘草',raw:'甘草',spec:'薄片',qty:800n},
    {id:'l3',name:'当归',raw:'当归',spec:'全归片',qty:1500n},
    {id:'l4',name:'党参',raw:'党参',spec:'段',qty:2000n},
    {id:'l5',name:'白术',raw:'白术',spec:'',qty:1250n,custom:true}
  ];
  const sampleA = [3850n,1780n,9200n,5650n,null];
  const sampleB = [3700n,1800n,9050n,5580n,2620n];
  let latest, adopted, rows, mode, selected, logs, undo, pendingAction, activeIndex = null, dirty = false;
  let hospitalUntil = '', manualUntil = false;
  const clone = value => structuredClone(value);
  const el = (tag, cls, text) => {const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const button = (text, action, cls='btn text') => {const b=el('button',cls,text);b.type='button';b.addEventListener('click',action);return b;};
  const money = cents => cents===null?'—':(cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
  const round = (numerator, denominator) => (numerator+denominator/2n)/denominator;
  function decimal(value, positive=true){
    if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(value))return null;
    const [whole,fraction='']=value.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
    return (positive?cents>0n:cents>=0n)&&cents<=999999999999n?cents:null;
  }
  const writable = () => mode!=='frozen';
  const usable = task => task.status==='submitted'&&task.until>=today;
  const sameTask = key => adopted[key].submission===latest[key].submission&&adopted[key].status===latest[key].status&&adopted[key].until===latest[key].until;
  const hasDelta = () => !sameTask('a')||!sameTask('b');
  const sourceCurrent = base => !!base&&usable(latest[base.supplier])&&latest[base.supplier].submission===base.submission&&latest[base.supplier].prices[base.index]===base.price;
  function choices(index){return ['a','b'].filter(key=>sameTask(key)&&usable(adopted[key])&&adopted[key].prices[index]!==null);}
  function lowest(index, source=latest){const prices=['a','b'].filter(key=>usable(source[key])&&source[key].prices[index]!==null).map(key=>({supplier:key,price:source[key].prices[index]}));return prices.sort((x,y)=>x.price<y.price?-1:x.price>y.price?1:0)[0]||null;}
  function baseFor(index,key){const task=adopted[key];return {index,supplier:key,submission:task.submission,price:task.prices[index],until:task.until};}
  function currentKind(index){
    const bothMissing=['a','b'].every(key=>sameTask(key)&&usable(latest[key])&&latest[key].prices[index]===null);
    if(bothMissing)return 'missing';
    if(rows[index].base)return sourceCurrent(rows[index].base)?'priced':'invalid';
    return 'waiting';
  }
  const isLoss = row => {const value=decimal(row.final);return value!==null&&sourceCurrent(row.base)&&value<row.base.price;};
  function rowRisk(index){const row=rows[index],kind=currentKind(index);if(kind==='waiting')return '待厂家结果 / 待采用';if(kind==='invalid')return '基准失效，需重新选择';if(kind==='missing')return '两家明确缺货';if(isLoss(row))return '低于基准价';if(purchase[index].custom)return '自定义品名，请核对';return '';}
  function taskText(task,index){if(task.status!=='submitted')return task.status==='pending'?'待完整提交':'重新询价中';if(task.until<today)return '价格已过期';return task.prices[index]===null?'无法供货':money(task.prices[index]);}
  function record(text){logs.unshift({time:'10:00（演示）',text});}
  function feedback(text,error=false){$('feedback').textContent=text;$('feedback').classList.toggle('error',error);}
  function changed(clearUndo=true){dirty=true;if(clearUndo)undo=null;}
  function calculate(row){
    if(!sourceCurrent(row.base))return null;
    const parameter=decimal(row.parameter,false);if(parameter===null)return null;
    let result=null;
    if(row.method==='fixed')result=row.base.price+parameter;
    if(row.method==='percent')result=round(row.base.price*(10000n+parameter),10000n);
    if(row.method==='multiple'&&parameter>=100n)result=round(row.base.price*parameter,100n);
    return result!==null&&result>0n&&result<=999999999999n?result:null;
  }
  function parameterError(method,value){
    if(!['fixed','percent','multiple'].includes(method))return '请选择固定金额、比例加价或高开倍率。';
    const n=decimal(value,false);if(n===null)return '参数须为非负数字，最多两位小数，且在字段精度范围内。';
    if(method==='multiple'&&n<100n)return '高开倍率不能小于 1.00。';
    return '';
  }
  function setBase(index,choice){
    const row=rows[index],old=row.base?row.base.supplier+'|'+row.base.submission+'|'+row.base.price:'';
    row.selection=choice;const permitted=choices(index),key=choice==='auto'?permitted.sort((a,b)=>adopted[a].prices[index]<adopted[b].prices[index]?-1:adopted[a].prices[index]>adopted[b].prices[index]?1:0)[0]:permitted.includes(choice)?choice:null;
    row.base=key?baseFor(index,key):null;const now=row.base?row.base.supplier+'|'+row.base.submission+'|'+row.base.price:'';
    if(old!==now){row.confirmed=false;row.lossReason='';row.lossAcknowledged=false;row.recommended=calculate(row);}
    return old!==now;
  }
  function capDate(){const limits=rows.filter((row,index)=>currentKind(index)==='priced').map(row=>row.base.until);return limits.sort()[0]||'';}
  function syncDate(){const cap=capDate();if(purchase.every((_,i)=>currentKind(i)==='missing'))hospitalUntil='';else if(!manualUntil||hospitalUntil>cap)hospitalUntil=cap;}
  function reset(){
    mode=$('scenario').value;latest={a:{status:'submitted',submission:'a-s1',until:'2026-10-20',prices:clone(sampleA)},b:{status:mode==='one'?'pending':'submitted',submission:mode==='one'?null:'b-s1',until:'2026-10-19',prices:clone(sampleB)}};
    if(mode==='missing')latest.a.prices=latest.b.prices=[null,null,null,null,null];
    if(mode==='expired'){latest.a.until='2026-10-15';latest.b.until='2026-10-15';}
    adopted=clone(latest);rows=purchase.map((_,index)=>({base:null,selection:'auto',method:'',parameter:'',recommended:null,final:'',confirmed:false,lossReason:'',lossAcknowledged:false}));
    rows.forEach((row,index)=>{const best=lowest(index,adopted);if(best)row.base=baseFor(index,best.supplier);});
    if(mode==='expired')rows.forEach((row,index)=>{row.base=baseFor(index,index===4?'b':'a');row.final=money((row.base.price||0n)+300n);});
    if(mode==='frozen')rows.forEach(row=>{if(row.base){row.method='fixed';row.parameter='3.00';row.recommended=row.base.price+300n;row.final=money(row.recommended);row.confirmed=true;}});
    selected=new Set();logs=[];undo=null;pendingAction=null;activeIndex=null;dirty=false;manualUntil=false;hospitalUntil='';syncDate();$('search').value='';$('risk-filter').value='all';$('batch-method').value='';$('batch-parameter').value='';$('batch-scope').value='selected';$('batch-unit').textContent='';feedback('');render();
  }
  function visibleIndexes(){const term=$('search').value.trim().toLowerCase(),filter=$('risk-filter').value;return purchase.map((_,i)=>i).filter(i=>{
    if(term&&!(purchase[i].name+' '+purchase[i].spec).toLowerCase().includes(term))return false;
    if(filter==='unconfirmed')return currentKind(i)!=='missing'&&!rows[i].confirmed;
    if(filter==='risk')return !!rowRisk(i);
    return filter!=='missing'||currentKind(i)==='missing';
  });}
  function selectRow(index,value){if(value)selected.add(index);else selected.delete(index);render();}
  function buildRow(index,mobile=false){
    const line=purchase[index],row=rows[index],kind=currentKind(index),risk=rowRisk(index),value=decimal(row.final),best=lowest(index),valid=sourceCurrent(row.base);
    const check=el('input');check.type='checkbox';check.checked=selected.has(index);check.disabled=!writable();check.setAttribute('aria-label','选择 '+line.name);check.addEventListener('change',()=>selectRow(index,check.checked));
    const open=button(line.name,()=>openLine(index),'name-button');
    const status=kind==='missing'?'缺货行':kind==='waiting'?'待厂家结果':kind==='invalid'?'基准已失效':row.confirmed?'最终价已确认':'待确认最终价';
    if(mobile){const card=el('section','mobile-line');const top=el('div','mobile-line-top'),description=el('div');description.append(open,el('div','secondary-line',line.spec||'规格未提供'));top.append(check,description,el('div','qty',money(line.qty)+' kg'));const values=el('div','mobile-values');[['基准',row.base?names[row.base.supplier]+' '+money(row.base.price):'—'],['推荐',money(row.recommended)],['最终',kind==='missing'?'缺货':money(value)]].forEach(([label,text])=>{const part=el('div','',text);part.prepend(el('span','',label));values.append(part);});const bottom=el('div','mobile-line-bottom');bottom.append(el('span','state-label'+(row.confirmed?' confirmed':''),status),button(writable()?'查看并计价':'查看冻结行',()=>openLine(index)));card.append(top,values);if(risk)card.append(el('div','secondary-line alert',risk));card.append(bottom);return card;}
    const tr=el('tr',selected.has(index)?'row-selected':'');tr.dataset.lineId=line.id;const cell=(cls,text)=>{const td=el('td',cls,text);tr.append(td);return td;};cell('check-col').append(check);const drug=cell('drug-cell');drug.append(open,el('div','secondary-line',(line.spec||'规格未提供')+' · '+money(line.qty)+' kg'));
    for(const key of ['a','b']){const td=cell('money',taskText(latest[key],index));td.append(el('div','secondary-line',latest[key].status==='submitted'?latest[key].until+' 到期':'不等于缺货'));}
    cell('money lowest',best?money(best.price):'—');const base=cell('base-cell');base.append(el('div','money'+(row.base&&!valid?' danger':''),row.base?names[row.base.supplier]+' '+money(row.base.price):'—'),el('div','secondary-line',row.base?(row.selection==='auto'?'自动选择':'手工选择')+' · 提交 S1':kind==='missing'?'双厂家缺货，无基准':'尚无有效基准'));
    const history=historyFor(index)[0],historyCell=cell('');historyCell.append(el('div','money',history?money(history.price):'无精确匹配'),button(history?'最近 3 张采购单':'查看匹配说明',()=>showHistory(index),'history-button'));
    const rec=cell('money',money(row.recommended));rec.append(el('div','secondary-line',kind==='missing'?'缺货行不加价':row.method?methodLabel(row.method)+(row.parameter?' '+row.parameter:''):'未设置加价'));
    const final=cell('money final',kind==='missing'?'—':money(value));if(value!==null&&row.base){const difference=value-row.base.price;final.append(el('div','secondary-line'+(difference<0n?' danger':''),(difference<0n?'−':'+')+money(difference<0n?-difference:difference)+' / '+rateText(difference,row.base.price)));}
    const state=cell('status-cell');state.append(el('div','state-label'+(row.confirmed?' confirmed':''),status));if(risk)state.append(el('div','secondary-line alert',risk));state.append(button(writable()?'计价 / 确认':'查看',()=>openLine(index)));return tr;
  }
  function render(){
    const indexes=visibleIndexes();$('pricing-body').replaceChildren(...indexes.map(i=>buildRow(i)));$('mobile-lines').replaceChildren(...indexes.map(i=>buildRow(i,true)));$('empty-filter').hidden=indexes.length>0;$('filter-count').textContent='显示 '+indexes.length+' / 5 行';$('selection-count').textContent='已选 '+selected.size+' 行';$('select-visible').checked=indexes.length>0&&indexes.every(i=>selected.has(i));$('select-visible').indeterminate=indexes.some(i=>selected.has(i))&&!$('select-visible').checked;
    $('supplier-strip').replaceChildren(...['a','b'].map(key=>{const task=latest[key],part=el('div');part.append(el('strong','',names[key]+' · '+(task.status==='submitted'?'已完整提交':task.status==='pending'?'待提交':'重新询价中')),el('small','',task.status==='submitted'?'报价有效至 '+task.until+(task.until<today?'（已过期）':'（含当日）'):'不使用未提交价格'));return part;}));
    $('version-tag').textContent=writable()?'V1 草稿':'V1 已导出 · 只读';$('readonly-notice').hidden=writable();$('late-notice').hidden=!hasDelta()||!writable();$('late-notice').querySelector('strong').textContent=latest.a.status==='requote'?'厂家状态变化，原基准不可继续使用':'有后到报价，草稿尚未采用';$('late-copy').textContent='最新厂家结果与本草稿快照不同。最终价格保留，基准变化的行需重新确认。';$('log-count').textContent=String(logs.length);
    const priced=purchase.filter((_,i)=>currentKind(i)==='priced').length,confirmed=rows.filter((r,i)=>currentKind(i)==='priced'&&r.confirmed).length,missing=purchase.filter((_,i)=>currentKind(i)==='missing').length,blocked=purchase.filter((_,i)=>['waiting','invalid'].includes(currentKind(i))).length;
    $('confirmation-progress').textContent=missing===5?'5 / 5 行均为双厂家明确缺货':confirmed+' / '+priced+' 行最终价已确认'+(missing?' · '+missing+' 行缺货':'');$('readiness').textContent=blocked?'有 '+blocked+' 行待厂家结果或基准失效，整单不能预览导出。':confirmed<priced?'推荐价需主动应用或手工填写，再逐行确认最终价。':missing===5?'保留全部缺货行，不设价格有效期，不产生应收。':'全部有价行已确认；预览前仍需校验有效期和风险。';
    let total=0n,known=0;rows.forEach((r,i)=>{const n=decimal(r.final);if(n!==null&&currentKind(i)!=='missing'){total+=round(n*purchase[i].qty,100n);known++;}});$('subtotal').textContent=missing===5?'本单全部缺货':known?'¥ '+money(total):'—';$('subtotal-label').textContent=missing===5?'供货结果':'当前已填 '+known+' 行小计';$('total-help').textContent=missing===5?'不以 0 元供货表达，不建立应收':'已填金额不等于医院已确认金额或应收';
    const cap=capDate();$('hospital-valid-until').value=hospitalUntil;$('hospital-valid-until').max=cap||today;$('hospital-valid-until').disabled=!writable()||missing===5;$('validity-help').textContent=missing===5?'全缺货报价不设价格有效期。':cap?'上限 '+cap+'：所选有效基准最早到期日，可缩短不可延长。':'暂无合法有效期上限，须先选择当前有效基准。';
    ['batch-scope','batch-method','batch-parameter','batch-calculate','batch-apply','select-visible','save-draft'].forEach(id=>$(id).disabled=!writable());$('undo-batch').disabled=!writable()||!undo;$('late-demo').disabled=!writable()||latest.b.status!=='pending';$('requery-demo').disabled=!writable()||latest.a.status!=='submitted';
  }
  function methodLabel(value){return {fixed:'固定金额',percent:'比例加价',multiple:'高开倍率',manual:'手工改价'}[value]||'';}
  function rateText(delta,base){if(!base)return '—';return (Number(delta)*100/Number(base)).toFixed(2)+'%';}
  function showInfo(title,parts){$('info-title').textContent=title;$('info-body').replaceChildren(...parts);$('info-dialog').showModal();}
  function historyFor(index){
    if(purchase[index].custom)return [];
    const reference=[4000n,2000n,9600n,6000n][index];
    return [{order:'CG-20260928-000012',date:'2026-09-28',version:'V2 · 已确认优先',price:reference},{order:'CG-20260912-000008',date:'2026-09-12',version:'V3 · 最近已发送',price:reference-100n},{order:'CG-20260831-000003',date:'2026-08-31',version:'V1 · 已确认优先',price:index===2?null:reference+100n}];
  }
  function showHistory(index){
    const records=historyFor(index),note=el('p','history-note','杏林医院 · 同药品规格与 kg 精确匹配；每张采购单仅占一条。已确认优先，否则取最近已发送且未作废版；历史价格仅供参考，不带入本次价格。');
    if(!records.length){showInfo(purchase[index].name+' · 历史报价',[note,el('p','history-note','本行是自定义品名，未找到精确匹配。不能借相似品名自动引用历史价格。')]);return;}
    const table=el('table','history-table'),head=el('tr');['采购单 / 日期','代表版本','单价 / 本次差额'].forEach(text=>head.append(el('th','',text)));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');records.forEach(record=>{const tr=el('tr'),order=el('td','',record.order);order.append(el('div','secondary-line',record.date));tr.append(order,el('td','',record.version));const current=decimal(rows[index].final),value=el('td','',record.price===null?'缺货（无单价）':money(record.price)+' 元/kg');if(record.price!==null&&current!==null){const difference=current-record.price;value.append(el('div','secondary-line','本次 '+(difference>=0n?'+':'−')+money(difference<0n?-difference:difference)+' / '+rateText(difference,record.price)));}tr.append(value);body.append(tr);});table.append(body);showInfo(purchase[index].name+' · 最近 3 张采购单',[note,table]);
  }
  function action(title,copy,details,perform,acknowledgement=''){
    pendingAction=perform;$('action-title').textContent=title;$('action-copy').textContent=copy;$('action-details').replaceChildren(...details);$('action-confirm').disabled=!!acknowledgement;
    if(acknowledgement){const label=el('label','ack'),input=el('input');input.type='checkbox';input.id='action-ack';input.addEventListener('change',()=>{$('action-confirm').disabled=!input.checked;});label.append(input,el('span','',acknowledgement));$('action-details').append(label);}
    $('action-dialog').showModal();
  }
  function openLine(index){activeIndex=index;renderEditor();$('line-dialog').showModal();}
  function renderEditor(){
    const index=activeIndex,line=purchase[index],row=rows[index],kind=currentKind(index),editable=writable()&&kind==='priced';
    $('line-title').textContent=line.name+' · '+money(line.qty)+' kg';const target=$('line-content');target.replaceChildren();
    target.append(el('div','line-meta','原始品名：'+line.raw+' / 冻结规格：'+(line.spec||'未提供')+' / 单位：kg'));
    if(line.custom)target.append(el('div','notice','本行按采购校对保留自定义品名，请核对“'+line.name+'”与空规格；没有精确历史价。'));
    const facts=el('dl','price-facts'),best=lowest(index);
    [['甲厂最新',taskText(latest.a,index)],['乙厂最新',taskText(latest.b,index)],['实时最低价',best?money(best.price)+' 元/kg':'无有效价格'],['已采用基准',row.base?names[row.base.supplier]+' '+money(row.base.price):'尚未采用'],['本行推荐价',money(row.recommended)],['本行最终价',money(decimal(row.final))]].forEach(([label,value],position)=>{const part=el('div');part.append(el('dt','',label));const dd=el('dd','',value);if(position===4)dd.id='fact-recommended';if(position===5)dd.id='fact-final';part.append(dd);facts.append(part);});target.append(facts);
    const history=button('查看本院最近 3 张采购单 →',()=>showHistory(index));target.append(history);
    if(kind==='missing'){target.append(el('div','notice','两家当前有效提交均明确无法供货。本行保留 '+money(line.qty)+' kg 采购需求，基准、推荐价、最终价及金额留空。'));return;}
    if(kind==='waiting')target.append(el('div','notice','尚无可采用的有效价格，也未获得两家明确缺货结论。等待厂家提交或主动刷新采用，不能删行跳过。'));
    if(kind==='invalid')target.append(el('div','notice','原基准已过期或被重询，不能继续使用。最终价格值保留；请改选另一有效厂家或取得新报价后刷新。'));
    const baseField=el('div','editor-field'),label=el('label','','草稿基准厂家');label.htmlFor='editor-base';const select=el('select');select.id='editor-base';const permitted=choices(index);
    const auto=el('option','','自动选择本草稿已采用的最低有效价');auto.value='auto';auto.disabled=!permitted.length;select.append(auto);
    ['a','b'].forEach(key=>{const option=el('option','',names[key]+(permitted.includes(key)?' · '+money(adopted[key].prices[index])+' 元/kg':' · 当前不可选'));option.value=key;option.disabled=!permitted.includes(key);select.append(option);});select.value=row.selection;select.disabled=!writable()||!permitted.length;
    select.addEventListener('change',()=>{const before=row.base?names[row.base.supplier]+' '+money(row.base.price):'无';const didChange=setBase(index,select.value);changed();syncDate();record(line.name+'：基准由 '+before+' 改为 '+(row.base?names[row.base.supplier]+' '+money(row.base.price):'无')+(didChange?'，保留最终价并取消本行确认。':'，记录为手工/自动选择。'));render();renderEditor();});baseField.append(label,select,el('p','editor-help','后到报价需先刷新采用；手工选择不会被更低的后到价自动替换。'));target.append(baseField);
    const methodPair=el('div','method-pair'),methodField=el('div','editor-field'),methodLabelNode=el('label','','加价方式');methodLabelNode.htmlFor='editor-method';const method=el('select');method.id='editor-method';[['','请选择'],['fixed','固定金额'],['percent','比例加价'],['multiple','高开倍率'],['manual','手工改价']].forEach(([value,text])=>{const option=el('option','',text);option.value=value;method.append(option);});method.value=row.method;method.disabled=!editable;
    method.addEventListener('change',()=>{row.method=method.value;row.parameter='';row.recommended=null;changed();render();renderEditor();});methodField.append(methodLabelNode,method);methodPair.append(methodField);
    const parameterField=el('div','editor-field'),parameterLabel=el('label','',row.method==='percent'?'比例（%）':row.method==='multiple'?'倍率（至少 1.00）':'每 kg 加价（元）');parameterLabel.htmlFor='editor-parameter';const parameter=el('input');parameter.id='editor-parameter';parameter.inputMode='decimal';parameter.placeholder='默认空';parameter.value=row.parameter;parameter.disabled=!editable||!row.method||row.method==='manual';parameter.addEventListener('input',()=>{row.parameter=parameter.value;row.recommended=null;changed();$('editor-recommended').textContent='—';$('fact-recommended').textContent='—';$('apply-line-recommendation').disabled=true;render();});parameterField.append(parameterLabel,parameter);methodPair.append(parameterField);target.append(methodPair);
    const calc=button('计算本行推荐价',()=>{const error=parameterError(row.method,row.parameter);if(error){$('editor-error').textContent=error;return;}const value=calculate(row);if(value===null){$('editor-error').textContent='计算结果超出价格范围，或基准已失效。';return;}row.recommended=value;changed();record(line.name+'：按'+methodLabel(row.method)+' '+row.parameter+' 计算推荐价 '+money(value)+'，未改最终价。');render();renderEditor();},'btn');calc.disabled=!editable||row.method==='manual';calc.style.marginTop='13px';target.append(calc);
    const recommendation=el('div','recommendation'),recLabel=el('span','','推荐价');const recValue=el('strong','',money(row.recommended));recValue.id='editor-recommended';recLabel.append(recValue);const apply=button('应用到最终价',()=>{if(row.recommended===null||!editable)return;row.final=money(row.recommended);row.confirmed=false;row.lossReason='';row.lossAcknowledged=false;changed();record(line.name+'：主动应用推荐价 '+row.final+'，等待确认。');render();renderEditor();},'btn small');apply.id='apply-line-recommendation';apply.disabled=!editable||row.recommended===null;recommendation.append(recLabel,apply);target.append(recommendation);
    const finalField=el('div','editor-field'),finalLabel=el('label','','最终报价（元/kg，需确认）');finalLabel.htmlFor='editor-final';const final=el('input');final.id='editor-final';final.inputMode='decimal';final.value=row.final;final.placeholder='应用推荐价或手工输入';final.disabled=!editable;final.addEventListener('input',()=>{row.final=final.value;row.confirmed=false;row.lossReason='';row.lossAcknowledged=false;changed();$('loss-reason').value='';$('loss-ack').checked=false;$('loss-risk').hidden=!isLoss(row);$('fact-final').textContent=money(decimal(row.final));$('editor-status').textContent='待确认最终价';$('editor-error').textContent='';render();});finalField.append(finalLabel,final);target.append(finalField);
    const loss=el('section','loss-risk');loss.id='loss-risk';loss.hidden=!isLoss(row);loss.append(el('div','danger','最终报价低于基准价，须说明原因并确认亏损风险。'));const reasonField=el('div','editor-field'),reasonLabel=el('label','','亏损原因（必填）');reasonLabel.htmlFor='loss-reason';const reason=el('textarea');reason.id='loss-reason';reason.value=row.lossReason;reason.disabled=!editable;reason.addEventListener('input',()=>{row.lossReason=reason.value;row.confirmed=false;$('editor-status').textContent='待确认最终价';changed();render();});reasonField.append(reasonLabel,reason);const ack=el('label','ack'),checkbox=el('input');checkbox.type='checkbox';checkbox.id='loss-ack';checkbox.checked=row.lossAcknowledged;checkbox.disabled=!editable;checkbox.addEventListener('change',()=>{row.lossAcknowledged=checkbox.checked;row.confirmed=false;$('editor-status').textContent='待确认最终价';changed();render();});ack.append(checkbox,el('span','','已核对本行亏损风险，仍采用此价格。'));loss.append(reasonField,ack);target.append(loss);
    const error=el('p','error');error.id='editor-error';error.setAttribute('role','alert');target.append(error);const bottom=el('div','editor-bottom'),state=el('span','state-label'+(row.confirmed?' confirmed':''),row.confirmed?'最终价已确认':'待确认最终价');state.id='editor-status';const confirm=button('确认本行最终价',()=>{
      if(!writable()||currentKind(index)!=='priced'){error.textContent='请先选择当前有效基准。';return;}
      if(decimal(row.final)===null){error.textContent='最终价须大于 0、最多两位小数，且在价格范围内。';return;}
      if(isLoss(row)&&(!row.lossReason.trim()||!row.lossAcknowledged)){error.textContent='低于基准价，必须填写原因并确认亏损风险。';return;}
      row.confirmed=true;changed();record(line.name+'：确认最终价 '+money(decimal(row.final))+(isLoss(row)?'，亏损原因：'+row.lossReason.trim():'')+'。');render();renderEditor();
    },'btn primary');confirm.id='confirm-line';confirm.disabled=!editable;bottom.append(state,confirm);target.append(bottom);
  }
  function batchTargets(){return $('batch-scope').value==='all'?purchase.map((_,i)=>i):[...selected].sort((a,b)=>a-b);}
  function batchOperation(apply=false){
    if(!writable())return;const targets=batchTargets();if(!targets.length){feedback('请先选中明细行，或将作用范围改为全部 5 行。',true);return;}
    const method=$('batch-method').value,parameter=$('batch-parameter').value;
    if(!apply){const error=parameterError(method,parameter);if(error){feedback(error,true);return;}}
    const affected=targets.filter(i=>currentKind(i)==='priced'&&(!apply||rows[i].recommended!==null)),skipped=targets.filter(i=>!affected.includes(i));
    if(!affected.length){feedback('本次影响 0 行，跳过 '+targets.length+' 行；'+(apply?'没有可应用的有效推荐价。':'没有当前有效基准。'),true);return;}
    if(!apply&&affected.some(i=>calculate({...rows[i],method,parameter})===null)){feedback('有行的计算结果超出价格范围；本次批量未执行，请减小参数。',true);return;}
    const details=[el('div','detail-row','影响 '+affected.length+' 行：'+affected.map(i=>purchase[i].name).join('、')),el('div','detail-row','跳过 '+skipped.length+' 行'+(skipped.length?'：'+skipped.map(i=>purchase[i].name+'（'+(currentKind(i)==='missing'?'缺货':currentKind(i)==='priced'?'无推荐价':'无有效基准')+'）').join('、'):''))];
    action(apply?'应用推荐价到最终报价':'批量计算推荐价',apply?'只复制有效推荐价，应用后仍须逐行确认。最终价格不会在计算时自动变化。':methodLabel(method)+' · 参数 '+parameter+($('batch-method').value==='percent'?'%':$('batch-method').value==='multiple'?' 倍':' 元/kg')+'；仅写入推荐价。',details,()=>{
      undo={rows:clone(rows),hospitalUntil,manualUntil};affected.forEach(i=>{const row=rows[i];if(apply){row.final=money(row.recommended);row.confirmed=false;row.lossReason='';row.lossAcknowledged=false;}else{row.method=method;row.parameter=parameter;row.recommended=calculate(row);}});changed(false);record((apply?'批量应用推荐价':'批量'+methodLabel(method)+' '+parameter)+'：影响 '+affected.length+' 行，跳过 '+skipped.length+' 行。');feedback('已'+(apply?'应用到最终价，待逐行确认':'计算推荐价，未更改最终价')+'；保存前可撤销本次批量。');render();
    });
  }
  function refreshQuotes(){
    if(!writable()||!hasDelta())return;
    const details=purchase.map((line,index)=>{const old=rows[index].base,candidate=lowest(index),part=el('div','detail-row',line.name+'：已采用 '+(old?names[old.supplier]+' '+money(old.price):'无')+' / 最新最低 '+(candidate?names[candidate.supplier]+' '+money(candidate.price):'无'));part.append(el('small','',rows[index].selection==='auto'?'自动选择：采用后按当前最低有效价更新。':'手工选择：保留所选厂家，不因更便宜自动切换。'));return part;});
    action('刷新并采用厂家报价','更新草稿采用快照和受影响推荐价；保留最终价格值。基准变动的行取消确认，须重新核对。',details,()=>{
      const oldBases=rows.map(row=>row.base?row.base.supplier+'|'+row.base.submission+'|'+row.base.price:'');adopted=clone(latest);let affected=0;
      rows.forEach((row,index)=>{const permitted=choices(index);if(row.selection==='auto'&&permitted.length)setBase(index,'auto');else if(permitted.includes(row.selection))setBase(index,row.selection);else if(row.base&&!sourceCurrent(row.base)){row.confirmed=false;row.recommended=null;row.lossAcknowledged=false;row.lossReason='';}
        const now=row.base?row.base.supplier+'|'+row.base.submission+'|'+row.base.price:'';if(oldBases[index]!==now)affected++;});
      changed();syncDate();record('主动刷新厂家快照；'+affected+' 行基准变化，最终价格值保留。');feedback('已主动采用最新报价，'+affected+' 行基准变化；请重新确认受影响行。');render();
    });
  }
  function validationErrors(){
    const errors=[];purchase.forEach((line,index)=>{const row=rows[index],kind=currentKind(index);if(kind==='missing')return;if(kind==='waiting'||kind==='invalid'){errors.push(line.name+'：'+(kind==='invalid'?'基准失效，请改选有效厂家或重新询价。':'待厂家完整结果或主动采用，不能按缺货处理。'));return;}if(decimal(row.final)===null)errors.push(line.name+'：最终报价须为正数且最多两位小数。');else if(!row.confirmed)errors.push(line.name+'：最终价尚未确认。');else if(isLoss(row)&&(!row.lossReason.trim()||!row.lossAcknowledged))errors.push(line.name+'：缺少亏损原因或风险确认。');});
    if(!purchase.every((_,i)=>currentKind(i)==='missing')){const cap=capDate();if(!hospitalUntil||hospitalUntil<today||!cap||hospitalUntil>cap)errors.push('医院报价有效至日期须在 '+today+' 至 '+(cap||'有效基准到期日')+' 之间，不能延长。');}return errors;
  }
  function preview(){
    const errors=validationErrors();if(errors.length){const list=el('ul','info-list');errors.forEach(text=>list.append(el('li','',text)));showInfo('整单尚不能预览',[el('p','blocked-title','校验全部 5 行，包含筛选隐藏和未选中的行。'),list]);return;}
    const losses=rows.map((row,index)=>isLoss(row)?index:null).filter(i=>i!==null);
    if(losses.length&&writable()){action('本次预览包含低于基准价的行','每次预览重新核对这些风险；实际导出时仍须服务端重新校验。',losses.map(i=>el('div','detail-row',purchase[i].name+'：'+rows[i].final+' < '+money(rows[i].base.price)+' 元/kg；原因：'+rows[i].lossReason)),showPreview,'已核对上述原因和亏损风险，继续本次预览。');return;}showPreview();
  }
  function showPreview(){
    const allMissing=purchase.every((_,i)=>currentKind(i)==='missing');$('preview-summary').textContent='采购修订 R1 / 报价 V1 · '+(allMissing?'本单全部缺货，不设价格有效期':'报价有效至 '+hospitalUntil+'（含当日）')+' · 5 行全部保留';let total=0n;
    $('preview-body').replaceChildren(...purchase.map((line,index)=>{const missing=currentKind(index)==='missing',price=decimal(rows[index].final),amount=missing?null:round(price*line.qty,100n),tr=el('tr');const name=el('td','',line.name);name.append(el('div','secondary-line',line.spec||'规格未提供'));tr.append(name,el('td','',money(line.qty)),el('td',missing?'missing-text':'',missing?'缺货':'可供货'),el('td','money',missing?'—':money(price)),el('td','money',missing?'—':money(amount)));if(amount!==null)total+=amount;return tr;}));$('preview-total').textContent=allMissing?'本单全部缺货 · 不产生应收':'报价合计 ¥ '+money(total)+'（尚未医院确认）';$('preview-dialog').showModal();
  }
  $('scenario').addEventListener('change',reset);
  $('search').addEventListener('input',render);$('risk-filter').addEventListener('change',render);
  $('select-visible').addEventListener('change',()=>{const checked=$('select-visible').checked;visibleIndexes().forEach(i=>checked?selected.add(i):selected.delete(i));render();});
  $('batch-method').addEventListener('change',()=>{$('batch-parameter').value='';$('batch-unit').textContent=$('batch-method').value==='percent'?'%':$('batch-method').value==='multiple'?'倍':$('batch-method').value==='fixed'?'元/kg':'';});
  $('batch-calculate').addEventListener('click',()=>batchOperation(false));$('batch-apply').addEventListener('click',()=>batchOperation(true));
  $('undo-batch').addEventListener('click',()=>{if(!undo||!writable())return;rows=undo.rows;hospitalUntil=undo.hospitalUntil;manualUntil=undo.manualUntil;undo=null;dirty=true;record('撤销最近一次未保存批量操作，恢复此前推荐价和最终价。');feedback('已撤销最近一次批量操作。');render();});
  $('action-cancel').addEventListener('click',()=>{$('action-dialog').close();pendingAction=null;});$('action-dialog').addEventListener('cancel',()=>{pendingAction=null;});
  $('action-confirm').addEventListener('click',()=>{const perform=pendingAction;pendingAction=null;$('action-dialog').close();if(perform)perform();});
  $('close-line').addEventListener('click',()=>{$('line-dialog').close();activeIndex=null;});$('close-info').addEventListener('click',()=>$('info-dialog').close());$('close-preview').addEventListener('click',()=>$('preview-dialog').close());
  $('hospital-valid-until').addEventListener('input',()=>{if(!writable())return;hospitalUntil=$('hospital-valid-until').value;manualUntil=true;changed();record('手动填写医院报价有效至 '+(hospitalUntil||'空')+'，预览时校验上限。');render();});
  $('save-draft').addEventListener('click',()=>{if(!writable())return;const bad=rows.findIndex(row=>row.final&&decimal(row.final)===null);if(bad!==-1){feedback(purchase[bad].name+' 的最终价不合法，请改正后保存。',true);return;}undo=null;dirty=false;record('模拟保存 V1 草稿；版本号不增加，未确认行可继续编辑。');feedback('草稿已在本页模拟保存；没有写入数据库，刷新即重置。');render();});
  $('show-log').addEventListener('click',()=>showInfo('V1 · 本页改价日志',logs.length?logs.map(item=>{const part=el('div','detail-row',item.text);part.append(el('small','',item.time+' / 林销售'));return part;}):[el('p','history-note','尚无本页操作记录。真实服务端审计尚未实现。')]));
  $('preview-quote').addEventListener('click',preview);$('refresh-quotes').addEventListener('click',refreshQuotes);
  $('late-demo').addEventListener('click',()=>{if(!writable()||latest.b.status!=='pending')return;latest.b={status:'submitted',submission:'b-s1',until:'2026-10-19',prices:clone(sampleB)};record('演示：乙厂后到提交；仅更新实时区，未更改草稿基准、推荐价及最终价。');feedback('乙厂已提交样例。草稿尚未采用，请查看差异。');render();});
  $('requery-demo').addEventListener('click',()=>{if(!writable()||latest.a.status!=='submitted')return;latest.a.status='requote';latest.a.submission=null;rows.forEach(row=>{if(row.base?.supplier==='a'){row.confirmed=false;row.lossAcknowledged=false;row.lossReason='';}});undo=null;record('演示：甲厂重询，旧基准立即失效，最终价保留。');feedback('甲厂旧提交退出计算；引用该基准的行不能预览，请改选或等待新报价。',true);syncDate();render();});
  if(location.protocol!=='file:')document.querySelectorAll('a[href]').forEach(link=>{const href=link.getAttribute('href');if(/^[a-z-]+\.html$/.test(href))link.setAttribute('href','/files/'+href);});
  reset();
})();
