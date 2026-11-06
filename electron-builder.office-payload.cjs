const base=require('./electron-builder.offline.cjs');
module.exports={...base,appId:'local.azwahmultibrowser.office',productName:'Azwah Multi Browser Office',
 directories:{...base.directories,output:'release-office-payload'},
 extraMetadata:{azwahEdition:'provisioned-office'},
 files:[...base.files,'!server/office/issuer-public.pem','!node_modules/**/{test,tests,__tests__}/**'],
 beforePack:async()=>{if(require('node:fs').existsSync('server/office/issuer-public.pem'))throw Error('Provisioning payload must be unbound');}
};
