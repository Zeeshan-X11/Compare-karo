const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('path'),fs=require('fs/promises'),crypto=require('crypto');
process.env.NODE_ENV='test';
process.env.SESSION_SECRET='ISOLATED-TEST-SESSION-SECRET-NOT-FOR-PRODUCTION';
process.env.MONGOMS_DOWNLOAD_DIR=path.resolve(__dirname,'../../work/mongodb-binaries');
process.env.UPLOAD_DIR=path.resolve(__dirname,'../../work/production-test/photos');
process.env.AUTHORIZATION_DIR=path.resolve(__dirname,'../../work/production-test/documents');
process.env.RESEND_API_KEY='';process.env.EMAIL_FROM='';process.env.CLAMD_HOST='';
process.env.APP_ORIGIN='http://127.0.0.1:8080';
process.env.MFA_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64'); // Isolated test key only.
const mongoose=require('mongoose'),request=require('supertest'),sharp=require('sharp'),OTPAuth=require('otpauth');
const {MongoMemoryServer}=require('mongodb-memory-server'),{createApp}=require('../app');
const Listing=require('../models/listing'),User=require('../models/user'),Inquiry=require('../models/inquiry'),Audit=require('../models/audit-event'),Token=require('../models/account-token');
const publication=require('../lib/publication'),market=require('../lib/marketplace'),{consume,uploadGuard}=require('../lib/limits');
let mongo,server,app,owner,admin,student,id,ownerId,studentId,adminId,png;
const messages=[];
const password='isolated-test-password-123';
async function csrf(agent,url='/account'){const r=await agent.get(url);const m=r.text.match(/name="_csrf" value="([^"]+)"/);if(m)return m[1];return (await agent.get('/login')).text.match(/name="_csrf" value="([^"]+)"/)[1];}
async function post(agent,url,data={}){const token=await csrf(agent);return agent.post(url).type('form').send({_csrf:token,...data});}
const details={name:'TEST ONLY — Production regression',description:'This is an isolated automated test property, never real inventory. The complete description verifies safe owner submission, approval workflow, room availability and student contact functionality.',locality:'Rajanukunte',address:'TEST ONLY address, not an actual home',propertyCategory:'Men',sharingOptions:'Double',rentDouble:'12000',roomsTotalDouble:'4',roomsAvailableDouble:'2',monthlyRent:'12000',securityDeposit:'20000',oneTimeFee:'0',contactName:'Test Owner',contactPhone:'9876501234',ownerAuthorized:'yes',contactPublic:'yes',whatsappAllowed:'yes',coordinateLatitude:'13.1',coordinateLongitude:'77.5',locationPublic:'yes',availabilityStatus:'available'};
async function submitNew(agent=owner, fields=details){let req=agent.post('/owner').set('x-csrf-token',await csrf(agent));for(const [key,value]of Object.entries(fields))req=req.field(key,value);const result=await req.field('photoRights','yes').field('authorizationDeclaration','yes').field('authorizationType','Trade licence').attach('buildingPhoto',png,{filename:'TEST-ONLY.png',contentType:'image/png'}).attach('authorizationFiles',png,{filename:'TEST-ONLY-document.png',contentType:'image/png'});assert.equal(result.status,302,result.text.slice(0,300));return (await Listing.findOne({ownerId}).sort({createdAt:-1}))._id;}
async function approve(property=id){const r=await post(admin,'/admin/'+property,{action:'approve',reviewed:'yes',authorizationReviewed:'yes',locationReviewed:'yes'});assert.equal(r.status,302,r.text.slice(0,300));}
before(async()=>{
  mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri('nestly_production_regressions'));
  await Promise.all([require('../models/rate-bucket').init(),Token.init(),User.init()]);
  app=createApp({memorySession:true,documentScanner:async()=>({status:'clean',engine:'TEST-PROTOCOL-ONLY',scannedAt:new Date()}),emailTransport:async message=>{messages.push(message);return {id:crypto.randomUUID()};}});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  owner=request.agent(server);admin=request.agent(server);student=request.agent(server);
  for(const [agent,name,role]of [[owner,'owner','owner'],[admin,'admin','user'],[student,'student','user']])assert.equal((await post(agent,'/signup',{name,email:name+'@isolated.test',password,role})).status,302,name);
  await User.updateOne({email:'admin@isolated.test'},{$set:{role:'admin',emailVerifiedAt:new Date()}});
  ownerId=(await User.findOne({email:'owner@isolated.test'}))._id;studentId=(await User.findOne({email:'student@isolated.test'}))._id;adminId=(await User.findOne({email:'admin@isolated.test'}))._id;
  png=await sharp({create:{width:160,height:120,channels:3,background:'#dccfc2'}}).png().toBuffer();
  id=await submitNew();await approve();
},{timeout:120000});
after(async()=>{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(mongo)await mongo.stop();});
test('new publication requires complete review and keeps private evidence out of snapshots',async()=>{
  const l=await Listing.findById(id);assert.equal(l.publicSnapshot.publicationPolicyVersion,2);assert.equal(l.authorizationDocuments[0].scanStatus,'clean');
  assert.equal((await request(server).get('/listings/'+id)).status,200);assert.ok(!('authorizationDocuments' in l.publicSnapshot));assert.ok(!('approvedAuthorizationDocuments' in l.publicSnapshot));
});
test('owners can paste a Google Maps link and only the reviewed, consented link becomes public', async () => {
  const googleMapUrl = 'https://maps.app.goo.gl/IsolatedTestOnly';
  const fields = { ...details, name: 'TEST ONLY — Maps link', coordinateLatitude: '', coordinateLongitude: '', googleMapUrl };
  const badLink = await post(owner, '/owner', { ...fields, googleMapUrl: 'https://maps.app.goo.gl.example.invalid/Pin' });
  assert.equal(badLink.status, 400);
  const property = await submitNew(owner, fields);
  const review = await admin.get('/admin/' + property);
  assert.match(review.text, /Check submitted location in Google Maps/);
  assert.ok(review.text.includes(googleMapUrl));
  assert.equal((await request(server).get('/listings/' + property)).status, 404);
  assert.equal(market.maps(await Listing.findById(property)).exact, false);
  await approve(property);
  const publicPage = await request(server).get('/listings/' + property);
  assert.ok(publicPage.text.includes(googleMapUrl));
  assert.equal((await post(owner, '/owner/' + property, { ...fields, googleMapUrl: '', intent: 'draft' })).status, 302);
  const cleared = await request(server).get('/listings/' + property);
  assert.equal(cleared.status, 200);
  assert.ok(!cleared.text.includes(googleMapUrl));
});
test('significant edits stay private and consent withdrawals immediately restrict the old version',async()=>{
  const r=await post(owner,'/owner/'+id,{...details,name:'TEST ONLY — PENDING SECRET NAME',intent:'draft'});assert.equal(r.status,302);
  assert.equal((await publication.getPublic(id)).name,details.name);
  assert.equal((await request(server).get('/listings/'+id+'/contact/whatsapp')).status,302);
  assert.equal((await post(owner,'/owner/'+id+'/consent',{confirm:'withdraw'})).status,302);
  const l=await publication.getPublic(id);assert.equal(l.contactPublic,false);assert.equal(l.whatsappAllowed,false);assert.equal(l.coordinates.publicationAuthorized,false);assert.equal(market.maps(l).exact,false);
  assert.equal((await request(server).get('/listings/'+id+'/contact/call')).status,403);
  // Re-granting permission remains subject to approving the new version.
  await post(owner,'/owner/'+id,{...details,intent:'draft'});assert.equal((await publication.getPublic(id)).contactPublic,false);
});
test('student inquiry history never exposes a pending property name',async()=>{
  assert.equal((await post(student,'/listings/'+id+'/inquiries',{message:'Please confirm the actual room availability.'})).status,302);
  const raw=await Listing.findById(id);raw.name='UNAPPROVED NAME MUST STAY PRIVATE';await raw.save();
  const page=await student.get('/inquiries');assert.match(page.text,/TEST ONLY — Production regression/);assert.doesNotMatch(page.text,/UNAPPROVED NAME MUST STAY PRIVATE/);
  // Legacy inquiries with no stored title resolve only the approved snapshot title.
  await Inquiry.updateMany({userId:studentId},{$unset:{propertyName:1}});
  assert.doesNotMatch((await student.get('/inquiries')).text,/UNAPPROVED NAME MUST STAY PRIVATE/);
});
test('invalid calendar dates and times are rejected, scheduled visits can be edited without re-entering the date',async()=>{
  assert.throws(()=>market.dateInput('2027-02-30','Visit',{future:true}));assert.throws(()=>market.scheduledVisit('2027-02-30T12:30'));
  const year=new Date().getUTCFullYear()+1;
  assert.equal((await post(student,'/listings/'+id+'/inquiries',{message:'Please confirm the room and visit date.',preferredVisitDate:year+'-02-30'})).status,400);
  const inquiry=await Inquiry.findOne({userId:studentId}),scheduled=new Date(Date.now()+86400000),value=market.localVisit(scheduled);
  assert.equal((await post(owner,'/inquiries/'+inquiry._id+'/status',{status:'visit_scheduled',scheduledVisitAt:value})).status,302);
  const existing=(await Inquiry.findById(inquiry._id)).scheduledVisitAt;
  assert.equal((await post(owner,'/inquiries/'+inquiry._id+'/status',{status:'visit_scheduled',reply:'Please bring your questions to the scheduled visit.'})).status,302);
  assert.equal((await Inquiry.findById(inquiry._id)).scheduledVisitAt.getTime(),existing.getTime());
  assert.match((await owner.get('/owner?tab=inquiries')).text,new RegExp('value="'+value+'"'));
});
test('endpoint-specific student limits allow different students on the same IP',async()=>{
  for(let i=0;i<18;i++)assert.equal((await post(student,'/listings/'+id+'/inquiries',{message:'Isolated test inquiry '+i+' for available room.'})).status,302);
  assert.equal((await post(student,'/listings/'+id+'/inquiries',{message:'The account allowance must now be exhausted.'})).status,429);
  const second=request.agent(server);await post(second,'/signup',{name:'second',email:'second@isolated.test',password,role:'user'});
  assert.equal((await post(second,'/listings/'+id+'/inquiries',{message:'Another student on the same college Wi-Fi.'})).status,302);
  assert.equal((await post(student,'/listings/'+id+'/report',{message:'This is an independent report action for testing.'})).status,200);
});
test('rate bucket increments are atomic and survive limiter recreation',async()=>{
  const outcomes=await Promise.all(Array.from({length:15},()=>consume('atomic-test','same-account',5,3600000)));
  assert.equal(outcomes.filter(Boolean).length,5);assert.equal(await consume('atomic-test','same-account',5,3600000),false);assert.equal(await consume('atomic-test','oversize',1,3600000,2),false);
});
test('edit uploads enforce a total-body cap before multer and a per-account concurrency guard',async()=>{
  const r=await owner.post('/owner/'+id).set('x-csrf-token',await csrf(owner)).set('Content-Type','multipart/form-data; boundary=test').set('Content-Length',String(25*1024*1024)).send('');assert.equal(r.status,413);
  // Exercise the same guard installed before multer, with two overlapping requests.
  const {EventEmitter}=require('events'),gate=uploadGuard({globalLimit:2,accountLimit:1});
  function req(){const r=new EventEmitter();Object.assign(r,{user:{_id:ownerId},is:()=>true,get:()=>100});return r;}
  const first=new EventEmitter();first.set=()=>{};await gate(req(),first,e=>assert.equal(e,undefined));
  const second=new EventEmitter();second.set=()=>{};let code;await gate(req(),second,e=>{code=e.status;});assert.equal(code,503);first.emit('finish');
  const third=new EventEmitter();third.set=()=>{};await gate(req(),third,e=>assert.equal(e,undefined));third.emit('finish');
});
test('hidden favorites remain removable; stale comparisons no longer consume capacity',async()=>{
  const hidden=await Listing.create({ownerId,name:'PRIVATE TEST RECORD',listingStatus:'draft'});
  await User.updateOne({_id:studentId},{$set:{favorites:[hidden._id]}});
  assert.match((await student.get('/favorites')).text,/Remove unavailable PG/);
  assert.equal((await post(student,'/favorites/'+hidden._id,{action:'remove'})).status,302);
  assert.equal((await User.findById(studentId)).favorites.length,0);
  await post(student,'/compare/'+id,{action:'add'});await Listing.updateOne({_id:id},{$set:{publicHidden:true}});
  const page=await student.get('/compare');assert.equal(page.status,200);assert.doesNotMatch(page.text,/Production regression/);
  await Listing.updateOne({_id:id},{$set:{publicHidden:false}});
  assert.equal((await post(student,'/compare/'+id,{action:'add'})).status,302);
});
test('availability-only update changes approved availability without publishing pending fields',async()=>{
  const before=await publication.getPublic(id);
  assert.equal((await post(owner,'/owner/'+id+'/availability',{availabilityStatus:'unavailable',availableDouble:'0',rentDouble:'1',name:'BYPASS ATTEMPT'})).status,302);
  const after=await publication.getPublic(id);assert.equal(after.name,before.name);assert.equal(after.monthlyRent,before.monthlyRent);assert.equal(after.roomOptions[0].availableRooms,0);assert.equal(after.availabilityStatus,'unavailable');
  assert.equal((await post(owner,'/owner/'+id+'/availability',{availabilityStatus:'available',availableDouble:'5'})).status,400);
});
test('student reports survive moderation and expose only the reporting student’s status',async()=>{
  const raw=await Listing.findById(id),report=raw.reports.find(r=>String(r.userId)===String(studentId));
  assert.equal((await post(admin,'/admin/'+id+'/reports/'+report._id,{status:'resolved',resolution:'Reviewed this isolated test report and recorded the outcome.'})).status,302);
  const page=await student.get('/reports');assert.match(page.text,/resolved/);assert.match(page.text,/Reviewed this isolated test report/);assert.doesNotMatch(page.text,/contactPhone|sha256|reviewedBy/);
  assert.match((await request.agent(server).get('/reports')).headers.location,/login/);
});
test('owner withdrawal immediately hides a published snapshot and cannot be undone by availability updates',async()=>{
  assert.equal((await post(owner,'/owner/'+id+'/withdraw',{reason:'This isolated test listing must be hidden now.'})).status,302);
  assert.equal(await publication.getPublic(id),null);assert.equal((await post(owner,'/owner/'+id+'/availability',{availabilityStatus:'available',availableDouble:'1'})).status,400);
  assert.ok((await Listing.findById(id)).withdrawalRequest.requestedAt);
  assert.match((await admin.get('/admin')).text,new RegExp('/admin/'+id));
  assert.equal((await post(admin,'/admin/'+id,{action:'unpublish',notes:'Owner withdrawal request reviewed in this isolated test.'})).status,302);
  assert.ok((await Listing.findById(id)).withdrawalRequest.reviewedAt);
});
test('legacy review is read-only and unversioned published data is not served',async()=>{
  const l=await Listing.create({ownerId,name:'LEGACY INVALID TEST',listingStatus:'published'}),before=await Listing.findById(l._id).lean();
  assert.equal(await publication.getPublic(l._id),null);
  const report=await require('../scripts/review-legacy').reviewLegacy();assert.ok(report.findings.find(f=>f.id===String(l._id)).issues.length>0);
  assert.deepEqual(await Listing.findById(l._id).lean(),before);
});
test('private pages have no-store and unexpected errors do not expose database messages',async()=>{
  for(const route of ['/account','/owner','/admin','/inquiries','/favorites','/compare','/reports','/account/security']){
    const r=await (route.startsWith('/admin')?admin:route==='/owner'?owner:student).get(route);assert.match(r.headers['cache-control'],/no-store/,route);
  }
  const original=User.findById;User.findById=()=>({select:()=>Promise.reject(Error('SECRET database URI and internal stack must not be exposed'))});
  try{const r=await student.get('/account');assert.equal(r.status,500);assert.doesNotMatch(r.text,/SECRET database|internal stack/);}finally{User.findById=original;}
});
test('quarantined documents cannot be downloaded or approved, and can be rescanned explicitly',async()=>{
  const qid=await submitNew(),l=await Listing.findById(qid);l.authorizationDocuments[0].scanStatus='quarantined';await l.save();const doc=l.authorizationDocuments[0];
  const review=await admin.get('/admin/'+qid);
  assert.equal(review.status,200);assert.match(review.text,/Approval needs attention/);
  assert.match(review.text,/value="approve" disabled/);
  assert.doesNotMatch(review.text,new RegExp('(?:src|href)="/listings/'+qid+'/authorization/'+doc._id+'"'));
  assert.equal((await admin.get('/listings/'+qid+'/authorization/'+doc._id)).status,423);
  const blocked=await post(admin,'/admin/'+qid,{action:'approve',reviewed:'yes',authorizationReviewed:'yes',notes:'Keep this admin review note'});
  assert.equal(blocked.status,400);assert.match(blocked.text,/The action could not be completed/);assert.match(blocked.text,/Keep this admin review note/);
  assert.equal((await Listing.findById(qid)).images[0].status,'pending');
  assert.equal((await post(admin,'/admin/'+qid+'/authorization/'+doc._id+'/scan')).status,302);
  assert.equal((await Listing.findById(qid)).authorizationDocuments[0].scanStatus,'clean');
  const ready=await admin.get('/admin/'+qid);assert.match(ready.text,/Ready for admin review/);assert.doesNotMatch(ready.text,/value="approve" disabled/);
  const missingConfirmation=await post(admin,'/admin/'+qid,{action:'approve',notes:'Need explicit human document review'});
  assert.equal(missingConfirmation.status,400);assert.match(missingConfirmation.text,/Confirm property data/);
  assert.equal((await Listing.findById(qid)).listingStatus,'submitted');
  await approve(qid);
  assert.equal((await admin.get('/listings/'+qid+'/authorization/'+doc._id)).status,200);
  assert.match((await admin.get('/admin/'+qid)).text,/This PG is visible to students/);
  assert.equal((await request(server).get('/listings/'+qid)).status,200);
});

