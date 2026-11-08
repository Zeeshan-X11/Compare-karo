const mongoose=require('mongoose');
const {createStorage}=require('./storage');
const {durableUploads}=require('./config');
async function readiness(){
  if(mongoose.connection.readyState!==1)throw Error('database unavailable');
  await mongoose.connection.db.command({ping:1},{maxTimeMS:2000});
  if(process.env.NODE_ENV!=='production'||durableUploads())await createStorage().check();
  return {status:'ok'};
}
module.exports={readiness};
