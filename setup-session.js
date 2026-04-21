#!/usr/bin/env node
/**
 * One-time setup: opens a persistent Chromium profile and lets you log in
 * to Apollo + LinkedIn manually. The profile is reused on every subsequent run
 * so you only have to log in once.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function run() {
  const profileDir = path.join(__dirname, 'chrome-profile');
  console.log(`Launching persistent browser profile at ${profileDir}...`);

  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(profileDir, name), { force: true }); } catch {}
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://app.apollo.io/#/login');

  console.log('\nLog in to Apollo in the browser window.');
  console.log('Then open a new tab and log in to LinkedIn.');
  console.log('\nWhen both are logged in, come back here and press Enter...');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('', () => { rl.close(); resolve(); }));

  fs.writeFileSync(path.join(profileDir, '.saved'), '');
  await context.close();
  console.log('Profile saved. Run: node linkedin-tasks.js --dry-run');
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
