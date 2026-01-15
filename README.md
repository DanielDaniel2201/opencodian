# Opencodian

Opencodian is an Obsidian plugin that embeds OpenCode as a sidebar chat interface. By treating your Obsidian vault as the working directory, it provides full agentic capabilities, including file reading/writing, bash command execution, and complex multi-step workflows.

## Features

- **Embedded AI Agent**: Integrate OpenCode directly into your Obsidian sidebar.
- **Vault Context**: The agent operates with your vault as its working directory.
- **Agentic Capabilities**: Supports file operations, terminal commands, and autonomous workflows.

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
- **[OpenCode](https://github.com/opencode-ai)**: For the core AI coding agent platform.
- **[Claudian](https://github.com/anthropic/claudian)**: For the architectural inspiration and reference implementation.
