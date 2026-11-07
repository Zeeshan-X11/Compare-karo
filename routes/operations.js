const mongoose=require('mongoose');
const Listing=require('../models/listing');
const publication=require('../lib/publication');
const {createStorage}=require('../lib/storage');
const {scanDocument}=require('../lib/scanner');
const {problem}=require('../lib/errors');
const {audit}=require('../lib/audit');
const {scalar}=require('../lib/filters');
const market=require('../lib/marketplace');
function registerOperations({app,auth,role,wrap,reviewAction,owned,authorizationDir,documentScanner}){
  app.get('/admin/audit',auth,role(['admin']),wrap(async(req,res)=>{
    const page=market.page(req.query.page),Audit=require('../models/audit-event');
    const [events,total]=await Promise.all([Audit.find().sort({at:-1,_id:-1}).skip((page-1)*50).limit(50).lean(),Audit.countDocuments()]);
    res.render('audit',{events,page,pages:Math.ceil(total/50)});
  }));
  app.post('/owner/:id/consent',auth,role(['owner','admin']),wrap(async(req,res)=>{
    const l=await owned(req);
    // Revocation cannot be blocked by unrelated legacy validation or an unfinished upload.
    if(req.body.confirm!=='withdraw')throw problem(400,'Confirm withdrawal of publication consent.');
    await Listing.updateOne({_id:l._id,ownerId:req.user._id},[{$set:{
      contactPublic:false,whatsappAllowed:false,
      coordinates:{$mergeObjects:['$coordinates',{publicationAuthorized:false}]},
      publicSnapshot:{$cond:[{$eq:[{$type:'$publicSnapshot'},'object']},{$mergeObjects:['$publicSnapshot',{contactPublic:false,whatsappAllowed:false,coordinates:{$mergeObjects:['$publicSnapshot.coordinates',{publicationAuthorized:false}]}}]},'$$REMOVE']},
      __v:{$add:[{$ifNull:['$__v',0]},1]}
    }}]);
    await audit(req,'consent.withdraw','Listing',l._id);
    res.redirect('/owner/'+l._id+'/edit?consentWithdrawn=1');
  }));
  app.post('/owner/:id/withdraw',auth,role(['owner','admin']),wrap(async(req,res)=>{
    const l=await owned(req),reason=scalar(req.body.reason);
    if(reason.length<10||reason.length>1000)throw problem(400,'Provide a reason of 10–1000 characters.');
    await Listing.updateOne({_id:l._id,ownerId:req.user._id},{$set:{publicHidden:true,withdrawalRequest:{requestedAt:new Date(),reason}},$inc:{__v:1}});
    await audit(req,'listing.withdraw','Listing',l._id,{reason});
    res.redirect('/owner?withdrawn=1');
  }));
  app.post('/owner/:id/availability',auth,role(['owner','admin']),wrap(async(req,res)=>{
    const l=await owned(req);
    if(!publication.live(l))throw problem(400,'Availability updates require a currently approved public version.');
    const live=await publication.getPublic(l._id);
    if(!live)throw problem(400,'The property is not public. Submit changes for review.');
    if(!['unknown','available','unavailable'].includes(req.body.availabilityStatus))throw problem(400,'Choose a valid availability status.');
    publication.preservePublished(l);
    const rooms=(live.roomOptions||[]).map(r=>{
      const raw=scalar(req.body['available'+r.sharing]);
      const count=raw===''?null:Number(raw);
      if(count!==null&&(!/^\d+$/.test(raw)||!Number.isInteger(count)||count>500||r.totalRooms===null||r.totalRooms===undefined||count>r.totalRooms))throw problem(400,'Available rooms must be a whole number within the approved room total.');
      return {...r,availableRooms:count};
    });
    l.publicSnapshot.roomOptions=rooms;l.publicSnapshot.availabilityStatus=req.body.availabilityStatus;l.publicSnapshot.availabilityConfirmedAt=new Date();
    for(const candidate of l.roomOptions){const r=rooms.find(r=>r.sharing===candidate.sharing);if(r)candidate.availableRooms=r.availableRooms;}
    l.availabilityStatus=req.body.availabilityStatus;l.availabilityConfirmedAt=new Date();l.markModified('publicSnapshot');
    await l.save();await audit(req,'availability.update','Listing',l._id,{status:l.availabilityStatus});
    res.redirect('/owner/'+l._id+'/edit?availabilitySaved=1');
  }));
  app.get('/reports',auth,wrap(async(req,res)=>{
    const page=market.page(req.query.page);
    const result=await Listing.aggregate([
      {$match:{'reports.userId':req.user._id}},{$unwind:'$reports'},{$match:{'reports.userId':req.user._id}},
      {$project:{_id:1,'reports._id':1,'reports.propertyName':1,'reports.message':1,'reports.status':1,'reports.resolution':1,'reports.createdAt':1,'reports.reviewedAt':1}},
      {$sort:{'reports.createdAt':-1}},{$facet:{items:[{$skip:(page-1)*20},{$limit:20}],count:[{$count:'total'}]}}
    ]);
    res.render('reports',{reports:result[0]?.items||[],page,pages:Math.ceil((result[0]?.count[0]?.total||0)/20)});
  }));
  app.post('/admin/:id/authorization/:documentId/scan',auth,role(['admin']),reviewAction(async(req,res)=>{
    const l=await Listing.findById(req.params.id);
    if(!l||!mongoose.isValidObjectId(req.params.documentId))return res.sendStatus(404);
    const d=l.authorizationDocuments.id(req.params.documentId)||l.approvedAuthorizationDocuments?.id(req.params.documentId);
    if(!d)return res.sendStatus(404);
    const storage=createStorage({privateRoot:authorizationDir});
    try{
      const bytes=await storage.read('document',d.filename);
      if(bytes.length>8*1024*1024)throw problem(400,'Document exceeds the legacy safety limit. Upload a smaller replacement.');
      if(d.sha256&&require('crypto').createHash('sha256').update(bytes).digest('hex')!==d.sha256)throw problem(400,'Document integrity check failed. Upload a replacement for review.');
      if(d.mimeType==='application/pdf')await require('../lib/pdf-validation').validatePdf(bytes);
      const result=await scanDocument(bytes,{scan:documentScanner});
      if(result.status!=='clean')throw problem(503,'Document scanning is not configured or did not complete. The document remains quarantined. Ask the site operator to connect ClamAV, then run the scan again.');
      d.scanStatus=result.status;d.scanEngine=result.engine;d.scannedAt=result.scannedAt;d.scanReason=undefined;
    }catch(error){d.scanStatus=error.scanFinding==='infected'?'infected':'quarantined';d.scanReason='Security scanning did not pass. Contact the administrator.';await l.save();await audit(req,'document.scan.failed','Listing',l._id,{documentId:String(d._id)});throw error;}
    await l.save();await audit(req,'document.scan','Listing',l._id,{documentId:String(d._id),state:d.scanStatus});
    res.redirect('/admin/'+l._id);
  }));
}
module.exports={registerOperations};
