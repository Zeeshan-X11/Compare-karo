const net=require('net');
const {problem}=require('./errors');
function clamd(command,buffer,{host=process.env.CLAMD_HOST,port=Number(process.env.CLAMD_PORT||3310)}={}){
  return new Promise((resolve,reject)=>{if(!host)return reject(problem(503,'Document scanning is not configured. Keep the file and contact the administrator.'));
    const socket=net.createConnection({host,port});let reply='';socket.setTimeout(15000);socket.on('timeout',()=>socket.destroy(Error('Scanner timeout')));socket.on('error',()=>reject(problem(503,'The document scanner is unavailable. No document was accepted.')));
    socket.on('data',chunk=>{reply+=chunk.toString();if(reply.length>2048)socket.destroy();if(reply.includes('\0')||reply.includes('\n')){socket.destroy();resolve(reply.replace(/\0/g,'').trim());}});
    socket.on('connect',()=>{socket.write('z'+command+'\0');if(buffer){for(let offset=0;offset<buffer.length;offset+=65536){const chunk=buffer.subarray(offset,offset+65536),size=Buffer.alloc(4);size.writeUInt32BE(chunk.length);socket.write(size);socket.write(chunk);}socket.write(Buffer.alloc(4));}});
    socket.on('close',()=>{if(reply)resolve(reply.replace(/\0/g,'').trim());else reject(problem(503,'The document scanner did not respond.'));});
  });
}
async function scanDocument(bytes,{scan}={}){
  if(scan)return scan(bytes);
  if(!process.env.CLAMD_HOST)return {status:'quarantined',engine:'not-configured'};
  const version=await clamd('VERSION');const dateText=version.split('/').slice(2).join('/');const updated=Date.parse(dateText);
  if(!Number.isFinite(updated)||updated>Date.now()+3600000||Date.now()-updated>Number(process.env.SCAN_MAX_AGE_HOURS||72)*3600000)throw problem(503,'Document scanner definitions need updating. No document was accepted.');
  const result=await clamd('INSTREAM',bytes);
  if(!/^stream: OK$/.test(result)){
    if(/ FOUND$/.test(result)){const error=problem(400,'The scanner rejected this document. Upload a safe file or contact the administrator.');error.scanFinding='infected';throw error;}
    throw problem(503,'Security scanning could not complete. The document remains unapproved.');
  }
  return {status:'clean',engine:version.split('/')[0],scannedAt:new Date()};
}
module.exports={scanDocument,clamd};
