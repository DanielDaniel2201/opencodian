/**
  * SkillMention - legacy / skill mention system
 *
 * Modeled after FileMention. Targets a `contenteditable` input element, inserting
 * inline, removable chips into the text flow.
 */

import type { App } from "obsidian";
import { ProjectSkillDirs, PseudoGlobalSkillDir } from "../../core/agent/SkillPolicy";

export interface SkillItem {
  name: string;
  description: string;
  path: string;
  scope: "project" | "global";
}

export class SkillMention {
  private app: App;
  private inputEl: HTMLElement;
  private containerEl: HTMLElement;
  private suggestionsEl: HTMLElement | null = null;

  private handlePasteBound: (e: ClipboardEvent) => void;
  private handleDropBound: (e: DragEvent) => void;
  private handleBeforeInputBound: (e: InputEvent) => void;

  private items: SkillItem[] = [];

  private skipNativePaste: boolean = false;

  /** Zero Width Space - used to ensure cursor can be placed before/after chips */
  private static readonly ZWS = "\u200B";

  constructor(app: App, inputEl: HTMLElement, containerEl: HTMLElement) {
    this.app = app;
    this.inputEl = inputEl;
    this.containerEl = containerEl;

    this.handlePasteBound = this.handlePaste.bind(this);
    this.handleDropBound = this.handleDrop.bind(this);
    this.handleBeforeInputBound = this.handleBeforeInput.bind(this);

    this.init();
  }

  private init(): void {
    void this.loadItems();

    this.inputEl.addEventListener("input", this.handleInput.bind(this));
    this.inputEl.addEventListener("keydown", this.handleKeyDown.bind(this));
    this.inputEl.addEventListener("blur", this.handleBlur.bind(this));
    this.inputEl.addEventListener("paste", this.handlePasteBound);
    this.inputEl.addEventListener("drop", this.handleDropBound);
    this.inputEl.addEventListener("beforeinput", this.handleBeforeInputBound);

    this.createSuggestionsEl();
  }


  private createSuggestionsEl(): void {
    this.suggestionsEl = document.createElement("div");
    this.suggestionsEl.className = "opencodian-mention-suggestions";
    this.suggestionsEl.style.display = "none";
    this.containerEl.appendChild(this.suggestionsEl);
  }

  private show(): void {
    if (!this.suggestionsEl) return;
    this.suggestionsEl.style.display = "block";
  }

  private handlePaste(e: ClipboardEvent): void {
    if (e.defaultPrevented) return;

    this.skipNativePaste = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    this.insertPlainTextAtCursor(text);
  }

  private handleDrop(e: DragEvent): void {
    if (e.defaultPrevented) return;

    this.skipNativePaste = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    const text = e.dataTransfer?.getData("text/plain") ?? "";
    this.insertPlainTextAtCursor(text);
  }

  private handleBeforeInput(e: InputEvent): void {
    if (e.defaultPrevented) return;
    if (e.inputType !== "insertFromPaste" && e.inputType !== "insertFromDrop") {
      return;
    }

    if (this.skipNativePaste) {
      this.skipNativePaste = false;
      e.preventDefault();
      return;
    }

    e.preventDefault();

    const data = e.dataTransfer;
    if (data) {
      const text = data.getData("text/plain") ?? "";
      this.insertPlainTextAtCursor(text);
      return;
    }

    const clipboard = (e as unknown as { clipboardData?: DataTransfer })
      .clipboardData;
    const text = clipboard?.getData("text/plain") ?? "";
    this.insertPlainTextAtCursor(text);
  }

