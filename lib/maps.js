// Locality boundary from OpenStreetMap relation 17417762, checked 2026-11-06.
// A locality map must never masquerade as a verified property pin.
const areas = Object.freeze({
  Rajanukunte: { south: 13.1626376, north: 13.1756195, west: 77.5537621, east: 77.5677574 },
});
function validPoint(c) {
  return Boolean(c?.verified && c.publicationAuthorized &&
    Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90 &&
    Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180);
}
function googleSearch(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}
function maps(listing) {
  const c = listing.coordinates;
  const exact = validPoint(c);
  const area = areas[listing.locality];
  let bounds = area;
  if (exact) bounds = {
    south: Math.max(-90, c.latitude - 0.006), north: Math.min(90, c.latitude + 0.006),
    west: Math.max(-180, c.longitude - 0.008), east: Math.min(180, c.longitude + 0.008),
  };
  const params = new URLSearchParams({ layer: 'mapnik' });
  if (bounds) params.set('bbox', [bounds.west, bounds.south, bounds.east, bounds.north].join(','));
  if (exact) params.set('marker', c.latitude + ',' + c.longitude);
  return {
    exact,
    url: googleSearch(exact ? c.latitude + ',' + c.longitude : listing.locality + ', Bengaluru, Karnataka'),
    embedUrl: bounds ? 'https://www.openstreetmap.org/export/embed.html?' + params : null,
    osmUrl: exact
      ? 'https://www.openstreetmap.org/?mlat=' + c.latitude + '&mlon=' + c.longitude + '#map=16/' + c.latitude + '/' + c.longitude
      : 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(listing.locality + ', Bengaluru'),
    label: exact ? 'Reviewed property location' : listing.locality + ' area — not an individual PG location',
  };
}
module.exports = { maps, googleSearch, validPoint };
