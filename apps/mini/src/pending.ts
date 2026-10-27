import {receivableOperationTarget} from '@quote/receivables-client';
export type StoredOperation={key:string;label:string;path?:string;method?:'POST'|'PUT';data?:Record<string,unknown>};
export type ReplayDescriptor={key:string;path:string;method:'POST'|'PUT';data:Record<string,unknown>};
export function retainPending(status:number|undefined,unknown:boolean):boolean{return unknown||status===undefined||status>=500||[401,403,404,408,410].includes(status);}
export function recordOperation(key:string,label:string,path:string,method:'POST'|'PUT',data:Record<string,unknown>):StoredOperation{return {key,label,path,method,data:JSON.parse(JSON.stringify(data))};}
export function replayDescriptor(operation:StoredOperation|null):ReplayDescriptor|null{if(!operation?.key||!operation.path?.startsWith('/')||!['POST','PUT'].includes(operation.method||'')||!operation.data||typeof operation.data!=='object'||Array.isArray(operation.data))return null;return {key:operation.key,path:operation.path,method:operation.method!,data:operation.data};}
export function exportVersionForOperation(operation:Pick<StoredOperation,'path'|'method'>|null):string|null{return operation?.method==='POST'?operation.path?.match(/^\/quotes\/[^/]+\/versions\/([^/]+)\/export$/)?.[1]||null:null;}
export function committedOperationNotice(operation:StoredOperation|null):string{return exportVersionForOperation(operation)?'导出请求已受理，请核对文件生成结果；请从列表打开对应采购单。':'上次操作已成功，请从列表打开对应采购单查看结果。';}

export function receivableForOperation(operation:StoredOperation|null){return receivableOperationTarget(operation);}
