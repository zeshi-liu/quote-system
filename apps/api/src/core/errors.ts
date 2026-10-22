export class BusinessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?:unknown) {super(message);}
}
export function ensure(condition:unknown,status:number,code:string,message:string):asserts condition {if(!condition)throw new BusinessError(status,code,message);}
export const missing=()=>new BusinessError(404,'NOT_FOUND','记录不存在或无权查看');
export const conflict=(message:string)=>new BusinessError(409,'VERSION_CONFLICT',message);
