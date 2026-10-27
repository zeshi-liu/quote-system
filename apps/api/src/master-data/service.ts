import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {Actor} from '../auth/auth';
import {sessionIdleMs} from '../auth/auth';
import {CoreStore,type Client} from '../core/store';
import {ensure,missing} from '../core/errors';
import {date,reason,uuid,version} from '../core/validation';
import {decimal} from '../core/money';
import {activeSales,admin,adminMutation,audited,camel,PreviewTokens} from './common';
const text=z.string().trim(),name=text.min(1).max(100),optionalText=text.max(200).default(''),phone=text.max(30).default('');
const base={id:uuid.optional(),expectedVersion:version.optional(),active:z.boolean().default(true)};
const schemas={
 hospitals:z.object({...base,name,salesUserId:uuid}).strict(),
 purchasers:z.object({...base,name,phone:text.regex(/^1\d{10}$/),hospitalId:uuid}).strict(),
 manufacturers:z.object({...base,name,contactName:optionalText,contactPhone:phone}).strict(),
 items:z.object({...base,name,category:optionalText,aliases:z.array(name).max(50).default([])}).strict(),
 variants:z.object({...base,itemId:uuid,specification:optionalText,origin:optionalText,grade:optionalText,packageDescription:optionalText}).strict(),
 templates:z.object({...base,name,sellerName:text.min(1).max(200),contactPhone:phone,fixedNotes:text.max(2000).default(''),logoFileId:uuid.nullable().default(null),isDefault:z.boolean().default(false)}).strict()
};
export type MasterDataKind=keyof typeof schemas;
export type FileReferenceCheck=(c:Client,actor:Actor,fileId:string,reference:{kind:'manufacturer';manufacturerId:string}|{kind:'template'})=>Promise<unknown>;
const querySchema=z.object({keyword:text.max(100).default(''),includeInactive:z.boolean().default(true),page:z.number().int().min(1).max(10000).default(1),pageSize:z.number().int().min(1).max(100).default(50)}).strict();
const referenceNotice='仅资料参考，不参与本次报价';
const sourceInput=z.object({manufacturerId:uuid,sourceType:z.enum(['manual','excel']),sourceBatchNo:text.max(100).default(''),quotedAt:date,sourceFileId:uuid.nullable().default(null),rows:z.array(z.record(z.string(),z.unknown())).min(1).max(1000),mapping:z.object({rawItemName:name,referencePrice:name,specification:name.optional(),origin:name.optional(),grade:name.optional(),unit:name.optional(),itemVariantId:name.optional(),remark:name.optional()}).strict().optional()}).strict();
export class MasterDataService {
 private readonly previews:PreviewTokens;
 constructor(readonly store:CoreStore,readonly checkFile?:FileReferenceCheck){this.previews=new PreviewTokens(store,'manufacturer-source');}
 private async readable(c:Client,actor:Actor,catalog=false){
  if(actor.role!=='hospital'){await this.store.active(c,actor);return;}
  ensure(catalog&&actor.channel==='mini',403,'ROLE_FORBIDDEN','医院仅可查询启用商品');
  const r=(await c.query('SELECT s.*,u.active AS user_active,u.auth_version AS current_auth_version,u.role,p.active AS purchaser_active,h.active AS hospital_active FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN hospital_purchasers p ON p.user_id=u.id JOIN hospitals h ON h.id=p.hospital_id WHERE s.id=$1 AND s.user_id=$2 FOR SHARE OF s,u,p,h',[actor.sessionId,actor.id])).rows[0],now=this.store.clock();
  ensure(r&&r.user_active&&r.purchaser_active&&r.hospital_active&&r.role==='hospital'&&r.issued_role==='hospital'&&r.auth_version===r.current_auth_version&&r.channel==='mini'&&!r.revoked_at&&r.expires_at>now&&now.getTime()-r.last_seen_at.getTime()<sessionIdleMs('mini'),401,'SESSION_EXPIRED','医院身份已失效');
 }
 async list(actor:Actor,kind:MasterDataKind,input:unknown={}){
  ensure(Object.hasOwn(schemas,kind),400,'INVALID_MASTER_KIND','未知资料类型');const q=querySchema.parse(input);
  return this.store.db.transaction(async c=>{await this.readable(c,actor);const {sql,term}=this.readSql(kind);const result=await c.query(`WITH records AS(${sql}),filtered AS(SELECT * FROM records WHERE ($1 OR active) AND ($2='' OR strpos(lower(${term}),lower($2))>0)) SELECT (SELECT count(*)::integer FROM filtered) AS total,COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT * FROM filtered ORDER BY name,id LIMIT $3 OFFSET $4) p),'[]') AS items`,[q.includeInactive,q.keyword,q.pageSize,(q.page-1)*q.pageSize]);const r=result.rows[0];return {items:r.items.map(camel),total:r.total,page:q.page,pageSize:q.pageSize};});
 }
 private readSql(kind:MasterDataKind){
  if(kind==='hospitals')return {sql:'SELECT id,name,sales_user_id,active,row_version FROM hospitals',term:'name'};
  if(kind==='purchasers')return {sql:"SELECT u.id,u.name,u.phone,u.active AND p.active AS active,u.row_version,p.hospital_id FROM users u JOIN hospital_purchasers p ON p.user_id=u.id",term:"name||COALESCE(phone,'')"};
  if(kind==='items')return {sql:"SELECT i.*,COALESCE((SELECT jsonb_agg(a.alias ORDER BY a.alias) FROM item_aliases a WHERE a.item_id=i.id),'[]') AS aliases FROM items i",term:"name||aliases::text"};
  if(kind==='variants')return {sql:'SELECT v.*,i.name FROM item_variants v JOIN items i ON i.id=v.item_id',term:"name||specification||origin||grade"};
  return {sql:'SELECT * FROM '+(kind==='templates'?'quote_templates':kind),term:'name'};
 }
 async save(actor:Actor,key:string,kind:MasterDataKind,input:unknown){
  ensure(Object.hasOwn(schemas,kind),400,'INVALID_MASTER_KIND','未知资料类型');const v:any=schemas[kind].parse(input);ensure(!v.id||v.expectedVersion,400,'VERSION_REQUIRED','修改资料须提供版本');ensure(v.id||v.expectedVersion===undefined,400,'VERSION_INVALID','新建资料不接受旧版本');
  return adminMutation(this.store,actor,key,'master.'+kind+'.save',v,async c=>{
   if(kind==='hospitals'){const owner=v.id?(await c.query('SELECT sales_user_id FROM hospitals WHERE id=$1',[v.id])).rows[0]?.sales_user_id:null;await c.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[owner,v.salesUserId].filter(Boolean)]);}
   const table=kind==='purchasers'?'users':kind==='variants'?'item_variants':kind==='templates'?'quote_templates':kind;
   let old:any;if(v.id){old=(await c.query('SELECT * FROM '+table+' WHERE id=$1 FOR UPDATE',[v.id])).rows[0];if(!old)throw missing();this.store.checkVersion(old.row_version,v.expectedVersion);}
   if(kind==='hospitals')await activeSales(c,v.salesUserId);
   if(kind==='variants'){const item=(await c.query('SELECT * FROM items WHERE id=$1 FOR SHARE',[v.itemId])).rows[0];ensure(item&&(!v.active||item.active),400,'ITEM_UNAVAILABLE','商品不存在或已停用');if(old)ensure(old.item_id===v.itemId,400,'VARIANT_ITEM_IMMUTABLE','规格不能改到另一商品');}
   if(kind==='purchasers'){
    const h=(await c.query('SELECT * FROM hospitals WHERE id=$1 FOR SHARE',[v.hospitalId])).rows[0];ensure(h&&(!v.active||h.active),400,'HOSPITAL_UNAVAILABLE','采购员必须归属启用医院');
    const duplicate=(await c.query("SELECT id FROM users WHERE role='hospital' AND phone=$1 AND id<>$2",[v.phone,v.id||randomUUID()])).rows[0];ensure(!duplicate,409,'PHONE_ALREADY_ASSIGNED','同一采购员手机号只能绑定一家医院');
    if(old){ensure(old.role==='hospital',400,'ROLE_FORBIDDEN','采购员接口不能修改内部账号');const p=(await c.query('SELECT * FROM hospital_purchasers WHERE user_id=$1 FOR UPDATE',[v.id])).rows[0];ensure(p?.hospital_id===v.hospitalId,409,'PURCHASER_HOSPITAL_IMMUTABLE','采购员归属不能覆盖历史，请为另一医院另建不同手机号档案');}
   }
   if(kind==='templates'){ensure(!v.isDefault||v.active,400,'DEFAULT_TEMPLATE_INACTIVE','默认模板必须启用');if(v.logoFileId){ensure(this.checkFile,503,'FILE_REFERENCE_UNAVAILABLE','尚未接入模板附件校验');await this.checkFile(c,actor,v.logoFileId,{kind:'template'});}if(v.isDefault)await c.query('UPDATE quote_templates SET is_default=false,row_version=row_version+1 WHERE is_default AND id<>$1',[v.id||randomUUID()]);}
   let fields:Record<string,unknown>;
   switch(kind){
    case 'hospitals':fields={name:v.name,sales_user_id:v.salesUserId,active:v.active};break;
    case 'purchasers':fields={name:v.name,phone:v.phone,active:v.active};break;
    case 'manufacturers':fields={name:v.name,contact_name:v.contactName,contact_phone:v.contactPhone,active:v.active};break;
    case 'items':fields={name:v.name,category:v.category,active:v.active};break;
    case 'variants':fields={item_id:v.itemId,specification:v.specification,origin:v.origin,grade:v.grade,package_description:v.packageDescription,active:v.active};break;
    case 'templates':fields={name:v.name,seller_name:v.sellerName,contact_phone:v.contactPhone,fixed_notes:v.fixedNotes,logo_file_id:v.logoFileId,is_default:v.isDefault,active:v.active};break;
   }
   let row:any;const columns=Object.keys(fields),values=Object.values(fields);
   if(old)row=(await c.query(`UPDATE ${table} SET ${columns.map((col,i)=>col+'=$'+(i+2)).join(',')},row_version=row_version+1 WHERE id=$1 RETURNING *`,[v.id,...values])).rows[0];
   else row=(await c.query(`INSERT INTO ${table}(${columns.join(',')}${kind==='purchasers'?',role':''}) VALUES(${values.map((_v,i)=>'$'+(i+1)).join(',')}${kind==='purchasers'?",'hospital'":''}) RETURNING *`,values)).rows[0];
   if(kind==='purchasers'){await c.query('INSERT INTO hospital_purchasers(user_id,hospital_id,active) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET active=$3',[row.id,v.hospitalId,v.active]);row.hospital_id=v.hospitalId;}
   if(kind==='hospitals'&&old?.sales_user_id!==v.salesUserId){await c.query('UPDATE users SET access_scope_version=access_scope_version+1 WHERE id=ANY($1::uuid[])',[[old?.sales_user_id,v.salesUserId].filter(Boolean)]);}
   if(kind==='items'){const aliases=[...new Set<string>(v.aliases)];await c.query('DELETE FROM item_aliases WHERE item_id=$1',[row.id]);for(const alias of aliases)await c.query('INSERT INTO item_aliases(item_id,alias) VALUES($1,$2)',[row.id,alias]);row.aliases=aliases;}
   await audited(this.store,c,actor,'master.'+kind+'.save',{id:row.id,before:old?camel(old):null,after:camel(row)});return camel(row);
  });
 }
 async searchCatalog(actor:Actor,input:unknown={}){
  const q=z.object({keyword:text.max(100).default(''),limit:z.number().int().min(1).max(100).default(50)}).strict().parse(input);
  return this.store.db.transaction(async c=>{await this.readable(c,actor,true);const rows=(await c.query(`SELECT i.id AS item_id,i.name,i.category,v.id AS variant_id,v.specification,v.origin,v.grade,v.package_description,v.default_unit,COALESCE((SELECT jsonb_agg(alias ORDER BY alias) FROM item_aliases WHERE item_id=i.id),'[]') AS aliases FROM items i JOIN item_variants v ON v.item_id=i.id WHERE i.active AND v.active AND ($1='' OR strpos(lower(i.name||v.specification||v.origin||v.grade),lower($1))>0 OR EXISTS(SELECT 1 FROM item_aliases a WHERE a.item_id=i.id AND strpos(lower(a.alias),lower($1))>0)) ORDER BY i.name,v.specification,v.id LIMIT $2`,[q.keyword,q.limit])).rows;return {items:rows.map(camel)};});
 }
 private async sourceFile(c:Client,actor:Actor,fileId:string|null,manufacturerId:string){if(!fileId)return;ensure(this.checkFile,503,'FILE_REFERENCE_UNAVAILABLE','尚未接入厂家来源附件校验');await this.checkFile(c,actor,fileId,{kind:'manufacturer',manufacturerId});}
 async previewSourceBatch(actor:Actor,input:unknown){
  const v=sourceInput.parse(input);return this.store.db.transaction(async c=>{await admin(this.store,c,actor);const m=(await c.query('SELECT id,active FROM manufacturers WHERE id=$1 FOR SHARE',[v.manufacturerId])).rows[0];ensure(m?.active,400,'MANUFACTURER_UNAVAILABLE','请选择启用厂家');await this.sourceFile(c,actor,v.sourceFileId,v.manufacturerId);
   const mapping=v.mapping||{rawItemName:'rawItemName',referencePrice:'referencePrice',specification:'specification',origin:'origin',grade:'grade',unit:'unit',itemVariantId:'itemVariantId',remark:'remark'},seen=new Set<string>(),rows:any[]=[];
   for(const [i,raw] of v.rows.entries()){
    const cell=(field:keyof typeof mapping)=>{const key=mapping[field];const value=key?raw[key]:undefined;return value===undefined||value===null?'':String(value).trim();};
    const line:any={rowNumber:i+1,rawItemName:cell('rawItemName'),referencePrice:cell('referencePrice'),specification:cell('specification'),origin:cell('origin'),grade:cell('grade'),unit:cell('unit')||'kg',itemVariantId:cell('itemVariantId')||null,remark:cell('remark'),itemId:null,status:'unmatched',errors:[]};
    if(!line.rawItemName||line.rawItemName.length>100)line.errors.push('品名须为1至100字');try{line.referencePrice=decimal(line.referencePrice,true).toFixed(2);}catch{line.errors.push('来源价格须大于0且最多两位小数');}if(line.unit!=='kg')line.errors.push('仅支持kg');for(const key of ['specification','origin','grade','remark'])if(line[key].length>(key==='remark'?500:200))line.errors.push(key+'内容过长');
    if(line.itemVariantId){if(!uuid.safeParse(line.itemVariantId).success)line.errors.push('规格引用无效');else{const match=(await c.query('SELECT v.item_id,v.active,i.active AS item_active FROM item_variants v JOIN items i ON i.id=v.item_id WHERE v.id=$1',[line.itemVariantId])).rows[0];if(!match?.active||!match.item_active)line.errors.push('关联规格不存在或已停用');else{line.itemId=match.item_id;line.status='valid';}}}
    const fingerprint=JSON.stringify([line.rawItemName,line.specification,line.origin,line.grade,line.referencePrice]);if(seen.has(fingerprint)&&!line.errors.length)line.status='duplicate';seen.add(fingerprint);if(line.errors.length)line.status='invalid';rows.push(line);
   }
   const metadata={manufacturerId:v.manufacturerId,sourceType:v.sourceType,sourceBatchNo:v.sourceBatchNo,quotedAt:v.quotedAt,sourceFileId:v.sourceFileId};return {previewToken:await this.previews.issue(c,actor,{metadata,rows,rawRows:v.rows,mapping}),rows,totalRows:rows.length,validRows:rows.filter(r=>r.status!=='invalid').length,invalidRows:rows.filter(r=>r.status==='invalid').length,referenceNotice};
  });
 }
 async confirmSourceBatch(actor:Actor,key:string,input:unknown){
  const v=z.object({previewToken:z.string().min(1).max(200),acceptedRowNumbers:z.array(z.number().int().positive()).min(1).max(1000)}).strict().parse(input);
  return adminMutation(this.store,actor,key,'master.source.confirm',v,async c=>{const preview=await this.previews.read(c,actor,v.previewToken),meta=preview.metadata,rows=preview.rows as any[],accepted=new Set(v.acceptedRowNumbers);ensure(accepted.size===v.acceptedRowNumbers.length&&rows.filter(r=>accepted.has(r.rowNumber)&&r.status!=='invalid').length===accepted.size,400,'INVALID_SOURCE_ROWS','确认范围含异常、重复选择或不存在行，请修正后重做预览');await this.sourceFile(c,actor,meta.sourceFileId,meta.manufacturerId);const m=(await c.query('SELECT active FROM manufacturers WHERE id=$1 FOR SHARE',[meta.manufacturerId])).rows[0];ensure(m?.active,400,'MANUFACTURER_UNAVAILABLE','厂家已停用');
   const id=randomUUID(),batchNo='SYS-'+randomUUID().replaceAll('-','').toUpperCase();await c.query('INSERT INTO product_source_batches(id,manufacturer_id,batch_no,source_batch_no,quoted_at,source_type,source_file_id,total_rows,valid_rows,invalid_rows,created_by,created_at,preview_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,meta.manufacturerId,batchNo,meta.sourceBatchNo,meta.quotedAt,meta.sourceType,meta.sourceFileId,rows.length,accepted.size,rows.filter(r=>r.status==='invalid').length,actor.id,this.store.clock(),JSON.stringify({...preview,acceptedRowNumbers:v.acceptedRowNumbers})]);
   for(const r of rows.filter(r=>accepted.has(r.rowNumber))){if(r.itemVariantId){const match=(await c.query('SELECT v.active,i.active AS item_active FROM item_variants v JOIN items i ON i.id=v.item_id WHERE v.id=$1 FOR SHARE OF v,i',[r.itemVariantId])).rows[0];ensure(match?.active&&match.item_active,409,'VERSION_CONFLICT','关联商品规格已变化，请重新预览');}await c.query('INSERT INTO product_source_lines(batch_id,row_number,raw_item_name,item_id,item_variant_id,specification,origin,grade,unit,reference_price,status,remark) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,r.rowNumber,r.rawItemName,r.itemId,r.itemVariantId,r.specification,r.origin,r.grade,r.unit,r.referencePrice,r.status,r.remark]);}
   await c.query("UPDATE product_source_batches SET status='confirmed' WHERE id=$1",[id]);
   await audited(this.store,c,actor,'master.source.confirm',{id,batchNo,rowNumbers:v.acceptedRowNumbers});return this.sourceDetail(c,id);
  });
 }
 private async sourceDetail(c:Client,id:string){const batch=(await c.query('SELECT b.*,m.name AS manufacturer_name FROM product_source_batches b JOIN manufacturers m ON m.id=b.manufacturer_id WHERE b.id=$1',[id])).rows[0];if(!batch)throw missing();const rows=(await c.query('SELECT * FROM product_source_lines WHERE batch_id=$1 ORDER BY row_number',[id])).rows;return {...camel(batch),rows:rows.map(camel),referenceNotice};}
 async sourceBatch(actor:Actor,id:string){uuid.parse(id);return this.store.db.transaction(async c=>{await this.readable(c,actor);return this.sourceDetail(c,id);});}
 async listSourceBatches(actor:Actor,input:unknown={}){const v=z.object({manufacturerId:uuid.optional(),itemVariantId:uuid.optional(),batchNo:text.max(100).default(''),sourceBatchNo:text.max(100).default(''),quotedFrom:date.optional(),quotedTo:date.optional(),page:z.number().int().positive().max(10000).default(1),pageSize:z.number().int().positive().max(100).default(50)}).strict().parse(input);return this.store.db.transaction(async c=>{await this.readable(c,actor);const rows=(await c.query("SELECT b.*,m.name AS manufacturer_name FROM product_source_batches b JOIN manufacturers m ON m.id=b.manufacturer_id WHERE ($1::uuid IS NULL OR b.manufacturer_id=$1) AND ($2='' OR strpos(b.batch_no,$2)>0) AND ($3='' OR strpos(b.source_batch_no,$3)>0) AND ($4::date IS NULL OR b.quoted_at>=$4) AND ($5::date IS NULL OR b.quoted_at<=$5) AND ($8::uuid IS NULL OR EXISTS(SELECT 1 FROM product_source_lines l WHERE l.batch_id=b.id AND l.item_variant_id=$8)) ORDER BY b.created_at DESC,b.id LIMIT $6 OFFSET $7",[v.manufacturerId||null,v.batchNo,v.sourceBatchNo,v.quotedFrom||null,v.quotedTo||null,v.pageSize,(v.page-1)*v.pageSize,v.itemVariantId||null])).rows;return {items:rows.map(camel),page:v.page,pageSize:v.pageSize,referenceNotice};});}
 async voidSourceBatch(actor:Actor,key:string,id:string,input:unknown){uuid.parse(id);const v=z.object({expectedVersion:version,reason}).strict().parse(input);return adminMutation(this.store,actor,key,'master.source.void',{id,...v},async c=>{const row=(await c.query('SELECT * FROM product_source_batches WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw missing();this.store.checkVersion(row.row_version,v.expectedVersion);ensure(row.status==='confirmed',409,'STATE_CONFLICT','来源批次已作废');await c.query("UPDATE product_source_batches SET status='voided',row_version=row_version+1,void_reason=$2,voided_by=$3,voided_at=$4 WHERE id=$1",[id,v.reason,actor.id,this.store.clock()]);await audited(this.store,c,actor,'master.source.void',{id,reason:v.reason});return this.sourceDetail(c,id);});}
}
