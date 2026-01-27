/**
 * SkillMention - / skill mention system
 *
 * Modeled after FileMention. Targets a `contenteditable` input element, inserting
 * inline, removable chips into the text flow.
 */

import { setIcon, type App } from "obsidian";
import * as fs from "fs";
import * as path from "path";

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
  private filteredItems: SkillItem[] = [];
  private selectedIndex: number = 0;
  private mentionRange: Range | null = null;
  private isOpen: boolean = false;

  private mentions: SkillItem[] = [];

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

  private handlePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    this.insertPlainTextAtCursor(text);
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    const text = e.dataTransfer?.getData("text/plain") ?? "";
    this.insertPlainTextAtCursor(text);
  }

  private handleBeforeInput(e: InputEvent): void {
    if (e.inputType !== "insertFromPaste" && e.inputType !== "insertFromDrop") {
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
  private findMentionTrigger(beforeCursor: string): { query: string } | null {
    let slashIndex = -1;

    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      const ch = beforeCursor[i];
      if (ch === "/") {
        if (i === 0 || /\s/.test(beforeCursor[i - 1])) {
          slashIndex = i;
          break;
        }
      }

      if (/\s/.test(ch) && i !== beforeCursor.length - 1) {
        break;
      }
    }

    if (slashIndex === -1) return null;

    const query = beforeCursor.slice(slashIndex + 1);
    if (query.includes("\n")) return null;

    this.mentionRange = this.computeMentionRange(
      slashIndex,
      beforeCursor.length,
    );
    if (!this.mentionRange) return null;

    return { query };
  }

  private computeMentionRange(
    slashIndex: number,
    cursorIndex: number,
  ): Range | null {
    const range = this.getSelectionRangeInInput();
    if (!range) return null;

    const full = range.cloneRange();
    full.collapse(true);
    full.setStart(this.inputEl, 0);

    const text = full.toString();
    const skip = Math.max(text.length - cursorIndex, 0);

    const startOffsetInText = text.length - cursorIndex + slashIndex;
    const endOffsetInText = text.length - skip;

    return this.rangeFromTextOffsets(startOffsetInText, endOffsetInText);
  }

  private rangeFromTextOffsets(start: number, end: number): Range | null {
    const walker = document.createTreeWalker(
      this.inputEl,
      NodeFilter.SHOW_TEXT,
      null,
    );

    let node = walker.nextNode() as Text | null;
    let offset = 0;

    const makePoint = (
      absolute: number,
    ): { node: Text; offset: number } | null => {
      let current = node;
      let currentOffset = offset;

      while (current) {
        const len = current.data.length;
        if (absolute <= currentOffset + len) {
          return {
            node: current,
            offset: Math.max(0, absolute - currentOffset),
          };
        }
        currentOffset += len;
        current = walker.nextNode() as Text | null;
      }
      return null;
    };

    walker.currentNode = this.inputEl;
    node = walker.nextNode() as Text | null;
    offset = 0;

    const startPoint = makePoint(start);

    walker.currentNode = this.inputEl;
    node = walker.nextNode() as Text | null;
    offset = 0;

    const endPoint = makePoint(end);
    if (!startPoint || !endPoint) return null;

    const r = document.createRange();
    r.setStart(startPoint.node, startPoint.offset);
    r.setEnd(endPoint.node, endPoint.offset);
    return r;
  }

  private handleInput(): void {
    this.ensureChipZWS();

    const beforeCursor = this.getTextBeforeCursor();
    const match = this.findMentionTrigger(beforeCursor);

    if (match) {
      void this.loadItems();
      this.filterItems(match.query);
      this.show();
      return;
    }

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

  private filterItems(query: string): void {
    const lowerQuery = query.toLowerCase();
    const mentioned = new Set(this.mentions.map((m) => m.path));

    let filtered = this.items.filter((item) => !mentioned.has(item.path));

    if (query) {
      filtered = filtered.filter((item) => {
        const lhs = item.name.toLowerCase();
        const rhs = item.description.toLowerCase();
        return lhs.includes(lowerQuery) || rhs.includes(lowerQuery);
      });
    }

    this.filteredItems = filtered.slice(0, 15);
    this.selectedIndex = 0;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    if (!this.suggestionsEl) return;
    this.suggestionsEl.innerHTML = "";

    if (this.filteredItems.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "opencodian-mention-empty";
      emptyEl.textContent = "No skills found";
      this.suggestionsEl.appendChild(emptyEl);
      return;
    }

    for (let i = 0; i < this.filteredItems.length; i++) {
      const item = this.filteredItems[i];
      const itemEl = document.createElement("div");
      itemEl.className = "opencodian-mention-item";
      if (i === this.selectedIndex) {
        itemEl.classList.add("selected");
      }

      const iconEl = document.createElement("span");
      iconEl.className = "opencodian-mention-icon";
      setIcon(iconEl, "wand");
      itemEl.appendChild(iconEl);

      const nameEl = document.createElement("span");
      nameEl.className = "opencodian-mention-path";
      nameEl.textContent = item.name;
      itemEl.appendChild(nameEl);

      const scopeEl = document.createElement("span");
      scopeEl.className = "opencodian-mention-scope";
      scopeEl.textContent = item.scope;
      itemEl.appendChild(scopeEl);

      itemEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selectItem(item);
      });

      itemEl.addEventListener("mouseenter", () => {
        this.selectedIndex = i;
        this.updateSelection();
      });

      this.suggestionsEl.appendChild(itemEl);
    }
  }

  private updateSelection(): void {
    if (!this.suggestionsEl) return;
    const items = this.suggestionsEl.querySelectorAll(
      ".opencodian-mention-item",
    );
    items.forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
    });

    const selectedEl = items[this.selectedIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen) return;

    const len = this.filteredItems.length;
    if (len === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex + 1) % len;
        this.updateSelection();
        break;

      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex - 1 + len) % len;
        this.updateSelection();
        break;

      case "Enter":
        e.preventDefault();
        e.stopImmediatePropagation();
        this.selectItem(this.filteredItems[this.selectedIndex]);
        break;

      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        break;

      case "Tab":
        e.preventDefault();
        e.stopPropagation();
        this.selectItem(this.filteredItems[this.selectedIndex]);
        break;
    }
  }

  private handleBlur(): void {
    setTimeout(() => this.hide(), 150);
  }

  private createInlineChip(item: SkillItem): HTMLElement {
    const chipEl = document.createElement("span");
    chipEl.className = "opencodian-inline-skill-chip";

    chipEl.setAttribute("contenteditable", "false");
    chipEl.setAttribute("data-skill-name", item.name);
    chipEl.setAttribute("data-skill-path", item.path);
    chipEl.setAttribute("data-skill-scope", item.scope);
    chipEl.title = item.description || item.name;

    const clickArea = document.createElement("span");
    clickArea.className = "opencodian-inline-skill-chip-click";

    const iconEl = document.createElement("span");
    iconEl.className = "opencodian-inline-skill-chip-icon";
    setIcon(iconEl, "wand");
    clickArea.appendChild(iconEl);

    const nameEl = document.createElement("span");
    nameEl.className = "opencodian-inline-skill-chip-name";
    nameEl.textContent = item.name;
    clickArea.appendChild(nameEl);

    chipEl.appendChild(clickArea);

    const removeEl = document.createElement("span");
    removeEl.className = "opencodian-inline-skill-chip-remove";
    setIcon(removeEl, "x");
    removeEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.removeMention(item);
      chipEl.remove();
    });
    chipEl.appendChild(removeEl);

    return chipEl;
  }

  private selectItem(item: SkillItem): void {
    if (!this.mentions.find((m) => m.path === item.path)) {
      this.mentions.push(item);
    }

    if (this.mentionRange) {
      this.mentionRange.deleteContents();

      const chipEl = this.createInlineChip(item);

      const zwsBefore = document.createTextNode(SkillMention.ZWS);
      this.mentionRange.insertNode(zwsBefore);
      zwsBefore.after(chipEl);

      const space = document.createTextNode(" ");
      chipEl.after(space);

      const after = document.createRange();
      after.setStartAfter(space);
      after.collapse(true);

      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(after);
      }

      this.mentionRange = null;
    } else {
      this.insertTextAtCursor(SkillMention.ZWS);
      this.insertNodeAtCursor(this.createInlineChip(item));
      this.insertTextAtCursor(" ");
    }

    this.hide();
    this.inputEl.focus();
  }

  private insertNodeAtCursor(node: Node): void {
    const range = this.getSelectionRangeInInput();
    if (!range) {
      this.inputEl.appendChild(node);
      return;
    }

    range.insertNode(node);

    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);

    const sel = window.getSelection();
    if (!sel) return;

    sel.removeAllRanges();
    sel.addRange(after);
  }

  private insertTextAtCursor(text: string): void {
    const node = document.createTextNode(text);
    this.insertNodeAtCursor(node);
  }

  private show(): void {
    if (!this.suggestionsEl) return;
    this.isOpen = true;
    this.suggestionsEl.style.display = "block";
  }

  private hide(): void {
    if (!this.suggestionsEl) return;
    this.isOpen = false;
    this.suggestionsEl.style.display = "none";
    this.mentionRange = null;
  }

  isSuggestionsOpen(): boolean {
    return this.isOpen;
  }

  getTextAndSkillsAndClear(): { text: string; skills: SkillItem[] } {
    const skills = this.getMentionsFromDom();
    const text = this.getPlainTextWithSkillNames();
    this.clearMentions();
    this.clearInput();
    return { text, skills };
  }

  getSkills(): SkillItem[] {
    return this.getMentionsFromDom();
  }

  getText(): string {
    return this.getPlainTextWithSkillNames();
  }

  clear(): void {
    this.clearMentions();
    this.clearInput();
  }

  getSkillsAndClear(): SkillItem[] {
    const result = this.getMentionsFromDom();
    this.clearMentions();
    return result;
  }

  private clearInput(): void {
    this.inputEl.innerHTML = "";
  }

  clearMentions(): void {
    this.mentions = [];

    const chips = this.inputEl.querySelectorAll(
      ".opencodian-inline-skill-chip",
    );
    chips.forEach((el) => el.remove());
  }

  private removeMention(item: SkillItem): void {
    this.mentions = this.mentions.filter((m) => m.path !== item.path);
  }

  private getMentionsFromDom(): SkillItem[] {
    const els = this.inputEl.querySelectorAll(
      ".opencodian-inline-skill-chip[data-skill-path]",
    );

    const out: SkillItem[] = [];
    for (const el of Array.from(els)) {
      const skillPath = el.getAttribute("data-skill-path") || "";
      const name = el.getAttribute("data-skill-name") || "";
      const scope =
        el.getAttribute("data-skill-scope") === "global" ? "global" : "project";
      if (!skillPath || !name) continue;
      out.push({ name, description: "", path: skillPath, scope });
    }
    return out;
  }

  private getPlainTextWithSkillNames(): string {
    const clone = this.inputEl.cloneNode(true) as HTMLElement;

    const chips = clone.querySelectorAll(
      ".opencodian-inline-skill-chip[data-skill-name]",
    );
    for (const chip of Array.from(chips)) {
      const name = chip.getAttribute("data-skill-name") || "";
      chip.replaceWith(document.createTextNode(name));
    }

    return (clone.textContent || "").replace(/\u200B/g, "").trim();
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

  private getGlobalSkillsDir(): string | null {
    const home = process.env.USERPROFILE || process.env.HOME;
    if (!home) return null;
    return path.join(home, ".claude", "skills");
  }

  private async readProjectSkills(): Promise<SkillItem[]> {
    const skillsDir = ".claude/skills";
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
          const name = parsed.name || folder.split("/").pop() || folder;
          const description = parsed.description || "";

          out.push({ name, description, path: skillFile, scope: "project" });
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
    const base = this.getGlobalSkillsDir();
    if (!base) return [];

    const out: SkillItem[] = [];

    try {
      const folderNames = await this.listLocalFolders(base);

      await Promise.all(
        folderNames.map(async (name) => {
          const skillFile = path.join(base, name, "SKILL.md");
          const content = await this.safeReadAbsoluteFile(skillFile);
          if (!content) return;

          const parsed = this.parseFrontmatter(content);
          const skillName = parsed.name || name;
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

  private async safeReadAbsoluteFile(filePath: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  private async listLocalFolders(dir: string): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
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
