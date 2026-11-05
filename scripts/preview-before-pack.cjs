module.exports = async context => {
 const fs=require('node:fs'),path=require('node:path');
 const config=context.packager.config;
 if(config.appId!=='local.profilemanager.preview'||config.extraMetadata?.azwahEdition!=='restricted-preview')throw Error('Restricted preview packaging identity required');
 if(fs.existsSync(path.join(__dirname,'../server/office/issuer-public.pem')))throw Error('Preview build must not contain an Office verification root');
 for(const e of fs.readdirSync(path.join(__dirname,'../server/office'),{withFileTypes:true}))if(!e.isFile()||!e.name.endsWith('.js'))throw Error('Unexpected key/vault material in preview source');
};
