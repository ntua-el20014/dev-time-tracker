/**
 * Pure: edit JSON *text* in place — add an array item or object member,
 * remove some — so everything around the edit keeps its exact bytes
 * (formatting, key order, line endings). Used for files people also edit
 * by hand, where re-serializing would rewrite their formatting.
 *
 * The text must be valid JSON (check with JSON.parse first); the span
 * scanner doesn't validate.
 */

export type JsonNode =
  | { kind: "object"; start: number; end: number; members: JsonMember[] }
  | { kind: "array"; start: number; end: number; items: JsonNode[] }
  | { kind: "scalar"; start: number; end: number };

export interface JsonMember {
  key: string;
  /** Start of the key's opening quote */
  start: number;
  value: JsonNode;
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Spans of every value in (valid) JSON text. */
export function parseSpans(text: string): JsonNode {
  let i = 0;
  const ws = () => {
    while (i < text.length && /[\s\uFEFF]/.test(text[i])) i++;
  };
  const string = (): string => {
    const start = i;
    i++; // opening quote
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): JsonNode => {
    ws();
    const start = i;
    if (text[i] === "{") {
      i++;
      const members: JsonMember[] = [];
      ws();
      while (text[i] !== "}") {
        const keyStart = i;
        const key = string();
        ws();
        i++; // :
        members.push({ key, start: keyStart, value: value() });
        ws();
        if (text[i] === ",") i++;
        ws();
      }
      i++;
      return { kind: "object", start, end: i, members };
    }
    if (text[i] === "[") {
      i++;
      const items: JsonNode[] = [];
      ws();
      while (text[i] !== "]") {
        items.push(value());
        ws();
        if (text[i] === ",") i++;
        ws();
      }
      i++;
      return { kind: "array", start, end: i, items };
    }
    if (text[i] === '"') {
      string();
      return { kind: "scalar", start, end: i };
    }
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    return { kind: "scalar", start, end: i };
  };
  return value();
}

/** Apply non-overlapping edits. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

const spanOf = (el: JsonNode | JsonMember) =>
  "key" in el ? { start: el.start, end: el.value.end } : { start: el.start, end: el.end };

/**
 * Remove some items of an array (or members of an object), each with the
 * comma and whitespace that separated it, so the rest reads as before.
 */
export function removeElements(
  container: JsonNode,
  remove: Set<number>,
): TextEdit[] {
  if (container.kind === "scalar") return [];
  const els: (JsonNode | JsonMember)[] =
    container.kind === "object" ? container.members : container.items;
  if (remove.size === 0) return [];
  if (els.every((_, k) => remove.has(k))) {
    return [{ start: container.start + 1, end: container.end - 1, text: "" }];
  }
  const edits: TextEdit[] = [];
  let keptBefore = false;
  els.forEach((el, k) => {
    if (!remove.has(k)) {
      keptBefore = true;
      return;
    }
    const s = spanOf(el);
    edits.push(
      keptBefore
        ? { start: spanOf(els[k - 1]).end, end: s.end, text: "" }
        : { start: s.start, end: spanOf(els[k + 1]).start, text: "" },
    );
  });
  return edits;
}

/** Leading whitespace of the line `pos` is on. */
function lineIndent(text: string, pos: number): string {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

export interface Format {
  /** One level of indentation */
  indent: string;
  eol: string;
}

/** `value` as JSON whose continuation lines start at `base`. */
function render(value: unknown, base: string, format: Format): string {
  return JSON.stringify(value, null, format.indent).replace(/\n/g, format.eol + base);
}

/**
 * Append `value` to an array, or `"key": value` to an object, matching
 * how the container is laid out: one per line, or all on one line.
 */
export function appendElement(
  text: string,
  container: JsonNode,
  value: unknown,
  format: Format,
  key?: string,
): TextEdit {
  if (container.kind === "scalar") throw new Error("not a container");
  const els: (JsonNode | JsonMember)[] =
    container.kind === "object" ? container.members : container.items;
  const prefix = key === undefined ? "" : `${JSON.stringify(key)}: `;
  const containerIndent = lineIndent(text, container.start);

  if (els.length === 0) {
    const inner = containerIndent + format.indent;
    return {
      start: container.start + 1,
      end: container.end - 1,
      text: `${format.eol}${inner}${prefix}${render(value, inner, format)}${format.eol}${containerIndent}`,
    };
  }
  const last = spanOf(els[els.length - 1]);
  const first = spanOf(els[0]);
  const multiline = text.slice(container.start, first.start).includes("\n");
  if (!multiline) {
    // Compact container: stay on one line, with the separator it uses
    const between = els.length > 1 ? text.slice(first.end, spanOf(els[1]).start) : ",";
    const sep = between.includes(" ") ? ", " : ",";
    const pre = key === undefined ? "" : JSON.stringify(key) + (/: /.test(text.slice(container.start, container.end)) ? ": " : ":");
    return { start: last.end, end: last.end, text: `${sep}${pre}${JSON.stringify(value)}` };
  }
  const itemIndent = lineIndent(text, last.start);
  return {
    start: last.end,
    end: last.end,
    text: `,${format.eol}${itemIndent}${prefix}${render(value, itemIndent, format)}`,
  };
}

/** The last member with this key (what JSON.parse uses), if any. */
export function memberOf(node: JsonNode, key: string): JsonMember | undefined {
  if (node.kind !== "object") return undefined;
  for (let k = node.members.length - 1; k >= 0; k--) {
    if (node.members[k].key === key) return node.members[k];
  }
  return undefined;
}
