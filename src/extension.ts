// Activation: wire up the store, the sidebar view, and the commands.

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { Store } from "./store";
import { SidebarViewProvider } from "./sidebarView";
import { BackupError, parseBackup, serializeBackup } from "./backup";

let store: Store | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  store = new Store(context);
  await store.init();
  const theStore = store;

  const provider = new SidebarViewProvider(context.extensionUri, theStore, {
    exportLists: () => exportLists(theStore),
    importLists: () => importLists(theStore),
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewId,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    provider,
    theStore
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pipTodos.add", () => addTodoQuick(theStore)),
    vscode.commands.registerCommand("pipTodos.newList", () =>
      newListQuick(theStore)
    ),
    vscode.commands.registerCommand("pipTodos.export", () =>
      exportLists(theStore)
    ),
    vscode.commands.registerCommand("pipTodos.import", () =>
      importLists(theStore)
    ),
    vscode.commands.registerCommand("pipTodos.focus", () =>
      vscode.commands.executeCommand("pipTodos.sidebar.focus")
    )
  );
}

export function deactivate(): void {
  store?.flushAll();
}

// ---- Quick capture ---------------------------------------------------------

async function addTodoQuick(store: Store): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.document.getText(editor.selection).trim();
  const text = await vscode.window.showInputBox({
    title: "Add Todo",
    prompt: "What did you notice?",
    value: selection || "",
    placeHolder: "Add a todo...",
  });
  if (text && text.trim()) {
    store.addTodo(text);
    store.toast("Added");
  }
}

async function newListQuick(store: Store): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: "New list",
    prompt: "Name for the new list",
    placeHolder: "ideas",
    validateInput: (v) => (v.trim() ? null : "Name cannot be empty"),
  });
  if (name && name.trim()) {
    await store.createList(name);
    await vscode.commands.executeCommand("pipTodos.sidebar.focus");
  }
}

// ---- Export / import -------------------------------------------------------

function backupFileName(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `pip-todos-backup-${y}-${m}-${d}.json`;
}

async function exportLists(store: Store): Promise<void> {
  const lists = store.getLists();
  const target = await vscode.window.showSaveDialog({
    title: "Export all lists",
    defaultUri: vscode.Uri.file(backupFileName()),
    filters: { JSON: ["json"] },
  });
  if (!target) {
    return;
  }
  try {
    await fs.writeFile(target.fsPath, serializeBackup(lists), "utf8");
    store.toast(`Exported ${lists.length} ${plural(lists.length, "list")}`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Export failed. ${String(err)}`);
  }
}

async function importLists(store: Store): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: "Import lists",
    canSelectMany: false,
    filters: { JSON: ["json"] },
  });
  const uri = picked?.[0];
  if (!uri) {
    return;
  }

  let raw: string;
  try {
    raw = await fs.readFile(uri.fsPath, "utf8");
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not read the file. ${String(err)}`);
    return;
  }

  let backup;
  try {
    backup = parseBackup(raw);
  } catch (err) {
    const message =
      err instanceof BackupError ? err.message : "This file is not a valid backup.";
    void vscode.window.showErrorMessage(`Import cancelled. ${message}`);
    return;
  }

  const mode = await vscode.window.showInformationMessage(
    `Import ${backup.lists.length} ${plural(backup.lists.length, "list")}. How should existing lists be handled?`,
    { modal: true },
    "Merge",
    "Replace all"
  );
  if (mode !== "Merge" && mode !== "Replace all") {
    return;
  }

  await store.importLists(backup.lists, mode === "Merge" ? "merge" : "replace");
  store.toast(`Imported ${backup.lists.length} ${plural(backup.lists.length, "list")}`);
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
