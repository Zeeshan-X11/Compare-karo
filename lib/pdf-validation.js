const {Worker,isMainThread,parentPort}=require('worker_threads');
const {problem}=require('./errors');
if(!isMainThread){
  parentPort.once('message',async bytes=>{
    try{
      const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
      const pages=pdf.getPageCount();
      if(pages<1||pages>100)throw Error('pages');
      const objects=pdf.context.enumerateIndirectObjects().map(([,v])=>v.toString()).join('\n');
      const active=/\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFiles|RichMedia|XFA)\b/.test(objects+'\n'+Buffer.from(bytes).toString('latin1'));
      parentPort.postMessage({valid:true,active});
    }catch{parentPort.postMessage({valid:false});}
  });
}
function validatePdf(bytes){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(__filename,{resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});let settled=false;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timeout);worker.terminate();if(error)reject(error);else resolve();};
    const timeout=setTimeout(()=>finish(problem(400,'PDF validation exceeded the safety limit. Upload a simple scanned document.')),5000);
    worker.once('message',result=>finish(!result.valid?problem(400,'The PDF could not be read. Upload a valid, unencrypted document with 1–100 pages.'):result.active?problem(400,'Active PDF content and attachments are not permitted. Upload a plain scan.'):null));
    worker.once('error',()=>finish(problem(400,'PDF validation failed safely. Upload a simple scanned document.')));
    worker.once('exit',()=>{if(!settled)finish(problem(400,'The PDF could not be validated safely.'));});
    worker.postMessage(bytes);
  });
}
module.exports={validatePdf};
