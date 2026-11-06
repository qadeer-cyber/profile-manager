const base=require('./package.json').build;
module.exports={...base,appId:'local.azwahmultibrowser.licenseadmin',productName:'Azwah License Admin',
 directories:{...base.directories,output:'release-license-admin'},npmRebuild:false,beforePack:undefined,
 extraMetadata:{main:'admin-desktop/main.mjs',name:'azwah-license-admin'},
 files:['admin-desktop/**','scripts/license-admin/**','server/office/license.js','package.json','!node_modules/**'],
 extraResources:[
  {from:'release-office-payload/win-unpacked',to:'office-payload'},
  {from:'build/admin-nsis',to:'nsis'},
  {from:'admin-desktop/office.nsi',to:'office.nsi'}
 ],
 win:{...base.win,target:[{target:'nsis',arch:['x64']}]},
 nsis:{...base.nsis,shortcutName:'Azwah License Admin',artifactName:'Azwah-License-Admin-Setup-x64.exe'}
};
