const base=require('./electron-builder.offline.cjs');
module.exports={...base,appId:'local.profilemanager.preview',productName:'Azwah Multi Browser Preview',
 extraMetadata:{name:'profile-manager-preview',azwahEdition:'restricted-preview'},
 directories:{...base.directories,output:'release-preview'},beforePack:'scripts/preview-before-pack.cjs',
 files:[...base.files,'!server/office/issuer-public.pem'],
 nsis:{...base.nsis,shortcutName:'Azwah Multi Browser Preview',artifactName:'Azwah-Multi-Browser-Preview-Setup-x64.exe'}};
