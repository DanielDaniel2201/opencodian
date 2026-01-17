/**
 * OpenCode Service - Core integration with OpenCode via SDK
 *
 * Uses @opencode-ai/sdk to communicate with the OpenCode server.
 * Automatically starts the OpenCode server if not running.
 * Supports streaming responses, file context, and session management.
 */

import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { spawn } from "child_process";
import * as http from "http";
import * as readline from "readline";
import type { App } from "obsidian";
import type { ChatMessage, ImageAttachment, StreamChunk, ConfigProvidersResponse } from "../types";
import { 
  OpencodianError, 
  UserCancellationError, 
  TimeoutError, 
  ServerError, 
  NetworkError 
} from "../errors";

export interface MentionContext {
  path: string;
  name: string;
  isFolder: boolean;
  /** For folders: list of children paths */
  children?: string[];
}

export interface QueryOptions {
  model?: string;
  allowedTools?: string[];
  /** File/folder paths mentioned with @ syntax */
  mentions?: string[];
  /** Rich mention context with folder contents */
  mentionContexts?: MentionContext[];
  /** Timeout in milliseconds for the entire query (default: 120000 = 2 minutes) */
  timeout?: number;
}

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

/** Debug turn data structure */
interface DebugTurn {
  timestamp: string;
  userPrompt: string;
  events: unknown[];
}

/**
 * Service for interacting with OpenCode
 */
export class OpenCodeService {
  private client: OpencodeClient | null = null;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;
  private serverUrl: string = "http://localhost:4096";
  private serverClose: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;
  
  // Debug logging
  private app: App | null = null;
  private debugEnabled: boolean = true;
  private readonly DEBUG_FILE = "opencodian-debug.json";

  constructor() {
    // Lazy initialization
  }

  /** Set Obsidian app reference for file operations */
  setApp(app: App): void {
    this.app = app;
  }

  /** Enable/disable debug logging */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /** Save a turn to debug file */
  private async saveDebugTurn(turn: DebugTurn): Promise<void> {
    if (!this.debugEnabled || !this.app) return;

    try {
      const vault = this.app.vault;
      let existingData: DebugTurn[] = [];

      // Read existing file
      const file = vault.getAbstractFileByPath(this.DEBUG_FILE);
      if (file && "extension" in file) {
        const content = await vault.read(file as any);
        try {
          existingData = JSON.parse(content);
        } catch {
          existingData = [];
        }
      }

      // Append new turn
      existingData.push(turn);

      // Write back
      const newContent = JSON.stringify(existingData, null, 2);
      if (file && "extension" in file) {
        await vault.modify(file as any, newContent);
      } else {
        await vault.create(this.DEBUG_FILE, newContent);
      }

      console.log(`[OpenCodeService] Debug turn saved to ${this.DEBUG_FILE}`);
    } catch (error) {
      console.error("[OpenCodeService] Failed to save debug turn:", error);
    }
  }

