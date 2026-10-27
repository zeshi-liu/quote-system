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
