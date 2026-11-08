const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.MONGOMS_DOWNLOAD_DIR = path.resolve(__dirname, '../../work/mongodb-binaries');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp } = require('../app');
const Entry = require('../models/directory-entry');
const User = require('../models/user');
const Listing = require('../models/listing');
const Event = require('../models/audit-event');
const directory = require('../lib/directory');
const { maps } = require('../lib/maps');
const catalog = require('../data/rajanukunte-directory.json');
const activeCatalog = catalog.filter(e=>e.inServiceArea);
let mongo, server, admin, owner, student, guest;
async function token(agent) {
  const r = await agent.get('/login');
  return r.text.match(/name="_csrf" value="([^"]+)"/)[1];
}
async function post(agent, url, data) {
  const csrf = await token(agent);
  return agent.post(url).type('form').send({ _csrf: csrf, ...data });
}
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('nestly_directory_test'));
  await Entry.init();
  server = createApp({ memorySession: true }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  guest = request.agent(server);
  const agents = [];
  for (const role of ['admin', 'owner', 'user']) {
    await User.create({ name: 'TEST ONLY ' + role, email: role + '@directory.invalid', role,
      passwordHash: await bcrypt.hash('disposable-directory-test-only', 12) });
    const agent = request.agent(server);
    assert.equal((await post(agent, '/login', { email: role + '@directory.invalid', password: 'disposable-directory-test-only' })).status, 302);
    agents.push(agent);
  }
  [admin, owner, student] = agents;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test('directory import is explicit, idempotent and never modifies owner listings or accounts', async () => {
  const dry = await directory.sync();
  assert.equal(dry.entries, catalog.length);
  assert.equal(await Entry.countDocuments(), 0);
  const first = await directory.sync({ apply: true });
  assert.equal(first.inserted, catalog.length);
  const again = await directory.sync({ apply: true });
  assert.equal(again.inserted, 0);
  assert.equal(await Entry.countDocuments(), catalog.length);
  assert.equal(await Listing.countDocuments(), 0);
  assert.equal(await User.countDocuments(), 3);
});
test('directory is public without approval, uses real source references and has no invented listing actions', async () => {
  const r = await guest.get('/directory/rajanukunte');
  assert.equal(r.status, 200);
  assert.match(r.text, new RegExp(activeCatalog.length + ' directory entries'));
  const second = await guest.get('/directory/rajanukunte?page=2');
  for (const entry of activeCatalog) assert.ok((r.text+second.text).includes(entry.name));
  for (const entry of catalog.filter(e=>!e.inServiceArea)) assert.ok(!(r.text+second.text).includes(entry.name));
  assert.match(r.text, /not a complete list or a live vacancy feed/);
  assert.match(r.text, /Public directory · Unverified/);
  assert.doesNotMatch(r.text, /Nearby · Dibbur/);
  assert.doesNotMatch(r.text, /openstreetmap|<iframe/i);
  assert.match(r.headers['content-security-policy'], /frame-src 'none'/);
  assert.match(r.text, /href="https:\/\/goo\.gl\/maps\/cGy7GezsqaEMYiC87"/);
  assert.match(r.text, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=.*Manju/);
  assert.doesNotMatch(r.text, /name="monthlyRent"|action="\/inquiries|action="\/favorites/);
  assert.doesNotMatch(r.text, /marker=|mlat=/);
});
test('directory category and pagination are enforced and advanced owner filters are not falsely claimed', async () => {
  const r = await guest.get('/directory/rajanukunte?category=Women');
  assert.equal(r.status, 200);
  assert.match(r.text, /Lifestyle PG/);
  assert.doesNotMatch(r.text, /Zolo Hercules/);
  const second = await guest.get('/directory/rajanukunte?page=3');
  assert.match(second.text, /No directory entries on this page/);
  assert.doesNotMatch(second.text, /Zolo Hercules/);
  const search = await guest.get('/listings?area=Rajanukunte&minRent=5000&maxRent=15000&category=Women');
  assert.equal(search.status, 200);
  assert.match(search.text, /Budget, sharing, meals and amenity filters apply to owner-listed PGs below/);
  assert.match(search.text, /Lifestyle PG/);
  assert.doesNotMatch(search.text, /Zolo Hercules/);
  assert.doesNotMatch((await guest.get('/listings?area=Yelahanka')).text, /directory-preview-title/);
  assert.equal((await guest.get('/directory/rajanukunte?category%5B%24ne%5D=Men')).status, 200);
});
test('students can save and remove directory PGs without exposing hidden entries', async () => {
  const entry = await Entry.findOne({ slug: 'mars-pg-men' });
  const action = '/favorites/directory/' + entry.id;
  assert.match((await guest.get('/directory/rajanukunte')).text, /Log in to save/);
  assert.match((await student.get('/directory/rajanukunte?q=Mars')).text, /Save Mars PG for Men/);
  assert.equal((await student.post(action).type('form').send({ action: 'add' })).status, 403);
  const added = await post(student, action, { action: 'add', returnTo: '/directory/rajanukunte' });
  assert.equal(added.headers.location, '/directory/rajanukunte');
  const saved = await student.post(action).set('Accept', 'application/json').type('form').send({
    _csrf: await token(student), action: 'add',
  });
  assert.deepEqual(saved.body, { saved: true });
  const savedPage = await student.get('/favorites');
  assert.match(savedPage.text, /Saved directory PGs/);
  assert.equal((savedPage.text.match(/Remove Mars PG for Men from saved PGs/g) || []).length, 1);
  assert.doesNotMatch((await owner.get('/favorites')).text, /Mars PG for Men/);
  await Entry.updateOne({ _id: entry._id }, { $set: { hidden: true } });
  try {
    const hiddenPage = await student.get('/favorites');
    assert.doesNotMatch(hiddenPage.text, /Mars PG for Men/);
    assert.match(hiddenPage.text, /Unavailable directory PG/);
    assert.equal((await post(student, action, { action: 'add' })).status, 404);
    const removed = await student.post(action).set('Accept', 'application/json').type('form').send({
      _csrf: await token(student), action: 'remove',
    });
    assert.deepEqual(removed.body, { saved: false });
  } finally {
    await Entry.updateOne({ _id: entry._id }, { $set: { hidden: false } });
  }
  assert.doesNotMatch((await student.get('/favorites')).text, /Unavailable directory PG|Mars PG for Men/);
});
test('map locations require both review and consent and invalid coordinates never become pins', () => {
  const listing = { locality: 'Rajanukunte', coordinates: { latitude: 13.17, longitude: 77.56, verified: true, publicationAuthorized: true } };
  assert.equal(maps(listing).exact, true);
  assert.equal(new URL(maps(listing).url).searchParams.get('query'), '13.17,77.56');
  listing.coordinates.publicationAuthorized = false;
  assert.equal(maps(listing).exact, false);
  assert.doesNotMatch(maps(listing).url, /13.17/);
  assert.equal(new URL(maps(listing).url).searchParams.get('query'), 'Rajanukunte, Bengaluru, Karnataka');
  listing.coordinates.publicationAuthorized = true;
  listing.coordinates.verified = false;
  assert.equal(maps(listing).exact, false);
  listing.coordinates.verified = true;
  listing.coordinates.latitude = 91;
  assert.equal(maps(listing).exact, false);
});
test('directory references reject executable links and misleading source hosts', () => {
  for (const url of ['javascript:alert(1)', 'https://www.magicbricks.com.evil.invalid/', 'https://user@www.magicbricks.com/', 'http://www.magicbricks.com/']) {
    assert.ok(new Entry({ ...catalog[0], sourceUrl: url }).validateSync());
  }
  for (const row of catalog) assert.equal(new Entry(row).validateSync(), undefined);
  for (const url of ['javascript:alert(1)', 'https://www.google.com.evil.invalid/maps/search/?api=1&query=test', 'https://goo.gl/unrelated']) {
    assert.ok(new Entry({ ...catalog[0], sourceMapUrl: url }).validateSync());
  }
});
test('only admins can moderate directory entries and CSRF is required', async () => {
  const url = '/admin/directory/albury-house/visibility';
  assert.equal((await guest.get('/admin/directory')).status, 302);
  for (const agent of [owner, student]) {
    assert.equal((await agent.get('/admin/directory')).status, 403);
    assert.equal((await post(agent, url, { action: 'hide', reason: 'Not an authorized admin' })).status, 403);
  }
  assert.equal((await admin.post(url).type('form').send({ action: 'hide', reason: 'Missing CSRF test' })).status, 403);
  assert.equal((await admin.get('/admin/directory')).status, 200);
  assert.equal((await post(admin, url, { action: 'hide', reason: 'short' })).status, 400);
  assert.equal((await Entry.findOne({ slug: 'albury-house' })).hidden, false);
});
test('admin hide removes entries immediately, imports preserve moderation, and restore is audited', async () => {
  const url = '/admin/directory/albury-house/visibility';
  assert.equal((await post(admin, url, { action: 'hide', reason: 'Source needs a fresh review' })).status, 302);
  assert.doesNotMatch((await guest.get('/directory/rajanukunte')).text, /Albury House/);
  await directory.sync({ apply: true });
  assert.equal((await Entry.findOne({ slug: 'albury-house' })).hidden, true);
  assert.doesNotMatch((await guest.get('/directory/rajanukunte')).text, /Albury House/);
  assert.equal((await post(admin, url, { action: 'show', reason: 'Public source checked again' })).status, 302);
  assert.match((await guest.get('/directory/rajanukunte')).text, /Albury House/);
  assert.equal(await Event.countDocuments({ action: 'directory.visibility' }), 2);
});

test('directory search escapes operators, shows sourced details and cannot restore excluded localities', async () => {
  const found = await guest.get('/directory/rajanukunte?q=Mars');
  assert.match(found.text, /Mars PG for Men/);
  assert.match(found.text, /tel:\+919606188717/);
  assert.doesNotMatch(found.text, /Lifestyle PG/);
  assert.match((await guest.get('/directory/rajanukunte?q=%2E%2A')).text, /0 directory entries/);
  assert.match((await guest.get('/directory/rajanukunte?q=Albury')).text, /Not a confirmed quote/);
  assert.equal((await post(admin, '/admin/directory/zolo-hercules/visibility', { action: 'show', reason: 'Attempt to restore an excluded locality' })).status, 400);
  assert.equal((await guest.get('/directory/rajanukunte?q%5B%24ne%5D=x')).status, 200);
});

test('Rajanukunte scope follows approved snapshots, preserves legacy records and blocks outside submissions', async () => {
  const publication = require('../lib/publication');
  const { parse } = require('../lib/input');
  const ownerAccount = await User.findOne({ role: 'owner' });
  const common = { ownerId: ownerAccount._id, listingStatus: 'published', publicationPolicyVersion: publication.POLICY_VERSION };
  const outside = await Listing.create({ ...common, name: 'TEST ONLY outside legacy', locality: 'Yelahanka' });
  const pendingOutside = await Listing.create({ ...common, name: 'TEST ONLY pending outside', locality: 'Rajanukunte', publicSnapshot: { name: 'TEST ONLY approved outside', locality: 'Rajajinagar', listingStatus: 'published', publicationPolicyVersion: publication.POLICY_VERSION } });
  const pendingInside = await Listing.create({ ...common, name: 'TEST ONLY changed private name', locality: 'Yelahanka', publicSnapshot: { name: 'TEST ONLY approved Rajanukunte', locality: 'Rajanukunte', listingStatus: 'published', publicationPolicyVersion: publication.POLICY_VERSION } });
  assert.equal(publication.live(outside), false);
  assert.equal(publication.live(pendingOutside), false);
  assert.ok(publication.live(pendingInside));
  for (const l of [outside, pendingOutside]) {
    assert.equal(await publication.getPublic(l._id), null);
    assert.equal((await guest.get('/listings/' + l._id)).status, 404);
    assert.equal((await admin.get('/admin/' + l._id)).status, 200);
    assert.equal((await owner.get('/owner/' + l._id + '/edit')).status, 200);
  }
  assert.equal((await publication.getPublic(pendingInside._id)).name, 'TEST ONLY approved Rajanukunte');
  const home = await guest.get('/');
  assert.doesNotMatch(home.text, /TEST ONLY outside legacy|TEST ONLY approved outside|TEST ONLY changed private name/);
  assert.match(home.text, /TEST ONLY approved Rajanukunte/);
  assert.doesNotMatch(home.text, /area=Yelahanka|area=Rajajinagar/);
  const form = await owner.get('/owner/new');
  assert.doesNotMatch(form.text, /<option[^>]*>Yelahanka|<option[^>]*>Rajajinagar/);
  assert.throws(() => parse({ locality: 'Yelahanka' }), { status: 400 });
  assert.equal((await Listing.findById(outside._id)).locality, 'Yelahanka');
  const outsideSearch = await guest.get('/listings?area=Yelahanka');
  assert.match(outsideSearch.text, /covers Rajanukunte only/);
  assert.doesNotMatch(outsideSearch.text, /href="\/listings\?area=(Yelahanka|Rajajinagar)/);
});

test('scope migration is non-deleting, preserves moderation and is idempotent', async () => {
  const area = require('../lib/service-area');
  const beforeCount = await Listing.countDocuments();
  const plan = await area.review();
  assert.equal(plan.listings.length, 2);
  assert.equal(plan.directory.length, catalog.length - activeCatalog.length);
  assert.equal((await Listing.findById(plan.listings[0]._id)).publicHidden, false);
  const result = await area.apply(plan);
  assert.equal(result.listingsHidden, 2);
  assert.equal(result.entriesHidden, 7);
  await directory.sync({ apply: true });
  assert.equal(await Listing.countDocuments(), beforeCount);
  assert.equal(await Entry.countDocuments(), catalog.length);
  assert.equal((await directory.search('')).total, activeCatalog.length);
  assert.equal((await Entry.findOne({ slug: 'zolo-hercules' })).hidden, true);
  assert.deepEqual(await area.apply(await area.review()), { listingsHidden: 0, entriesHidden: 0 });
});
