/**
 * Chat message types for Opencodian
 */

export interface ChatMessage {
  /** Stable unique identifier for UI operations (edit/regenerate). */
  id: string;
  role: "user" | "assistant";
  /** Message kind (currently always `message`). */
  type: "message";
  /**
   * Timeline items for assistant messages.
   * User messages should not set this.
   */
  items?: ChatItem[];
  /**
   * Plain text for user messages.
   * Assistant messages should not set this.
   */
  content?: string;
  /**
   * OpenCode server message id for this entry.
   */
  serverId?: string;

  /**
   * Error text for assistant messages.
   * Stored so reload can show same error.
   */
  error?: string;
  timestamp: number;
  images?: ImageAttachment[];
  /**
   * File/folder paths mentioned with @ syntax (user messages only).
   * Stored for display purposes - shown as badges above the message.
   */
  mentions?: MentionInfo[];
  /** Mentioned skills via `/` (user messages only). */
  skills?: SkillInfo[];
}

export interface SkillInfo {
  name: string;
  path: string;
  scope: "project" | "global";
}


export type ChatItem =
  | {
      type: "text";
      id: string;
      timestamp: number;
      text: string;
    }
  | {
      type: "tool";
      id: string;
      timestamp: number;
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
      status: "running" | "done" | "error";
      result?: string;
    };

export interface MentionInfo {
  path: string;
  name: string;
  isFolder: boolean;
}

export interface ToolCallInfo {
  toolUseId: string;
  toolName: string;
  /** Human-friendly one-liner like `pwd` or a file path; best-effort. */
  summary?: string;
  /** Tool input parameters (sanitized/truncated). */
  input: Record<string, unknown>;
}

export interface ImageAttachment {
  path: string;
  mediaType: string;
  data?: string; // base64 encoded
  cachePath?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  sessionId: string | null;
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Stream chunks for real-time response
 */
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolName: string; input: Record<string, unknown>; toolUseId: string }
  | { type: 'tool_result'; toolUseId: string; result: string; attachments?: ToolAttachment[] }
  | { type: 'thinking'; content: string }
  | { type: 'error'; content: string }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'server_message'; role: 'user' | 'assistant'; messageId: string }
  | { type: 'done' };

export interface ToolAttachment {
  url: string;
  filename?: string;
  mime?: string;
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  always: string[];
  metadata?: Record<string, unknown>;
}

