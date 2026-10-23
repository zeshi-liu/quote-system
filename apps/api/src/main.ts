import { configuration } from './config';
import { Database } from './db/database';
import { createApp } from './app';
async function main(){const config=configuration(),db=new Database(config.databaseUrl);await db.migrate();const app=await createApp(config,db);const close=async()=>{await app.close();await db.close();process.exit(0);};process.once('SIGTERM',close);process.once('SIGINT',close);await app.listen(Number(process.env.API_PORT||3000),process.env.API_HOST||'127.0.0.1');console.log('API ready on port',process.env.API_PORT||3000);}
main().catch(error=>{console.error(error instanceof Error?error.message:'startup_failed');process.exitCode=1;});
