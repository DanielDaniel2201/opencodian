/**
 * FileMention - @ file/folder mention system
 * 
 * Detects "@" in input and shows file suggestions from the vault.
 * Selected files appear as chips in a separate bar above the input.
 * Only shows files that are visible in Obsidian (markdown files and folders).
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
  private inputEl: HTMLTextAreaElement;
  private containerEl: HTMLElement;
  private suggestionsEl: HTMLElement | null = null;
  private chipsBarEl: HTMLElement | null = null;
  private items: MentionItem[] = [];
  private filteredItems: MentionItem[] = [];
  private selectedIndex: number = 0;
  private mentionStart: number = -1;
  private isOpen: boolean = false;
  
  /** Currently selected mentions (manually added by user) */
  private mentions: MentionItem[] = [];
  
  /** Auto-added active file mention (separate from manual mentions) */
  private activeFileMention: MentionItem | null = null;

  constructor(app: App, inputEl: HTMLTextAreaElement, containerEl: HTMLElement) {
    this.app = app;
    this.inputEl = inputEl;
    this.containerEl = containerEl;
    this.init();
  }

  private init(): void {
    this.loadItems();

    this.inputEl.addEventListener("input", this.handleInput.bind(this));
    this.inputEl.addEventListener("keydown", this.handleKeyDown.bind(this));
    this.inputEl.addEventListener("blur", this.handleBlur.bind(this));

    this.createChipsBar();
    this.createSuggestionsEl();
  }

  /** Load files and folders from vault - all Obsidian-visible files (not just markdown) */
  private loadItems(): void {
    const items: MentionItem[] = [];
    const seenFolders = new Set<string>();

    // Use vault.getFiles() to get ALL files Obsidian tracks (md, canvas, excalidraw, etc.)
    // This excludes hidden files (starting with .) that Obsidian doesn't show
    const allFiles = this.app.vault.getFiles();
    
    for (const file of allFiles) {
      if (this.isHiddenPath(file.path)) continue;
      
      // Add parent folders
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
      
      // Add file
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

  /** Create chips bar above input */
  private createChipsBar(): void {
    this.chipsBarEl = document.createElement("div");
    this.chipsBarEl.className = "opencodian-mention-chips";
    this.chipsBarEl.style.display = "none";
    // Insert before the textarea
    this.containerEl.insertBefore(this.chipsBarEl, this.inputEl);
  }

  /** Create the suggestions dropdown */
  private createSuggestionsEl(): void {
    this.suggestionsEl = document.createElement("div");
    this.suggestionsEl.className = "opencodian-mention-suggestions";
    this.suggestionsEl.style.display = "none";
    this.containerEl.appendChild(this.suggestionsEl);
  }

  /** Render chips bar */
  private renderChips(): void {
    if (!this.chipsBarEl) return;
    this.chipsBarEl.innerHTML = "";

    // Combine active file mention (if any) with manual mentions
    const allMentions: MentionItem[] = [];
    if (this.activeFileMention) {
      allMentions.push(this.activeFileMention);
    }
    // Add manual mentions (excluding the active file if it was manually added too)
    for (const m of this.mentions) {
      if (!this.activeFileMention || m.path !== this.activeFileMention.path) {
        allMentions.push(m);
      }
    }

    if (allMentions.length === 0) {
      this.chipsBarEl.style.display = "none";
      return;
    }

    this.chipsBarEl.style.display = "flex";

    for (let i = 0; i < allMentions.length; i++) {
      const item = allMentions[i];
      const isActiveFile = this.activeFileMention && item.path === this.activeFileMention.path;
      
      const chipEl = document.createElement("div");
      chipEl.className = "opencodian-mention-chip opencodian-mention-chip-clickable";
      if (isActiveFile) {
        chipEl.classList.add("opencodian-mention-chip-active");
      }

      // Click to open file (on icon and name area)
      const clickArea = document.createElement("span");
      clickArea.className = "opencodian-mention-chip-click-area";
      clickArea.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openFile(item.path);
      });

      // Icon
      const iconEl = document.createElement("span");
      iconEl.className = "opencodian-mention-chip-icon";
      setIcon(iconEl, item.isFolder ? "folder" : "file-text");
      clickArea.appendChild(iconEl);

      // Name only (not full path)
      const nameEl = document.createElement("span");
      nameEl.className = "opencodian-mention-chip-name";
      nameEl.textContent = item.name;
      nameEl.title = item.path; // Show full path on hover
      clickArea.appendChild(nameEl);

      chipEl.appendChild(clickArea);

      // Remove button (for active file, removes it from auto-tracking; for manual, removes from list)
      const removeEl = document.createElement("span");
      removeEl.className = "opencodian-mention-chip-remove";
      setIcon(removeEl, "x");
      removeEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isActiveFile) {
          this.activeFileMention = null;
        } else {
          this.removeMention(item);
        }
        this.renderChips();
      });
      chipEl.appendChild(removeEl);

      this.chipsBarEl.appendChild(chipEl);
    }
  }

  /** Open a file in Obsidian */
  openFile(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    
    if (file instanceof TFile) {
      // Open file in a new leaf
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf) {
        leaf.openFile(file);
      }
    } else if (file instanceof TFolder) {
      // For folders, reveal in file explorer
      const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
      if (fileExplorer) {
        this.app.workspace.revealLeaf(fileExplorer);
        // Try to expand the folder in the file explorer
        const explorerView = fileExplorer.view as any;
        if (explorerView?.revealInFolder) {
          explorerView.revealInFolder(file);
        }
      }
    }
  }

  /** Remove a mention */
  private removeMention(item: MentionItem): void {
    this.mentions = this.mentions.filter(m => m.path !== item.path);
    this.renderChips();
  }

  /** Handle input changes - detect @ trigger */
  private handleInput(): void {
    const cursorPos = this.inputEl.selectionStart;
    const text = this.inputEl.value;

    const mentionMatch = this.findMentionTrigger(text, cursorPos);

    if (mentionMatch) {
      this.mentionStart = mentionMatch.start;
      this.loadItems();
      this.filterItems(mentionMatch.query);
      this.show();
      return;
    }

    this.hide();
  }

  /** Find @query pattern before cursor */
  private findMentionTrigger(text: string, cursorPos: number): { start: number; query: string } | null {
    const beforeCursor = text.slice(0, cursorPos);
    
    let atIndex = -1;
    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      if (beforeCursor[i] === "@") {
        if (i === 0 || /\s/.test(beforeCursor[i - 1])) {
          atIndex = i;
          break;
        }
      }
      if (/\s/.test(beforeCursor[i]) && i !== beforeCursor.length - 1) {
        break;
      }
    }

    if (atIndex === -1) return null;

    const query = beforeCursor.slice(atIndex + 1);
    if (query.includes("\n")) return null;

    return { start: atIndex, query };
  }

  /** Filter items based on query */
  private filterItems(query: string): void {
    const lowerQuery = query.toLowerCase();
    const mentionedPaths = new Set(this.mentions.map(m => m.path));
    
    let filtered = this.items.filter(item => !mentionedPaths.has(item.path));
    
    if (query) {
      filtered = filtered.filter(item => {
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

      // Flat line icon
      const iconEl = document.createElement("span");
      iconEl.className = "opencodian-mention-icon";
      setIcon(iconEl, item.isFolder ? "folder" : "file-text");
      itemEl.appendChild(iconEl);

      // Path display
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
    const items = this.suggestionsEl.querySelectorAll(".opencodian-mention-item");
    items.forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
    });

    const selectedEl = items[this.selectedIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  /** Handle keyboard navigation with cyclic scrolling */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen) return;

    const len = this.filteredItems.length;
    if (len === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        // Cyclic: wrap to top when at bottom
        this.selectedIndex = (this.selectedIndex + 1) % len;
        this.updateSelection();
        break;

      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        // Cyclic: wrap to bottom when at top
        this.selectedIndex = (this.selectedIndex - 1 + len) % len;
        this.updateSelection();
        break;

      case "Enter":
        e.preventDefault();
        e.stopImmediatePropagation(); // Critical: prevent View's keydown handler from sending
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

  /** Select an item - add to chips, remove @query from input */
  private selectItem(item: MentionItem): void {
    // Add to mentions
    if (!this.mentions.find(m => m.path === item.path)) {
      this.mentions.push(item);
      this.renderChips();
    }

    // Remove @query from input
    const text = this.inputEl.value;
    const cursorPos = this.inputEl.selectionStart;
    const before = text.slice(0, this.mentionStart);
    const after = text.slice(cursorPos);
    
    this.inputEl.value = before + after;
    this.inputEl.setSelectionRange(before.length, before.length);

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
    this.mentionStart = -1;
  }

  /** Get current mention paths */
  getMentionPaths(): string[] {
    return this.mentions.map(m => m.path);
  }

  /** Check if suggestions dropdown is open */
  isSuggestionsOpen(): boolean {
    return this.isOpen;
  }

  refresh(): void {
    this.loadItems();
  }

  /** Add a mention programmatically (e.g., for active file tracking) */
  addMention(path: string): boolean {
    // Check if already mentioned
    if (this.mentions.find(m => m.path === path)) {
      return false;
    }
    
    // Find item in our list
    const item = this.items.find(i => i.path === path);
    if (!item) {
      // Item not in our markdown files list - could be a non-markdown file
      // Create a basic item for it
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
    
    this.renderChips();
    return true;
  }

  /** Set the active file mention (REPLACES previous active file, not accumulate) */
  setActiveFileMention(path: string | null): void {
    if (!path) {
      // No active file - clear the active file mention
      this.activeFileMention = null;
      this.renderChips();
      return;
    }
    
    // If it's the same file, do nothing
    if (this.activeFileMention && this.activeFileMention.path === path) {
      return;
    }
    
    // Create new active file mention item
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      this.activeFileMention = null;
      this.renderChips();
      return;
    }
    
    this.activeFileMention = {
      path: path,
      name: file.name,
      isFolder: file instanceof TFolder,
    };
    
    this.renderChips();
  }

  /** Clear all mentions (both manual and active file) */
  clearMentions(): void {
    this.mentions = [];
    this.activeFileMention = null;
    this.renderChips();
  }

  /** Get all mentions (active file + manual) and clear them */
  getMentionsAndClear(): MentionItem[] {
    const result: MentionItem[] = [];
    
    // Add active file first
    if (this.activeFileMention) {
      result.push(this.activeFileMention);
    }
    
    // Add manual mentions (excluding active file if duplicated)
    for (const m of this.mentions) {
      if (!this.activeFileMention || m.path !== this.activeFileMention.path) {
        result.push(m);
      }
    }
    
    // Clear all
    this.mentions = [];
    this.activeFileMention = null;
    this.renderChips();
    
    return result;
  }

  /** Create a clickable chip element for use outside this component (e.g., in message bubbles) */
  static createChipElement(
    app: App,
    path: string,
    name: string,
    isFolder: boolean,
    openFile: (path: string) => void
  ): HTMLElement {
    const chipEl = document.createElement("div");
    chipEl.className = "message-mention-chip message-mention-chip-clickable";
    chipEl.style.cursor = "pointer";
    chipEl.title = path;
    
    chipEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFile(path);
    });

    const iconEl = document.createElement("span");
    iconEl.className = "message-mention-icon";
    setIcon(iconEl, isFolder ? "folder" : "file-text");
    chipEl.appendChild(iconEl);

    const nameEl = document.createElement("span");
    nameEl.className = "message-mention-name";
    nameEl.textContent = name;
    chipEl.appendChild(nameEl);

    return chipEl;
  }

  destroy(): void {
    if (this.suggestionsEl) {
      this.suggestionsEl.remove();
    }
    if (this.chipsBarEl) {
      this.chipsBarEl.remove();
    }
  }
}
