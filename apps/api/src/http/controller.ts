import { Controller,All,Req,Res,Inject } from '@nestjs/common';
import type { Request,Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthService,secretHash } from '../auth/auth';
import { CoreStore } from '../core/store';
import { PurchaseService } from '../core/purchases';
import { SupplierService } from '../core/suppliers';
import { PricingService } from '../core/pricing';
import { BusinessError,ensure } from '../core/errors';
@Controller('/api/v1')
export class ApiController {
 constructor(@Inject(AuthService) readonly auth:AuthService,@Inject(CoreStore) readonly store:CoreStore,@Inject(PurchaseService) readonly purchases:PurchaseService,@Inject(SupplierService) readonly suppliers:SupplierService,@Inject(PricingService) readonly pricing:PricingService){}
 @All('*path')
 async route(@Req() req:Request,@Res() res:Response){
  const requestId=randomUUID();res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const path=req.path.replace(/^\/api\/v1/,'').replace(/\/$/,''),method=req.method,token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'',key=typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:'';
   let result:any,match:RegExpMatchArray|null;
   if(path==='/health'&&method==='GET'){await this.store.db.query('SELECT 1');result={status:'ok'};}
   else if(path==='/auth/trial/password-login'&&method==='POST')result=await this.auth.trialLogin(req.body,req.ip||'unknown');
   else if(path==='/auth/miniapp/login'&&method==='POST')result=await this.auth.miniLogin(req.body,req.ip||'unknown');
   else if(path==='/auth/miniapp/bind-sales'&&method==='POST')result=await this.auth.bindSales(req.body,req.ip||'unknown');
   else if(['/supplier/session','/h5/sessions'].includes(path)&&method==='POST')result=await this.suppliers.exchange(req.body);
   else if(['/supplier/quote','/h5/supplier-quote','/h5/supplier-quote/submit'].includes(path)){
    if(method==='GET'&&path!=='/h5/supplier-quote/submit')result=await this.suppliers.get(token);
    else if(method==='POST')result=await this.suppliers.submit(token,key,req.body);
    else throw new BusinessError(405,'METHOD_NOT_ALLOWED','不支持此操作');
   }else{
    if((match=path.match(/^\/operations\/([^/]+)$/))&&method==='GET'){
     const isSupplier=!!(await this.store.db.query('SELECT 1 FROM supplier_sessions WHERE token_hash=$1',[secretHash(token)])).rowCount;
     if(isSupplier)result=await this.suppliers.operation(token,match[1]);else{
      const actor=await this.auth.authenticate(token);result=await this.store.operation(actor,match[1]);
     }
    }else{
     const actor=await this.auth.authenticate(token);
     if(path==='/auth/me'&&method==='GET')result={id:actor.id,name:actor.name,role:actor.role};
     else if(path==='/auth/logout'&&method==='POST')result=await this.auth.logout(actor);
     else if(path==='/sales/bootstrap'&&method==='GET')result=await this.purchases.bootstrap(actor);
     else if(path==='/sales/purchase-orders'&&method==='GET')result=await this.purchases.list(actor);
     else if(path==='/sales/purchase-orders'&&method==='POST')result=await this.purchases.create(actor,key,req.body);
     else if((match=path.match(/^\/sales\/purchase-orders\/([^/]+)$/))&&method==='GET')result=await this.purchases.get(actor,match[1]);
     else if((match=path.match(/^\/sales\/purchase-orders\/([^/]+)\/(comparison|draft)$/))&&method==='GET')result=await this.purchases.get(actor,match[1],match[2] as 'comparison'|'draft');
     else if((match=path.match(/^\/sales\/purchase-orders\/([^/]+)\/revisions\/([^/]+)\/lines$/))&&method==='PUT')result=await this.purchases.saveLines(actor,key,match[1],match[2],req.body);
     else if((match=path.match(/^\/sales\/purchase-orders\/([^/]+)\/revisions\/([^/]+)\/freeze$/))&&method==='POST')result=await this.purchases.freeze(actor,key,match[1],match[2],req.body);
     else if((match=path.match(/^\/sales\/purchase-order-revisions\/([^/]+)\/supplier-tasks$/))&&method==='POST')result=await this.suppliers.createTask(actor,key,match[1],req.body);
     else if((match=path.match(/^\/supplier-tasks\/([^/]+)\/(generate-link|regenerate-link|requote|cancel)$/))&&method==='POST')result=match[2]==='cancel'?await this.suppliers.cancel(actor,key,match[1],req.body):await this.suppliers.link(actor,key,match[1],match[2]==='generate-link'?'generate':match[2]==='regenerate-link'?'regenerate':'requote',req.body);
     else if((match=path.match(/^\/sales\/purchase-orders\/([^/]+)\/enter-pricing$/))&&method==='POST')result=await this.pricing.enter(actor,key,match[1],req.body);
     else if((match=path.match(/^\/quotes\/([^/]+)\/versions\/([^/]+)\/(draft|adopt-latest-supplier-quotes)$/)))result=match[3]==='draft'&&['PATCH','PUT'].includes(method)?await this.pricing.save(actor,key,match[1],match[2],req.body):match[3]==='adopt-latest-supplier-quotes'&&method==='POST'?await this.pricing.adopt(actor,key,match[1],match[2],req.body):(()=>{throw new BusinessError(405,'METHOD_NOT_ALLOWED','不支持此操作');})();
     else throw new BusinessError(404,'NOT_FOUND','接口不存在');
    }
   }
   res.status(200).json({data:result,meta:{requestId}});
  }catch(error:any){
   if(error instanceof z.ZodError)res.status(400).json({error:{code:'VALIDATION_FAILED',message:'请检查输入内容',details:error.issues.map(i=>({path:i.path.join('.'),message:i.message}))},meta:{requestId}});
   else if(error instanceof BusinessError)res.status(error.status).json({error:{code:error.code,message:error.message,...(error.details?{details:error.details}:{})},meta:{requestId}});
   else if(['23503','23514','22003'].includes(error.code))res.status(400).json({error:{code:'VALIDATION_FAILED',message:'数据不符合关联或数值约束'},meta:{requestId}});
   else if(['55P03','40P01'].includes(error.code))res.status(409).json({error:{code:'BUSY_RETRY_REQUIRED',message:'同一订单正在处理，请查询本次结果后重试'},meta:{requestId}});
   else if(error instanceof Error&&/小数|金额|数量|倍率|计算结果/.test(error.message))res.status(400).json({error:{code:'VALIDATION_FAILED',message:error.message},meta:{requestId}});
   else{console.error('request_failed',requestId,error?.code||error?.name||'unknown');res.status(500).json({error:{code:'INTERNAL_ERROR',message:'处理失败，请凭请求编号核对'},meta:{requestId}});}
  }
 }
}
