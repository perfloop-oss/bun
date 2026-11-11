import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A RegExp keeps the text of `source` from the first read: the engine escapes the pattern once
// and every later read returns the same string. Before, each read escaped the pattern again and
// made a new string.

// The pattern text, and the `source` of a RegExp made from it.
const cases: [string, string][] = [
  ["", "(?:)"],
  ["a", "a"],
  ["abc", "abc"],
  ["/", "\\/"],
  ["a/b", "a\\/b"],
  ["a\\/b", "a\\/b"],
  ["[/]", "[/]"],
  ["[/]/", "[/]\\/"],
  ["[\\]/]/", "[\\]/]\\/"],
  ["\\[/", "\\[\\/"],
  ["a\nb", "a\\nb"],
  ["a\rb", "a\\rb"],
  ["a\u2028b", "a\\u2028b"],
  ["a\u2029b", "a\\u2029b"],
  ["a\\\nb", "a\\nb"],
  ["[\n]", "[\\n]"],
  ["^/users/(\\d+)/items/(\\d+)$", "^\\/users\\/(\\d+)\\/items\\/(\\d+)$"],
  ["\u3042", "\u3042"],
  ["\u3042/\u3044", "\u3042\\/\u3044"],
  [Buffer.alloc(5000, "x").toString() + "/", Buffer.alloc(5000, "x").toString() + "\\/"],
];

// How many string cells `count` reads of a value add to the heap when every result is kept.
function stringCellsAddedBy(read: () => string, count: number): number {
  const kept = new Array<string>(count);
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.string;
  for (let i = 0; i < count; i++) kept[i] = read();
  const after = heapStats().objectTypeCounts.string;
  expect(kept[count - 1]).toBe(kept[0]);
  return after - before;
}

describe("RegExp.prototype.source", () => {
  test("a read does not make a new string", () => {
    const literal = /foo+bar/;
    const needsEscape = new RegExp("^/users/(\\d+)$");
    const reads = 20000;
    // Each read made one string cell before: 20000 of them here.
    expect(stringCellsAddedBy(() => literal.source, reads)).toBeLessThan(100);
    expect(stringCellsAddedBy(() => needsEscape.source, reads)).toBeLessThan(100);
    expect(stringCellsAddedBy(() => RegExp.prototype.source, reads)).toBeLessThan(100);
  });

  test("values", () => {
    for (const [text, expected] of cases) {
      const regExp = new RegExp(text);
      expect(regExp.source).toBe(expected);
      expect(regExp.source).toBe(expected);
      expect(String(regExp)).toBe("/" + expected + "/");
      expect(new RegExp(regExp.source).source).toBe(expected);
    }
    expect(/a\/b/.source).toBe(new RegExp("a/b").source);
    expect(new RegExp("a/b", "gi").source).toBe("a\\/b");
    expect(RegExp.prototype.source).toBe("(?:)");
  });

  test("compile() changes the source of an object whose source was read", () => {
    const regExp = new RegExp("a/b");
    const other = new RegExp("a/b");
    expect(regExp.source).toBe("a\\/b");
    regExp.compile("c/d");
    expect(regExp.source).toBe("c\\/d");
    expect(other.source).toBe("a\\/b");
    regExp.compile(/e\/f/g);
    expect([regExp.source, regExp.flags]).toEqual(["e\\/f", "g"]);
    regExp.compile();
    expect(regExp.source).toBe("(?:)");
  });

  test("receivers", () => {
    const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!;
    class Derived extends RegExp {}
    expect(getter.call(new RegExp("r/s"))).toBe("r\\/s");
    expect(getter.call(new Derived("r/s"))).toBe("r\\/s");
    expect(getter.call(RegExp.prototype)).toBe("(?:)");
    for (const receiver of [undefined, null, 1, "a/b", {}, Object.create(RegExp.prototype)])
      expect(() => getter.call(receiver)).toThrow(TypeError);

    const shadowed = new RegExp("r/s");
    expect(shadowed.source).toBe("r\\/s");
    Object.defineProperty(shadowed, "source", { value: "own" });
    expect(shadowed.source).toBe("own");
    expect(getter.call(shadowed)).toBe("r\\/s");
  });

  test("the kept string stays right across collections and outlives its RegExp", () => {
    const regExps: RegExp[] = [];
    const kept: string[] = [];
    for (let i = 0; i < 500; i++) {
      const regExp = new RegExp("gc/" + i);
      expect(regExp.source).toBe("gc\\/" + i);
      regExps.push(regExp);
      kept.push(new RegExp("once/" + i).source);
    }
    for (let round = 0; round < 3; round++) {
      Bun.gc(true);
      for (let i = 0; i < regExps.length; i++) {
        if (regExps[i].source !== "gc\\/" + i) throw new Error(`round ${round}: ${regExps[i].source}`);
        if (kept[i] !== "once\\/" + i) throw new Error(`round ${round}: ${kept[i]}`);
      }
    }
  });

  test("what prints a RegExp reads the same source", () => {
    const regExp = new RegExp("print/me", "g");
    expect(Bun.inspect(regExp)).toBe("/print\\/me/g");
    expect(regExp.source).toBe("print\\/me");
    expect(Bun.inspect(regExp)).toBe("/print\\/me/g");
    expect(`${regExp}`).toBe("/print\\/me/g");
    expect(new RegExp(regExp).source).toBe("print\\/me");
  });

  // The heap snapshot names a RegExp by its source. It asks the engine for the text, not for a
  // string cell, and it is the first to ask here. In a child: a snapshot of this process is slow.
  test("a heap snapshot names a RegExp before anything read its source", async () => {
    const program = `
      const regExp = new RegExp("heap/snapshot-" + "name");
      const before = JSON.parse(Bun.generateHeapSnapshot("v8")).strings.includes("/heap\\\\/snapshot-name/");
      const source = regExp.source;
      const after = JSON.parse(Bun.generateHeapSnapshot("v8")).strings.includes("/heap\\\\/snapshot-name/");
      console.log(JSON.stringify({ before, source, again: regExp.source, after }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", program],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify({
        before: true,
        source: "heap\\/snapshot-name",
        again: "heap\\/snapshot-name",
        after: true,
      }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});
