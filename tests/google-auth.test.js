const {test,before,after,mock}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('crypto'),path=require('path');
process.env.NODE_ENV='test';
process.env.GOOGLE_CLIENT_ID='';process.env.GOOGLE_CLIENT_SECRET='';
process.env.MONGOMS_DOWNLOAD_DIR=path.resolve(__dirname,'../../work/mongodb-binaries');
const {MongoMemoryServer}=require('mongodb-memory-server'),mongoose=require('mongoose'),request=require('supertest'),bcrypt=require('bcryptjs');
const {OAuth2Client}=require('google-auth-library');
const {createApp}=require('../app'),User=require('../models/user'),Attempt=require('../models/oauth-attempt'),Event=require('../models/audit-event');
const google=require('../lib/google-auth');
let mongo,server,disabledServer,passwordHash;
const codes=new Map();
const fakeProvider={
 authorizationUrl:({state,nonce,challenge})=>'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({state,nonce,code_challenge:challenge}),
 async identity(code,verifier,nonce){const v=codes.get(code);assert.ok(v,'Test code must exist');assert.equal(nonce,v.nonce);assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'),v.challenge);return v.identity;},
};
async function post(agent,url,data={}){const r=await agent.get('/login');const csrf=r.text.match(/name="_csrf" value="([^"]+)"/)[1];return agent.post(url).type('form').send({_csrf:csrf,...data});}
async function begin(agent,identity,body={},route='/auth/google'){
 const r=await post(agent,route,body);assert.equal(r.status,302,r.text);
 const url=new URL(r.headers.location),state=url.searchParams.get('state'),code=crypto.randomBytes(16).toString('hex');
 codes.set(code,{identity,nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge')});
 return {state,code,callback:'/auth/google/callback?'+new URLSearchParams({state,code})};
}
async function local(email,role='user',extra={}){return User.create({name:'Isolated Google test',email,role,passwordHash,...extra});}
async function login(agent,user){const r=await post(agent,'/login',{email:user.email,password:'isolated-password-only'});assert.equal(r.status,302,r.text);}
function identity(id){return {subject:id,email:id+'@google-test.invalid',name:'Google test'};}
before(async()=>{
 mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri('nestly_google_test'));
 await Promise.all([User.init(),Attempt.init()]);passwordHash=await bcrypt.hash('isolated-password-only',12);
 server=createApp({memorySession:true,googleProvider:fakeProvider}).listen(0,'127.0.0.1');
 disabledServer=createApp({memorySession:true}).listen(0,'127.0.0.1');
 await Promise.all([server,disabledServer].map(s=>new Promise(resolve=>s.listening?resolve():s.once('listening',resolve))));
});
after(async()=>{mock.restoreAll();for(const s of [server,disabledServer])if(s)await new Promise(resolve=>s.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();});
test('Google configuration and disabled buttons fail safely without provider credentials',async()=>{
 assert.equal(google.configuration({}),null);assert.equal(google.configuration({GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',APP_ORIGIN:'https://bad.invalid/path'}),null);
 assert.equal(google.configuration({GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',APP_ORIGIN:'http://example.invalid',NODE_ENV:'production'}),null);
 assert.throws(()=>require('../lib/config').validateEnvironment({GOOGLE_CLIENT_ID:'only-one'}),/both/);
 const agent=request.agent(disabledServer),r=await agent.get('/login');assert.match(r.text,/formaction="\/auth\/google" formnovalidate disabled/);
 assert.equal((await post(agent,'/auth/google')).status,503);
 assert.equal((await request(server).post('/auth/google')).status,403);
 assert.match((await request(server).get('/signup?role=owner')).text,/value="owner" selected/);
 const previous=process.env.NODE_ENV;try{process.env.NODE_ENV='development';assert.throws(()=>createApp({memorySession:true,googleProvider:fakeProvider}),/only available in tests/);}finally{process.env.NODE_ENV=previous;}
});
test('new student Google login creates verified account, rotates session and enforces roles',async()=>{
 const agent=request.agent(server),flow=await begin(agent,identity('student'));
 const r=await agent.get(flow.callback);assert.equal(r.status,302,r.text);assert.equal(r.headers.location,'/');assert.ok(r.headers['set-cookie']);
 const user=await User.findOne({googleSubject:'student'});assert.equal(user.role,'user');assert.ok(user.emailVerifiedAt);assert.equal(user.passwordHash,undefined);
 assert.equal((await agent.get('/owner')).status,403);assert.equal((await agent.get('/admin')).status,403);
 const page=await agent.get('/account/security');assert.equal(page.status,200);assert.match(page.text,/Google connected/);assert.match(page.headers['cache-control'],/no-store/);
 assert.equal((await agent.get(flow.callback)).status,400);
 assert.ok(await Event.exists({action:'google.login',entityId:user._id}));
 const other=request.agent(server);assert.equal((await post(other,'/login',{email:user.email,password:'any-password-at-all'})).status,400);
});
test('owner signup is explicit and existing student roles cannot be promoted through Google',async()=>{
 const owner=request.agent(server);let flow=await begin(owner,identity('owner'),{flow:'signup',role:'owner'});assert.equal((await owner.get(flow.callback)).headers.location,'/owner');assert.equal((await owner.get('/owner')).status,200);
 const attacker=request.agent(server);flow=await begin(attacker,identity('tampered'),{flow:'signup',role:'admin'});await attacker.get(flow.callback);assert.equal((await User.findOne({googleSubject:'tampered'})).role,'user');
 const existing=request.agent(server);flow=await begin(existing,identity('student'),{flow:'signup',role:'owner'});assert.equal((await existing.get(flow.callback)).headers.location,'/');assert.equal((await User.findOne({googleSubject:'student'})).role,'user');
});
test('OAuth state rejects missing, wrong-browser, expired and replayed callbacks; cancellation is handled',async()=>{
 const agent=request.agent(server);assert.equal((await agent.get('/auth/google/callback?code=ignored')).status,400);
 let flow=await begin(agent,identity('bound'));assert.equal((await request(server).get(flow.callback)).status,400);
 assert.equal((await agent.get(flow.callback)).status,302);
 const expiry=request.agent(server);flow=await begin(expiry,identity('expired'));
 await Attempt.updateOne({_id:crypto.createHash('sha256').update(flow.state).digest('hex')},{$set:{expiresAt:new Date(0)}});
 assert.equal((await expiry.get(flow.callback)).status,400);assert.equal(await User.exists({googleSubject:'expired'}),null);
 const cancelled=request.agent(server);flow=await begin(cancelled,identity('cancelled'));
 const r=await cancelled.get('/auth/google/callback?'+new URLSearchParams({state:flow.state,error:'access_denied'}));assert.equal(r.headers.location,'/login?googleCancelled=1');assert.match((await cancelled.get(r.headers.location)).text,/was cancelled/);assert.equal((await cancelled.get(flow.callback)).status,400);
});
test('email matching never auto-links local accounts, explicit password-confirmed linking preserves account',async()=>{
 const id=identity('link'),favorite=new mongoose.Types.ObjectId(),user=await local(id.email,'owner',{favorites:[favorite]});
 const guest=request.agent(server);let flow=await begin(guest,id);assert.equal((await guest.get(flow.callback)).status,409);assert.equal((await User.findById(user._id)).googleSubject,undefined);
 const agent=request.agent(server);await login(agent,user);
 assert.equal((await post(agent,'/account/google/connect',{password:'wrong'})).status,403);
 flow=await begin(agent,identity('different'),{password:'isolated-password-only'},'/account/google/connect');assert.equal((await agent.get(flow.callback)).status,403);
 flow=await begin(agent,id,{password:'isolated-password-only'},'/account/google/connect');const r=await agent.get(flow.callback);assert.equal(r.headers.location,'/account/security');
 const linked=await User.findById(user._id);assert.equal(linked.googleSubject,id.subject);assert.equal(linked.role,'owner');assert.equal(linked.passwordHash,passwordHash);assert.equal(String(linked.favorites[0]),String(favorite));assert.ok(linked.emailVerifiedAt);assert.ok(await Event.exists({action:'google.connected',entityId:user._id}));
 assert.equal((await agent.get(flow.callback)).status,400);
 const fresh=request.agent(server);flow=await begin(fresh,id);assert.equal((await fresh.get(flow.callback)).headers.location,'/owner');
});
test('changed session version cancels account linking',async()=>{
 const id=identity('rotated'),user=await local(id.email),agent=request.agent(server);await login(agent,user);
 const flow=await begin(agent,id,{password:'isolated-password-only'},'/account/google/connect');await User.updateOne({_id:user._id},{$inc:{sessionVersion:1}});
 assert.equal((await agent.get(flow.callback)).status,403);assert.equal((await User.findById(user._id)).googleSubject,undefined);
});
test('suspended accounts and changed Google email are rejected',async()=>{
 for(const kind of ['suspended','changed']){
  const id=identity(kind);await local(id.email,'user',{googleSubject:id.subject,suspended:kind==='suspended'});
  const agent=request.agent(server),flow=await begin(agent,{...id,email:kind==='changed'?'changed-email@google-test.invalid':id.email});
  assert.equal((await agent.get(flow.callback)).status,403);assert.equal((await agent.get('/account/security')).status,302);
 }
});
test('Google administrator login requires MFA before authenticating',async()=>{
 const id=identity('administrator');await local(id.email,'admin',{googleSubject:id.subject,emailVerifiedAt:new Date(),mfa:{enabled:true}});
 const agent=request.agent(server),flow=await begin(agent,id),r=await agent.get(flow.callback);
 assert.equal(r.headers.location,'/mfa');assert.equal((await agent.get('/mfa')).status,200);assert.equal((await agent.get('/admin')).status,302);assert.equal((await agent.get('/account/security')).status,302);
});
test('official Google verifier accepts signed token and rejects signature, audience, expiry, nonce and unverified email',async()=>{
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const now=Math.floor(Date.now()/1000),base={iss:'https://accounts.google.com',aud:'test-client',azp:'test-client',sub:'signed-subject',email:'signed@google-test.invalid',email_verified:true,nonce:'expected-nonce',iat:now-10,exp:now+600};
 let claims={...base},corrupt=false;
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 mock.method(OAuth2Client.prototype,'getToken',async()=>{const data=encode({alg:'RS256',kid:'test-key'})+'.'+encode(claims);let signature=crypto.sign('RSA-SHA256',Buffer.from(data),privateKey);if(corrupt)signature[0]^=255;return {tokens:{id_token:data+'.'+signature.toString('base64url')}};});
 mock.method(OAuth2Client.prototype,'getFederatedSignonCertsAsync',async()=>({certs:{'test-key':publicKey.export({type:'spki',format:'pem'})},format:'PEM'}));
 try{
  const provider=google.provider({clientId:'test-client',clientSecret:'isolated-secret',redirectUri:'http://127.0.0.1:8080/auth/google/callback'});
  const authUrl=new URL(provider.authorizationUrl({state:'s',nonce:'n',challenge:'c'}));assert.equal(authUrl.hostname,'accounts.google.com');assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');assert.equal(authUrl.searchParams.get('scope'),'openid email profile');
  assert.equal((await provider.identity('code','verifier','expected-nonce')).subject,'signed-subject');
  for(const override of [{aud:'attacker'},{azp:'attacker'},{iss:'https://attacker.invalid'},{email_verified:false},{nonce:'wrong'},{iat:now-1000,exp:now-400}]){claims={...base,...override};await assert.rejects(provider.identity('code','verifier','expected-nonce'),/could not be verified/);}
  claims={...base};corrupt=true;await assert.rejects(provider.identity('code','verifier','expected-nonce'),/could not be verified/);
 }finally{mock.restoreAll();}
});
