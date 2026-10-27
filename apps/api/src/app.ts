import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {trustedProxy,type Config} from './config';
import {isIP} from 'node:net';
import type {Request,Response,NextFunction} from 'express';
import { Database } from './db/database';
import { AuthService } from './auth/auth';
import { PcAuthService } from './auth/pc';
import { CoreStore } from './core/store';
import { PurchaseService } from './core/purchases';
import { SupplierService } from './core/suppliers';
import { PricingService } from './core/pricing';
import { ReceivableService } from './receivables/service';
import { ArchiveService } from './archive/service';
import { DeliveryService } from './delivery/service';
import { createStorage,type ObjectStorage } from './delivery/storage';
import { ApiController } from './http/controller';
import { FeatureService } from './features';
export async function createApp(config:Config,db=new Database(config.databaseUrl),clock=()=>new Date(),extra?:{storage?:ObjectStorage}){
 const trustProxy=trustedProxy(config.trustedProxyIps);
 const store=new CoreStore(db,clock),auth=new AuthService(db,config,clock),storage=extra?.storage||createStorage(),features=new FeatureService(store,storage,auth);
 @Module({controllers:[ApiController],providers:[{provide:FeatureService,useValue:features},{provide:ReceivableService,useValue:new ReceivableService(store)},{provide:PcAuthService,useValue:new PcAuthService(auth)},{provide:ArchiveService,useValue:new ArchiveService(store)},{provide:DeliveryService,useValue:new DeliveryService(store,storage,{production:config.production})},{provide:CoreStore,useValue:store},{provide:AuthService,useValue:auth},{provide:PurchaseService,useValue:new PurchaseService(store)},{provide:SupplierService,useValue:new SupplierService(store,config)},{provide:PricingService,useValue:new PricingService(store)}]})class AppModule{}
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:['error','warn']});
 app.set('trust proxy',trustProxy);
 // The deployment proxy overwrites XFF with one socket address; chains are never accepted.
 app.use((req:Request,res:Response,next:NextFunction)=>{const forwarded=req.headers['x-forwarded-for'];if(trustProxy(req.socket.remoteAddress||'',0)&&forwarded!==undefined&&(typeof forwarded!=='string'||!isIP(forwarded.trim()))){res.status(400).json({error:{code:'INVALID_FORWARDED_FOR',message:'代理来源信息无效'}});return;}next();});
 app.enableCors({origin:(origin:string|undefined,callback:(error:Error|null,allow?:boolean)=>void)=>callback(null,!origin||config.allowedOrigins.includes(origin)),methods:['GET','POST','PATCH','PUT','OPTIONS'],allowedHeaders:['Content-Type','Authorization','Idempotency-Key','X-CSRF-Token'],credentials:false});
 // A decoded 20 MiB file uses about 28 MiB in base64; business payloads keep an 8 MiB bound for 1000-row source previews.
 app.use((req:any,res:any,next:any)=>{if(req.path!=='/api/v1/files/upload'&&Number(req.headers['content-length']||0)>8*1024*1024){res.status(413).json({error:{code:'PAYLOAD_TOO_LARGE',message:'业务请求内容过大'}});return;}next();});
 app.useBodyParser('json',{limit:'29mb'});return app;
}
