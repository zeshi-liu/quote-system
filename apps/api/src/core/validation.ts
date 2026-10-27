import { z } from 'zod';
import { decimal } from './money';
import {lineOriginFields} from './line-origin';
export const uuid=z.uuid();
export const amount=z.string().refine(v=>{try{decimal(v);return true;}catch{return false;}},'最多两位小数且在允许范围内');
export const positive=amount.refine(v=>decimal(v).gt(0),'必须大于 0');
export const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'日期无效');
export const purchaseLine=z.object({id:uuid.optional(),name:z.string().trim().min(1).max(100),spec:z.string().trim().max(200),quantity:positive,checked:z.boolean(),remark:z.string().trim().max(500).optional(),...lineOriginFields}).strict();
export const purchaseLines=z.array(purchaseLine).min(1).max(200);
export const supplierLine=z.object({purchaseLineId:uuid,status:z.enum(['quoted','unavailable']),unitPrice:positive.nullable()}).strict().refine(v=>v.status==='quoted'?v.unitPrice!==null:v.unitPrice===null,'可供货须报价，缺货时价格须为空');
export const supplierInput=z.object({validUntil:date,lines:z.array(supplierLine).min(1).max(200)}).strict();
export const draftLine=z.object({publicRemark:z.string().trim().max(500).optional(),purchaseLineId:uuid,baseSupplierQuoteLineId:uuid.nullable(),selectionMode:z.enum(['auto','manual']),markupMethod:z.enum(['fixed','percent','multiplier']).nullable(),parameterValue:amount.nullable(),finalPrice:positive.nullable(),finalConfirmed:z.boolean(),lossReason:z.string().trim().max(500)}).strict();
export const version=z.number().int().positive();
export const reason=z.string().trim().min(1).max(500);
export const today=(now:Date)=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
export function parse<T>(schema:z.ZodType<T>,input:unknown):T{return schema.parse(input);}
