// Runs inside the sidebar webview. Builds the whole UI from the state the host
// pushes, and sends actions back. It never trusts itself as the source of truth:
// after any action it waits for a fresh "state" message and re-renders.
//
// Security: todo text is only ever written with textContent, never innerHTML, so
// it cannot inject markup. The host also sets a strict CSP.

interface Item {
  id: string;
  text: string;
  done: boolean;
}
interface ListView {
  id: string;
  name: string;
  fileName: string;
  openCount: number;
  items: Item[];
}
interface State {
  lists: ListView[];
  activeId: string | null;
  showDone: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById("app") as HTMLDivElement;
const pipIconUri = app.dataset.pipIcon || "";

let state: State = { lists: [], activeId: null, showDone: true };
let saveStatus: "saving" | "saved" | "error" = "saved";
let menuOpen = false;
let addingList = false;
let editingId: string | null = null;
let toastTimer: number | undefined;

const SVG_NS = "http://www.w3.org/2000/svg";

function send(msg: unknown): void {
  vscode.postMessage(msg);
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "state":
      state = msg.state;
      render();
      break;
    case "saveStatus":
      saveStatus = msg.status;
      renderFooterStatus();
      break;
    case "toast":
      showToast(msg.text);
      break;
    case "focusAdd":
      focusAddBox();
      break;
    case "startNewList":
      addingList = true;
      render();
      break;
  }
});

// ---- Helpers ---------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** Build an inline SVG from fixed, trusted path data (no user text). */
function icon(paths: string[], opts: { fill?: boolean; size?: number; viewBox?: string } = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const size = opts.size ?? 16;
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", opts.viewBox ?? "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    if (opts.fill) {
      p.setAttribute("fill", "currentColor");
    } else {
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "2");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
    }
    svg.appendChild(p);
  }
  return svg;
}

const ICONS = {
  plus: ["M12 5v14", "M5 12h14"],
  menu: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  chevron: ["M9 6l6 6-6 6"],
  file: ["M14 3v5h5", "M7 3h8l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"],
};

function iconButton(
  paths: string[],
  label: string,
  onClick: (e: MouseEvent) => void,
  extraClass = ""
): HTMLButtonElement {
  const b = el("button", `icon-btn ${extraClass}`.trim());
  b.setAttribute("aria-label", label);
  b.title = label;
  b.appendChild(icon(paths));
  b.addEventListener("click", onClick);
  return b;
}

function activeList(): ListView | undefined {
  return state.lists.find((l) => l.id === state.activeId);
}

// ---- Render ----------------------------------------------------------------

function render(): void {
  app.textContent = "";
  app.appendChild(renderHeader());
  app.appendChild(renderChips());

  const list = activeList();
  const body = el("div", "body");
  if (list) {
    body.appendChild(renderTitle(list));
    body.appendChild(renderAddBox());
    body.appendChild(renderTodo(list));
    body.appendChild(renderDone(list));
  }
  app.appendChild(body);
  app.appendChild(renderFooter());

  if (menuOpen) {
    app.appendChild(renderMenu());
  }
}

function renderHeader(): HTMLElement {
  const header = el("header", "header");

  const brand = el("div", "brand");
  if (pipIconUri) {
    const img = el("img", "brand-icon");
    img.src = pipIconUri;
    img.alt = "";
    img.width = 18;
    img.height = 18;
    brand.appendChild(img);
  }
  brand.appendChild(el("span", "brand-text", "PIP TODOS"));
  header.appendChild(brand);

  const actions = el("div", "header-actions");
  actions.appendChild(
    iconButton(ICONS.plus, "New list", () => {
      menuOpen = false;
      addingList = true;
      render();
      focusNewListInput();
    })
  );
  actions.appendChild(
    iconButton(ICONS.menu, "Menu", (e) => {
      e.stopPropagation();
      menuOpen = !menuOpen;
      render();
    })
  );
  header.appendChild(actions);
  return header;
}

