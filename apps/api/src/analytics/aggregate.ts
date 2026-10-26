import Decimal from 'decimal.js';
import type {AnalyticsCoverage,AnalyticsMetrics,AnalyticsOrderFact,AnalyticsOrderLine,AnalyticsSnapshot,AnalyticsFilters,AnalyticsPeriodMetrics} from '../../../../packages/contracts/src/analytics';
export const sum=(values:(string|null)[])=>values.reduce<Decimal>((n,v)=>v===null?n:n.plus(v),new Decimal(0)).toFixed(2);
const knownSum=(values:(string|null)[])=>values.some(v=>v!==null)?sum(values):null;
export const emptyCoverage=():AnalyticsCoverage=>({confirmedKnownLines:0,confirmedUnknownLines:0,missingKnownLines:0,missingUnknownLines:0,pendingOrders:0,pendingLines:0,confirmedOrders:0,confirmationDateUnknownOrders:0});
export function lineMetrics(demand:AnalyticsOrderLine[],results:AnalyticsOrderLine[],confirmed:boolean,confirmedDate:string|null):AnalyticsMetrics {
 const coverage=emptyCoverage();coverage.pendingOrders=confirmed?0:1;coverage.confirmedOrders=confirmed?1:0;coverage.pendingLines=confirmed?0:demand.length;coverage.confirmationDateUnknownOrders=confirmed&&!confirmedDate?1:0;
 for(const line of results){line.confirmedQuantity===null?coverage.confirmedUnknownLines++:coverage.confirmedKnownLines++;line.missingQuantity===null?coverage.missingUnknownLines++:coverage.missingKnownLines++;}
 return {demandQuantity:sum(demand.map(l=>l.quantity)),confirmedQuantity:knownSum(results.map(l=>l.confirmedQuantity)),missingQuantity:knownSum(results.map(l=>l.missingQuantity)),coverage};
}
export function metrics(facts:AnalyticsOrderFact[]):AnalyticsMetrics {
 const coverage=emptyCoverage();for(const f of facts)for(const key of Object.keys(coverage) as (keyof AnalyticsCoverage)[])coverage[key]+=f.coverage[key];
 return {demandQuantity:sum(facts.map(f=>f.demandQuantity)),confirmedQuantity:knownSum(facts.map(f=>f.confirmedQuantity)),missingQuantity:knownSum(facts.map(f=>f.missingQuantity)),coverage};
}
export function period(date:string,groupBy:'month'|'week') {if(groupBy==='month')return date.slice(0,7)+'-01';const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
function periodBounds(periodStart:string,groupBy:'month'|'week') {
 const end=new Date(periodStart+'T00:00:00Z');
 if(groupBy==='month')end.setUTCMonth(end.getUTCMonth()+1);else end.setUTCDate(end.getUTCDate()+7);
 // These are Beijing business-date boundaries, not UTC event timestamps.
 return {period:periodStart,periodStart,periodEnd:end.toISOString().slice(0,10)};
}
function trendPeriods(facts:AnalyticsOrderFact[],date:(fact:AnalyticsOrderFact)=>string,filters:AnalyticsFilters):AnalyticsPeriodMetrics[] {
 const byPeriod=new Map<string,AnalyticsOrderFact[]>();
 for(const fact of facts){const start=period(date(fact),filters.groupBy),rows=byPeriod.get(start)||[];rows.push(fact);byPeriod.set(start,rows);}
 const result:AnalyticsPeriodMetrics[]=[],last=period(filters.receivedTo,filters.groupBy);
 for(let start=period(filters.receivedFrom,filters.groupBy);start<=last;){
  const bounds=periodBounds(start,filters.groupBy),rows=byPeriod.get(start)||[];
  // Keep full calendar boundaries; only facts selected inside the date filter count.
  // An empty period has a known zero, whereas unknown quantities in real orders remain null.
  result.push({...bounds,orders:rows.length,...(rows.length?metrics(rows):{demandQuantity:'0.00',confirmedQuantity:'0.00',missingQuantity:'0.00',coverage:emptyCoverage()})});
  start=bounds.periodEnd;
 }
 return result;
}
function groups<T>(facts:AnalyticsOrderFact[],key:(f:AnalyticsOrderFact)=>string,value:(key:string,facts:AnalyticsOrderFact[])=>T){const map=new Map<string,AnalyticsOrderFact[]>();for(const f of facts){const k=key(f);map.set(k,[...(map.get(k)||[]),f]);}return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>value(k,v));}
export function charts(cohort:AnalyticsOrderFact[],confirmation:AnalyticsOrderFact[],filters:AnalyticsFilters):Pick<AnalyticsSnapshot,'summary'|'charts'|'confirmationTrendCoverage'> {
 const hospitals=groups(cohort,f=>f.hospitalId,(hospitalId,facts)=>({hospitalId,hospitalName:facts[0].hospitalName,orders:facts.length,...metrics(facts)}));
 const ranking=new Map<string,{name:string;spec:string;values:string[];orders:Set<string>}>();for(const f of cohort)for(const l of f.demandLines){const key=JSON.stringify([l.name,l.spec]),r=ranking.get(key)||{name:l.name,spec:l.spec,values:[],orders:new Set<string>()};r.values.push(l.quantity);r.orders.add(f.id);ranking.set(key,r);}
 return {
  summary:{orders:cohort.length,...metrics(cohort),confirmedAmount:filters.name||filters.spec?null:knownSum(cohort.map(f=>f.confirmedAmount))},
  charts:{frequency:hospitals.map(({hospitalId,hospitalName,orders})=>({hospitalId,hospitalName,orders})),quantity:hospitals,
   demandTrend:trendPeriods(cohort,f=>f.receivedDate,filters),
   confirmationTrend:trendPeriods(confirmation,f=>f.confirmedDate!,filters),
   ranking:[...ranking.values()].map(r=>({name:r.name,spec:r.spec,demandQuantity:sum(r.values),orders:r.orders.size})).sort((a,b)=>new Decimal(b.demandQuantity).cmp(a.demandQuantity)||a.name.localeCompare(b.name)||a.spec.localeCompare(b.spec)),
   shortage:groups(cohort.filter(f=>f.confirmed),f=>f.hospitalId,(hospitalId,facts)=>({hospitalId,hospitalName:facts[0].hospitalName,orders:facts.length,...metrics(facts)}))},
  confirmationTrendCoverage:{orders:confirmation.length,unknownDateOrders:cohort.filter(f=>f.confirmed&&!f.confirmedDate).length,knownQuantityLines:confirmation.reduce((n,f)=>n+f.coverage.confirmedKnownLines,0),unknownQuantityLines:confirmation.reduce((n,f)=>n+f.coverage.confirmedUnknownLines,0)}
 };
}
