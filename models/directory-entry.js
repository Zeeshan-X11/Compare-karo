const mongoose = require('mongoose');
const sourceHosts = new Set(['www.magicbricks.com', 'www.payingguestinbengaluru.com']);
function safeSource(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && sourceHosts.has(url.hostname) && !url.username && !url.password && !url.port; }
  catch { return false; }
}
const schema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxlength: 100 },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  category: { type: String, enum: ['Men', 'Women', 'Co-living'], required: true },
  locality: { type: String, enum: ['Rajanukunte'], required: true },
  address: { type: String, required: true, maxlength: 400 },
  nearbyArea: { type: String, default: '', maxlength: 100 },
  sourceName: { type: String, required: true, maxlength: 100 },
  sourceUrl: { type: String, required: true, validate: safeSource, maxlength: 1000 },
  checkedAt: { type: Date, required: true },
  hidden: { type: Boolean, default: false },
  moderationReason: { type: String, default: '', maxlength: 500 },
}, { timestamps: true, collection: 'public_directory_entries' });
schema.index({ locality: 1, hidden: 1, category: 1, name: 1, _id: 1 });
module.exports = mongoose.model('DirectoryEntry', schema);
module.exports.safeSource = safeSource;
