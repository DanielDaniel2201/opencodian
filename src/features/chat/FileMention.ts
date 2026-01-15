/**
 * FileMention - @ file/folder mention system
 * 
 * Detects "@" in input and shows file suggestions from the vault.
 * Selected files appear as chips in a separate bar above the input.
 */

import { TFolder, setIcon, type App } from "obsidian";

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
  
  /** Currently selected mentions */
  private mentions: MentionItem[] = [];

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

  /** Load files and folders from vault, excluding hidden ones */
  private loadItems(): void {
    const allFiles = this.app.vault.getAllLoadedFiles();
    const items: MentionItem[] = [];
    const seenFolders = new Set<string>();

    for (const file of allFiles) {
      if (this.isHiddenPath(file.path)) continue;
      if (file.path === "/" || file.path === "") continue;

      if (file instanceof TFolder) {
        if (!seenFolders.has(file.path)) {
          seenFolders.add(file.path);
          items.push({
            path: file.path,
            name: file.name,
            isFolder: true,
          });
        }
      } else {
        items.push({
          path: file.path,
          name: file.name,
          isFolder: false,
        });
      }
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

    if (this.mentions.length === 0) {
      this.chipsBarEl.style.display = "none";
      return;
    }

    this.chipsBarEl.style.display = "flex";

    for (const item of this.mentions) {
      const chipEl = document.createElement("div");
      chipEl.className = "opencodian-mention-chip";

      // Icon
      const iconEl = document.createElement("span");
      iconEl.className = "opencodian-mention-chip-icon";
      setIcon(iconEl, item.isFolder ? "folder" : "file-text");
      chipEl.appendChild(iconEl);

      // Name only (not full path)
      const nameEl = document.createElement("span");
      nameEl.className = "opencodian-mention-chip-name";
      nameEl.textContent = item.name;
      nameEl.title = item.path; // Show full path on hover
      chipEl.appendChild(nameEl);

      // Remove button
      const removeEl = document.createElement("span");
      removeEl.className = "opencodian-mention-chip-remove";
      setIcon(removeEl, "x");
      removeEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeMention(item);
      });
      chipEl.appendChild(removeEl);

      this.chipsBarEl.appendChild(chipEl);
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
      this.filterItems(mentionMatch.query);
      this.show();
    } else {
      this.hide();
    }
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
        e.stopPropagation(); // Critical: prevent View from sending message
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

  /** Get current mentions and clear them */
  getMentionsAndClear(): MentionItem[] {
    const result = [...this.mentions];
    this.mentions = [];
    this.renderChips();
    return result;
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

  destroy(): void {
    if (this.suggestionsEl) {
      this.suggestionsEl.remove();
    }
    if (this.chipsBarEl) {
      this.chipsBarEl.remove();
    }
  }
}
