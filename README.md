# Opencodian

> **Disclaimer**: This is an **unofficial** community-driven project. It is not affiliated with, maintained, or endorsed by the OpenCode team or opencode.ai.

Opencodian is an Obsidian plugin that embeds OpenCode as a sidebar chat interface. By treating your Obsidian vault as the working directory, it provides full agentic capabilities, including file reading/writing, bash command execution, and complex multi-step workflows.

> **Note**: This project is in early, active development. Bugs are to be expected. Issues and Pull Requests are highly welcome!

## Prerequisites

Opencodian ships with a dedicated OpenCode runtime and does not use any system-wide OpenCode installation.

To start successfully, the plugin must contain:

1. **Bundled OpenCode binary** (platform-specific)
   - Windows: `.obsidian/plugins/opencodian/bin/win/opencode.exe`
   - macOS: `.obsidian/plugins/opencodian/bin/mac/opencode`
   - Linux: `.obsidian/plugins/opencodian/bin/linux/opencode`

2. **Plugin-local OpenCode config directory**
   - `.obsidian/plugins/opencodian/.opencode/opencode.json` or `.obsidian/plugins/opencodian/.opencode/opencode.jsonc`

If any of these files are missing, Opencodian will refuse to start the server and prompt you to review the prerequisites.

### OpenCode config format and location

OpenCode supports **JSON** and **JSONC** config. See the official docs for format and schema:
- https://opencode.ai/docs/config

Opencodian uses a **plugin-local config directory** instead of the default global/project locations. It sets `OPENCODE_CONFIG_DIR` to `.obsidian/plugins/opencodian/.opencode` and disables project config discovery so your vault is not scanned.

### OpenCode binary source

The bundled runtime is pinned to OpenCode `v1.1.56` from the reference repository tag. Use the OpenCode release artifacts for that version and place the binary in the paths above.

You can find official install and release information here:
- https://opencode.ai/docs
- https://github.com/anomalyco/opencode/releases

## Features

- **Embedded AI Agent**: Integrate OpenCode directly into your Obsidian sidebar.
- **Vault Context**: The agent operates with your vault as its working directory.
- **Agentic Capabilities**: Supports file operations, terminal commands, and autonomous workflows.

## Roadmap

- [ ] Custom system prompts
- [ ] MCP server integration
- [x] Subscription-aware model selection
- [ ] Cross-conversation memory

## Quick Start

### Method 1: Download Release (Recommended for Users)

1.  Download the latest release from the [Releases](https://github.com/DanielDaniel2201/opencodian/releases) page.
2.  Navigate to your Obsidian vault's plugin directory: `<YourVaultPath>/.obsidian/plugins/`.
3.  Create a new folder named `opencodian`.
4.  Extract the downloaded files (`main.js`, `manifest.json`, `styles.css`) into this new folder.
5.  Restart Obsidian or reload plugins.
6.  Enable "Opencodian" in **Settings > Community plugins**.

### Method 2: Build from Source (For Developers)

1.  Clone this repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Build the plugin:
    ```bash
    npm run build
    ```
4.  Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder: `<YourVaultPath>/.obsidian/plugins/opencodian/`.
5.  Enable the plugin in Obsidian settings.

## Development

1.  **Build**: `npm run build`
2.  **Dev Mode**: `npm run dev`
3.  **Lint**: `npm run lint`

## Acknowledgements

Special thanks to:
- **[OpenCode](https://github.com/sst/opencode)**: For the core AI coding agent platform.
- **[Claudian](https://github.com/YishenTu/claudian)**: For the architectural inspiration and reference implementation.
