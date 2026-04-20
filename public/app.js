'use strict';

const sessionDot = document.getElementById('session-dot');
const sessionLabel = document.getElementById('session-label');
const setupIdle = document.getElementById('setup-idle');
const setupOpen = document.getElementById('setup-open');
const btnConnect = document.getElementById('btn-connect');
const btnSaveSession = document.getElementById('btn-save-session');
const btnCancelSession = document.getElementById('btn-cancel-session');

function setSessionState(phase, hasSession) {
  if (phase === 'open') {
    setupIdle.classList.add('hidden');
    setupOpen.classList.remove('hidden');
    sessionDot.className = 'w-2 h-2 rounded-full bg-yellow-400';
    sessionLabel.textContent = 'Logging in...';
  } else if (phase === 'saved' || hasSession) {
    setupIdle.classList.remove('hidden');
    setupOpen.classList.add('hidden');
    sessionDot.className = 'w-2 h-2 rounded-full bg-green-500';
    sessionLabel.textContent = 'Session active';
  } else {
    setupIdle.classList.remove('hidden');
    setupOpen.classList.add('hidden');
    sessionDot.className = 'w-2 h-2 rounded-full bg-red-500';
    sessionLabel.textContent = 'No session';
  }
}

btnConnect.addEventListener('click', async () => {
  btnConnect.disabled = true;
  btnConnect.textContent = 'Opening...';
  const res = await fetch('/api/setup-session', { method: 'POST' });
  if (!res.ok) {
    const { error } = await res.json();
    appendLog(`Setup error: ${error}`, 'text-red-400');
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect';
  }
});

btnSaveSession.addEventListener('click', async () => {
  btnSaveSession.disabled = true;
  document.getElementById('save-spinner').classList.remove('hidden');
  document.getElementById('save-btn-label').textContent = 'Saving...';
  document.getElementById('setup-instruction').textContent = 'Saving session cookies...';
  const res = await fetch('/api/setup-session/save', { method: 'POST' });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Unknown error' }));
    appendLog(`Save error: ${error}`, 'text-red-400');
    btnSaveSession.disabled = false;
    document.getElementById('save-spinner').classList.add('hidden');
    document.getElementById('save-btn-label').textContent = 'Save Session';
    document.getElementById('setup-instruction').textContent = 'Step 1: Log in to Apollo. Step 2: Open a new tab and log in to LinkedIn. Then click Save.';
  }
});

btnCancelSession.addEventListener('click', async () => {
  await fetch('/api/setup-session/cancel', { method: 'POST' });
  btnConnect.disabled = false;
  btnConnect.textContent = 'Connect';
});

const logEl = document.getElementById('log');
const queueBody = document.getElementById('queue-body');
const queueCount = document.getElementById('queue-count');
const queueEmpty = document.getElementById('queue-empty');
const statusBadge = document.getElementById('status-badge');
const statsBar = document.getElementById('stats-bar');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnRefresh = document.getElementById('btn-refresh');
const btnClearLog = document.getElementById('btn-clear-log');
const maxActionsInput = document.getElementById('max-actions');
const maxDailyConnectsInput = document.getElementById('max-daily-connects');
const maxDailyMessagesInput = document.getElementById('max-daily-messages');
const dryRunInput = document.getElementById('dry-run');
const statEls = {
  sent: document.getElementById('stat-sent'),
  skipped: document.getElementById('stat-skipped'),
  failed: document.getElementById('stat-failed'),
  total: document.getElementById('stat-total'),
};
const dailyEls = {
  connects: document.getElementById('daily-connects'),
  connectsBar: document.getElementById('daily-connects-bar'),
  connectsLimit: document.getElementById('daily-connects-limit'),
  messages: document.getElementById('daily-messages'),
  messagesBar: document.getElementById('daily-messages-bar'),
  messagesLimit: document.getElementById('daily-messages-limit'),
};

let logPaused = false;
logEl.addEventListener('mouseenter', () => { logPaused = true; });
logEl.addEventListener('mouseleave', () => { logPaused = false; autoScroll(); });

function autoScroll() {
  if (!logPaused) logEl.scrollTop = logEl.scrollHeight;
}

function appendLog(text, color = 'text-gray-400') {
  const line = document.createElement('div');
  line.className = color;
  line.textContent = text;
  logEl.appendChild(line);
  autoScroll();
}

function logColor(message) {
  const m = message.toLowerCase();
  if (m.includes('connection request sent') || m.includes('message sent') || m.includes('marked done')) return 'text-green-400';
  if (m.includes('skipping') || m.includes('already') || m.includes('pending') || m.includes('404')) return 'text-yellow-400';
  if (m.includes('error') || m.includes('fatal') || m.includes('not found') || m.includes('failed')) return 'text-red-400';
  if (m.includes('dry-run')) return 'text-indigo-400';
  if (m.includes('limit reached') || m.includes('limit (')) return 'text-orange-400';
  return 'text-gray-400';
}

