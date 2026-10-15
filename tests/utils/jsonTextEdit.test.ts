import { describe, expect, it } from "vitest";
import {
  appendElement,
  applyEdits,
  memberOf,
  parseSpans,
  removeElements,
  type JsonNode,
} from "../../src/utils/jsonTextEdit";

const FMT = { indent: "  ", eol: "\n" };

function arr(node: JsonNode) {
  if (node.kind !== "array") throw new Error("not an array");
  return node;
}

describe("jsonTextEdit", () => {
  it("finds spans of keys and values, with strings containing brackets and escapes", () => {
    const text = `{ "a": "x]\\"}", "b": [1, {"c": null}], "d": -1.5e3 }`;
    const root = parseSpans(text);
    expect(root.kind === "object" && root.members.map((m) => m.key)).toEqual(["a", "b", "d"]);
    const b = memberOf(root, "b")!.value;
    expect(text.slice(b.start, b.end)).toBe(`[1, {"c": null}]`);
    expect(text.slice(memberOf(root, "d")!.value.start, memberOf(root, "d")!.value.end)).toBe("-1.5e3");
  });

  it("uses the last of duplicate keys, like JSON.parse", () => {
    const text = `{"k": 1, "k": 2}`;
    const k = memberOf(parseSpans(text), "k")!.value;
    expect(text.slice(k.start, k.end)).toBe("2");
  });

  it("removes items with their separators", () => {
    const text = "[\n  1,\n  2,\n  3,\n  4\n]";
    const list = arr(parseSpans(text));
    const cases: [number[], string][] = [
      [[0], "[\n  2,\n  3,\n  4\n]"],
      [[3], "[\n  1,\n  2,\n  3\n]"],
      [[1, 2], "[\n  1,\n  4\n]"],
      [[0, 1], "[\n  3,\n  4\n]"],
      [[0, 2], "[\n  2,\n  4\n]"],
      [[0, 1, 3], "[\n  3\n]"],
      [[0, 1, 2, 3], "[]"],
    ];
    for (const [remove, expected] of cases) {
      const out = applyEdits(text, removeElements(list, new Set(remove)));
      expect(out).toBe(expected);
      expect(() => JSON.parse(out)).not.toThrow();
    }
  });

  it("removes object members", () => {
    const text = `{"a": 1, "b": 2, "c": 3}`;
    const root = parseSpans(text);
    expect(applyEdits(text, removeElements(root, new Set([1])))).toBe(`{"a": 1, "c": 3}`);
    expect(applyEdits(text, removeElements(root, new Set([0])))).toBe(`{"b": 2, "c": 3}`);
  });

  it("appends in the container's own layout", () => {
    const multi = `{\n    "list": [\n        1\n    ]\n}`;
    const list = memberOf(parseSpans(multi), "list")!.value;
    expect(applyEdits(multi, [appendElement(multi, list, { a: [2] }, { indent: "    ", eol: "\n" })])).toBe(
      `{\n    "list": [\n        1,\n        {\n            "a": [\n                2\n            ]\n        }\n    ]\n}`,
    );

    const compact = `{"a":[1,2]}`;
    const a = memberOf(parseSpans(compact), "a")!.value;
    expect(applyEdits(compact, [appendElement(compact, a, { b: 3 }, FMT)])).toBe(`{"a":[1,2,{"b":3}]}`);
    const root = parseSpans(compact);
    expect(applyEdits(compact, [appendElement(compact, root, [], FMT, "z")])).toBe(`{"a":[1,2],"z":[]}`);
  });

  it("fills an empty container on new lines", () => {
    const text = `{\n  "x": []\n}`;
    const x = memberOf(parseSpans(text), "x")!.value;
    expect(applyEdits(text, [appendElement(text, x, 1, FMT)])).toBe(`{\n  "x": [\n    1\n  ]\n}`);
  });

  it("keeps CRLF", () => {
    const text = `{\r\n  "a": 1\r\n}\r\n`;
    const out = applyEdits(text, [appendElement(text, parseSpans(text), { b: 1 }, { indent: "  ", eol: "\r\n" }, "c")]);
    expect(out).toBe(`{\r\n  "a": 1,\r\n  "c": {\r\n    "b": 1\r\n  }\r\n}\r\n`);
  });
});
