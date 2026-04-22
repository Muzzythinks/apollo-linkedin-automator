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

function appendLog(text, color = 'text-gray-600') {
  const line = document.createElement('div');
  line.className = color;
  line.textContent = text;
  logEl.appendChild(line);
  autoScroll();
}

function logColor(message) {
  const m = message.toLowerCase();
  if (m.includes('connection request sent') || m.includes('message sent') || m.includes('marked done')) return 'text-emerald-600';
  if (m.includes('skipping') || m.includes('already') || m.includes('pending') || m.includes('404')) return 'text-amber-600';
  if (m.includes('error') || m.includes('fatal') || m.includes('not found') || m.includes('failed')) return 'text-red-600';
  if (m.includes('dry-run')) return 'text-brand-600';
  if (m.includes('limit reached') || m.includes('limit (')) return 'text-orange-600';
  return 'text-gray-600';
}

function setRunning(running) {
  const allRowBtns = queueBody.querySelectorAll('button.run-task-btn, button.done-task-btn');
  if (running) {
    statusBadge.textContent = 'Running';
    statusBadge.className = 'badge bg-emerald-50 text-emerald-700';
    btnStart.disabled = true;
    btnStop.disabled = false;
    statsBar.classList.remove('hidden');
    allRowBtns.forEach(b => { b.disabled = true; });
  } else {
    statusBadge.textContent = 'Idle';
    statusBadge.className = 'badge bg-gray-100 text-gray-600';
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
    const due = formatDue(t.due_at);
    tr.innerHTML = `
      <td class="px-4 py-2.5 text-gray-400">${i + 1}</td>
      <td class="px-4 py-2.5 text-gray-900 font-medium">${esc(contact.name || 'Unknown')}</td>
      <td class="px-4 py-2.5">
        <span class="badge ${typeLabel === 'Connect' ? 'bg-brand-50 text-brand-700' : 'bg-teal-50 text-teal-700'}">${typeLabel}</span>
      </td>
      <td class="px-4 py-2.5 ${due.color} whitespace-nowrap" title="${esc(due.title)}">${esc(due.text)}</td>
      <td class="px-4 py-2.5 text-gray-500 max-w-xs truncate">
        ${url ? `<a href="${esc(url)}" target="_blank" class="hover:text-brand-600 hover:underline transition truncate block max-w-xs">${esc(url)}</a>` : '<span class="text-gray-300">—</span>'}
      </td>
      <td class="px-4 py-2.5 text-gray-600 max-w-xs truncate">${esc((t.note || '').slice(0, 80))}</td>
      <td class="px-4 py-2.5 space-x-1 whitespace-nowrap">
        ${t.type === 'linkedin_step_message' ? `<button class="preview-task-btn row-btn row-btn-preview" data-id="${esc(t.id)}">See message</button>` : ''}
        <button class="run-task-btn row-btn row-btn-run" data-id="${esc(t.id)}">Run</button>
        <button class="done-task-btn row-btn row-btn-done" data-id="${esc(t.id)}" title="Mark this task done in Apollo without running the LinkedIn automation">Done</button>
      </td>
    `;
    rowMap[t.id] = tr;
    queueBody.appendChild(tr);
  });

}

// Delegate click for Run + Done buttons — attached once, survives re-renders.
// (Previously attached inside renderQueue, so every loadQueue call stacked a new
// listener, causing N clicks per Done press.)
queueBody.addEventListener('click', e => {
  const previewBtn = e.target.closest('.preview-task-btn');
  if (previewBtn) {
    const task = taskDataMap[previewBtn.dataset.id];
    if (task) openMessageModal(task);
    return;
  }
  const runBtn = e.target.closest('.run-task-btn');
  if (runBtn) {
    const task = taskDataMap[runBtn.dataset.id];
    if (task) runSingleTask(task);
    return;
  }
  const doneBtn = e.target.closest('.done-task-btn');
  if (doneBtn) {
    const task = taskDataMap[doneBtn.dataset.id];
    if (task) markTaskDone(task.id, task.user_id, doneBtn);
  }
});

// Message preview / edit modal
const msgModal = document.getElementById('msg-modal');
const msgModalBody = document.getElementById('msg-modal-body');
const msgModalContact = document.getElementById('msg-modal-contact');
const msgModalStatus = document.getElementById('msg-modal-status');
const msgModalSave = document.getElementById('msg-modal-save');
const msgModalCancel = document.getElementById('msg-modal-cancel');
const msgModalClose = document.getElementById('msg-modal-close');
let currentPreviewTaskId = null;
let currentPreviewOriginal = '';

