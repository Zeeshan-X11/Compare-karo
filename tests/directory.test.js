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
  assert.match(r.text, new RegExp(catalog.length + ' directory entries'));
  for (const entry of catalog) assert.ok(r.text.includes(entry.name));
  assert.match(r.text, /not a complete list or a live vacancy feed/);
  assert.match(r.text, /Public directory · Unverified/);
  assert.match(r.text, /Nearby · Dibbur/);
  assert.match(r.text, /www\.openstreetmap\.org\/export\/embed/);
  assert.match(r.headers['content-security-policy'], /frame-src https:\/\/www\.openstreetmap\.org/);
  assert.doesNotMatch(r.text, /name="monthlyRent"|action="\/inquiries|action="\/favorites/);
  assert.doesNotMatch(r.text, /marker=|mlat=/);
});
test('directory category and pagination are enforced and advanced owner filters are not falsely claimed', async () => {
  const r = await guest.get('/directory/rajanukunte?category=Women');
  assert.equal(r.status, 200);
  assert.match(r.text, /Lifestyle PG/);
  assert.doesNotMatch(r.text, /Zolo Hercules/);
  const second = await guest.get('/directory/rajanukunte?page=2');
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
test('map locations require both review and consent and invalid coordinates never become pins', () => {
  const listing = { locality: 'Rajanukunte', coordinates: { latitude: 13.17, longitude: 77.56, verified: true, publicationAuthorized: true } };
  assert.equal(maps(listing).exact, true);
  assert.match(maps(listing).embedUrl, /marker=13.17%2C77.56/);
  listing.coordinates.publicationAuthorized = false;
  assert.equal(maps(listing).exact, false);
  assert.doesNotMatch(maps(listing).embedUrl, /marker=|13.17%2C77.56/);
  assert.doesNotMatch(maps(listing).url, /13.17/);
  listing.coordinates.publicationAuthorized = true;
  listing.coordinates.verified = false;
  assert.equal(maps(listing).exact, false);
  listing.coordinates.verified = true;
  listing.coordinates.latitude = 91;
  assert.equal(maps(listing).exact, false);
  assert.equal(maps({ locality: 'Unmapped' }).embedUrl, null);
});
test('directory references reject executable links and misleading source hosts', () => {
  for (const url of ['javascript:alert(1)', 'https://www.magicbricks.com.evil.invalid/', 'https://user@www.magicbricks.com/', 'http://www.magicbricks.com/']) {
    assert.ok(new Entry({ ...catalog[0], sourceUrl: url }).validateSync());
  }
  for (const row of catalog) assert.equal(new Entry(row).validateSync(), undefined);
});
test('only admins can moderate directory entries and CSRF is required', async () => {
  const url = '/admin/directory/zolo-hercules/visibility';
  assert.equal((await guest.get('/admin/directory')).status, 302);
  for (const agent of [owner, student]) {
    assert.equal((await agent.get('/admin/directory')).status, 403);
    assert.equal((await post(agent, url, { action: 'hide', reason: 'Not an authorized admin' })).status, 403);
  }
  assert.equal((await admin.post(url).type('form').send({ action: 'hide', reason: 'Missing CSRF test' })).status, 403);
  assert.equal((await admin.get('/admin/directory')).status, 200);
  assert.equal((await post(admin, url, { action: 'hide', reason: 'short' })).status, 400);
  assert.equal((await Entry.findOne({ slug: 'zolo-hercules' })).hidden, false);
});
test('admin hide removes entries immediately, imports preserve moderation, and restore is audited', async () => {
  const url = '/admin/directory/zolo-hercules/visibility';
  assert.equal((await post(admin, url, { action: 'hide', reason: 'Source needs a fresh review' })).status, 302);
  assert.doesNotMatch((await guest.get('/directory/rajanukunte')).text, /Zolo Hercules/);
  await directory.sync({ apply: true });
  assert.equal((await Entry.findOne({ slug: 'zolo-hercules' })).hidden, true);
  assert.doesNotMatch((await guest.get('/directory/rajanukunte')).text, /Zolo Hercules/);
  assert.equal((await post(admin, url, { action: 'show', reason: 'Public source checked again' })).status, 302);
  assert.match((await guest.get('/directory/rajanukunte')).text, /Zolo Hercules/);
  assert.equal(await Event.countDocuments({ action: 'directory.visibility' }), 2);
});
