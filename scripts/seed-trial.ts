import { Database } from '../apps/api/src/db/database';
import { passwordHash } from '../apps/api/src/auth/auth';
import { verify } from '@node-rs/argon2';
import { resolve } from 'node:path';
export async function seedTrial(db:Database,password:string){
 if(password.length<15||password.length>128)throw new Error('试用密码需 15～128 字符');
 const hashed=await passwordHash(password);
 return db.transaction(async c=>{
  await c.query("SELECT pg_advisory_xact_lock(790124)");
  let sales=(await c.query("SELECT * FROM users WHERE login_name='trial.sales'")).rows[0];
  if(sales){if(!sales.password_hash||!await verify(sales.password_hash,password))throw new Error('已有试用账号密码不同，不覆盖既有资料');}
  else sales=(await c.query("INSERT INTO users(login_name,name,role,password_hash) VALUES('trial.sales','试用销售','salesperson',$1) RETURNING *",[hashed])).rows[0];
  let purchaser=(await c.query("SELECT id FROM users WHERE login_name='trial.purchaser'")).rows[0];
  if(!purchaser)purchaser=(await c.query("INSERT INTO users(login_name,name,role) VALUES('trial.purchaser','试用采购员','hospital') RETURNING id")).rows[0];
  let hospital=(await c.query('SELECT h.id FROM hospitals h JOIN hospital_purchasers p ON p.hospital_id=h.id WHERE p.user_id=$1',[purchaser.id])).rows[0];
  if(!hospital){hospital=(await c.query("INSERT INTO hospitals(name,sales_user_id) VALUES('试用医院（虚构）',$1) RETURNING id",[sales.id])).rows[0];await c.query('INSERT INTO hospital_purchasers(user_id,hospital_id) VALUES($1,$2)',[purchaser.id,hospital.id]);}
  const manufacturerIds:string[]=[];
  for(const name of ['甲饮片厂（虚构）','乙饮片厂（虚构）']){let m=(await c.query('SELECT id FROM manufacturers WHERE name=$1',[name])).rows[0];if(!m)m=(await c.query('INSERT INTO manufacturers(name) VALUES($1) RETURNING id',[name])).rows[0];manufacturerIds.push(m.id);}
  return {salesId:sales.id,hospitalId:hospital.id,purchaserId:purchaser.id,manufacturerIds};
 });
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/seed-trial.ts')){
 (async()=>{if(process.env.NODE_ENV==='production')throw new Error('禁止向生产环境植入虚构试用资料');if(!process.env.DATABASE_URL||!process.env.TRIAL_PASSWORD)throw new Error('请配置 DATABASE_URL 和 TRIAL_PASSWORD');const db=new Database(process.env.DATABASE_URL);try{await db.migrate();await seedTrial(db,process.env.TRIAL_PASSWORD);console.log('虚构试用医院及厂家已初始化；登录名 trial.sales，密码使用 TRIAL_PASSWORD。');}finally{await db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
}
