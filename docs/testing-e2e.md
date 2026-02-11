# E2E Behaviour Testing (Obsidian + Opencodian)

This document describes the automated behaviour test pipeline for Opencodian.

## Goals
- Exercise Opencodian as a user would (real UI interactions).
- Capture UI outcomes and Obsidian DevTools console errors.
- Keep configuration file-based (no manual terminal export required).

## Requirements
- Local Obsidian installation.
- A dedicated test vault with the Opencodian plugin installed.
- Playwright dependencies installed (see below).

## Setup
1. Copy the example env file:

```bash
copy .env.e2e.example .env.e2e
```

2. Edit `.env.e2e` and set:
- `OBSIDIAN_EXE` (full path to Obsidian executable)
- `OBSIDIAN_VAULT` (full path to test vault)

## Install dependencies
```bash
npm install -D @playwright/test playwright
```

## Run the behaviour test
```bash
npm run test:e2e
```

## What the test does
- Launches Obsidian via Electron.
- Waits for the Opencodian view to load.
- Sends a prompt via the UI.
- Waits for an assistant response.
- Captures DevTools console errors and fails on any errors.

## How it works
- UI is targeted via stable `data-testid` selectors.
- Environment variables are loaded from `.env.e2e` by `tests/e2e/run-e2e.cjs`.
- Debug-only test harness is available when `debugLogging` is enabled:
  - `window.opencodianTestHarness.getStatus()`
  - `window.opencodianTestHarness.getConversations()`

## Notes
- This pipeline uses the bundled OpenCode binary and plugin-local config (`.opencodian/.opencode`).
- Keep the test vault isolated from daily data.
