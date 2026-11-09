// Parse and serialize list files as standard GitHub task-list markdown, so the
// files stay readable and editable outside the extension.
//
// Format:
//   # bego
//
//   - [ ] Rename API env vars
//   - [x] Remove leftover console.logs
//
// Parse rules:
//   - The first "# " line is the display name (caller falls back to the file name).
//   - Lines starting with "- [ ] " or "- [x] " (case-insensitive x) are todos,
//     kept in file order.
//   - Every other line is ignored. Parsing never throws.

import type { ParsedList } from "./types";

const TODO_LINE = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/;
const HEADING_LINE = /^\s*#\s+(.*)$/;

export function parse(content: string): ParsedList {
  const list: ParsedList = { name: "", items: [] };
  if (typeof content !== "string") {
    return list;
  }

  const lines = content.split(/\r?\n/);
  let nameFound = false;

  for (const line of lines) {
    if (!nameFound) {
      const heading = HEADING_LINE.exec(line);
      if (heading) {
        list.name = heading[1].trim();
        nameFound = true;
        continue;
      }
    }

    const todo = TODO_LINE.exec(line);
    if (todo) {
      const done = todo[1].toLowerCase() === "x";
      list.items.push({ text: todo[2].trim(), done });
    }
  }

  return list;
}

export function serialize(list: ParsedList): string {
  const name = (list.name || "").trim();
  const lines: string[] = [`# ${name}`, ""];
  for (const item of list.items) {
    const box = item.done ? "[x]" : "[ ]";
    lines.push(`- ${box} ${item.text}`);
  }
  // Trailing newline so the file is POSIX-friendly.
  return lines.join("\n") + "\n";
}
