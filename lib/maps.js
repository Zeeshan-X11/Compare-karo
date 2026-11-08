function googleSearch(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}
function validGoogleMapUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.origin === 'https://goo.gl') return /^\/maps\/[a-zA-Z0-9]+$/.test(url.pathname) && !url.search;
    if (url.origin === 'https://maps.app.goo.gl') return /^\/[a-zA-Z0-9]+\/?$/.test(url.pathname);
    if (url.origin === 'https://maps.google.com' && url.pathname === '/') return Boolean(url.searchParams.get('q'));
    if (!['https://www.google.com', 'https://maps.google.com'].includes(url.origin)) return false;
    if (/^\/maps\/(?:place\/[^/]+|@[-\d.,]+z)(?:\/|$)/.test(url.pathname)) return true;
    if (url.pathname === '/maps/search/') return url.searchParams.get('api') === '1' && Boolean(url.searchParams.get('query'));
    return /^\/maps\/?$/.test(url.pathname) && Boolean(url.searchParams.get('q') || url.searchParams.get('cid'));
  } catch {
    return false;
  }
}
function exactLocationUrl(location) {
  if (validGoogleMapUrl(location?.mapUrl)) return location.mapUrl;
  if (Number.isFinite(location?.latitude) && Math.abs(location.latitude) <= 90 &&
      Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180) {
    return googleSearch(location.latitude + ',' + location.longitude);
  }
  return null;
}
function maps(listing) {
  const location = listing.coordinates;
  const url = location?.verified && location.publicationAuthorized ? exactLocationUrl(location) : null;
  return {
    exact: Boolean(url),
    url: url || googleSearch(listing.locality + ', Bengaluru, Karnataka'),
  };
}
module.exports = { maps, googleSearch, exactLocationUrl, validGoogleMapUrl };
