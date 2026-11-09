import test from "node:test";
import assert from "node:assert/strict";
import {
  BackupError,
  buildBackup,
  parseBackup,
  serializeBackup,
} from "../src/backup";
import type { TodoList } from "../src/types";

const sample: TodoList[] = [
  {
    id: "bego",
    name: "bego",
    items: [
      { id: "a", text: "Rename API env vars", done: false },
      { id: "b", text: "Remove console.logs", done: true },
    ],
  },
];

test("buildBackup drops in-memory ids from items", () => {
  const backup = buildBackup(sample, new Date("2026-11-09T10:00:00Z"));
  assert.equal(backup.app, "pip-todos");
  assert.equal(backup.version, 1);
  assert.equal(backup.exportedAt, "2026-11-09T10:00:00.000Z");
  assert.deepEqual(backup.lists[0].items, [
    { text: "Rename API env vars", done: false },
    { text: "Remove console.logs", done: true },
  ]);
});

test("serialize then parse round-trips the lists", () => {
  const raw = serializeBackup(sample);
  const parsed = parseBackup(raw);
  assert.equal(parsed.lists.length, 1);
  assert.equal(parsed.lists[0].name, "bego");
  assert.equal(parsed.lists[0].items[0].text, "Rename API env vars");
});

test("parseBackup rejects non-JSON", () => {
  assert.throws(() => parseBackup("not json {"), BackupError);
});

test("parseBackup rejects a file from another app", () => {
  const raw = JSON.stringify({ app: "something-else", version: 1, lists: [] });
  assert.throws(() => parseBackup(raw), BackupError);
});

test("parseBackup rejects a missing lists array", () => {
  const raw = JSON.stringify({ app: "pip-todos", version: 1 });
  assert.throws(() => parseBackup(raw), BackupError);
});

test("parseBackup rejects a malformed item", () => {
  const raw = JSON.stringify({
    app: "pip-todos",
    version: 1,
    lists: [{ id: "x", name: "x", items: [{ done: true }] }],
  });
  assert.throws(() => parseBackup(raw), BackupError);
});

test("parseBackup coerces a missing done flag to false", () => {
  const raw = JSON.stringify({
    app: "pip-todos",
    version: 1,
    lists: [{ id: "x", name: "x", items: [{ text: "hi" }] }],
  });
  const parsed = parseBackup(raw);
  assert.equal(parsed.lists[0].items[0].done, false);
});

test("parseBackup falls back to id when name is missing", () => {
  const raw = JSON.stringify({
    app: "pip-todos",
    version: 1,
    lists: [{ id: "notes", items: [] }],
  });
  const parsed = parseBackup(raw);
  assert.equal(parsed.lists[0].name, "notes");
});
