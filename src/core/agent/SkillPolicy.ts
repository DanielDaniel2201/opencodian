export const ProjectSkillDirs: readonly string[] = [
  ".claude/skills",
  ".agents/skills",
];

export const PseudoGlobalSkillDir =
  ".obsidian/plugins/opencodian/.opencode/skills";

export const SkillDiscoveryEnvKeysToStrip: readonly string[] = [
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_TEST_HOME",
  "OPENCODE_DISABLE_PROJECT_CONFIG",
  "OPENCODE_DISABLE_CLAUDE_CODE",
  "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS",
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
];