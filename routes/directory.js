const Entry = require('../models/directory-entry');
const directory = require('../lib/directory');
const market = require('../lib/marketplace');
const { audit } = require('../lib/audit');
const { problem } = require('../lib/errors');
function registerDirectory({ app, auth, role, wrap }) {
  app.get('/directory/rajanukunte', wrap(async (req, res) => {
    const page = market.page(req.query.page);
    const category = directory.category(req.query.category);
    const term = typeof req.query.q==='string'?req.query.q.trim().slice(0,80):'';
    const result = await directory.search(category, page, 12, term);
    res.render('directory', { ...result, category, term, page, pages: Math.ceil(result.total / 12),
      map: market.maps({ locality: 'Rajanukunte' }), title: 'Rajanukunte PG directory' });
  }));
  app.get('/admin/directory', auth, role(['admin']), wrap(async (req, res) => {
    const page = market.page(req.query.page);
    const [entries, total] = await Promise.all([
      Entry.find().sort({ name: 1, _id: 1 }).skip((page - 1) * 24).limit(24).lean(), Entry.countDocuments(),
    ]);
    res.render('admin-directory', { entries, page, pages: Math.ceil(total / 24), title: 'Public directory management' });
  }));
  app.post('/admin/directory/:slug/visibility', auth, role(['admin']), wrap(async (req, res) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(req.params.slug) || !['hide', 'show'].includes(req.body.action))
      throw problem(400, 'Choose a valid directory action.');
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500) throw problem(400, 'Explain this change in 10–500 characters.');
    const entry = await Entry.findOne({ slug: req.params.slug });
    if (!entry) throw problem(404, 'Directory entry not found.');
    if(req.body.action==='show'&&!entry.inServiceArea)throw problem(400,'Only Rajanukunte entries can appear in the public directory.');
    const hidden = req.body.action === 'hide';
    await audit(req, 'directory.visibility', 'directory', entry._id, { hidden, reason });
    entry.hidden = hidden;
    entry.moderationReason = reason;
    await entry.save();
    res.redirect('/admin/directory');
  }));
}
module.exports = { registerDirectory };
