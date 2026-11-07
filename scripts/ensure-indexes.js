require('dotenv').config({quiet:true});
const mongoose=require('mongoose');
const models=['user','listing','inquiry','rate-bucket','audit-event','account-token','email-delivery','directory-entry','oauth-attempt'].map(name=>require('../models/'+name));
async function ensureIndexes(){for(const model of models)await model.createIndexes();}
if(require.main===module)(async()=>{try{if(!process.env.MONGO_URL)throw Error('MONGO_URL required');await mongoose.connect(process.env.MONGO_URL,{autoIndex:false,maxPoolSize:2,serverSelectionTimeoutMS:10000});await ensureIndexes();console.log('Declared indexes created. No indexes were dropped and no records were rewritten.');}catch(error){console.error('Index setup failed ('+error.name+'). Check operator permissions and resolve duplicates manually.');process.exitCode=1;}finally{await mongoose.disconnect();}})();
module.exports={ensureIndexes};
