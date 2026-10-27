import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Actor} from '../auth/auth';
import {CoreStore,type Client} from '../core/store';
import {ensure,missing} from '../core/errors';
import {date,uuid,today} from '../core/validation';
import type {AnalyticsFilters,AnalyticsOrderFact,AnalyticsOrderLine,AnalyticsSnapshot,AnalyticsOrderPage} from '../../../../packages/contracts/src/analytics';
import {charts,lineMetrics,period} from './aggregate';
const queryInput=z.object({receivedFrom:date,receivedTo:date,hospitalId:uuid.optional(),name:z.string().trim().max(100).optional(),spec:z.string().trim().max(200).optional(),groupBy:z.enum(['week','month']).default('month')}).strict();
const drillInput=z.object({chart:z.enum(['frequency','quantity','demandTrend','confirmationTrend','ranking','shortage']),hospitalId:uuid.optional(),period:date.optional(),name:z.string().max(100).optional(),spec:z.string().max(200).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
const MAX_ORDERS=10000,MAX_LINES=50000,TTL=600000;
const dateWithin=(value:string|null,filters:AnalyticsFilters)=>!!value&&value>=filters.receivedFrom&&value<=filters.receivedTo;
const matches=(line:AnalyticsOrderLine,filters:AnalyticsFilters)=>(!filters.name||line.name.toLocaleLowerCase().includes(filters.name.toLocaleLowerCase()))&&(!filters.spec||line.spec.toLocaleLowerCase().includes(filters.spec.toLocaleLowerCase()));
export class AnalyticsService {
 constructor(readonly store:CoreStore){}
 private async authority(c:Client,actor:Actor){ensure(actor.role==='salesperson'||actor.role==='admin'&&actor.channel==='pc',403,'ROLE_FORBIDDEN','当前账号无权查看内部医院分析');await this.store.active(c,actor);return (await c.query('SELECT auth_version,access_scope_version FROM users WHERE id=$1 FOR SHARE',[actor.id])).rows[0];}
 async query(actor:Actor,input:unknown):Promise<AnalyticsSnapshot>{
  const filters=queryInput.parse(input);ensure(filters.receivedFrom<=filters.receivedTo,400,'ANALYTICS_DATE_RANGE','开始日期不能晚于结束日期');ensure(new Date(filters.receivedTo).getTime()-new Date(filters.receivedFrom).getTime()<=3660*86400000,400,'ANALYTICS_RANGE_TOO_LARGE','日期范围最多十年，请缩小后查询');
  return this.store.db.transaction(async c=>{
   await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');const authority=await this.authority(c,actor),asOf=this.store.clock(),expiresAt=new Date(asOf.getTime()+TTL),snapshotId=randomUUID();
   const rows=(await c.query(`SELECT o.id,o.order_no,o.hospital_id,h.name AS hospital_name,o.sales_user_id,o.received_date,o.entry_mode,r.id AS revision_id,r.revision_no,
    hr.id AS history_id,hr.historical_confirmed_date,COALESCE(hr.historical_confirmed_amount_override,hr.historical_confirmed_amount)::text AS history_amount,
    confirmed.id AS confirmed_version_id,jsonb_array_length(confirmed.document->'lines') AS confirmation_line_count,confirmed.hospital_confirmed_at
    FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id
    LEFT JOIN historical_order_records hr ON hr.purchase_order_id=o.id AND hr.verification_status='verified'
    JOIN LATERAL(SELECT pr.id,pr.revision_no FROM purchase_order_revisions pr WHERE pr.purchase_order_id=o.id AND (o.entry_mode='normal' AND pr.frozen_at IS NOT NULL OR o.entry_mode='historical_backfill' AND pr.id=hr.verified_revision_id) ORDER BY pr.revision_no DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL(SELECT v.id,v.document,v.hospital_confirmed_at FROM quotes q JOIN quote_versions v ON v.id=q.confirmed_version_id AND v.quote_id=q.id WHERE q.purchase_order_id=o.id ORDER BY v.confirmation_recorded_at DESC NULLS LAST,v.id DESC LIMIT 1) confirmed ON true
    WHERE o.status<>'voided' AND ($2::boolean OR o.sales_user_id=$1 OR h.sales_user_id=$1) AND ($3::uuid IS NULL OR o.hospital_id=$3)
    AND (o.received_date BETWEEN $4::date AND $5::date OR CASE WHEN o.entry_mode='historical_backfill' THEN hr.historical_confirmed_date ELSE (confirmed.hospital_confirmed_at AT TIME ZONE 'Asia/Shanghai')::date END BETWEEN $4::date AND $5::date)
    ORDER BY o.received_date,o.order_no,o.id LIMIT $6`,[actor.id,actor.role==='admin'&&actor.channel==='pc',filters.hospitalId||null,filters.receivedFrom,filters.receivedTo,MAX_ORDERS+1])).rows;
   ensure(rows.length<=MAX_ORDERS,422,'ANALYTICS_TOO_MANY_ORDERS','该范围超过一万单，请缩小日期或医院范围后查询');
   ensure(rows.reduce((count,row)=>count+(row.confirmation_line_count||0),0)<=MAX_LINES,422,'ANALYTICS_TOO_MANY_LINES','该范围确认结果超过五万行，请缩小日期或医院范围后查询');
   const documents=(await c.query('SELECT id,document FROM quote_versions WHERE id=ANY($1::uuid[])',[rows.map(row=>row.confirmed_version_id).filter(Boolean)])).rows,byVersion=new Map(documents.map(row=>[row.id,row.document]));
   const revisionIds=rows.map(r=>r.revision_id),lines=(await c.query(`SELECT pl.*,lr.supply_status,lr.confirmed_quantity::text,lr.missing_quantity::text FROM purchase_order_lines pl LEFT JOIN historical_order_line_results lr ON lr.purchase_line_id=pl.id WHERE pl.revision_id=ANY($1::uuid[]) ORDER BY pl.revision_id,pl.position LIMIT $2`,[revisionIds,MAX_LINES+1])).rows;
   ensure(lines.length<=MAX_LINES,422,'ANALYTICS_TOO_MANY_LINES','该范围超过五万行，请缩小日期或医院范围后查询');
   const byRevision=new Map<string,any[]>();for(const l of lines){const list=byRevision.get(l.revision_id)||[];list.push(l);byRevision.set(l.revision_id,list);}
   const facts:{fact:AnalyticsOrderFact;cohort:boolean;confirmation:boolean}[]=[];
   for(const row of rows){
    row.document=byVersion.get(row.confirmed_version_id);
    const historical=row.entry_mode==='historical_backfill',confirmed=historical||!!row.confirmed_version_id,confirmedDate=historical?row.historical_confirmed_date:row.hospital_confirmed_at?today(new Date(row.hospital_confirmed_at)):null;
    const all=byRevision.get(row.revision_id)||[];
    const demandLines:AnalyticsOrderLine[]=all.map(l=>({name:l.name,spec:l.spec,quantity:l.quantity,confirmedQuantity:null,missingQuantity:null})).filter(l=>matches(l,filters));
    const resultLines:AnalyticsOrderLine[]=(historical?all.map(l=>({name:l.name,spec:l.spec,quantity:l.quantity,confirmedQuantity:l.confirmed_quantity,missingQuantity:l.missing_quantity})):(row.document?.lines||[]).map((l:any)=>({name:l.name,spec:l.spec,quantity:l.quantity,confirmedQuantity:l.status==='priced'?l.quantity:'0.00',missingQuantity:l.status==='missing'?l.quantity:'0.00'}))).filter((l:AnalyticsOrderLine)=>matches(l,filters));
    const cohort=dateWithin(row.received_date,filters)&&demandLines.length>0,confirmation=confirmed&&dateWithin(confirmedDate,filters)&&resultLines.length>0;if(!cohort&&!confirmation)continue;
    const fact:AnalyticsOrderFact={id:row.id,orderNo:row.order_no,hospitalId:row.hospital_id,hospitalName:row.hospital_name,receivedDate:row.received_date,entryMode:row.entry_mode,revisionId:row.revision_id,revisionNo:row.revision_no,confirmedDate,confirmed,confirmationSourceId:historical?row.history_id:row.confirmed_version_id||null,confirmedAmount:filters.name||filters.spec?null:historical?row.history_amount:row.document?.total||null,writable:actor.role==='salesperson'&&row.sales_user_id===actor.id,demandLines,resultLines,...lineMetrics(demandLines,resultLines,confirmed,confirmedDate)};
    facts.push({fact,cohort,confirmation});
   }
   const result:AnalyticsSnapshot={snapshotId,asOf:asOf.toISOString(),expiresAt:expiresAt.toISOString(),filters,unit:'kg',dateBasis:{cohort:'received_date',confirmationTrend:'actual_confirmation_date',timezone:'Asia/Shanghai',weekStartsOn:'monday'},...charts(facts.filter(f=>f.cohort).map(f=>f.fact),facts.filter(f=>f.confirmation).map(f=>f.fact),filters)};
   await c.query('INSERT INTO analytics_query_snapshots(id,actor_id,session_id,auth_version,access_scope_version,filters,result,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[snapshotId,actor.id,actor.sessionId,authority.auth_version,authority.access_scope_version,JSON.stringify(filters),JSON.stringify(result),asOf,expiresAt]);
   if(facts.length)await c.query(`INSERT INTO analytics_query_snapshot_items(snapshot_id,sequence,purchase_order_id,revision_id,cohort,confirmation_trend,fact) SELECT $1,(entry->>'sequence')::integer,(entry->'fact'->>'id')::uuid,(entry->'fact'->>'revisionId')::uuid,(entry->>'cohort')::boolean,(entry->>'confirmation')::boolean,entry->'fact' FROM jsonb_array_elements($2::jsonb) entry`,[snapshotId,JSON.stringify(facts.map((f,i)=>({...f,sequence:i+1})))]);
   return result;
  });
 }
 async orders(actor:Actor,snapshotId:string,input:unknown):Promise<AnalyticsOrderPage>{
  uuid.parse(snapshotId);const filter=drillInput.parse(input);
  return this.store.db.transaction(async c=>{
   const authority=await this.authority(c,actor),snapshot=(await c.query('SELECT * FROM analytics_query_snapshots WHERE id=$1 AND actor_id=$2 AND session_id=$3',[snapshotId,actor.id,actor.sessionId])).rows[0];if(!snapshot)throw missing();
   ensure(new Date(snapshot.expires_at)>this.store.clock(),410,'ANALYTICS_SNAPSHOT_EXPIRED','分析查询已到期，请整组刷新图表和订单');
   ensure(snapshot.auth_version===authority.auth_version&&snapshot.access_scope_version===authority.access_scope_version,409,'ANALYTICS_SCOPE_CHANGED','权限范围已变化，请刷新');
   // Recheck the entire saved scope before returning any page, even when ownership was changed outside normal APIs.
   const denied=(await c.query(`SELECT 1 FROM analytics_query_snapshot_items i LEFT JOIN purchase_orders o ON o.id=i.purchase_order_id LEFT JOIN hospitals h ON h.id=o.hospital_id WHERE i.snapshot_id=$1 AND (o.id IS NULL OR NOT($3::boolean OR o.sales_user_id=$2 OR h.sales_user_id=$2)) LIMIT 1`,[snapshotId,actor.id,actor.role==='admin'&&actor.channel==='pc'])).rowCount;
   ensure(!denied,409,'ANALYTICS_SCOPE_CHANGED','权限范围已变化，请刷新');
   const data=(await c.query('SELECT fact,cohort,confirmation_trend FROM analytics_query_snapshot_items WHERE snapshot_id=$1 ORDER BY sequence',[snapshotId])).rows,filters=snapshot.filters as AnalyticsFilters;
   const items=data.filter(item=>{
    const f=item.fact as AnalyticsOrderFact;if(filter.chart==='confirmationTrend'?!item.confirmation_trend:!item.cohort)return false;
    if(filter.hospitalId&&f.hospitalId!==filter.hospitalId)return false;if(filter.period&&period(filter.chart==='confirmationTrend'?f.confirmedDate!:f.receivedDate,filters.groupBy)!==filter.period)return false;
    if(filter.chart==='shortage'&&!f.confirmed)return false;
    if(filter.name!==undefined||filter.spec!==undefined){const lines=filter.chart==='confirmationTrend'||filter.chart==='shortage'?f.resultLines:f.demandLines;if(!lines.some(l=>(filter.name===undefined||l.name===filter.name)&&(filter.spec===undefined||l.spec===filter.spec)))return false;}
    return true;
   }).map(i=>i.fact as AnalyticsOrderFact);
   return {snapshotId,asOf:new Date(snapshot.created_at).toISOString(),expiresAt:new Date(snapshot.expires_at).toISOString(),items:items.slice((filter.page-1)*filter.pageSize,filter.page*filter.pageSize),total:items.length,page:filter.page,pageSize:filter.pageSize,notice:'图表与列表使用同一查询快照；打开的业务档案为当前事实，可能晚于本次分析。'};
  });
 }
 /** Called hourly by maintenance. Only temporary query results are removed. */
 async cleanupExpired(){return this.store.db.transaction(async c=>(await c.query('DELETE FROM analytics_query_snapshots WHERE expires_at<=$1',[this.store.clock()])).rowCount||0);}
}
