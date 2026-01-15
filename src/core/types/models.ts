/**
 * Model types for Opencodian
 *
 * Free models from Zen (OpenCode):
 * - Big Pickle: Powerful reasoning model (stealth, free for limited time)
 * - Grok Code: xAI's Grok Code (free for limited time)
 * - MiniMax M2.1: Fast and efficient (free for limited time)
 * - GLM 4.7: Chinese-English bilingual (free for limited time)
 *
 * Reference: https://opencode.ai/docs/zen/
 */

export interface ModelOption {
  id: string;           // Model ID (format: opencode/<model-id>)
  label: string;        // Display name
}

/** Free models available in Opencodian (from OpenCode Zen) */
export const FREE_MODELS: ModelOption[] = [
  {
    id: "opencode/big-pickle",
    label: "Big Pickle",
  },
  {
    id: "opencode/grok-code",
    label: "Grok Code",
  },
  {
    id: "opencode/minimax-m2.1-free",
    label: "MiniMax M2.1",
  },
  {
    id: "opencode/glm-4.7-free",
    label: "GLM 4.7",
  },
];

/** Default model */
export const DEFAULT_MODEL = FREE_MODELS[0];

/** Get model by ID */
export function getModelById(id: string): ModelOption | undefined {
  return FREE_MODELS.find((m) => m.id === id);
}

/** Get model label by ID */
export function getModelLabel(id: string): string {
  const model = getModelById(id);
  return model?.label || id;
}
