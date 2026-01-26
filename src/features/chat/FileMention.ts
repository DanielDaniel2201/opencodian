/**
 * FileMention - @ file/folder mention system
 *
 * IMPORTANT: This implementation targets a `contenteditable` input element.
 * It inserts inline, clickable chips directly into the text flow.
 */

import { TFolder, TFile, setIcon, type App } from "obsidian";

/** Represents a mentionable file or folder */
export interface MentionItem {
  path: string;
  name: string;
  isFolder: boolean;
}

export class FileMention {
  private app: App;
  private inputEl: HTMLElement;
  private containerEl: HTMLElement;
  private suggestionsEl: HTMLElement | null = null;

  private handlePasteBound: (e: ClipboardEvent) => void;
  private handleDropBound: (e: DragEvent) => void;
  private handleBeforeInputBound: (e: InputEvent) => void;

  private items: MentionItem[] = [];
  private filteredItems: MentionItem[] = [];
  private selectedIndex: number = 0;
  private mentionRange: Range | null = null;
  private isOpen: boolean = false;

  private mentions: MentionItem[] = [];
  private activeFileMention: MentionItem | null = null;

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
    this.loadItems();

    this.inputEl.addEventListener("input", this.handleInput.bind(this));
    this.inputEl.addEventListener("keydown", this.handleKeyDown.bind(this));
    this.inputEl.addEventListener("blur", this.handleBlur.bind(this));
    this.inputEl.addEventListener("paste", this.handlePasteBound);
    this.inputEl.addEventListener("drop", this.handleDropBound);
    this.inputEl.addEventListener("beforeinput", this.handleBeforeInputBound);

