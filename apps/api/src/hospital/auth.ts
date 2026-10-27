import {z} from 'zod';
import {AuthService,secretHash} from '../auth/auth';
import type {Config} from '../config';
import {ensure,BusinessError} from '../core/errors';
export interface HospitalPhoneExchange {exchangePhone(phoneCode:string):Promise<string>;}
/** Official protocol references: getPhoneNumber and getStableAccessToken in WeChat OpenApiDoc.
 * External transport is injected only by tests; no production stub or plaintext fallback exists.
 */
export class WechatPhoneAdapter implements HospitalPhoneExchange {
 private token:{value:string;until:number}|null=null;
 constructor(readonly config:Pick<Config,'wechatAppId'|'wechatAppSecret'>,readonly options:{fetch?:typeof fetch;clock?:()=>Date}={}){}
 private async post(url:string,body:unknown){try{const r=await (this.options.fetch||fetch)(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});ensure(r.ok,503,'WECHAT_UNAVAILABLE','微信手机号服务暂不可用，请重新授权');return await r.json() as any;}catch(e){if(e instanceof BusinessError)throw e;throw new BusinessError(503,'WECHAT_UNAVAILABLE','微信手机号服务响应无法确认，请重新授权');}}
 async exchangePhone(phoneCode:string){
  ensure(this.config.wechatAppId&&this.config.wechatAppSecret,503,'WECHAT_NOT_CONFIGURED','尚未配置真实微信小程序，请完成注册及服务端配置');const now=(this.options.clock?.()||new Date()).getTime();
  if(!this.token||this.token.until<=now){const r=await this.post('https://api.weixin.qq.com/cgi-bin/stable_token',{grant_type:'client_credential',appid:this.config.wechatAppId,secret:this.config.wechatAppSecret});ensure(!r.errcode&&typeof r.access_token==='string'&&r.access_token.length>0&&r.access_token.length<=4096&&Number.isFinite(r.expires_in)&&r.expires_in>60,503,'WECHAT_UNAVAILABLE','微信接口凭据不可用，请联系维护人员');this.token={value:r.access_token,until:now+(Math.min(r.expires_in,7200)-60)*1000};}
  const r=await this.post('https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token='+encodeURIComponent(this.token.value),{code:phoneCode});
  if([40001,40014,42001].includes(r.errcode))this.token=null;
  ensure(r.errcode===0&&r.phone_info&&typeof r.phone_info.purePhoneNumber==='string'&&/^1\d{10}$/.test(r.phone_info.purePhoneNumber)&&String(r.phone_info.countryCode)==='86'&&(!r.phone_info.watermark?.appid||r.phone_info.watermark.appid===this.config.wechatAppId),401,'WECHAT_PHONE_FAILED','手机号授权无效，请重新授权或联系管理员');return r.phone_info.purePhoneNumber as string;
 }
}
export class HospitalAuthService {
 private readonly attempts=new Map<string,{count:number;until:number}>();
 constructor(readonly auth:AuthService,readonly adapter:HospitalPhoneExchange=new WechatPhoneAdapter(auth.config)){}
 private limit(ip:string){const now=this.auth.clock().getTime(),old=this.attempts.get(ip);if(!old||old.until<=now){if(this.attempts.size>=5000)this.attempts.delete(this.attempts.keys().next().value!);this.attempts.set(ip,{count:1,until:now+600000});return;}ensure(++old.count<=15,429,'RATE_LIMITED','尝试次数过多，请稍后重试');}
 private valid(ticket:any){ensure(ticket&&!ticket.used_at&&ticket.expires_at>this.auth.clock()&&ticket.app_id===this.auth.config.wechatAppId,401,'BIND_TICKET_INVALID','绑定凭证已失效，请重新微信登录');}
 async phoneLogin(input:unknown,ip:string){
  const v=z.object({bindTicket:z.string().min(20).max(200),phoneCode:z.string().min(1).max(512)}).strict().parse(input);this.limit(ip);ensure(this.auth.config.wechatAppId&&this.auth.config.wechatAppSecret,503,'WECHAT_NOT_CONFIGURED','尚未配置真实微信小程序，请完成注册及服务端配置');
  this.valid((await this.auth.db.query('SELECT * FROM bind_tickets WHERE token_hash=$1',[secretHash(v.bindTicket)])).rows[0]);const phone=await this.adapter.exchangePhone(v.phoneCode);ensure(/^1\d{10}$/.test(phone),401,'WECHAT_PHONE_FAILED','手机号授权无效，请重新授权');
  try{return await this.auth.db.transaction(async c=>{const ticket=(await c.query('SELECT * FROM bind_tickets WHERE token_hash=$1 FOR UPDATE',[secretHash(v.bindTicket)])).rows[0];this.valid(ticket);const matched=(await c.query("SELECT u.* FROM users u JOIN hospital_purchasers p ON p.user_id=u.id JOIN hospitals h ON h.id=p.hospital_id WHERE u.phone=$1 AND u.active AND u.role='hospital' AND NOT u.password_setup_required AND p.active AND h.active FOR SHARE OF u,p,h",[phone])).rows;ensure(matched.length===1,403,'HOSPITAL_ACCOUNT_UNAVAILABLE','未找到有效医院采购员档案，请联系管理员');const user=matched[0];await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['wechat-binding:'+ticket.app_id+':'+ticket.open_id]);const existing=(await c.query('SELECT * FROM wechat_identities WHERE app_id=$1 AND (open_id=$2 OR user_id=$3)',[ticket.app_id,ticket.open_id,user.id])).rows;ensure(existing.every(x=>x.user_id===user.id&&x.open_id===ticket.open_id),409,'IDENTITY_BINDING_CONFLICT','微信或医院采购员已绑定其他身份，请联系管理员');await c.query('INSERT INTO wechat_identities(app_id,open_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ticket.app_id,ticket.open_id,user.id]);const bound=(await c.query('SELECT user_id FROM wechat_identities WHERE app_id=$1 AND open_id=$2',[ticket.app_id,ticket.open_id])).rows[0];ensure(bound?.user_id===user.id,409,'IDENTITY_BINDING_CONFLICT','微信绑定冲突，请联系管理员');await c.query('UPDATE bind_tickets SET used_at=$2 WHERE token_hash=$1',[secretHash(v.bindTicket),this.auth.clock()]);return this.auth.hospitalSession(c,user);});}catch(e:any){if(e.code==='23505')throw new BusinessError(409,'IDENTITY_BINDING_CONFLICT','微信或医院采购员已绑定其他身份，请联系管理员');throw e;}
 }
}
