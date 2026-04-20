# Apollo LinkedIn Automator

A local web dashboard that executes your Apollo LinkedIn task queue — connection requests and messages — directly from your browser. No browser extension required.

![Dashboard](https://img.shields.io/badge/status-local%20only-gray)

## How it works

- Fetches your pending LinkedIn tasks from Apollo via API
- Opens a Chrome window and executes each task (connect request or message)
- Marks the task done in Apollo after each action
- Tracks daily limits to stay within LinkedIn's recommended thresholds
- Saves progress so interrupted runs pick up where they left off

## Requirements

- **Node.js 18+** — `node --version` to check. Download at [nodejs.org](https://nodejs.org)
- **Google Chrome** installed
- An Apollo.io account with LinkedIn tasks in your task queue

## Setup

**1. Install Node.js** (one-time)

Download and install from [nodejs.org](https://nodejs.org) — use the LTS version.

**2. Add your Apollo API key**

Open `.env` and replace `YOUR_APOLLO_API_KEY_HERE` with your key.

> Apollo > Settings > Integrations > API Keys > Create Key

**3. Start**

Double-click **`start.command`**.

> First time on Mac: right-click → Open to bypass the security prompt. After that, double-click works normally.

The browser opens automatically. Dependencies install themselves on the first run.

**4. Connect your accounts** (one-time per machine)

1. Click **Connect** in the dashboard
2. A Chrome window opens using a dedicated local profile — log in to Apollo, then open a new tab and log in to LinkedIn
3. Click **Save Session** in the dashboard

The profile is stored in `chrome-profile/` and reused on every subsequent run, so you only log in once. If LinkedIn ever forces a re-auth, click Connect again.

## Running tasks

| Control | What it does |
|---|---|
| **Start** | Runs the queue up to your max actions limit |
| **Stop** | Halts cleanly after the current action finishes |
| **Run** (per row) | Executes a single specific task |
| **Dry run** | Previews without sending anything |

**Daily limits** (set in the dashboard) stop the run automatically when reached. LinkedIn recommends no more than 30 connection requests per day.

## Files

| File | Purpose |
|---|---|
| `.env` | Your Apollo API key — fill in the placeholder |
| `chrome-profile/` | Persistent browser profile (stays logged in) — gitignored, created via Connect |
| `progress.json` | Completed task IDs — gitignored, auto-created |
| `daily-counts.json` | Today's action counts — gitignored, resets daily |
