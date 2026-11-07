const path=require('path'),fs=require('fs/promises'),crypto=require('crypto'),os=require('os'),{performance}=require('perf_hooks');
process.env.NODE_ENV='test';process.env.MONGOMS_DOWNLOAD_DIR=path.resolve(__dirname,'../../work/mongodb-binaries');
process.env.UPLOAD_DIR=path.resolve(__dirname,'../../work/load-test/photos');process.env.AUTHORIZATION_DIR=path.resolve(__dirname,'../../work/load-test/documents');
process.env.RESEND_API_KEY='';process.env.CLAMD_HOST='';
const {MongoMemoryServer}=require('mongodb-memory-server'),mongoose=require('mongoose'),MongoStore=require('connect-mongo'),bcrypt=require('bcryptjs'),sharp=require('sharp');
const {createApp}=require('../app'),Listing=require('../models/listing'),User=require('../models/user'),Inquiry=require('../models/inquiry'),publication=require('../lib/publication');
(async()=>{
 let mongo,server,store,sampler;
 try{
  mongo=await MongoMemoryServer.create();const uri=mongo.getUri('nestly_isolated_load');await mongoose.connect(uri,{maxPoolSize:20,minPoolSize:2});
  const hash=await bcrypt.hash('load-test-only-password',12),owner=await User.create({name:'TEST ONLY load owner',email:'owner@load.invalid',role:'owner',passwordHash:hash});
  const pixels=crypto.randomBytes(1400*1000*3),photo=await sharp(pixels,{raw:{width:1400,height:1000,channels:3}}).png().toBuffer();
  const images=await require('../lib/photos').preparePhotos([{file:{buffer:photo},type:'Exterior'}],owner._id,process.env.UPLOAD_DIR);
  const png=await sharp({create:{width:100,height:100,channels:3,background:'#eee'}}).png().toBuffer();
  const docs=await require('../lib/authorization').prepareAuthorization([{buffer:png,mimetype:'image/png'}],{authorizationDeclaration:'yes',authorizationType:'Trade licence'},owner._id,process.env.AUTHORIZATION_DIR,async()=>({status:'clean',engine:'TEST-ONLY',scannedAt:new Date()}));
  const records=[];
  for(let i=0;i<30;i++){
   const l=new Listing({name:'TEST ONLY load property '+i,description:'Isolated load fixture, never real inventory. This complete test record exercises public browsing, search filters, image delivery and permitted student inquiries without touching any existing accounts or listings.',address:'TEST ONLY address with no real property',locality:i%2?'Yelahanka':'Rajajinagar',propertyCategory:'Men',monthlyRent:10000+i*100,securityDeposit:20000,oneTimeFee:0,sharingOptions:['Double'],roomOptions:[{sharing:'Double',monthlyRent:10000+i*100,totalRooms:5,availableRooms:2}],ownerId:owner._id,ownerAuthorized:true,contactName:'Test owner',contactPhone:'+919876501234',images:images.map(x=>({...x,status:'approved'})),authorizationDocuments:docs.map(d=>({...d,status:'accepted',reviewedBy:owner._id,reviewedAt:new Date()}))});
   publication.publish(l);records.push(await l.save());
  }
  await User.insertMany(Array.from({length:40},(_,i)=>({name:'TEST ONLY student '+i,email:'student'+i+'@load.invalid',role:'user',passwordHash:hash})));
  await Promise.all([Listing.init(),User.init(),Inquiry.init(),require('../models/rate-bucket').init()]);
  store=MongoStore.create({mongoUrl:uri,mongoOptions:{maxPoolSize:10}});const app=createApp({sessionStore:store});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
  const sessions=[];
  // Authenticate before timing. Actual bcrypt login and Mongo-backed sessions, no seeded session bypass.
  for(let i=0;i<40;i++){
   const first=await fetch(origin+'/login'),cookie=first.headers.get('set-cookie').split(';')[0],token=(await first.text()).match(/name="_csrf" value="([^"]+)"/)[1];
   const login=await fetch(origin+'/login',{method:'POST',redirect:'manual',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:token,email:'student'+i+'@load.invalid',password:'load-test-only-password'})});
   if(login.status!==302)throw Error('Isolated student login failed: '+login.status);sessions.push(login.headers.get('set-cookie').split(';')[0]);
  }
  const latencies=[],errors=[],counts={};let bytes=0,peakRss=process.memoryUsage().rss;
  sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
  async function hit(cookie,route,type,options={}){const at=performance.now();try{const r=await fetch(origin+route,{redirect:'manual',...options,headers:{cookie,...options.headers}}),body=Buffer.from(await r.arrayBuffer());latencies.push({type,ms:performance.now()-at});bytes+=body.length;counts[type]=(counts[type]||0)+1;if(![200,302].includes(r.status))errors.push({type,status:r.status});return body.toString();}catch(error){errors.push({type,error:error.name});return '';}}
  const start=performance.now();
  await Promise.all(sessions.map(async(cookie,i)=>{
   await hit(cookie,'/styles.css','asset');await hit(cookie,'/app.js','asset');
   for(let round=0;round<3;round++){
    const home=await hit(cookie,'/','browse'),token=home.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await hit(cookie,'/listings?area='+(i%2?'Yelahanka':'Rajajinagar')+'&maxRent=20000&sharing=Double&sort=rent-asc&page='+(round%2+1),'search');
    await hit(cookie,'/listings/'+records[i%records.length]._id,'detail');
    await hit(cookie,'/media/'+images[0].thumbnail,'thumbnail');await hit(cookie,'/media/'+images[0].filename,'photo');
    if(!token){errors.push({type:'csrf',status:'missing'});continue;}
    await hit(cookie,'/listings/'+records[i%records.length]._id+'/inquiries','inquiry',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:token,message:'TEST ONLY permitted inquiry '+round+' from isolated student '+i})});
   }
  }));
  const elapsed=performance.now()-start,percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:0;
  const summary={isolated:true,node:process.version,platform:process.platform,cpuModel:os.cpus()[0]?.model,concurrentStudents:40,rounds:3,requests:latencies.length,counts,errors,elapsedMs:Math.round(elapsed),p50Ms:Math.round(percentile(latencies.map(x=>x.ms),.5)),p95Ms:Math.round(percentile(latencies.map(x=>x.ms),.95)),p99Ms:Math.round(percentile(latencies.map(x=>x.ms),.99)),byType:Object.fromEntries(Object.keys(counts).map(type=>[type,{requests:counts[type],p95Ms:Math.round(percentile(latencies.filter(x=>x.type===type).map(x=>x.ms),.95))}])),bytesTransferred:bytes,peakCombinedAppAndGeneratorRssMB:Math.round(peakRss/1024/1024),inquiriesPersisted:await Inquiry.countDocuments(),limitations:['Local Windows machine and ephemeral local MongoDB; not production host or Atlas.','ClamAV, TLS, WAN latency and external email excluded.','Memory includes app plus load generator; MongoDB child process excluded.','Three rounds and one generated test photo; no long-duration capacity guarantee.']};
  await fs.mkdir(path.resolve(__dirname,'../work'),{recursive:true});await fs.writeFile(path.resolve(__dirname,'../work/load-test-results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
  if(errors.length||summary.inquiriesPersisted!==120)process.exitCode=1;
 }catch(error){console.error('Isolated load test failed:',error.message);process.exitCode=1;}finally{clearInterval(sampler);if(server)await new Promise(r=>server.close(r));if(store)await store.close();await mongoose.disconnect();if(mongo)await mongo.stop();}
})();
