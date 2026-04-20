#!/usr/bin/env node
/**
 * Apollo LinkedIn Task Executor — CLI
 *
 * Usage:
 *   node linkedin-tasks.js             # run up to 30 tasks
 *   node linkedin-tasks.js --max=10    # run up to 10 tasks
 *   node linkedin-tasks.js --dry-run   # preview without acting
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { runTasks } = require('./lib/runner');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');
const PROGRESS_PATH = path.join(__dirname, 'progress.json');

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
if (!APOLLO_API_KEY || APOLLO_API_KEY === 'YOUR_APOLLO_API_KEY_HERE') {
  console.error('Set APOLLO_API_KEY in your .env file.');
  process.exit(1);
}
if (!fs.existsSync(path.join(PROFILE_DIR, '.saved'))) {
  console.error('chrome-profile/ not found. Use the dashboard Connect button or run setup-session.js.');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const maxActions = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] ?? '30', 10);

runTasks({
  apiKey: APOLLO_API_KEY,
  profileDir: PROFILE_DIR,
  progressPath: PROGRESS_PATH,
  maxActions,
  dryRun,
  onEvent: evt => {
    if (evt.type === 'log') console.log(evt.message);
  },
  shouldStop: () => false,
}).catch(err => { console.error('Fatal:', err.message); process.exit(1); });
