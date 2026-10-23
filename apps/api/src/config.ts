export interface Config {databaseUrl:string;supplierWebUrl:string;trialPasswordLogin:boolean;production:boolean;wechatAppId:string;wechatAppSecret:string;allowedOrigins:string[];}
export function configuration():Config {
 const production=process.env.NODE_ENV==='production';
 if(!process.env.DATABASE_URL)throw new Error('请配置 DATABASE_URL');
 if(production && process.env.TRIAL_PASSWORD_LOGIN==='true')throw new Error('生产环境禁止开发试用登录');
 if(production && process.env.DEV_PGLITE==='true')throw new Error('生产环境禁止使用开发用 PGlite');
 const supplierWebUrl=process.env.SUPPLIER_WEB_URL||'http://127.0.0.1:5174';
 if(production&&!supplierWebUrl.startsWith('https://'))throw new Error('生产厂家入口必须使用 HTTPS');
 return {databaseUrl:process.env.DATABASE_URL,supplierWebUrl,production,trialPasswordLogin:!production&&process.env.TRIAL_PASSWORD_LOGIN==='true',wechatAppId:process.env.WECHAT_APP_ID||'',wechatAppSecret:process.env.WECHAT_APP_SECRET||'',allowedOrigins:(process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174').split(',').filter(Boolean)};
}
