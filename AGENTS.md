# AGENTS.md

## Project Overview

Opencodian is an Obsidian plugin that embeds OpenCode AI as a sidebar chat interface. The vault directory becomes the working directory, providing full agentic capabilities: file read/write, bash commands, and multi-step workflows.

Opencodian runs a dedicated bundled OpenCode runtime (not the system install):
- Binary lives in `.obsidian/plugins/opencodian/bin/{win,mac,linux}`
- Config lives in `.obsidian/plugins/opencodian/.opencode`
- Project config discovery is disabled for the server process

**Reference projects** in `reference/`:
- `opencode/` - OpenCode source (AI coding agent platform)
- `claudian/` - Similar Obsidian plugin for Claude (architecture reference)

## Build/Test Commands

```bash
npm run dev        # Development mode with file watching
npm run build      # Production build
npm run typecheck  # TypeScript type checking (tsc --noEmit)
npm run lint       # ESLint on src/**/*.ts
npm run lint:fix   # Auto-fix lint issues
```

**No test framework configured yet** - tests are a future addition.

After making changes, always run:
```bash
npm run typecheck && npm run lint && npm run build
```

## Project Structure

```
src/
├── main.ts                    # Plugin entry point (OpencodianPlugin)
├── core/                      # Core infrastructure
│   ├── agent/                 # OpenCode SDK integration
│   │   └── OpenCodeService.ts # Server spawn, streaming, conversation management
│   └── types/                 # Type definitions
│       ├── chat.ts            # ChatMessage, Conversation, StreamChunk
│       ├── settings.ts        # OpencodianSettings, DEFAULT_SETTINGS
│       └── models.ts          # ModelOption, FREE_MODELS
├── features/                  # Feature modules
│   ├── chat/                  # Chat interface
│   │   └── OpencodianView.ts  # Main sidebar view
│   └── settings/              # Settings UI
│       └── OpencodianSettings.ts
└── i18n/                      # Future internationalization

reference/                     # Reference implementations (read-only)
├── opencode/                  # OpenCode source code
└── claudian/                  # Claudian plugin (architecture template)
```

## Code Style Guidelines

### General Principles

- Keep logic in one function unless composable/reusable
- AVOID unnecessary destructuring - use `obj.a` instead of `const { a } = obj`
- AVOID `try`/`catch` where possible (use for critical operations only)
- AVOID `else` statements - prefer early returns
- AVOID `any` type - use `unknown` or proper types
- AVOID `let` statements - prefer `const`
- PREFER single-word variable names where context is clear

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `OpenCodeService`, `OpencodianView` |
| Interfaces/Types | PascalCase | `ChatMessage`, `StreamChunk` |
| Variables/Functions | camelCase | `sessionId`, `createConversation()` |
| Constants (strings) | SCREAMING_SNAKE | `VIEW_TYPE_OPENCODIAN` |
| Constants (objects) | PascalCase | `DEFAULT_SETTINGS`, `FREE_MODELS` |
| Private members | `private` keyword | `private sessionId` (not `_sessionId`) |

### Import Ordering

1. External packages first (`obsidian`, `@opencode-ai/sdk`)
2. Node.js built-ins (`child_process`, `http`)
3. Internal modules (relative paths)
4. Type-only imports use `import type`

```typescript
import { Plugin } from "obsidian";
import { spawn } from "child_process";

import { OpenCodeService } from "./core/agent";
import type { ChatMessage, Conversation } from "./core/types";
import { DEFAULT_SETTINGS } from "./core/types";
```

### Export Patterns

- **Named exports** for utilities, types, services, and views
- **Default export** only for the main plugin class (`main.ts`)
- **Barrel files** (`index.ts`) for re-exporting from directories

```typescript
// core/types/index.ts
export * from './chat';
export * from './settings';
export * from './models';
```

### Type Annotations

- Always annotate function return types
- Use union with `null` for nullable values: `string | null`
- Use `Record<string, unknown>` for dynamic objects
- Use discriminated unions for streaming events

```typescript
async createConversation(): Promise<Conversation> { ... }
getActiveConversation(): Conversation | null { ... }

type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string }
  | { type: 'done' };
```

### Error Handling

- Use `instanceof Error` for type checking in catch blocks
- Empty catch blocks acceptable for non-critical failures (add `// ignore` comment)
- Log errors with context: `console.error("[ServiceName] message:", error)`

```typescript
} catch (error) {
  throw new Error(
    `Failed to create session: ${error instanceof Error ? error.message : "Unknown error"}`
  );
}
```

### Async Patterns

- Use `async`/`await` consistently (not `.then()`)
- Use `AsyncGenerator` for streaming responses
- Wrap callback APIs in `Promise` when needed

```typescript
async *query(prompt: string): AsyncGenerator<StreamChunk> {
  for await (const event of eventStream) {
    yield { type: "text", content: delta };
  }
  yield { type: "done" };
}
```

## Obsidian Plugin Patterns

```typescript
// View registration
this.registerView(VIEW_TYPE_OPENCODIAN, (leaf) => new OpencodianView(leaf, this));

// Vault path access
const vaultPath = this.app.vault.adapter.basePath;

// Markdown rendering
await MarkdownRenderer.render(this.app, content, container, "", this);
```

## CSS Conventions

- All classes use `.opencodian-` prefix
- Modular CSS in `src/style/` (future), built into `styles.css`
- Key patterns: `-container`, `-header`, `-messages`, `-input`

## OpenCode SDK Integration

The plugin uses `@opencode-ai/sdk` to communicate with the OpenCode server:

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

const client = createOpencodeClient({ baseUrl: serverUrl });
const session = await client.session.create({ path: vaultPath });
const eventStream = await client.chat.prompt(sessionId, { prompt, model });

for await (const event of eventStream) {
  // Handle streaming events
}
```

## Development Workflow

1. Run `npm run dev` for watch mode
2. Open Obsidian with the vault containing `dist/` as plugin folder
3. Use Ctrl+Shift+I for DevTools debugging
4. Test in Obsidian after each change (hot reload not supported)

## Important Notes

- **ALWAYS USE PARALLEL TOOLS** when operations are independent
- Reference `claudian/CLAUDE.md` for detailed Obsidian plugin patterns
- Reference `opencode/STYLE_GUIDE.md` for code style preferences
- The OpenCode server is spawned as a child process and communicates via HTTP
- Default server port is 4097 (falls back to a random open port if unavailable)
- Sessions and conversations are managed locally, not synced to cloud
