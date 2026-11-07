const path=require('path'),fs=require('fs/promises'),crypto=require('crypto'),assert=require('assert/strict'),{spawn}=require('child_process');
process.env.NODE_ENV='test';process.env.MONGOMS_DOWNLOAD_DIR=path.resolve(__dirname,'../../work/mongodb-binaries');process.env.RESEND_API_KEY='';process.env.CLAMD_HOST='';
const mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server'),sharp=require('sharp'),bcrypt=require('bcryptjs'),request=require('supertest');
const {fileHash,verifyBackup}=require('./verify-backup');
function run(command,args,env=process.env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',()=>reject(Error('Required tool unavailable: '+command)));child.on('exit',code=>resolve({code,output}));});}
(async()=>{
 let mongo,server;
 const root=path.resolve(__dirname,'../work/restore-drill-'+crypto.randomUUID()),bundle=path.join(root,'bundle'),restoreRoot=path.join(root,'restored');
 const checks=[];
 try{
  for(const command of ['mongodump','mongorestore','tar']){const r=await run(command,['--version']);if(r.code!==0)throw Error('Required tool unavailable: '+command);}
  await fs.mkdir(bundle,{recursive:true,mode:0o700});mongo=await MongoMemoryServer.create();const source=mongo.getUri('nestly'),target=mongo.getUri('nestly_restore_test');
  process.env.MONGO_URL=source;process.env.UPLOAD_DIR=path.join(root,'source/photos');process.env.AUTHORIZATION_DIR=path.join(root,'source/documents');await mongoose.connect(source);
  const User=require('../models/user'),Listing=require('../models/listing'),owner=await User.create({name:'DISPOSABLE RESTORE TEST',email:'restore-test@example.invalid',role:'owner',passwordHash:await bcrypt.hash('isolated-restore-password-only',12)});
  const image=await sharp({create:{width:100,height:100,channels:3,background:'#aec'}}).png().toBuffer();
  const photos=await require('../lib/photos').preparePhotos([{file:{buffer:image},type:'Exterior'}],owner._id,process.env.UPLOAD_DIR),documents=await require('../lib/authorization').prepareAuthorization([{buffer:image,mimetype:'image/png'}],{authorizationType:'Trade licence',authorizationDeclaration:'yes'},owner._id,process.env.AUTHORIZATION_DIR,async()=>({status:'clean',engine:'RESTORE-TEST-ONLY',scannedAt:new Date()}));
  const listing=new Listing({ownerId:owner._id,name:'DISPOSABLE RESTORE TEST PROPERTY',description:'This is a disposable restoration test property. It is never real inventory and exists only to check that backup archives restore database records, public images and private documents safely in a fresh isolated target.',locality:'Yelahanka',address:'TEST ONLY — not a real property address',propertyCategory:'Men',monthlyRent:12000,sharingOptions:['Double'],roomOptions:[{sharing:'Double',monthlyRent:12000}],contactName:'Test owner',contactPhone:'+919876501234',ownerAuthorized:true,images:photos.map(p=>({...p,status:'approved'})),authorizationDocuments:documents.map(d=>({...d,status:'accepted',reviewedBy:owner._id,reviewedAt:new Date()}))});require('../lib/publication').publish(listing);await listing.save();
  const config=path.join(root,'source.yml');await fs.writeFile(config,'uri: '+JSON.stringify(source)+'\n',{mode:0o600});
  let result=await run('mongodump',['--config',config,'--db','nestly','--archive='+path.join(bundle,'database.archive.gz'),'--gzip','--quiet']);if(result.code)throw Error('mongodump failed: '+result.output.slice(0,300));checks.push('isolated MongoDB archive created');
  for(const kind of ['photos','documents']){result=await run('tar',['-czf',path.join(bundle,kind+'.tar.gz'),'-C',path.join(root,'source',kind),'.']);if(result.code)throw Error('tar archive failed');}
  const files=await Promise.all(['database.archive.gz','photos.tar.gz','documents.tar.gz'].map(async name=>({name,sha256:await fileHash(path.join(bundle,name))})));
  await fs.writeFile(path.join(bundle,'manifest.json'),JSON.stringify({version:1,files}));assert.equal(await verifyBackup(bundle),true);checks.push('all archive checksums verified');
  result=await run(process.execPath,[path.join(__dirname,'restore-backup.js'),'--confirm-isolated-restore'],{...process.env,RESTORE_TARGET_URI:target,RESTORE_ROOT:restoreRoot,BACKUP_DIRECTORY:bundle});if(result.code)throw Error('Isolated restore failed: '+result.output.slice(0,500));checks.push('fresh database and disk restore completed');
  assert.equal(await User.countDocuments(),1);assert.equal(await Listing.countDocuments(),1);checks.push('source database unchanged');
  await mongoose.disconnect();process.env.MONGO_URL=target;process.env.UPLOAD_DIR=path.join(restoreRoot,'photos');process.env.AUTHORIZATION_DIR=path.join(restoreRoot,'documents');await mongoose.connect(target);
  assert.equal(await User.countDocuments(),1);assert.equal(await Listing.countDocuments(),1);checks.push('restored collection counts match');
  for(const [kind,key]of [['photos',photos[0].filename],['documents',documents[0].filename]])assert.equal(await fileHash(path.join(root,'source',kind,key)),await fileHash(path.join(restoreRoot,kind,key)));checks.push('restored photo and private document bytes match');
  const {createApp}=require('../app');server=createApp({memorySession:true}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  assert.equal((await request(server).get('/listings/'+listing._id)).status,200);assert.equal((await request(server).get('/media/'+photos[0].filename)).status,200);
  const privateUrl='/listings/'+listing._id+'/authorization/'+listing.authorizationDocuments[0]._id;assert.equal((await request(server).get(privateUrl)).status,302);
  const agent=request.agent(server),login=await agent.get('/login'),csrf=login.text.match(/name="_csrf" value="([^"]+)"/)[1];assert.equal((await agent.post('/login').type('form').send({_csrf:csrf,email:owner.email,password:'isolated-restore-password-only'})).status,302);assert.equal((await agent.get(privateUrl)).status,200);checks.push('restored login, public image and private-document permissions verified');
  result=await run(process.execPath,[path.join(__dirname,'restore-backup.js'),'--confirm-isolated-restore'],{...process.env,RESTORE_TARGET_URI:target,RESTORE_ROOT:restoreRoot,BACKUP_DIRECTORY:bundle});assert.notEqual(result.code,0);checks.push('repeat restore refuses overwriting existing target');
  const report={isolated:true,passed:true,checks,limitations:['Actual Linux Docker volume backup and encrypted off-site restic transport still require host verification.','No production or preview database was connected.']};
  await fs.mkdir(path.resolve(__dirname,'../work'),{recursive:true});await fs.writeFile(path.resolve(__dirname,'../work/restore-test-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){console.error('Isolated restore drill stopped:',error.message);process.exitCode=1;}finally{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(mongo)await mongo.stop();}
})();
