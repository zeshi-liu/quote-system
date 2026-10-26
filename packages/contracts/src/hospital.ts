/** Dedicated hospital DTOs must never grow internal quotation or financial fields. */
export type HospitalLineSourceType='ocr'|'excel'|'product_library'|'custom_input';
export interface HospitalPurchaseInput {sourceType?:HospitalLineSourceType;itemId?:string|null;itemVariantId?:string|null;id?:string;name:string;spec:string;quantity:string;unit:'kg';remark:string;sourceFileId?:string|null;parsingJobId?:string|null;sourceRowNumber?:number|null;}
export interface HospitalPurchaseLine extends HospitalPurchaseInput {id:string;sourceType:HospitalLineSourceType;}
export type HospitalOrderStatus='draft'|'submitted'|'processing'|'completed'|'voided';
export interface HospitalOrderSummary {id:string;orderNo:string;hospitalName:string;receivedDate:string;revisionId:string;revisionNo:number;version:number;submissionSource:'hospital_self'|'sales_entry';submittedAt:string|null;status:HospitalOrderStatus;writable:boolean;lineCount:number;}
export interface HospitalOrder extends HospitalOrderSummary {lines:HospitalPurchaseLine[];}
export interface HospitalOrderPage {items:HospitalOrderSummary[];page:number;pageSize:number;total:number;}
export interface HospitalBootstrap {hospital:{id:string;name:string};purchaser:{id:string;name:string};}
