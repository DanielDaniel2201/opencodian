const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..", "..");
const envPath = path.join(root, ".env.e2e");

if (!fs.existsSync(envPath)) {
  console.error("Missing .env.e2e at", envPath);
  process.exit(1);
}

const readEnvFile = (filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

const fileEnv = readEnvFile(envPath);
const mergedEnv = { ...process.env, ...fileEnv };

const args = [
  "playwright",
  "test",
  path.join(root, "tests", "e2e", "obsidian", "opencodian.spec.ts"),
];

const proc = spawn("npx", args, {
  stdio: "inherit",
  env: mergedEnv,
});

proc.on("exit", (code) => {
  process.exit(code ?? 1);
});
