const crypto=require('crypto');
const Bucket=require('../models/rate-bucket');
const {problem}=require('./errors');
async function consume(scope,key,limit,windowMs,weight=1){
  if(weight>limit)return false;
  const window=Math.floor(Date.now()/windowMs);
  const id=crypto.createHash('sha256').update(scope+':'+key+':'+window).digest('hex');
  try {
    const result=await Bucket.findOneAndUpdate({_id:id,count:{$lte:limit-weight}},{$inc:{count:weight},$setOnInsert:{expiresAt:new Date((window+1)*windowMs+60000)}},{upsert:true,new:true});
    return !!result;
  }catch(error){if(error.code===11000)return false;throw error;}
}
function limiter(scope,{account=60,ip=1200,windowMs=3600000,override,key}={}){
  return async(req,res,next)=>{try{
    const accountKey=req.user?String(req.user._id):req.session?.pendingMfaUserId||key?.(req);
    if((accountKey&&!await consume(scope+':account',accountKey,override??account,windowMs))||!await consume(scope+':ip',req.ip,override??ip,windowMs)){
      res.set('Retry-After',String(Math.ceil(windowMs/1000)));
      return next(problem(429,'Too many requests for this action. Try again later. Other browsing remains available.'));
    }next();
  }catch(error){next(error);}};
}
function uploadGuard({globalLimit=2,accountLimit=1,maxBytes=24*1024*1024,dailyBytes=100*1024*1024}={}){
  let active=0;const accounts=new Map();
  return async(req,res,next)=>{if(!req.is('multipart/form-data'))return next();
    const key=String(req.user._id),length=Number(req.get('content-length'));
    if(length>maxBytes)return next(problem(413,'Upload at most 24 MB per request. Add files in smaller batches.'));
    if(active>=globalLimit||(accounts.get(key)||0)>=accountLimit){res.set('Retry-After','3');return next(problem(503,'Uploads are busy. Your entries are retained; try again in a few seconds.'));}
    active++;accounts.set(key,(accounts.get(key)||0)+1);let released=false;
    const release=()=>{if(released)return;released=true;active--;const remaining=(accounts.get(key)||1)-1;if(remaining>0)accounts.set(key,remaining);else accounts.delete(key);};
    res.once('finish',release);res.once('close',release);
    try{if(!await consume('upload-bytes',key,dailyBytes,86400000,Number.isFinite(length)&&length>0?length:maxBytes))return next(problem(429,'Your daily upload allowance is reached. Try again tomorrow.'));
      let received=0;req.on('data',chunk=>{received+=chunk.length;if(received>maxBytes&&!res.headersSent){res.status(413).json({message:'Upload at most 24 MB per request.'});req.destroy();}});next();
    }catch(error){next(error);}
  };
}
module.exports={consume,limiter,uploadGuard};
