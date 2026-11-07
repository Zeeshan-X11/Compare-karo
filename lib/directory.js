const Entry = require('../models/directory-entry');
const { googleSearch } = require('./maps');
const catalog = require('../data/rajanukunte-directory.json');
const { dateInput } = require('./marketplace');
function category(value) { return ['Men', 'Women', 'Co-living'].includes(value) ? value : ''; }
function decorate(entry) {
  return { ...entry, mapSearchUrl: googleSearch(entry.name + ', ' + entry.address) };
}
async function search(value, page = 1, size = 12) {
  const query = { locality: 'Rajanukunte', hidden: false };
  if (category(value)) query.category = category(value);
  const [entries, total] = await Promise.all([
    Entry.find(query).sort({ name: 1, _id: 1 }).skip((page - 1) * size).limit(size).lean(),
    Entry.countDocuments(query),
  ]);
  return { entries: entries.map(decorate), total };
}
async function sync({ apply = false } = {}) {
  // Validate the entire catalog before any write. Explicit source fields only;
  // never copy moderation state or private owner data from an import.
  const slugs = new Set();
  const entries = catalog.map(row => {
    if (slugs.has(row.slug)) throw Error('Duplicate directory slug.');
    slugs.add(row.slug);
    const { slug, name, category, locality, address, nearbyArea, sourceName, sourceUrl } = row;
    const record = { slug, name, category, locality, address, nearbyArea, sourceName, sourceUrl,
      checkedAt: dateInput(row.checkedAt, 'Source check date') };
    const error = new Entry(record).validateSync();
    if (error) throw error;
    return record;
  });
  if (!apply) return { dryRun: true, entries: entries.length, collection: Entry.collection.name };
  const result = await Entry.bulkWrite(entries.map(row => ({ updateOne: {
    filter: { slug: row.slug }, update: { $set: row, $setOnInsert: { hidden: false, moderationReason: '' } }, upsert: true,
  } })));
  return { dryRun: false, entries: entries.length, inserted: result.upsertedCount, matched: result.matchedCount };
}
module.exports = { search, sync, category };
