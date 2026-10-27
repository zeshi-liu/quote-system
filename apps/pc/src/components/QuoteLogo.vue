<script setup lang="ts">
import {onBeforeUnmount,ref,watch} from 'vue';
import type {PcApi} from '../api';
import type {QuoteDocument} from '@quote/contracts';
const props=defineProps<{api:Pick<PcApi,'getImage'>;quoteId:string;versionId:string;logo:NonNullable<QuoteDocument['logo']>}>(),emit=defineEmits<{failure:[error:unknown]}>();
const image=ref(''),error=ref(''),loading=ref(false);let epoch=0;
function release(){if(image.value)URL.revokeObjectURL(image.value);image.value='';}
async function load(){const current=++epoch;release();loading.value=true;error.value='';try{const blob=await props.api.getImage('/quotes/'+encodeURIComponent(props.quoteId)+'/versions/'+encodeURIComponent(props.versionId)+'/logo');if(current!==epoch)return;image.value=URL.createObjectURL(blob);}catch(e){if(current!==epoch)return;error.value=e instanceof Error?e.message:'报价图片读取失败';emit('failure',e);}finally{if(current===epoch)loading.value=false;}}
watch(()=>JSON.stringify([props.quoteId,props.versionId,props.logo]),()=>void load(),{immediate:true});onBeforeUnmount(()=>{epoch++;release();});
</script>
<template><div class="quote-logo"><img v-if="image" :src="image" alt="报价单品牌标志"/><span v-else-if="loading">正在读取报价单标志…</span><template v-if="error"><span role="alert">{{error}}</span><button :disabled="loading" @click="load">重新读取图片</button></template></div></template>
<style scoped>.quote-logo{margin:14px 0}.quote-logo img{display:block;max-width:160px;max-height:64px;object-fit:contain}.quote-logo span{font-size:12px;color:#69796e}.quote-logo button{margin-left:10px}</style>
