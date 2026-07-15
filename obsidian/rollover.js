/**
 * rollover.js — move unfinished todos from a daily note to the next day's note.
 *
 * Within every heading whose text contains "todo" (e.g. `## Todo`,
 * `### Personal todo`, `### Work todo`), each top-level item is moved to the
 * next day EXCEPT items that are already completed (`[x]`/`[X]`), which stay put.
 * When an item moves it carries its whole subtree — nested children and any
 * wrapped continuation lines — verbatim, so everything stays nested exactly
 * where it originally was. Sections whose heading does NOT contain "todo"
 * (e.g. `## Log`, `## Notes`) are never touched.
 *
 * In the next day's note the moved items are appended UNDER THE SAME HEADING,
 * after whatever is already there — existing content is never overwritten. If
 * the next day's note doesn't exist yet it is created from the daily-note
 * template first.
 *
 * Run it via the CodeScript Toolkit plugin against the active daily note
 * (named `YYYY-MM-DD`): its `invoke(app)` export moves the todos forward and
 * removes them from the current note.
 */

import { Notice } from "obsidian";

// `\[(.?)\]` captures the marker char: 'x'/'X' = done, ' '/''/anything else = not done.
const ITEM_RE = /^(\s*)([-*+])\s+\[(.?)\]\s*(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function indentWidth(line) {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

function isCompleted(line) {
  const m = line.match(ITEM_RE);
  return m ? m[3].toLowerCase() === "x" : false;
}

function trimBlanks(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * Split one heading's body into the lines that stay and the lines that move.
 * A "top-level" item is one at the section's shallowest indent; it and its
 * deeper subtree move together unless it's a completed checkbox (then it stays).
 * Blank lines stay in the source as separators.
 */
function splitSection(bodyLines) {
  let base = Infinity;
  for (const l of bodyLines) {
    if (l.trim() !== "") base = Math.min(base, indentWidth(l));
  }
  if (!isFinite(base)) base = 0;

  const stay = [];
  const move = [];
  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    if (line.trim() === "") {
      stay.push(line);
      i++;
      continue;
    }
    if (indentWidth(line) > base) {
      // A deeper line with no top-level root above it — leave it alone.
      stay.push(line);
      i++;
      continue;
    }
    // Top-level root: gather it plus its deeper subtree (blanks end the subtree).
    const subtree = [line];
    let j = i + 1;
    while (
      j < bodyLines.length &&
      bodyLines[j].trim() !== "" &&
      indentWidth(bodyLines[j]) > base
    ) {
      subtree.push(bodyLines[j]);
      j++;
    }
    if (isCompleted(line)) stay.push(...subtree);
    else move.push(...subtree);
    i = j;
  }
  return { stay, move };
}

/**
 * Transform the current note: strip movable todos out of every "todo" heading.
 * Returns the rewritten source text and the list of moves to apply elsewhere.
 */
export function rollover(text) {
  const lines = text.split("\n");

  // Segment the note into blocks, each introduced by a heading (the first
  // block — the title/frontmatter area — has a null heading).
  const blocks = [];
  let cur = { heading: null, level: 0, body: [] };
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      blocks.push(cur);
      cur = { heading: line, level: m[1].length, body: [] };
    } else {
      cur.body.push(line);
    }
  }
  blocks.push(cur);

  const moves = [];
  for (const b of blocks) {
    if (b.heading && /todo/i.test(b.heading)) {
      const { stay, move } = splitSection(b.body);
      const trimmed = trimBlanks(move);
      if (trimmed.length) moves.push({ heading: b.heading, level: b.level, lines: trimmed });
      b.body = stay;
    }
  }

  const out = [];
  for (const b of blocks) {
    if (b.heading !== null) out.push(b.heading);
    out.push(...b.body);
  }
  return { source: out.join("\n"), moves };
}

/**
 * Merge moved lines into the destination note under the matching heading,
 * appending after existing content. Headings missing in the destination are
 * created at the end. Existing content is never overwritten.
 */
export function mergeIntoDest(destText, moves) {
  const lines = destText.split("\n");
  for (const mv of moves) {
    const idx = lines.findIndex((l) => l === mv.heading);
    if (idx === -1) {
      if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
      lines.push(mv.heading, ...mv.lines);
      continue;
    }
    // Section runs until the next heading of the same or higher level.
    let end = lines.length;
    for (let k = idx + 1; k < lines.length; k++) {
      const m = lines[k].match(HEADING_RE);
      if (m && m[1].length <= mv.level) {
        end = k;
        break;
      }
    }
    // Insert after the section's existing content, before its trailing blanks.
    let insertAt = end;
    while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
    lines.splice(insertAt, 0, ...mv.lines);
  }
  return lines.join("\n");
}

function countItems(moves) {
  let n = 0;
  for (const mv of moves) for (const l of mv.lines) if (ITEM_RE.test(l)) n++;
  return n;
}

function getDailyTemplatePath(app) {
  try {
    const opts = app.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
    let t = opts?.template?.trim();
    if (t) return t.endsWith(".md") ? t : `${t}.md`;
  } catch (_) {
    /* fall through to default */
  }
  return "metadata/templates/dailynote.md";
}

function fillTemplate(tpl, m) {
  return tpl
    .replace(/\{\{date:([^}]*)\}\}/g, (_, f) => m.format(f))
    .replace(/\{\{time:([^}]*)\}\}/g, (_, f) => m.format(f))
    .replace(/\{\{date\}\}/g, m.format("YYYY-MM-DD"))
    .replace(/\{\{time\}\}/g, m.format("HH:mm"))
    .replace(/\{\{title\}\}/g, m.format("YYYY-MM-DD"));
}

async function buildNewDailyNote(app, m) {
  const tf = app.vault.getAbstractFileByPath(getDailyTemplatePath(app));
  const tpl = tf
    ? await app.vault.read(tf)
    : "# {{date:ddd, MMM Do}}\n#tracking/daily\n\n## Todo\n### Personal todo\n\n### Work todo\n\n## Log\n\n\n## Notes\n\n### Work notes\n";
  return fillTemplate(tpl, m);
}

/** CodeScript Toolkit entry point — rolls today's unfinished todos forward. */
export async function invoke(app) {
  const file = app.workspace.getActiveFile();
  if (!file) {
    new Notice("Rollover: no active file.");
    return;
  }
  if (file.extension !== "md" || !/^\d{4}-\d{2}-\d{2}$/.test(file.basename)) {
    new Notice("Rollover: active file is not a daily note (YYYY-MM-DD).");
    return;
  }

  // Compute the next day's note path (same folder as the current note).
  const moment = window.moment;
  const next = moment(file.basename, "YYYY-MM-DD").add(1, "day");
  const nextName = next.format("YYYY-MM-DD");
  const folder = file.parent && file.parent.path ? file.parent.path : "";
  const nextPath = folder ? `${folder}/${nextName}.md` : `${nextName}.md`;

  // Work out what moves without mutating anything yet.
  const { source, moves } = rollover(await app.vault.read(file));
  if (!moves.length) {
    new Notice("Rollover: no unfinished todos to move.");
    return;
  }

  // Append into the next day's note (creating it from template if needed).
  let dest = app.vault.getAbstractFileByPath(nextPath);
  if (!dest) dest = await app.vault.create(nextPath, await buildNewDailyNote(app, next));
  await app.vault.process(dest, (data) => mergeIntoDest(data, moves));

  // Only now remove the moved todos from the current note.
  await app.vault.process(file, () => source);

  new Notice(`Rolled over ${countItems(moves)} todo(s) to ${nextName}.`);
}
