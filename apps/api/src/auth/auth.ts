import { hash, verify } from '@node-rs/argon2';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from '../db/database';
import type { Config } from '../config';
import { ensure, BusinessError } from '../core/errors';
import type { Session, User } from '../../../../packages/contracts/src';
export const secretHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const newSecret=()=>randomBytes(32).toString('base64url');
export const passwordHash=(value:string)=>hash(value,{memoryCost:19456,timeCost:2,parallelism:1});
export interface Actor {id:string;name:string;role:User['role'];sessionId:string;channel:Session['channel'];}
export const sessionIdleMs=(channel:string)=>channel==='mini'?7*86400000:8*3600000;
export const internalRole=(role:string,channel:string)=>role==='salesperson'&&['mini','trial','pc'].includes(channel)||role==='admin'&&channel==='pc';
export class AuthService {
 private readonly dummyHash=passwordHash(newSecret());
 private readonly attempts=new Map<string,{count:number;expires:number}>();
 constructor(readonly db:Database,readonly config:Config,readonly clock=()=>new Date()){}
 private limit(key:string) {
   const now=this.clock().getTime(),old=this.attempts.get(key);
   if(!old||old.expires<now){if(this.attempts.size>=5000)this.attempts.delete(this.attempts.keys().next().value!);this.attempts.set(key,{count:1,expires:now+600000});return;}
   ensure(++old.count<=15,429,'RATE_LIMITED','尝试次数过多，请稍后重试');
 }
 private async credentials(input:unknown,ip:string,pc=false) {
   const v=z.object({loginName:z.string().min(1).max(100),password:z.string().min(1).max(128)}).strict().parse(input);
   this.limit(ip+':'+v.loginName);this.limit('ip:'+ip);
   const user=(await this.db.query('SELECT * FROM users WHERE login_name=$1',[v.loginName])).rows[0];
   const valid=await verify(user?.password_hash||await this.dummyHash,v.password);
   ensure(valid&&user?.active&&(user.role==='salesperson'||pc&&user.role==='admin'),401,'INVALID_CREDENTIALS','账号或密码错误，或账号不可用');
   return user;
 }
 private async issue(c:PoolClient,user:any,channel:Session['channel'],csrfHash:string|null=null):Promise<Session> {
   const token=newSecret(),now=this.clock(),expires=new Date(now.getTime()+(channel==='mini'?30:channel==='pc'?7:1)*86400000);
   await c.query('INSERT INTO auth_sessions(user_id,token_hash,channel,expires_at,last_seen_at,csrf_hash) VALUES($1,$2,$3,$4,$5,$6)',[user.id,secretHash(token),channel,expires,now,csrfHash]);
   return {authState:'authenticated',token,user:{id:user.id,name:user.name,role:user.role},expiresAt:expires.toISOString(),channel};
 }
 async trialLogin(input:unknown,ip:string) {
   ensure(this.config.trialPasswordLogin&&!this.config.production,403,'TRIAL_LOGIN_DISABLED','未开放开发试用登录');
   const user=await this.credentials(input,ip);
   return this.db.transaction(async c=>{const latest=(await c.query('SELECT * FROM users WHERE id=$1 FOR SHARE',[user.id])).rows[0];ensure(latest?.active&&latest.role==='salesperson'&&latest.password_hash===user.password_hash,401,'INVALID_CREDENTIALS','账号已变化，请重新登录');return this.issue(c,latest,'trial');});
 }
 async pcLogin(input:unknown,ip:string,rotate:(c:PoolClient)=>Promise<void>,csrfHash:string) {
   const user=await this.credentials(input,ip,true);
   return this.db.transaction(async c=>{const latest=(await c.query('SELECT * FROM users WHERE id=$1 FOR SHARE',[user.id])).rows[0];ensure(latest?.active&&['salesperson','admin'].includes(latest.role)&&latest.role===user.role&&latest.password_hash===user.password_hash&&latest.auth_version===user.auth_version,401,'INVALID_CREDENTIALS','账号已变化，请重新登录');await rotate(c);return this.issue(c,latest,'pc',csrfHash);});
 }
 async miniLogin(input:unknown,ip:string) {
   const {loginCode}=z.object({loginCode:z.string().min(1).max(512)}).strict().parse(input);this.limit('wechat:'+ip);
   ensure(this.config.wechatAppId&&this.config.wechatAppSecret,503,'WECHAT_NOT_CONFIGURED','尚未配置真实微信小程序，请完成注册及服务端配置');
   let result:any;
   try {
     const query=new URLSearchParams({appid:this.config.wechatAppId,secret:this.config.wechatAppSecret,js_code:loginCode,grant_type:'authorization_code'});
     const response=await fetch('https://api.weixin.qq.com/sns/jscode2session?'+query,{signal:AbortSignal.timeout(8000)});
     result=await response.json();
   } catch {throw new BusinessError(503,'WECHAT_UNAVAILABLE','微信登录暂不可用，请稍后重试');}
   ensure(typeof result.openid==='string'&&!result.errcode,401,'WECHAT_LOGIN_FAILED','微信登录凭证无效，请重新登录');
   return this.db.transaction(async c=>{
     const user=(await c.query('SELECT u.* FROM wechat_identities w JOIN users u ON u.id=w.user_id WHERE w.app_id=$1 AND w.open_id=$2 FOR SHARE OF u',[this.config.wechatAppId,result.openid])).rows[0];
     if(user){ensure(user.active&&user.role==='salesperson',403,'ACCOUNT_UNAVAILABLE','账号不可用或不属于销售端');return this.issue(c,user,'mini');}
     const bindTicket=newSecret();await c.query('INSERT INTO bind_tickets(token_hash,app_id,open_id,expires_at) VALUES($1,$2,$3,$4)',[secretHash(bindTicket),this.config.wechatAppId,result.openid,new Date(this.clock().getTime()+600000)]);
     return {authState:'identity_unbound',bindTicket};
   });
 }
 async bindSales(input:unknown,ip:string) {
   const value=z.object({bindTicket:z.string().min(20).max(200),loginName:z.string().min(1).max(100),password:z.string().min(1).max(128)}).strict().parse(input);
   const user=await this.credentials({loginName:value.loginName,password:value.password},ip);
   return this.db.transaction(async c=>{
     const latest=(await c.query('SELECT * FROM users WHERE id=$1 FOR SHARE',[user.id])).rows[0];ensure(latest?.active&&latest.role==='salesperson'&&latest.password_hash===user.password_hash,401,'INVALID_CREDENTIALS','账号状态已变化');
     const ticket=(await c.query('SELECT * FROM bind_tickets WHERE token_hash=$1 FOR UPDATE',[secretHash(value.bindTicket)])).rows[0];
     ensure(ticket&&!ticket.used_at&&ticket.expires_at>this.clock()&&ticket.app_id===this.config.wechatAppId,401,'BIND_TICKET_INVALID','绑定凭证已失效，请重新微信登录');
     const existing=(await c.query('SELECT * FROM wechat_identities WHERE app_id=$1 AND (open_id=$2 OR user_id=$3)',[ticket.app_id,ticket.open_id,user.id])).rows;
     ensure(existing.every(v=>v.open_id===ticket.open_id&&v.user_id===user.id),409,'IDENTITY_BINDING_CONFLICT','微信或内部账号已绑定其他身份');
     try{await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ticket.app_id,ticket.open_id,user.id]);}catch{throw new BusinessError(409,'IDENTITY_BINDING_CONFLICT','绑定状态已变化，请重新核对');}
     const bound=(await c.query('SELECT user_id FROM wechat_identities WHERE app_id=$1 AND open_id=$2',[ticket.app_id,ticket.open_id])).rows[0];ensure(bound?.user_id===user.id,409,'IDENTITY_BINDING_CONFLICT','微信绑定冲突');
     await c.query('UPDATE bind_tickets SET used_at=$2 WHERE token_hash=$1',[secretHash(value.bindTicket),this.clock()]);return this.issue(c,latest,'mini');
   });
 }
 async authenticate(token:string,transport:'bearer'|'pc'='bearer'):Promise<Actor> {
   ensure(token&&token.length<=256,401,'UNAUTHENTICATED','请先登录');
   const r=(await this.db.query('SELECT s.id AS session_id,s.channel,s.expires_at,s.last_seen_at,s.revoked_at,s.issued_role,s.auth_version AS session_auth_version,u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1',[secretHash(token)])).rows[0];
   const now=this.clock(),idle=sessionIdleMs(r?.channel);
   ensure(r&&r.active&&!r.revoked_at&&r.expires_at>now&&now.getTime()-r.last_seen_at.getTime()<idle&&r.issued_role===r.role&&r.session_auth_version===r.auth_version,401,'SESSION_EXPIRED','登录已失效，请重新登录');
   ensure(transport==='pc'?r.channel==='pc':r.channel!=='pc',403,'CHANNEL_FORBIDDEN','会话传递通道不匹配，请重新登录');
   ensure(internalRole(r.role,r.channel),403,'ROLE_FORBIDDEN','当前角色不能使用此内部端');
   await this.db.query('UPDATE auth_sessions SET last_seen_at=$2 WHERE id=$1 AND revoked_at IS NULL',[r.session_id,now]);
   return {id:r.id,name:r.name,role:r.issued_role,sessionId:r.session_id,channel:r.channel};
 }
 async logout(actor:Actor) {await this.db.query('UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1',[actor.sessionId,this.clock()]);return {};}
}
