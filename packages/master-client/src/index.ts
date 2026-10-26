import type {MasterDataKind,MasterPage,MasterRecord,InternalAccount,CatalogVariant,SourceBatchPreview,SourcePreviewInput,SourceFieldMapping,HandoffPreview,HandoffScope,RawParseRow} from '../../contracts/src/index';
export type AdminKind=MasterDataKind|'accounts';
export type AdminTab=AdminKind|'source-batches'|'handoff'|'catalog';
export type FormValues=Record<string,string|number|boolean>;
export const kindLabels:Record<AdminKind,string>={accounts:'内部账号',hospitals:'医院',purchasers:'医院采购员',manufacturers:'厂家',items:'标准商品',variants:'商品规格',templates:'报价模板'};
export const tabLabels:Record<AdminTab,string>={...kindLabels,'source-batches':'来源批次',handoff:'离职专项交接',catalog:'商品查询'};
export interface Field {key:string;label:string;required?:boolean;max?:number;type?:'textarea'|'phone'|'sales'|'hospital'|'item'|'role'|'logo';immutable?:boolean;}
export function masterFields(kind:AdminKind):Field[]{
 const name:Field={key:'name',label:kind==='accounts'||kind==='purchasers'?'姓名':'名称',required:true,max:100};
 switch(kind){
 case 'accounts':return [{key:'loginName',label:'登录名',required:true,max:100,immutable:true},name,{key:'phone',label:'手机号',type:'phone',required:true,max:11},{key:'role',label:'身份',type:'role',required:true}];
 case 'hospitals':return [name,{key:'salesUserId',label:'新单负责销售',type:'sales',required:true}];
 case 'purchasers':return [name,{key:'phone',label:'手机号',type:'phone',required:true,max:11},{key:'hospitalId',label:'所属医院',type:'hospital',immutable:true,required:true}];
 case 'manufacturers':return [name,{key:'contactName',label:'联系人',max:200},{key:'contactPhone',label:'联系电话',max:30}];
 case 'items':return [name,{key:'category',label:'分类',max:200},{key:'aliases',label:'别名（每行一个，最多 50 个）',type:'textarea',max:5100}];
 case 'variants':return [{key:'itemId',label:'标准商品',type:'item',immutable:true,required:true},{key:'specification',label:'炮制 / 商品规格',max:200},{key:'origin',label:'产地',max:200},{key:'grade',label:'等级',max:200},{key:'packageDescription',label:'包装说明',max:200}];
 case 'templates':return [name,{key:'sellerName',label:'销售方名称',required:true,max:200},{key:'contactPhone',label:'联系电话',max:30},{key:'fixedNotes',label:'固定备注',type:'textarea',max:2000},{key:'logoFileId',label:'模板标志图片',type:'logo'}];
 }
}
export function masterForm(kind:AdminKind,record?:any):FormValues{const values:FormValues={active:record?.active??true};for(const f of masterFields(kind))values[f.key]=record?.[f.key]??'';if(kind==='accounts')values.role=record?.role||'salesperson';if(kind==='items')values.aliases=(record?.aliases||[]).join('\n');if(kind==='templates')values.isDefault=record?.isDefault??false;if(record){values.id=record.id;values.expectedVersion=record.version;values.originalRole=record.role||'';values.originalActive=record.active;}return values;}
export interface AdminReview {label:string;path:string;body:Record<string,unknown>;details:{label:string;value:string}[];notice:string;}
const text=(v:unknown)=>String(v??'').trim();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireId(v:unknown,label:string){if(!uuid.test(text(v)))throw new Error('请选择'+label+'。');return text(v);}
export function reviewMaster(kind:AdminKind,form:FormValues,userId?:string):AdminReview{
 const body:Record<string,unknown>={};if(form.id){body.id=requireId(form.id,'原资料');const v=Number(form.expectedVersion);if(!Number.isInteger(v)||v<1)throw new Error('资料版本缺失，请重新加载。');body.expectedVersion=v;}body.active=!!form.active;
 const details:{label:string;value:string}[]=[];
 for(const field of masterFields(kind)){
  if(kind==='accounts'&&form.id&&field.key==='loginName')continue;
  let value:any=text(form[field.key]);if(field.required&&!value)throw new Error('请填写'+field.label+'。');if(field.max&&value.length>field.max)throw new Error(field.label+'内容过长。');
  if(['sales','hospital','item'].includes(field.type||''))value=requireId(value,field.label);
  if(field.type==='phone'&&!/^1\d{10}$/.test(value))throw new Error('手机号须为 11 位中国大陆手机号。');
  if(field.type==='role'&&!['salesperson','admin'].includes(value))throw new Error('请选择内部身份。');
  if(field.key==='aliases'){value=[...new Set(value.split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean))];if(value.length>50||value.some((s:string)=>s.length>100))throw new Error('别名最多 50 个，每个 1–100 字。');}
  if(field.key==='logoFileId')value=value?requireId(value,'已上传的模板图片'):null;
  body[field.key]=value;details.push({label:field.label,value:Array.isArray(value)?value.join('、'):value===null?'未设置':String(value||'未填写')});
 }
 if(kind==='templates'){body.isDefault=!!form.isDefault;if(body.isDefault&&!body.active)throw new Error('默认报价模板必须启用。');details.push({label:'默认模板',value:body.isDefault?'是':'否'});}
 if(kind==='accounts'){
  if(form.id===userId&&(body.role!==form.originalRole||body.active!==form.originalActive))throw new Error('不能通过账号维护更改本人的身份或停用本人。');
  if(!form.id)delete body.active;else delete body.id;
 }
 details.push({label:'启用状态',value:body.active===false?'停用':'启用'});
 return {label:(form.id?'修改':'新增')+kindLabels[kind],path:kind==='accounts'?'/admin/users'+(form.id?'/'+form.id:''):'/admin/master-data/'+kind,body,details,notice:kind==='hospitals'?'负责销售变更仅影响之后的新订单；旧订单当前负责人、账期及历史记录保留。':kind==='accounts'?'销售仍负责医院或待处理业务时，须先完成专项交接；服务端复查最后有效管理员。':kind==='templates'?'新导出使用当前默认模板；已生成文件及其模板快照保留。':'资料启停不删除已有业务记录。'};
}
export interface DescriptorStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
export function adminStorage(storage:DescriptorStorage):DescriptorStorage{return {getItem:key=>storage.getItem('admin-'+key),setItem:(key,value)=>storage.setItem('admin-'+key,value),removeItem:key=>storage.removeItem('admin-'+key)};}
export function isDenied(e:unknown){return [401,403,404,410].includes((e as {status?:number})?.status||0);}
export function assertPreviewToken(token:unknown){if(typeof token!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(token))throw new Error('服务端预览凭证无法核实，请重新预览。');}
export function assertAdminReceipt(op:{path:string;body:Record<string,unknown>;metadata?:Record<string,unknown>},result:unknown){
 const r=result as any;if(!r||typeof r!=='object')throw new Error('管理员操作回执无法核实，请继续核对原操作。');
 const fail=()=>{throw new Error('管理员操作回执与原范围不一致，请继续核对原操作。');};
 if(op.path.startsWith('/admin/users')){
  const id=op.path.match(/^\/admin\/users\/([^/]+)/)?.[1];if(!r.user?.id||id&&r.user.id!==decodeURIComponent(id))fail();
  if(!id&&['loginName','name','phone','role'].some(k=>r.user[k]!==op.body[k]))fail();
  if(id&&!op.path.match(/reset-(password|binding)$/)&&['name','phone','role','active'].some(k=>r.user[k]!==op.body[k]))fail();
  if(op.body.expectedVersion!==undefined&&(!Number.isInteger(r.user.version)||r.user.version<=Number(op.body.expectedVersion)))fail();
  if(op.path.endsWith('reset-password')||!id){if(r.credentialGenerated!==true||typeof r.temporaryPasswordExpiresAt!=='string')fail();}
  if(op.path.endsWith('reset-binding')&&r.bindingReset!==true)fail();
  return;
 }
 if(op.path.startsWith('/admin/master-data/')){if(typeof r.id!=='string'||op.body.id&&r.id!==op.body.id||op.body.expectedVersion!==undefined&&(!Number.isInteger(r.version)||r.version<=Number(op.body.expectedVersion)))fail();for(const [k,v] of Object.entries(op.body))if(!['id','expectedVersion'].includes(k)&&JSON.stringify(r[k])!==JSON.stringify(v))fail();return;}
 if(op.path==='/admin/source-batches/confirm'){if(!r.id||r.status!=='confirmed'||!r.previewSnapshot||JSON.stringify(r.previewSnapshot.acceptedRowNumbers)!==JSON.stringify(op.body.acceptedRowNumbers))fail();return;}
 const source=op.path.match(/^\/admin\/source-batches\/([^/]+)\/void$/);if(source){if(r.id!==source[1]||r.status!=='voided'||r.voidReason!==op.body.reason)fail();return;}
 if(op.path==='/admin/sales-handoffs'){
  const expected=op.metadata?.handoff as any;
  const ids=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(id=>typeof id==='string'&&!!id)&&new Set(v).size===v.length;
  if(!expected||typeof expected.fromSalesUserId!=='string'||!expected.fromSalesUserId||typeof expected.toSalesUserId!=='string'||!expected.toSalesUserId||expected.fromSalesUserId===expected.toSalesUserId||expected.deactivated!==true||!ids(expected.orderIds)||!ids(expected.hospitalIds))fail();
  if(typeof r.id!=='string'||!r.id||r.deactivated!==expected.deactivated||r.fromSalesUserId!==expected.fromSalesUserId||r.toSalesUserId!==expected.toSalesUserId||!ids(r.orderIds)||!ids(r.hospitalIds)||!equalIds(expected.orderIds,r.orderIds)||!equalIds(expected.hospitalIds,r.hospitalIds))fail();
 }
}
export type Read=<T>(path:string)=>Promise<T>;
export class MasterReader {
 page:MasterPage|null=null;constructor(private read:Read){}
 async load(kind:MasterDataKind,query:{keyword?:string;includeInactive?:boolean;page?:number;pageSize?:number}={}){const p=new URLSearchParams({keyword:(query.keyword||'').slice(0,100),includeInactive:String(query.includeInactive??true),page:String(Math.min(10000,Math.max(1,Math.trunc(query.page||1)))),pageSize:String(Math.min(100,Math.max(1,Math.trunc(query.pageSize||25))))});try{this.page=await this.read<MasterPage>('/admin/master-data/'+kind+'?'+p);if(!Array.isArray(this.page?.items))throw new Error('资料列表响应无法核实。');return this.page;}catch(e){this.page=null;throw e;}}
}
export class CatalogReader {items:CatalogVariant[]=[];constructor(private read:Read){}choose(variantId:string):CatalogVariant{const row=this.items.find(r=>r.variantId===variantId);if(!row)throw new Error('所选商品规格已变化，请重新查询。');return {itemId:row.itemId,variantId:row.variantId,name:row.name,category:row.category,specification:row.specification,origin:row.origin,grade:row.grade,packageDescription:row.packageDescription,defaultUnit:row.defaultUnit,aliases:[...row.aliases]};}async search(keyword=''){try{const r=await this.read<{items:CatalogVariant[]}>('/catalog/variants?keyword='+encodeURIComponent(keyword.trim().slice(0,100))+'&limit=100');if(!Array.isArray(r?.items))throw new Error('商品列表响应无法核实。');this.items=r.items;return r.items;}catch(e){this.items=[];throw e;}}}
export const sourceFields:{key:keyof SourceFieldMapping;label:string;required?:boolean}[]=[{key:'rawItemName',label:'来源品名',required:true},{key:'referencePrice',label:'来源参考价',required:true},{key:'specification',label:'规格'},{key:'origin',label:'产地'},{key:'grade',label:'等级'},{key:'unit',label:'单位'},{key:'itemVariantId',label:'商品规格关联'},{key:'remark',label:'备注'}];
export function emptySourceRow():Record<string,unknown>{return {rawItemName:'',referencePrice:'',specification:'',origin:'',grade:'',unit:'kg',itemVariantId:'',remark:''};}
export class SourceBatchDraft {
 constructor(private readonlyMode:()=>boolean=()=>false){}
 private writable(){if(this.readonlyMode())throw new Error('当前来源资料只读。');}
 rejectPreview(error:unknown){if(['VERSION_CONFLICT','PREVIEW_EXPIRED','PREVIEW_INVALID'].includes((error as any)?.code))this.invalidate();}
 mappedCell(index:number,field:keyof SourceFieldMapping){const key=this.mapping[field];return key?String(this.rows[index]?.[key]??''):'';}
 setMappedCell(index:number,field:keyof SourceFieldMapping,value:string){this.writable();if(!this.rows[index])throw new Error('校对行不存在。');const key=this.mapping[field]||('review_'+field);this.mapping[field]=key;this.rows[index][key]=value;this.invalidate();}
 rows:Record<string,unknown>[]=[emptySourceRow()];rawRows:RawParseRow[]=[];mapping:SourceFieldMapping={rawItemName:'rawItemName',referencePrice:'referencePrice'};preview:SourceBatchPreview|null=null;selected:number[]=[];reviewed:number[]=[];headerRow=1;
 invalidate(){this.preview=null;this.selected=[];this.reviewed=[];}
 useParsed(rawRows:RawParseRow[],headerRow:number){this.writable();if(!Number.isInteger(headerRow)||headerRow<0||headerRow>rawRows.length)throw new Error('请填写有效表头行号（0 表示无表头）。');const data=rawRows.filter(r=>headerRow===0||r.rowNumber>headerRow);if(!data.length||data.length>1000)throw new Error('来源批次须有 1–1000 个数据行。');this.rawRows=JSON.parse(JSON.stringify(rawRows));this.headerRow=headerRow;this.rows=data.map(r=>Object.fromEntries(r.cells.map((v,i)=>['c'+i,v])));this.mapping={rawItemName:'c0',referencePrice:'c1'};this.invalidate();}
 previewBody(meta:Omit<SourcePreviewInput,'rows'|'mapping'>):SourcePreviewInput{this.writable();requireId(meta.manufacturerId,'厂家');if(!/^\d{4}-\d{2}-\d{2}$/.test(meta.quotedAt))throw new Error('请选择来源报价日期。');if(!this.rows.length||this.rows.length>1000)throw new Error('来源批次须有 1–1000 行。');if(!this.mapping.rawItemName||!this.mapping.referencePrice)throw new Error('请映射品名及来源参考价。');return {...meta,rows:JSON.parse(JSON.stringify(this.rows)),mapping:Object.fromEntries(Object.entries(this.mapping).filter(([,column])=>column)) as unknown as SourceFieldMapping};}
 select(rowNumber:number,checked:boolean,reviewed=false){this.writable();const row=this.preview?.rows.find(r=>r.rowNumber===rowNumber);if(!row||row.status==='invalid'||row.errors.length)throw new Error('异常行不能确认，请回到原始资料修正后重新预览。');if(checked&&['unmatched','duplicate'].includes(row.status)&&!reviewed&&!this.reviewed.includes(rowNumber))throw new Error('重复或未匹配行须逐行核对后明确确认。');this.selected=this.selected.filter(n=>n!==rowNumber);if(checked)this.selected.push(rowNumber);if(reviewed&&!this.reviewed.includes(rowNumber))this.reviewed.push(rowNumber);}
 confirmBody(){this.writable();assertPreviewToken(this.preview?.previewToken);if(!this.selected.length)throw new Error('请显式选择要确认的行。');const accepted=[...this.selected].sort((a,b)=>a-b);for(const n of accepted){const r=this.preview?.rows.find(r=>r.rowNumber===n);if(!r||r.status==='invalid'||r.errors.length||['unmatched','duplicate'].includes(r.status)&&!this.reviewed.includes(n))throw new Error('确认范围有尚未逐行核对的异常或资料行。');}return {previewToken:this.preview!.previewToken,acceptedRowNumbers:accepted};}
}
const equalIds=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
export class HandoffDraft {
 fromId='';toId='';reason='';orders:string[]=[];hospitals:string[]=[];preview:HandoffPreview|null=null;reviewScope='';
 rejectPreview(error:unknown){if(['VERSION_CONFLICT','PREVIEW_EXPIRED','PREVIEW_INVALID'].includes((error as any)?.code)){this.preview=null;this.reviewScope='';}}
 resetPreview(){this.preview=null;this.reviewScope='';this.orders=[];this.hospitals=[];}
 scope(empty=false):HandoffScope{requireId(this.fromId,'原销售');requireId(this.toId,'接手销售');if(this.fromId===this.toId)throw new Error('接手人须为另一有效销售。');const reason=this.reason.trim();if(!empty&&(!reason||reason.length>500))throw new Error('请填写 1–500 字交接原因。');return {fromSalesUserId:this.fromId,toSalesUserId:this.toId,orderIds:empty?[]:[...this.orders],hospitalIds:empty?[]:[...this.hospitals],reason:reason||'查询离职待交接范围'};}
 selectAll(){if(!this.preview)throw new Error('请先读取待交接范围。');this.orders=this.preview.orders.map(r=>r.id);this.hospitals=this.preview.hospitals.map(r=>r.id);this.reviewScope='';}
 acceptPreview(preview:HandoffPreview,scope:HandoffScope){assertPreviewToken(preview.previewToken);if(preview.from.id!==scope.fromSalesUserId||preview.to.id!==scope.toSalesUserId||!equalIds(preview.selectedOrderIds,scope.orderIds)||!equalIds(preview.selectedHospitalIds,scope.hospitalIds))throw new Error('交接预览与所选范围不一致，请重新读取。');this.preview=preview;this.reviewScope=JSON.stringify(scope);}
 executionMetadata(){this.executionBody();const p=this.preview!;return {handoff:{fromSalesUserId:p.from.id,toSalesUserId:p.to.id,orderIds:[...p.selectedOrderIds],hospitalIds:[...p.selectedHospitalIds],deactivated:true}};}
 executionBody(){assertPreviewToken(this.preview?.previewToken);const p=this.preview!;if(p.from.id!==this.fromId||p.to.id!==this.toId||!equalIds(this.orders,p.orders.map(o=>o.id))||!equalIds(this.hospitals,p.hospitals.map(h=>h.id))||!equalIds(this.orders,p.selectedOrderIds)||!equalIds(this.hospitals,p.selectedHospitalIds)||this.reviewScope&&this.reviewScope!==JSON.stringify(this.scope()))throw new Error('请明确选全待交接医院和订单，并按最终范围重新预览。');this.scope();return {previewToken:p.previewToken};}
}
export type {MasterDataKind,MasterRecord,InternalAccount,CatalogVariant,SourceBatchPreview,SourcePreviewInput,HandoffPreview,RawParseRow};
