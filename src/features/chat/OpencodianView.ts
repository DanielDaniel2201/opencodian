/**
 * Opencodian View - Main chat interface
 */

import { ItemView, WorkspaceLeaf, setIcon, MarkdownRenderer, TFolder } from "obsidian";
import type OpencodianPlugin from "../../main";
import {
  VIEW_TYPE_OPENCODIAN,
  FREE_MODELS,
  getModelLabel,
} from "../../core/types";
import type { ToolCallInfo, MentionInfo } from "../../core/types";
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

  /** Map tool invocation IDs to their UI elements */
  private activeToolBlocks: Map<string, ToolBlock> = new Map();
  private currentThinkingBlock: ToolBlock | null = null;

  /** Send button state */
  private sendButtonEl: HTMLButtonElement;
  private isGenerating: boolean = false;

  /** File mention system */
  private fileMention: FileMention | null = null;

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
      inputWrapper
    );

    // Event listeners
    this.sendButtonEl.addEventListener("click", () => this.handleSendButtonClick());
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
      ".dropdown-list"
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
    currentTitle: string
  ): void {
    const titleEl = itemEl.querySelector(".conversation-title") as HTMLElement;
    const actionsEl = itemEl.querySelector(".conversation-actions") as HTMLElement;
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

  private async loadConversation(): Promise<void> {
    const conv = this.plugin.getActiveConversation();
    this.messagesEl.empty();

    if (!conv || conv.messages.length === 0) {
      this.showWelcomeMessage();
      return;
    }

    for (const msg of conv.messages) {
      this.addMessage(msg.role, msg.content, msg.toolCalls, msg.mentions);
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
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = "";
    this.adjustInputHeight(); // Reset height after clearing

    // Get mentions from chips system - full MentionItem objects
    const mentionItems = this.fileMention ? this.fileMention.getMentionsAndClear() : [];
    
    // Convert to MentionInfo for storage
    const mentions: MentionInfo[] = mentionItems.map(m => ({
      path: m.path,
      name: m.name,
      isFolder: m.isFolder,
    }));
    
    // Build rich MentionContext with folder children
    const mentionContexts: MentionContext[] = mentionItems.map(m => {
      const ctx: MentionContext = {
        path: m.path,
        name: m.name,
        isFolder: m.isFolder,
      };
      
      // For folders, list their direct children
      if (m.isFolder) {
        const folder = this.plugin.app.vault.getAbstractFileByPath(m.path);
        if (folder instanceof TFolder) {
          ctx.children = folder.children.map(c => c.name);
        }
      }
      
      return ctx;
    });

    // Set generating state
    this.setGeneratingState(true);

    // Clear welcome message if present
    this.clearWelcomeMessage();

    // Add user message to UI (with mentions badge)
    this.addMessage("user", text, undefined, mentions.length > 0 ? mentions : undefined);

    // Save to conversation
    const conv = this.plugin.getActiveConversation();
    if (conv) {
      conv.messages.push({
        role: "user",
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
    const assistantMsgEl = this.addMessage("assistant", "");
    const bubbleEl = assistantMsgEl.querySelector(
      ".message-bubble"
    ) as HTMLElement;
    const contentEl = assistantMsgEl.querySelector(
      ".message-content"
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

    try {
      let fullResponse = "";
      const toolCallsById = new Map<string, ToolCallInfo>();

      // Markdown streaming: render incrementally with a debounce to preserve the
      // "streaming" feel without re-rendering on every token.
      let mdRenderTimer: number | null = null;
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
          mentionContexts: mentionContexts.length > 0 ? mentionContexts : undefined,
        }
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
            chunk.toolUseId
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
          // Remove the placeholder and add fresh error message
          if (assistantMsgEl.parentElement) {
            assistantMsgEl.remove();
          }
          this.addMessage("assistant", `❗ ${chunk.content}`);
          this.scrollToBottom();
        } else if (chunk.type === "done") {
          clearWorking();
          if (mdRenderTimer !== null) {
            window.clearTimeout(mdRenderTimer);
            mdRenderTimer = null;
          }
          await this.renderMarkdown(fullResponse, contentEl);
          hasRenderedMarkdown = true;

          if (conv && fullResponse) {
            conv.messages.push({
              role: "assistant",
              content: fullResponse,
              timestamp: Date.now(),
              toolCalls: Array.from(toolCallsById.values()),
            });
            await this.plugin.saveConversation(conv);
          }
          
          // Reset generating state
          this.setGeneratingState(false);
        }
      }
    } catch (error) {
      // Remove the placeholder assistant message entirely
      if (assistantMsgEl.parentElement) {
        assistantMsgEl.remove();
      }
      
      // Add a fresh error message as AI response
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.addMessage("assistant", `❗ ${errorMsg}`);
      this.scrollToBottom();
      
      // Reset generating state on error
      this.setGeneratingState(false);
    }
  }

  private formatToolName(toolName: string): string {
    const t = (toolName || "").trim();
    if (!t) return toolName;
    const lower = t.toLowerCase();
    return lower[0].toUpperCase() + lower.slice(1);
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTo({
      top: this.messagesEl.scrollHeight,
      behavior: "smooth",
    });
  }

  /**
   * Show error message in content area with red emoji
   */
  private showErrorInContent(contentEl: HTMLElement, message: string): void {
    contentEl.empty();
    contentEl.addClass("opencodian-error-content");
    
    const errorEl = document.createElement("div");
    errorEl.className = "opencodian-error-message";
    errorEl.innerHTML = `<span class="opencodian-error-icon">&#10071;</span> ${message}`;
    contentEl.appendChild(errorEl);
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

  private addMessage(
    role: "user" | "assistant",
    content: string,
    toolCalls?: ToolCallInfo[],
    mentions?: MentionInfo[]
  ): HTMLElement {
    const msgEl = this.messagesEl.createDiv({ cls: `message message-${role}` });

    const roleEl = msgEl.createDiv({ cls: "message-role" });
    roleEl.textContent = role === "user" ? "You" : "OpenCode";

    const bubbleEl = msgEl.createDiv({ cls: "message-bubble" });
    
    // Render mentions badge above content for user messages
    if (role === "user" && mentions && mentions.length > 0) {
      const mentionsEl = bubbleEl.createDiv({ cls: "message-mentions" });
      for (const mention of mentions) {
        const chipEl = mentionsEl.createDiv({ cls: "message-mention-chip" });
        
        const iconEl = chipEl.createSpan({ cls: "message-mention-icon" });
        setIcon(iconEl, mention.isFolder ? "folder" : "file-text");
        
        const nameEl = chipEl.createSpan({ cls: "message-mention-name" });
        nameEl.textContent = mention.name;
        nameEl.title = mention.path; // Full path on hover
      }
    }
    
    const contentEl = bubbleEl.createDiv({ cls: "message-content" });

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

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

    return msgEl;
  }

  private renderHistoricalToolCallBlock(
    bubbleEl: HTMLElement,
    beforeEl: HTMLElement,
    call: ToolCallInfo
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
    input: Record<string, unknown>
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

  private sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
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
    container: HTMLElement
  ): Promise<void> {
    container.addClass("opencodian-markdown");
    container.empty();
    try {
      await MarkdownRenderer.render(
        this.plugin.app,
        content,
        container,
        "",
        this
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

  // ========== TOOL & THINKING BLOCKS ==========

  /**
   * Render tool invocation block
   */
  private renderThinkingBlock(
    bubbleEl: HTMLElement,
    beforeEl: HTMLElement,
    content: string
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
    toolUseId: string
  ): void {
    // If we already rendered this tool invocation (same id), update it instead of creating a new block.
    // OpenCode can emit multiple updates for the same tool part (e.g. pending -> running), and
    // creating a second block leaves the first stuck in "Running..." forever.
    const existing = this.activeToolBlocks.get(toolUseId);
    if (existing) {
      const labelEl = existing.headerEl.querySelector(
        ".tool-label"
      ) as HTMLElement | null;
      if (labelEl) {
        const summary = this.getToolInputSummary(toolName, input);
        const name = this.formatToolName(toolName);
        labelEl.textContent = summary ? `${name}: ${summary}` : name;
      }

      const iconEl = existing.headerEl.querySelector(
        ".tool-icon"
      ) as HTMLElement | null;
      if (iconEl) setIcon(iconEl, this.getToolIcon(toolName));

      const statusEl = existing.headerEl.querySelector(
        ".tool-status"
      ) as HTMLElement | null;
      if (statusEl) {
        statusEl.textContent = "Running...";
        statusEl.className = "tool-status running";
      }

      const inputCode = existing.contentEl.querySelector(
        "pre.tool-code:not(.tool-result-code)"
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
      ".tool-result-section"
    ) as HTMLElement;
    const resultCode = block.contentEl.querySelector(
      ".tool-result-code"
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

    // Dynamic width based on longest model name
    // We defer slightly to ensure styles are applied
    window.requestAnimationFrame(() => {
      const maxLabelWidth = this.calculateMaxModelLabelWidth();
      if (maxLabelWidth > 0) {
        this.modelButtonEl.style.setProperty("--model-label-width", `${maxLabelWidth}px`);
      }
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
    this.renderModelOptions();

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
  private updateModelDisplay(): void {
    const currentModel = this.plugin.settings.model;
    const label = getModelLabel(currentModel);

    this.modelButtonEl.empty();

    const iconEl = this.modelButtonEl.createSpan({ cls: "model-icon" });
    setIcon(iconEl, "cpu");

    const labelEl = this.modelButtonEl.createSpan({ cls: "model-label" });
    labelEl.textContent = label;

    const chevronEl = this.modelButtonEl.createSpan({ cls: "model-chevron" });
    setIcon(chevronEl, "chevron-down");
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
  }

  /**
   * Render model options in dropdown
   */
  private renderModelOptions(): void {
    this.modelDropdownEl.empty();

    for (const model of FREE_MODELS) {
      const optionEl = this.modelDropdownEl.createDiv({
        cls: `opencodian-model-option ${
          model.id === this.plugin.settings.model ? "active" : ""
        }`,
      });

      const labelEl = optionEl.createDiv({ cls: "model-option-label" });
      labelEl.textContent = model.label;

      optionEl.addEventListener("click", async () => {
        await this.selectModel(model.id);
      });
    }
  }

  /**
   * Select a model
   */
  private async selectModel(modelId: string): Promise<void> {
    this.plugin.settings.model = modelId;
    await this.plugin.saveSettings();

    this.updateModelDisplay();
    this.renderModelOptions();
    this.toggleModelDropdown(false);
  }

  /**
   * Calculate max width needed for model labels to prevent layout shifts
   */
  private calculateMaxModelLabelWidth(): number {
    const temp = document.createElement("span");
    temp.style.visibility = "hidden";
    temp.style.position = "absolute";
    temp.style.fontSize = "0.8em"; // Match .opencodian-model-btn
    temp.style.fontWeight = "500";
    // Append to container to inherit fonts
    this.mainContainerEl.appendChild(temp);

    let maxW = 0;
    for (const m of FREE_MODELS) {
      temp.textContent = m.label;
      const w = temp.getBoundingClientRect().width;
      if (w > maxW) maxW = w;
    }
    
    temp.remove();
    return Math.ceil(maxW) + 10; // +buffer
  }
}
