const mongoose=require('mongoose');
const schema=new mongoose.Schema({_id:String,userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},purpose:{type:String,enum:['verify','reset'],required:true},expiresAt:{type:Date,required:true}});
schema.index({expiresAt:1},{expireAfterSeconds:0});
schema.index({userId:1,purpose:1},{unique:true});
module.exports=mongoose.model('AccountToken',schema);
