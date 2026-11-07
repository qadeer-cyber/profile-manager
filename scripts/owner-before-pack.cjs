module.exports=async context=>{
 const fs=require('node:fs'),path=require('node:path'),c=context.packager.config;
 if(c.appId!=='local.azwahmultibrowser.owner'||c.extraMetadata?.name!=='azwah-multi-browser-owner'||c.extraMetadata?.azwahEdition!=='owner-personal'||c.extraMetadata?.azwahLicensePolicy!=='personal-no-activation')throw Error('Explicit Owner/Personal distribution policy required');
 if(fs.existsSync(path.join(__dirname,'../server/office/issuer-public.pem')))throw Error('Owner build must not include an Office issuer identity');
 for(const e of fs.readdirSync(path.join(__dirname,'../server/office'),{withFileTypes:true}))if(!e.isFile()||!e.name.endsWith('.js'))throw Error('Unexpected key/vault material in employee modules');
};
