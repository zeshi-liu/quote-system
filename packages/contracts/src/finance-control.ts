export interface HospitalPaymentTerm {hospitalId:string;paymentTermDays:number;version:number;}
export interface SetHospitalPaymentTermInput {paymentTermDays:number;expectedVersion:number;}
export interface PaymentTermAdjustment {id:string;orderId:string;originalTermDays:number;beforeTermDays:number;afterTermDays:number;beforeDueDate:string;afterDueDate:string;reason:string;recordedBy:string;recordedByName:string;recordedAt:string;}
export interface OrderPaymentTerms {orderId:string;originalTermDays:number|null;effectiveTermDays:number|null;dueDate:string|null;version:number;writable:boolean;adjustments:PaymentTermAdjustment[];}
export interface AdjustPaymentTermInput {newTermDays:number;reason:string;expectedVersion:number;}
export interface PaymentTermMutationResult {orderId:string;terms:OrderPaymentTerms;adjustment:PaymentTermAdjustment;}
export type ReceivableExceptionType='cancellation'|'refund';
export interface ReceivableException {id:string;receivableId:string;exceptionType:ReceivableExceptionType;reason:string;status:'pending_verification'|'resolved';recordedBy:string;recordedByName:string;recordedAt:string;verificationResult:'continue_collection'|null;resolveReason:string|null;resolvedBy:string|null;resolvedByName:string|null;resolvedAt:string|null;}
export interface ReceivableExceptionHistory {orderId:string;receivableId:string;paused:boolean;writable:boolean;items:ReceivableException[];}
export interface AddReceivableExceptionInput {exceptionType:ReceivableExceptionType;reason:string;}
export interface ResolveReceivableExceptionInput {verificationResult:'continue_collection';resolveReason:string;}
export interface ExceptionMutationResult {orderId:string;receivableId:string;exception:ReceivableException;paused:boolean;}
export interface ReceivableReminderItem {id:string;orderId:string;orderNo:string;hospitalId:string;hospitalName:string;ownerId:string;ownerName:string;amount:string;paid:string;balance:string;dueDate:string;dueState:'due'|'overdue';paused:boolean;writable:boolean;}
export interface ReceivableReminderPage {items:ReceivableReminderItem[];total:number;page:number;pageSize:number;asOf:string;}
export interface SubscriptionReportInput {templateId:string;decision:'accept'|'reject';}
export interface SubscriptionReport {id:string;userId:string;templateId:string;decision:'accept'|'reject';source:'client_reported';recordedAt:string;}
