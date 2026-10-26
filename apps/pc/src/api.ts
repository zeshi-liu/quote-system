import type {PcSession,User} from '@quote/contracts';
export class PcApiFailure extends Error {constructor(public code:string,message:string,public status?:number){super(message);}}
/** Only HttpOnly browser cookies authenticate PC. No token or persistent storage. */
export class PcApi {
 user:User|null=null;csrf='';
 constructor(private transport:typeof fetch=fetch,private onUnauthorized:()=>void=()=>{},private base='/api/v1',private timeoutMs=20000){}
 clear(){this.user=null;this.csrf='';this.onUnauthorized();}
 private async send<T>(path:string,method='GET',body?:unknown,key?:string):Promise<T>{
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,expired=false;
  const timeoutError=()=>new PcApiFailure('REQUEST_TIMEOUT','请求超时，请重试。');
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;abort.abort();reject(timeoutError());},this.timeoutMs);});
  const transport=this.transport;
  const work=async()=>{let response:Response;try{response=await transport(this.base+path,{method,credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}),...(method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{if(expired)throw timeoutError();throw new PcApiFailure('NETWORK_ERROR','网络中断，请重试。');}
   if(expired)throw timeoutError();
   if(response.status===401)this.clear();
   let payload:any;try{payload=await response.json();}catch{throw new PcApiFailure('RESPONSE_UNKNOWN','服务响应无法确认，请重试。',response.status);}
   if(expired)throw timeoutError();
   if(!response.ok)throw new PcApiFailure(payload?.error?.code||'HTTP_'+response.status,payload?.error?.message||'读取失败，请重试。',response.status);
   if(!payload||!('data' in payload))throw new PcApiFailure('RESPONSE_UNKNOWN','服务响应无法确认，请重试。',response.status);return payload.data as T;
  };
  try{return await Promise.race([work(),timeout]);}finally{clearTimeout(timer);}
 }
 get<T>(path:string){return this.send<T>(path);}
 async getImage(path:string):Promise<Blob>{
  const userId=this.user?.id;if(!userId)throw new PcApiFailure('UNAUTHENTICATED','请重新登录。',401);
  const abort=new AbortController(),transport=this.transport;let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new PcApiFailure('REQUEST_TIMEOUT','图片读取超时，请重试。'));},this.timeoutMs);});
  const work=async()=>{const response=await transport(this.base+path,{method:'GET',credentials:'same-origin',signal:abort.signal,headers:{Accept:'image/png,image/jpeg'}});if(response.status===401)this.clear();if(!response.ok)throw new PcApiFailure('IMAGE_UNAVAILABLE','报价图片读取失败，请重试。',response.status);const type=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg'].includes(type||''))throw new PcApiFailure('IMAGE_INVALID','报价图片格式无法核实。');const blob=await response.blob();if(!blob.size||blob.size>20*1024*1024)throw new PcApiFailure('IMAGE_INVALID','报价图片大小无法核实。');if(this.user?.id!==userId)throw new PcApiFailure('SESSION_CHANGED','登录账号已变化，请在当前账号重新读取。');return blob;};
  try{return await Promise.race([work(),timeout]);}finally{clearTimeout(timer);}
 }
 async refreshCsrf(){const value=await this.get<{csrf:string}>('/auth/csrf');this.csrf=value.csrf;}
 async write<T>(path:string,method:'POST'|'PUT'|'PATCH',body:unknown,key?:string):Promise<T>{if(!this.csrf)await this.refreshCsrf();try{return await this.send<T>(path,method,body,key);}catch(e){if(e instanceof PcApiFailure&&e.status===403&&e.code==='CSRF_INVALID'){this.csrf='';try{await this.refreshCsrf();}catch{/* original operation remains unconfirmed */}throw new PcApiFailure(e.code,'页面安全令牌已更新，请手动重试；本次操作未自动重发。',403);}throw e;}}
 post<T>(path:string,body:unknown,key?:string):Promise<T>{return this.write<T>(path,'POST',body,key);}
 async restore(){const user=await this.get<User&{channel:string}>('/auth/me');if(user.channel!=='pc'||!['salesperson','admin'].includes(user.role)){this.clear();throw new PcApiFailure('CHANNEL_FORBIDDEN','请使用 PC 内部账号重新登录。',401);}this.user={id:user.id,name:user.name,role:user.role};return this.user;}
 async login(loginName:string,password:string){await this.refreshCsrf();const value=await this.post<PcSession>('/auth/pc/password-login',{loginName,password});if(value.channel!=='pc'){this.clear();throw new PcApiFailure('CHANNEL_FORBIDDEN','PC 登录响应无法确认。');}this.user=value.user;this.csrf=value.csrf;return value;}
 async logout(){try{await this.post('/auth/logout',{});this.clear();}catch(e){if(e instanceof PcApiFailure&&e.status===401)throw e;throw new PcApiFailure(e instanceof PcApiFailure?e.code:'LOGOUT_UNKNOWN','退出结果未确认，请重试或重新加载核实。'+(e instanceof Error?e.message:''),e instanceof PcApiFailure?e.status:undefined);}}
}

/** Signed file grants already carry authority. Never forward the PC cookie. */
export async function fetchDownload(url:string,transport:typeof fetch=fetch,timeoutMs=20000):Promise<Blob>{
 const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new PcApiFailure('DOWNLOAD_TIMEOUT','文件下载超时，请重新取得下载凭证。'));},timeoutMs);});
 const work=async()=>{const response=await transport(url,{credentials:'omit',signal:abort.signal});if(!response.ok)throw new PcApiFailure('DOWNLOAD_FAILED','文件下载失败，请重新取得下载凭证。',response.status);return response.blob();};
 try{return await Promise.race([work(),timeout]);}finally{clearTimeout(timer);}
}
