const fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
async function fileHash(file){const hash=crypto.createHash('sha256');for await(const chunk of require('fs').createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function verifyBackup(root){
  const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length!==3)throw Error('Invalid backup manifest.');
  const required=['database.archive.gz','photos.tar.gz','documents.tar.gz'];
  for(const name of required){
    const record=manifest.files.find(f=>f.name===name);if(!record||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('Missing backup checksum.');
    if(await fileHash(path.join(root,name))!==record.sha256)throw Error('Backup checksum failed for '+name);
  }
  return true;
}
if(require.main===module)verifyBackup(path.resolve(process.argv[2]||'')).then(()=>console.log('All backup checksums verified. This does not establish restorability; perform the isolated restore drill.')).catch(()=>{console.error('Backup verification failed. Do not restore this bundle.');process.exitCode=1;});
module.exports={verifyBackup,fileHash};
