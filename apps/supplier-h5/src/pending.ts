import type { SupplierLineInput } from '@quote/contracts';
export type SubmissionBody={validUntil:string;lines:SupplierLineInput[]};
export type StoredSubmission={key:string;body?:SubmissionBody};
export function retainPending(status:number|undefined,unknown:boolean):boolean{return unknown||status===undefined||status>=500||[401,403,408,410].includes(status);}
export function restoreSubmission(value:string|null):StoredSubmission|null{if(!value)return null;let parsed:unknown;try{parsed=JSON.parse(value);}catch{return {key:value};}if(typeof parsed==='string')return {key:parsed};if(typeof parsed!=='object'||parsed===null||!('key' in parsed)||typeof parsed.key!=='string')return {key:value};const record=parsed as StoredSubmission;return record.body&&typeof record.body.validUntil==='string'&&Array.isArray(record.body.lines)?record:{key:record.key};}
