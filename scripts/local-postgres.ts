import EmbeddedPostgres from 'embedded-postgres';
import { mkdir,readFile,writeFile,access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
async function main(){
 if(process.env.NODE_ENV==='production')throw new Error('本地 PostgreSQL 辅助程序不用于生产');
 process.env.LC_ALL='C';
 const local=resolve('.local');await mkdir(local,{recursive:true,mode:0o700});
 let credentials:{databasePassword:string;trialPassword:string};
 try{credentials=JSON.parse(await readFile(resolve(local,'trial-credentials.json'),'utf8'));}
 catch(error:any){if(error.code!=='ENOENT')throw error;credentials={databasePassword:randomBytes(24).toString('base64url'),trialPassword:randomBytes(18).toString('base64url')};await writeFile(resolve(local,'trial-credentials.json'),JSON.stringify(credentials,null,2),{mode:0o600,flag:'wx'});}
 if(!credentials.databasePassword){credentials.databasePassword=randomBytes(24).toString('base64url');await writeFile(resolve(local,'trial-credentials.json'),JSON.stringify(credentials,null,2),{mode:0o600});}
 const databaseDir=resolve(local,'postgres'),port=Number(process.env.LOCAL_PG_PORT||25432);
 const pg=new EmbeddedPostgres({databaseDir,port,user:'quote_dev',password:credentials.databasePassword,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:error=>console.error('postgres:',error)});
 let initialized=true;try{await access(resolve(databaseDir,'PG_VERSION'));}catch{initialized=false;}
 if(!initialized)await pg.initialise();await pg.start();
 const env=`DATABASE_URL=postgresql://quote_dev:${credentials.databasePassword}@127.0.0.1:${port}/postgres\nTRIAL_PASSWORD=${credentials.trialPassword}\nTRIAL_PASSWORD_LOGIN=true\nSUPPLIER_WEB_URL=http://127.0.0.1:5174\nAPI_HOST=127.0.0.1\n`;
 await writeFile(resolve(local,'trial.env'),env,{mode:0o600});
 console.log(`本地 PostgreSQL 已启动（127.0.0.1:${port}）。配置位于 .local/trial.env，仅使用虚构数据。`);
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await pg.stop();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);await new Promise(()=>{});
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
