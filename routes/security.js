const crypto=require('crypto'),bcrypt=require('bcryptjs'),express=require('express');
const {Webhook}=require('svix');
const User=require('../models/user'),Token=require('../models/account-token'),Delivery=require('../models/email-delivery');
const {problem}=require('../lib/errors'),{audit}=require('../lib/audit'),{limiter}=require('../lib/limits');
const {emailConfigured,sendEmail}=require('../lib/email'),mfa=require('../lib/mfa');
const scalar=v=>typeof v==='string'?v.trim():'';
function registerEmailWebhook(app){
  app.post('/webhooks/email',express.raw({type:'application/json',limit:'128kb'}),async(req,res,next)=>{
    if(!process.env.EMAIL_WEBHOOK_SECRET)return res.sendStatus(503);
    try{
      const payload=req.body.toString('utf8');
      new Webhook(process.env.EMAIL_WEBHOOK_SECRET).verify(payload,{'svix-id':req.get('svix-id'),'svix-timestamp':req.get('svix-timestamp'),'svix-signature':req.get('svix-signature')});
      const event=JSON.parse(payload);
      if(!event||typeof event!=='object')return res.sendStatus(400);
      const allowed={'email.sent':'accepted','email.delivered':'delivered','email.bounced':'bounced','email.complained':'complained','email.failed':'failed'};
      if(allowed[event.type]&&typeof event.data?.email_id==='string'){
        const at=new Date(event.created_at);
        if(Number.isFinite(at.getTime()))try{await Delivery.updateOne({_id:event.data.email_id,$or:[{providerEventAt:{$lt:at}},{providerEventAt:null}]},{$set:{status:allowed[event.type],providerEventAt:at,updatedAt:new Date()}},{upsert:true});}catch(error){if(error.code!==11000)throw error;}
      }
      res.sendStatus(204);
    }catch(error){if(error.name==='WebhookVerificationError'||error.name==='SyntaxError'||error.message?.includes('signature')||error.message?.includes('timestamp'))return res.sendStatus(400);next(error);}
  });
}
function registerSecurity({app,auth,wrap,emailTransport}){
  const limit=limiter('security',{account:6,ip:240,windowMs:900000});
  const regenerate=req=>new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
  async function sendToken(user,purpose){
    const token=crypto.randomBytes(32).toString('hex'),tokenHash=mfa.hash(token);
    await Token.deleteMany({userId:user._id,purpose});
    await Token.create({_id:tokenHash,userId:user._id,purpose,expiresAt:new Date(Date.now()+(purpose==='reset'?30:60)*60000)});
    try{
      const origin=process.env.APP_ORIGIN||'http://127.0.0.1:8080';
      const result=await sendEmail({to:user.email,subject:purpose==='reset'?'Reset your PG Dekho password':'Verify your PG Dekho email',text:(purpose==='reset'?'Reset your password':'Verify your email address')+' using this one-time link:\n'+origin+(purpose==='reset'?'/reset-password':'/account/verify')+'#token='+token+'\nThis link expires in '+(purpose==='reset'?'30':'60')+' minutes. If you did not request it, ignore this message.'},emailTransport);
      if(!result?.id)throw problem(503,'Email delivery could not be confirmed.');
      await Delivery.updateOne({_id:result.id},{$set:{userId:user._id,purpose,updatedAt:new Date()},$setOnInsert:{status:'accepted'}},{upsert:true});
    }catch(error){await Token.deleteOne({_id:tokenHash});throw error;}
  }
  app.get('/account/security',auth,wrap(async(req,res)=>{
    const delivery=await Delivery.findOne({userId:req.user._id}).select('status updatedAt').sort({updatedAt:-1}).lean();
    res.render('security',{emailReady:emailConfigured(emailTransport),setup:null,recoveryCodes:null,delivery});
  }));
  app.post('/account/verify/send',auth,limit,wrap(async(req,res)=>{
    if(req.user.emailVerifiedAt)return res.redirect('/account/security');
    await sendToken(req.user,'verify');await audit(req,'email.verification.request','User',req.user._id);
    res.render('message',{heading:'Verification requested',message:'The email provider accepted your verification message. Check your inbox. Your email is verified only after you open the link and confirm it.'});
  }));
  app.get('/account/verify',(req,res)=>res.render('token-form',{purpose:'verify'}));
  app.post('/account/verify',limit,wrap(async(req,res)=>{
    const raw=scalar(req.body.token);
    if(!/^[a-f0-9]{64}$/.test(raw))throw problem(400,'The verification link is invalid or expired.');
    const token=await Token.findOneAndDelete({_id:mfa.hash(raw),purpose:'verify',expiresAt:{$gt:new Date()}});
    if(!token)throw problem(400,'The verification link is invalid or expired.');
    await User.updateOne({_id:token.userId},{$set:{emailVerifiedAt:new Date()}});
    await audit(req,'email.verified','User',token.userId);
    res.render('message',{heading:'Email verified',message:'You have confirmed access to this email address. This does not verify ownership of your phone number or legal property documents.'});
  }));
  app.get('/forgot-password',(req,res)=>res.render('token-form',{purpose:'request'}));
  app.post('/forgot-password',limit,wrap(async(req,res)=>{
    if(!emailConfigured(emailTransport))throw problem(503,'Password recovery requires a configured email provider. No recovery email was sent. Contact the administrator.');
    const user=await User.findOne({email:scalar(req.body.email).toLowerCase(),emailVerifiedAt:{$ne:null},suspended:{$ne:true}});
    if(user){await sendToken(user,'reset');await audit(req,'password.reset.request','User',user._id);}
    res.render('message',{heading:'Recovery requested',message:'If an active account with a previously verified email matches, recovery instructions have been requested. Check your inbox. Accounts without verified email need administrator assistance.'});
  }));
  app.get('/reset-password',(req,res)=>res.render('token-form',{purpose:'reset'}));
  app.post('/reset-password',limit,wrap(async(req,res)=>{
    const raw=scalar(req.body.token),password=typeof req.body.password==='string'?req.body.password:'';
    if(!/^[a-f0-9]{64}$/.test(raw)||password.length<12||!password.trim()||Buffer.byteLength(password)>72)throw problem(400,'Use a valid recovery link and a password of 12 or more characters, up to 72 UTF-8 bytes.');
    const passwordHash=await bcrypt.hash(password,12);
    const token=await Token.findOneAndDelete({_id:mfa.hash(raw),purpose:'reset',expiresAt:{$gt:new Date()}});
    if(!token)throw problem(400,'This recovery link is invalid or expired.');
    await User.updateOne({_id:token.userId,emailVerifiedAt:{$ne:null}},{$set:{passwordHash},$inc:{sessionVersion:1}});
    await audit(req,'password.reset','User',token.userId);
    await regenerate(req);res.redirect('/login?passwordReset=1');
  }));
  app.post('/account/mfa/setup',auth,limit,wrap(async(req,res)=>{
    const user=await User.findById(req.user._id);
    if(user.role!=='admin')throw problem(403,'Administrator access is required.');
    if(user.mfa.enabled)throw problem(400,'MFA is already enabled.');
    if(!user.emailVerifiedAt)throw problem(400,'Verify your email before enrolling administrator MFA.');
    if(!user.passwordHash)throw problem(400,'Set a PG Dekho password through verified-email password recovery before enabling administrator MFA.');
    if(!await bcrypt.compare(String(req.body.password||''),user.passwordHash))throw problem(403,'Your current password is incorrect.');
    const setup=mfa.setup(user.email);req.session.mfaSetup={encrypted:setup.encrypted,expiresAt:Date.now()+300000};
    res.render('security',{emailReady:emailConfigured(emailTransport),setup,recoveryCodes:null,delivery:null});
  }));
  app.post('/account/mfa/confirm',auth,limit,wrap(async(req,res)=>{
    const setup=req.session.mfaSetup;
    if(req.user.role!=='admin'||!req.user.emailVerifiedAt||!setup||setup.expiresAt<Date.now())throw problem(400,'MFA setup expired. Start again.');
    const counter=mfa.counter(mfa.decrypt(setup.encrypted),scalar(req.body.code));
    if(counter===null)throw problem(400,'The authenticator code is incorrect.');
    const recoveryCodes=Array.from({length:8},()=>crypto.randomBytes(16).toString('hex'));
    const result=await User.updateOne({_id:req.user._id,'mfa.enabled':{$ne:true}},{$set:{'mfa.enabled':true,'mfa.secret':setup.encrypted,'mfa.lastCounter':counter,'mfa.recoveryHashes':recoveryCodes.map(mfa.hash)},$inc:{sessionVersion:1}});
    if(!result.modifiedCount)throw problem(409,'MFA configuration changed. Sign in again.');
    delete req.session.mfaSetup;
    const user=await User.findById(req.user._id);await regenerate(req);req.session.userId=String(user._id);req.session.sessionVersion=user.sessionVersion;req.session.mfaVerified=true;
    req.session.csrf=crypto.randomBytes(32).toString('hex');res.locals.csrf=req.session.csrf;
    res.locals.user=user;await audit(req,'mfa.enabled','User',user._id);
    res.render('security',{emailReady:emailConfigured(emailTransport),setup:null,recoveryCodes,delivery:null});
  }));
  app.get('/mfa',(req,res)=>{if(!req.session.pendingMfaUserId)return res.redirect('/login');res.render('mfa');});
  app.post('/mfa',limit,wrap(async(req,res)=>{
    if(!req.session.pendingMfaUserId||req.session.pendingMfaExpiresAt<Date.now())throw problem(403,'Sign in again to continue.');
    const user=await User.findById(req.session.pendingMfaUserId).select('+mfa.secret +mfa.lastCounter +mfa.recoveryHashes');
    if(!user||user.suspended||!user.mfa.enabled||!await mfa.verify(User,user,scalar(req.body.code)))throw problem(403,'The authenticator or recovery code is invalid or already used.');
    await regenerate(req);req.session.userId=String(user._id);req.session.sessionVersion=user.sessionVersion||0;req.session.mfaVerified=true;
    await audit({...req,user},'mfa.login','User',user._id);res.redirect('/admin');
  }));
}
module.exports={registerSecurity,registerEmailWebhook};
