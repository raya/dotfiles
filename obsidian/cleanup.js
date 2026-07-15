/**
 * cleanup.js — move completed Obsidian todos to the bottom of their list.
 *
 * Within every group of sibling checkbox items, incomplete todos are kept
 * (in their original order) and completed todos (`[x]`/`[X]`) are moved below
 * them. This is applied recursively to nested sub-lists, so a parent item
 * carries its children with it and its children get reordered too. Indentation
 * is never changed, and any non-todo content (headings, blank lines, prose)
 * acts as a boundary between groups and is left untouched.
 *
 * Run it via the CodeScript Toolkit plugin against the active note:
 * its `invoke(app)` export reorders the currently open markdown file in place.
 */

import { Notice } from "obsidian";

// `\[(.?)\]` captures the marker char: 'x'/'X' = done, ' '/''/anything else = not done.
const ITEM_RE = /^(\s*)([-*+])\s+\[(.?)\]\s*(.*)$/;

function indentWidth(line) {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

function isItem(line) {
  return ITEM_RE.test(line);
}

function isCompleted(line) {
  const m = line.match(ITEM_RE);
  return m ? m[3].toLowerCase() === "x" : false;
}

/** Build a tree from a contiguous block of list lines using indentation. */
function buildTree(groupLines) {
  const roots = [];
  const stack = [];

  for (const raw of groupLines) {
    if (isItem(raw)) {
      const item = {
        raw,
        indent: indentWidth(raw),
        completed: isCompleted(raw),
        children: [],
        extra: [],
      };
      // Pop until we find a strictly-shallower parent.
      while (stack.length && stack[stack.length - 1].indent >= item.indent) {
        stack.pop();
      }
      if (stack.length) stack[stack.length - 1].children.push(item);
      else roots.push(item);
      stack.push(item);
    } else {
      // A continuation line (wrapped text under the current item).
      if (stack.length) stack[stack.length - 1].extra.push(raw);
      else roots.push({ raw, indent: 0, completed: false, children: [], extra: [] });
    }
  }
  return roots;
}

/** Stable partition: incomplete first, completed last — recursively. */
function reorder(items) {
  for (const it of items) it.children = reorder(it.children);
  const incomplete = items.filter((it) => !it.completed);
  const completed = items.filter((it) => it.completed);
  return [...incomplete, ...completed];
}

function emit(item, out) {
  out.push(item.raw);
  out.push(...item.extra);
  for (const child of item.children) emit(child, out);
}

export function cleanup(text) {
  const lines = text.split("\n");
  const out = [];

  let group = [];
  let groupBase = 0; // indent of the group's first item

  const flush = () => {
    if (group.length === 0) return;
    for (const root of reorder(buildTree(group))) emit(root, out);
    group = [];
  };

  for (const raw of lines) {
    if (isItem(raw)) {
      if (group.length === 0) groupBase = indentWidth(raw);
      group.push(raw);
      continue;
    }

    // Non-item line: keep it in the group only if it's indented content
    // nested under the current list (not a blank line or a dedented sibling).
    if (group.length > 0 && raw.trim() !== "" && indentWidth(raw) > groupBase) {
      group.push(raw);
      continue;
    }

    flush();
    out.push(raw);
  }
  flush();

  return out.join("\n");
}

/** CodeScript Toolkit entry point — reorders the active note in place. */
export async function invoke(app) {
  const file = app.workspace.getActiveFile();
  if (!file) {
    new Notice("Cleanup: no active file.");
    return;
  }
  if (file.extension !== "md") {
    new Notice("Cleanup: active file is not a markdown note.");
    return;
  }

  let changed = false;
  await app.vault.process(file, (data) => {
    const result = cleanup(data);
    changed = result !== data;
    return result;
  });

  new Notice(changed ? `Cleaned up ${file.basename}` : "Cleanup: nothing to reorder.");
}
