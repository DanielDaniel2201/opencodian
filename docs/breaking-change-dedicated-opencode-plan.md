# Plan: Breaking Change - Dedicated OpenCode for Opencodian

## Goal
- Adopt a dedicated (bundled) OpenCode runtime for Opencodian to avoid breaking changes from user-installed OpenCode updates.

## Scope
- Bundle platform-specific OpenCode binaries inside the plugin.
- Always start the bundled OpenCode server from the plugin.
- Read config only from plugin-local `.opencode/` directory (user manually copies config).
- Support Windows/macOS/Linux.

## Non-Goals (MVP)
- No auto-copy of user config into plugin directory.
- No automatic OpenCode updates.
- No fallback to system-installed OpenCode.

## Directory Layout
- `.obsidian/plugins/opencodian/bin/win/opencode.exe`
- `.obsidian/plugins/opencodian/bin/mac/opencode`
- `.obsidian/plugins/opencodian/bin/linux/opencode`
- `.obsidian/plugins/opencodian/.opencode/opencode.json` (user-managed)

## Startup Flow
1) Detect platform with `process.platform`.
2) Resolve bundled binary path for that platform.
3) Spawn: `opencode serve --port <fixedPort>`.
4) Set env:
   - `OPENCODE_CONFIG_DIR=<plugin>/.opencode`
5) Wait for `/global/health` to respond.
6) Connect SDK using `baseUrl = http://127.0.0.1:<fixedPort>`.

## Config Strategy (MVP)
- Only load config from plugin-local `.opencode/`.
- If missing, allow OpenCode defaults.
- Display a UI hint: "Copy your opencode.json into <plugin>/.opencode".

## Port Strategy
- Default port: 4097 (configurable in plugin settings).
- If occupied, show error + instruct user to change the port.

## Lifecycle
- On plugin enable: start server.
- On plugin disable/unload: stop server process.
- Avoid starting duplicate servers if already running.

## Release Strategy
- Bundle three platform binaries in the plugin package.
- Version pinned by plugin release, independent from user’s global OpenCode.

## Risks & Mitigations
- Binary size increase: document larger plugin size.
- Permissions on mac/linux: ensure executable bit set in release artifact.
