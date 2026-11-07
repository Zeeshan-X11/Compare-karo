// Explicitly restricted to a new *_restore_test database and a new disk directory.
const fs=require('fs/promises'),path=require('path'),os=require('os'),{spawn}=require('child_process'),mongoose=require('mongoose');
const {verifyBackup}=require('./verify-backup');
function validateTarget(uri,root){
  let url;try{url=new URL(uri);}catch{throw Error('Set RESTORE_TARGET_URI to an isolated MongoDB URI.');}
  const database=url.pathname.slice(1);
  if(!/^[-a-zA-Z0-9]+_restore_test$/.test(database))throw Error('The restore database must end with _restore_test.');
  if(!root||!path.isAbsolute(root))throw Error('RESTORE_ROOT must be a new absolute directory.');
  return database;
}
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:['ignore','ignore','ignore']});child.on('error',()=>reject(Error('Restore dependency unavailable: '+command)));child.on('exit',code=>code===0?resolve():reject(Error('Restore command failed: '+command)));});}
async function restore(){
  if(process.argv[2]!=='--confirm-isolated-restore')throw Error('Use --confirm-isolated-restore after verifying the target. No data was changed.');
  const uri=process.env.RESTORE_TARGET_URI,root=process.env.RESTORE_ROOT,database=validateTarget(uri,root),backup=path.resolve(process.env.BACKUP_DIRECTORY||'');
  await verifyBackup(backup);
  try{await fs.access(root);throw Error('RESTORE_ROOT already exists. Use a new empty path.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mongoose.connect(uri,{autoIndex:false,serverSelectionTimeoutMS:10000,maxPoolSize:2});
  if((await mongoose.connection.db.listCollections().toArray()).length)throw Error('Restore target is not empty. Refusing to overwrite it.');
  await fs.mkdir(root,{mode:0o700});
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'nestly-restore-'));
  try{
    const config=path.join(temporary,'mongodb.yml');await fs.writeFile(config,'uri: '+JSON.stringify(uri)+'\n',{mode:0o600});
    // Source database is fixed by the documented backup contract. No --drop and no original database target.
    await run('mongorestore',['--config',config,'--archive='+path.join(backup,'database.archive.gz'),'--gzip','--nsInclude=nestly.*','--nsFrom=nestly.*','--nsTo='+database+'.*','--stopOnError']);
    for(const name of ['photos','documents']){
      const destination=path.join(root,name);await fs.mkdir(destination,{mode:0o700});
      // Only restore trusted, checksum-verified operator-created tar archives.
      await run('tar',['-xzf',path.join(backup,name+'.tar.gz'),'-C',destination,'--no-same-owner']);
    }
    console.log('Isolated restore completed. Verify counts, hashes, logins, image access and private document access before declaring the backup restorable.');
  }finally{await fs.unlink(path.join(temporary,'mongodb.yml')).catch(()=>{});await fs.rmdir(temporary).catch(()=>{});}
}
if(require.main===module)restore().catch(error=>{console.error('Restore stopped: '+error.message.replace(/mongodb[^\s]+/g,'[redacted URI]'));process.exitCode=1;}).finally(()=>mongoose.disconnect());
module.exports={validateTarget};
