const base=require('./electron-builder.offline.cjs');
const firefox=require('./scripts/firefox-extra-resources.cjs');
module.exports={...base,appId:'local.azwahmultibrowser.office',productName:'Azwah Multi Browser Office',
 directories:{...base.directories,output:'release-office-payload'},
 extraMetadata:{name:'azwah-multi-browser-office',azwahEdition:'provisioned-office'},
 extraResources:[...base.extraResources, ...firefox],
 files:[...base.files,'!server/office/issuer-public.pem','!server/ultimate-admin.js','!scripts/license-admin/**','!admin-desktop/**','!node_modules/**/{test,tests,__tests__}/**'],
 beforePack:async()=>{if(require('node:fs').existsSync('server/office/issuer-public.pem'))throw Error('Provisioning payload must be unbound');}
};
