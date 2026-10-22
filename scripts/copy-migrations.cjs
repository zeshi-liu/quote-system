const {cpSync}=require('node:fs');
const {resolve}=require('node:path');
cpSync(resolve(__dirname,'../apps/api/migrations'),resolve(__dirname,'../apps/api/dist/apps/api/migrations'),{recursive:true});