  /**
   * Create a client with Node.js http module to bypass CORS consistently
   */
  private createClient(baseUrl: string, directory?: string | null): OpencodeClient {
    // Ensure baseUrl doesn't have trailing slash
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    return createOpencodeClient({
      baseUrl: normalizedBaseUrl,
      directory: directory ?? undefined,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        // Handle different input types
        let url: string;
        let method: string;
        let headers: Record<string, string>;
        let body: string | undefined;

        if (input instanceof Request) {
          // Input is a Request object
          url = input.url;
          method = input.method;
          headers = {};
          input.headers.forEach((value, key) => {
            headers[key] = value;
          });
          body = init?.body as string | undefined;
          if (!body && input.body) {
            try {
              body = await input.text();
            } catch {
              /* ignore */
            }
          }
        } else {
          // Input is URL or string
          url = input.toString();
          method = init?.method || "GET";
          headers = (init?.headers as Record<string, string>) || {};
          body = init?.body as string | undefined;
        }

        // Ensure URL is absolute
        if (url.startsWith("/")) {
          url = normalizedBaseUrl + url;
        }

        // Simple log for everyday use
        console.log(`[OpenCodeService] Request: ${method} ${url}`);

        // Use Node.js http.request to bypass CORS and avoid requestUrl limitations
        return new Promise<Response>((resolve, reject) => {
          const urlObj = new URL(url);

          // Explicitly set Content-Length to prevent hanging requests
          const requestHeaders: Record<string, string> = { ...headers };
          if (body) {
            requestHeaders["Content-Length"] =
              Buffer.byteLength(body).toString();
          }

          const req = http.request(
            urlObj,
            {
              method,
              headers: requestHeaders,
              timeout: 10000, // 10s timeout
            },
            (res) => {
              console.log(
                `[OpenCodeService] Response received: ${res.statusCode}`
              );
              const chunks: Buffer[] = [];
              res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
              res.on("end", () => {
                const buffer = Buffer.concat(chunks);
                const responseText = buffer.toString("utf-8");

                // Construct a standard Response object
                const response = new Response(responseText, {
                  status: res.statusCode || 200,
                  statusText: res.statusMessage || "",
                  headers: res.headers as any,
                });

                resolve(response);
              });
            }
          );

          req.on("timeout", () => {
            req.destroy();
            reject(new Error(`Request timed out: ${method} ${url}`));
          });

          req.on("error", (err) => {
            console.error(`[OpenCodeService] Request failed:`, err);
            reject(err);
          });

          if (body) {
            req.write(body);
          }
          req.end();
        });
      },
    });
  }

  /**
   * Initialize the OpenCode client and server
   */
  private async init(): Promise<void> {
    if (this.client) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const vaultDirectory = this.getVaultBasePath();

    try {
      // Start our own server using a RANDOM port (port 0) so we can control cwd.
      console.log(
        "[OpenCodeService] Starting a new OpenCode server on a random port..."
      );
      const server = await this.startOpencodeServer({
        hostname: "127.0.0.1",
        port: 0,
        timeoutMs: 15000,
        cwd: vaultDirectory ?? undefined,
      });

      this.client = this.createClient(server.url, vaultDirectory);
      this.serverUrl = server.url;
      this.serverClose = () => server.close();

      console.log(
        `[OpenCodeService] OpenCode server started successfully at ${server.url}`
      );
    } catch (error) {
      console.error("[OpenCodeService] Failed to start local server:", error);
      this.initPromise = null;
      throw error;
    }
  }

  private getVaultBasePath(): string | null {
    try {
      const adapter: any = this.app?.vault?.adapter;
      if (adapter && typeof adapter.getBasePath === "function") {
        const basePath = adapter.getBasePath();
        return typeof basePath === "string" && basePath.trim()
          ? basePath.trim()
          : null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async startOpencodeServer(options: {
    hostname: string;
    port: number;
    timeoutMs: number;
    cwd?: string;
  }): Promise<{ url: string; close(): void }> {
    const args = [
      "serve",
      `--hostname=${options.hostname}`,
      `--port=${options.port}`,
    ];

    const proc = spawn("opencode", args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({}),
      },
    });

    const url = await new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Timeout waiting for OpenCode server to start after ${options.timeoutMs}ms`
          )
        );
      }, options.timeoutMs);

      let output = "";

      const onData = (chunk: any) => {
        output += chunk?.toString?.() ?? "";
        const lines = output.split("\n");
        for (const line of lines) {
          if (line.startsWith("opencode server listening")) {
            const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
            if (!match) continue;
            clearTimeout(timeoutId);
            resolve(match[1]);
            return;
          }
        }
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.on("exit", (code) => {
        clearTimeout(timeoutId);
        let msg = `OpenCode server exited with code ${code}`;
        if (output.trim()) msg += `\nServer output: ${output}`;
        reject(new Error(msg));
      });

      proc.on("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    return {
      url,
      close() {
        proc.kill();
      },
    };
  }

  /**
   * Set the server URL (for manual connection)
   */
  setServerUrl(url: string): void {
    this.serverUrl = url;
    this.client = null;
    this.initPromise = null;
  }

  /**
   * Check if OpenCode is available (will start server if needed)
   */
  async isServerAvailable(): Promise<boolean> {
    try {
      await this.init();
      return this.client !== null;
    } catch {
      return false;
    }
  }

  /**
   * Create or get a session
   */
  private async ensureSession(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }

    await this.init();

    if (!this.client) {
      throw new Error("OpenCode client not initialized");
    }

    try {
      const session = await this.client.session.create({
        body: { title: `Obsidian - ${new Date().toLocaleString()}` },
      });

      if (session.data?.id) {
        this.sessionId = session.data.id;
        return this.sessionId;
      }
      throw new Error("Failed to create session");
    } catch (error) {
      throw new Error(
        `Failed to create session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Subscribe to global events via SSE
   */
  private subscribeToEvents(abortSignal: AbortSignal): AsyncGenerator<any> {
    const urlObj = new URL(`${this.serverUrl}/event`);

    return (async function* () {
      const response = await new Promise<http.IncomingMessage>(
        (resolve, reject) => {
          const req = http.request(
            urlObj,
            {
              method: "GET",
              headers: {
                Accept: "text/event-stream",
                "Cache-Control": "no-cache",
              },
            },
            (res) => {
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`Event stream returned ${res.statusCode}`));
                return;
              }
              resolve(res);
            }
          );
          req.on("error", reject);
          abortSignal.addEventListener("abort", () => req.destroy());
          req.end();
        }
      );

      const rl = readline.createInterface({
        input: response,
        terminal: false,
      });

      let currentData = "";

      for await (const line of rl) {
        if (abortSignal.aborted) break;
        const trimmed = line.trim();
        if (!trimmed) {
          if (currentData) {
            try {
              yield JSON.parse(currentData);
            } catch {
              // Ignore parse errors
            }
            currentData = "";
          }
          continue;
        }

        if (line.startsWith("data:")) {
          currentData = line.slice(5).trim();
        }
      }
    })();
  }

  /**
   * Send a query to OpenCode and stream the response
   */
  async *query(
    prompt: string,
    images?: ImageAttachment[],
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions
  ): AsyncGenerator<StreamChunk> {
    this.abortController = new AbortController();
    const sessionId = await this.ensureSession();
    const abortSignal = this.abortController.signal;
    
    // Timeout configuration
    // - 30 seconds to receive first meaningful response
    // - 60 seconds between meaningful events (text/tool updates)
    const initialTimeout = 30000; // 30s to get first response
    const inactivityTimeout = 60000; // 60s between meaningful events
    let receivedMeaningfulEvent = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isTimeoutTriggered = false;
    
    const setTimeoutWithDuration = (duration: number): void => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (this.abortController) {
          isTimeoutTriggered = true;
          const msg = receivedMeaningfulEvent 
            ? `No response for ${duration / 1000}s`
            : `No initial response within ${duration / 1000}s`;
          console.error(`[OpenCodeService] Query timed out: ${msg}`);
          this.abortController.abort(new TimeoutError(duration, receivedMeaningfulEvent ? "inactivity" : "initial"));
        }
      }, duration);
    };
    
    const resetTimeout = (): void => {
      receivedMeaningfulEvent = true;
      setTimeoutWithDuration(inactivityTimeout);
    };
    
    const clearTimeoutHandler = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    
    // Start initial timeout
    setTimeoutWithDuration(initialTimeout);

    // Debug: collect all events for this turn
    const debugEvents: unknown[] = [];

    // Start event subscription
    const eventStream = this.subscribeToEvents(abortSignal);

    // Wait for server.connected before sending prompt
    const firstEvent = await eventStream.next();
    if (firstEvent.done) {
      throw new Error("Event stream closed unexpectedly");
    }
    if (firstEvent.value?.type !== "server.connected") {
      console.warn("[OpenCode] Expected server.connected, got:", firstEvent.value?.type);
    }

    // Build request body
    const parts: Array<{ type: string; text?: string }> = [];
    
      // Prepend mentioned files context with rich information
    let finalPrompt = prompt;
    if (queryOptions?.mentionContexts && queryOptions.mentionContexts.length > 0) {
      // Use rich context format
      const contextLines: string[] = [];
      const vaultPath = this.getVaultBasePath() || "";
      
      for (const ctx of queryOptions.mentionContexts) {
        const fullPath = vaultPath ? `${vaultPath}/${ctx.path}`.replace(/\//g, "\\") : ctx.path;
        
        if (ctx.isFolder) {
          contextLines.push(`Directory: ${fullPath}`);
          if (ctx.children && ctx.children.length > 0) {
            // Provide a hint of contents, but encourage using tools to explore if needed
            contextLines.push(`  (Contains: ${ctx.children.join(", ")})`);
          }
        } else {
          contextLines.push(`File: ${fullPath}`);
        }
      }
      
      finalPrompt = `Mentioned Paths (Absolute paths - accessible directly via tools):\n${contextLines.join("\n")}\n\n${prompt}`;
    } else if (queryOptions?.mentions && queryOptions.mentions.length > 0) {
      // Fallback to simple path list
      const mentionList = queryOptions.mentions.map(p => `- ${p}`).join("\n");
      finalPrompt = `Context files:\n${mentionList}\n\n${prompt}`;
    }
    
    parts.push({ type: "text", text: finalPrompt });

    let modelConfig = undefined;
    if (queryOptions?.model) {
      const parts = queryOptions.model.split("/");
      if (parts.length === 2) {
        modelConfig = { providerID: parts[0], modelID: parts[1] };
      } else {
        modelConfig = { providerID: "default", modelID: queryOptions.model };
      }
    }

    const body = JSON.stringify({
      parts: parts as any,
      ...(modelConfig && { model: modelConfig }),
    });

    // Send the prompt (async)
    const promptPromise = new Promise<void>((resolve, reject) => {
      const urlObj = new URL(
        `${this.serverUrl}/session/${sessionId}/prompt_async`
      );
      const req = http.request(
        urlObj,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body).toString(),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Prompt failed with status ${res.statusCode}`));
          } else {
            resolve();
          }
        }
      );
      req.on("error", reject);
      abortSignal.addEventListener("abort", () => req.destroy());
      req.write(body);
      req.end();
    });

    try {
      // Catch prompt errors
      promptPromise.catch((err) => {
        console.error("[OpenCode] Prompt error:", err);
      });

      // Track seen tool calls to avoid duplicates
      const completedTools = new Set<string>();

      for await (const event of eventStream) {
        if (abortSignal.aborted) {
           // If we have a specific abort reason (like TimeoutError), throw it to be caught below
           if (abortSignal.reason instanceof Error) {
             throw abortSignal.reason;
           }
           // Otherwise it's a manual cancellation
           throw new UserCancellationError();
        }

        // Collect event for debug
        debugEvents.push(event);

        // Session idle means we're done
        if (
          event.type === "session.idle" &&
          event.properties?.sessionID === sessionId
        ) {
          break;
        }

        if (event.type === "message.part.updated") {
          const { part, delta } = event.properties;
          if (part.sessionID !== sessionId) continue;

          // Handle streaming text deltas
          if (part.type === "text") {
            if (delta) {
              resetTimeout(); // Got meaningful content
              yield { type: "text", content: delta };
            } else if (part.text) {
              // Fallback: if no delta, try to diff or just yield full text if it's a new chunk
              // Since we don't track previous length per part here easily without a map,
              // let's trust delta is provided for streaming.
              // If not, we might be yielding full text repeatedly.
              // Let's add a debug log to verify structure
              // console.log("Text part update:", part.text.length, delta);
            }
          }
          // Handle reasoning (thinking)
          else if (part.type === "reasoning") {
            if (delta) {
              yield { type: "thinking", content: delta };
            }
          }
          // Handle tool use
          else if (part.type === "tool") {
            const state = part.state || {};
            const toolUseId = part.id;

            const input = (state.input || {}) as Record<string, unknown>;
            const hasNonEmptyInput =
              !!input &&
              typeof input === "object" &&
              Object.keys(input).length > 0;

            if (state.status === "running" || state.status === "pending") {
              // OpenCode sometimes emits an initial `pending` tool update with empty input `{}`.
              // Emitting it creates a duplicate UI block that never gets completed.
              if (state.status === "pending" && !hasNonEmptyInput) {
                continue;
              }
              resetTimeout(); // Got meaningful content
              yield {
                type: "tool_use",
                toolName: part.tool,
                input,
                toolUseId,
              };
            } else if (
              state.status === "completed" &&
              !completedTools.has(toolUseId)
            ) {
              completedTools.add(toolUseId);
              resetTimeout(); // Got meaningful content
              yield {
                type: "tool_result",
                toolUseId,
                result: state.output || "",
              };
            } else if (
              state.status === "error" &&
              !completedTools.has(toolUseId)
            ) {
              completedTools.add(toolUseId);
              resetTimeout(); // Got meaningful content
              yield {
                type: "tool_result",
                toolUseId,
                result: `Error: ${state.error}`,
              };
            }
          }
        }

        if (
          event.type === "session.error" &&
          event.properties?.sessionID === sessionId
        ) {
          yield {
            type: "error",
            content: event.properties.error?.message || "Session error",
          };
        }
      }

      await promptPromise;
      
      // Save debug turn
      await this.saveDebugTurn({
        timestamp: new Date().toISOString(),
        userPrompt: prompt,
        events: debugEvents,
      });
      
      yield { type: "done" };
    } catch (error) {
      clearTimeoutHandler();
      
      // Handle known error types
      if (error instanceof UserCancellationError) {
        yield { type: "done" }; // Graceful exit
        return;
      }

      let finalError: OpencodianError;
      
      if (error instanceof OpencodianError) {
        finalError = error;
      } else if (isTimeoutTriggered) {
        finalError = new TimeoutError(initialTimeout);
      } else {
        // Map native errors to OpencodianErrors
        const msg = String(error);
        if (msg.includes("ECONNREFUSED") || msg.includes("Network")) {
          finalError = new NetworkError(error instanceof Error ? error : new Error(msg));
        } else {
           // Default to generic server/unknown error
           finalError = new ServerError(500, error instanceof Error ? error.message : "Unknown error");
        }
      }
      
      console.error("[OpenCodeService] Query error:", finalError);
      
      // Save debug turn even on error
      await this.saveDebugTurn({
        timestamp: new Date().toISOString(),
        userPrompt: prompt,
        events: [...debugEvents, { type: "error", error: finalError.message }],
      });
      
      yield {
        type: "error",
        content: finalError.message,
      };
      yield { type: "done" };
    } finally {
      clearTimeoutHandler();
      this.abortController = null;
    }
  }

  /**
   * Cancel the current query
   */
  async cancel(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort(new UserCancellationError());
    }

    if (this.client && this.sessionId) {
      try {
        await this.client.session.abort({
          path: { id: this.sessionId },
        });
      } catch {
        // Ignore
      }
    }
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  resetSession(): void {
    this.sessionId = null;
  }

  cleanup(): void {
    this.cancel();
    this.resetSession();
    if (this.serverClose) {
      this.serverClose();
      this.serverClose = null;
    }
    this.client = null;
    this.initPromise = null;
  }

  private log(message: string, ...args: any[]): void {
    console.log(`[OpenCodeService] ${message}`, ...args);
  }

  /**
   * Get user-configured providers and models from OpenCode server
   * Uses GET /config/providers endpoint (only returns connected/configured providers)
   */
  async getProviders(): Promise<ConfigProvidersResponse> {
    await this.init();

    if (!this.client) {
      throw new Error("OpenCode client not initialized");
    }

    return new Promise<ConfigProvidersResponse>((resolve, reject) => {
      const urlObj = new URL(`${this.serverUrl}/config/providers`);

      const req = http.request(
        urlObj,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          timeout: 10000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const responseText = buffer.toString("utf-8");

            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Failed to fetch providers: ${res.statusCode}`));
              return;
            }

            try {
              const data = JSON.parse(responseText) as ConfigProvidersResponse;
              resolve(data);
            } catch {
              reject(new Error("Failed to parse provider response"));
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out while fetching providers"));
      });

      req.on("error", (err) => {
        console.error("[OpenCodeService] Failed to fetch providers:", err);
        reject(err);
      });

      req.end();
    });
  }
}