function setModalStatus(text, color) {
  msgModalStatus.textContent = text || '';
  msgModalStatus.className = `text-xs h-4 ${color || 'text-gray-400'}`;
}

async function openMessageModal(task) {
  currentPreviewTaskId = task.id;
  currentPreviewOriginal = '';
  msgModalContact.textContent = `${task.contact?.name || 'Unknown'} · ${task.contact?.title || ''}`.trim().replace(/ · $/, '');
  msgModalBody.value = '';
  msgModalBody.placeholder = 'Loading…';
  msgModalSave.disabled = true;
  setModalStatus('');
  msgModal.classList.remove('hidden');
  try {
    const res = await fetch(`/api/task-message/${encodeURIComponent(task.id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    msgModalBody.value = data.body || '';
    currentPreviewOriginal = data.body || '';
    msgModalBody.placeholder = '';
    msgModalSave.disabled = false;
    if (!data.body) setModalStatus('No message body on this task yet — edit and save to set one.', 'text-amber-600');
  } catch (err) {
    setModalStatus(`Error: ${err.message}`, 'text-red-600');
  }
}

function closeMessageModal() {
  msgModal.classList.add('hidden');
  currentPreviewTaskId = null;
}

msgModalClose.addEventListener('click', closeMessageModal);
msgModalCancel.addEventListener('click', closeMessageModal);
msgModal.addEventListener('click', e => { if (e.target === msgModal) closeMessageModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !msgModal.classList.contains('hidden')) closeMessageModal(); });

msgModalSave.addEventListener('click', async () => {
  if (!currentPreviewTaskId) return;
  const body = msgModalBody.value;
  if (body === currentPreviewOriginal) { closeMessageModal(); return; }
  msgModalSave.disabled = true;
  setModalStatus('Saving…', 'text-gray-500');
  try {
    const res = await fetch(`/api/task-message/${encodeURIComponent(currentPreviewTaskId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setModalStatus('Saved.', 'text-emerald-600');
    setTimeout(closeMessageModal, 600);
  } catch (err) {
    setModalStatus(`Error: ${err.message}`, 'text-red-600');
    msgModalSave.disabled = false;
  }
});

async function markTaskDone(taskId, userId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const res = await fetch('/api/mark-done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, userId }),
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

function formatDue(iso) {
  if (!iso) return { text: '—', title: '', color: 'text-gray-300' };
  const due = new Date(iso);
  if (isNaN(due)) return { text: '—', title: '', color: 'text-gray-300' };
  const now = new Date();
  const diffDays = Math.floor((due - now) / 86400000);
  const title = due.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  let text, color;
  if (diffDays <= -1) { text = `${-diffDays}d overdue`; color = 'text-red-600'; }
  else if (diffDays === 0) { text = 'today'; color = 'text-amber-600'; }
  else if (diffDays === 1) { text = 'tomorrow'; color = 'text-gray-700'; }
  else if (diffDays < 7) { text = `in ${diffDays}d`; color = 'text-gray-600'; }
  else { text = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); color = 'text-gray-500'; }
  return { text, title, color };
}

function highlightRow(taskId, cls) {
  const tr = rowMap[taskId];
  if (!tr) return;
  Object.values(rowMap).forEach(r => r.classList.remove('bg-brand-50', 'bg-emerald-50', 'bg-red-50', 'bg-amber-50'));
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
      highlightRow(evt.taskId || evt.task.id, 'bg-brand-50');
      statusBadge.textContent = `Running ${evt.index}/${evt.total}`;
    }
    if (evt.type === 'task_done') {
      const colorMap = { sent: 'bg-emerald-50', failed: 'bg-red-50', skipped: 'bg-amber-50', already_connected: 'bg-emerald-50' };
      const taskId = evt.taskId || Object.keys(rowMap)[evt.index - 1];
      if (taskId) {
        // Sent, already-connected, and skipped (404/pending) are all marked
        // done in Apollo now, so clear them from the queue. Keep failed rows
        // visible so the user can investigate and retry.
        if (evt.outcome === 'sent' || evt.outcome === 'already_connected' || evt.outcome === 'skipped') {
          removeRow(taskId);
        } else {
          highlightRow(taskId, colorMap[evt.outcome] || '');
        }
      }
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
