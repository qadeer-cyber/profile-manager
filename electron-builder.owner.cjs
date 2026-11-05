const base=require('./electron-builder.offline.cjs');
module.exports={...base,appId:'local.azwahmultibrowser.owner',productName:'Azwah Multi Browser Owner',
 extraMetadata:{name:'azwah-multi-browser-owner',azwahEdition:'owner-personal',azwahLicensePolicy:'personal-no-activation'},
 directories:{...base.directories,output:'release-owner'},beforePack:'scripts/owner-before-pack.cjs',
 files:[...base.files,'!server/office/issuer-public.pem','!node_modules/**/{test,tests,__tests__}/**'],
 nsis:{...base.nsis,shortcutName:'Azwah Multi Browser Owner',artifactName:'Azwah-Multi-Browser-Full-Setup-x64.exe'}};
