const {OAuth2Client} = require('google-auth-library');
const {problem} = require('./errors');
function configuration(env = process.env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  try {
    const origin = new URL(env.APP_ORIGIN || 'http://127.0.0.1:8080');
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname)))) return null;
    return {clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:origin.origin+'/auth/google/callback'};
  } catch { return null; }
}
function provider(config = configuration()) {
  if (!config) return null;
  const client = new OAuth2Client({clientId:config.clientId,clientSecret:config.clientSecret,redirectUri:config.redirectUri});
  client.transporter.defaults = {...client.transporter.defaults,timeout:10000,retry:false};
  return {
    authorizationUrl: ({state,nonce,challenge}) => client.generateAuthUrl({
      scope:['openid','email','profile'],access_type:'online',prompt:'select_account',
      state,nonce,code_challenge:challenge,code_challenge_method:'S256',
    }),
    async identity(code, verifier, nonce) {
      try {
        const {tokens} = await client.getToken({code,codeVerifier:verifier});
        if (!tokens.id_token) throw Error('Missing ID token');
        const ticket = await client.verifyIdToken({idToken:tokens.id_token,audience:config.clientId});
        const claims = ticket.getPayload();
        if (!claims || claims.nonce !== nonce || claims.email_verified !== true ||
          typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
          !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) ||
          (claims.azp !== undefined && claims.azp !== config.clientId) ||
          typeof claims.email !== 'string' || !/^\S+@\S+\.\S+$/.test(claims.email) || claims.email.length > 254)
          throw Error('Invalid identity claims');
        return {subject:claims.sub,email:claims.email.toLowerCase(),name:String(claims.name||'Nestly member').trim().slice(0,80)||'Nestly member'};
      } catch { throw problem(400,'Google sign-in could not be verified. Please start again.'); }
    },
  };
}
module.exports = {configuration,provider};
