export interface Config {databaseUrl:string;supplierWebUrl:string;trialPasswordLogin:boolean;production:boolean;wechatAppId:string;wechatAppSecret:string;allowedOrigins:string[];}
export function configuration():Config {
 const production=process.env.NODE_ENV==='production';
 if(!process.env.DATABASE_URL)throw new Error('请配置 DATABASE_URL');
 if(production && process.env.TRIAL_PASSWORD_LOGIN==='true')throw new Error('生产环境禁止开发试用登录');
 if(production && process.env.DEV_PGLITE==='true')throw new Error('生产环境禁止使用开发用 PGlite');
 const supplierWebUrl=process.env.SUPPLIER_WEB_URL||'http://127.0.0.1:5174';
 if(production&&!supplierWebUrl.startsWith('https://'))throw new Error('生产厂家入口必须使用 HTTPS');
 if(production&&!process.env.ALLOWED_ORIGINS?.trim())throw new Error('生产必须配置可信 ALLOWED_ORIGINS');
 const allowedOrigins=(process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5176,http://127.0.0.1:5176').split(',').map(v=>v.trim()).filter(Boolean);
 if(production&&allowedOrigins.some(value=>{try{const url=new URL(value);return url.protocol!=='https:'||url.origin!==value;}catch{return true;}}))throw new Error('生产 ALLOWED_ORIGINS 必须为明确的 HTTPS 来源');
 return {databaseUrl:process.env.DATABASE_URL,supplierWebUrl,production,trialPasswordLogin:!production&&process.env.TRIAL_PASSWORD_LOGIN==='true',wechatAppId:process.env.WECHAT_APP_ID||'',wechatAppSecret:process.env.WECHAT_APP_SECRET||'',allowedOrigins};
}
