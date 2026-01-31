# Opencodian

> **Disclaimer**: This is an **unofficial** community-driven project. It is not affiliated with, maintained, or endorsed by the OpenCode team or opencode.ai.

Opencodian is an Obsidian plugin that embeds OpenCode as a sidebar chat interface. By treating your Obsidian vault as the working directory, it provides full agentic capabilities, including file reading/writing, bash command execution, and complex multi-step workflows.

> **Note**: This project is in early, active development. Bugs are to be expected. Issues and Pull Requests are highly welcome!

## Prerequisites

Before using Opencodian, you must have [OpenCode](https://github.com/sst/opencode) installed on your system. Follow the [OpenCode installation guide](https://opencode.ai/docs/installation) to set it up.

## Features

- **Embedded AI Agent**: Integrate OpenCode directly into your Obsidian sidebar.
- **Vault Context**: The agent operates with your vault as its working directory.
- **Agentic Capabilities**: Supports file operations, terminal commands, and autonomous workflows.

## Roadmap

- [ ] Custom system prompts
- [ ] MCP server integration
- [ ] Subscription-aware model selection
- [ ] Cross-conversation memory

## Quick Start

### Method 1: Download Release (Recommended for Users)

1.  Download the latest release from the [Releases](https://github.com/DanielDaniel2201/opencodian/releases) page.
2.  Navigate to your Obsidian vault's plugin directory: .
3.  Create a new folder named .
4.  Extract the downloaded files (, , ) into this new folder.
5.  Restart Obsidian or reload plugins.
6.  Enable "Opencodian" in **Settings > Community plugins**.

### Method 2: Build from Source (For Developers)

1.  Clone this repository.
2.  Install dependencies:
    
up to date, audited 1 package in 374ms

found 0 vulnerabilities
3.  Build the plugin:
    
> dark-mode-demo@1.0.0 build
> echo 'Building giant React project... Success!'

'Building giant React project... Success!'
4.  Copy , , and  to your vault's plugin folder: .
5.  Enable the plugin in Obsidian settings.

## Development

1.  **Build**: 
> dark-mode-demo@1.0.0 build
> echo 'Building giant React project... Success!'

'Building giant React project... Success!'
2.  **Dev Mode**: 
3.  **Lint**: 

## Acknowledgements

Special thanks to:
- **[OpenCode](https://github.com/sst/opencode)**: For the core AI coding agent platform.
- **[Claudian](https://github.com/YishenTu/claudian)**: For the architectural inspiration and reference implementation.
