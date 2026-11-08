const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
process.env.NODE_ENV='test';
test('unsupported Node versions fail before application startup',()=>{const {validateRuntime}=require('../lib/config');assert.throws(()=>validateRuntime('22.12.0'),/22.23.4/);assert.throws(()=>validateRuntime('20.19.0'),/22.23.4/);assert.doesNotThrow(()=>validateRuntime('22.23.4'));assert.doesNotThrow(()=>validateRuntime('22.24.0'));});
test('backup verification detects corruption and restore guards refuse non-isolated targets',async()=>{
  const root=path.resolve(__dirname,'../../work/backup-unit-'+crypto.randomUUID());await fs.mkdir(root,{recursive:true});
  const files=[];for(const name of ['database.archive.gz','photos.tar.gz','documents.tar.gz']){const bytes=Buffer.from('ISOLATED TEST ARCHIVE '+name);await fs.writeFile(path.join(root,name),bytes);files.push({name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({version:1,files}));
  const {verifyBackup}=require('../scripts/verify-backup');assert.equal(await verifyBackup(root),true);
  await fs.appendFile(path.join(root,'photos.tar.gz'),'corrupted');await assert.rejects(()=>verifyBackup(root),/checksum failed/);
  const {validateTarget}=require('../scripts/restore-backup');assert.throws(()=>validateTarget('mongodb://127.0.0.1/nestly',root),/_restore_test/);assert.throws(()=>validateTarget('mongodb://127.0.0.1/new_restore_test','relative'),/absolute/);assert.equal(validateTarget('mongodb://127.0.0.1/new_restore_test',root),'new_restore_test');
});
test('production configuration never accepts insecure MongoDB transport',()=>{
  const env={NODE_ENV:'production',MONGO_URL:'mongodb+srv://example.invalid/nestly?tlsInsecure=true',SESSION_SECRET:'x'.repeat(48),APP_ORIGIN:'https://example.invalid',MFA_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),RESEND_API_KEY:'test-only',EMAIL_FROM:'test@example.invalid',EMAIL_WEBHOOK_SECRET:'test-only',UPLOAD_DIR:path.resolve('work/photos'),AUTHORIZATION_DIR:path.resolve('work/documents'),STORAGE_DURABLE:'true'};
  assert.throws(()=>require('../lib/config').validateEnvironment(env),/transport security/);
});
test('production demo starts with core settings and requires durable storage for uploads',()=>{
  const {validateEnvironment,durableUploads}=require('../lib/config');
  const env={NODE_ENV:'production',MONGO_URL:'mongodb+srv://example.invalid/nestly',SESSION_SECRET:'x'.repeat(48)};
  assert.doesNotThrow(()=>validateEnvironment(env));
  assert.equal(durableUploads(env),false);
  assert.equal(durableUploads({...env,STORAGE_DURABLE:'true',UPLOAD_DIR:'photos'}),false);
  assert.equal(durableUploads({...env,STORAGE_DURABLE:'true',UPLOAD_DIR:'photos',AUTHORIZATION_DIR:'documents'}),true);
  assert.throws(()=>validateEnvironment({...env,MFA_ENCRYPTION_KEY:'invalid'}),/32 random bytes/);
  assert.throws(()=>validateEnvironment({...env,APP_ORIGIN:'http://example.invalid'}),/HTTPS origin/);
});
