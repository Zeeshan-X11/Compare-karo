require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { sync } = require('../lib/directory');
(async () => {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--apply')) throw Error('Only --apply is supported.');
    const apply = args.includes('--apply');
    if (apply) {
      if (!process.env.MONGO_URL) throw Error('Set MONGO_URL for the authorized target database.');
      await mongoose.connect(process.env.MONGO_URL, { autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
      // Unique slug makes repeated imports idempotent, including concurrent runs.
      await require('../models/directory-entry').createIndexes();
    }
    console.log(JSON.stringify(await sync({ apply }), null, 2));
  } catch (error) {
    console.error('Directory import failed (' + error.name + '). Check the catalog and database configuration.');
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})();
