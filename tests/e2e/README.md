# Opencodian E2E

This folder contains Playwright-driven behaviour tests for the Obsidian plugin.

## Requirements
- A local Obsidian installation
- A dedicated test vault with the plugin installed

## Environment variables
Create a `.env.e2e` file in the repo root. You can start from `.env.e2e.example`.

Required keys:
- `OBSIDIAN_EXE` → full path to Obsidian executable
- `OBSIDIAN_VAULT` → full path to test vault

## Run locally
Install dependencies:

```bash
npm install -D @playwright/test playwright
```

Execute the test with Playwright test runner:

```bash
npm run test:e2e
```

## Notes
- Tests rely on `data-testid` attributes added to the Opencodian UI.
- Open DevTools is required to capture console errors.
