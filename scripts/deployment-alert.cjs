'use strict';
const events=new Set(['unit_failed','backup_stale','backup_rpo_target_missed','backup_monitor_failed']);
/** Generic HTTPS webhook contract. HTTP acceptance is distinct from operator receipt. */
async function notify(message,env=process.env,transport=fetch){
 if(!events.has(message?.event))throw Error('invalid_alert_event');
 if(!/^quote-[a-zA-Z0-9_.@-]{1,100}\.service$/.test(message?.unit||''))throw Error('invalid_alert_unit');
 const payload={version:1,event:message.event,unit:message.unit,occurredAt:new Date().toISOString()};
 const record={event:'ops_alert',trigger:message.event,unit:message.unit};
 if(!env.OPS_ALERT_DRIVER||env.OPS_ALERT_DRIVER==='disabled')return {...record,outcome:'unavailable',reason:'not_configured'};
 const timeout=Number(env.OPS_ALERT_TIMEOUT_MS||5000);let url;
 try{url=new URL(env.OPS_ALERT_WEBHOOK_URL);if(env.OPS_ALERT_DRIVER!=='webhook'||url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>2048||!Number.isInteger(timeout)||timeout<1||timeout>10000||/[\r\n]/.test(env.OPS_ALERT_BEARER_TOKEN||''))throw Error();}
 catch{return {...record,outcome:'unavailable',reason:'invalid_configuration'};}
 const headers={'Content-Type':'application/json'};if(env.OPS_ALERT_BEARER_TOKEN)headers.Authorization='Bearer '+env.OPS_ALERT_BEARER_TOKEN;
 try{
  const response=await transport(url.href,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(timeout)});
  // Do not retain or print provider response content. The status is the only evidence.
  await response.body?.cancel();
  if(!Number.isInteger(response.status)||response.status<100||response.status>599)return {...record,outcome:'outcome_unknown',reason:'invalid_provider_response'};
  return response.ok?{...record,outcome:'accepted',httpStatus:response.status}:{...record,outcome:'rejected',httpStatus:response.status};
 }catch{return {...record,outcome:'outcome_unknown',reason:'provider_response_unknown'};}
}
function exitCode(record){return record.outcome==='accepted'?0:record.outcome==='unavailable'?2:record.outcome==='outcome_unknown'?3:1;}
module.exports={notify,exitCode};
if(require.main===module){const event=(process.argv[2]||'').replaceAll('-','_'),unit=process.argv[3];notify({event,unit}).then(record=>{console.log(JSON.stringify(record));process.exitCode=exitCode(record);}).catch(()=>{console.error(JSON.stringify({event:'ops_alert',outcome:'unavailable',reason:'invalid_request'}));process.exitCode=2;});}
