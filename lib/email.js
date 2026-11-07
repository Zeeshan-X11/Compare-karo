const {problem}=require('./errors');
function emailConfigured(transport){return Boolean(transport||(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM&&process.env.APP_ORIGIN));}
async function sendEmail({to,subject,text},transport){
  if(!emailConfigured(transport))throw problem(503,'Email delivery is not configured. Contact the administrator; no email was sent.');
  if(transport)return transport({to,subject,text});
  let response;
  try{response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[to],subject,text}),signal:AbortSignal.timeout(10000)});}catch{throw problem(503,'Email delivery could not be confirmed. Please try again later.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok||typeof data.id!=='string')throw problem(503,'The email provider did not accept this message. Contact the administrator.');
  return {id:data.id}; // Accepted by provider; delivery and address ownership are separate states.
}
module.exports={emailConfigured,sendEmail};