  private insertPlainTextAtCursor(text: string): void {
    const normalized = text.replace(/\r\n/g, "\n");
    const range = this.getSelectionRangeInInput();

    if (!range) {
      this.inputEl.appendChild(document.createTextNode(normalized));
      this.moveCaretToEnd();
      return;
    }

    range.deleteContents();
    const node = document.createTextNode(normalized);
    range.insertNode(node);

    range.setStartAfter(node);
    range.collapse(true);

    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private moveCaretToEnd(): void {
    const range = document.createRange();
    range.selectNodeContents(this.inputEl);
    range.collapse(false);

    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private getSelectionRangeInInput(): Range | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (!this.inputEl.contains(range.startContainer)) return null;

    return range;
  }

  private getTextBeforeCursor(maxChars: number = 200): string {
    const range = this.getSelectionRangeInInput();
    if (!range) return "";

    const sel = window.getSelection();
    if (!sel) return "";

    const scan = range.cloneRange();
    scan.collapse(true);
    scan.setStart(this.inputEl, 0);

    const text = scan.toString();
    if (text.length <= maxChars) return text;

    return text.slice(-maxChars);
  }

  /** Find the /query trigger right before cursor */
  // Legacy trigger is disabled; unified in FileMention.
  private handleKeyDown(_e: KeyboardEvent): void {
    return;
  }

  private handleBlur(): void {
    this.hide();
  }

  private handleInput(): void {
    this.ensureChipZWS();
    this.hide();
  }

  private ensureChipZWS(): void {
    const chips = this.inputEl.querySelectorAll(
      ".opencodian-inline-skill-chip",
    );

    for (const chip of Array.from(chips)) {
      const prev = chip.previousSibling;

      if (!prev || prev.nodeType !== Node.TEXT_NODE) {
        const zws = document.createTextNode(SkillMention.ZWS);
        chip.parentNode?.insertBefore(zws, chip);
      } else {
        const textNode = prev as Text;
        if (textNode.data.length === 0) {
          textNode.data = SkillMention.ZWS;
        }
      }
    }
  }

  private hide(): void {
    if (!this.suggestionsEl) return;
    this.suggestionsEl.style.display = "none";
  }

  destroy(): void {
    this.inputEl.removeEventListener("paste", this.handlePasteBound);
    this.inputEl.removeEventListener("drop", this.handleDropBound);
    this.inputEl.removeEventListener(
      "beforeinput",
      this.handleBeforeInputBound,
    );

    if (this.suggestionsEl) {
      this.suggestionsEl.remove();
    }
  }

  private async loadItems(): Promise<void> {
    const skills: SkillItem[] = [];

    const [projectSkills, globalSkills] = await Promise.all([
      this.readProjectSkills(),
      this.readGlobalSkills(),
    ]);

    for (const item of projectSkills) skills.push(item);
    for (const item of globalSkills) {
      if (!skills.find((s) => s.name === item.name)) {
        skills.push(item);
      }
    }

    skills.sort((a, b) => a.name.localeCompare(b.name));
    this.items = skills;
  }

  private async readProjectSkills(): Promise<SkillItem[]> {
    const skillsDirs = ProjectSkillDirs;
    const adapter: any = this.app.vault.adapter as any;
    const out: SkillItem[] = [];

    try {
      await Promise.all(
        skillsDirs.map(async (skillsDir) => {
          if (!(await adapter.exists(skillsDir))) {
            return;
          }

          const listing = (await adapter.list(skillsDir)) as {
            files: string[];
            folders: string[];
          };

          await Promise.all(
            listing.folders.map(async (folder: string) => {
              const skillFile = `${folder}/SKILL.md`;
              const content = await this.safeReadVaultFile(skillFile);
              if (!content) return;

              const parsed = this.parseFrontmatter(content);
              const name = parsed.name || folder.split("/").pop() || folder;
              const description = parsed.description || "";

              out.push({ name, description, path: skillFile, scope: "project" });
            }),
          );
        }),
      );

      return out;
    } catch {
      return [];
    }
  }

  private async safeReadVaultFile(filePath: string): Promise<string | null> {
    const adapter: any = this.app.vault.adapter as any;

    try {
      if (!(await adapter.exists(filePath))) {
        return null;
      }

      const content = await adapter.read(filePath);
      return typeof content === "string" ? content : null;
    } catch {
      return null;
    }
  }

  private async readGlobalSkills(): Promise<SkillItem[]> {
    const skillsDir = PseudoGlobalSkillDir;
    const adapter: any = this.app.vault.adapter as any;

    try {
      if (!(await adapter.exists(skillsDir))) {
        return [];
      }

      const listing = (await adapter.list(skillsDir)) as {
        files: string[];
        folders: string[];
      };

      const out: SkillItem[] = [];

      await Promise.all(
        listing.folders.map(async (folder: string) => {
          const skillFile = `${folder}/SKILL.md`;
          const content = await this.safeReadVaultFile(skillFile);
          if (!content) return;

          const parsed = this.parseFrontmatter(content);
          const skillName = parsed.name || folder.split("/").pop() || folder;
          const description = parsed.description || "";

          out.push({
            name: skillName,
            description,
            path: skillFile,
            scope: "global",
          });
        }),
      );

      return out;
    } catch {
      return [];
    }
  }

  private parseFrontmatter(content: string): Record<string, string> {
    const lines = content.split(/\r?\n/);
    if (lines.length < 3) return {};
    if (lines[0].trim() !== "---") return {};

    const out: Record<string, string> = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "---") {
        break;
      }

      const idx = line.indexOf(":");
      if (idx === -1) continue;

      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) continue;

      const cleaned = value.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      out[key] = cleaned;
    }

    return out;
  }
}
