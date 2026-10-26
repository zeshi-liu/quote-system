import {resolve} from 'node:path';
import {Database} from '../apps/api/src/db/database';
import {CoreStore} from '../apps/api/src/core/store';
import {initializeAdmin} from '../apps/api/src/master-data/identity';
export {initializeAdmin};
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/init-admin.ts')){
 (async()=>{if(!process.env.DATABASE_URL||!process.env.ADMIN_LOGIN_NAME||!process.env.ADMIN_NAME||!process.env.ADMIN_PHONE)throw new Error('请设置 DATABASE_URL、ADMIN_LOGIN_NAME、ADMIN_NAME、ADMIN_PHONE');if(!process.stdout.isTTY)throw new Error('临时密码只允许向当前交互终端展示，请勿重定向到日志');const db=new Database(process.env.DATABASE_URL);try{await db.migrate();const result=await initializeAdmin(new CoreStore(db),{loginName:process.env.ADMIN_LOGIN_NAME,name:process.env.ADMIN_NAME,phone:process.env.ADMIN_PHONE});process.stdout.write('首个管理员已建立：'+result.user.loginName+'\n临时密码（仅此一次展示）：'+result.temporaryPassword+'\n有效期至：'+result.temporaryPasswordExpiresAt+'\n首次登录须设置本人新密码，完成后重新登录。\n');}finally{await db.close();}})().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'初始化失败');process.exitCode=1;});
}
