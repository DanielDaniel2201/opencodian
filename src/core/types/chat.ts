/**
 * Chat message types for Opencodian
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: ImageAttachment[];
  /**
   * Tool invocations the assistant performed while producing this message.
   * Intentionally does NOT include tool results or thinking content.
   */
  toolCalls?: ToolCallInfo[];
  /**
   * File/folder paths mentioned with @ syntax (user messages only).
   * Stored for display purposes - shown as badges above the message.
   */
  mentions?: MentionInfo[];
}

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
  messageCount: number;
  preview: string;
}

/**
 * Stream chunks for real-time response
 */
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolName: string; input: Record<string, unknown>; toolUseId: string }
  | { type: 'tool_result'; toolUseId: string; result: string }
  | { type: 'thinking'; content: string }
  | { type: 'error'; content: string }
  | { type: 'done' };
