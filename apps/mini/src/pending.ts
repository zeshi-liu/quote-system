export type StoredOperation={key:string;label:string;path?:string;method?:'POST'|'PUT';data?:Record<string,unknown>};
export type ReplayDescriptor={key:string;path:string;method:'POST'|'PUT';data:Record<string,unknown>};
export function retainPending(status:number|undefined,unknown:boolean):boolean{return unknown||status===undefined||status>=500||[401,403,408,410].includes(status);}
export function recordOperation(key:string,label:string,path:string,method:'POST'|'PUT',data:Record<string,unknown>):StoredOperation{return {key,label,path,method,data:JSON.parse(JSON.stringify(data))};}
export function replayDescriptor(operation:StoredOperation|null):ReplayDescriptor|null{if(!operation?.key||!operation.path?.startsWith('/')||!['POST','PUT'].includes(operation.method||'')||!operation.data||typeof operation.data!=='object'||Array.isArray(operation.data))return null;return {key:operation.key,path:operation.path,method:operation.method!,data:operation.data};}
