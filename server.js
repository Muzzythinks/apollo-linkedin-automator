'use strict';

require('dotenv').config({ quiet: true });

const express = require('express');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runTasks, fetchLinkedInTasks, loadDailyCounts } = require('./lib/runner');

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

// Session setup state — one setup flow at a time
const setupState = { context: null };

app.post('/api/setup-session', async (req, res) => {
  if (setupState.context) return res.status(409).json({ error: 'Setup already in progress' });
  try {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: 'chrome',
      viewport: null,
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://app.apollo.io/#/login');
    setupState.context = context;
    broadcast({ type: 'setup', phase: 'open' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/setup-session/save', async (req, res) => {
  if (!setupState.context) return res.status(400).json({ error: 'No setup in progress' });
  try {
    fs.writeFileSync(PROFILE_SAVED_FLAG, '');
    await setupState.context.close();
    setupState.context = null;
    broadcast({ type: 'setup', phase: 'saved' });
    broadcast({ type: 'status', running: runState.running, stats: runState.stats, hasSession: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/setup-session/cancel', async (req, res) => {
  if (setupState.context) {
    await setupState.context.close().catch(() => {});
    setupState.context = null;
  }
  broadcast({ type: 'setup', phase: 'idle' });
  res.json({ ok: true });
});

app.get('/api/tasks', async (req, res) => {
  try {
    const { tasks, total } = await fetchLinkedInTasks(getApiKey(), 1, 200);
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

  runTasks({
    apiKey: getApiKey(),
    profileDir: PROFILE_DIR,
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
  })
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

app.post('/api/stop', (req, res) => {
  if (!runState.running) return res.status(400).json({ error: 'Not running' });
  runState.stopRequested = true;
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`Dashboard at http://localhost:${PORT}`);
});
