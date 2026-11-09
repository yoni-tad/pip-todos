// Export / import of every list as a single JSON backup file.
// All functions here are pure (no vscode, no fs) so they are easy to unit test.

import type { TodoList } from "./types";

export const BACKUP_APP = "pip-todos";
export const BACKUP_VERSION = 1;

export interface BackupItem {
  text: string;
  done: boolean;
}

export interface BackupList {
  id: string;
  name: string;
  items: BackupItem[];
}

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  lists: BackupList[];
}

/** Build the backup object for the given lists. */
export function buildBackup(lists: TodoList[], now: Date = new Date()): BackupFile {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      items: l.items.map((i) => ({ text: i.text, done: i.done })),
    })),
  };
}

export function serializeBackup(lists: TodoList[], now?: Date): string {
  return JSON.stringify(buildBackup(lists, now), null, 2);
}

export class BackupError extends Error {}

/**
 * Parse and validate a backup file. Throws BackupError with a readable message
 * if anything is wrong, so the caller can show it and change nothing.
 */
export function parseBackup(raw: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new BackupError("This file is not valid JSON.");
  }

  if (!isObject(data)) {
    throw new BackupError("This file is not a Pip Todos backup.");
  }

  if (data.app !== BACKUP_APP) {
    throw new BackupError("This file is not a Pip Todos backup.");
  }

  if (typeof data.version !== "number") {
    throw new BackupError("This backup is missing a version number.");
  }

  if (!Array.isArray(data.lists)) {
    throw new BackupError("This backup has no lists.");
  }

  const lists: BackupList[] = [];
  for (const rawList of data.lists) {
    if (!isObject(rawList)) {
      throw new BackupError("A list in this backup is malformed.");
    }
    const id = typeof rawList.id === "string" ? rawList.id : "";
    const name = typeof rawList.name === "string" ? rawList.name : id;
    if (!id && !name) {
      throw new BackupError("A list in this backup has no name.");
    }
    if (!Array.isArray(rawList.items)) {
      throw new BackupError(`List "${name || id}" has no items array.`);
    }
    const items: BackupItem[] = [];
    for (const rawItem of rawList.items) {
      if (!isObject(rawItem) || typeof rawItem.text !== "string") {
        throw new BackupError(`An item in "${name || id}" is malformed.`);
      }
      items.push({ text: rawItem.text, done: Boolean(rawItem.done) });
    }
    lists.push({ id: id || name, name: name || id, items });
  }

  return {
    app: BACKUP_APP,
    version: data.version,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    lists,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
