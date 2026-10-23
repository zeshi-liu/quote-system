import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runOnce,renderInChild} from '../src/delivery/worker';
import {sample} from './render-fixture';
const claim={jobId:'job',exportId:'export',versionId:'v',generation:1,format:'xlsx' as const,document:sample,objectKey:'exports/job/g1.xlsx',deadline:new Date(Date.now()+600000).toISOString()};
test('worker 先上传独立对象，再尝试事务绑定；存储失败只登记失败',async()=>{
 const events:string[]=[];const store={recover:async()=>{},claim:async()=>claim,finish:async()=>{events.push('finish');},fail:async()=>{events.push('fail');}};const storage={put:async()=>{events.push('put');},read:async()=>Buffer.from('file'),remove:async()=>{},signedDownload:async()=>null};
 assert.equal(await runOnce(store,storage,async()=>Buffer.from('file')),true);assert.deepEqual(events,['put','finish']);
 events.length=0;storage.put=async()=>{throw new Error('object timeout');};await runOnce(store,storage,async()=>Buffer.from('file'));assert.deepEqual(events,['fail']);
});
test('真实子进程渲染，超时强制退出且不会返回伪成功文件',async()=>{
 const bytes=await renderInChild(sample,'xlsx');assert.equal(bytes.subarray(0,2).toString(),'PK');
 await assert.rejects(renderInChild(sample,'pdf',{timeoutMs:1}),/超时/);
});

test('存储回读字节变化时不得绑定成功',async()=>{const events:string[]=[];const store={recover:async()=>{},claim:async()=>claim,finish:async()=>{events.push('finish');},fail:async()=>{events.push('fail');}};await runOnce(store,{put:async()=>{},read:async()=>Buffer.from('changed'),remove:async()=>{},signedDownload:async()=>null},async()=>Buffer.from('file'));assert.deepEqual(events,['fail']);});
