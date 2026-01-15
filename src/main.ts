/**
 * Opencodian - Obsidian plugin entry point
 *
 * Registers the sidebar chat view, settings tab, and commands.
 */

import { Plugin } from "obsidian";

import { OpenCodeService } from "./core/agent";
import type { Conversation, OpencodianSettings } from "./core/types";
import { DEFAULT_SETTINGS, VIEW_TYPE_OPENCODIAN } from "./core/types";
import { OpencodianView } from "./features/chat/OpencodianView";
import { OpencodianSettingTab } from "./features/settings/OpencodianSettings";

/**
 * Main plugin class for Opencodian
 */
export default class OpencodianPlugin extends Plugin {
  settings: OpencodianSettings;
  agentService: OpenCodeService;
  private conversations: Conversation[] = [];
  private activeConversationId: string | null = null;

  async onload() {
    console.log('Opencodian plugin loaded - testing hot reload');
    console.log('Opencodian plugin loaded - testing hot reload');
    console.log('Opencodian plugin loaded - testing hot reload');
    await this.loadSettings();

    // Initialize OpenCode service
    this.agentService = new OpenCodeService();
    this.agentService.setApp(this.app);

    // Register view
    this.registerView(
      VIEW_TYPE_OPENCODIAN,
      (leaf) => new OpencodianView(leaf, this)
    );

    // Add ribbon icon
    this.addRibbonIcon("bot", "Open Opencodian", () => {
      this.activateView();
    });

    // Add command
    this.addCommand({
      id: "open-view",
      name: "Open chat view",
      callback: () => {
        this.activateView();
      },
    });

    // Add settings tab
    this.addSettingTab(new OpencodianSettingTab(this.app, this));

    // Create initial conversation if none exists
    if (this.conversations.length === 0) {
      await this.createConversation();
    }
  }

  onunload() {
    this.agentService.cleanup();
  }

  /** Opens the Opencodian sidebar view */
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_OPENCODIAN)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_OPENCODIAN,
          active: true,
        });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /** Load settings from disk */
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.conversations = this.settings.conversations || [];
    this.activeConversationId = this.settings.activeConversationId;
  }

  /** Save settings to disk */
  async saveSettings() {
    this.settings.conversations = this.conversations;
    this.settings.activeConversationId = this.activeConversationId;
    await this.saveData(this.settings);
  }

  /** Create a new conversation */
  async createConversation(): Promise<Conversation> {
    const conversation: Conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      title: new Date().toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: null,
      messages: [],
    };

    this.conversations.unshift(conversation);
    this.activeConversationId = conversation.id;
    this.agentService.resetSession();

    await this.saveSettings();
    return conversation;
  }

  /** Get the active conversation */
  getActiveConversation(): Conversation | null {
    return (
      this.conversations.find((c) => c.id === this.activeConversationId) || null
    );
  }

  /** Get all conversations */
  getConversations(): Conversation[] {
    return this.conversations;
  }

  /** Save a conversation */
  async saveConversation(conversation: Conversation): Promise<void> {
    conversation.updatedAt = Date.now();
    await this.saveSettings();
  }

  /** Switch to a different conversation */
  async switchConversation(conversationId: string): Promise<void> {
    const conversation = this.conversations.find(
      (c) => c.id === conversationId
    );
    if (conversation) {
      this.activeConversationId = conversationId;
      this.agentService.resetSession();
      await this.saveSettings();
    }
  }

  /** Delete a conversation */
  async deleteConversation(conversationId: string): Promise<void> {
    const index = this.conversations.findIndex((c) => c.id === conversationId);
    if (index === -1) return;

    this.conversations.splice(index, 1);

    // If we deleted the active conversation, switch to another or create new
    if (this.activeConversationId === conversationId) {
      if (this.conversations.length > 0) {
        await this.switchConversation(this.conversations[0].id);
      } else {
        await this.createConversation();
      }
    } else {
      await this.saveSettings();
    }
  }

  /** Rename a conversation */
  async renameConversation(conversationId: string, newTitle: string): Promise<void> {
    const conversation = this.conversations.find((c) => c.id === conversationId);
    if (conversation) {
      conversation.title = newTitle.trim() || new Date().toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      conversation.updatedAt = Date.now();
      await this.saveSettings();
    }
  }

  /** Get the plugin view */
  getView(): OpencodianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OPENCODIAN);
    if (leaves.length > 0) {
      return leaves[0].view as OpencodianView;
    }
    return null;
  }
}
