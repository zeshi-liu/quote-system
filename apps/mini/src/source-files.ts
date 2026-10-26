import {resolveSourceDownload,type AssetStore} from '../../../packages/source-client/src';
import {createIndexedDbAssets,createPersistentFileAssets} from '../../../packages/source-client/src/assets';
export const sourceApiBase=()=>(import.meta.env.VITE_API_BASE_URL||'http://127.0.0.1:3000/api/v1').replace(/\/$/,'');
export const sourceDescriptorStorage={getItem:(key:string)=>{const value=uni.getStorageSync(key);return typeof value==='string'?value:value?JSON.stringify(value):null;},setItem:(key:string,value:string)=>uni.setStorageSync(key,value),removeItem:(key:string)=>uni.removeStorageSync(key)};
interface WechatSource {env:{USER_DATA_PATH:string};getFileSystemManager:typeof uni.getFileSystemManager;chooseMessageFile(options:{count:number;type:'file';extension:string[];success:(r:{tempFiles:{name:string;size:number;path:string}[]})=>void;fail:(e:{errMsg?:string})=>void}):void;shareFileMessage?(options:{filePath:string;fileName:string;success:()=>void;fail:()=>void}):void;}
declare const wx:WechatSource;
export function createMiniSourceAssets():AssetStore<Blob|string>{
 // #ifdef H5
 return createIndexedDbAssets() as AssetStore<Blob|string>;
 // #endif
 // #ifdef MP-WEIXIN
 return createPersistentFileAssets(wx.getFileSystemManager(),wx.env.USER_DATA_PATH) as AssetStore<Blob|string>;
 // #endif
 throw new Error('当前客户端暂不支持持久保存原文件，请在 PC 上传。');
}
export function chooseSourceFiles(images:boolean):Promise<{name:string;mime:string;size:number;asset:Blob|string}[]>{
 // #ifdef H5
 return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept=images?'.jpg,.jpeg,.png':'.xlsx,.xls,.csv';input.multiple=images;input.onchange=()=>{const files=Array.from(input.files||[]);resolve(files.map(f=>({name:f.name,mime:f.type,size:f.size,asset:f})));input.remove();};input.oncancel=()=>{resolve([]);input.remove();};input.style.display='none';document.body.appendChild(input);input.click();});
 // #endif
 // #ifdef MP-WEIXIN
 if(images)return new Promise((resolve,reject)=>uni.chooseImage({count:9,sizeType:['original'],sourceType:['album','camera'],success:r=>resolve((r.tempFiles as UniApp.ChooseImageSuccessCallbackResultFile[]).map((f,i)=>({name:f.path.split('/').pop()||'采购单-'+(i+1)+'.jpg',mime:'',size:f.size,asset:f.path}))),fail:e=>e.errMsg.includes('cancel')?resolve([]):reject(new Error('图片选择失败，请重试。'))}));
 return new Promise((resolve,reject)=>wx.chooseMessageFile({count:1,type:'file',extension:['xlsx','xls','csv'],success:r=>resolve(r.tempFiles.map(f=>({name:f.name,mime:'',size:f.size,asset:f.path}))),fail:e=>e.errMsg?.includes('cancel')?resolve([]):reject(new Error('文件选择失败，请重试。'))}));
 // #endif
 return Promise.reject(new Error('当前客户端不支持文件选择，请在 PC 上传。'));
}
/** URL validation happens before attaching the captured Bearer token. */
function assertCurrent(current:()=>boolean){if(!current())throw new Error('页面或登录会话已变化，已停止读取原文件。');}
export async function fetchMiniPrivateSource(url:string,token:string,base:string,transport:typeof fetch=fetch,current:()=>boolean=()=>true):Promise<Blob>{const safe=resolveSourceDownload(url,base);assertCurrent(current);if(!token)throw Object.assign(new Error('请重新登录后读取原文件。'),{status:401});const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await transport(safe,{credentials:'omit',headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal});assertCurrent(current);if(!response.ok)throw Object.assign(new Error('原文件读取失败，请重新登录或获取下载凭证。'),{status:response.status});const blob=await response.blob();assertCurrent(current);return blob;}finally{clearTimeout(timer);}}
/** current must cover the page lifetime and captured identity; check again after each async boundary. */
export async function openMiniSource(url:string,token:string,file:{fileName:string;fileType:string},download=false,current:()=>boolean=()=>true){if(!current())return;try{const safe=resolveSourceDownload(url,sourceApiBase());if(!token)throw Object.assign(new Error('请重新登录后读取原文件。'),{status:401});
 // #ifdef H5
 const blob=await fetchMiniPrivateSource(safe,token,sourceApiBase(),fetch,current);if(!current())return;const objectUrl=URL.createObjectURL(blob);let presented=false;try{if(!current())return;if(['png','jpg','jpeg'].includes(file.fileType)&&!download){if(!current())return;uni.previewImage({urls:[objectUrl],current:objectUrl,complete:()=>setTimeout(()=>URL.revokeObjectURL(objectUrl),60000)});presented=true;}else{const a=document.createElement('a');a.href=objectUrl;a.download=file.fileName;a.rel='noopener';try{if(!current())return;document.body.appendChild(a);if(!current())return;a.click();presented=true;setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);}finally{a.remove();}}}finally{if(!presented)URL.revokeObjectURL(objectUrl);}return;
 // #endif
 // #ifdef MP-WEIXIN
 const local=await new Promise<string>((resolve,reject)=>uni.downloadFile({url:safe,header:{Authorization:'Bearer '+token},timeout:20000,success:r=>r.statusCode===200?resolve(r.tempFilePath):reject(Object.assign(new Error('原文件读取失败，请重新取得下载凭证。'),{status:r.statusCode})),fail:()=>reject(new Error('原文件下载中断，请重新读取。'))}));
 if(!current())return;
 if(['png','jpg','jpeg'].includes(file.fileType)&&!download){if(!current())return;uni.previewImage({urls:[local],current:local});return;}
 if(wx.shareFileMessage){if(!current())return;await new Promise<void>((resolve,reject)=>wx.shareFileMessage!({filePath:local,fileName:file.fileName,success:resolve,fail:()=>reject(new Error('文件已下载，分享或保存未完成，可重试。'))}));if(!current())return;return;}
 if(!current())return;await new Promise<void>((resolve,reject)=>uni.openDocument({filePath:local,showMenu:true,success:()=>resolve(),fail:()=>reject(new Error('原文件已下载，当前客户端无法打开此格式；可在 PC 下载。'))}));if(!current())return;return;
 // #endif
 }catch(e){if(current())throw e;}
}
