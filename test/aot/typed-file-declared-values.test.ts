// What `bun build --dts` writes into `.aot.ts` files for a name that only a `declare` gives a value. No statement of
// the bundle makes such a value: the program finds it where it runs, under the name that the source has for it. The
// JavaScript reads that name, and the `.aot.ts` file is that JavaScript with types. So a declaration keeps its name
// there where the JavaScript of its module reads it, and is free to get a number behind its name everywhere else.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "./with-compiler";

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const compilerOptions = { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] };
const project = {
  "tsconfig.json": JSON.stringify({ compilerOptions }),
  "package.json": JSON.stringify({ name: "hosted", version: "1.0.0" }),
};

// The file without the comments that say which source each part is from.
const typedText = (root: string, path = "out/index.aot.ts") =>
  readFileSync(join(root, path), "utf8").replace(/^\/\/ .*\.tsx?\r?\n/gm, "");

async function built(root: string, ...flags: string[]) {
  const build = await bun(root, "build", "./src/index.ts", "--outdir", "out", "--dts", ...flags);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return typedText(root);
}

const hosted = `declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version;
}
`;
const hostedTyped = `declare namespace Host {
  const version: number;
}
function version() {
  return Host.version;
}
export {
  version
};
`;

describe.concurrent("a declared value in an .aot.ts file", () => {
  test("a namespace that the code reads keeps its name, so a caller is judged as by the sources", async () => {
    using dir = tempDir("typed-file-declared-namespace", {
      ...project,
      "src/index.ts": hosted,
      "callers/sources.ts": `import { version } from "../src/index";\nexport const text: string = version();\n`,
      "callers/typed.ts": `import { version } from "../out/index.aot";\nexport const text: string = version();\n`,
    });
    expect(await built(String(dir))).toBe(hostedTyped);
    const checked = await bun(String(dir), "check", "--no-pretty", "callers/sources.ts", "callers/typed.ts");
    expect(checked.stdout.replaceAll("\\", "/").split(/\r?\n/).filter(Boolean)).toEqual([
      "callers/sources.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.",
      "callers/typed.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.",
    ]);
  });

  test("Bun.build({ dts: true }) writes the same file", async () => {
    using dir = tempDir("typed-file-declared-namespace-api", { ...project, "src/index.ts": hosted });
    const root = String(dir);
    const build = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(build.logs).toEqual([]);
    expect(typedText(root)).toBe(hostedTyped);
  });

  test("bun compile --library writes the same file", async () => {
    using dir = tempDir("typed-file-declared-namespace-library", { ...project, "src/index.ts": hosted });
    const build = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(typedText(String(dir), "dist/index.aot.ts")).toBe(hostedTyped);
  });

  test("a namespace keeps its name whatever holds its value and wherever it is declared", async () => {
    using dir = tempDir("typed-file-declared-namespaces", {
      ...project,
      "src/index.ts": `declare namespace Levels {
  const enum Level {
    Low = 1,
    High = 2,
  }
}
declare namespace Outer.Inner {
  const depth: number;
}
declare namespace Members {
  function read(): number;
  class Reader {
    size: number;
  }
  enum Mode {
    On,
    Off,
  }
  let count: number;
  var total: number;
}
export function read(merged: Merged): number[] {
  const reader = new Members.Reader();
  const members = [Members.read(), reader.size, Members.Mode.On, Members.count, Members.total];
  return [Levels.Level.High, Outer.Inner.depth, Later.value, Twice.first + Twice.second, Merged.size + merged.size, ...members];
}
declare namespace Later {
  const value: number;
}
declare namespace Twice {
  const first: number;
}
declare namespace Twice {
  const second: number;
}
interface Merged {
  size: number;
}
declare namespace Merged {
  const size: number;
}
`,
    });
    expect(await built(String(dir))).toBe(`declare namespace Levels {
  const enum Level {
    Low = 1,
    High = 2,
  }
}
declare namespace Outer.Inner {
  const depth: number;
}
declare namespace Members {
  function read(): number;
  class Reader {
    size: number;
  }
  enum Mode {
    On,
    Off,
  }
  let count: number;
  var total: number;
}
declare namespace Later {
  const value: number;
}
declare namespace Twice {
  const first: number;
}
declare namespace Twice {
  const second: number;
}
interface Merged {
  size: number;
}
declare namespace Merged {
  const size: number;
}
function read(merged: Merged): number[] {
  const reader = new Members.Reader;
  const members = [Members.read(), reader.size, Members.Mode.On, Members.count, Members.total];
  return [Levels.Level.High, Outer.Inner.depth, Later.value, Twice.first + Twice.second, Merged.size + merged.size, ...members];
}
export {
  read
};
`);
  });

  // The build finds which module reads a name through the source map of the bundle. Here three modules read values
  // in each way, and each read has a namespace of its own: a read that the build gave to no module, or to another
  // module, would leave its namespace with a number.
  const reads: [name: string, read: (name: string) => string][] = [
    ["Member", name => `export const member = ${name}.value;`],
    ["Argument", name => `export const argument = String(${name}.value);`],
    ["Shorthand", name => `export const shorthand = { ${name} };`],
    ["Template", name => "export const template = `${" + name + ".value}`;"],
    ["TypeOf", name => `export const typeOf = typeof ${name};`],
    ["Made", name => `export const made = new ${name}.Box();`],
    ["Chained", name => `export const chained = ${name}?.value;`],
    ["Indexed", name => `export const indexed = ${name}["value"];`],
    ["Spread", name => `export const spread = [...${name}.list];`],
    ["Default", name => `export function byDefault(value = ${name}.value) {\n  return value;\n}`],
    ["Extended", name => `export class Extension extends ${name}.Box {}`],
    ["Tagged", name => "export function tagged() {\n  return " + name + ".tag`text`;\n}"],
    ["Exported", name => `export default ${name}.value;`],
  ];
  const namesIn = (module: string) => reads.map(([name]) => name + module);
  const moduleThatReads = (module: string) =>
    namesIn(module)
      .map(
        name => `declare namespace ${name} {
  const value: number;
  const list: number[];
  class Box {}
  function tag(strings: TemplateStringsArray): string;
}
`,
      )
      .join("") + reads.map(([name, read]) => read(name + module) + "\n").join("");

  test.each([
    ["nothing minified", []],
    ["--minify-syntax", ["--minify-syntax"]],
    ["--minify-whitespace", ["--minify-whitespace"]],
    ["--minify-syntax --minify-whitespace", ["--minify-syntax", "--minify-whitespace"]],
  ])("a namespace keeps its name however the code of its module reads it: %s", async (_, flags) => {
    using dir = tempDir("typed-file-declared-reads", {
      ...project,
      "src/first.ts": moduleThatReads("First"),
      "src/second.ts": moduleThatReads("Second"),
      "src/index.ts": `import first, * as First from "./first";
import second, * as Second from "./second";
${moduleThatReads("Entry")}export const others = [first, second, First, Second];
`,
    });
    const typed = await built(String(dir), ...flags);
    expect(typed.match(/^declare namespace \w+/gm)?.sort()).toEqual(
      ["First", "Second", "Entry"].flatMap(module => namesIn(module).map(name => `declare namespace ${name}`)).sort(),
    );
  });

  // A package that stays an import of the bundle.
  const imported = {
    "node_modules/ext/package.json": JSON.stringify({ name: "ext", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/ext/index.js": "export const Host = { y: 1 };\n",
    "node_modules/ext/index.d.ts":
      "export declare const Host: { y: number };\nexport interface Shape {\n  id: string;\n}\n",
    "src/other.ts": `import { Host } from "ext";
export function y(): number {
  return Host.y;
}
`,
  };

  // `lines`: the lines of the file that have `name`, or `name` with the number that sets another declaration of it apart.
  const names: { title: string; name: string; files: Record<string, string>; flags?: string[]; lines: string[] }[] = [
    {
      title: "two modules declare the namespace that both read: it is written once",
      name: "Host",
      files: {
        "src/index.ts": `import { other } from "./other";
declare namespace Host {
  const version: number;
}
export function version(): number {
  return Host.version + other();
}
`,
        "src/other.ts": `declare namespace Host {
  const version: number;
}
export function other(): number {
  return Host.version;
}
`,
      },
      lines: ["declare namespace Host {", "return Host.version;", "return Host.version + other();"],
    },
    {
      title: "a namespace that shares its name with a type that the module imports",
      name: "Host",
      files: {
        "src/index.ts": `import type { Host } from "./types";
declare namespace Host {
  const version: number;
}
export function version(host?: Host): number {
  return Host.version;
}
`,
        "src/types.ts": `export interface Host {
  id: string;
}
`,
      },
      lines: [
        "declare namespace Host {",
        "interface Host2 {",
        "function version(host?: Host2): number {",
        "return Host.version;",
      ],
    },
    {
      title: "a namespace of a script, which another module reads",
      name: "Host",
      files: {
        "src/index.ts": `import "./globals";
export function version(): number {
  return Host.version;
}
`,
        "src/globals.ts": `declare namespace Host {
  const version: number;
}
globalThis.String("loaded");
`,
      },
      lines: ["declare namespace Host {", "return Host.version;"],
    },
    {
      title: "a namespace that the code reads only where JSX is written",
      name: "Dom",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { ...compilerOptions, jsx: "react", jsxFactory: "Dom.h" } }),
        "package.json": JSON.stringify({
          name: "hosted",
          version: "1.0.0",
          compilerOptions: { strict: true, jsx: "react", jsxFactory: "Dom.h" },
        }),
        "src/index.tsx": `declare namespace Dom {
  function h(tag: unknown, props: unknown, ...children: unknown[]): { tag: unknown };
}
declare global {
  namespace JSX {
    interface IntrinsicElements {
      div: {};
    }
    type Element = { tag: unknown };
  }
}
export function view(): object {
  return <div />;
}
`,
      },
      lines: ["declare namespace Dom {", 'return /* @__PURE__ */ Dom.h("div", null);'],
    },
    {
      title: "a namespace that a module exports, where the module is exported whole",
      name: "Host",
      files: {
        "src/index.ts": `import * as a from "./a";
export { a };
`,
        "src/a.ts": `export declare namespace Host {
  const version: number;
}
export function one(): number {
  return 1;
}
`,
      },
      lines: ["declare namespace Host {"],
    },
    {
      title: "a constant that export default reads",
      name: "Host",
      files: { "src/index.ts": `declare const Host: { version: number };\nexport default Host.version;\n` },
      lines: ["declare const Host: { version: number };", "var src_default = Host.version;"],
    },
    {
      title: "two modules declare a constant and one of them reads it: it is written once",
      name: "VERSION",
      files: {
        "src/index.ts": `import { label } from "./label";
declare const VERSION: string;
export function version(): string {
  return label(VERSION);
}
`,
        "src/label.ts": `declare const VERSION: string;
export function label(text: string): string {
  return "v" + text;
}
`,
      },
      lines: ["declare const VERSION: string;", "return label(VERSION);"],
    },
    {
      title: "a namespace of types gets a number beside a constant of another module",
      name: "Host",
      files: {
        "src/index.ts": `import { hostVersion } from "./other";
declare namespace Host {
  type Version = number;
}
export function version(): Host.Version {
  return hostVersion();
}
`,
        "src/other.ts": `const Host = { version: 1 };
export function hostVersion(): number {
  return Host.version;
}
`,
      },
      lines: [
        "const Host = { version: 1 };",
        "return Host.version;",
        "declare namespace Host2 {",
        "function version(): Host2.Version {",
      ],
    },
    {
      title: "a namespace that only a type reads gets a number beside an import of another module",
      name: "Host",
      files: {
        ...imported,
        "src/index.ts": `import { y } from "./other";
declare namespace Host {
  const version: number;
}
export function version(): typeof Host.version {
  return y();
}
`,
      },
      flags: ["--external", "ext"],
      lines: [
        'import { Host } from "ext";',
        "return Host.y;",
        "declare namespace Host2 {",
        "function version(): typeof Host2.version {",
      ],
    },
    {
      title: "a namespace that only a type reads gets a number beside a global that another module reads",
      name: "Math",
      files: {
        "src/index.ts": `import { floor } from "./other";
declare namespace Math {
  const extra: number;
}
export function extra(): typeof Math.extra {
  return floor(1.5);
}
`,
        "src/other.ts": `export function floor(n: number): number {
  return Math.floor(n);
}
`,
      },
      lines: ["return Math.floor(n);", "declare namespace Math2 {", "function extra(): typeof Math2.extra {"],
    },
    {
      title: "a constant that only a type reads gets a number beside an import of another module",
      name: "Host",
      files: {
        ...imported,
        "src/index.ts": `import { y } from "./other";
declare const Host: { version: number };
export function version(): typeof Host {
  return { version: y() };
}
`,
      },
      flags: ["--external", "ext"],
      lines: [
        'import { Host } from "ext";',
        "return Host.y;",
        "declare const Host2: { version: number };",
        "function version(): typeof Host2 {",
      ],
    },
  ];

  test.each(names.map(named => [named.title, named] as const))("%s", async (_, { name, files, flags = [], lines }) => {
    using dir = tempDir("typed-file-declared-names", { ...project, ...files });
    const entry = "src/index.tsx" in files ? "./src/index.tsx" : "./src/index.ts";
    const build = await bun(String(dir), "build", entry, "--outdir", "out", "--dts", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const named = new RegExp(`\\b${name}\\d*\\b`);
    const found = typedText(String(dir))
      .split(/\r?\n/)
      .filter(line => named.test(line));
    expect(found.map(line => line.trim())).toEqual(lines);
  });
});
