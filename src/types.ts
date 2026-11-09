// Shared data shapes used by the extension host and (a subset) the webview.

export interface TodoItem {
  /** In-memory id only. Never written to the .md file. */
  id: string;
  text: string;
  done: boolean;
}

export interface TodoList {
  /** Safe file-name stem, also used as the storage key. */
  id: string;
  name: string;
  items: TodoItem[];
}

/** A list parsed from disk, before in-memory ids are assigned. */
export interface ParsedList {
  name: string;
  items: { text: string; done: boolean }[];
}

export type SaveStatus = "saving" | "saved" | "error";

/** Full view state sent to the webview after every change. */
export interface ViewState {
  lists: {
    id: string;
    name: string;
    fileName: string;
    openCount: number;
    items: TodoItem[];
  }[];
  activeId: string | null;
  showDone: boolean;
}