function setRunning(running) {
  const allRowBtns = queueBody.querySelectorAll('button.run-task-btn, button.done-task-btn');
  if (running) {
    statusBadge.textContent = 'Running';
    statusBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-green-900 text-green-300';
    btnStart.disabled = true;
    btnStop.disabled = false;
    statsBar.classList.remove('hidden');
    allRowBtns.forEach(b => { b.disabled = true; });
  } else {
    statusBadge.textContent = 'Idle';
    statusBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-gray-700 text-gray-300';
    btnStart.disabled = false;
    btnStop.disabled = true;
    allRowBtns.forEach(b => { b.disabled = false; });
  }
}

function updateStats(stats) {
  statEls.sent.textContent = stats.sent ?? 0;
  statEls.skipped.textContent = stats.skipped ?? 0;
  statEls.failed.textContent = stats.failed ?? 0;
  statEls.total.textContent = stats.total ?? 0;
  statsBar.classList.remove('hidden');
}

function updateDailyUI(counts) {
  const maxC = parseInt(maxDailyConnectsInput.value, 10) || 30;
  const maxM = parseInt(maxDailyMessagesInput.value, 10) || 50;
  dailyEls.connects.textContent = counts.connects ?? 0;
  dailyEls.connectsLimit.textContent = maxC;
  dailyEls.connectsBar.style.width = `${Math.min(100, ((counts.connects ?? 0) / maxC) * 100)}%`;
  dailyEls.messages.textContent = counts.messages ?? 0;
  dailyEls.messagesLimit.textContent = maxM;
  dailyEls.messagesBar.style.width = `${Math.min(100, ((counts.messages ?? 0) / maxM) * 100)}%`;
}

// Update limit labels live as user types
maxDailyConnectsInput.addEventListener('input', () => {
  dailyEls.connectsLimit.textContent = maxDailyConnectsInput.value || 30;
  const c = parseInt(dailyEls.connects.textContent, 10) || 0;
  const max = parseInt(maxDailyConnectsInput.value, 10) || 30;
  dailyEls.connectsBar.style.width = `${Math.min(100, (c / max) * 100)}%`;
});
maxDailyMessagesInput.addEventListener('input', () => {
  dailyEls.messagesLimit.textContent = maxDailyMessagesInput.value || 50;
  const m = parseInt(dailyEls.messages.textContent, 10) || 0;
  const max = parseInt(maxDailyMessagesInput.value, 10) || 50;
  dailyEls.messagesBar.style.width = `${Math.min(100, (m / max) * 100)}%`;
});

const rowMap = {};
const taskDataMap = {};

function renderQueue(tasks) {
  queueBody.innerHTML = '';
  Object.keys(rowMap).forEach(k => delete rowMap[k]);
  Object.keys(taskDataMap).forEach(k => delete taskDataMap[k]);

  if (!tasks.length) {
    queueEmpty.classList.remove('hidden');
    queueCount.textContent = '0 tasks';
    return;
  }
  queueEmpty.classList.add('hidden');
  queueCount.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

  tasks.forEach((t, i) => {
    const contact = t.contact || {};
    taskDataMap[t.id] = t;
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-800/40 transition';
    const typeLabel = t.type === 'linkedin_step_connect' ? 'Connect' : t.type === 'linkedin_step_message' ? 'Message' : t.type;
    const url = contact.linkedin_url || '';
    tr.innerHTML = `
      <td class="px-4 py-2 text-gray-600">${i + 1}</td>
      <td class="px-4 py-2 text-gray-200 font-medium">${esc(contact.name || 'Unknown')}</td>
      <td class="px-4 py-2">
        <span class="px-1.5 py-0.5 rounded text-xs ${typeLabel === 'Connect' ? 'bg-indigo-900 text-indigo-300' : 'bg-teal-900 text-teal-300'}">${typeLabel}</span>
      </td>
      <td class="px-4 py-2 text-gray-400 max-w-xs truncate">
        ${url ? `<a href="${esc(url)}" target="_blank" class="hover:text-indigo-400 transition truncate block max-w-xs">${esc(url)}</a>` : '<span class="text-gray-700">—</span>'}
      </td>
      <td class="px-4 py-2 text-gray-500 max-w-xs truncate">${esc((t.note || '').slice(0, 80))}</td>
      <td class="px-4 py-2 space-x-1 whitespace-nowrap">
        <button class="run-task-btn px-2 py-0.5 rounded bg-gray-700 hover:bg-indigo-700 text-gray-300 hover:text-white transition text-xs" data-id="${esc(t.id)}">Run</button>
        <button class="done-task-btn px-2 py-0.5 rounded bg-gray-700 hover:bg-green-700 text-gray-300 hover:text-white transition text-xs" data-id="${esc(t.id)}" title="Mark this task done in Apollo without running the LinkedIn automation">Done</button>
      </td>
    `;
    rowMap[t.id] = tr;
    queueBody.appendChild(tr);
  });

  // Delegate click for Run + Done buttons
  queueBody.addEventListener('click', e => {
    const runBtn = e.target.closest('.run-task-btn');
    if (runBtn) {
      const task = taskDataMap[runBtn.dataset.id];
      if (task) runSingleTask(task);
      return;
    }
    const doneBtn = e.target.closest('.done-task-btn');
    if (doneBtn) markTaskDone(doneBtn.dataset.id, doneBtn);
  });
}

