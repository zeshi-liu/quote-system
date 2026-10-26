export type DashboardStage='review'|'inquiry'|'ready'|'pricing'|'exported'|'sent';
export interface DashboardTask {orderId:string;orderNo:string;hospitalName:string;receivedDate:string;revisionNo:number;stage:DashboardStage;lineCount:number;validSupplierCount:number;}
export interface DashboardReceivable {receivableId:string;orderId:string;orderNo:string;hospitalName:string;dueDate:string;amount:string;paid:string;balance:string;overdueDays:number;paused:boolean;}
export interface SalesDashboard {
 asOf:string;businessDate:string;
 tasks:{total:number;limit:number;counts:Record<DashboardStage,number>;items:DashboardTask[]};
 receivables:{outstandingCount:number;outstandingBalance:string;dueCount:number;dueBalance:string;overdueCount:number;overdueBalance:string;pausedCount:number;pausedBalance:string;followUpCount:number;limit:number;items:DashboardReceivable[]};
}
