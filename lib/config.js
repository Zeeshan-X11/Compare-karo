const path=require('path');
function validateRuntime(version=process.versions.node){const [major,minor,patch]=version.split('.').map(Number);if(major!==22||minor<23||(minor===23&&patch<4))throw Error('PG Dekho requires Node 22.23.4 or a newer supported 22.x security patch. Use .nvmrc or the Docker image.');}
function durableUploads(env=process.env){
  return Boolean(env.STORAGE_DURABLE==='true'&&env.UPLOAD_DIR&&env.AUTHORIZATION_DIR);
}
function validateEnvironment(env=process.env){
  if(env.NODE_ENV!=='production')return;
  const required=['MONGO_URL','SESSION_SECRET'];
  const missing=required.filter(name=>!env[name]);
  if(missing.length)throw Error('Missing production environment variables: '+missing.join(', '));
  if(env.VERCEL)throw Error('This durable filesystem deployment is not supported in Vercel Functions. Use the documented Linux Docker host.');
  if(env.SESSION_SECRET.length<32)throw Error('SESSION_SECRET must contain at least 32 random characters.');
  if(env.MFA_ENCRYPTION_KEY&&Buffer.from(env.MFA_ENCRYPTION_KEY,'base64').length!==32)throw Error('MFA_ENCRYPTION_KEY must be 32 random bytes encoded as base64.');
  if(env.APP_ORIGIN){
    const origin=new URL(env.APP_ORIGIN);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('APP_ORIGIN must be an HTTPS origin without a path or credentials.');
  }
  if(!/^mongodb(\+srv)?:\/\//.test(env.MONGO_URL))throw Error('MONGO_URL must be a MongoDB connection URI.');
  const mongoOptions=Object.fromEntries([...new URLSearchParams(env.MONGO_URL.split('?')[1]||'')].map(([k,v])=>[k.toLowerCase(),v.toLowerCase()]));
  if(mongoOptions.tls==='false'||mongoOptions.ssl==='false'||mongoOptions.tlsinsecure==='true'||mongoOptions.tlsallowinvalidcertificates==='true'||mongoOptions.tlsallowinvalidhostnames==='true')throw Error('Production MongoDB must not disable transport security.');
  if(!env.MONGO_URL.startsWith('mongodb+srv://')&&mongoOptions.tls!=='true'&&mongoOptions.ssl!=='true')throw Error('Production MongoDB requires TLS; use the Atlas SRV connection string.');
  const roots=[env.UPLOAD_DIR,env.AUTHORIZATION_DIR].filter(Boolean).map(root=>path.resolve(root)),publicRoot=path.resolve(__dirname,'../public');
  for(const root of roots)if(root===publicRoot||root.startsWith(publicRoot+path.sep))throw Error('Uploads must be outside the static public directory.');
  if(roots.length===2&&(roots[0]===roots[1]||roots[0].startsWith(roots[1]+path.sep)||roots[1].startsWith(roots[0]+path.sep)))throw Error('Use distinct, separate public-photo and private-document volume roots.');
}
module.exports={validateEnvironment,validateRuntime,durableUploads};
