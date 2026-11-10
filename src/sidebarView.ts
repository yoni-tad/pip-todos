// The sidebar webview. Renders nothing itself beyond a shell; webview/main.ts
// builds the UI from the state the host pushes. The host stays the single source
// of truth and only ever receives actions back.

import * as vscode from "vscode";
import type { Store } from "./store";
import type { SaveStatus } from "./types";

type Incoming =
  | { type: "ready" }
  | { type: "addTodo"; text: string }
  | { type: "toggleTodo"; id: string }
  | { type: "editTodo"; id: string; text: string }
  | { type: "deleteTodo"; id: string }
  | { type: "createList"; name: string }
  | { type: "switchList"; id: string }
  | { type: "renameList"; id: string }
  | { type: "deleteList"; id: string }
  | { type: "clearDone" }
  | { type: "toggleDoneSection" }
  | { type: "retrySave" }
  | { type: "export" }
  | { type: "import" };

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "pipTodos.sidebar";

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly actions: {
      exportLists: () => Promise<void>;
      importLists: () => Promise<void>;
    }
  ) {
    this.disposables.push(
      this.store.onDidChange(() => this.pushState()),
      this.store.onSaveStatus((s) => this.postSaveStatus(s)),
      this.store.onToast((text) => this.post({ type: "toast", text }))
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "out"),
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg: Incoming) => this.handleMessage(msg),
      undefined,
      this.disposables
    );

    // Flush pending writes when the view is hidden.
    webviewView.onDidChangeVisibility(
      () => {
        if (!webviewView.visible) {
          this.store.flushAll();
        } else {
          this.pushState();
        }
      },
      undefined,
      this.disposables
    );
  }

  /** Called by commands so the webview input can be focused after reveal. */
  focusAddBox(): void {
    this.post({ type: "focusAdd" });
  }

  startInlineNewList(): void {
    this.post({ type: "startNewList" });
  }

  private async handleMessage(msg: Incoming): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.pushState();
        break;
      case "addTodo":
        this.store.addTodo(msg.text);
        break;
      case "toggleTodo":
        this.store.toggleTodo(msg.id);
        break;
      case "editTodo":
        this.store.editTodo(msg.id, msg.text);
        break;
      case "deleteTodo":
        this.store.deleteTodo(msg.id);
        break;
      case "createList":
        await this.store.createList(msg.name);
        break;
      case "switchList":
        this.store.switchList(msg.id);
        break;
      case "renameList":
        await this.renameListInteractive(msg.id);
        break;
      case "deleteList":
        await this.deleteListInteractive(msg.id);
        break;
      case "clearDone":
        this.store.clearDone();
        break;
      case "toggleDoneSection":
        this.store.toggleDoneSection();
        break;
      case "retrySave":
        this.store.retrySave();
        break;
      case "export":
        await this.actions.exportLists();
        break;
      case "import":
        await this.actions.importLists();
        break;
    }
  }

  private async renameListInteractive(id: string): Promise<void> {
    const current = this.store.getLists().find((l) => l.id === id);
    if (!current) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: "Rename list",
      value: current.name,
      prompt: "A new name for this list",
      validateInput: (v) => (v.trim() ? null : "Name cannot be empty"),
    });
    if (name && name.trim()) {
      this.store.renameList(id, name);
    }
  }

  private async deleteListInteractive(id: string): Promise<void> {
    const current = this.store.getLists().find((l) => l.id === id);
    if (!current) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Delete the list "${current.name}"? This cannot be undone.`,
      { modal: true },
      "Delete"
    );
    if (choice === "Delete") {
      await this.store.deleteList(id);
      this.store.toast(`Deleted "${current.name}"`);
    }
  }

  private pushState(): void {
    this.post({ type: "state", state: this.store.getState() });
  }

  private postSaveStatus(status: SaveStatus): void {
    this.post({ type: "saveStatus", status });
  }

  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "style.css")
    );
    const pipUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "pip.svg")
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Pip Todos</title>
</head>
<body>
  <div id="app" data-pip-icon="${pipUri}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
