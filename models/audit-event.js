const mongoose=require('mongoose');
const schema=new mongoose.Schema({actorId:mongoose.Schema.Types.ObjectId,action:{type:String,required:true},entityType:String,entityId:mongoose.Schema.Types.ObjectId,details:mongoose.Schema.Types.Mixed,at:{type:Date,default:Date.now}},{versionKey:false});
schema.index({entityId:1,at:-1});schema.index({actorId:1,at:-1});
schema.index({at:-1,_id:-1});
schema.pre('save',function(){if(!this.isNew)throw Error('Audit events are append-only.');});
for(const hook of ['updateOne','updateMany','findOneAndUpdate','replaceOne','deleteOne','deleteMany','findOneAndDelete'])schema.pre(hook,function(){throw Error('Audit events are append-only.');});
module.exports=mongoose.model('AuditEvent',schema);
