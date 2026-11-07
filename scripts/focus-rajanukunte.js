require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const area = require('../lib/service-area');
const directory = require('../lib/directory');
const Entry = require('../models/directory-entry');
(async () => {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => a !== '--apply' && !a.startsWith('--backup-dir='))) throw Error('Unsupported argument.');
    await directory.sync(); // Entire source catalog validated before DB writes.
    if (!process.env.MONGO_URL) throw Error('An explicitly authorized MONGO_URL is required.');
    await mongoose.connect(process.env.MONGO_URL, { autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
    const plan = await area.review();
    console.log(JSON.stringify({ dryRun: !args.includes('--apply'), listingsToHide: plan.listings.length, directoryEntriesToHide: plan.directory.length }));
    if (!args.includes('--apply')) return;
    const target = args.find(a => a.startsWith('--backup-dir='))?.slice('--backup-dir='.length);
    if (!target || !path.isAbsolute(target)) throw Error('An absolute private --backup-dir is required.');
    const resolved = path.resolve(target);
    // Backups must stay outside the application/static/upload directories.
    const relative = path.relative(path.resolve(__dirname, '..'), resolved);
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw Error('Keep backups outside the application directory.');
    await fs.mkdir(resolved, { recursive: true });
    const file = path.join(resolved, 'rajanukunte-' + crypto.randomUUID() + '.ejson');
    const backup = mongoose.mongo.BSON.EJSON.stringify({ createdAt: new Date(), database: mongoose.connection.name, listings: plan.listings, directory: await Entry.find().lean() }, { relaxed: false });
    await fs.writeFile(file, backup, { flag: 'wx', mode: 0o600 });
    if ((await fs.readFile(file, 'utf8')) !== backup) throw Error('Backup read-back failed.');
    console.log('Visibility and directory backup verified: ' + file);
    console.log(JSON.stringify(await area.apply(plan)));
    await Entry.createIndexes();
    console.log(JSON.stringify(await directory.sync({ apply: true })));
  } catch (error) {
    console.error('Rajanukunte update stopped (' + error.name + '). Check authorized database access, arguments and backup location. If any writes completed, preserve the backup and review before retrying.');
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})();
