const Listing = require('../models/listing');
const Entry = require('../models/directory-entry');
const Event = require('../models/audit-event');
const { localities } = require('./localities');
const catalog = require('../data/rajanukunte-directory.json');

async function review() {
  const listings = await Listing.find({ $or: [{ listingStatus: 'published' }, { 'publicSnapshot.listingStatus': 'published' }] }, '_id locality publicSnapshot.locality publicHidden updatedAt').lean();
  return {
    listings: listings.filter(l => !localities.includes(l.publicSnapshot?.locality || l.locality) && !l.publicHidden),
    directory: await Entry.find({ slug: { $in: catalog.filter(e => !e.inServiceArea).map(e => e.slug) }, hidden: { $ne: true } }).lean(),
  };
}
async function apply(plan) {
  let listingsHidden = 0, entriesHidden = 0;
  // Optimistic guards prevent a concurrent edit being overwritten. All records remain stored.
  for (const listing of plan.listings) {
    const result = await Listing.updateOne({ _id: listing._id, updatedAt: listing.updatedAt || { $exists: false }, publicHidden: { $ne: true } }, { $set: { publicHidden: true } });
    if (result.modifiedCount) {
      listingsHidden++;
      await Event.create({ action: 'service-area.listing-hidden', entityType: 'listing', entityId: listing._id, details: { reason: 'Rajanukunte-only service area', operator: 'explicit migration' } });
    }
  }
  for (const entry of plan.directory) {
    const result = await Entry.updateOne({ _id: entry._id, updatedAt: entry.updatedAt || { $exists: false }, hidden: { $ne: true } }, { $set: { hidden: true, moderationReason: 'Outside the Rajanukunte service area or insufficient locality evidence.' } });
    if (result.modifiedCount) {
      entriesHidden++;
      await Event.create({ action: 'service-area.directory-hidden', entityType: 'directory', entityId: entry._id, details: { reason: 'Rajanukunte-only service area', operator: 'explicit migration' } });
    }
  }
  return { listingsHidden, entriesHidden };
}
module.exports = { review, apply };
