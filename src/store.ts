// The single source of truth for all lists.
//
// Responsibilities:
//   - Load lists from <globalStorage>/lists/*.md on startup (create "Inbox" if empty).
//   - Keep lists in memory and serve view state to the webview.
//   - Persist every change with a debounced, atomic (temp file + rename) write.
//   - Watch the .md files and refresh when they are edited by hand.
//   - Keep small UI state (list order, active list, Done open/closed) in globalState.

import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { parse, serialize } from "./markdown";
import type { SaveStatus, TodoList, ViewState } from "./types";

const KEY_ORDER = "pipTodos.listOrder";
const KEY_ACTIVE = "pipTodos.activeId";
const KEY_SHOW_DONE = "pipTodos.showDone";

const SAVE_DEBOUNCE_MS = 300;
const WATCH_SUPPRESS_MS = 1200;

let itemCounter = 0;
function newItemId(): string {
  itemCounter += 1;
  return `t${Date.now().toString(36)}_${itemCounter}`;
}

export function safeFileStem(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return stem || "list";
}

export class Store {
  private lists: TodoList[] = [];
  private activeId: string | null = null;
  private showDone = true;

  private readonly listsDir: string;
  private readonly saveTimers = new Map<string, NodeJS.Timeout>();
  private readonly suppressUntil = new Map<string, number>();
  private pendingWrites = 0;
  private watcher: vscode.FileSystemWatcher | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private readonly _onSaveStatus = new vscode.EventEmitter<SaveStatus>();
  readonly onSaveStatus = this._onSaveStatus.event;
  private readonly _onToast = new vscode.EventEmitter<string>();
  readonly onToast = this._onToast.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.listsDir = path.join(context.globalStorageUri.fsPath, "lists");
    this.showDone = context.globalState.get<boolean>(KEY_SHOW_DONE, true);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.listsDir, { recursive: true });
    await this.loadFromDisk();

    if (this.lists.length === 0) {
      await this.createList("Inbox", { silent: true });
    }

    const savedActive = this.context.globalState.get<string>(KEY_ACTIVE);
    this.activeId =
      savedActive && this.lists.some((l) => l.id === savedActive)
        ? savedActive
        : this.lists[0]?.id ?? null;

    this.startWatching();
  }

  dispose(): void {
    this.flushAll();
    this.watcher?.dispose();
    this._onDidChange.dispose();
    this._onSaveStatus.dispose();
    this._onToast.dispose();
  }

  // ---- Reading state -------------------------------------------------------

  getState(): ViewState {
    return {
      lists: this.lists.map((l) => ({
        id: l.id,
        name: l.name,
        fileName: `${l.id}.md`,
        openCount: l.items.filter((i) => !i.done).length,
        items: l.items,
      })),
      activeId: this.activeId,
      showDone: this.showDone,
    };
  }

  getLists(): TodoList[] {
    return this.lists;
  }

  private active(): TodoList | undefined {
    return this.lists.find((l) => l.id === this.activeId);
  }

  // ---- Mutations -----------------------------------------------------------

  addTodo(text: string): void {
    const t = text.trim();
    const list = this.active();
    if (!t || !list) {
      return;
    }
    list.items.unshift({ id: newItemId(), text: t, done: false });
    this.changed(list);
  }

  toggleTodo(itemId: string): void {
    const list = this.active();
    const item = list?.items.find((i) => i.id === itemId);
    if (!list || !item) {
      return;
    }
    item.done = !item.done;
    this.changed(list);
  }

  editTodo(itemId: string, text: string): void {
    const list = this.active();
    const item = list?.items.find((i) => i.id === itemId);
    if (!list || !item) {
      return;
    }
    const t = text.trim();
    if (!t) {
      list.items = list.items.filter((i) => i.id !== itemId);
    } else {
      item.text = t;
    }
    this.changed(list);
  }

  deleteTodo(itemId: string): void {
    const list = this.active();
    if (!list) {
      return;
    }
    const before = list.items.length;
    list.items = list.items.filter((i) => i.id !== itemId);
    if (list.items.length !== before) {
      this.changed(list);
    }
  }

  clearDone(): void {
    const list = this.active();
    if (!list) {
      return;
    }
    const before = list.items.length;
    list.items = list.items.filter((i) => !i.done);
    if (list.items.length !== before) {
      this.changed(list);
    }
  }

  async createList(
    name: string,
    opts: { silent?: boolean } = {}
  ): Promise<string> {
    const display = name.trim() || "Untitled";
    const id = this.uniqueStem(safeFileStem(display));

    // If a list with this stem already exists, switch to it instead.
    const existing = this.lists.find((l) => l.id === id);
    if (existing) {
      this.switchList(existing.id);
      return existing.id;
    }

    const list: TodoList = { id, name: display, items: [] };
    this.lists.push(list);
    this.activeId = id;
    this.persistOrder();
    this.persistActive();
    await this.writeList(list);
    if (!opts.silent) {
      this.emitChange();
    }
    return id;
  }

  switchList(id: string): void {
    if (this.lists.some((l) => l.id === id)) {
      this.activeId = id;
      this.persistActive();
      this.emitChange();
    }
  }

  renameList(id: string, name: string): void {
    const list = this.lists.find((l) => l.id === id);
    const display = name.trim();
    if (!list || !display) {
      return;
    }
    // Keep the file name (id) stable on rename; only the display name changes.
    list.name = display;
    this.changed(list);
  }

  async deleteList(id: string): Promise<void> {
    const idx = this.lists.findIndex((l) => l.id === id);
    if (idx === -1) {
      return;
    }
    this.cancelPendingWrite(id);
    this.lists.splice(idx, 1);

    if (this.activeId === id) {
      this.activeId = this.lists[Math.max(0, idx - 1)]?.id ?? null;
    }

    // Make sure the view is never empty.
    if (this.lists.length === 0) {
      await this.createList("Inbox", { silent: true });
    }

    this.persistOrder();
    this.persistActive();
    await this.deleteListFile(id);
    this.emitChange();
  }

  setShowDone(show: boolean): void {
    this.showDone = show;
    void this.context.globalState.update(KEY_SHOW_DONE, show);
    this.emitChange();
  }

  toggleDoneSection(): void {
    this.setShowDone(!this.showDone);
  }

  // ---- Import --------------------------------------------------------------

  async importLists(
    imported: { id: string; name: string; items: { text: string; done: boolean }[] }[],
    mode: "merge" | "replace"
  ): Promise<void> {
    if (mode === "replace") {
      for (const l of [...this.lists]) {
        this.cancelPendingWrite(l.id);
        await this.deleteListFile(l.id);
      }
      this.lists = [];
    }

    for (const src of imported) {
      const stem = this.uniqueOrExistingStem(src.id, src.name, mode);
      let target = this.lists.find((l) => l.id === stem);

      if (!target) {
        target = { id: stem, name: src.name || stem, items: [] };
        this.lists.push(target);
      }

      if (mode === "merge") {
        const existingText = new Set(target.items.map((i) => i.text));
        for (const item of src.items) {
          if (!existingText.has(item.text)) {
            target.items.push({ id: newItemId(), text: item.text, done: item.done });
            existingText.add(item.text);
          }
        }
      } else {
        target.items = src.items.map((i) => ({
          id: newItemId(),
          text: i.text,
          done: i.done,
        }));
      }
    }

    if (this.lists.length === 0) {
      await this.createList("Inbox", { silent: true });
    }
    if (!this.activeId || !this.lists.some((l) => l.id === this.activeId)) {
      this.activeId = this.lists[0]?.id ?? null;
    }

    this.persistOrder();
    this.persistActive();
    for (const l of this.lists) {
      await this.writeList(l);
    }
    this.emitChange();
  }

  toast(text: string): void {
    this._onToast.fire(text);
  }

  // ---- Internals -----------------------------------------------------------

  private changed(list: TodoList): void {
    this.scheduleWrite(list);
    this.emitChange();
  }

  private emitChange(): void {
    this._onDidChange.fire();
  }

  private uniqueStem(base: string): string {
    let stem = base;
    let n = 2;
    while (this.lists.some((l) => l.id === stem)) {
      stem = `${base}-${n}`;
      n += 1;
    }
    return stem;
  }

  private uniqueOrExistingStem(
    rawId: string,
    name: string,
    mode: "merge" | "replace"
  ): string {
    const base = safeFileStem(rawId || name);
    if (mode === "merge" && this.lists.some((l) => l.id === base)) {
      return base; // merge into the existing list
    }
    if (mode === "replace") {
      return base; // lists were already wiped
    }
    return this.lists.some((l) => l.id === base) ? this.uniqueStem(base) : base;
  }

  // ---- Persistence (globalState) ------------------------------------------

  private persistOrder(): void {
    void this.context.globalState.update(
      KEY_ORDER,
      this.lists.map((l) => l.id)
    );
  }

  private persistActive(): void {
    void this.context.globalState.update(KEY_ACTIVE, this.activeId);
  }

  // ---- Persistence (disk) --------------------------------------------------

  private filePath(id: string): string {
    return path.join(this.listsDir, `${id}.md`);
  }

  private scheduleWrite(list: TodoList): void {
    const existing = this.saveTimers.get(list.id);
    if (existing) {
      clearTimeout(existing);
    }
    this._onSaveStatus.fire("saving");
    const timer = setTimeout(() => {
      this.saveTimers.delete(list.id);
      void this.writeList(list);
    }, SAVE_DEBOUNCE_MS);
    this.saveTimers.set(list.id, timer);
  }

  private cancelPendingWrite(id: string): void {
    const t = this.saveTimers.get(id);
    if (t) {
      clearTimeout(t);
      this.saveTimers.delete(id);
    }
  }

  private async writeList(list: TodoList): Promise<void> {
    const target = this.filePath(list.id);
    const tmp = `${target}.tmp`;
    const content = serialize({ name: list.name, items: list.items });

    this.suppress(target);
    this.pendingWrites += 1;
    this._onSaveStatus.fire("saving");
    try {
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, target);
      this.suppress(target);
    } catch (err) {
      this._onSaveStatus.fire("error");
      void vscode.window.showErrorMessage(
        `Pip Todos could not save "${list.name}". ${String(err)}`
      );
      try {
        await fs.rm(tmp, { force: true });
      } catch {
        /* ignore cleanup failure */
      }
      return;
    } finally {
      this.pendingWrites -= 1;
    }

    if (this.pendingWrites === 0 && this.saveTimers.size === 0) {
      this._onSaveStatus.fire("saved");
    }
  }

  private async deleteListFile(id: string): Promise<void> {
    const target = this.filePath(id);
    this.suppress(target);
    try {
      await fs.rm(target, { force: true });
    } catch {
      /* ignore */
    }
  }

  /** Re-attempt writing every list after a save error. */
  retrySave(): void {
    for (const list of this.lists) {
      void this.writeList(list);
    }
  }

  flushAll(): void {
    for (const [id, timer] of this.saveTimers) {
      clearTimeout(timer);
      this.saveTimers.delete(id);
      const list = this.lists.find((l) => l.id === id);
      if (list) {
        void this.writeList(list);
      }
    }
  }

  // ---- Disk loading & watching --------------------------------------------

  private async loadFromDisk(): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.listsDir);
    } catch {
      names = [];
    }

    const loaded: TodoList[] = [];
    for (const file of names) {
      if (!file.endsWith(".md")) {
        continue;
      }
      const id = file.slice(0, -3);
      try {
        const content = await fs.readFile(path.join(this.listsDir, file), "utf8");
        const parsed = parse(content);
        loaded.push({
          id,
          name: parsed.name || id,
          items: parsed.items.map((i) => ({
            id: newItemId(),
            text: i.text,
            done: i.done,
          })),
        });
      } catch {
        /* skip unreadable file */
      }
    }

    // Apply the saved order; unknown ids go to the end alphabetically.
    const order = this.context.globalState.get<string[]>(KEY_ORDER, []);
    loaded.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      if (ia === -1 && ib === -1) {
        return a.id.localeCompare(b.id);
      }
      if (ia === -1) {
        return 1;
      }
      if (ib === -1) {
        return -1;
      }
      return ia - ib;
    });

    this.lists = loaded;
  }

  private suppress(fsPath: string): void {
    this.suppressUntil.set(fsPath, Date.now() + WATCH_SUPPRESS_MS);
  }

  private isSuppressed(fsPath: string): boolean {
    const until = this.suppressUntil.get(fsPath);
    return until !== undefined && Date.now() < until;
  }

  private startWatching(): void {
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(this.listsDir),
      "*.md"
    );
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onFsEvent = (uri: vscode.Uri) => this.handleExternalChange(uri);
    this.watcher.onDidChange(onFsEvent);
    this.watcher.onDidCreate(onFsEvent);
    this.watcher.onDidDelete(onFsEvent);
  }

  private reloadTimer: NodeJS.Timeout | undefined;
  private handleExternalChange(uri: vscode.Uri): void {
    if (this.isSuppressed(uri.fsPath)) {
      return;
    }
    // Coalesce a burst of file events into one reload.
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(async () => {
      this.reloadTimer = undefined;
      const prevActive = this.activeId;
      await this.loadFromDisk();
      if (this.lists.length === 0) {
        await this.createList("Inbox", { silent: true });
      }
      this.activeId =
        prevActive && this.lists.some((l) => l.id === prevActive)
          ? prevActive
          : this.lists[0]?.id ?? null;
      this.emitChange();
    }, 150);
  }
}
