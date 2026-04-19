#!/usr/bin/env node
/**
 * One-time setup: opens a browser, you log in to Apollo + LinkedIn manually,
 * then press Enter and the session is saved to session.json for reuse.
 */

const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline');

async function run() {
  console.log('Launching browser for manual login...');

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext();

  const apolloPage = await context.newPage();
  await apolloPage.goto('https://app.apollo.io/#/login');

  console.log('\nLog in to Apollo in the browser window.');
  console.log('Then open a new tab and log in to LinkedIn.');
  console.log('\nWhen both are logged in, come back here and press Enter...');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('', () => { rl.close(); resolve(); }));

  const sessionPath = path.join(__dirname, 'session.json');
  await context.storageState({ path: sessionPath });
  console.log(`Session saved to ${sessionPath}`);

  await browser.close();
  console.log('Done. Run: node linkedin-tasks.js --dry-run');
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
