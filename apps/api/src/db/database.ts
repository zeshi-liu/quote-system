import { Pool, types, type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
types.setTypeParser(1082, value => value);
export class Database {
  readonly pool: Pool;
  constructor(url: string, max=process.env.DEV_PGLITE==='true'?1:8, schema?:string) {
    if(schema&&!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('无效的数据库 schema');
    this.pool = new Pool({connectionString:url,max,connectionTimeoutMillis:5000,...(schema?{options:'-c search_path='+schema+',public'}:{})});
  }
  query(text: string, values: unknown[] = []) { return this.pool.query(text,values); }
  async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client=await this.pool.connect();
    try { await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");const value=await action(client);await client.query('COMMIT');return value; }
    catch(error) { await client.query('ROLLBACK');throw error; } finally {client.release();}
  }
  async migrate() {
    const sql=await readFile(resolve(__dirname,'../../migrations/001_core.sql'),'utf8');
    const checksum=createHash('sha256').update(sql).digest('hex');
    await this.transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(790123)');
      await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL)');
      const old=await c.query("SELECT checksum FROM schema_migrations WHERE version='001_core'");
      if(old.rowCount){if(old.rows[0].checksum!==checksum)throw new Error('迁移校验和变化，须编写新迁移');return;}
      await c.query(sql);await c.query("INSERT INTO schema_migrations VALUES('001_core',$1)",[checksum]);
    });
  }
  close() { return this.pool.end(); }
}