function renderChips(): HTMLElement {
  const row = el("div", "chips");
  for (const l of state.lists) {
    const chip = el("button", "chip" + (l.id === state.activeId ? " active" : ""));
    chip.appendChild(el("span", "chip-name", l.name));
    chip.appendChild(el("span", "chip-count", String(l.openCount)));
    chip.addEventListener("click", () => send({ type: "switchList", id: l.id }));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      send({ type: "switchList", id: l.id });
      menuOpen = true;
      render();
    });
    row.appendChild(chip);
  }

  if (addingList) {
    const input = el("input", "chip-input");
    input.type = "text";
    input.placeholder = "List name";
    input.setAttribute("aria-label", "New list name");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const name = input.value.trim();
        addingList = false;
        if (name) {
          send({ type: "createList", name });
        } else {
          render();
        }
      } else if (e.key === "Escape") {
        addingList = false;
        render();
      }
    });
    input.addEventListener("blur", () => {
      addingList = false;
      render();
    });
    row.appendChild(input);
  } else {
    const add = el("button", "chip chip-add");
    add.appendChild(icon(ICONS.plus, { size: 13 }));
    add.appendChild(el("span", undefined, "New list"));
    add.addEventListener("click", () => {
      addingList = true;
      render();
      focusNewListInput();
    });
    row.appendChild(add);
  }
  return row;
}

function renderTitle(list: ListView): HTMLElement {
  const total = list.items.length;
  const done = list.items.filter((i) => i.done).length;

  const block = el("div", "title-block");

  const top = el("div", "title-top");
  top.appendChild(el("h1", "title-name", list.name));
  top.appendChild(el("span", "title-count", `${done} of ${total} done`));
  block.appendChild(top);

  const bar = el("div", "progress");
  const fill = el("div", "progress-fill");
  fill.style.width = total === 0 ? "0%" : `${Math.round((done / total) * 100)}%`;
  bar.appendChild(fill);
  block.appendChild(bar);

  const file = el("div", "file-name");
  file.appendChild(icon(ICONS.file, { size: 12 }));
  file.appendChild(el("span", undefined, list.fileName));
  block.appendChild(file);

  return block;
}

function renderAddBox(): HTMLElement {
  const box = el("div", "addbox");
  box.appendChild(icon(ICONS.plus, { size: 16 }));

  const input = el("input", "add-input");
  input.id = "pip-add-input";
  input.type = "text";
  input.placeholder = "Add a todo… press Enter";
  input.setAttribute("aria-label", "Add a todo");
  const submit = () => {
    const text = input.value.trim();
    if (text) {
      send({ type: "addTodo", text });
      input.value = "";
      input.focus();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      submit();
    }
  });
  box.appendChild(input);

  const btn = el("button", "add-btn", "Add");
  btn.addEventListener("click", submit);
  box.appendChild(btn);
  return box;
}

function renderTodo(list: ListView): HTMLElement {
  const open = list.items.filter((i) => !i.done);
  const section = el("section", "section");

  const label = el("div", "section-label");
  label.appendChild(el("span", undefined, "TO DO"));
  label.appendChild(el("span", "dot-sep", "·"));
  label.appendChild(el("span", undefined, String(open.length)));
  section.appendChild(label);

  if (open.length === 0) {
    section.appendChild(
      el("div", "empty", "All clear. Add the next thing you notice above.")
    );
  } else {
    const ul = el("ul", "todo-list");
    for (const item of open) {
      ul.appendChild(renderRow(item, false));
    }
    section.appendChild(ul);
  }
  return section;
}

function renderDone(list: ListView): HTMLElement | DocumentFragment {
  const done = list.items.filter((i) => i.done);
  if (done.length === 0) {
    return document.createDocumentFragment();
  }

  const section = el("section", "section done-section");
  const label = el("button", "section-label done-toggle");
  label.setAttribute("aria-expanded", String(state.showDone));
  const chev = icon(ICONS.chevron, { size: 14 });
  chev.classList.add("chevron");
  if (state.showDone) {
    chev.classList.add("open");
  }
  label.appendChild(chev);
  label.appendChild(el("span", undefined, "DONE"));
  label.appendChild(el("span", "dot-sep", "·"));
  label.appendChild(el("span", undefined, String(done.length)));
  label.addEventListener("click", () => send({ type: "toggleDoneSection" }));
  section.appendChild(label);

  if (state.showDone) {
    const ul = el("ul", "todo-list");
    for (const item of done) {
      ul.appendChild(renderRow(item, true));
    }
    section.appendChild(ul);
  }
  return section;
}

