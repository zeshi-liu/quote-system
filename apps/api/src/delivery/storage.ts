import {mkdir,writeFile,readFile,unlink,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import COS from 'cos-nodejs-sdk-v5';
export interface StoredObject {key:string;modifiedAt:Date;}
export interface ObjectStorage {
 put(key:string,data:Buffer,contentType:string):Promise<void>;
 read(key:string):Promise<Buffer>;
 remove(key:string):Promise<void>;
 signedDownload(key:string,filename:string):Promise<string|null>;
 listBefore?(cutoff:Date):Promise<StoredObject[]>;
}
const checkKey=(key:string)=>{if(!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,299}$/.test(key)||key.split('/').some(x=>x==='..'||x==='.'||!x))throw new Error('无效的文件对象标识');};
export class LocalObjectStorage implements ObjectStorage {
 private root:string;
 constructor(directory:string){if(process.env.NODE_ENV==='production')throw new Error('生产环境禁止本地文件存储');this.root=resolve(directory);}
 private path(key:string){checkKey(key);return resolve(this.root,key);}
 async put(key:string,data:Buffer){const path=this.path(key);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,data,{mode:0o600,flag:'wx'});}
 read(key:string){return readFile(this.path(key));}
 async remove(key:string){try{await unlink(this.path(key));}catch(e:any){if(e.code!=='ENOENT')throw e;}}
 async signedDownload(_key:string,_filename:string){return null;}
 async listBefore(cutoff:Date){const result:StoredObject[]=[];const visit=async(path:string)=>{let entries;try{entries=await readdir(path,{withFileTypes:true});}catch(e:any){if(e.code==='ENOENT')return;throw e;}for(const e of entries){const p=resolve(path,e.name);if(e.isDirectory())await visit(p);else if(e.isFile()){const s=await stat(p);if(s.mtime<cutoff)result.push({key:relative(this.root,p).split(sep).join('/'),modifiedAt:s.mtime});}}};await visit(this.root);return result;}
}
class CosObjectStorage implements ObjectStorage {
 private client:COS;private bucket:string;private region:string;
 constructor(){const {COS_SECRET_ID,COS_SECRET_KEY,COS_BUCKET,COS_REGION}=process.env;if(!COS_SECRET_ID||!COS_SECRET_KEY||!COS_BUCKET||!COS_REGION)throw new Error('COS 配置不完整');this.client=new COS({SecretId:COS_SECRET_ID,SecretKey:COS_SECRET_KEY,Protocol:'https:',Timeout:60000});this.bucket=COS_BUCKET;this.region=COS_REGION;}
 private args(key:string){checkKey(key);return {Bucket:this.bucket,Region:this.region,Key:key};}
 async put(key:string,data:Buffer,contentType:string){await this.client.putObject({...this.args(key),Body:data,ContentType:contentType,ACL:'private'});}
 async read(key:string){const r=await this.client.getObject(this.args(key));return Buffer.isBuffer(r.Body)?r.Body:Buffer.from(r.Body as string);}
 async remove(key:string){await this.client.deleteObject(this.args(key));}
 async signedDownload(key:string,filename:string){return this.client.getObjectUrl({...this.args(key),Sign:true,Expires:300,Query:{'response-content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`}});}
 async listBefore(cutoff:Date){const result:StoredObject[]=[];let marker='';do{const page=await this.client.getBucket({Bucket:this.bucket,Region:this.region,Prefix:'exports/',Marker:marker,MaxKeys:1000});for(const item of page.Contents||[]){const modifiedAt=new Date(item.LastModified);if(modifiedAt<cutoff)result.push({key:item.Key,modifiedAt});}marker=page.IsTruncated==='true'?page.NextMarker||'':'';}while(marker);return result;}
}
export function createStorage():ObjectStorage {
 if(process.env.FILE_STORAGE_DRIVER==='cos')return new CosObjectStorage();
 if(process.env.FILE_STORAGE_DRIVER==='local'&&process.env.FILE_STORAGE_LOCAL_DIR)return new LocalObjectStorage(process.env.FILE_STORAGE_LOCAL_DIR);
 const disabled=async():Promise<never>=>{throw new Error('请显式配置 FILE_STORAGE_DRIVER 及私有文件存储参数');};
 return {put:disabled,read:disabled,remove:disabled,signedDownload:disabled};
}
