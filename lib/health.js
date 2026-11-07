const mongoose=require('mongoose');
const {createStorage}=require('./storage');
const {scanDocument}=require('./scanner');
let scannerChecked=0;
async function readiness({production=process.env.NODE_ENV==='production'}={}){
  if(mongoose.connection.readyState!==1)throw Error('database unavailable');
  await mongoose.connection.db.command({ping:1},{maxTimeMS:2000});
  await createStorage().check();
  if(production&&Date.now()-scannerChecked>60000){
    const result=await scanDocument(Buffer.from('Nestly readiness check\n'));
    if(result.status!=='clean')throw Error('scanner unavailable');
    scannerChecked=Date.now();
  }
  return {status:'ok'};
}
module.exports={readiness};
