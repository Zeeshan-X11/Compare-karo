const mongoose=require('mongoose');
const schema=new mongoose.Schema({_id:String,count:{type:Number,default:0},expiresAt:Date});
schema.index({expiresAt:1},{expireAfterSeconds:0});
module.exports=mongoose.model('RateBucket',schema);
