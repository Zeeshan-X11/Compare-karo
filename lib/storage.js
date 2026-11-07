const fs=require('fs/promises'),path=require('path');
const {problem}=require('./errors');
function createStorage({publicRoot,privateRoot}={}){
  const roots={photo:path.resolve(publicRoot||process.env.UPLOAD_DIR||path.join(__dirname,'../uploads')),document:path.resolve(privateRoot||process.env.AUTHORIZATION_DIR||path.join(publicRoot||process.env.UPLOAD_DIR||path.join(__dirname,'../uploads'),'private-authorization'))};
  function location(kind,key){if(!roots[kind]||!/^([a-f0-9]{48})(\.thumb)?\.(webp|pdf)$/.test(key))throw problem(400,'Invalid storage identifier.');return path.join(roots[kind],key);}
  return {roots,path:location,async put(kind,key,bytes){await fs.mkdir(roots[kind],{recursive:true,mode:0o700});await fs.writeFile(location(kind,key),bytes,{flag:'wx',mode:0o600});},async remove(kind,key){await fs.unlink(location(kind,key)).catch(error=>{if(error.code!=='ENOENT')throw error;});},async read(kind,key){return fs.readFile(location(kind,key));},async check(){for(const root of Object.values(roots)){await fs.mkdir(root,{recursive:true,mode:0o700});await fs.access(root,fs.constants.R_OK|fs.constants.W_OK);}return true;}};
}
module.exports={createStorage};