function renderRow(item: Item, done: boolean): HTMLLIElement {
  const li = el("li", "row" + (done ? " done" : ""));
  li.tabIndex = 0;

  const cb = el("input", "row-check") as HTMLInputElement;
  cb.type = "checkbox";
  cb.checked = done;
  cb.setAttribute("aria-label", item.text);
  cb.addEventListener("change", () => send({ type: "toggleTodo", id: item.id }));
  li.appendChild(cb);

  if (editingId === item.id) {
    const input = el("input", "row-edit") as HTMLInputElement;
    input.type = "text";
    input.value = item.text;
    input.setAttribute("aria-label", "Edit todo");
    const commit = (save: boolean) => {
      const wasEditing = editingId === item.id;
      editingId = null;
      if (save) {
        send({ type: "editTodo", id: item.id, text: input.value });
      } else if (wasEditing) {
        render();
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        commit(true);
      } else if (e.key === "Escape") {
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
    li.appendChild(input);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  } else {
    const text = el("span", "row-text", item.text);
    text.addEventListener("click", () => send({ type: "toggleTodo", id: item.id }));
    text.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      editingId = item.id;
      render();
    });
    li.appendChild(text);

    const del = iconButton(ICONS.close, "Delete todo", (e) => {
      e.stopPropagation();
      send({ type: "deleteTodo", id: item.id });
    }, "row-delete");
    li.appendChild(del);
  }

  li.addEventListener("keydown", (e) => {
    if (editingId) {
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      send({ type: "deleteTodo", id: item.id });
    } else if (e.key === " " || e.key === "Enter") {
      if (e.target === li) {
        e.preventDefault();
        send({ type: "toggleTodo", id: item.id });
      }
    }
  });

  return li;
}

function renderFooter(): HTMLElement {
  const footer = el("footer", "footer");

  const status = el("div", "save-status");
  status.id = "pip-save-status";
  footer.appendChild(status);

  const actions = el("div", "footer-actions");
  const exportBtn = el("button", "ghost-btn", "Export");
  exportBtn.addEventListener("click", () => send({ type: "export" }));
  const importBtn = el("button", "ghost-btn", "Import");
  importBtn.addEventListener("click", () => send({ type: "import" }));
  actions.appendChild(exportBtn);
  actions.appendChild(importBtn);
  footer.appendChild(actions);

  // Fill status after it is in the DOM.
  setTimeout(renderFooterStatus, 0);
  return footer;
}

function renderFooterStatus(): void {
  const host = document.getElementById("pip-save-status");
  if (!host) {
    return;
  }
  host.textContent = "";
  host.className = "save-status " + saveStatus;

  if (saveStatus === "error") {
    const dot = el("span", "save-dot");
    host.appendChild(dot);
    host.appendChild(el("span", "save-text", "Couldn't save"));
    const retry = el("button", "retry-btn", "retry");
    retry.addEventListener("click", () => send({ type: "retrySave" }));
    host.appendChild(retry);
    return;
  }

  const dot = el("span", "save-dot");
  host.appendChild(dot);
  host.appendChild(
    el("span", "save-text", saveStatus === "saving" ? "Saving…" : "Saved locally")
  );
}

function renderMenu(): HTMLElement {
  const menu = el("div", "menu");
  const add = (label: string, action: () => void, danger = false) => {
    const item = el("button", "menu-item" + (danger ? " danger" : ""), label);
    item.addEventListener("click", () => {
      menuOpen = false;
      render();
      action();
    });
    menu.appendChild(item);
  };
  const divider = () => menu.appendChild(el("div", "menu-divider"));

  add("Export all lists", () => send({ type: "export" }));
  add("Import lists…", () => send({ type: "import" }));
  divider();
  add("Rename list", () => state.activeId && send({ type: "renameList", id: state.activeId }));
  add("Delete list", () => state.activeId && send({ type: "deleteList", id: state.activeId }), true);
  add("Clear done in this list", () => send({ type: "clearDone" }));

  return menu;
}

// ---- Toast -----------------------------------------------------------------

function showToast(text: string): void {
  let toast = document.getElementById("pip-toast");
  if (toast) {
    toast.remove();
  }
  toast = el("div", "toast", text);
  toast.id = "pip-toast";
  app.appendChild(toast);
  requestAnimationFrame(() => toast?.classList.add("show"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast?.classList.remove("show");
    window.setTimeout(() => toast?.remove(), 200);
  }, 2000);
}

// ---- Focus helpers ---------------------------------------------------------

function focusAddBox(): void {
  const input = document.getElementById("pip-add-input") as HTMLInputElement | null;
  input?.focus();
}

function focusNewListInput(): void {
  setTimeout(() => {
    const input = document.querySelector(".chip-input") as HTMLInputElement | null;
    input?.focus();
  }, 0);
}

// Close the menu when clicking elsewhere.
document.addEventListener("click", () => {
  if (menuOpen) {
    menuOpen = false;
    render();
  }
});

send({ type: "ready" });
