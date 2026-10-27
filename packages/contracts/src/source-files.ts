export type SourcePurpose='purchase_image'|'purchase_excel'|'historical_attachment'|'payment_proof'|'manufacturer_source'|'template_logo';
export type SourceReference={kind:'purchase_revision';orderId:string;revisionId:string}|{kind:'historical_order';orderId:string}|{kind:'payment_record';orderId:string;paymentRecordId:string}|{kind:'manufacturer';manufacturerId:string}|{kind:'template'};
export interface SourceFile {id:string;purpose:SourcePurpose;reference:SourceReference;fileName:string;mimeType:string;fileType:'png'|'jpg'|'jpeg'|'xlsx'|'xls'|'csv';byteSize:number;sha256:string;uploadedBy:string;createdAt:string;parentFileId:string|null;}
export interface SourceUploadInput {reference:SourceReference;purpose:SourcePurpose;fileName:string;mimeType:string;base64:string;parentFileId?:string;}
export interface SourceDownloadGrant {token:string;downloadPath:string;expiresAt:string;}
export interface RawParseRow {rowNumber:number;cells:string[];errors:string[];}
export interface ParsingJob {id:string;fileId:string;status:'pending'|'processing'|'succeeded'|'failed';parserType:'spreadsheet'|'ocr';attempts:number;errorCode:string|null;errorMessage:string|null;retryable:boolean;resultUnknown:boolean;rawRows:RawParseRow[]|null;confidence:number|null;createdAt:string;completedAt:string|null;applied:boolean;}
/** Row numbers are one based; column indices are zero based. headerRow=0 includes all rows. */
export interface SpreadsheetFieldMapping {headerRow:number;columns:{name:number;quantity:number;spec?:number;unit?:number;remark?:number;sourcePrice?:number};}
export interface ParsedCandidate {rowNumber:number;name:string;spec:string;quantity:string|null;unit:string;remark:string;sourcePrice:string|null;checked:false;errors:string[];}
export interface ParsePreview {fileId:string;jobId:string;rows:ParsedCandidate[];validRows:number;invalidRows:number;requiresHumanReview:true;}
export interface ApplyParsedLinesInput {expectedVersion:number;mapping:SpreadsheetFieldMapping;rowNumbers?:number[];}
