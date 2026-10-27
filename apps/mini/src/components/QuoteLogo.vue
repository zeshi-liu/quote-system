<script setup lang="ts">
import {onBeforeUnmount,ref,watch} from 'vue';
import type {QuoteDocument} from '@quote/contracts';
import {ApiFailure,session} from '../api';
const props=defineProps<{quoteId:string;versionId:string;logo:NonNullable<QuoteDocument['logo']>}>(),emit=defineEmits<{(e:'failure',value:unknown):void}>();
const image=ref(''),error=ref(''),loading=ref(false);let epoch=0,objectUrl='';let cancel:undefined|(()=>void);
function release(){cancel?.();cancel=undefined;
 // #ifdef H5
 if(objectUrl)URL.revokeObjectURL(objectUrl);
 // #endif
 objectUrl='';image.value='';}
async function load(){const scope=JSON.stringify([props.quoteId,props.versionId,props.logo,session.value?.user.id,session.value?.token]),current=++epoch,token=session.value?.token;const live=()=>current===epoch&&scope===JSON.stringify([props.quoteId,props.versionId,props.logo,session.value?.user.id,session.value?.token]);release();loading.value=true;error.value='';try{if(!token)throw new ApiFailure('UNAUTHENTICATED','请重新登录。',false,401);const base=(import.meta.env.VITE_API_BASE_URL||'http://127.0.0.1:3000/api/v1').replace(/\/$/,''),url=base+'/quotes/'+encodeURIComponent(props.quoteId)+'/versions/'+encodeURIComponent(props.versionId)+'/logo';
 // #ifdef H5
 const abort=new AbortController();cancel=()=>abort.abort();let timer:ReturnType<typeof setTimeout>|undefined;try{const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new ApiFailure('REQUEST_TIMEOUT','图片读取超时，请重试。',true));},20000);}),work=(async()=>{const response=await fetch(url,{headers:{Authorization:'Bearer '+token},credentials:'omit',signal:abort.signal});if(!response.ok)throw new ApiFailure('IMAGE_UNAVAILABLE','报价图片读取失败，请重试。',false,response.status);if(!['image/png','image/jpeg'].includes(response.headers.get('content-type')?.split(';')[0]||''))throw new Error('图片格式无法核实。');const blob=await response.blob();if(!blob.size||blob.size>20*1024*1024)throw new Error('图片大小无法核实。');return blob;})();const blob=await Promise.race([work,timeout]);if(live()){objectUrl=URL.createObjectURL(blob);image.value=objectUrl;}}finally{clearTimeout(timer);}
 // #endif
 // #ifdef MP-WEIXIN
 const path=await new Promise<string>((resolve,reject)=>{const task=uni.downloadFile({url,header:{Authorization:'Bearer '+token},timeout:20000,success:r=>r.statusCode===200?resolve(r.tempFilePath):reject(new ApiFailure('IMAGE_UNAVAILABLE','报价图片读取失败，请重试。',false,r.statusCode)),fail:()=>reject(new Error('图片读取中断，请重试。'))});cancel=()=>task.abort();});if(live())image.value=path;
 // #endif
 }catch(e){if(!live())return;error.value=e instanceof Error?e.message:'报价图片读取失败';emit('failure',e);}finally{if(live())loading.value=false;}}
watch(()=>JSON.stringify([props.quoteId,props.versionId,props.logo,session.value?.user.id,session.value?.token]),()=>void load(),{immediate:true});onBeforeUnmount(()=>{epoch++;release();});
</script>
<template><view class="quote-logo"><image v-if="image" :src="image" mode="aspectFit" aria-label="报价单品牌标志"/><text v-else-if="loading">正在读取报价单标志…</text><view v-if="error"><text>{{error}}</text><button :disabled="loading" @click="load">重新读取图片</button></view></view></template>
<style scoped>.quote-logo{margin:20rpx 0}.quote-logo image{width:280rpx;height:110rpx}.quote-logo text{font-size:23rpx;color:#69796e}</style>
