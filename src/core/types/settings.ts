/**
 * Settings types for Opencodian
 */

import { DEFAULT_MODEL } from "./models";

export interface OpencodianSettings {
  // User preferences
  userName: string;

  // Model configuration
  model: string;
  recentModels: string[];

  // Permission mode
  permissionMode: "yolo" | "safe";

  // Storage
  activeConversationId: string | null;

  // Environment
  environmentVariables: string;

  // Custom system prompt
  systemPrompt: string;

  // Excluded tags (notes with these tags won't be auto-loaded)
  excludedTags: string[];

  // OpenCode CLI path (optional, for custom installations)
  opencodePath: string;

  // Debugging
  debugLogging: boolean;
}

export const DEFAULT_SETTINGS: OpencodianSettings = {
  userName: "",
  model: DEFAULT_MODEL.id,
  recentModels: [],
  permissionMode: "yolo",
  activeConversationId: null,
  environmentVariables: "",
  systemPrompt: "",
  excludedTags: [],
  opencodePath: "",
  debugLogging: false,
};

export const VIEW_TYPE_OPENCODIAN = "opencodian-view";
