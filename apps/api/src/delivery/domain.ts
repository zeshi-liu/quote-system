import { createHash } from 'node:crypto';
import type { QuoteDocument } from '../../../../packages/contracts/src';
import { CoreStore,stable,type Client } from '../core/store';
import { draftView } from '../core/read-model';
import { ensure } from '../core/errors';
import { today } from '../core/validation';
import { decimal } from '../core/money';
export interface BasisEvidence {lines:{purchaseLineId:string;kind:string;sourceIds:string[];basePrice:string|null;lossReason:string;finalConfirmed:boolean}[];requiresLossAcknowledgement:boolean;}
export async function snapshot(c:Client,r:any,v:any,now:Date):Promise<{document:QuoteDocument;evidence:BasisEvidence;hash:string;ready:boolean}>{
 if(v.document)return {document:v.document,evidence:v.basis_evidence,hash:v.snapshot_hash,ready:!!v.first_exported_at};
 const d=await draftView(c,{...r,revision_id:v.revision_id},now,v.id),seller=(await c.query('SELECT name FROM users WHERE id=$1',[r.sales_user_id])).rows[0];
 const rows=(await c.query('SELECT * FROM quote_lines WHERE version_id=$1',[v.id])).rows;
 const evidence:BasisEvidence={lines:rows.map(l=>({purchaseLineId:l.purchase_line_id,kind:l.adopted_kind,sourceIds:l.adopted_kind==='priced'?[l.base_supplier_quote_line_id].filter(Boolean):(l.adopted_supplier_snapshot||[]).filter((x:any)=>x.state==='unavailable').map((x:any)=>x.supplierQuoteLineId),basePrice:l.base_price,lossReason:l.loss_reason,finalConfirmed:l.final_confirmed})),requiresLossAcknowledgement:d.lines.some(l=>l.kind==='priced'&&l.finalPrice&&l.basePrice&&decimal(l.finalPrice).lt(decimal(l.basePrice)))};
 const document:QuoteDocument={schemaVersion:1,quoteNo:r.quote_no,versionNo:v.version_no,hospitalName:r.hospital_name,sellerName:process.env.QUOTE_SELLER_NAME||'演示供应商（虚构）',quoteDate:today(now),salespersonName:seller.name,contact:process.env.QUOTE_CONTACT||'演示联系方式（虚构）',validUntil:d.hospitalValidUntil,taxNote:'以上报价均为含税价格',notes:process.env.QUOTE_NOTES||'',lines:d.lines.map((l,i)=>({position:i+1,remark:l.publicRemark||'',name:l.name,spec:l.spec,unit:'kg',quantity:l.quantity,status:l.kind==='missing'?'missing':'priced',unitPrice:l.kind==='priced'?l.finalPrice:null,amount:l.amount})),total:d.total};
 return {document,evidence,hash:createHash('sha256').update(stable({document,evidence})).digest('hex'),ready:d.readyForNextStep};
}
export async function assertUsable(c:Client,r:any,v:any,document:QuoteDocument,evidence:BasisEvidence,now:Date){
 ensure(!['completed','voided'].includes(r.status)&&!r.confirmed_version_id,409,'ORDER_COMPLETED','订单已完成或作废，仅可查看');
 ensure(r.revision_id===v.revision_id&&r.revision_status==='frozen',409,'REVISION_CHANGED','报价不属于当前已冻结采购修订');
 ensure(['draft','exported','sent'].includes(v.status)&&!v.use_invalidated_at,409,'QUOTE_UNAVAILABLE','报价已失效或作废，请创建新版本');
 ensure(document.validUntil===null||document.validUntil>=today(now),409,'QUOTE_EXPIRED','医院报价已过有效期');
 for(const line of evidence.lines){
  const sources=(await c.query(`SELECT sl.id,sl.status,s.valid_until,s.status AS submission_status,t.status AS task_status FROM supplier_quote_lines sl JOIN supplier_quote_submissions s ON s.id=sl.submission_id JOIN supplier_tasks t ON t.id=s.task_id WHERE sl.id=ANY($1::uuid[]) AND sl.purchase_line_id=$2 AND sl.revision_id=$3`,[line.sourceIds,line.purchaseLineId,v.revision_id])).rows;
  ensure(line.kind==='priced'?sources.length===1&&sources[0].status==='quoted'&&line.finalConfirmed:sources.length===2&&sources.every(s=>s.status==='unavailable'),409,'QUOTE_NOT_READY','须确认所有有价格行，其余行须为双厂家明确缺货');
  ensure(sources.every(s=>s.submission_status==='current'&&s.task_status==='submitted'&&s.valid_until>=today(now)),409,'BASIS_INVALID','厂家依据已失效，须核对并重新报价');
 }
}
export async function deliveryRoot(store:CoreStore,c:Client,orderId:string){
 await c.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE',[orderId]);
 return (await c.query('SELECT o.*,h.name AS hospital_name,r.id AS revision_id,r.status AS revision_status,q.quote_no,q.confirmed_version_id FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id JOIN purchase_order_revisions r ON r.purchase_order_id=o.id AND r.revision_no=o.current_revision_no LEFT JOIN quotes q ON q.revision_id=r.id WHERE o.id=$1',[orderId])).rows[0];
}
export async function cancelAttempt(c:Client,exportId:string,message:string){
 await c.query("UPDATE export_jobs SET state='failed',error=$2,lease_until=NULL WHERE export_id=$1 AND state IN('queued','running')",[exportId,message]);
 await c.query("UPDATE quote_export_attempts SET state='failed' WHERE id=$1 AND state='pending'",[exportId]);
 await c.query('UPDATE quote_versions SET active_export_id=NULL WHERE active_export_id=$1',[exportId]);
}
export async function syncOrderStatus(c:Client,orderId:string){
 const rows=(await c.query("SELECT v.status FROM quote_versions v JOIN quotes q ON q.id=v.quote_id JOIN purchase_order_revisions r ON r.id=q.revision_id JOIN purchase_orders o ON o.id=r.purchase_order_id WHERE o.id=$1 AND r.revision_no=o.current_revision_no",[orderId])).rows;
 const state=rows.some(v=>v.status==='draft')?'quote_draft':rows.some(v=>v.status==='sent')?'quote_sent':rows.some(v=>v.status==='exported')?'quote_exported':'frozen';
 await c.query("UPDATE purchase_orders SET status=$2,row_version=row_version+1 WHERE id=$1 AND status NOT IN('completed','voided')",[orderId,state]);
}
