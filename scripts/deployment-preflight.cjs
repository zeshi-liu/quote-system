'use strict';
// Offline validation: diagnostics contain field names only, never supplied values.
function validate(env=process.env,options={}){
 const errors=[];const bad=(key)=>errors.push(key);const required=['DATABASE_URL','SUPPLIER_WEB_URL','ALLOWED_ORIGINS','COS_SECRET_ID','COS_SECRET_KEY','COS_BUCKET','COS_REGION','QUOTE_SELLER_NAME','QUOTE_CONTACT','EXPORT_FONT_PATH','EXPORT_FONT_FAMILY'];
 for(const key of required)if(!env[key]?.trim()||/replace[_ -]?me|change[_ -]?me|example\.com|your[_ -]|placeholder/i.test(env[key]))bad(key);
 if(env.NODE_ENV!=='production')bad('NODE_ENV');if(env.TRIAL_PASSWORD_LOGIN!=='false')bad('TRIAL_PASSWORD_LOGIN');if(env.DEV_PGLITE==='true')bad('DEV_PGLITE');if(env.FILE_STORAGE_DRIVER!=='cos')bad('FILE_STORAGE_DRIVER');
 try{const url=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.password||['postgres','quote_user'].includes(decodeURIComponent(url.username))||decodeURIComponent(url.password).length<16)bad('DATABASE_URL');}catch{bad('DATABASE_URL');}
 try{const supplier=new URL(env.SUPPLIER_WEB_URL);if(supplier.protocol!=='https:'||supplier.username||supplier.password||supplier.hash||supplier.search)bad('SUPPLIER_WEB_URL');const origins=env.ALLOWED_ORIGINS.split(',').map(s=>s.trim());if(!origins.includes(supplier.origin)||origins.some(s=>{const u=new URL(s);return u.protocol!=='https:'||u.origin!==s;}))bad('ALLOWED_ORIGINS');}catch{bad('HTTPS_ORIGINS');}
 if(!['false','true'].includes(env.REMINDER_SEND_WECHAT||'false'))bad('REMINDER_SEND_WECHAT');
 if(env.REMINDER_SEND_WECHAT==='true')for(const key of ['WECHAT_APP_ID','WECHAT_APP_SECRET','WECHAT_REMINDER_TEMPLATE_ID','WECHAT_REMINDER_PAGE','WECHAT_REMINDER_FIELDS'])if(!env[key]?.trim())bad(key);
 if((env.WECHAT_APP_ID&&!env.WECHAT_APP_SECRET)||(!env.WECHAT_APP_ID&&env.WECHAT_APP_SECRET))bad('WECHAT_CREDENTIAL_PAIR');
 if(env.REMINDER_SEND_WECHAT==='true'){try{const fields=JSON.parse(env.WECHAT_REMINDER_FIELDS);if(!fields||Array.isArray(fields)||typeof fields!=='object')bad('WECHAT_REMINDER_FIELDS');}catch{bad('WECHAT_REMINDER_FIELDS');}}
 if(env.COS_BUCKET===env.BACKUP_COS_BUCKET)bad('BACKUP_COS_BUCKET_MUST_BE_SEPARATE');
 const diskPaths=(env.HEAVY_DISK_PATHS||'').split(',').map(p=>p.trim()).filter(Boolean);if(options.heavy&&(['/tmp','/monitor/postgres','/monitor/backup'].some(p=>!diskPaths.includes(p))||diskPaths.some(p=>!p.startsWith('/')||p.includes('..')||/[\r\n]/.test(p))))bad('HEAVY_DISK_PATHS');
 if(errors.length)throw Error('deployment_preflight_invalid: '+[...new Set(errors)].join(', '));
 return {production:true,wechatSend:env.REMINDER_SEND_WECHAT==='true',diskPaths};
}
module.exports={validate};if(require.main===module){try{validate();console.log('deployment_preflight_ok (offline; no connectivity/acceptance claim)');}catch(e){console.error(e.message);process.exitCode=1;}}
