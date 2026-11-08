// Read-only inventory report. Never approves, changes, deletes, or copies real records.
require('dotenv').config({quiet:true});
const mongoose=require('mongoose'),Listing=require('../models/listing');
const {submissionIssues}=require('../lib/input'),{POLICY_VERSION}=require('../lib/publication');
async function reviewLegacy(){
  const findings=[];
  const cursor=Listing.find({$or:[{listingStatus:'published'},{'publicSnapshot.listingStatus':'published'}]}).cursor();
  for await(const listing of cursor){
    const candidate=listing.publicSnapshot?{...listing.toObject(),...listing.publicSnapshot}:listing;
    const issues=submissionIssues(candidate);
    if((candidate.publicationPolicyVersion||0)!==POLICY_VERSION)issues.push('Current policy requires explicit admin re-approval');
    if(!(listing.approvedAuthorizationDocuments?.length?listing.approvedAuthorizationDocuments:listing.authorizationDocuments).every(d=>d.scanStatus!=='infected'&&d.status==='accepted'))issues.push('Authorization evidence needs usable documents and human review');
    findings.push({id:String(listing._id),state:listing.listingStatus,publiclyEligible:issues.length===0,issues});
  }
  return {readOnly:true,policyVersion:POLICY_VERSION,count:findings.length,findings};
}
if(require.main===module)(async()=>{try{
  if(!process.env.MONGO_URL)throw Error('Set MONGO_URL explicitly for an authorized read-only inventory review.');
  await mongoose.connect(process.env.MONGO_URL,{autoIndex:false,maxPoolSize:2,serverSelectionTimeoutMS:10000});
  console.log(JSON.stringify(await reviewLegacy(),null,2));
}catch(error){console.error('Inventory review failed ('+error.name+'). Check connection and read permissions.');process.exitCode=1;}finally{await mongoose.disconnect();}})();
module.exports={reviewLegacy};
