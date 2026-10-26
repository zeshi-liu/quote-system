// 基础资料仅管理员 PC 可写；来源价格不进入本次询价、计价契约。
export type MasterDataKind='hospitals'|'purchasers'|'manufacturers'|'items'|'variants'|'templates';
export interface MasterVersion {id:string;version:number;active:boolean;}
export interface HospitalMaster extends MasterVersion {name:string;salesUserId:string;}
export interface PurchaserMaster extends MasterVersion {name:string;phone:string;hospitalId:string;}
export interface ManufacturerMaster extends MasterVersion {name:string;contactName:string;contactPhone:string;}
export interface ItemMaster extends MasterVersion {name:string;category:string;aliases:string[];}
export interface VariantMaster extends MasterVersion {itemId:string;specification:string;origin:string;grade:string;packageDescription:string;defaultUnit:'kg';}
export interface QuoteTemplateMaster extends MasterVersion {name:string;sellerName:string;contactPhone:string;fixedNotes:string;logoFileId:string|null;isDefault:boolean;}
export type MasterRecord=HospitalMaster|PurchaserMaster|ManufacturerMaster|ItemMaster|VariantMaster|QuoteTemplateMaster;
export interface MasterQuery {keyword?:string;includeInactive?:boolean;page?:number;pageSize?:number;}
export interface MasterPage {items:MasterRecord[];total:number;page:number;pageSize:number;}
export interface CatalogVariant {itemId:string;name:string;category:string;variantId:string;specification:string;origin:string;grade:string;packageDescription:string;defaultUnit:'kg';aliases:string[];}
export interface InternalAccount extends MasterVersion {loginName:string;name:string;phone:string|null;role:'salesperson'|'admin';passwordSetupRequired:boolean;}
export interface CreateInternalAccount {loginName:string;name:string;phone:string;role:'salesperson'|'admin';}
export interface UpdateInternalAccount {expectedVersion:number;name:string;phone:string;role:'salesperson'|'admin';active:boolean;}
export interface TemporaryCredentialResult {user:InternalAccount;credentialGenerated:true;temporaryPassword?:string;temporaryPasswordExpiresAt:string;}
export interface PasswordSetupSession {authState:'password_setup_required';setupTicket:string;expiresAt:string;}
export interface SourceFieldMapping {rawItemName:string;referencePrice:string;specification?:string;origin?:string;grade?:string;unit?:string;itemVariantId?:string;remark?:string;}
export interface SourcePreviewInput {manufacturerId:string;sourceType:'manual'|'excel';sourceBatchNo?:string;quotedAt:string;sourceFileId?:string|null;rows:Record<string,unknown>[];mapping?:SourceFieldMapping;}
export interface SourcePreviewLine {rowNumber:number;rawItemName:string;referencePrice:string;specification:string;origin:string;grade:string;unit:string;itemVariantId:string|null;itemId:string|null;remark:string;status:'valid'|'invalid'|'unmatched'|'duplicate';errors:string[];}
export interface SourceBatchPreview {previewToken:string;rows:SourcePreviewLine[];totalRows:number;validRows:number;invalidRows:number;referenceNotice:'仅资料参考，不参与本次报价';}
export interface SourceBatch {id:string;manufacturerId:string;manufacturerName:string;batchNo:string;sourceBatchNo:string;quotedAt:string;sourceType:'manual'|'excel';sourceFileId:string|null;status:'confirmed'|'voided';totalRows:number;validRows:number;invalidRows:number;createdBy:string;createdAt:string;version:number;voidReason:string|null;voidedBy:string|null;voidedAt:string|null;referenceNotice:'仅资料参考，不参与本次报价';previewSnapshot:{rows:SourcePreviewLine[];rawRows:Record<string,unknown>[];mapping:SourceFieldMapping;acceptedRowNumbers:number[]};rows:Omit<SourcePreviewLine,'errors'>[];}
export interface HandoffScope {fromSalesUserId:string;toSalesUserId:string;orderIds:string[];hospitalIds:string[];reason:string;}
export interface HandoffPreview {from:{id:string;name:string;role:string;active:boolean;version:number};to:{id:string;name:string;role:string;active:boolean;version:number};orders:{id:string;orderNo:string;hospitalId:string;version:number;status:string;receivableId:string|null;amount:string|null;paid:string;pendingException:boolean}[];hospitals:HospitalMaster[];selectedOrderIds:string[];selectedHospitalIds:string[];orderCount:number;receivableCount:number;exceptionCount:number;previewToken:string;}
export interface HandoffResult {id:string;fromSalesUserId:string;toSalesUserId:string;orderIds:string[];hospitalIds:string[];deactivated:true;}