    this.createSuggestionsEl();
  }

  /** Load files and folders from vault - all Obsidian-visible files */
  private loadItems(): void {
    const items: MentionItem[] = [];
    const seenFolders = new Set<string>();

    const allFiles = this.app.vault.getFiles();

    for (const file of allFiles) {
      if (this.isHiddenPath(file.path)) continue;

      const parts = file.path.split("/");
      let folderPath = "";
      for (let i = 0; i < parts.length - 1; i++) {
        folderPath = folderPath ? `${folderPath}/${parts[i]}` : parts[i];
        if (!seenFolders.has(folderPath) && !this.isHiddenPath(folderPath)) {
          seenFolders.add(folderPath);
          items.push({
            path: folderPath,
            name: parts[i],
            isFolder: true,
          });
        }
      }

      items.push({
        path: file.path,
        name: file.name,
        isFolder: false,
      });
    }

    items.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    this.items = items;
  }

  private isHiddenPath(path: string): boolean {
    const segments = path.split("/");
    for (const seg of segments) {
      if (seg.startsWith(".")) return true;
    }
    return false;
  }

  /** Create the suggestions dropdown */
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

  /** Find the @query trigger right before cursor */
  private findMentionTrigger(beforeCursor: string): { query: string } | null {
    let atIndex = -1;

    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      const ch = beforeCursor[i];
      if (ch === "@") {
        if (i === 0 || /\s/.test(beforeCursor[i - 1])) {
          atIndex = i;
          break;
        }
      }

      if (/\s/.test(ch) && i !== beforeCursor.length - 1) {
        break;
      }
    }

    if (atIndex === -1) return null;

    const query = beforeCursor.slice(atIndex + 1);
    if (query.includes("\n")) return null;

    this.mentionRange = this.computeMentionRange(atIndex, beforeCursor.length);
    if (!this.mentionRange) return null;

    return { query };
  }

  private computeMentionRange(
    atIndex: number,
    cursorIndex: number,
  ): Range | null {
    const range = this.getSelectionRangeInInput();
    if (!range) return null;

    const full = range.cloneRange();
    full.collapse(true);
    full.setStart(this.inputEl, 0);

    const text = full.toString();
    const skip = Math.max(text.length - cursorIndex, 0);

    const startOffsetInText = text.length - cursorIndex + atIndex;
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

    node = walker.currentNode as Text | null;
    offset = 0;

    // Reset walker state
    walker.currentNode = this.inputEl;
    node = walker.nextNode() as Text | null;
    offset = 0;

    const startPoint = makePoint(start);

    // Reset walker again because makePoint consumed it
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

  /** Zero Width Space - used to ensure cursor can be placed before/after chips */
  private static readonly ZWS = "\u200B";

  /** Handle input changes - detect @ trigger */
  private handleInput(): void {
    // Ensure chips always have ZWS before them for cursor positioning
    this.ensureChipZWS();

    // Remove active mention chip if editor is empty besides it.
    if (this.activeFileMention) {
      const text = this.getPlainText().trim();
      if (!text) {
        // Keep active mention as a chip even if there's no text.
      }
    }

    const beforeCursor = this.getTextBeforeCursor();
    const mentionMatch = this.findMentionTrigger(beforeCursor);

    if (mentionMatch) {
      this.loadItems();
      this.filterItems(mentionMatch.query);
      this.show();
      return;
    }

    this.hide();
  }

  /**
   * Ensure every chip has a ZWS before it for cursor positioning.
   * This prevents the bug where deleting all text before a chip
   * causes it to jump lines and become unreachable.
   */
  private ensureChipZWS(): void {
    const chips = this.inputEl.querySelectorAll(
      ".opencodian-inline-mention-chip",
    );

    for (const chip of Array.from(chips)) {
      const prev = chip.previousSibling;

      // Check if previous sibling is a text node ending with ZWS
      if (!prev || prev.nodeType !== Node.TEXT_NODE) {
        // No text node before chip - insert ZWS
        const zws = document.createTextNode(FileMention.ZWS);
        chip.parentNode?.insertBefore(zws, chip);
      } else {
        const textNode = prev as Text;
        // If text node is empty or doesn't end with our ZWS, add one
        if (textNode.data.length === 0) {
          textNode.data = FileMention.ZWS;
        }
      }
    }
  }

  /** Filter items based on query */
  private filterItems(query: string): void {
    const lowerQuery = query.toLowerCase();
    const mentionedPaths = new Set(this.mentions.map((m) => m.path));

    let filtered = this.items.filter((item) => !mentionedPaths.has(item.path));

    if (query) {
      filtered = filtered.filter((item) => {
        const lowerPath = item.path.toLowerCase();
        const lowerName = item.name.toLowerCase();
        return lowerPath.includes(lowerQuery) || lowerName.includes(lowerQuery);
      });
    }

    this.filteredItems = filtered.slice(0, 15);
    this.selectedIndex = 0;
    this.renderSuggestions();
  }

  /** Render suggestions list */
  private renderSuggestions(): void {
    if (!this.suggestionsEl) return;
    this.suggestionsEl.innerHTML = "";

    if (this.filteredItems.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "opencodian-mention-empty";
      emptyEl.textContent = "No files found";
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
      setIcon(iconEl, item.isFolder ? "folder" : "file-text");
      itemEl.appendChild(iconEl);

      const pathEl = document.createElement("span");
      pathEl.className = "opencodian-mention-path";
      pathEl.textContent = item.path;
      itemEl.appendChild(pathEl);

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

  /** Update visual selection */
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

  /** Handle keyboard navigation */
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

  private createInlineChip(item: MentionItem, isActive: boolean): HTMLElement {
    const chipEl = document.createElement("span");
    chipEl.className = "opencodian-inline-mention-chip";
    if (isActive) {
      chipEl.classList.add("opencodian-inline-mention-chip-active");
    }

    chipEl.setAttribute("contenteditable", "false");
    chipEl.setAttribute("data-mention-path", item.path);
    chipEl.setAttribute("data-mention-name", item.name);
    chipEl.setAttribute("data-mention-folder", item.isFolder ? "1" : "0");
    chipEl.title = item.path;

    const clickArea = document.createElement("span");
    clickArea.className = "opencodian-inline-mention-chip-click";
    clickArea.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openFile(item.path);
    });

    const iconEl = document.createElement("span");
    iconEl.className = "opencodian-inline-mention-chip-icon";
    setIcon(iconEl, item.isFolder ? "folder" : "file-text");
    clickArea.appendChild(iconEl);

    const nameEl = document.createElement("span");
    nameEl.className = "opencodian-inline-mention-chip-name";
    nameEl.textContent = item.name;
    clickArea.appendChild(nameEl);

    chipEl.appendChild(clickArea);

    const removeEl = document.createElement("span");
    removeEl.className = "opencodian-inline-mention-chip-remove";
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

  /** Select an item - insert chip and remove @query */
  private selectItem(item: MentionItem): void {
    if (!this.mentions.find((m) => m.path === item.path)) {
      this.mentions.push(item);
    }

    if (this.mentionRange) {
      this.mentionRange.deleteContents();

      // Create chip with ZWS wrapper for proper cursor behavior
      const chipEl = this.createInlineChip(item, false);

      // Insert ZWS before chip (ensures cursor can be placed before)
      const zwsBefore = document.createTextNode(FileMention.ZWS);
      this.mentionRange.insertNode(zwsBefore);
      zwsBefore.after(chipEl);

      // Insert space after chip (natural text flow)
      const space = document.createTextNode(" ");
      chipEl.after(space);

      // Position cursor after the space
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
      // Insert ZWS before chip
      this.insertTextAtCursor(FileMention.ZWS);
      this.insertNodeAtCursor(this.createInlineChip(item, false));
      this.insertTextAtCursor(" ");
    }

    this.hide();
    this.inputEl.focus();
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

  /** Open a file in Obsidian */
  openFile(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return;

    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf) {
        leaf.openFile(file);
      }
      return;
    }

    if (file instanceof TFolder) {
      const fileExplorer =
        this.app.workspace.getLeavesOfType("file-explorer")[0];
      if (fileExplorer) {
        this.app.workspace.revealLeaf(fileExplorer);
        const explorerView = fileExplorer.view as any;
        if (explorerView?.revealInFolder) {
          explorerView.revealInFolder(file);
        }
      }
    }
  }

  private removeMention(item: MentionItem): void {
    this.mentions = this.mentions.filter((m) => m.path !== item.path);

    // If active file chip removed, disable it.
    if (this.activeFileMention && this.activeFileMention.path === item.path) {
      this.activeFileMention = null;
    }
  }

  /** Get current mention paths */
  getMentionPaths(): string[] {
    return this.getMentionsFromDom().map((m) => m.path);
  }

  private getMentionsFromDom(): MentionItem[] {
    const els = this.inputEl.querySelectorAll(
      ".opencodian-inline-mention-chip[data-mention-path]",
    );

    const out: MentionItem[] = [];
    for (const el of Array.from(els)) {
      const path = el.getAttribute("data-mention-path") || "";
      const name = el.getAttribute("data-mention-name") || "";
      const isFolder = el.getAttribute("data-mention-folder") === "1";
      if (!path) continue;
      out.push({ path, name, isFolder });
    }
    return out;
  }

  /**
   * Extract plain text & mentions then clear input.
   * Chips become their `name` in the returned text.
   */
  getTextAndMentionsAndClear(): { text: string; mentions: MentionItem[] } {
    const mentions = this.getMentionsFromDom();
    const text = this.getPlainTextWithMentionNames();

    this.clearMentions();
    this.clearInput();

    return { text, mentions };
  }

  private clearInput(): void {
    this.inputEl.innerHTML = "";
  }

  private getPlainText(): string {
    // Remove ZWS characters that are only used for cursor positioning
    return (this.inputEl.textContent || "").replace(/\u200B/g, "");
  }

  private getPlainTextWithMentionNames(): string {
    const clone = this.inputEl.cloneNode(true) as HTMLElement;

    const chips = clone.querySelectorAll(
      ".opencodian-inline-mention-chip[data-mention-name]",
    );
    for (const chip of Array.from(chips)) {
      const name = chip.getAttribute("data-mention-name") || "";
      chip.replaceWith(document.createTextNode(name));
    }

    // Remove ZWS characters that are only used for cursor positioning
    return (clone.textContent || "").replace(/\u200B/g, "").trim();
  }

  /** Clear all mentions (both manual and active file) */
  clearMentions(): void {
    this.mentions = [];
    this.activeFileMention = null;

    const chips = this.inputEl.querySelectorAll(
      ".opencodian-inline-mention-chip",
    );
    chips.forEach((el) => el.remove());
  }

  /** Check if suggestions dropdown is open */
  isSuggestionsOpen(): boolean {
    return this.isOpen;
  }

  refresh(): void {
    this.loadItems();
  }

  /** Add a mention programmatically */
  addMention(path: string): boolean {
    if (this.mentions.find((m) => m.path === path)) {
      return false;
    }

    const item = this.items.find((i) => i.path === path);
    if (!item) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) return false;

      this.mentions.push({
        path: path,
        name: file.name,
        isFolder: file instanceof TFolder,
      });
    } else {
      this.mentions.push(item);
    }

    return true;
  }

  /** Set the active file mention (insert or update a pinned chip) */
  setActiveFileMention(path: string | null): void {
    const existing = this.inputEl.querySelector(
      ".opencodian-inline-mention-chip-active[data-mention-path]",
    ) as HTMLElement | null;

    if (!path) {
      this.activeFileMention = null;
      if (existing) existing.remove();
      return;
    }

    if (this.activeFileMention && this.activeFileMention.path === path) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      this.activeFileMention = null;
      if (existing) existing.remove();
      return;
    }

    const item: MentionItem = {
      path: path,
      name: file.name,
      isFolder: file instanceof TFolder,
    };
    this.activeFileMention = item;

    if (existing) existing.remove();

    const chipEl = this.createInlineChip(item, true);
    this.inputEl.insertBefore(chipEl, this.inputEl.firstChild);
    this.inputEl.insertBefore(document.createTextNode(" "), chipEl.nextSibling);
  }

  /** Get all mentions (active file + manual) and clear them */
  getMentionsAndClear(): MentionItem[] {
    const result = this.getMentionsFromDom();
    this.clearMentions();
    return result;
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
}
