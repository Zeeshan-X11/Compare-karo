const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: String, sessionHash: {type:String,required:true}, nonce: String, verifier: String,
  role: {type:String,enum:['user','owner'],default:'user'},
  linkUserId: mongoose.Schema.Types.ObjectId, sessionVersion: Number,
  expiresAt: {type:Date,required:true},
});
schema.index({expiresAt:1},{expireAfterSeconds:0});
module.exports = mongoose.model('OAuthAttempt', schema);
