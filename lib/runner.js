'use strict';

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');
const path = require('path');

const MIN_DELAY_MS = 12_000;
const MAX_DELAY_MS = 18_000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function prepProfileForLaunch(dir) {
  // Remove stale SingletonLock/Cookie/Socket left by crashed prior runs, and
  // reset Chrome's exit_type so it doesn't show the "Something went wrong"
  // crash-recovery banner on every launch.
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(dir, name), { force: true }); } catch {}
  }
  const prefsPath = path.join(dir, 'Default', 'Preferences');
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    if (!prefs.profile) prefs.profile = {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {}
}

function randomDelay(emit) {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  emit({ type: 'log', message: `  Waiting ${Math.round(ms / 1000)}s before next action...` });
  return sleep(ms);
}

function apolloPost(apiKey, urlPath, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ api_key: apiKey, ...body });
    const req = https.request(
      {
        hostname: 'api.apollo.io',
        path: `/api/v1${urlPath}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          const status = res.statusCode;
          let parsed;
          try { parsed = data ? JSON.parse(data) : {}; }
          catch {
            return reject(new Error(`${urlPath} returned ${status} non-JSON: ${data.slice(0, 200)}`));
          }
          if (status >= 400) return reject(new Error(`${urlPath} returned ${status}: ${JSON.stringify(parsed).slice(0, 200)}`));
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function fetchLinkedInTasks(apiKey, page = 1, perPage = 50) {
  const data = await apolloPost(apiKey, '/tasks/search', {
    task_type_cds: ['linkedin_actions'],
    open_factor_names: ['task_types'],
    linkedin_task: 'all_linkedin_tasks',
    multi_sort: [{ task_due_at: { order: 'asc' } }],
    page,
    per_page: perPage,
  });
  return {
    tasks: data.tasks || [],
    total: data.pagination?.total_entries ?? 0,
  };
}

// Apollo's mark-complete is an internal endpoint on app.apollo.io. The SPA
// sends CSRF/origin headers that context.request.post doesn't replicate (400
// "Invalid request"), so run the fetch from inside an Apollo page — the
// browser handles all the auth headers natively.
// Endpoint + body shape discovered via sniff-api.js.
async function markTaskDone(context, taskId, dryRun, emit) {
  if (dryRun) { emit({ type: 'log', message: `  [dry-run] Would mark task ${taskId} done` }); return; }

  let apolloPage = context.pages().find(p => p.url().includes('app.apollo.io'));
  let openedPage = false;
  if (!apolloPage) {
    apolloPage = await context.newPage();
    await apolloPage.goto('https://app.apollo.io/#/tasks', { waitUntil: 'domcontentloaded', timeout: 20000 });
    openedPage = true;
  }

  const result = await apolloPage.evaluate(async id => {
    const res = await fetch('/api/v1/tasks/bulk_execute_and_complete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], execute: false, schedule_emails: false, cacheKey: Date.now() }),
    });
    return { status: res.status, body: await res.text().catch(() => '') };
  }, taskId);

  if (openedPage) await apolloPage.close().catch(() => {});

  if (result.status >= 400) {
    throw new Error(`bulk_execute_and_complete ${result.status}: ${result.body.slice(0, 200)}`);
  }
  let parsed = {};
  try { parsed = JSON.parse(result.body); } catch {}
  const completed = Array.isArray(parsed.tasks) && parsed.tasks.some(t => t.id === taskId);
  if (completed) {
    emit({ type: 'log', message: '  Marked done in Apollo.' });
  } else {
    emit({ type: 'log', message: `  Marked done in Apollo (response: ${result.body.slice(0, 120)})` });
  }
}

async function humanScroll(page) {
  const scrolls = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < scrolls; i++) {
    const dist = 200 + Math.floor(Math.random() * 400);
    await page.mouse.wheel(0, dist);
    await sleep(600 + Math.random() * 800);
  }
  await sleep(500 + Math.random() * 500);
}

async function isNotFound(page) {
  const url = page.url();
  return url.includes('/404') || url.includes('linkedin.com/404');
}

async function findConnectButton(page) {
  let btn = page.locator('main button:has-text("Connect")').first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) return btn;

  const moreBtn = page.locator(
    'button[aria-label="More actions"], main button:has-text("More")'
  ).first();

  if (await moreBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await moreBtn.click();
    await sleep(800);

    btn = page.getByRole('listitem').filter({ hasText: /^Connect$/ }).first();
    if (!await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      btn = page.locator('.artdeco-dropdown__content').getByText('Connect', { exact: true }).first();
    }

    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) return btn;

    await page.keyboard.press('Escape');
    await sleep(400);
    return 'already_connected';
  }

  const msgBtn = page.locator('main button:has-text("Message")').first();
  if (await msgBtn.isVisible({ timeout: 1500 }).catch(() => false)) return 'already_connected';

  return null;
}

async function sendConnectRequest(page, linkedinUrl, note, dryRun, emit) {
  await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2000 + Math.random() * 2000);

  if (await isNotFound(page)) {
    emit({ type: 'log', message: '  404 - profile not found, skipping.' });
    return 'not_found';
  }

  await humanScroll(page);

  const pendingBtn = page.locator('button:has-text("Pending"), button[aria-label*="Pending"]').first();
  if (await pendingBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    emit({ type: 'log', message: '  Connection already pending, skipping.' });
    return 'not_found';
  }

  const connectBtn = await findConnectButton(page);
  if (connectBtn === 'already_connected') {
    emit({ type: 'log', message: '  Already connected - marking done.' });
    return 'already_connected';
  }
  if (!connectBtn) {
    emit({ type: 'log', message: '  Connect button not found. Screenshot saved to debug-last.png.' });
    await page.screenshot({ path: path.join(__dirname, '..', 'debug-last.png') });
    return false;
  }

  await connectBtn.click();
  await sleep(1500);

  if (dryRun) {
    await page.screenshot({ path: path.join(__dirname, '..', 'debug-after-connect.png') });
    emit({ type: 'log', message: '  [dry-run] Clicked Connect. Modal screenshot: debug-after-connect.png' });
    await page.keyboard.press('Escape');
    return true;
  }

  const modal = page.locator('[role="dialog"]').first();
  await modal.waitFor({ timeout: 5000 }).catch(() => {});

  const howKnowBtn = page.locator('[role="dialog"] button:has-text("Other"), [role="dialog"] button:has-text("Colleague")').first();
  if (await howKnowBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await howKnowBtn.click();
    await sleep(800);
  }

  let noteAdded = false;
  if (note) {
    const addNoteBtn = page.getByRole('button', { name: /add a note/i });
    if (await addNoteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addNoteBtn.click();
      await sleep(500);
      await page.locator('textarea[name="message"]').fill(note);
      await sleep(400);
      noteAdded = true;
    }
  }

  // After adding a note the modal swaps "Send without a note" for a plain "Send" button
  let sendBtn;
  if (noteAdded) {
    sendBtn = page.locator('[role="dialog"] button').filter({ hasText: /^send$/i }).first();
    if (!await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      sendBtn = page.getByRole('button', { name: /send now/i }).first();
    }
    if (!await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      sendBtn = page.locator('[role="dialog"] button').filter({ hasText: /send/i }).first();
    }
  } else {
    sendBtn = page.getByRole('button', { name: /send without a note/i }).first();
    if (!await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      sendBtn = page.getByRole('button', { name: /send now/i }).first();
    }
    if (!await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      sendBtn = page.locator('[role="dialog"] button').filter({ hasText: /send/i }).first();
    }
  }

  if (!await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.screenshot({ path: path.join(__dirname, '..', 'debug-modal.png') });
    emit({ type: 'log', message: '  Send button not found. Screenshot: debug-modal.png' });
    await page.keyboard.press('Escape');
    return false;
  }

  await sendBtn.click();
  await sleep(1000);
  emit({ type: 'log', message: '  Connection request sent.' });
  return true;
}

async function sendMessage(page, linkedinUrl, message, dryRun, emit) {
  await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2000 + Math.random() * 2000);

  if (await isNotFound(page)) {
    emit({ type: 'log', message: '  404 - profile not found, skipping.' });
    return 'not_found';
  }

  await humanScroll(page);

  const msgBtn = page.locator('button:has-text("Message")').first();
  if (!await msgBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    emit({ type: 'log', message: '  Message button not found - may not be connected yet.' });
    return false;
  }

  await msgBtn.click();
  await sleep(1500);

  const msgBox = page.locator('.msg-form__contenteditable, div[contenteditable="true"][role="textbox"]').first();
  await msgBox.waitFor({ timeout: 5000 });
  await msgBox.fill(message);
  await sleep(500);

  if (dryRun) {
    emit({ type: 'log', message: `  [dry-run] Would send message: "${message.slice(0, 60)}"` });
    await page.keyboard.press('Escape');
    return true;
  }

  // Prefer clicking the Send button; fall back to keyboard shortcut
  const sendMsgBtn = page.locator('button[aria-label="Send"], .msg-form__send-button, button.msg-form__send-btn').first();
  if (await sendMsgBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sendMsgBtn.click();
  } else {
    await page.keyboard.press('Meta+Enter');
  }
  await sleep(1000);
  emit({ type: 'log', message: '  Message sent.' });
  return true;
}

function loadProgress(progressPath) {
  try { return new Set(JSON.parse(fs.readFileSync(progressPath, 'utf8'))); }
  catch { return new Set(); }
}

function saveProgress(progressPath, completedIds) {
  fs.writeFileSync(progressPath, JSON.stringify([...completedIds]), 'utf8');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadDailyCounts(dailyPath) {
  try {
    const data = JSON.parse(fs.readFileSync(dailyPath, 'utf8'));
    if (data.date === todayStr()) return data;
  } catch {}
  return { date: todayStr(), connects: 0, messages: 0 };
}

function saveDailyCounts(dailyPath, counts) {
  fs.writeFileSync(dailyPath, JSON.stringify(counts), 'utf8');
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.profileDir]  - persistent Chromium profile dir (used only if no context provided)
 * @param {import('playwright').BrowserContext} [opts.context]  - existing browser context to reuse
 * @param {string} opts.progressPath
 * @param {string} opts.dailyCountsPath
 * @param {number} opts.maxActions
 * @param {number} opts.maxDailyConnects
 * @param {number} opts.maxDailyMessages
 * @param {boolean} opts.dryRun
 * @param {object[]|null} opts.specificTasks  - if set, skips fetch and runs only these tasks
 * @param {function} opts.onEvent
 * @param {function} opts.shouldStop
 */
async function runTasks({ apiKey, profileDir, context: providedContext, progressPath, dailyCountsPath, maxActions = 30,
  maxDailyConnects = 30, maxDailyMessages = 50, dryRun = false, specificTasks = null, onEvent, shouldStop }) {
  const emit = onEvent;

  emit({ type: 'log', message: `Apollo LinkedIn Task Executor${dryRun ? ' [DRY RUN]' : ''}` });

  let pending;

  if (specificTasks) {
    pending = specificTasks;
    emit({ type: 'log', message: `Running ${pending.length} specific task(s).` });
  } else {
    emit({ type: 'log', message: `Max actions this run: ${maxActions}` });
    emit({ type: 'log', message: 'Fetching LinkedIn tasks from Apollo...' });

    const { tasks: allTasks, total } = await fetchLinkedInTasks(apiKey, 1, maxActions);
    emit({ type: 'log', message: `${total} total LinkedIn tasks pending. Processing up to ${Math.min(total, maxActions)}.` });

    if (allTasks.length === 0) {
      emit({ type: 'log', message: 'No LinkedIn tasks found.' });
      emit({ type: 'done', sent: 0, skipped: 0, failed: 0, total: 0 });
      return;
    }

    const completed = loadProgress(progressPath);
    pending = allTasks.filter(t => !completed.has(t.id));
    const skippedCount = allTasks.length - pending.length;
    if (skippedCount > 0) emit({ type: 'log', message: `Skipping ${skippedCount} already completed (from progress.json).` });
  }

  // For specific-task runs, the dashboard queue already shows the row; don't
  // wipe the full list and replace it with just this one task.
  if (!specificTasks) emit({ type: 'tasks', tasks: pending });

  if (pending.length === 0) {
    emit({ type: 'log', message: 'All tasks already completed.' });
    emit({ type: 'done', sent: 0, skipped: 0, failed: 0, total: 0 });
    return;
  }

  // Emit current daily counts so UI can show them immediately
  if (dailyCountsPath) emit({ type: 'daily', counts: loadDailyCounts(dailyCountsPath) });

  let context = providedContext;
  const ownContext = !context;
  if (ownContext) {
    prepProfileForLaunch(profileDir);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: 'chrome',
      viewport: null,
    });
  }
  const page = await context.newPage();

  let sent = 0;
  let failed = 0;
  let notFound = 0;

  // Load progress set for marking done (needed even in specificTasks mode)
  const completed = loadProgress(progressPath);

  try {
    for (let i = 0; i < pending.length; i++) {
      if (shouldStop && shouldStop()) {
        emit({ type: 'log', message: 'Stop requested. Halting after current task.' });
        break;
      }

      const task = pending[i];
      const contact = task.contact || {};
      const linkedinUrl = contact.linkedin_url;
      const note = task.note || '';
      const taskIndex = i + 1;

      // Check daily limits
      if (dailyCountsPath && !dryRun) {
        const daily = loadDailyCounts(dailyCountsPath);
        if (task.type === 'linkedin_step_connect' && daily.connects >= maxDailyConnects) {
          emit({ type: 'log', message: `  Daily connect limit (${maxDailyConnects}) reached — stopping.` });
          break;
        }
        if (task.type === 'linkedin_step_message' && daily.messages >= maxDailyMessages) {
          emit({ type: 'log', message: `  Daily message limit (${maxDailyMessages}) reached — stopping.` });
          break;
        }
      }

      emit({ type: 'task_start', index: taskIndex, total: pending.length, taskId: task.id, task });
      emit({ type: 'log', message: `\n[${taskIndex}/${pending.length}] ${task.type.replace('linkedin_step_', '').toUpperCase()} — ${contact.name || task.contact_id}` });
      emit({ type: 'log', message: `  ${linkedinUrl}` });

      if (!linkedinUrl) {
        emit({ type: 'log', message: '  No LinkedIn URL, skipping.' });
        emit({ type: 'task_done', index: taskIndex, taskId: task.id, outcome: 'failed' });
        failed++;
        continue;
      }

      let result = false;
      try {
        if (task.type === 'linkedin_step_connect') {
          result = await sendConnectRequest(page, linkedinUrl, note, dryRun, emit);
        } else if (task.type === 'linkedin_step_message') {
          result = await sendMessage(page, linkedinUrl, note, dryRun, emit);
        } else {
          emit({ type: 'log', message: `  Unknown task type: ${task.type}, skipping.` });
          emit({ type: 'task_done', index: taskIndex, taskId: task.id, outcome: 'failed' });
          failed++;
          continue;
        }

        if (result === 'not_found') {
          notFound++;
          emit({ type: 'task_done', index: taskIndex, taskId: task.id, outcome: 'skipped' });
        } else if (result === 'already_connected' || result) {
          // Save local progress FIRST — the LinkedIn action is already done, we must not lose it
          // even if the Apollo API call to mark-done throws.
          if (!dryRun) {
            completed.add(task.id);
            saveProgress(progressPath, completed);
            if (dailyCountsPath) {
              const daily = loadDailyCounts(dailyCountsPath);
              if (task.type === 'linkedin_step_connect') daily.connects++;
              if (task.type === 'linkedin_step_message') daily.messages++;
              saveDailyCounts(dailyCountsPath, daily);
              emit({ type: 'daily', counts: daily });
            }
          }
          try {
            await markTaskDone(context, task.id, dryRun, emit);
          } catch (err) {
            emit({ type: 'log', message: `  Failed to mark done in Apollo: ${err.message}` });
          }
          sent++;
          emit({ type: 'task_done', index: taskIndex, taskId: task.id, outcome: result === 'already_connected' ? 'already_connected' : 'sent' });
        } else {
          failed++;
          emit({ type: 'task_done', index: taskIndex, taskId: task.id, outcome: 'failed' });
        }
      } catch (err) {
        emit({ type: 'log', message: `  Error: ${err.message}` });
        emit({ type: 'task_done', index: taskIndex, taskId: task.id, outcome: 'failed' });
        failed++;
      }

      emit({ type: 'stats', sent, skipped: notFound, failed, total: pending.length });

      const isLast = i === pending.length - 1;
      const stopRequested = shouldStop && shouldStop();
      if (!isLast && !stopRequested) {
        if (result === 'not_found' || result === 'already_connected') {
          const ms = 3000 + Math.random() * 2000;
          emit({ type: 'log', message: `  Waiting ${Math.round(ms / 1000)}s...` });
          await sleep(ms);
        } else {
          await randomDelay(emit);
        }
      }
    }
  } finally {
    await sleep(2000);
    if (ownContext) {
      await context.close();
    } else {
      await page.close().catch(() => {});
    }
  }

  emit({ type: 'log', message: `\nFinished. ${sent} sent, ${notFound} skipped (404/pending), ${failed} failed.` });
  emit({ type: 'done', sent, skipped: notFound, failed, total: pending.length });
}

module.exports = { runTasks, fetchLinkedInTasks, markTaskDone, loadProgress, saveProgress, loadDailyCounts, saveDailyCounts };
