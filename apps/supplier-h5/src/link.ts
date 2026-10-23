export function takeLinkToken(hash:string,replace:()=>void):string|null{if(!hash)return null;replace();return new URLSearchParams(hash.replace(/^#/, '')).get('token');}
