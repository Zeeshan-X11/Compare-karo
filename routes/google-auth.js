const crypto = require('crypto'), bcrypt = require('bcryptjs');
const User = require('../models/user'), Attempt = require('../models/oauth-attempt');
const {problem} = require('../lib/errors'), {audit} = require('../lib/audit'), {limiter} = require('../lib/limits');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function registerGoogle({app,auth,wrap,provider}) {
  const limit = limiter('google-auth',{account:20,ip:240,windowMs:900000,key:req=>req.sessionID});
  const available = (_req,_res,next) => provider ? next() : next(problem(503,'Google sign-in is not configured yet. Use email and password for now.'));
  const save = req => new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
  async function start(req,res,linkUser) {
    const state=crypto.randomBytes(32).toString('hex'),nonce=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
    await Attempt.create({_id:hash(state),sessionHash:hash(req.sessionID),nonce,verifier,
      role:req.body.flow==='signup'&&req.body.role==='owner'?'owner':'user',
      linkUserId:linkUser?._id,sessionVersion:linkUser?.sessionVersion||0,expiresAt:new Date(Date.now()+600000)});
    await save(req);
    res.redirect(provider.authorizationUrl({state,nonce,challenge:crypto.createHash('sha256').update(verifier).digest('base64url')}));
  }
  app.post('/auth/google',limit,available,wrap(async(req,res)=>{
    if(req.user)return res.redirect('/account/security');
    await start(req,res);
  }));
  app.post('/account/google/connect',auth,limit,available,wrap(async(req,res)=>{
    const user=await User.findById(req.user._id);
    if(user.googleSubject)throw problem(400,'Google is already connected.');
    const password=typeof req.body.password==='string'?req.body.password:'';
    if(!password||Buffer.byteLength(password)>72||!user.passwordHash||!await bcrypt.compare(password,user.passwordHash))throw problem(403,'Confirm your current Nestly password to connect Google.');
    if(user.role==='admin'&&user.mfa.enabled&&!req.session.mfaVerified)throw problem(403,'Complete administrator MFA before connecting Google.');
    await start(req,res,user);
  }));
  app.get('/auth/google/callback',limit,available,wrap(async(req,res)=>{
    if(typeof req.query.state!=='string'||!/^[a-f0-9]{64}$/.test(req.query.state))throw problem(400,'Google sign-in expired or was not started in this browser. Please start again.');
    const attempt=await Attempt.findOneAndDelete({_id:hash(req.query.state),sessionHash:hash(req.sessionID),expiresAt:{$gt:new Date()}});
    if(!attempt)throw problem(400,'Google sign-in expired or was already used. Please start again.');
    if(req.query.error)return res.redirect('/login?googleCancelled=1');
    if(typeof req.query.code!=='string'||!req.query.code||req.query.code.length>4096)throw problem(400,'Google did not return a valid sign-in response.');
    const identity=await provider.identity(req.query.code,attempt.verifier,attempt.nonce);
    let user=await User.findOne({googleSubject:identity.subject});
    if(attempt.linkUserId){
      if(!req.user||String(req.user._id)!==String(attempt.linkUserId)||(req.user.sessionVersion||0)!==attempt.sessionVersion)throw problem(403,'Sign in again before connecting Google.');
      const target=await User.findById(attempt.linkUserId);
      if(!target||target.suspended||target.email!==identity.email||(target.sessionVersion||0)!==attempt.sessionVersion)throw problem(403,'Use the Google account with the same email as your Nestly account.');
      if(user||target.googleSubject)throw problem(409,'This Google account is already connected.');
      const linked=await User.updateOne({_id:target._id,googleSubject:{$exists:false},sessionVersion:target.sessionVersion||0},{$set:{googleSubject:identity.subject,emailVerifiedAt:new Date()}});
      if(!linked.modifiedCount)throw problem(409,'Account changed. Please start again.');
      await audit(req,'google.connected','User',target._id);
      return res.redirect('/account/security');
    }
    if(req.user)throw problem(409,'You are already signed in. Use Account security to connect Google.');
    if(!user){
      if(await User.exists({email:identity.email}))throw problem(409,'An account already uses this email. Log in with your Nestly password, then connect Google in Account security.');
      try { user=await User.create({name:identity.name,email:identity.email,googleSubject:identity.subject,emailVerifiedAt:new Date(),role:attempt.role}); }
      catch(error){if(error.code===11000)throw problem(409,'This account changed while signing in. Start again, or use your existing Nestly account.');throw error;}
    }
    if(user.suspended)throw problem(403,'This account is suspended.');
    if(user.email!==identity.email)throw problem(403,'Your Google email no longer matches this Nestly account. Contact the administrator.');
    await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
    if(user.mfa?.enabled){req.session.pendingMfaUserId=String(user._id);req.session.pendingMfaExpiresAt=Date.now()+300000;await save(req);return res.redirect('/mfa');}
    req.session.userId=String(user._id);req.session.sessionVersion=user.sessionVersion||0;
    await audit({...req,user},'google.login','User',user._id);await save(req);
    res.redirect(user.role==='admin'?'/admin':user.role==='owner'?'/owner':'/');
  }));
}
module.exports={registerGoogle};
