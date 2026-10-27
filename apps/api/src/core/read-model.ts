import type { Actor } from '../auth/auth';
import type { Client } from './store';
import type { OrderView, OrderSummary, Comparison, ComparisonLine, QuoteCell, Draft, DraftLine } from '../../../../packages/contracts/src';
import { ensure } from './errors';
import { today } from './validation';
import { decimal, lineAmount, totalAmount } from './money';
export function summary(r:any,actor:Actor):OrderSummary{return {id:r.id,orderNo:r.order_no,hospitalName:r.hospital_name,receivedDate:r.received_date,paymentTermDays:r.payment_term_days,revisionId:r.revision_id,revisionNo:r.revision_no,version:r.row_version,status:r.status,writable:r.sales_user_id===actor.id&&(r.submission_source!=='hospital_self'||!!r.hospital_submitted_at)};}
export async function purchaseLines(c:Client,revisionId:string){return (await c.query('SELECT id,name,spec,quantity,unit,checked,purchase_remark AS remark,source_type AS "sourceType",item_id AS "itemId",item_variant_id AS "itemVariantId",source_file_id AS "sourceFileId",parsing_job_id AS "parsingJobId",source_row_number AS "sourceRowNumber" FROM purchase_order_lines WHERE revision_id=$1 ORDER BY position',[revisionId])).rows;}
export async function taskRows(c:Client,revisionId:string){return (await c.query(`SELECT t.*,m.name AS manufacturer_name,s.id AS submission_id,s.valid_until,l.id AS link_id,l.expires_at AS link_expires_at FROM supplier_tasks t JOIN manufacturers m ON m.id=t.manufacturer_id LEFT JOIN supplier_quote_submissions s ON s.task_id=t.id AND s.status='current' LEFT JOIN LATERAL(SELECT id,expires_at FROM supplier_links WHERE task_id=t.id AND status IN('active','used') ORDER BY created_at DESC,id DESC LIMIT 1) l ON true WHERE t.revision_id=$1 AND t.status<>'cancelled' ORDER BY t.slot_no`,[revisionId])).rows;}
export async function orderView(c:Client,r:any,actor:Actor):Promise<OrderView>{
 const tasks=await taskRows(c,r.revision_id),draft=(await c.query("SELECT q.id AS quote_id,v.id FROM quotes q LEFT JOIN quote_versions v ON v.quote_id=q.id AND v.status='draft' WHERE q.revision_id=$1",[r.revision_id])).rows[0];
 return {...summary(r,actor),receivedDateEditable:r.sales_user_id===actor.id&&r.status==='draft'&&r.revision_no===1&&r.revision_status==='draft'&&(r.submission_source!=='hospital_self'||!!r.hospital_submitted_at),hospitalId:r.hospital_id,purchaserUserId:r.purchaser_user_id,lines:await purchaseLines(c,r.revision_id),tasks:tasks.map(t=>({id:t.id,slotNo:t.slot_no,manufacturerId:t.manufacturer_id,manufacturerName:t.manufacturer_name,status:t.status,linkId:t.link_id||null,linkExpiresAt:t.link_expires_at?.toISOString()||null,submissionId:t.submission_id||null,validUntil:t.valid_until||null})),quoteId:draft?.quote_id||null,draftId:draft?.id||null};
}
export async function comparison(c:Client,r:any,now:Date):Promise<Comparison>{
 const tasks=await taskRows(c,r.revision_id),lines=await purchaseLines(c,r.revision_id);
 const values=(await c.query("SELECT sl.* FROM supplier_quote_lines sl JOIN supplier_quote_submissions s ON s.id=sl.submission_id WHERE s.revision_id=$1 AND s.status='current'",[r.revision_id])).rows;
 const complete=(t:any)=>t&&t.status==='submitted'&&t.submission_id&&t.valid_until>=today(now);
 const result:ComparisonLine[]=lines.map(l=>{
   const cells:QuoteCell[]=[1,2].map(slot=>{
     const t=tasks.find(t=>t.slot_no===slot),value=t&&values.find(v=>v.submission_id===t.submission_id&&v.purchase_line_id===l.id);
     const state=!t?'pending':t.submission_id&&t.valid_until<today(now)?'expired':!complete(t)?t.status==='requote'?'requote':'pending':value?.status==='quoted'?'quoted':value?.status==='unavailable'?'unavailable':'pending';
     return {taskId:t?.id||'',manufacturerId:t?.manufacturer_id||'',manufacturerName:t?.manufacturer_name||'厂家 '+(slot===1?'A':'B'),state,price:state==='quoted'?value.unit_price:null,validUntil:t?.valid_until||null,supplierQuoteLineId:state==='quoted'||state==='unavailable'?value.id:null};
   });
   const priced=cells.filter(v=>v.state==='quoted').sort((a,b)=>decimal(a.price!).comparedTo(decimal(b.price!)));
   return {purchaseLineId:l.id,name:l.name,spec:l.spec,quantity:l.quantity,cells,kind:priced.length?'priced':cells.every(v=>v.state==='unavailable')?'missing':'blocked',lowestPrice:priced[0]?.price||null};
 });
 return {orderId:r.id,orderVersion:r.row_version,submittedCount:tasks.filter(complete).length,lines:result};
}
export async function draftView(c:Client,r:any,now:Date,versionId?:string):Promise<Draft>{
 const version=(await c.query("SELECT v.* FROM quotes q JOIN quote_versions v ON v.quote_id=q.id WHERE q.revision_id=$1 AND v.status='draft' AND ($2::uuid IS NULL OR v.id=$2)",[r.revision_id,versionId||null])).rows[0];ensure(version,404,'DRAFT_NOT_FOUND','尚未进入计价');
 const real=await comparison(c,r,now);
 const rows=(await c.query(`SELECT ql.*,m.name AS manufacturer_name,s.valid_until,s.status AS submission_status,t.status AS task_status FROM quote_lines ql JOIN purchase_order_lines pl ON pl.id=ql.purchase_line_id LEFT JOIN supplier_quote_lines sl ON sl.id=ql.base_supplier_quote_line_id LEFT JOIN supplier_quote_submissions s ON s.id=sl.submission_id LEFT JOIN supplier_tasks t ON t.id=s.task_id LEFT JOIN manufacturers m ON m.id=t.manufacturer_id WHERE ql.version_id=$1 ORDER BY pl.position`,[version.id])).rows;
 const lines:DraftLine[]=rows.map(row=>{
   const live=real.lines.find(l=>l.purchaseLineId===row.purchase_line_id)!;
   const baseValid=!!row.base_supplier_quote_line_id&&row.task_status==='submitted'&&row.submission_status==='current'&&row.valid_until>=today(now);
   const snapshot=row.adopted_supplier_snapshot as QuoteCell[],kind=row.adopted_kind as DraftLine['kind'];
   const signature=(cells:QuoteCell[])=>JSON.stringify(cells.map(v=>[v.taskId,v.state,v.supplierQuoteLineId,v.validUntil]));
   const supplyValid=kind==='priced'?baseValid:kind==='missing'&&snapshot.length===2&&snapshot.every(old=>old.state==='unavailable'&&live.cells.some(next=>next.state==='unavailable'&&next.supplierQuoteLineId===old.supplierQuoteLineId));
   return {publicRemark:row.public_remark,purchaseLineId:row.purchase_line_id,name:live.name,spec:live.spec,quantity:live.quantity,kind,baseSupplierQuoteLineId:row.base_supplier_quote_line_id,baseManufacturerName:row.manufacturer_name||null,basePrice:row.base_price,baseValid,supplyValid,adoptedLowestPrice:row.adopted_lowest_price,hasNewSupplierData:signature(snapshot)!==signature(live.cells),selectionMode:row.selection_mode,markupMethod:row.markup_method,parameterValue:row.parameter_value,recommendedPrice:baseValid?row.recommended_price:null,finalPrice:row.final_price,finalConfirmed:row.final_confirmed,lossReason:row.loss_reason,amount:kind==='priced'&&row.final_price?lineAmount(live.quantity,row.final_price):null};
 });
 const dates=rows.filter(row=>row.base_supplier_quote_line_id&&row.submission_status==='current'&&row.task_status==='submitted'&&row.valid_until>=today(now)).map(row=>row.valid_until as string).sort();
 const maxValidUntil=dates[0]||null,amounts=lines.flatMap(l=>l.amount?[l.amount]:[]);
 const validLines=lines.every(l=>l.kind==='missing'&&l.supplyValid&&!l.baseSupplierQuoteLineId&&!l.finalPrice||l.kind==='priced'&&l.baseValid&&!!l.finalPrice&&l.finalConfirmed&&(decimal(l.finalPrice).gte(decimal(l.basePrice!))||!!l.lossReason.trim()));
 const priced=lines.some(l=>l.kind==='priced'),dateValid=!priced?version.hospital_valid_until===null:!!version.hospital_valid_until&&!!maxValidUntil&&version.hospital_valid_until>=today(now)&&version.hospital_valid_until<=maxValidUntil;
 return {id:version.id,quoteId:version.quote_id,orderId:r.id,version:version.row_version,hospitalValidUntil:version.hospital_valid_until,maxValidUntil,lines,total:amounts.length?totalAmount(amounts):null,readyForNextStep:validLines&&dateValid&&real.lines.every(l=>l.kind!=='blocked')};
}