async function markTaskDone(taskId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const res = await fetch('/api/mark-done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }));
      appendLog(`Mark-done failed: ${error}`, 'text-red-400');
      if (btn) { btn.disabled = false; btn.textContent = 'Done'; }
    }
  } catch (err) {
    appendLog(`Mark-done failed: ${err.message}`, 'text-red-400');
    if (btn) { btn.disabled = false; btn.textContent = 'Done'; }
  }
}

function removeRow(taskId) {
  const tr = rowMap[taskId];
  if (!tr) return;
  tr.remove();
  delete rowMap[taskId];
  delete taskDataMap[taskId];
  const remaining = Object.keys(rowMap).length;
  queueCount.textContent = `${remaining} task${remaining === 1 ? '' : 's'}`;
  if (remaining === 0) queueEmpty.classList.remove('hidden');
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightRow(taskId, cls) {
  const tr = rowMap[taskId];
  if (!tr) return;
  Object.values(rowMap).forEach(r => r.classList.remove('bg-indigo-900/20', 'bg-green-900/20', 'bg-red-900/20', 'bg-yellow-900/20'));
  if (cls) tr.classList.add(cls);
  tr.scrollIntoView({ block: 'nearest' });
}

function getLimits() {
  return {
    maxDailyConnects: parseInt(maxDailyConnectsInput.value, 10) || 30,
    maxDailyMessages: parseInt(maxDailyMessagesInput.value, 10) || 50,
    dryRun: dryRunInput.checked,
  };
}

async function runSingleTask(task) {
  const { maxDailyConnects, maxDailyMessages, dryRun } = getLimits();
  statsBar.classList.remove('hidden');
  updateStats({ sent: 0, skipped: 0, failed: 0, total: 0 });
  await fetch('/api/run-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, dryRun, maxDailyConnects, maxDailyMessages }),
  });
}

// WebSocket
function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => loadQueue();
  ws.onmessage = ({ data }) => {
    let evt;
    try { evt = JSON.parse(data); } catch { return; }

    if (evt.type === 'log' && evt.message) {
      appendLog(evt.message.trimEnd(), logColor(evt.message));
    }
    if (evt.type === 'status') {
      setRunning(evt.running);
      if (evt.stats) updateStats(evt.stats);
      setSessionState(null, evt.hasSession);
    }
    if (evt.type === 'setup') {
      setSessionState(evt.phase, false);
      if (evt.phase === 'saved') {
        appendLog('Session saved. Ready to run.', 'text-green-400');
        btnConnect.disabled = false;
        btnConnect.textContent = 'Connect';
        document.getElementById('save-spinner').classList.add('hidden');
        document.getElementById('save-btn-label').textContent = 'Save Session';
        loadQueue();
      }
      if (evt.phase === 'open') {
        appendLog('Browser opened. Log in to Apollo and LinkedIn, then click Save Session.', 'text-yellow-400');
      }
    }
    if (evt.type === 'stats') {
      updateStats(evt);
    }
    if (evt.type === 'daily') {
      updateDailyUI(evt.counts);
    }
    if (evt.type === 'task_start' && (evt.taskId || evt.task)) {
      highlightRow(evt.taskId || evt.task.id, 'bg-indigo-900/20');
      statusBadge.textContent = `Running: task ${evt.index} of ${evt.total}`;
    }
    if (evt.type === 'task_done') {
      const colorMap = { sent: 'bg-green-900/20', failed: 'bg-red-900/20', skipped: 'bg-yellow-900/20', already_connected: 'bg-green-900/20' };
      const taskId = evt.taskId || Object.keys(rowMap)[evt.index - 1];
      if (taskId) highlightRow(taskId, colorMap[evt.outcome] || '');
    }
    if (evt.type === 'task_removed' && evt.taskId) {
      removeRow(evt.taskId);
    }
    if (evt.type === 'done') {
      updateStats(evt);
    }
    if (evt.type === 'tasks') {
      renderQueue(evt.tasks);
    }
  };
  ws.onclose = () => setTimeout(connectWS, 2000);
}

async function loadQueue() {
  queueCount.textContent = 'loading...';
  try {
    const res = await fetch('/api/tasks');
    const { tasks } = await res.json();
    renderQueue(tasks);
  } catch {
    queueCount.textContent = 'error loading tasks';
  }
}

btnStart.addEventListener('click', async () => {
  const { maxDailyConnects, maxDailyMessages, dryRun } = getLimits();
  const maxActions = parseInt(maxActionsInput.value, 10) || 30;
  statsBar.classList.remove('hidden');
  updateStats({ sent: 0, skipped: 0, failed: 0, total: 0 });
  await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxActions, dryRun, maxDailyConnects, maxDailyMessages }),
  });
});

btnStop.addEventListener('click', async () => {
  await fetch('/api/stop', { method: 'POST' });
  appendLog('Stop requested...', 'text-yellow-400');
});

btnRefresh.addEventListener('click', loadQueue);
btnClearLog.addEventListener('click', () => { logEl.innerHTML = ''; });

connectWS();
loadQueue();
