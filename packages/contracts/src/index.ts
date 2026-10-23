export type DecimalString = string;
export type MarkupMethod = 'fixed' | 'percent' | 'multiplier';
export type SupplyState = 'quoted' | 'unavailable' | 'pending' | 'expired' | 'requote' | 'cancelled';
export interface User { id: string; name: string; role: 'salesperson' | 'admin' | 'hospital' }
export interface Session { authState: 'authenticated'; token: string; user: User; expiresAt: string; channel: 'mini' | 'trial' | 'pc' }
/** PC credentials stay in HttpOnly cookies; this is the only PC login response. */
export interface PcSession {authState:'authenticated';user:User;expiresAt:string;channel:'pc';csrf:string;}
export interface Hospital { id: string; name: string; paymentTermDays: number; purchasers: {id: string; name: string}[] }
export interface Manufacturer { id: string; name: string }
export interface PurchaseInput { id?: string; name: string; spec: string; quantity: string; checked: boolean }
export interface PurchaseLine extends PurchaseInput { id: string; unit: 'kg' }
export interface SupplierTask { id: string; slotNo: number; manufacturerId: string; manufacturerName: string; status: 'pending'|'submitted'|'requote'|'cancelled'; linkId: string|null; linkExpiresAt: string|null; submissionId: string|null; validUntil: string|null }
export interface OrderSummary { id: string; orderNo: string; hospitalName: string; receivedDate: string; paymentTermDays: number; revisionId: string; revisionNo: number; version: number; status: 'draft'|'frozen'|'quote_draft'|'quote_exported'|'quote_sent'|'completed'|'voided'; writable: boolean }
export interface OrderView extends OrderSummary { hospitalId: string; purchaserUserId: string; lines: PurchaseLine[]; tasks: SupplierTask[]; draftId: string|null }
export interface QuoteCell { taskId: string; manufacturerId: string; manufacturerName: string; state: SupplyState; price: string|null; validUntil: string|null; supplierQuoteLineId: string|null }
export interface ComparisonLine { purchaseLineId: string; name: string; spec: string; quantity: string; cells: QuoteCell[]; kind: 'priced'|'missing'|'blocked'; lowestPrice: string|null }
export interface Comparison { orderId: string; orderVersion: number; submittedCount: number; lines: ComparisonLine[] }
export interface DraftLine { publicRemark?:string; purchaseLineId: string; name: string; spec: string; quantity: string; kind: 'priced'|'missing'|'blocked'; baseSupplierQuoteLineId: string|null; baseManufacturerName: string|null; basePrice: string|null; baseValid: boolean; supplyValid?: boolean; adoptedLowestPrice?: string|null; hasNewSupplierData?: boolean; selectionMode: 'auto'|'manual'; markupMethod: MarkupMethod|null; parameterValue: string|null; recommendedPrice: string|null; finalPrice: string|null; finalConfirmed: boolean; lossReason: string; amount: string|null }
export interface DraftLineInput { publicRemark?:string; purchaseLineId: string; baseSupplierQuoteLineId: string|null; selectionMode: 'auto'|'manual'; markupMethod: MarkupMethod|null; parameterValue: string|null; finalPrice: string|null; finalConfirmed: boolean; lossReason: string }
export interface Draft { id: string; quoteId: string; orderId: string; version: number; hospitalValidUntil: string|null; maxValidUntil: string|null; lines: DraftLine[]; total: string|null; readyForNextStep: boolean }
export interface GeneratedLink { linkId: string; expiresAt: string; orderVersion: number; url?: string; originalUnavailable?: boolean }
export interface SupplierLineInput { purchaseLineId: string; status: 'quoted'|'unavailable'; unitPrice: string|null }
export interface SupplierForm { manufacturerName: string; revisionNo: number; receivedDate: string; linkExpiresAt: string; lines: PurchaseLine[]; submitted: {id: string; validUntil: string; lines: SupplierLineInput[]}|null }
export interface ApiError { code: string; message: string; details?: unknown }
export interface ApiEnvelope<T> { data: T; meta: {requestId: string} }
export * from './delivery';
export * from './archive';
