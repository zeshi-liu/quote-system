/** Decimal quantities and money remain strings. Null means unknown, not zero. */
export interface AnalyticsFilters {receivedFrom:string;receivedTo:string;hospitalId?:string;name?:string;spec?:string;groupBy:'week'|'month';}
export type AnalyticsChart='frequency'|'quantity'|'demandTrend'|'confirmationTrend'|'ranking'|'shortage';
export interface AnalyticsDrillFilters {chart:AnalyticsChart;hospitalId?:string;period?:string;name?:string;spec?:string;page?:number;pageSize?:number;}
export interface AnalyticsCoverage {confirmedKnownLines:number;confirmedUnknownLines:number;missingKnownLines:number;missingUnknownLines:number;pendingOrders:number;pendingLines:number;confirmedOrders:number;confirmationDateUnknownOrders:number;}
export interface AnalyticsMetrics {demandQuantity:string;confirmedQuantity:string|null;missingQuantity:string|null;coverage:AnalyticsCoverage;}
export interface AnalyticsHospitalMetrics extends AnalyticsMetrics {hospitalId:string;hospitalName:string;orders:number;}
export interface AnalyticsPeriodMetrics extends AnalyticsMetrics {
 /** Legacy start-date key retained for snapshot drill queries. */
 period:string;
 /** Full natural period in Asia/Shanghai: inclusive start and exclusive end dates. */
 periodStart:string;periodEnd:string;
 /** All periods intersecting the filter are returned. Zero orders means a known empty period. */
 orders:number;
}
export interface AnalyticsSnapshot {
 snapshotId:string;asOf:string;expiresAt:string;filters:AnalyticsFilters;unit:'kg';
 dateBasis:{cohort:'received_date';confirmationTrend:'actual_confirmation_date';timezone:'Asia/Shanghai';weekStartsOn:'monday'};
 summary:AnalyticsMetrics&{orders:number;confirmedAmount:string|null};
 charts:{frequency:{hospitalId:string;hospitalName:string;orders:number}[];quantity:AnalyticsHospitalMetrics[];demandTrend:AnalyticsPeriodMetrics[];confirmationTrend:AnalyticsPeriodMetrics[];ranking:{name:string;spec:string;demandQuantity:string;orders:number}[];shortage:AnalyticsHospitalMetrics[];};
 confirmationTrendCoverage:{orders:number;unknownDateOrders:number;knownQuantityLines:number;unknownQuantityLines:number;};
}
export interface AnalyticsOrderLine {name:string;spec:string;quantity:string;confirmedQuantity:string|null;missingQuantity:string|null;}
export interface AnalyticsOrderFact extends AnalyticsMetrics {
 id:string;orderNo:string;hospitalId:string;hospitalName:string;receivedDate:string;confirmedDate:string|null;
 entryMode:'normal'|'historical_backfill';revisionId:string;revisionNo:number;confirmationSourceId:string|null;confirmedAmount:string|null;
 confirmed:boolean;writable:boolean;demandLines:AnalyticsOrderLine[];resultLines:AnalyticsOrderLine[];
}
export interface AnalyticsOrderPage {snapshotId:string;asOf:string;expiresAt:string;items:AnalyticsOrderFact[];total:number;page:number;pageSize:number;notice:string;}
