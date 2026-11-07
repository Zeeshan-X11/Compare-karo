const mongoose=require('mongoose');
const schema=new mongoose.Schema({_id:String,userId:mongoose.Schema.Types.ObjectId,purpose:String,status:String,providerEventAt:Date,updatedAt:Date},{versionKey:false});
schema.index({userId:1,updatedAt:-1});
module.exports=mongoose.model('EmailDelivery',schema);
