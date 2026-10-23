import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
async function main(){
 if(process.env.NODE_ENV==='production')throw new Error('PGlite 仅用于本地开发，不代替正式 PostgreSQL 或并发验收');
 await mkdir('.local',{recursive:true,mode:0o700});
 let credentials:{trialPassword:string};try{credentials=JSON.parse(await readFile('.local/trial-credentials.json','utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;credentials={trialPassword:randomBytes(18).toString('base64url')};await writeFile('.local/trial-credentials.json',JSON.stringify(credentials,null,2),{mode:0o600,flag:'wx'});}
 const port=Number(process.env.LOCAL_PG_PORT||25432),db=await PGlite.create(resolve('.local/offline-postgres'));
 const server=new PGLiteSocketServer({db,port,host:'127.0.0.1'});await server.start();
 await writeFile('.local/trial.env',`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/postgres\nDEV_PGLITE=true\nTRIAL_PASSWORD=${credentials.trialPassword}\nTRIAL_PASSWORD_LOGIN=true\nSUPPLIER_WEB_URL=http://127.0.0.1:5174\nAPI_HOST=127.0.0.1\n`,{mode:0o600});
 console.log(`开发用 PostgreSQL WASM 运行于 127.0.0.1:${port}，配置在 .local/trial.env；未验证正式 PostgreSQL 多连接行锁。`);
 let stopping=false;const close=async()=>{if(stopping)return;stopping=true;await server.stop();await db.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);await new Promise(()=>{});
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
