const { join } = require('path');

// keep the browser inside the project dir — Render wipes ~/.cache between
// build and deploy, so the default location loses Chrome at runtime
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
