import {z} from 'zod';
import type {Client} from './store';
import {ensure} from './errors';
export const lineSourceTypes=['ocr','excel','product_library','custom_input'] as const;
export type LineSourceType=typeof lineSourceTypes[number];
/** Keep optional fields optional: old clients must not erase trusted stored provenance. */
export const lineOriginFields={sourceType:z.enum(lineSourceTypes).optional(),itemId:z.uuid().nullable().optional(),itemVariantId:z.uuid().nullable().optional(),sourceFileId:z.uuid().nullable().optional(),parsingJobId:z.uuid().nullable().optional(),sourceRowNumber:z.number().int().positive().max(1001).nullable().optional()};
const schema=z.object(lineOriginFields);
export interface LineOrigin {sourceType:LineSourceType;itemId:string|null;itemVariantId:string|null;sourceFileId:string|null;parsingJobId:string|null;sourceRowNumber:number|null;}
const columns={sourceType:'source_type',itemId:'item_id',itemVariantId:'item_variant_id',sourceFileId:'source_file_id',parsingJobId:'parsing_job_id',sourceRowNumber:'source_row_number'} as const;
export function lineOriginFromRow(row:any):LineOrigin{const read=(key:keyof typeof columns)=>row?.[key]??row?.[columns[key]]??null;return {sourceType:read('sourceType')||'custom_input',itemId:read('itemId'),itemVariantId:read('itemVariantId'),sourceFileId:read('sourceFileId'),parsingJobId:read('parsingJobId'),sourceRowNumber:read('sourceRowNumber')};}
/** Caller has already locked and authorized the root; this validates references inside it.
 * previous must be the server-read matching line, never client-supplied prior values.
 */
export async function resolveLineOrigin(c:Client,input:unknown,context:{orderId:string;revisionId:string;previous?:any}):Promise<LineOrigin>{
 const raw=schema.parse(input),old=lineOriginFromRow(context.previous),previous=context.previous;
 const pick=<K extends keyof LineOrigin>(key:K):LineOrigin[K]=>raw[key]!==undefined?raw[key] as LineOrigin[K]:old[key];
 const value:LineOrigin={sourceType:pick('sourceType'),itemId:pick('itemId'),itemVariantId:pick('itemVariantId'),sourceFileId:pick('sourceFileId'),parsingJobId:pick('parsingJobId'),sourceRowNumber:pick('sourceRowNumber')};
 if(value.itemVariantId){const variant=(await c.query('SELECT v.item_id,v.active,i.active AS item_active FROM item_variants v JOIN items i ON i.id=v.item_id WHERE v.id=$1 FOR SHARE OF v,i',[value.itemVariantId])).rows[0];ensure(variant&&(!value.itemId||value.itemId===variant.item_id),400,'LINE_PRODUCT_MISMATCH','商品规格须属于所选标准商品');value.itemId=variant.item_id;const retained=!!previous&&old.itemId===value.itemId&&old.itemVariantId===value.itemVariantId;ensure(retained||variant.active&&variant.item_active,400,'LINE_PRODUCT_UNAVAILABLE','新选标准商品和规格必须启用');}
 else if(value.itemId){const item=(await c.query('SELECT active FROM items WHERE id=$1 FOR SHARE',[value.itemId])).rows[0],retained=!!previous&&old.itemId===value.itemId&&old.itemVariantId===null;ensure(item,400,'LINE_PRODUCT_MISMATCH','标准商品不存在');ensure(retained||item.active,400,'LINE_PRODUCT_UNAVAILABLE','新选标准商品必须启用');}
 ensure(value.sourceType!=='product_library'||value.itemId,400,'LINE_PRODUCT_MISMATCH','商品库来源须关联有效标准商品');
 const retainedParse=!!previous&&old.sourceFileId===value.sourceFileId&&old.parsingJobId===value.parsingJobId&&old.sourceRowNumber===value.sourceRowNumber&&old.sourceType===value.sourceType&&['ocr','excel'].includes(old.sourceType);
 if(previous&&['ocr','excel'].includes(old.sourceType))ensure(retainedParse,400,'LINE_SOURCE_MISMATCH','已应用的解析来源须保留，不能改写来源或伪造行号');
 if(value.sourceFileId){const file=(await c.query('SELECT * FROM source_files WHERE id=$1 FOR SHARE',[value.sourceFileId])).rows[0],sameStored=!!previous&&old.sourceFileId===value.sourceFileId;ensure(file&&file.reference_kind==='purchase_revision'&&file.order_id===context.orderId&&(file.revision_id===context.revisionId||sameStored),400,'LINE_SOURCE_MISMATCH','来源文件须属于本采购单修订');}
 if(['ocr','excel'].includes(value.sourceType)||value.parsingJobId||value.sourceRowNumber){
  ensure(['ocr','excel'].includes(value.sourceType)&&value.sourceFileId&&value.parsingJobId&&value.sourceRowNumber,400,'LINE_SOURCE_MISMATCH','解析来源须包含文件、任务和原始行号');
  const proof=(await c.query('SELECT j.*,f.purpose,f.reference_kind,f.order_id,f.revision_id FROM source_parsing_jobs j JOIN source_files f ON f.id=j.file_id WHERE j.id=$1 FOR SHARE OF j,f',[value.parsingJobId])).rows[0],kind=proof?.parser_type==='ocr'?'ocr':'excel',applied=proof?.applied_result;
  ensure(proof&&proof.status==='succeeded'&&proof.file_id===value.sourceFileId&&proof.reference_kind==='purchase_revision'&&proof.order_id===context.orderId&&(proof.revision_id===context.revisionId||retainedParse)&&proof.purpose===(kind==='ocr'?'purchase_image':'purchase_excel')&&kind===value.sourceType&&applied?.orderId===context.orderId&&Array.isArray(applied.lineIds)&&applied.lineIds.length>0&&Array.isArray(proof.raw_rows)&&proof.raw_rows.some((r:any)=>r.rowNumber===value.sourceRowNumber),400,'LINE_SOURCE_MISMATCH','来源必须是本单已成功应用的解析证据');
  ensure(retainedParse||!!previous&&applied.lineIds.includes(previous.id)&&old.sourceFileId===value.sourceFileId&&old.parsingJobId===value.parsingJobId&&old.sourceRowNumber===value.sourceRowNumber,400,'LINE_SOURCE_MISMATCH','客户端不能把其他行伪装成已应用解析行');
 }
 return value;
}
