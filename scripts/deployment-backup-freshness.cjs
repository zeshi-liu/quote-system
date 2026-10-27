'use strict';
const {cosAdapter,required,deploymentStage,reportFailure}=require('./deployment-common.cjs');
async function freshness(env=process.env,adapter,now=Date.now()){
 const at=(stage,action)=>deploymentStage('backup_monitor',stage,action);
 const remote=await at('configuration',()=>{required(env,['BACKUP_SCOPE']);if(!/^[a-z0-9-]{1,48}$/.test(env.BACKUP_SCOPE))throw Error('invalid_backup_scope');return adapter||cosAdapter(env);});
 const prefix='backups/'+env.BACKUP_SCOPE+'/';
 const latest=await at('read_manifests',async()=>{const names=(await remote.list(prefix)).filter(k=>/^\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.dump\.age\.json$/.test(k.slice(prefix.length)));let value=0;for(const key of names){const m=await remote.readJson(key);if(m.version!==1||m.key+'.json'!==key||!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isFinite(Date.parse(m.dataTime)))throw Error('invalid_backup_manifest');value=Math.max(value,Date.parse(m.dataTime));}return value;});
 return at('evaluate_age',()=>{if(!latest||latest>now+60000)throw Error('missing_or_future_backup');const ageMinutes=(now-latest)/60000;return {ageMinutes,status:ageMinutes>=120?'rpo_target_missed':ageMinutes>90?'stale':'fresh'};});
}
module.exports={freshness};if(require.main===module)freshness().then(r=>{console.log(JSON.stringify(r));process.exitCode=r.status==='fresh'?0:r.status==='stale'?2:3;}).catch(error=>{reportFailure('backup_monitor',error);process.exitCode=1;});