test('unconfigured rescan reports the real blocker on the review page and never claims success',async()=>{
  const qid=await submitNew(),l=await Listing.findById(qid);l.authorizationDocuments[0].scanStatus='quarantined';l.authorizationDocuments[0].scanEngine='not-configured';await l.save();
  const noScannerServer=createApp({memorySession:true}).listen(0,'127.0.0.1');
  await new Promise(resolve=>noScannerServer.once('listening',resolve));
  try{
    const reviewer=request.agent(noScannerServer);
    assert.equal((await post(reviewer,'/login',{email:'admin@isolated.test',password})).status,302);
    const page=await reviewer.get('/admin/'+qid);
    assert.match(page.text,/Document scanning is not configured on this server/);
    assert.match(page.text,/owner does not need to upload them again/);
    const scanned=await post(reviewer,'/admin/'+qid+'/authorization/'+l.authorizationDocuments[0]._id+'/scan');
    assert.equal(scanned.status,503);assert.match(scanned.text,/The document remains quarantined/);assert.match(scanned.text,/PG operation authorization — private review/);
    assert.match(scanned.headers['cache-control'],/no-store/);
    const saved=await Listing.findById(qid);
    assert.equal(saved.listingStatus,'submitted');assert.equal(saved.authorizationDocuments[0].scanStatus,'quarantined');assert.equal(saved.authorizationDocuments[0].status,'pending');
    assert.equal(await publication.getPublic(qid),null);
  }finally{await new Promise(resolve=>noScannerServer.close(resolve));}
});
test('checking pending owner details does not certify the previous approved version; orphaned owners are hidden',async()=>{
  const pid=await submitNew();await approve(pid);
  const before=await publication.getPublic(pid);
  assert.equal((await post(owner,'/owner/'+pid,{...details,name:'PENDING VERIFICATION TEST ONLY',intent:'draft'})).status,302);
  assert.equal((await post(admin,'/admin/'+pid+'/verification',{method:'documents',performedAt:new Date().toISOString().slice(0,10),notes:'Scope applies to the pending version in this isolated test.'})).status,302);
  assert.equal((await publication.getPublic(pid)).verification?.method,before.verification?.method);
  const l=await Listing.findById(pid),originalOwner=l.ownerId;l.ownerId=new mongoose.Types.ObjectId();await l.save();assert.equal(await publication.getPublic(pid),null);assert.equal((await request(server).get('/media/'+l.publicSnapshot.images[0].filename)).status,404);
  l.ownerId=originalOwner;await l.save();
});
test('active PDF content is rejected; unconfigured scanners quarantine, never certify',async()=>{
  const {PDFDocument,PDFName,PDFString}=require('pdf-lib'),pdf=await PDFDocument.create();pdf.addPage();pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.obj({S:'JavaScript',JS:PDFString.of('app.alert(1)')}));
  await assert.rejects(()=>require('../lib/authorization').prepareAuthorization([{mimetype:'application/pdf',buffer:Buffer.from([])}],{authorizationDeclaration:'yes',authorizationType:'Trade licence'},ownerId,process.env.AUTHORIZATION_DIR),/valid PDF/);
  const bytes=Buffer.from(await pdf.save());
  await assert.rejects(()=>require('../lib/authorization').prepareAuthorization([{mimetype:'application/pdf',buffer:bytes}],{authorizationDeclaration:'yes',authorizationType:'Trade licence'},ownerId,process.env.AUTHORIZATION_DIR),/Active PDF/);
  assert.equal((await require('../lib/scanner').scanDocument(png)).status,'quarantined');
});
test('verified email delivery tokens are hashed, expire and can be consumed only once',async()=>{
  assert.equal((await post(student,'/account/verify/send')).status,200);
  const message=messages.at(-1),token=message.text.match(/#token=([a-f0-9]{64})/)[1];
  const stored=await Token.findOne({userId:studentId,purpose:'verify'}).lean();assert.notEqual(stored._id,token);assert.equal(stored._id,require('../lib/mfa').hash(token));
  assert.equal((await post(student,'/account/verify',{token})).status,200);assert.ok((await User.findById(studentId)).emailVerifiedAt);assert.equal((await post(student,'/account/verify',{token})).status,400);
});
test('password recovery uses verified email, invalidates prior sessions and never exposes tokens',async()=>{
  const recovery=request.agent(server);assert.equal((await post(recovery,'/forgot-password',{email:'student@isolated.test'})).status,200);
  const token=messages.at(-1).text.match(/#token=([a-f0-9]{64})/)[1],newPassword=' new-isolated-password-456 ';
  const page=await recovery.get('/reset-password');assert.doesNotMatch(page.text,new RegExp(token));
  assert.equal((await post(recovery,'/reset-password',{token,password:newPassword})).status,302);
  assert.equal((await post(recovery,'/reset-password',{token,password:newPassword})).status,400);
  assert.equal((await student.get('/account')).status,302);
  assert.equal((await post(recovery,'/login',{email:'student@isolated.test',password:newPassword})).status,302);
  assert.equal((await recovery.get('/account')).status,200);
  const count=messages.length;await post(owner,'/forgot-password',{email:'owner@isolated.test'});assert.equal(messages.length,count,'unverified addresses cannot recover accounts');
});
test('unconfigured or failed email providers do not claim emails were sent',async()=>{
  const noProvider=createApp({memorySession:true});const agent=request.agent(noProvider);
  assert.equal((await post(agent,'/forgot-password',{email:'student@isolated.test'})).status,503);
  const failed=createApp({memorySession:true,emailTransport:async()=>{throw require('../lib/errors').problem(503,'Provider unavailable.');}}),failedAgent=request.agent(failed);
  const r=await post(failedAgent,'/forgot-password',{email:'student@isolated.test'});assert.equal(r.status,503);assert.doesNotMatch(r.text,/email was sent|emails were sent/);
  assert.equal(await Token.countDocuments({userId:studentId,purpose:'reset'}),0);
});
test('expired verification links fail and signed provider webhooks cannot verify account ownership',async()=>{
  const expired=crypto.randomBytes(32).toString('hex');
  await Token.create({_id:require('../lib/mfa').hash(expired),userId:ownerId,purpose:'verify',expiresAt:new Date(Date.now()-60000)});
  assert.equal((await post(owner,'/account/verify',{token:expired})).status,400);assert.equal((await User.findById(ownerId)).emailVerifiedAt,undefined);
  const {Webhook}=require('svix'),Delivery=require('../models/email-delivery'),secret='whsec_'+Buffer.alloc(32,8).toString('base64');
  const old=process.env.EMAIL_WEBHOOK_SECRET;process.env.EMAIL_WEBHOOK_SECRET=secret;
  try{
    const delivery=await Delivery.findOne({userId:studentId}),eventId='msg_isolated_test',date=new Date(),payload=JSON.stringify({type:'email.delivered',created_at:date.toISOString(),data:{email_id:delivery._id}}),signature=new Webhook(secret).sign(eventId,date,payload);
    assert.equal((await request(server).post('/webhooks/email').type('json').set('svix-id',eventId).set('svix-timestamp',String(Math.floor(date.getTime()/1000))).set('svix-signature','v1,invalid').send(payload)).status,400);
    assert.equal((await request(server).post('/webhooks/email').type('json').set('svix-id',eventId).set('svix-timestamp',String(Math.floor(date.getTime()/1000))).set('svix-signature',signature).send(payload)).status,204);
    assert.equal((await Delivery.findById(delivery._id)).status,'delivered');assert.equal((await User.findById(ownerId)).emailVerifiedAt,undefined);
    const older=JSON.stringify({type:'email.sent',created_at:new Date(date.getTime()-1000).toISOString(),data:{email_id:delivery._id}}),olderSignature=new Webhook(secret).sign(eventId,date,older);
    assert.equal((await request(server).post('/webhooks/email').type('json').set('svix-id',eventId).set('svix-timestamp',String(Math.floor(date.getTime()/1000))).set('svix-signature',olderSignature).send(older)).status,204);
    assert.equal((await Delivery.findById(delivery._id)).status,'delivered','old or duplicate events cannot downgrade delivery');
    const earlyId=crypto.randomUUID(),early=JSON.stringify({type:'email.delivered',created_at:date.toISOString(),data:{email_id:earlyId}}),earlySignature=new Webhook(secret).sign(eventId,date,early);
    assert.equal((await request(server).post('/webhooks/email').type('json').set('svix-id',eventId).set('svix-timestamp',String(Math.floor(date.getTime()/1000))).set('svix-signature',earlySignature).send(early)).status,204);
    assert.equal((await Delivery.findById(earlyId)).status,'delivered','an early webhook is retained before sender bookkeeping');
  }finally{process.env.EMAIL_WEBHOOK_SECRET=old||'';}
});
test('administrator TOTP enrollment, login challenge, replay prevention and one-time recovery work',async()=>{
  let r=await post(admin,'/account/mfa/setup',{password});assert.equal(r.status,200);
  const secret=r.text.match(/<code>([A-Z2-7]+)<\/code>/)[1],totp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret),digits:6,period:30,algorithm:'SHA1'});
  r=await post(admin,'/account/mfa/confirm',{code:totp.generate()});assert.equal(r.status,200);assert.match(r.headers['cache-control'],/no-store/);
  const recoveryCode=r.text.match(/<code>([a-f0-9]{32})<\/code>/)[1],raw=await User.findById(adminId).select('+mfa.secret +mfa.recoveryHashes');assert.notEqual(raw.mfa.secret,secret);assert.ok(!raw.mfa.recoveryHashes.includes(recoveryCode));
  const enrolledCsrf=r.text.match(/name="_csrf" value="([^"]+)"/)[1];assert.equal((await admin.post('/logout').type('form').send({_csrf:enrolledCsrf})).status,302,'enrollment response carries the regenerated session CSRF token');
  const login=request.agent(server);r=await post(login,'/login',{email:'admin@isolated.test',password});assert.equal(r.headers.location,'/mfa');assert.equal((await login.get('/admin')).headers.location,'/login');
  assert.equal((await post(login,'/mfa',{code:totp.generate()})).status,403,'enrollment token cannot be replayed');
  assert.equal((await post(login,'/mfa',{code:recoveryCode})).status,302);assert.equal((await login.get('/admin')).status,200);
  const again=request.agent(server);await post(again,'/login',{email:'admin@isolated.test',password});assert.equal((await post(again,'/mfa',{code:recoveryCode})).status,403);
});
test('audit events record edits, decisions, document access and report outcomes without tokens',async()=>{
  for(const action of ['property.create','property.edit','listing.approve','document.access','report.resolve','consent.withdraw','listing.withdraw','availability.update','password.reset','mfa.enabled'])assert.ok(await Audit.exists({action}),action);
  await assert.rejects(()=>Audit.deleteMany({}),/append-only/);
  const events=await Audit.find().lean();assert.doesNotMatch(JSON.stringify(events),/passwordHash|recoveryHashes|encrypted|Bearer |#token=/);
});
test('production configuration rejects serverless local storage, weak secrets and unsafe roots',()=>{
  const {validateEnvironment}=require('../lib/config');assert.throws(()=>validateEnvironment({NODE_ENV:'production'}),/Missing production/);
  const env={NODE_ENV:'production',MONGO_URL:'mongodb+srv://example.invalid/nestly',SESSION_SECRET:'a'.repeat(48),APP_ORIGIN:'https://example.invalid',MFA_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64'),RESEND_API_KEY:'test-only',EMAIL_FROM:'test@example.invalid',EMAIL_WEBHOOK_SECRET:'test-only',UPLOAD_DIR:path.resolve('work/photos'),AUTHORIZATION_DIR:path.resolve('work/private'),CLAMD_HOST:'scanner',STORAGE_DURABLE:'true'};
  assert.doesNotThrow(()=>validateEnvironment(env));assert.throws(()=>validateEnvironment({...env,VERCEL:'1'}),/Vercel/);assert.throws(()=>validateEnvironment({...env,AUTHORIZATION_DIR:env.UPLOAD_DIR}),/separate/);assert.throws(()=>validateEnvironment({...env,SESSION_SECRET:'short'}),/32/);
});
test('health endpoints are session-free and private storage prevents path traversal',async()=>{
  const live=await request(server).get('/health/live'),ready=await request(server).get('/health/ready');assert.equal(live.status,200);assert.equal(ready.status,200);assert.equal(live.headers['set-cookie'],undefined);
  const storage=require('../lib/storage').createStorage();assert.throws(()=>storage.path('document','../../.env'),/Invalid storage/);
  const l=await Listing.findOne({'images.thumbnail':{$exists:true}});assert.ok(l.images[0].thumbnail);assert.ok((await fs.stat(storage.path('photo',l.images[0].thumbnail))).size>0);
});
test('production enforces verified owners, administrator MFA gates and secure session cookies',async()=>{
  const names=['NODE_ENV','MONGO_URL','APP_ORIGIN','RESEND_API_KEY','EMAIL_FROM','EMAIL_WEBHOOK_SECRET','CLAMD_HOST','STORAGE_DURABLE'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  let production;
  try{
    Object.assign(process.env,{NODE_ENV:'production',MONGO_URL:'mongodb+srv://example.invalid/nestly',APP_ORIGIN:'https://example.invalid',RESEND_API_KEY:'TEST-ONLY-NOT-A-PROVIDER-KEY',EMAIL_FROM:'test@example.invalid',EMAIL_WEBHOOK_SECRET:'whsec_'+Buffer.alloc(32,9).toString('base64'),CLAMD_HOST:'test-scanner.invalid',STORAGE_DURABLE:'true'});
    production=createApp({memorySession:true,emailTransport:async()=>({id:crypto.randomUUID()})});
  }finally{for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
  const plainAdmin=await User.create({name:'PRODUCTION GATE TEST ONLY',email:'prod-admin@isolated.test',role:'admin',emailVerifiedAt:new Date(),passwordHash:await require('bcryptjs').hash(password,12)});
  async function login(email){
    let r=await request(production).get('/login').set('X-Forwarded-Proto','https'),cookie=r.headers['set-cookie'][0].split(';')[0],token=r.text.match(/name="_csrf" value="([^"]+)"/)[1];
    assert.match(r.headers['set-cookie'][0],/HttpOnly/);assert.match(r.headers['set-cookie'][0],/Secure/);assert.match(r.headers['set-cookie'][0],/SameSite=Lax/);
    r=await request(production).post('/login').set('X-Forwarded-Proto','https').set('Cookie',cookie).type('form').send({_csrf:token,email,password});assert.equal(r.status,302);return r.headers['set-cookie'][0].split(';')[0];
  }
  const adminCookie=await login(plainAdmin.email);assert.equal((await request(production).get('/admin').set('X-Forwarded-Proto','https').set('Cookie',adminCookie)).headers.location,'/account/security');
  const listing=await Listing.findOne({'authorizationDocuments.0':{$exists:true}});assert.equal((await request(production).get('/listings/'+listing._id+'/authorization/'+listing.authorizationDocuments[0]._id).set('X-Forwarded-Proto','https').set('Cookie',adminCookie)).headers.location,'/account/security');
  const hidden=await Listing.findOne({publicHidden:true,'images.0':{$exists:true}});assert.equal((await request(production).get('/media/'+hidden.images[0].filename).set('X-Forwarded-Proto','https').set('Cookie',adminCookie)).status,404,'password-only admin sessions have no private-photo exemption');
  const ownerCookie=await login('owner@isolated.test');assert.equal((await request(production).get('/owner').set('X-Forwarded-Proto','https').set('Cookie',ownerCookie)).headers.location,'/account/security');
});
