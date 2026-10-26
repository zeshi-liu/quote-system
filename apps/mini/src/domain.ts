import type { MarkupMethod } from '@quote/contracts';
export type MarkupState={markupMethod:MarkupMethod|null;parameterValue:string|null;recommendedPrice:string|null};
export function restoreMarkup<T extends MarkupState & {basePrice:string|null}>(current:T,previous:MarkupState):Omit<T,keyof MarkupState>&MarkupState{return {...current,markupMethod:previous.markupMethod,parameterValue:previous.parameterValue,recommendedPrice:current.basePrice&&previous.markupMethod&&previous.parameterValue!==null?recommendation(current.basePrice,previous.markupMethod,previous.parameterValue):null};}
const decimalPattern=/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const maxCents=999999999999n;
export function validPositive(value:string):boolean { return decimalPattern.test(value)&&Number(value)>0; }
function scaled(value:string,places:number){if(!decimalPattern.test(value))throw new Error('请填写最多两位小数、无前导零的非负参数');const [whole,part='']=value.split('.');return BigInt(whole)*10n**BigInt(places)+BigInt(part.padEnd(places,'0'));}
export function recommendation(price:string, method:MarkupMethod, parameter:string):string {
 const cents=scaled(price,2);let amount:bigint;
 if(method==='fixed')amount=cents+scaled(parameter,2);
 else {const param=scaled(parameter,2);if(method==='multiplier'&&param<100n)throw new Error('高开倍率须至少为 1.00');const numerator=method==='percent'?cents*(10000n+param):cents*param;const denominator=method==='percent'?10000n:100n;amount=(numerator+denominator/2n)/denominator;}
 if(amount>maxCents)throw new Error('计算结果超出允许范围');
 return (amount/100n).toString()+'.'+(amount%100n).toString().padStart(2,'0');
}
export function canManageOrder(order:{writable:boolean;status:string}):boolean{return order.writable&&!['completed','voided'].includes(order.status);}
export function pricingInputs(lines:import('@quote/contracts').DraftLineInput[]):import('@quote/contracts').DraftLineInput[]{return lines.map(l=>({purchaseLineId:l.purchaseLineId,baseSupplierQuoteLineId:l.baseSupplierQuoteLineId,selectionMode:l.selectionMode,markupMethod:l.markupMethod,parameterValue:l.parameterValue,finalPrice:l.finalPrice||null,finalConfirmed:l.finalConfirmed,lossReason:l.lossReason,publicRemark:l.publicRemark||''}));}

export function assertPurchaseReceipt(operation:{path?:string;body?:Record<string,unknown>;data?:Record<string,unknown>},value:unknown){
 const path=operation.path||'',b=operation.body||operation.data||{},match=path.match(/^\/sales\/purchase-orders\/([^/]+)\/(?:revisions(?:\/([^/]+)\/(lines|freeze))?|void)$/),create=path==='/sales/purchase-orders';if(!match&&!create)return;
 const r=value as {id?:unknown;hospitalId?:unknown;purchaserUserId?:unknown;receivedDate?:unknown;revisionId?:unknown;version?:unknown;status?:unknown;lines?:{checked?:unknown}[]}|null;
 const fail=()=>{throw new Error('采购操作回执尚未核实，请保留原操作标识和输入。');};
 if(!r||typeof r.id!=='string'||!r.id||!Number.isSafeInteger(r.version)||Number(r.version)<1)fail();
 if(create){if(r!.status!=='draft'||['hospitalId','purchaserUserId','receivedDate'].some(k=>(r as any)[k]!==b[k]))fail();return;}
 if(r!.id!==match![1]||typeof b.expectedVersion==='number'&&r!.version!==b.expectedVersion+1)fail();
 if(match![2]&&r!.revisionId!==match![2])fail();
 const state=path.endsWith('/void')?'voided':path.endsWith('/freeze')?'frozen':'draft';if(r!.status!==state)fail();
 if(state==='frozen'&&(!Array.isArray(r!.lines)||!r!.lines!.length||r!.lines!.some(l=>l.checked!==true)))fail();
}
