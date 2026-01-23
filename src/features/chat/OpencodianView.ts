/**
 * Opencodian View - Main chat interface
 */

import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
  MarkdownRenderer,
  TFolder,
} from "obsidian";
import type OpencodianPlugin from "../../main";
import { VIEW_TYPE_OPENCODIAN, processProviders } from "../../core/types";
import type {
  ToolCallInfo,
  MentionInfo,
  ProviderWithModels,
  ModelOption,
} from "../../core/types";
import type { MentionContext } from "../../core/agent/OpenCodeService";
import { FileMention } from "./FileMention";

/** Track active tool blocks during streaming */
interface ToolBlock {
  el: HTMLElement;
  headerEl: HTMLElement;
  contentEl: HTMLElement;
  isCollapsed: boolean;
}

export class OpencodianView extends ItemView {
  plugin: OpencodianPlugin;
  private mainContainerEl: HTMLElement;
  private messagesEl: HTMLElement;
  private historyDropdownEl: HTMLElement;
  private historyBtnEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private isHistoryOpen: boolean = false;

  /** Model selector elements */
  private modelSelectorEl: HTMLElement;
  private modelDropdownEl: HTMLElement;
  private modelButtonEl: HTMLElement;
  private isModelDropdownOpen: boolean = false;

  /** Two-level dropdown state */
  private providers: ProviderWithModels[] = [];
  private selectedProvider: ProviderWithModels | null = null;
  private isLoadingProviders: boolean = false;
  private providersLoaded: boolean = false;

  /** Map tool invocation IDs to their UI elements */
  private activeToolBlocks: Map<string, ToolBlock> = new Map();
  private currentThinkingBlock: ToolBlock | null = null;

  /** Send button state */
  private sendButtonEl: HTMLButtonElement;
  private isGenerating: boolean = false;

  /** File mention system */
  private fileMention: FileMention | null = null;

  /** Inline edit state */
  private editingMessageId: string | null = null;
  private suppressAutoScroll: boolean = false;

  private createMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  constructor(leaf: WorkspaceLeaf, plugin: OpencodianPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_OPENCODIAN;
  }

