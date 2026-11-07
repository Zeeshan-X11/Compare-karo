function problem(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}
function log(level, event, details = {}) {
  // Never log request bodies, cookies, headers, URLs containing tokens, or provider errors.
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({at:new Date().toISOString(),level,event,...details}));
}
module.exports = {problem,log};
