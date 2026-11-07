const Event=require('../models/audit-event');
async function audit(req,action,entityType,entityId,details={}){
  // Callers supply field names, states and identifiers, never tokens, document bytes or contact values.
  await Event.create({actorId:req.user?._id,action,entityType,entityId,details});
}
module.exports={audit};
