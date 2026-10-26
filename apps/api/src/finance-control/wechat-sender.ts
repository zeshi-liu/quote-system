import {today} from '../core/validation';
import type {ReminderMessage,ReminderSender,ReminderSendResult} from './reminders';
type TemplateValue='hospitalName'|'orderNo'|'balance'|'dueDate';
export interface WechatReminderOptions {enabled:boolean;appId:string;appSecret:string;templateId:string;page:string;fields:Record<string,TemplateValue>;miniprogramState?:'formal'|'trial'|'developer';}
/** REST parameters follow WeChat subscribeMessage.send; template fields must match the approved real template.
 * https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/sendMessage.html
 * https://docs.cloudbase.net/recipes/add-subscribe-message-cloud-function
 */
export class WechatReminderSender implements ReminderSender{
 readonly channel='wechat' as const;
 readonly appId:string;readonly templateId:string;
 private token:{value:string;expiresAt:number}|undefined;
 constructor(readonly options:WechatReminderOptions,readonly transport:typeof fetch=fetch,readonly clock=()=>new Date()){this.appId=options.appId;this.templateId=options.templateId;}
 availability(){const v=this.options,fields=Object.entries(v.fields);return {available:!!(v.enabled&&v.appId&&v.appSecret&&v.templateId&&/^pages\/[a-zA-Z0-9_/-]+$/.test(v.page)&&fields.length&&fields.every(([k,value])=>/^(thing|character_string|amount|date|time|phrase|name|number)\d+$/.test(k)&&['hospitalName','orderNo','balance','dueDate'].includes(value))),reason:!v.enabled?'wechat_sending_disabled':'wechat_configuration_incomplete'};}
 private async accessToken(){if(this.token&&this.token.expiresAt>Date.now())return this.token.value;const q=new URLSearchParams({grant_type:'client_credential',appid:this.options.appId,secret:this.options.appSecret});const response=await this.transport('https://api.weixin.qq.com/cgi-bin/token?'+q,{signal:AbortSignal.timeout(5000)});const data:any=await response.json();if(!response.ok||typeof data.access_token!=='string'||!data.access_token)throw new Error('token_unavailable');const seconds=typeof data.expires_in==='number'?Math.max(0,Math.min(data.expires_in,7200)-60):0;this.token={value:data.access_token,expiresAt:Date.now()+seconds*1000};return data.access_token as string;}
 async send(message:ReminderMessage):Promise<ReminderSendResult>{if(!this.availability().available)return {outcome:'not_sent',code:'wechat_unavailable'};if(!message.openId)return {outcome:'not_sent',code:'identity_unavailable'};
  let token:string;try{token=await this.accessToken();}catch{return {outcome:'not_sent',code:'token_unavailable'};}
  const dispatchTime=this.clock();if(today(dispatchTime)!==message.businessDate)return {outcome:'not_sent',code:'expired_business_date'};if((dispatchTime.getUTCHours()+8)%24<9)return {outcome:'not_sent',code:'before_schedule'};
  const data:Record<string,{value:string}>={};for(const [key,value]of Object.entries(this.options.fields)){let content=message[value];if(key.startsWith('thing'))content=[...content].slice(0,20).join('');else if(key.startsWith('name'))content=[...content].slice(0,10).join('');else if(key.startsWith('phrase'))content=[...content].slice(0,5).join('');data[key]={value:content};}
  try{const response=await this.transport('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?'+new URLSearchParams({access_token:token}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({touser:message.openId,template_id:this.options.templateId,page:this.options.page,miniprogram_state:this.options.miniprogramState||'formal',lang:'zh_CN',data}),signal:AbortSignal.timeout(5000)});const body:any=await response.json();if(response.ok&&body?.errcode===0)return {outcome:'sent'};if(typeof body?.errcode==='number'&&body.errcode!==0){if([40001,42001].includes(body.errcode))this.token=undefined;return {outcome:'not_sent',code:String(body.errcode)};}return {outcome:'outcome_unknown',code:'invalid_provider_response'};}catch{return {outcome:'outcome_unknown',code:'provider_response_unknown'};}
 }
}
