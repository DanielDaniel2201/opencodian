import type { App } from "obsidian";

import type { ChatMessage, Conversation, ConversationMeta } from "../types/chat";

export const SESSIONS_PATH = ".obsidian/plugins/opencodian/sessions";

interface SessionMetaRecord {
  type: "meta";
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sessionId: string | null;
}

interface SessionMessageRecord {
  type: "message";
  message: ChatMessage;
}

type SessionRecord = SessionMetaRecord | SessionMessageRecord;

export class SessionStorage {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  getFilePath(id: string): string {
    return `${SESSIONS_PATH}/${id}.jsonl`;
  }

  async listConversations(): Promise<ConversationMeta[]> {
    const metas: ConversationMeta[] = [];

    try {
      if (!(await this.app.vault.adapter.exists(SESSIONS_PATH))) {
        return [];
      }

      const listing = await this.app.vault.adapter.list(SESSIONS_PATH);
      for (const filePath of listing.files) {
        if (!filePath.endsWith(".jsonl")) continue;

        const meta = await this.loadMeta(filePath);
        if (!meta) continue;
        metas.push(meta);
      }

      metas.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      console.error("[SessionStorage] Failed to list sessions:", error);
    }

    return metas;
  }

  async loadConversation(id: string): Promise<Conversation | null> {
    const filePath = this.getFilePath(id);

    try {
      if (!(await this.app.vault.adapter.exists(filePath))) {
        return null;
      }

      const content = await this.app.vault.adapter.read(filePath);
      return this.parseJsonl(content);
    } catch (error) {
      console.error(`[SessionStorage] Failed to load conversation ${id}:`, error);
      return null;
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const filePath = this.getFilePath(conversation.id);

    const meta: SessionMetaRecord = {
      type: "meta",
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      sessionId: conversation.sessionId,
    };

    const lines: string[] = [JSON.stringify(meta)];
    for (const message of conversation.messages) {
      const record: SessionMessageRecord = { type: "message", message };
      lines.push(JSON.stringify(record));
    }

    const content = lines.join("\n");

    await this.ensureFolder(SESSIONS_PATH);
    await this.app.vault.adapter.write(filePath, content);
  }

  async deleteConversation(id: string): Promise<void> {
    const filePath = this.getFilePath(id);
    if (!(await this.app.vault.adapter.exists(filePath))) return;
    await this.app.vault.adapter.remove(filePath);
  }

  private async ensureFolder(path: string): Promise<void> {
    if (await this.app.vault.adapter.exists(path)) return;

    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async loadMeta(filePath: string): Promise<ConversationMeta | null> {
    try {
      const content = await this.app.vault.adapter.read(filePath);
      const firstLine = content.split(/\r?\n/).find((l) => l.trim().length > 0);
      if (!firstLine) return null;

      const record = JSON.parse(firstLine) as SessionRecord;
      if (record.type !== "meta") return null;

      return {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    } catch (error) {
      console.error("[SessionStorage] Failed to load meta:", error);
      return null;
    }
  }

  private parseJsonl(content: string): Conversation | null {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;

    let meta: SessionMetaRecord | null = null;
    const messages: ChatMessage[] = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as SessionRecord;
        if (record.type === "meta") {
          meta = record;
          continue;
        }

        if (record.type === "message") {
          messages.push(record.message);
        }
      } catch {
        continue;
      }
    }

    if (!meta) return null;

    return {
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      sessionId: meta.sessionId,
      messages,
    };
  }
}
