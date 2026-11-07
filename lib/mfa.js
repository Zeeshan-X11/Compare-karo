const crypto=require('crypto'),OTPAuth=require('otpauth');
const {problem}=require('./errors');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function key(){const raw=process.env.MFA_ENCRYPTION_KEY||'';const bytes=Buffer.from(raw,'base64');if(bytes.length!==32)throw problem(503,'Administrator MFA encryption is not configured.');return bytes;}
function encrypt(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);const content=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),content]).toString('base64');}
function decrypt(value){const bytes=Buffer.from(value,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}
function totp(secret,email){return new OTPAuth.TOTP({issuer:'Nestly',label:email,algorithm:'SHA1',digits:6,period:30,secret:OTPAuth.Secret.fromBase32(secret)});}
function setup(email){const secret=new OTPAuth.Secret({size:20}).base32;return {secret,uri:totp(secret,email).toString(),encrypted:encrypt(secret)};}
function counter(secret,token,timestamp=Date.now()){
  if(!/^\d{6}$/.test(String(token)))return null;
  const delta=totp(secret,'').validate({token:String(token),window:1,timestamp});
  return delta===null?null:Math.floor(timestamp/30000)+delta;
}
async function verify(User,user,token){
  const c=counter(decrypt(user.mfa.secret),token);
  if(c!==null){const result=await User.updateOne({_id:user._id,'mfa.enabled':true,$or:[{'mfa.lastCounter':{$lt:c}},{'mfa.lastCounter':{$exists:false}}]},{$set:{'mfa.lastCounter':c}});return result.modifiedCount===1;}
  if(!/^[a-f0-9]{32}$/.test(String(token)))return false;
  const result=await User.updateOne({_id:user._id,'mfa.enabled':true,'mfa.recoveryHashes':hash(token)},{$pull:{'mfa.recoveryHashes':hash(token)}});return result.modifiedCount===1;
}
module.exports={hash,encrypt,decrypt,setup,counter,verify};
