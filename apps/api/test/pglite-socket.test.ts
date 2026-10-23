import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {offlineSocketOptions} from '../../../scripts/pglite-options';

test('开发PGlite预期SQL拒绝后立即替换连接，后续查询不被断开',{skip:process.env.TEST_DB_MODE!=='pglite'},async()=>{
 const db=await PGlite.create(),server=new PGLiteSocketServer({db,port:0,...offlineSocketOptions});let port=0;
 server.addEventListener('listening',event=>{port=(event as CustomEvent<{port:number}>).detail.port;});
 await server.start();const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,max:1,connectionTimeoutMillis:5000});
 try{for(let i=0;i<40;i++){
  await assert.rejects(pool.query('SELECT 1/0'),(error:any)=>error.code==='22012');
  assert.equal((await pool.query('SELECT 1 AS alive')).rows[0].alive,1);
 }}finally{
  await pool.end();const until=Date.now()+3000;while(server.getStats().activeConnections&&Date.now()<until)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(server.getStats().activeConnections,0,'关闭引擎前须完成socket handler清理');await server.stop();await db.close();
 }
});