  getDisplayText(): string {
    return "Opencodian";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("opencodian-view");

    // Create main container
    this.mainContainerEl = container.createDiv({ cls: "opencodian-container" });

    // ========== HEADER ==========
    const headerEl = this.mainContainerEl.createDiv({
      cls: "opencodian-header",
    });

    // Left: Title
    const titleEl = headerEl.createDiv({ cls: "opencodian-title" });
    titleEl.setText("Opencodian");

    // Right: Action buttons
    const actionsEl = headerEl.createDiv({ cls: "opencodian-actions" });

    // History button (clock icon)
    this.historyBtnEl = actionsEl.createDiv({
      cls: "opencodian-action-btn",
      attr: { "aria-label": "History" },
    });
    setIcon(this.historyBtnEl, "clock");
    this.historyBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    // New chat button (plus icon)
    const newChatBtn = actionsEl.createDiv({
      cls: "opencodian-action-btn",
      attr: { "aria-label": "New Chat" },
    });
    setIcon(newChatBtn, "plus");
    newChatBtn.addEventListener("click", async () => {
      await this.plugin.createConversation();
      await this.refreshView();
    });

    // ========== HISTORY DROPDOWN ==========
    this.historyDropdownEl = this.mainContainerEl.createDiv({
      cls: "opencodian-history-dropdown",
    });
    this.historyDropdownEl.style.display = "none";

    // Dropdown list container
    this.historyDropdownEl.createDiv({ cls: "dropdown-list" });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (
        this.isHistoryOpen &&
        !this.historyDropdownEl.contains(e.target as Node)
      ) {
        this.toggleHistoryDropdown(false);
      }
    });

    // ========== MESSAGES AREA ==========
    this.messagesEl = this.mainContainerEl.createDiv({
      cls: "opencodian-messages",
    });

    // ========== INPUT AREA ==========
    const inputContainer = this.mainContainerEl.createDiv({
      cls: "opencodian-input-container",
    });

    const inputWrapper = inputContainer.createDiv({
      cls: "opencodian-input-wrapper",
    });

    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "opencodian-input",
      attr: {
        placeholder: "How can I help you today?",
        rows: "3",
      },
    });

    // Embedded Toolbar (Model Selector + Send Button)
    const toolbarEl = inputWrapper.createDiv({
      cls: "opencodian-input-toolbar",
    });

    // Left: Model Selector
    this.createModelSelector(toolbarEl);

    // Right: Send Button
    this.sendButtonEl = toolbarEl.createEl("button", {
      cls: "opencodian-send-button",
      attr: { "aria-label": "Send" },
    });
    setIcon(this.sendButtonEl, "arrow-up");

    // Initialize file mention system BEFORE keydown listener
    // so we can check its state
    this.fileMention = new FileMention(
      this.plugin.app,
      this.inputEl,
      inputWrapper,
    );

    // Event listeners
    this.sendButtonEl.addEventListener("click", () =>
      this.handleSendButtonClick(),
    );
    this.inputEl.addEventListener("keydown", (e) => {
      // Don't send if FileMention suggestions are open (user is selecting a file)
      if (this.fileMention?.isSuggestionsOpen()) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSendButtonClick();
      }
    });

    // Auto-resize textarea based on content
    this.inputEl.addEventListener("input", () => this.adjustInputHeight());
    this.adjustInputHeight();

    // Register for file-open events to auto-update active file mention
    this.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => {
        if (this.fileMention) {
          this.fileMention.setActiveFileMention(file ? file.path : null);
        }
      }),
    );

    // Set initial active file if one is open
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (this.fileMention) {
      this.fileMention.setActiveFileMention(
        activeFile ? activeFile.path : null,
      );
    }

    // Initial render
    this.renderHistoryList();
    await this.loadConversation();
  }

  async onClose(): Promise<void> {
    // Cleanup
    if (this.fileMention) {
      this.fileMention.destroy();
      this.fileMention = null;
    }
  }

  // ========== HISTORY DROPDOWN METHODS ==========

  private toggleHistoryDropdown(forceState?: boolean): void {
    this.isHistoryOpen =
      forceState !== undefined ? forceState : !this.isHistoryOpen;
    this.historyDropdownEl.style.display = this.isHistoryOpen ? "flex" : "none";
    this.historyBtnEl.classList.toggle("active", this.isHistoryOpen);

    if (this.isHistoryOpen) {
      this.renderHistoryList();
    }
  }

  private renderHistoryList(): void {
    const listContainer = this.historyDropdownEl.querySelector(
      ".dropdown-list",
    ) as HTMLElement;
    if (!listContainer) return;

    listContainer.empty();

    const conversations = this.plugin.getConversations();
    const activeId = this.plugin.getActiveConversation()?.id;

    for (const conv of conversations) {
      const itemEl = listContainer.createDiv({
        cls: `conversation-item ${conv.id === activeId ? "active" : ""}`,
      });

      // Content
      const contentEl = itemEl.createDiv({ cls: "conversation-content" });

      // Title Logic:
      // Auto-migrate titles that look like default timestamps ONLY if they haven't been customized.
      const firstMessage =
        conv.messages.find((m) => m.role === "user")?.content || "";

      // Default Obsidian/Plugin title format is usually date-based: "Jan 14, 11:34"
      // Heuristic: contains numbers, a colon, and is relatively short.
      const isDefaultDateTitle =
        conv.title.length < 25 &&
        /[0-9]/.test(conv.title) &&
        (conv.title.includes(":") ||
          conv.title.includes("月") ||
          (conv.title.includes(",") && /[0-9]{4}/.test(conv.title)));

      if (firstMessage && isDefaultDateTitle) {
        const newTitle =
          firstMessage.length > 50
            ? firstMessage.substring(0, 50) + "..."
            : firstMessage;
        if (conv.title !== newTitle) {
          conv.title = newTitle;
          this.plugin.saveConversation(conv);
        }
      }

      contentEl.createDiv({
        text: conv.title || "New Chat",
        cls: "conversation-title",
      });

      // Secondary info (Date)
      const dateStr = this.formatDate(conv.updatedAt);
      contentEl.createDiv({ text: dateStr, cls: "conversation-subtitle" });

      // Actions (rename, delete)
      const actionsEl = itemEl.createDiv({ cls: "conversation-actions" });

      // Rename button
      const renameBtn = actionsEl.createDiv({
        cls: "conversation-action-btn",
        attr: { "aria-label": "Rename" },
      });
      setIcon(renameBtn, "pencil");
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showInlineRename(itemEl, conv.id, conv.title);
      });

      // Delete button
      const deleteBtn = actionsEl.createDiv({
        cls: "conversation-action-btn danger",
        attr: { "aria-label": "Delete" },
      });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.showDeleteConfirm(conv.id);
      });

      // Click to switch (on entire item, excluding actions)
      itemEl.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;
        if (
          target.closest(".conversation-actions") ||
          target.closest(".conversation-action-btn")
        ) {
          return; // Ignore clicks on action buttons or their container
        }
        e.stopPropagation();
        await this.plugin.switchConversation(conv.id);
        this.toggleHistoryDropdown(false);
        await this.refreshView();
      });
    }
  }

  private showInlineRename(
    itemEl: HTMLElement,
    convId: string,
    currentTitle: string,
  ): void {
    const titleEl = itemEl.querySelector(".conversation-title") as HTMLElement;
    const actionsEl = itemEl.querySelector(
      ".conversation-actions",
    ) as HTMLElement;
    if (!titleEl) return;

    // Hide actions
    if (actionsEl) {
      actionsEl.style.display = "none";
    }

    // Create input element
    const input = document.createElement("input");
    input.type = "text";
    input.className = "conversation-rename-input";
    input.value = currentTitle;

    // Replace title with input
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      const newTitle = input.value.trim() || currentTitle;
      await this.plugin.renameConversation(convId, newTitle);
      this.renderHistoryList();
    };

    input.addEventListener("blur", finishRename);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        input.value = currentTitle;
        input.blur();
      }
    });

    // Prevent click from bubbling to item (which would switch conversation)
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  private async showDeleteConfirm(convId: string): Promise<void> {
    if (confirm("Delete this conversation?")) {
      await this.plugin.deleteConversation(convId);
      this.renderHistoryList();
      await this.refreshView();
    }
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  // ========== CONVERSATION METHODS ==========

  private async refreshView(): Promise<void> {
    this.renderHistoryList();
    await this.loadConversation();
  }

  private async loadConversation(
    scrollToBottom: boolean = true,
  ): Promise<void> {
    const conv = this.plugin.getActiveConversation();
    this.messagesEl.empty();

    if (!conv || conv.messages.length === 0) {
      this.showWelcomeMessage();
      return;
    }

    for (let idx = 0; idx < conv.messages.length; idx++) {
      const msg = conv.messages[idx];

      // Backward compatibility: old data stored errors as standalone messages.
      if (msg.type === "error") {
        this.addErrorMessage(msg.content);
        continue;
      }

      const msgEl = this.addMessage(
        msg.id,
        msg.role,
        msg.content,
        msg.toolCalls,
        msg.mentions,
      );

      if (msg.errors && msg.errors.length > 0) {
        const contentEl = msgEl.querySelector(
          ".message-content",
        ) as HTMLElement | null;
        if (contentEl) {
          for (const e of msg.errors) {
            this.appendErrorBlock(contentEl, e);
          }
        }
      }
    }

    if (scrollToBottom) {
      this.scrollToBottom();
    }
  }

  /**
   * Handle send button click - either send message or cancel generation
   */
  private handleSendButtonClick(): void {
    if (this.isGenerating) {
      // Cancel the current generation
      this.plugin.agentService.cancel();
      this.setGeneratingState(false);
    } else {
      // Send the message
      this.handleSend();
    }
  }

  /**
   * Update the send button state
   */
  private setGeneratingState(generating: boolean): void {
    this.isGenerating = generating;

    if (generating) {
      this.sendButtonEl.classList.add("generating");
      this.sendButtonEl.setAttribute("aria-label", "Stop");
      this.sendButtonEl.empty();
      // Create loading spinner
      const spinnerEl = document.createElement("div");
      spinnerEl.className = "opencodian-spinner";
      this.sendButtonEl.appendChild(spinnerEl);
    } else {
      this.sendButtonEl.classList.remove("generating");
      this.sendButtonEl.setAttribute("aria-label", "Send");
      this.sendButtonEl.empty();
      setIcon(this.sendButtonEl, "arrow-up");
    }
  }

  private async handleSend(): Promise<void> {
    await this.sendUserMessage(this.inputEl.value, undefined);
  }

  private async sendUserMessage(
    rawText: string,
    mentionItems?: Array<{ path: string; name: string; isFolder: boolean }>,
  ): Promise<void> {
    const text = rawText.trim();
    if (!text) return;

    const mentionItemsFinal =
      mentionItems ??
      (this.fileMention ? this.fileMention.getMentionsAndClear() : []);

    this.inputEl.value = "";
    this.adjustInputHeight(); // Reset height after clearing

    // Convert to MentionInfo for storage
    const mentions: MentionInfo[] = mentionItemsFinal.map((m) => ({
      path: m.path,
      name: m.name,
      isFolder: m.isFolder,
    }));

    // Build rich MentionContext with folder children
    const mentionContexts: MentionContext[] = mentionItemsFinal.map((m) => {
      const ctx: MentionContext = {
        path: m.path,
        name: m.name,
        isFolder: m.isFolder,
      };

      // For folders, list their direct children
      if (m.isFolder) {
        const folder = this.plugin.app.vault.getAbstractFileByPath(m.path);
        if (folder instanceof TFolder) {
          ctx.children = folder.children.map((c) => c.name);
        }
      }

      return ctx;
    });

    // Set generating state
    this.setGeneratingState(true);

    // Clear welcome message if present
    this.clearWelcomeMessage();

    // Save to conversation
    const conv = this.plugin.getActiveConversation();
    const messageId = this.createMessageId();

    // Add user message to UI (with mentions badge)
    this.addMessage(
      messageId,
      "user",
      text,
      undefined,
      mentions.length > 0 ? mentions : undefined,
    );
    if (conv) {
      conv.messages.push({
        id: messageId,
        role: "user",
        type: "message",
        content: text,
        timestamp: Date.now(),
        mentions: mentions.length > 0 ? mentions : undefined,
      });

      // Auto-title: If this is the first user message and title is default/empty, update it
      // We check if message count is 1 (just added this one) or small enough to be start
      if (conv.messages.filter((m) => m.role === "user").length === 1) {
        const newTitle =
          text.length > 50 ? text.substring(0, 50) + "..." : text;
        conv.title = newTitle;
      }

      await this.plugin.saveConversation(conv);
    }

    // Create assistant message placeholder
    const assistantMsgEl = this.addMessage(null, "assistant", "");
    const bubbleEl = assistantMsgEl.querySelector(
      ".message-bubble",
    ) as HTMLElement;
    const contentEl = assistantMsgEl.querySelector(
      ".message-content",
    ) as HTMLElement;

    // Placeholder shown until the first real assistant content/tool event arrives.
    const workingEl = document.createElement("div");
    workingEl.className = "opencodian-working";
    workingEl.textContent = "Working on it...";
    contentEl.appendChild(workingEl);

    // Immediately scroll to show the working placeholder
    this.scrollToBottom();

    const clearWorking = () => {
      if (workingEl.parentElement) workingEl.remove();
    };

    // Reset streaming state
    this.activeToolBlocks.clear();

    // Track response state at outer scope so catch block can access
    let fullResponse = "";
    const toolCallsById = new Map<string, ToolCallInfo>();
    const errorAcc: string[] = [];
    let mdRenderTimer: number | null = null;

    try {
      // Markdown streaming: render incrementally with a debounce to preserve the
      // "streaming" feel without re-rendering on every token.
      let mdRenderInFlight = false;
      let mdRenderQueued = false;
      let lastRendered = "";
      let hasRenderedMarkdown = false;

      const scheduleMarkdownRender = () => {
        mdRenderQueued = true;
        if (mdRenderTimer !== null) {
          window.clearTimeout(mdRenderTimer);
        }
        mdRenderTimer = window.setTimeout(() => {
          mdRenderTimer = null;
          void (async () => {
            if (mdRenderInFlight) return;
            if (!mdRenderQueued) return;

            mdRenderQueued = false;
            const toRender = fullResponse;
            if (toRender === lastRendered) return;

            mdRenderInFlight = true;
            try {
              await this.renderMarkdown(toRender, contentEl);
              hasRenderedMarkdown = true;
              lastRendered = toRender;
            } finally {
              mdRenderInFlight = false;
            }

            this.scrollToBottom();

            if (mdRenderQueued) {
              scheduleMarkdownRender();
            }
          })();
        }, 80);
      };

      // Initial loading indicator?
      // contentEl.innerHTML = '<span class="loading-dots">...</span>';

      for await (const chunk of this.plugin.agentService.query(
        text,
        undefined,
        conv?.messages,

        {
          model: this.plugin.settings.model,
          mentionContexts:
            mentionContexts.length > 0 ? mentionContexts : undefined,
        },
      )) {
        if (chunk.type === "text") {
          clearWorking();

          fullResponse += chunk.content;
          if (!hasRenderedMarkdown) {
            // Show plain text immediately until the first markdown render happens.
            contentEl.textContent = fullResponse;
          }
          scheduleMarkdownRender();
          this.scrollToBottom();
        } else if (chunk.type === "tool_use") {
          clearWorking();

          this.renderToolUseBlock(
            bubbleEl,
            contentEl,
            chunk.toolName,
            chunk.input,
            chunk.toolUseId,
          );

          // Persist tool call info (but NOT tool results / thinking).
          toolCallsById.set(chunk.toolUseId, {
            toolUseId: chunk.toolUseId,
            toolName: chunk.toolName,
            summary: this.getToolInputSummary(chunk.toolName, chunk.input),
            input: this.sanitizeToolInput(chunk.input),
          });
          this.scrollToBottom();
        } else if (chunk.type === "tool_result") {
          clearWorking();
          scheduleMarkdownRender();
          this.renderToolResultBlock(chunk.toolUseId, chunk.result);
          this.scrollToBottom();
        } else if (chunk.type === "error") {
          clearWorking();

          // Append error to content (works for both partial and empty responses)
          this.appendError(contentEl, chunk.content);

          // Track errors on the assistant message (persisted at the end).
          if (!errorAcc.includes(chunk.content)) {
            errorAcc.push(chunk.content);
          }

          this.scrollToBottom();
        } else if (chunk.type === "done") {
          clearWorking();
          if (mdRenderTimer !== null) {
            window.clearTimeout(mdRenderTimer);
            mdRenderTimer = null;
          }

          // If we only rendered plain text during streaming, the last markdown render
          // might have been skipped. Render once at the end.
          if (fullResponse) {
            await this.renderMarkdown(fullResponse, contentEl);
            hasRenderedMarkdown = true;
          }

          // If we received no response at all, show a user-visible error and track it.
          if (!fullResponse.trim()) {
            const message = "No response received. Please try again.";
            this.appendError(contentEl, message);

            if (!errorAcc.includes(message)) {
              errorAcc.push(message);
            }
          }

          // Persist the assistant message even if empty (so users can see the error block in history)
          if (conv) {
            conv.messages.push({
              id: this.createMessageId(),
              role: "assistant",
              type: "message",
              content: fullResponse,
              timestamp: Date.now(),
              toolCalls: Array.from(toolCallsById.values()),
              errors: errorAcc.length > 0 ? errorAcc : undefined,
            });
            await this.plugin.saveConversation(conv);
          }

          // Reset generating state
          this.setGeneratingState(false);
        }
      }
    } catch (error) {
      clearWorking();

      // Get the error message
      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      console.error("[OpencodianView] Error during message generation:", {
        error: errorMsg,
        hasPartialResponse: fullResponse.trim().length > 0,
      });

      // Check if we have accumulated any response content
      const hasPartialResponse = fullResponse.trim().length > 0;

      if (hasPartialResponse) {
        // Preserve the partial response - render what we have
        if (mdRenderTimer !== null) {
          window.clearTimeout(mdRenderTimer);
          mdRenderTimer = null;
        }
        await this.renderMarkdown(fullResponse, contentEl);
      } else {
        // No content yet - clear the placeholder
        contentEl.empty();
      }

      // Always append error using unified method
      this.appendError(contentEl, errorMsg);

      // Save the partial response to conversation (if any content exists)
      if (conv && hasPartialResponse) {
        conv.messages.push({
          id: this.createMessageId(),
          role: "assistant",
          type: "message",
          content: fullResponse,
          timestamp: Date.now(),
          toolCalls: Array.from(toolCallsById.values()),
        });
        await this.plugin.saveConversation(conv);
      }

      // Persist the error on the assistant message (same turn).
      if (!errorAcc.includes(errorMsg)) {
        errorAcc.push(errorMsg);
      }

      if (conv) {
        const msg = conv.messages[conv.messages.length - 1];
        if (msg && msg.role === "assistant" && msg.type === "message") {
          const merged = this.mergeErrors(msg.errors, errorAcc);
          msg.errors = merged.length > 0 ? merged : undefined;
          await this.plugin.saveConversation(conv);
        } else {
          conv.messages.push({
            id: this.createMessageId(),
            role: "assistant",
            type: "message",
            content: fullResponse,
            timestamp: Date.now(),
            toolCalls: Array.from(toolCallsById.values()),
            errors: errorAcc.length > 0 ? errorAcc : undefined,
          });
          await this.plugin.saveConversation(conv);
        }
      }

      this.scrollToBottom();

      // CRITICAL: Always reset generating state on error
      this.setGeneratingState(false);
    } finally {
      // Ensure generating state is always reset, even if error handling fails
      if (this.isGenerating) {
        console.warn(
          "[OpencodianView] Generating state still active in finally block - forcing reset",
        );
        this.setGeneratingState(false);
      }
    }
  }

  private formatToolName(toolName: string): string {
    const t = (toolName || "").trim();
    if (!t) return toolName;
    const lower = t.toLowerCase();
    return lower[0].toUpperCase() + lower.slice(1);
  }

  private scrollToBottom(force: boolean = false): void {
    if (this.suppressAutoScroll && !force) return;
    this.messagesEl.scrollTo({
      top: this.messagesEl.scrollHeight,
      behavior: "smooth",
    });
  }

  private getMessageIndex(messageId: string): number {
    const conv = this.plugin.getActiveConversation();
    if (!conv) return -1;
    return conv.messages.findIndex((m) => m.id === messageId);
  }

  private async editAndResend(messageId: string, text: string): Promise<void> {
    await this.pruneAndSend(messageId, text);
  }

  private async regenerateFrom(messageId: string): Promise<void> {
    const conv = this.plugin.getActiveConversation();
    if (!conv) return;

    const idx = this.getMessageIndex(messageId);
    if (idx < 0) return;

    const msg = conv.messages[idx];
    if (!msg || msg.role !== "user") return;

    await this.pruneAndSend(messageId, msg.content);
  }

  private async pruneAndSend(messageId: string, text: string): Promise<void> {
    if (this.isGenerating) {
      this.plugin.agentService.cancel();
      this.setGeneratingState(false);
    }

    const conv = this.plugin.getActiveConversation();
    if (!conv) return;

    const resolvedIdx = this.getMessageIndex(messageId);
    if (resolvedIdx < 0 || resolvedIdx >= conv.messages.length) return;

    const original = conv.messages[resolvedIdx];
    if (original.role !== "user") return;

    const messages = conv.messages.slice(0, resolvedIdx);

    const nextUser = {
      id: original.id,
      role: "user" as const,
      type: "message" as const,
      content: text,
      timestamp: Date.now(),
      mentions: original.mentions,
    };

    conv.messages = [...messages, nextUser];
    conv.updatedAt = Date.now();
    await this.plugin.saveConversation(conv);

    // Hard refresh: ensure old branch disappears immediately.
    this.activeToolBlocks.clear();
    this.currentThinkingBlock = null;
    await this.loadConversation();

    this.setGeneratingState(true);

    const assistantMsgEl = this.addMessage(null, "assistant", "");
    const bubbleEl = assistantMsgEl.querySelector(
      ".message-bubble",
    ) as HTMLElement;
    const contentEl = assistantMsgEl.querySelector(
      ".message-content",
    ) as HTMLElement;

    const workingEl = document.createElement("div");
    workingEl.className = "opencodian-working";
    workingEl.textContent = "Working on it...";
    contentEl.appendChild(workingEl);
    this.scrollToBottom();

    const clearWorking = () => {
      if (workingEl.parentElement) workingEl.remove();
    };

    let fullResponse = "";
    const toolCallsById = new Map<string, ToolCallInfo>();
    const errorAcc: string[] = [];
    let mdRenderTimer: number | null = null;

    try {
      let mdRenderInFlight = false;
      let mdRenderQueued = false;
      let lastRendered = "";
      let hasRenderedMarkdown = false;

      const scheduleMarkdownRender = () => {
        mdRenderQueued = true;
        if (mdRenderTimer !== null) {
          window.clearTimeout(mdRenderTimer);
        }
        mdRenderTimer = window.setTimeout(() => {
          mdRenderTimer = null;
          void (async () => {
            if (mdRenderInFlight) return;
            if (!mdRenderQueued) return;

            mdRenderQueued = false;
            const toRender = fullResponse;
            if (toRender === lastRendered) return;

            mdRenderInFlight = true;
            try {
              await this.renderMarkdown(toRender, contentEl);
              hasRenderedMarkdown = true;
              lastRendered = toRender;
            } finally {
              mdRenderInFlight = false;
            }

            this.scrollToBottom();

            if (mdRenderQueued) {
              scheduleMarkdownRender();
            }
          })();
        }, 80);
      };

      for await (const chunk of this.plugin.agentService.query(
        text,
        undefined,
        conv.messages,
        {
          model: this.plugin.settings.model,
        },
      )) {
        if (chunk.type === "text") {
          clearWorking();

          fullResponse += chunk.content;
          if (!hasRenderedMarkdown) {
            contentEl.textContent = fullResponse;
          }
          scheduleMarkdownRender();
          this.scrollToBottom();
          continue;
        }

        if (chunk.type === "tool_use") {
          clearWorking();

          this.renderToolUseBlock(
            bubbleEl,
            contentEl,
            chunk.toolName,
            chunk.input,
            chunk.toolUseId,
          );

          toolCallsById.set(chunk.toolUseId, {
            toolUseId: chunk.toolUseId,
            toolName: chunk.toolName,
            summary: this.getToolInputSummary(chunk.toolName, chunk.input),
            input: this.sanitizeToolInput(chunk.input),
          });
          this.scrollToBottom();
          continue;
        }

        if (chunk.type === "tool_result") {
          clearWorking();
          scheduleMarkdownRender();
          this.renderToolResultBlock(chunk.toolUseId, chunk.result);
          this.scrollToBottom();
          continue;
        }

        if (chunk.type === "error") {
          clearWorking();

          this.appendError(contentEl, chunk.content);
          if (!errorAcc.includes(chunk.content)) {
            errorAcc.push(chunk.content);
          }

          this.scrollToBottom();
          continue;
        }

        if (chunk.type === "done") {
          clearWorking();
          if (mdRenderTimer !== null) {
            window.clearTimeout(mdRenderTimer);
            mdRenderTimer = null;
          }

          if (fullResponse) {
            await this.renderMarkdown(fullResponse, contentEl);
            hasRenderedMarkdown = true;
          }

          if (!fullResponse.trim()) {
            const message = "No response received. Please try again.";
            this.appendError(contentEl, message);
            if (!errorAcc.includes(message)) {
              errorAcc.push(message);
            }
          }

          conv.messages.push({
            id: this.createMessageId(),
            role: "assistant",
            type: "message",
            content: fullResponse,
            timestamp: Date.now(),
            toolCalls: Array.from(toolCallsById.values()),
            errors: errorAcc.length > 0 ? errorAcc : undefined,
          });
          await this.plugin.saveConversation(conv);

          this.setGeneratingState(false);
        }
      }
    } catch (error) {
      clearWorking();

      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      const hasPartialResponse = fullResponse.trim().length > 0;

      if (hasPartialResponse) {
        if (mdRenderTimer !== null) {
          window.clearTimeout(mdRenderTimer);
          mdRenderTimer = null;
        }
        await this.renderMarkdown(fullResponse, contentEl);
      } else {
        contentEl.empty();
      }

      this.appendError(contentEl, errorMsg);

      if (!errorAcc.includes(errorMsg)) {
        errorAcc.push(errorMsg);
      }

      conv.messages.push({
        id: this.createMessageId(),
        role: "assistant",
        type: "message",
        content: fullResponse,
        timestamp: Date.now(),
        toolCalls: Array.from(toolCallsById.values()),
        errors: errorAcc.length > 0 ? errorAcc : undefined,
      });

      await this.plugin.saveConversation(conv);

      this.scrollToBottom();
      this.setGeneratingState(false);
    } finally {
      if (this.isGenerating) {
        this.setGeneratingState(false);
      }
    }
  }

  /**
   * Append error message to content area with left-border style.
   * This is the unified error display method - all errors flow through here.
   */
  private appendError(contentEl: HTMLElement, message: string): void {
    this.appendErrorBlock(contentEl, message);
  }

  private appendErrorBlock(
    contentEl: HTMLElement,
    message: string,
  ): HTMLElement {
    const errorEl = document.createElement("div");
    errorEl.className = "opencodian-error-message";
    errorEl.textContent = message;
    contentEl.appendChild(errorEl);
    return errorEl;
  }

  private mergeErrors(
    existing: string[] | undefined,
    incoming: string[],
  ): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const e of existing || []) {
      const text = e.trim();
      if (!text) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      merged.push(text);
    }

    for (const e of incoming) {
      const text = e.trim();
      if (!text) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      merged.push(text);
    }

    // Bound size to avoid unbounded growth during flaky connections.
    const MAX_ERRORS = 10;
    return merged.slice(-MAX_ERRORS);
  }

  /**
   * Adjust textarea height based on content (auto-resize)
   */
  private adjustInputHeight(): void {
    const minHeight = 60;
    const maxHeight = 200;

    // Reset height to auto to get the actual scrollHeight
    this.inputEl.style.height = "auto";

    // Calculate new height within bounds
    const scrollHeight = this.inputEl.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);

    this.inputEl.style.height = `${newHeight}px`;
  }

  // ========== UI HELPERS ==========

  private addErrorMessage(message: string): HTMLElement {
    const msgEl = this.messagesEl.createDiv({
      cls: "message message-assistant",
    });

    const roleEl = msgEl.createDiv({ cls: "message-role" });
    roleEl.textContent = "OpenCode";

    const bubbleEl = msgEl.createDiv({ cls: "message-bubble" });
    const contentEl = bubbleEl.createDiv({ cls: "message-content" });
    this.appendErrorBlock(contentEl, message);

    this.scrollToBottom();
    return msgEl;
  }

  private addMessage(
    messageId: string | null,
    role: "user" | "assistant",
    content: string,
    toolCalls?: ToolCallInfo[],
    mentions?: MentionInfo[],
  ): HTMLElement {
    const msgEl = this.messagesEl.createDiv({
      cls: `message message-${role}`,
      attr: messageId ? { "data-message-id": messageId } : undefined,
    });

    const roleEl = msgEl.createDiv({ cls: "message-role" });
    roleEl.textContent = role === "user" ? "You" : "OpenCode";

    const bubbleEl = msgEl.createDiv({ cls: "message-bubble" });

    const hotzoneEl =
      role === "user"
        ? bubbleEl.createDiv({ cls: "opencodian-message-hotzone" })
        : bubbleEl;

    // Render mentions badge above content for user messages
    if (role === "user" && mentions && mentions.length > 0) {
      const mentionsEl = hotzoneEl.createDiv({ cls: "message-mentions" });
      for (const mention of mentions) {
        const chipEl = mentionsEl.createDiv({
          cls: "message-mention-chip message-mention-chip-clickable",
        });
        chipEl.title = mention.path;
        chipEl.style.cursor = "pointer";

        // Make chip clickable to open file
        chipEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openMentionedFile(mention.path, mention.isFolder);
        });

        const iconEl = chipEl.createSpan({ cls: "message-mention-icon" });
        setIcon(iconEl, mention.isFolder ? "folder" : "file-text");

        const nameEl = chipEl.createSpan({ cls: "message-mention-name" });
        nameEl.textContent = mention.name;
      }
    }

    const contentEl = hotzoneEl.createDiv({ cls: "message-content" });

    if (role === "user" && messageId) {
      this.addUserMessageActions(hotzoneEl, messageId, content);
    }

    if (role === "assistant" && toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        this.renderHistoricalToolCallBlock(bubbleEl, contentEl, call);
      }
    }

    if (content) {
      if (role === "assistant") {
        // Render assistant responses as markdown.
        void this.renderMarkdown(content, contentEl);
      } else {
        contentEl.textContent = content;
      }
    }

    this.scrollToBottom();

    return msgEl;
  }

  private renderHistoricalToolCallBlock(
    bubbleEl: HTMLElement,
    beforeEl: HTMLElement,
    call: ToolCallInfo,
  ): void {
    const blockEl = document.createElement("div");
    blockEl.className = "tool-block collapsed";
    blockEl.setAttribute("data-tool-id", call.toolUseId);

    const headerEl = document.createElement("div");
    headerEl.className = "tool-header";

    const iconEl = document.createElement("span");
    iconEl.className = "tool-icon";
    setIcon(iconEl, this.getToolIcon(call.toolName));

    const labelEl = document.createElement("span");
    labelEl.className = "tool-label";
    {
      const name = this.formatToolName(call.toolName);
      labelEl.textContent = call.summary ? `${name}: ${call.summary}` : name;
    }

    const statusEl = document.createElement("span");
    statusEl.className = "tool-status done";
    statusEl.textContent = "Done";

    const chevronEl = document.createElement("span");
    chevronEl.className = "tool-chevron";
    setIcon(chevronEl, "chevron-right");

    headerEl.appendChild(iconEl);
    headerEl.appendChild(labelEl);
    headerEl.appendChild(statusEl);
    headerEl.appendChild(chevronEl);

    const contentEl = document.createElement("div");
    contentEl.className = "tool-content";

    const inputSection = document.createElement("div");
    inputSection.className = "tool-section";

    const inputLabel = document.createElement("div");
    inputLabel.className = "tool-section-label";
    inputLabel.textContent = "Input";

    const inputCode = document.createElement("pre");
    inputCode.className = "tool-code";
    inputCode.textContent = JSON.stringify(call.input ?? {}, null, 2);

    inputSection.appendChild(inputLabel);
    inputSection.appendChild(inputCode);
    contentEl.appendChild(inputSection);

    blockEl.appendChild(headerEl);
    blockEl.appendChild(contentEl);

    headerEl.addEventListener("click", () => {
      const isCollapsed = blockEl.classList.toggle("collapsed");
      setIcon(chevronEl, isCollapsed ? "chevron-right" : "chevron-down");
    });

    bubbleEl.insertBefore(blockEl, beforeEl);
  }

  private getToolInputSummary(
    toolName: string,
    input: Record<string, unknown>,
  ): string | undefined {
    const t = (toolName || "").toLowerCase();
    const getStr = (k: string) => {
      const v = (input as any)?.[k];
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };

    if (t === "bash") return getStr("command") || getStr("cmd");
    if (t === "read")
      return (
        getStr("filePath") ||
        getStr("file_path") ||
        getStr("path") ||
        getStr("file")
      );
    if (t === "grep") return getStr("pattern") || getStr("query");
    if (t === "glob") {
      const p = (input as any)?.patterns;
      if (Array.isArray(p) && p.length > 0) return p.join(", ");
      return getStr("pattern");
    }
    if (t === "websearch") return getStr("query");
    if (t === "webfetch" || t === "fetchurl") return getStr("url");
    if (t === "skill") return getStr("name");

    return undefined;
  }

  private sanitizeToolInput(
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const maxString = 500;
    const maxArray = 50;
    const maxDepth = 4;

    const sanitize = (value: unknown, depth: number): unknown => {
      if (depth > maxDepth) return "[truncated]";
      if (value == null) return value;
      if (typeof value === "string") {
        if (value.length <= maxString) return value;
        return value.slice(0, maxString) + "…";
      }
      if (typeof value === "number" || typeof value === "boolean") return value;
      if (Array.isArray(value)) {
        const sliced = value.slice(0, maxArray);
        const mapped = sliced.map((v) => sanitize(v, depth + 1));
        if (value.length > maxArray) mapped.push("…");
        return mapped;
      }
      if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          out[k] = sanitize(v, depth + 1);
        }
        return out;
      }
      return String(value);
    };

    return (sanitize(input, 0) as Record<string, unknown>) ?? {};
  }

  private async renderMarkdown(
    content: string,
    container: HTMLElement,
  ): Promise<void> {
    container.addClass("opencodian-markdown");
    container.empty();
    try {
      await MarkdownRenderer.render(
        this.plugin.app,
        content,
        container,
        "",
        this,
      );
    } catch {
      // Fallback to plain text
      container.removeClass("opencodian-markdown");
      container.textContent = content;
    }
  }

  private addSystemMessage(content: string): void {
    const msgEl = this.messagesEl.createDiv({ cls: "message message-system" });
    msgEl.textContent = content;
  }

  private addUserMessageActions(
    hotzoneEl: HTMLElement,
    messageId: string,
    content: string,
  ): void {
    if (this.editingMessageId === messageId) return;

    const actionsEl = hotzoneEl.createDiv({
      cls: "opencodian-message-actions",
    });

    const editBtn = actionsEl.createDiv({
      cls: "opencodian-message-action-btn",
      attr: { "aria-label": "Edit" },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.startInlineEdit(messageId, content);
    });

    const regenBtn = actionsEl.createDiv({
      cls: "opencodian-message-action-btn",
      attr: { "aria-label": "Regenerate" },
    });
    setIcon(regenBtn, "rotate-ccw");
    regenBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.regenerateFrom(messageId);
    });
  }

  private async startInlineEdit(
    messageId: string,
    content: string,
  ): Promise<void> {
    this.editingMessageId = messageId;

    // Capture scroll position BEFORE loadConversation changes the DOM
    const currentScroll = this.messagesEl.scrollTop;

    // Suppress auto-scroll during the initial load to maintain position
    this.suppressAutoScroll = true;
    await this.loadConversation(false);
    this.messagesEl.scrollTo({ top: currentScroll, behavior: "auto" });
    this.suppressAutoScroll = false;

    const msgEl = this.messagesEl.querySelector(
      `.message-user[data-message-id="${messageId}"]`,
    ) as HTMLElement | null;
    if (!msgEl) {
      this.editingMessageId = null;
      return;
    }

    const hotzoneEl = msgEl.querySelector(
      ".opencodian-message-hotzone",
    ) as HTMLElement | null;
    if (!hotzoneEl) {
      this.editingMessageId = null;
      return;
    }

    hotzoneEl.empty();

    const editorEl = hotzoneEl.createDiv({ cls: "opencodian-inline-editor" });
    const inputEl = editorEl.createEl("textarea");
    inputEl.value = content;

    // Actions now live outside the editor box, mimicking the original message actions bar
    const actionsEl = hotzoneEl.createDiv({
      cls: "opencodian-inline-editor-actions",
    });

    const cancelEl = actionsEl.createDiv({
      cls: "opencodian-inline-editor-btn",
      attr: { "aria-label": "Cancel" },
    });
    setIcon(cancelEl, "x");

    const sendEl = actionsEl.createDiv({
      cls: "opencodian-inline-editor-btn primary",
      attr: { "aria-label": "Send" },
    });
    setIcon(sendEl, "arrow-up");

    const adjustHeight = (): void => {
      inputEl.style.height = "auto";
      const minHeight = 24;
      const maxHeight = 200;
      inputEl.style.height = `${Math.min(Math.max(inputEl.scrollHeight, minHeight), maxHeight)}px`;
    };

    adjustHeight();
    inputEl.addEventListener("input", adjustHeight);

    const cancel = async (): Promise<void> => {
      if (this.editingMessageId !== messageId) return;
      this.editingMessageId = null;
      this.suppressAutoScroll = true;
      await this.loadConversation(false);
      this.messagesEl.scrollTo({ top: currentScroll, behavior: "auto" });
      this.suppressAutoScroll = false;
    };

    const send = async (): Promise<void> => {
      const text = inputEl.value.trim();
      if (!text) return;
      if (this.editingMessageId !== messageId) return;
      this.editingMessageId = null;
      await this.editAndResend(messageId, text);
    };

    cancelEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void cancel();
    });

    sendEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void send();
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    });

    window.setTimeout(() => {
      inputEl.focus();
      inputEl.selectionStart = inputEl.value.length;
      inputEl.selectionEnd = inputEl.value.length;
    }, 0);
  }

  private showWelcomeMessage(): void {
    const welcomeEl = this.messagesEl.createDiv({ cls: "opencodian-welcome" });
    welcomeEl.textContent = "Opencodian";
  }

  private clearWelcomeMessage(): void {
    const welcomeEl = this.messagesEl.querySelector(".opencodian-welcome");
    if (welcomeEl) {
      welcomeEl.remove();
    }
  }

  /**
   * Open a mentioned file or folder in Obsidian
   */
  private openMentionedFile(path: string, _isFolder: boolean): void {
    if (this.fileMention) {
      this.fileMention.openFile(path);
    }
  }

  // ========== TOOL & THINKING BLOCKS ==========

  /**
   * Render tool invocation block
   */
  private renderThinkingBlock(
    bubbleEl: HTMLElement,
    beforeEl: HTMLElement,
    content: string,
  ): void {
    if (!this.currentThinkingBlock) {
      // Create new thinking block
      const blockEl = document.createElement("div");
      blockEl.className = "thinking-block";

      // Header with toggle
      const headerEl = document.createElement("div");
      headerEl.className = "thinking-header";

      const iconEl = document.createElement("span");
      iconEl.className = "thinking-icon";
      setIcon(iconEl, "brain");

      const labelEl = document.createElement("span");
      labelEl.className = "thinking-label";
      labelEl.textContent = "Thinking...";

      const chevronEl = document.createElement("span");
      chevronEl.className = "thinking-chevron";
      setIcon(chevronEl, "chevron-down");

      headerEl.appendChild(iconEl);
      headerEl.appendChild(labelEl);
      headerEl.appendChild(chevronEl);

      // Content area
      const contentEl = document.createElement("div");
      contentEl.className = "thinking-content";

      blockEl.appendChild(headerEl);
      blockEl.appendChild(contentEl);

      // Insert before the main content
      bubbleEl.insertBefore(blockEl, beforeEl);

      // Toggle handler
      headerEl.addEventListener("click", () => {
        const isCollapsed = blockEl.classList.toggle("collapsed");
        setIcon(chevronEl, isCollapsed ? "chevron-right" : "chevron-down");
        if (this.currentThinkingBlock) {
          this.currentThinkingBlock.isCollapsed = isCollapsed;
        }
      });

      this.currentThinkingBlock = {
        el: blockEl,
        headerEl,
        contentEl,
        isCollapsed: false,
      };
    }

    // Update content
    this.currentThinkingBlock.contentEl.textContent = content;
  }

  /**
   * Render tool use block during streaming
   */
  private renderToolUseBlock(
    bubbleEl: HTMLElement,
    beforeEl: HTMLElement,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ): void {
    // If we already rendered this tool invocation (same id), update it instead of creating a new block.
    // OpenCode can emit multiple updates for the same tool part (e.g. pending -> running), and
    // creating a second block leaves the first stuck in "Running..." forever.
    const existing = this.activeToolBlocks.get(toolUseId);
    if (existing) {
      const labelEl = existing.headerEl.querySelector(
        ".tool-label",
      ) as HTMLElement | null;
      if (labelEl) {
        const summary = this.getToolInputSummary(toolName, input);
        const name = this.formatToolName(toolName);
        labelEl.textContent = summary ? `${name}: ${summary}` : name;
      }

      const iconEl = existing.headerEl.querySelector(
        ".tool-icon",
      ) as HTMLElement | null;
      if (iconEl) setIcon(iconEl, this.getToolIcon(toolName));

      const statusEl = existing.headerEl.querySelector(
        ".tool-status",
      ) as HTMLElement | null;
      if (statusEl) {
        statusEl.textContent = "Running...";
        statusEl.className = "tool-status running";
      }

      const inputCode = existing.contentEl.querySelector(
        "pre.tool-code:not(.tool-result-code)",
      ) as HTMLElement | null;
      if (inputCode) {
        inputCode.textContent = JSON.stringify(input, null, 2);
      }

      return;
    }

    // Create tool block
    const blockEl = document.createElement("div");
    blockEl.className = "tool-block";
    blockEl.setAttribute("data-tool-id", toolUseId);

    // Header
    const headerEl = document.createElement("div");
    headerEl.className = "tool-header";

    const iconEl = document.createElement("span");
    iconEl.className = "tool-icon";
    setIcon(iconEl, this.getToolIcon(toolName));

    const labelEl = document.createElement("span");
    labelEl.className = "tool-label";
    {
      const name = this.formatToolName(toolName);
      const summary = this.getToolInputSummary(toolName, input);
      labelEl.textContent = summary ? `${name}: ${summary}` : name;
    }

    const statusEl = document.createElement("span");
    statusEl.className = "tool-status running";
    statusEl.textContent = "Running...";

    const chevronEl = document.createElement("span");
    chevronEl.className = "tool-chevron";
    setIcon(chevronEl, "chevron-down");

    headerEl.appendChild(iconEl);
    headerEl.appendChild(labelEl);
    headerEl.appendChild(statusEl);
    headerEl.appendChild(chevronEl);

    // Content area (input params)
    const contentEl = document.createElement("div");
    contentEl.className = "tool-content";

    // Input section
    const inputSection = document.createElement("div");
    inputSection.className = "tool-section";

    const inputLabel = document.createElement("div");
    inputLabel.className = "tool-section-label";
    inputLabel.textContent = "Input";

    const inputCode = document.createElement("pre");
    inputCode.className = "tool-code";
    inputCode.textContent = JSON.stringify(input, null, 2);

    inputSection.appendChild(inputLabel);
    inputSection.appendChild(inputCode);
    contentEl.appendChild(inputSection);

    // Result section (placeholder)
    const resultSection = document.createElement("div");
    resultSection.className = "tool-section tool-result-section";
    resultSection.style.display = "none";

    const resultLabel = document.createElement("div");
    resultLabel.className = "tool-section-label";
    resultLabel.textContent = "Result";

    const resultCode = document.createElement("pre");
    resultCode.className = "tool-code tool-result-code";

    resultSection.appendChild(resultLabel);
    resultSection.appendChild(resultCode);
    contentEl.appendChild(resultSection);

    blockEl.appendChild(headerEl);
    blockEl.appendChild(contentEl);

    // Insert before main content
    bubbleEl.insertBefore(blockEl, beforeEl);

    // Toggle handler
    headerEl.addEventListener("click", () => {
      const isCollapsed = blockEl.classList.toggle("collapsed");
      setIcon(chevronEl, isCollapsed ? "chevron-right" : "chevron-down");
      const block = this.activeToolBlocks.get(toolUseId);
      if (block) {
        block.isCollapsed = isCollapsed;
      }
    });

    this.activeToolBlocks.set(toolUseId, {
      el: blockEl,
      headerEl,
      contentEl,
      isCollapsed: false,
    });
  }

  /**
   * Update tool block with result
   */
  private renderToolResultBlock(toolUseId: string, result: string): void {
    const block = this.activeToolBlocks.get(toolUseId);
    if (!block) return;

    // Update status
    const statusEl = block.headerEl.querySelector(".tool-status");
    if (statusEl) {
      statusEl.textContent = "Done";
      statusEl.className = "tool-status done";
    }

    // Show result
    const resultSection = block.contentEl.querySelector(
      ".tool-result-section",
    ) as HTMLElement;
    const resultCode = block.contentEl.querySelector(
      ".tool-result-code",
    ) as HTMLElement;

    if (resultSection && resultCode) {
      resultSection.style.display = "block";
      // Truncate very long results
      const displayResult =
        result.length > 2000
          ? result.substring(0, 2000) + "\n... (truncated)"
          : result;
      resultCode.textContent = displayResult;
    }

    // Auto-collapse after completion
    if (!block.isCollapsed) {
      block.headerEl.click();
    }
  }

  /**
   * Get appropriate icon for tool type
   */
  private getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      read: "file-text",
      Read: "file-text",
      write: "file-plus",
      Write: "file-plus",
      edit: "file-edit",
      Edit: "file-edit",
      bash: "terminal",
      Bash: "terminal",
      glob: "folder-search",
      Glob: "folder-search",
      grep: "search",
      Grep: "search",
      task: "list-todo",
      Task: "list-todo",
      webfetch: "globe",
      WebFetch: "globe",
      skill: "book-open",
      Skill: "book-open",
    };
    return iconMap[toolName] || "wrench";
  }

  // ========== MODEL SELECTOR ==========

  /**
   * Create model selector UI
   */
  private createModelSelector(parentEl: HTMLElement): void {
    this.modelSelectorEl = parentEl.createDiv({
      cls: "opencodian-model-selector",
    });

    // Model button
    this.modelButtonEl = this.modelSelectorEl.createDiv({
      cls: "opencodian-model-btn",
    });

    this.updateModelDisplay();

    this.modelButtonEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleModelDropdown();
    });

    // Dropdown
    this.modelDropdownEl = this.modelSelectorEl.createDiv({
      cls: "opencodian-model-dropdown",
    });
    this.modelDropdownEl.style.display = "none";

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (
        this.isModelDropdownOpen &&
        !this.modelSelectorEl.contains(e.target as Node)
      ) {
        this.toggleModelDropdown(false);
      }
    });
  }

  /**
   * Update model button display
   */
  private updateModelDisplay(labelOverride?: string): void {
    const currentModel = this.plugin.settings.model;
    // Use override if provided, otherwise try to find from loaded providers
    const label = labelOverride || this.findModelLabel(currentModel);

    this.modelButtonEl.empty();

    const iconEl = this.modelButtonEl.createSpan({ cls: "model-icon" });
    setIcon(iconEl, "cpu");

    const labelEl = this.modelButtonEl.createSpan({ cls: "model-label" });
    labelEl.textContent = label;

    const chevronEl = this.modelButtonEl.createSpan({ cls: "model-chevron" });
    setIcon(chevronEl, "chevron-down");
  }

  /**
   * Find model label from loaded providers or extract from model ID
   */
  private findModelLabel(modelId: string): string {
    // Search in loaded providers
    for (const provider of this.providers) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) return model.label;
    }

    // Fallback: extract model name from ID (provider/model-name -> model-name)
    const parts = modelId.split("/");
    if (parts.length === 2) {
      return parts[1];
    }
    return modelId;
  }

  /**
   * Toggle model dropdown
   */
  private toggleModelDropdown(forceState?: boolean): void {
    this.isModelDropdownOpen =
      forceState !== undefined ? forceState : !this.isModelDropdownOpen;
    this.modelDropdownEl.style.display = this.isModelDropdownOpen
      ? "flex"
      : "none";

    if (this.isModelDropdownOpen) {
      // Reset to provider list when opening
      this.selectedProvider = null;
      this.renderDropdownContent();

      // Load providers if not loaded yet
      if (!this.providersLoaded && !this.isLoadingProviders) {
        this.loadProviders();
      }
    }
  }

  /**
   * Load providers from OpenCode server
   */
  private async loadProviders(): Promise<void> {
    if (this.isLoadingProviders) return;

    this.isLoadingProviders = true;
    this.renderDropdownContent();

    try {
      const response = await this.plugin.agentService.getProviders();
      this.providers = processProviders(response);
      this.providersLoaded = true;
    } catch (error) {
      console.error("[OpencodianView] Failed to load providers:", error);
      // On error, show empty state - user needs to configure providers
      this.providers = [];
    } finally {
      this.isLoadingProviders = false;
      this.renderDropdownContent();
    }
  }

  /**
   * Render dropdown content based on current state
   */
  private renderDropdownContent(): void {
    this.modelDropdownEl.empty();

    if (this.isLoadingProviders) {
      this.renderLoadingState();
      return;
    }

    if (this.selectedProvider) {
      this.renderModelList(this.selectedProvider);
    } else {
      this.renderProviderList();
    }
  }

  /**
   * Render loading state
   */
  private renderLoadingState(): void {
    const loadingEl = this.modelDropdownEl.createDiv({
      cls: "opencodian-dropdown-loading",
    });
    loadingEl.textContent = "Loading...";
  }

  /**
   * Render provider list (level 1)
   */
  private renderProviderList(): void {
    // Check if no providers available
    if (this.providers.length === 0) {
      const emptyEl = this.modelDropdownEl.createDiv({
        cls: "opencodian-dropdown-empty",
      });
      emptyEl.textContent = "No providers configured";
      return;
    }

    // --- RECENT MODELS SECTION ---
    const recentIds = this.plugin.settings.recentModels || [];
    const recentModels: ModelOption[] = [];

    // Find full model objects for recent IDs
    if (recentIds.length > 0) {
      for (const id of recentIds) {
        // Skip if already found (dedupe in case setting has duplicates)
        if (recentModels.some((m) => m.id === id)) continue;

        for (const provider of this.providers) {
          const found = provider.models.find((m) => m.id === id);
          if (found) {
            recentModels.push(found);
            break;
          }
        }
      }
    }

    if (recentModels.length > 0) {
      const currentModel = this.plugin.settings.model;

      for (const model of recentModels) {
        const optionEl = this.modelDropdownEl.createDiv({
          cls: `opencodian-dropdown-item opencodian-model-item ${
            model.id === currentModel ? "active" : ""
          }`,
        });

        // Use standard model styling but remove left padding since it's level 1
        optionEl.style.paddingLeft = "12px";

        const labelEl = optionEl.createSpan({ cls: "dropdown-item-label" });
        labelEl.textContent = model.label;

        // Add provider hint
        const providerHint = optionEl.createSpan({
          cls: "dropdown-item-count",
        });
        providerHint.textContent = model.providerID;
        providerHint.style.fontSize = "10px";
        providerHint.style.marginLeft = "auto";
        providerHint.style.marginRight = "0";

        // Free badge
        if (model.isFree && model.providerID === "opencode") {
          const freeEl = optionEl.createSpan({
            cls: "dropdown-item-badge free",
          });
          freeEl.textContent = "Free";
        }

        optionEl.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this.selectModel(model.id, model.label);
        });
      }

      this.modelDropdownEl.createDiv({ cls: "opencodian-dropdown-separator" });
    }

    // --- PROVIDERS SECTION ---
    for (const provider of this.providers) {
      // Skip providers with no models
      if (provider.models.length === 0) continue;

      const optionEl = this.modelDropdownEl.createDiv({
        cls: "opencodian-dropdown-item opencodian-provider-item",
      });

      // Provider icon
      const iconEl = optionEl.createSpan({ cls: "dropdown-item-icon" });
      setIcon(iconEl, provider.isConnected ? "check-circle" : "circle");

      // Provider name
      const labelEl = optionEl.createSpan({ cls: "dropdown-item-label" });
      labelEl.textContent = provider.name;

      // Model count badge
      const countEl = optionEl.createSpan({ cls: "dropdown-item-count" });
      countEl.textContent = `${provider.models.length}`;

      // Chevron
      const chevronEl = optionEl.createSpan({ cls: "dropdown-item-chevron" });
      setIcon(chevronEl, "chevron-right");

      optionEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectedProvider = provider;
        this.renderDropdownContent();
      });
    }
  }

  /**
   * Render model list for selected provider (level 2)
   */
  private renderModelList(provider: ProviderWithModels): void {
    // Back button
    const backEl = this.modelDropdownEl.createDiv({
      cls: "opencodian-dropdown-back",
    });

    const backIconEl = backEl.createSpan({ cls: "dropdown-back-icon" });
    setIcon(backIconEl, "arrow-left");

    const backLabelEl = backEl.createSpan({ cls: "dropdown-back-label" });
    backLabelEl.textContent = provider.name;

    backEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectedProvider = null;
      this.renderDropdownContent();
    });

    // Separator
    this.modelDropdownEl.createDiv({ cls: "opencodian-dropdown-separator" });

    // Model list
    const currentModel = this.plugin.settings.model;

    for (const model of provider.models) {
      const optionEl = this.modelDropdownEl.createDiv({
        cls: `opencodian-dropdown-item opencodian-model-item ${
          model.id === currentModel ? "active" : ""
        }`,
      });

      // Model name
      const labelEl = optionEl.createSpan({ cls: "dropdown-item-label" });
      labelEl.textContent = model.label;

      // Free badge - only for opencode provider
      if (provider.id === "opencode" && model.isFree) {
        const freeEl = optionEl.createSpan({ cls: "dropdown-item-badge free" });
        freeEl.textContent = "Free";
      }

      optionEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.selectModel(model.id, model.label);
      });
    }
  }

  /**
   * Select a model
   */
  private async selectModel(
    modelId: string,
    modelLabel: string,
  ): Promise<void> {
    this.plugin.settings.model = modelId;

    // Update recent models
    const recent = this.plugin.settings.recentModels || [];
    const newRecent = [modelId, ...recent.filter((id) => id !== modelId)].slice(
      0,
      5,
    );
    this.plugin.settings.recentModels = newRecent;

    await this.plugin.saveSettings();

    this.updateModelDisplay(modelLabel);
    this.toggleModelDropdown(false);
  }
}
