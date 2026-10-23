import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Config } from './config';
import { Database } from './db/database';
import { AuthService } from './auth/auth';
import { CoreStore } from './core/store';
import { PurchaseService } from './core/purchases';
import { SupplierService } from './core/suppliers';
import { PricingService } from './core/pricing';
import { DeliveryService } from './delivery/service';
import { createStorage,type ObjectStorage } from './delivery/storage';
import { ApiController } from './http/controller';
export async function createApp(config:Config,db=new Database(config.databaseUrl),clock=()=>new Date(),extra?:{storage?:ObjectStorage}){
 const store=new CoreStore(db,clock);
 @Module({controllers:[ApiController],providers:[{provide:DeliveryService,useValue:new DeliveryService(store,extra?.storage||createStorage(),{production:config.production})},{provide:CoreStore,useValue:store},{provide:AuthService,useValue:new AuthService(db,config,clock)},{provide:PurchaseService,useValue:new PurchaseService(store)},{provide:SupplierService,useValue:new SupplierService(store,config)},{provide:PricingService,useValue:new PricingService(store)}]})class AppModule{}
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:['error','warn']});
 app.enableCors({origin:(origin:string|undefined,callback:(error:Error|null,allow?:boolean)=>void)=>callback(null,!origin||config.allowedOrigins.includes(origin)),methods:['GET','POST','PATCH','PUT','OPTIONS'],allowedHeaders:['Content-Type','Authorization','Idempotency-Key'],credentials:false});
 app.useBodyParser('json',{limit:'256kb'});return app;
}
