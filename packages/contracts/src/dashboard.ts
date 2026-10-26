export type DashboardStage='review'|'inquiry'|'ready'|'pricing'|'exported'|'sent';
export interface DashboardTask {orderId:string;orderNo:string;hospitalName:string;receivedDate:string;revisionNo:number;stage:DashboardStage;lineCount:number;validSupplierCount:number;}
export interface DashboardReceivable {receivableId:string;orderId:string;orderNo:string;hospitalName:string;dueDate:string;amount:string;paid:string;balance:string;overdueDays:number;paused:boolean;}
export type DashboardNoticeKind='hospital_purchase'|'supplier_quote';
export interface DashboardNoticeRef {kind:DashboardNoticeKind;eventId:string;}
export interface DashboardNotice extends DashboardNoticeRef {orderId:string;orderNo:string;hospitalName:string;revisionNo:number;occurredAt:string;manufacturerName?:string;}
export interface DashboardNoticePage {total:number;limit:number;items:DashboardNotice[];}
export interface DashboardNoticeReceipt {acknowledged:DashboardNoticeRef[];}
export interface SalesDashboard {
 asOf:string;businessDate:string;
 notices:{unreadTotal:number;newPurchases:DashboardNoticePage;newSupplierQuotes:DashboardNoticePage;};
 tasks:{total:number;limit:number;counts:Record<DashboardStage,number>;items:DashboardTask[]};
 receivables:{outstandingCount:number;outstandingBalance:string;dueCount:number;dueBalance:string;overdueCount:number;overdueBalance:string;pausedCount:number;pausedBalance:string;followUpCount:number;limit:number;items:DashboardReceivable[]};
}
