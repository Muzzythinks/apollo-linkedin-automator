'use strict';

require('dotenv').config({ quiet: true });

const express = require('express');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runTasks, fetchLinkedInTasks, fetchTaskDetail, updateTaskMessage, markTaskDone, loadProgress, saveProgress, loadDailyCounts } = require('./lib/runner');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');
const PROFILE_SAVED_FLAG = path.join(PROFILE_DIR, '.saved');
const PROGRESS_PATH = path.join(__dirname, 'progress.json');
const DAILY_PATH = path.join(__dirname, 'daily-counts.json');
const PORT = 3000;

function getApiKey() {
  const key = process.env.APOLLO_API_KEY;
  if (!key || key === 'YOUR_APOLLO_API_KEY_HERE') throw new Error('Set APOLLO_API_KEY in your .env file.');
  return key;
}

function hasSession() {
  return fs.existsSync(PROFILE_SAVED_FLAG);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();
wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.send(JSON.stringify({ type: 'status', running: runState.running, stats: runState.stats, hasSession: hasSession() }));
  ws.send(JSON.stringify({ type: 'daily', counts: loadDailyCounts(DAILY_PATH) }));
});

function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

const runState = {
  running: false,
  stopRequested: false,
  stats: { sent: 0, skipped: 0, failed: 0, total: 0 },
};

// Shared persistent browser context — stays open across Connect + Run so the user
// can watch the LinkedIn actions happen in the same window they logged in with.
const browserState = { context: null, launching: null };

function prepProfileForLaunch(dir) {
  // Chromium writes SingletonLock/Cookie/Socket to prevent two instances sharing
  // a profile. If the previous run crashed or was killed, these linger and block
  // the next launch. Safe to remove since we own this profile.
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(dir, name), { force: true }); } catch {}
  }
  // Chrome also shows a "Something went wrong" crash-recovery banner when it
  // sees exit_type != 'Normal' in Default/Preferences. Force it clean.
  const prefsPath = path.join(dir, 'Default', 'Preferences');
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    if (!prefs.profile) prefs.profile = {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {}
}

async function getBrowser() {
  if (browserState.context) return browserState.context;
  if (browserState.launching) return browserState.launching;
  prepProfileForLaunch(PROFILE_DIR);
  browserState.launching = chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: null,
  }).then(ctx => {
    browserState.context = ctx;
    browserState.launching = null;
    ctx.on('close', () => {
      browserState.context = null;
      broadcast({ type: 'setup', phase: 'idle' });
    });
    return ctx;
  }).catch(err => {
    browserState.launching = null;
    throw err;
  });
  return browserState.launching;
}

app.post('/api/setup-session', async (req, res) => {
  try {
    const context = await getBrowser();
    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront().catch(() => {});
    await page.goto('https://app.apollo.io/#/login').catch(() => {});
    broadcast({ type: 'setup', phase: 'open' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/setup-session/save', async (req, res) => {
  try {
    fs.writeFileSync(PROFILE_SAVED_FLAG, '');
    broadcast({ type: 'setup', phase: 'saved' });
    broadcast({ type: 'status', running: runState.running, stats: runState.stats, hasSession: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/setup-session/cancel', async (req, res) => {
  if (browserState.context) {
    await browserState.context.close().catch(() => {});
    browserState.context = null;
  }
  broadcast({ type: 'setup', phase: 'idle' });
  res.json({ ok: true });
});

app.get('/api/tasks', async (req, res) => {
  try {
    const { tasks, total } = await fetchLinkedInTasks(getApiKey(), 1, 100);
    res.json({ tasks, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ running: runState.running, stats: runState.stats, hasSession: hasSession() });
});

app.get('/api/daily', (req, res) => {
  res.json(loadDailyCounts(DAILY_PATH));
});

function startRun({ maxActions, dryRun, maxDailyConnects, maxDailyMessages, specificTasks }) {
  runState.running = true;
  runState.stopRequested = false;
  runState.stats = { sent: 0, skipped: 0, failed: 0, total: 0 };
  broadcast({ type: 'status', running: true, stats: runState.stats, hasSession: hasSession() });

  getBrowser()
    .then(context => runTasks({
      apiKey: getApiKey(),
      context,
      progressPath: PROGRESS_PATH,
      dailyCountsPath: DAILY_PATH,
      maxActions,
      maxDailyConnects,
      maxDailyMessages,
      dryRun,
      specificTasks: specificTasks || null,
      onEvent: evt => {
        broadcast(evt);
        if (evt.type === 'stats') runState.stats = { sent: evt.sent, skipped: evt.skipped, failed: evt.failed, total: evt.total };
        if (evt.type === 'done') runState.stats = { sent: evt.sent, skipped: evt.skipped, failed: evt.failed, total: evt.total };
      },
      shouldStop: () => runState.stopRequested,
    }))
    .catch(err => broadcast({ type: 'log', message: `Fatal: ${err.message}` }))
    .finally(() => {
      runState.running = false;
      runState.stopRequested = false;
      broadcast({ type: 'status', running: false, stats: runState.stats, hasSession: hasSession() });
    });
}

app.post('/api/run', (req, res) => {
  if (runState.running) return res.status(409).json({ error: 'Already running' });
  if (!hasSession()) return res.status(400).json({ error: 'No session. Use Connect to log in first.' });

  startRun({
    maxActions: parseInt(req.body.maxActions ?? 30, 10),
    dryRun: !!req.body.dryRun,
    maxDailyConnects: parseInt(req.body.maxDailyConnects ?? 30, 10),
    maxDailyMessages: parseInt(req.body.maxDailyMessages ?? 50, 10),
  });
  res.json({ ok: true });
});

app.post('/api/run-task', (req, res) => {
  if (runState.running) return res.status(409).json({ error: 'Already running' });
  if (!hasSession()) return res.status(400).json({ error: 'No session. Use Connect to log in first.' });
  if (!req.body.task) return res.status(400).json({ error: 'task required' });

  startRun({
    maxActions: 1,
    dryRun: !!req.body.dryRun,
    maxDailyConnects: parseInt(req.body.maxDailyConnects ?? 30, 10),
    maxDailyMessages: parseInt(req.body.maxDailyMessages ?? 50, 10),
    specificTasks: [req.body.task],
  });
  res.json({ ok: true });
});

app.get('/api/task-message/:id', async (req, res) => {
  try {
    const context = await getBrowser();
    const detail = await fetchTaskDetail(context, req.params.id);
    const body = detail.linkedin_emailer_template?.body_text
      || detail.standalone_outreach_task_message?.body_text
      || '';
    res.json({ body, contact: detail.contact?.name || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/task-message/:id', async (req, res) => {
  const body = req.body?.body;
  if (typeof body !== 'string') return res.status(400).json({ error: 'body (string) required' });
  try {
    const context = await getBrowser();
    await updateTaskMessage(context, req.params.id, body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mark-done', async (req, res) => {
  const taskId = req.body.taskId;
  const userId = req.body.userId;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const completed = loadProgress(PROGRESS_PATH);
    completed.add(taskId);
    saveProgress(PROGRESS_PATH, completed);
    const context = await getBrowser();
    await markTaskDone(context, { id: taskId, user_id: userId }, false, evt => broadcast(evt));
    broadcast({ type: 'task_removed', taskId });
    res.json({ ok: true });
  } catch (err) {
    broadcast({ type: 'log', message: `Mark-done failed: ${err.message}` });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stop', (req, res) => {
  if (!runState.running) return res.status(400).json({ error: 'Not running' });
  runState.stopRequested = true;
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`Dashboard at http://localhost:${PORT}`);
});
