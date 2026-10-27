/** Public hospital document: no supplier costs, loss reasons or internal identifiers. */
export interface QuoteDocument {
 schemaVersion:1; quoteNo:string; versionNo:number; hospitalName:string; sellerName:string;
 quoteDate:string; salespersonName:string; contact:string; validUntil:string|null;
 taxNote:string; notes:string;
 lines:{position:number;name:string;spec:string;unit:'kg';quantity:string;status:'priced'|'missing';unitPrice:string|null;amount:string|null;remark:string}[];
 total:string|null;
}
export type ExportFormat='pdf'|'xlsx';
export interface QuoteDeliveryVersion {
 latestJob?:ExportJob|null;
 id:string;quoteId:string;orderId:string;versionNo:number;version:number;
 status:'draft'|'exported'|'sent'|'confirmed'|'void';document:QuoteDocument;
 firstExportedAt:string|null;useInvalidatedAt:string|null;firstSentAt:string|null;
 hospitalConfirmedAt:string|null;recordedAt:string|null;backfillReason:string|null;
 occupied:boolean;eligible:boolean;blockReason:string|null;requiresLossAcknowledgement:boolean;
 files:{id:string;format:ExportFormat;filename:string;createdAt:string}[];
 sends:{id:string;channel:string;remark:string;recordedAt:string}[];
 receivable:{amount:string;paid:string;balance:string;dueDate:string}|null;
}
export interface ExportAccepted {orderId:string;jobId:string;exportId:string;versionId:string;}
export interface ExportJob {id:string;orderId:string;versionId:string;state:'queued'|'running'|'succeeded'|'failed';attempts:number;error:string|null;fileId:string|null;retryAt:string|null;}
