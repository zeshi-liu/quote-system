export type PaymentState='unpaid'|'partial'|'settled';
export type DueState='upcoming'|'due'|'overdue';
export interface ReceivableFilters {hospitalId?:string;receivedFrom?:string;receivedTo?:string;keyword?:string;ownership?:'mine'|'readonly';paymentState?:PaymentState|'outstanding';dueState?:DueState;page?:number;pageSize?:number;}
export interface Receivable {id:string;orderId:string;orderNo:string;hospitalId:string;hospitalName:string;owner:{id:string;name:string};receivedDate:string;paymentTermDays:number;dueDate:string;amount:string;paid:string;balance:string;paymentState:PaymentState;dueState:DueState;writable:boolean;orderVersion:number;}
export interface PaymentRecord {id:string;receivableId:string;recordType:'regular'|'historical_opening';amount:string;paidDate:string|null;remark:string;recordedBy:string;recordedByName:string;recordedAt:string;status:'active'|'void';voidReason:string|null;voidedBy:string|null;voidedByName:string|null;voidedAt:string|null;correctsPaymentRecordId:string|null;}
export interface ReceivablePage {items:Receivable[];total:number;page:number;pageSize:number;asOf:string;}
export interface ReceivableDetail {receivable:Receivable;payments:PaymentRecord[];asOf:string;originalOrder:{id:string;orderNo:string};}
// null is accepted only when correcting a void historical opening whose actual date is unknown.
export interface AddPaymentInput {amount:string;paidDate:string|null;remark?:string;correctsPaymentRecordId?:string;}
export interface VoidPaymentInput {reason:string;}
export interface PaymentMutationResult {orderId:string;receivable:Receivable;payment:PaymentRecord;}
