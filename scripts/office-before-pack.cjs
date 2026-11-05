// electron-builder hook also covers direct builder invocations.
module.exports = async () => {
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  const file=path.join(__dirname,'..','server','office','issuer-public.pem');
  if(!fs.existsSync(file))throw Error('Office packaging requires a provisioned Ed25519 issuer-public.pem; no employee installer has been qualified yet.');
  for(const entry of fs.readdirSync(path.dirname(file),{withFileTypes:true})) {
    if(!entry.isFile()||(!entry.name.endsWith('.js')&&entry.name!=='issuer-public.pem'))throw Error('Unexpected key or vault material in employee office modules');
  }
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('Invalid office verification root');
  const value=fs.readFileSync(file,'utf8').trim();
  if(!value.startsWith('-----BEGIN PUBLIC KEY-----')||!value.endsWith('-----END PUBLIC KEY-----')||value.includes('PRIVATE KEY')||crypto.createPublicKey(value).asymmetricKeyType!=='ed25519')throw Error('Only an Ed25519 public verification key may enter the employee package');
};
