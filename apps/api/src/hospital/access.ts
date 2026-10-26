import type {Actor} from '../auth/auth';
import {sessionIdleMs} from '../auth/auth';
import type {Client} from '../core/store';
import {ensure} from '../core/errors';
/** Hospital access is purpose-specific: CoreStore.active continues to reject it. */
export async function hospitalActive(c:Client,actor:Actor,now:Date){
 ensure(actor.role==='hospital'&&actor.channel==='mini',403,'ROLE_FORBIDDEN','该入口仅供医院采购员使用');
 const row=(await c.query(`SELECT u.name,u.active,u.role,u.auth_version,u.password_setup_required,s.user_id,s.channel,s.expires_at,s.last_seen_at,s.revoked_at,s.issued_role,s.auth_version AS session_version,p.active AS purchaser_active,p.hospital_id,h.name AS hospital_name,h.active AS hospital_active,h.sales_user_id,h.payment_term_days FROM users u JOIN auth_sessions s ON s.user_id=u.id JOIN hospital_purchasers p ON p.user_id=u.id JOIN hospitals h ON h.id=p.hospital_id WHERE u.id=$1 AND s.id=$2 FOR SHARE OF u,s,p,h`,[actor.id,actor.sessionId])).rows[0];
 ensure(row?.active&&!row.password_setup_required&&row.role==='hospital'&&row.channel==='mini'&&row.issued_role==='hospital'&&row.user_id===actor.id&&row.auth_version===row.session_version&&!row.revoked_at&&row.expires_at>now&&now.getTime()-row.last_seen_at.getTime()<sessionIdleMs('mini'),401,'SESSION_EXPIRED','医院会话已失效，请重新登录');
 ensure(row.purchaser_active&&row.hospital_active,403,'HOSPITAL_ACCOUNT_UNAVAILABLE','医院或采购员档案不可用，请联系管理员');return row;
}
