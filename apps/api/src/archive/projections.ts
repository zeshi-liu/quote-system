import {z} from 'zod';
import type {ArchiveAudit,QuoteCell,DraftLineInput} from '../../../../packages/contracts/src';
import {uuid,amount,date} from '../core/validation';

const auditLabels:Record<string,string>={
 'purchase.create':'手工录入采购单','purchase.save-lines':'保存采购校对','purchase.freeze':'冻结采购修订',
 'supplier.task-create':'创建厂家询价','supplier.link-generate':'生成厂家链接','supplier.link-regenerate':'重新生成厂家链接','supplier.link-requote':'重新询价','supplier.cancel':'取消厂家询价','supplier.submit':'厂家提交报价',
 'pricing.enter':'进入计价','pricing.save':'保存计价','pricing.adopt':'采用最新厂家报价',
 'delivery.export-prepared':'申请导出','delivery.export-bound':'导出文件生成成功','delivery.mark-sent':'登记发送','delivery.confirm':'登记医院实际确认','delivery.create-next':'创建下一报价版本','delivery.void':'作废报价','delivery.confirm-void-other':'确认后作废其他报价'
};
const summaryKeys:Record<string,string[]>={
 'purchase.save-lines':['lineCount'],'supplier.task-create':['slot'],'supplier.link-regenerate':['reason'],'supplier.link-requote':['reason'],'supplier.cancel':['reason'],
 'delivery.mark-sent':['channel','remark'],'delivery.confirm':['actual','recordedAt','backfillReason'],'delivery.create-next':['reason'],'delivery.void':['reason']
};
const fieldLabels:Record<string,string>={lineCount:'采购行数',slot:'厂家任务位',reason:'原因',channel:'发送渠道',remark:'备注',actual:'实际确认时间',recordedAt:'登记时间',backfillReason:'补录原因'};

// z.object strips unknown keys; do not expose raw details or arbitrary future JSON fields.
const pricingChange=z.object({purchaseLineId:uuid,baseSupplierQuoteLineId:uuid.nullable(),selectionMode:z.enum(['auto','manual']),markupMethod:z.enum(['fixed','percent','multiplier']).nullable(),parameterValue:amount.nullable(),finalPrice:amount.nullable(),finalConfirmed:z.boolean(),lossReason:z.string().max(500),publicRemark:z.string().max(500).optional()});
const supplierCell=z.object({taskId:z.string().max(100),manufacturerId:z.string().max(100),manufacturerName:z.string().max(200),state:z.enum(['quoted','unavailable','pending','expired','requote','cancelled']),price:amount.nullable(),validUntil:date.nullable(),supplierQuoteLineId:uuid.nullable()});
export function supplierSnapshot(input:unknown):QuoteCell[]{return Array.isArray(input)?input.flatMap(value=>{const parsed=supplierCell.safeParse(value);return parsed.success?[parsed.data]:[];}):[];}
function summaryValue(key:string,input:string|number):string{
 const value=String(input).slice(0,500);
 if((key==='actual'||key==='recordedAt')&&z.iso.datetime({offset:true}).safeParse(value).success)return new Date(new Date(value).getTime()+8*3600000).toISOString().replace('T',' ').slice(0,19)+' 北京时间';
 return value;
}
export function auditDto(row:any):ArchiveAudit{
 const details=row.details||{},parts=(summaryKeys[row.action]||[]).flatMap(key=>typeof details[key]==='string'||typeof details[key]==='number'?[`${fieldLabels[key]}：${summaryValue(key,details[key])}`]:[]);
 const version=uuid.safeParse(details.versionId||details.draftId),changes:DraftLineInput[]=row.action==='pricing.save'&&Array.isArray(details.lines)?details.lines.flatMap((line:unknown)=>{const parsed=pricingChange.safeParse(line);return parsed.success?[parsed.data]:[];}):[];
 return {id:row.id,action:row.action,actorId:row.actor_id,actorName:row.actor_name_snapshot??row.profile_name??'未知操作人',actorNameSource:row.actor_name_snapshot!=null?'snapshot':row.profile_name?'current_profile':'unknown',createdAt:new Date(row.created_at).toISOString(),summary:[auditLabels[row.action]||'历史操作',...parts].join('；'),...(version.success?{versionId:version.data}:{}),...(row.action==='pricing.save'?{pricingChanges:changes}:{})};
}
