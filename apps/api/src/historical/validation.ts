import {z} from 'zod';
import {amount,date,positive,reason,uuid,version,today} from '../core/validation';
import {decimal,bounded} from '../core/money';
import {ensure} from '../core/errors';
export const historicalLine=z.object({id:uuid.optional(),name:z.string().trim().max(100),spec:z.string().trim().max(200).default(''),quantity:positive.nullable(),unit:z.literal('kg').default('kg'),supplyStatus:z.enum(['unknown','priced','missing']).default('unknown'),confirmedQuantity:amount.nullable().default(null),unitPrice:positive.nullable().default(null)}).strict();
const fields={purchaserUserId:uuid.nullable().optional(),receivedDate:date.nullable().optional(),originalTermDays:z.number().int().min(0).max(3650).nullable().optional(),originalOrderNo:z.string().trim().max(100).optional(),originalHandler:z.string().trim().max(200).optional(),confirmedDate:date.nullable().optional(),finalAmount:amount.nullable().optional(),openingPaidAmount:amount.nullable().optional(),verificationBasis:z.string().trim().max(2000).optional(),verificationNote:z.string().trim().max(2000).optional(),evidenceFileIds:z.array(uuid).max(100).refine(ids=>new Set(ids).size===ids.length,'附件重复').optional(),lines:z.array(historicalLine).max(200).optional()};
export const createInput=z.object({hospitalId:uuid,...fields}).strict();
export const saveInput=z.object({expectedVersion:version,...fields}).strict();
export const verifyInput=z.object({expectedVersion:version,verificationBasis:z.string().trim().max(2000).optional(),verificationNote:z.string().trim().max(2000).optional(),evidenceFileIds:fields.evidenceFileIds}).strict();
export const correctionInput=z.object({expectedVersion:version,newAmount:amount,reason,verificationBasis:z.string().trim().min(1).max(2000),verificationNote:z.string().trim().min(1).max(2000),evidenceFileIds:fields.evidenceFileIds}).strict();
export const voidInput=z.object({expectedVersion:version,reason}).strict();
export const emptyDraft={purchaserUserId:null,receivedDate:null,originalTermDays:null,originalOrderNo:'',originalHandler:'',confirmedDate:null,finalAmount:null,openingPaidAmount:null,verificationBasis:'',verificationNote:'',evidenceFileIds:[],lines:[]};
export function validateDates(v:{receivedDate?:string|null;confirmedDate?:string|null},now:Date){ensure(!v.receivedDate||v.receivedDate<=today(now),400,'HISTORICAL_DATE_IN_FUTURE','实际接收日期不能在未来');ensure(!v.confirmedDate||v.confirmedDate<=today(now),400,'HISTORICAL_DATE_IN_FUTURE','实际确认日期不能在未来');}
export function validateVerification(v:any,now:Date){
 validateDates(v,now);
 ensure(v.receivedDate!==null&&v.originalTermDays!==null&&v.finalAmount!==null&&v.openingPaidAmount!==null&&v.verificationBasis.trim()&&v.verificationNote.trim()&&v.lines.length>0&&v.lines.every((l:any)=>l.name.trim()&&l.quantity!==null),400,'HISTORICAL_INCOMPLETE','请补齐药品、kg数量、实际接收日期、原约定账期、最终金额、历史累计已收、核实依据和说明');
 ensure(!v.confirmedDate||v.confirmedDate>=v.receivedDate,400,'HISTORICAL_DATE_CONFLICT','实际确认日期不能早于接收日期');
 ensure(decimal(v.openingPaidAmount).lte(decimal(v.finalAmount)),400,'HISTORICAL_PAYMENT_EXCEEDS_AMOUNT','历史累计已收不能超过最终确认金额');
 let sum=decimal('0'),known=true;
 for(const line of v.lines){
  ensure(line.confirmedQuantity===null||decimal(line.confirmedQuantity).lte(decimal(line.quantity)),400,'HISTORICAL_QUANTITY_CONFLICT','确认量不能超过采购需求');
  if(line.supplyStatus==='unknown'){ensure(line.confirmedQuantity===null,400,'HISTORICAL_RESULT_CONFLICT','供货结果未知时不填写推定确认量');known=false;}
  else if(line.supplyStatus==='missing')ensure(line.confirmedQuantity!==null&&decimal(line.confirmedQuantity).isZero()&&line.unitPrice===null,400,'HISTORICAL_RESULT_CONFLICT','明确缺货行须确认量为0、单价为空');
  else if(line.confirmedQuantity!==null&&line.unitPrice!==null)sum=sum.plus(decimal(bounded(decimal(line.confirmedQuantity).mul(decimal(line.unitPrice)))));else known=false;
 }
 bounded(sum);
 ensure(known?sum.eq(decimal(v.finalAmount)):sum.lte(decimal(v.finalAmount)),400,'HISTORICAL_AMOUNT_CONFLICT','已知行金额与整单最终金额矛盾，请先核对');
 if(v.lines.every((l:any)=>l.supplyStatus==='missing'))ensure(decimal(v.finalAmount).isZero(),400,'HISTORICAL_AMOUNT_CONFLICT','明确全部缺货时整单金额须为0');
}
