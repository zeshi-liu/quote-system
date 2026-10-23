import type {Request,Response} from 'express';
import type {PoolClient} from 'pg';
import {timingSafeEqual} from 'node:crypto';
import {AuthService,newSecret,secretHash,sessionIdleMs} from './auth';
import type {PcSession} from '../../../../packages/contracts/src';
import {ensure} from '../core/errors';

interface Proof {kind:'pre'|'session';id:string;csrfHash:string;}
const unsafe=(method:string)=>!['GET','HEAD','OPTIONS'].includes(method);
const loopback=(req:Request)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'');
const cookieNames=['__Host-quote_session','quote_session_dev','__Host-quote_pre','quote_pre_dev'];
export class PcAuthService{
 constructor(readonly auth:AuthService){}
 private settings(req:Request){const secure=this.auth.config.production||req.secure||!loopback(req);return {secure,session:secure?'__Host-quote_session':'quote_session_dev',pre:secure?'__Host-quote_pre':'quote_pre_dev'};}
 private cookies(req:Request){const result=new Map<string,string>();for(const pair of (req.headers.cookie||'').split(';')){const i=pair.indexOf('=');if(i<0)continue;const name=pair.slice(0,i).trim();if(!cookieNames.includes(name))continue;ensure(!result.has(name),401,'AMBIGUOUS_CREDENTIALS','存在重复会话Cookie，请重新登录');result.set(name,pair.slice(i+1).trim());}return result;}
 credentials(req:Request){const config=this.settings(req),cookies=this.cookies(req),pcToken=cookies.get(config.session),otherSession=cookies.has(config.secure?'quote_session_dev':'__Host-quote_session'),authorization=req.headers.authorization;ensure(!otherSession,401,'CHANNEL_FORBIDDEN','会话Cookie不属于当前通道');ensure(!(pcToken!==undefined&&authorization),401,'AMBIGUOUS_CREDENTIALS','Cookie与Bearer不可同时使用');return {pcToken,bearer:authorization?.startsWith('Bearer ')?authorization.slice(7):'',preToken:cookies.get(config.pre)};}
 private cookie(req:Request,res:Response,name:string,value:string,maxAge:number){res.cookie(name,value,{httpOnly:true,secure:this.settings(req).secure,sameSite:'lax',path:'/',maxAge});}
 clear(req:Request,res:Response){const names=this.settings(req);this.cookie(req,res,names.session,'',0);this.cookie(req,res,names.pre,'',0);}
 private origin(req:Request){const origin=req.headers.origin;ensure(typeof origin==='string'&&this.auth.config.allowedOrigins.includes(origin)&&(!this.auth.config.production||origin.startsWith('https://')),403,'ORIGIN_FORBIDDEN','请求来源不在允许范围内');}
 private csrfHash(req:Request){const value=req.headers['x-csrf-token'];ensure(typeof value==='string'&&value.length>=20&&value.length<=256,403,'CSRF_INVALID','请重新取得页面安全令牌');return secretHash(value);}
 private checkHash(stored:unknown,actual:string){ensure(typeof stored==='string'&&/^[a-f0-9]{64}$/.test(stored)&&timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(actual,'hex')),403,'CSRF_INVALID','页面安全令牌已变化，请重新取得');}
 async authenticate(req:Request){const value=this.credentials(req);return value.pcToken!==undefined?this.auth.authenticate(value.pcToken,'pc'):this.auth.authenticate(value.bearer);}
 async csrf(req:Request,res:Response){
  ensure(!req.headers.authorization,401,'CHANNEL_FORBIDDEN','PC安全令牌仅使用Cookie通道');const value=this.credentials(req),csrf=newSecret(),now=this.auth.clock(),names=this.settings(req);
  if(value.pcToken!==undefined){const actor=await this.auth.authenticate(value.pcToken,'pc'),row=(await this.auth.db.query('UPDATE auth_sessions SET csrf_hash=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING expires_at',[actor.sessionId,secretHash(csrf)])).rows[0];ensure(row,401,'SESSION_EXPIRED','会话已失效');return {csrf,expiresAt:row.expires_at.toISOString()};}
  const token=newSecret(),expiresAt=new Date(now.getTime()+600000);await this.auth.db.transaction(async c=>{await c.query('DELETE FROM pc_pre_sessions WHERE expires_at<=$1 OR token_hash=$2',[now,value.preToken?secretHash(value.preToken):'']);await c.query('INSERT INTO pc_pre_sessions(token_hash,csrf_hash,expires_at) VALUES($1,$2,$3)',[secretHash(token),secretHash(csrf),expiresAt]);});this.cookie(req,res,names.pre,token,600000);return {csrf,expiresAt:expiresAt.toISOString()};
 }
 private async proof(req:Request):Promise<Proof>{
  this.origin(req);const hash=this.csrfHash(req),value=this.credentials(req);ensure(!req.headers.authorization,401,'CHANNEL_FORBIDDEN','PC登录仅使用Cookie通道');
  if(value.pcToken!==undefined){const actor=await this.auth.authenticate(value.pcToken,'pc'),row=(await this.auth.db.query('SELECT csrf_hash FROM auth_sessions WHERE id=$1',[actor.sessionId])).rows[0];this.checkHash(row?.csrf_hash,hash);return {kind:'session',id:actor.sessionId,csrfHash:hash};}
  ensure(value.preToken,403,'CSRF_INVALID','请先取得登录安全令牌');const id=secretHash(value.preToken),row=(await this.auth.db.query('SELECT * FROM pc_pre_sessions WHERE token_hash=$1',[id])).rows[0];ensure(row&&row.expires_at>this.auth.clock(),403,'CSRF_INVALID','登录安全令牌已失效');this.checkHash(row.csrf_hash,hash);return {kind:'pre',id,csrfHash:hash};
 }
 private async consume(c:PoolClient,proof:Proof){
  const now=this.auth.clock();if(proof.kind==='pre'){const row=(await c.query('SELECT * FROM pc_pre_sessions WHERE token_hash=$1 FOR UPDATE',[proof.id])).rows[0];ensure(row&&row.expires_at>now,403,'CSRF_INVALID','登录安全令牌已失效');this.checkHash(row.csrf_hash,proof.csrfHash);await c.query('DELETE FROM pc_pre_sessions WHERE token_hash=$1',[proof.id]);}
  else {const row=(await c.query('SELECT s.*,u.active,u.role,u.auth_version AS current_auth_version FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 FOR UPDATE OF s',[proof.id])).rows[0];ensure(row&&row.channel==='pc'&&row.active&&!row.revoked_at&&row.expires_at>now&&now.getTime()-row.last_seen_at.getTime()<sessionIdleMs('pc')&&row.issued_role===row.role&&row.auth_version===row.current_auth_version,401,'SESSION_EXPIRED','会话已失效');this.checkHash(row.csrf_hash,proof.csrfHash);await c.query('UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1',[proof.id,now]);}
 }
 async login(req:Request,res:Response):Promise<PcSession>{const proof=await this.proof(req),csrf=newSecret(),session=await this.auth.pcLogin(req.body,req.ip||'unknown',c=>this.consume(c,proof),secretHash(csrf)),names=this.settings(req);this.cookie(req,res,names.session,session.token,new Date(session.expiresAt).getTime()-this.auth.clock().getTime());this.cookie(req,res,names.pre,'',0);return {authState:session.authState,user:session.user,channel:'pc',expiresAt:session.expiresAt,csrf};}
 async guardMutation(req:Request){const value=this.credentials(req);if(value.pcToken===undefined||!unsafe(req.method))return;this.origin(req);const hash=this.csrfHash(req),actor=await this.auth.authenticate(value.pcToken,'pc'),row=(await this.auth.db.query('SELECT csrf_hash FROM auth_sessions WHERE id=$1',[actor.sessionId])).rows[0];this.checkHash(row?.csrf_hash,hash);}
}
