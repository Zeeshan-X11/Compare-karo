const mongoose=require('mongoose');
const {createStorage}=require('./storage');
async function readiness(){
  if(mongoose.connection.readyState!==1)throw Error('database unavailable');
  await mongoose.connection.db.command({ping:1},{maxTimeMS:2000});
  await createStorage().check();
  return {status:'ok'};
}
module.exports={readiness};
