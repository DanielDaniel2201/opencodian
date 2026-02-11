import { _electron as electron, type ElectronApplication, type Page } from "playwright";

const obsidianExecutable = process.env.OBSIDIAN_EXE;
const testVault = process.env.OBSIDIAN_VAULT;

const hasRequiredEnv = (): boolean => {
  return !!obsidianExecutable && !!testVault;
};

const launchObsidian = async (): Promise<ElectronApplication> => {
  if (!obsidianExecutable || !testVault) {
    throw new Error("Missing OBSIDIAN_EXE or OBSIDIAN_VAULT env vars.");
  }

  return electron.launch({
    executablePath: obsidianExecutable,
    args: [
      "--vault",
      testVault,
    ],
  });
};

const openPluginView = async (page: Page): Promise<void> => {
  await page.waitForSelector('[data-testid="opencodian-root"]', { timeout: 30000 });
};

const sendPrompt = async (page: Page, text: string): Promise<void> => {
  const input = page.locator('[data-testid="opencodian-input"]');
  await input.click();
  await input.fill(text);
  await page.locator('[data-testid="opencodian-send"]').click();
};

const waitForAssistantMessage = async (page: Page): Promise<void> => {
  await page.waitForSelector(
    '[data-testid="opencodian-message"][data-role="assistant"]',
    { timeout: 60000 },
  );
};

const openDevTools = async (app: ElectronApplication): Promise<Page> => {
  const win = await app.firstWindow();
  await win.keyboard.press("Control+Shift+I");
  const pages = app.windows();
  const devtools = pages.find((p) => p !== win);
  if (!devtools) {
    throw new Error("DevTools window not found");
  }
  await devtools.waitForLoadState("domcontentloaded");
  return devtools;
};

const getConsoleErrors = async (devtools: Page): Promise<string[]> => {
  const entries = await devtools.evaluate(() => {
    const logs = (window as any).__OPENCODIAN_CONSOLE__ as Array<{ text: string; level: string }> | undefined;
    if (!logs) return [];
    return logs.filter((x) => x.level === "error").map((x) => x.text);
  });
  return Array.isArray(entries) ? entries : [];
};

describe("Opencodian behaviour", () => {
  let app: ElectronApplication;
  let page: Page;
  let devtools: Page | null = null;

  beforeAll(async () => {
    if (!hasRequiredEnv()) {
      return;
    }
    app = await launchObsidian();
    page = await app.firstWindow();
    await openPluginView(page);
    devtools = await openDevTools(app);
    await page.evaluate(() => {
      const logs: Array<{ text: string; level: string }> = [];
      (window as any).__OPENCODIAN_CONSOLE__ = logs;
      const original = console.error;
      console.error = (...args: unknown[]) => {
        logs.push({ text: args.map((a) => String(a)).join(" "), level: "error" });
        return original.apply(console, args as []);
      };
    });
  }, 120000);

  afterAll(async () => {
    if (!hasRequiredEnv()) {
      return;
    }
    await app.close();
  });

  it("sends a prompt and receives assistant output", async () => {
    if (!hasRequiredEnv()) {
      return;
    }

    await sendPrompt(page, "Hello from Opencodian E2E test");
    await waitForAssistantMessage(page);

    if (devtools) {
      const errors = await getConsoleErrors(devtools);
      expect(errors).toEqual([]);
    }
  }, 120000);
});
