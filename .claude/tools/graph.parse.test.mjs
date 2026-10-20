import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compilerAt,
  parseModuleRegex,
  parseModuleTs,
  parserFor,
  regexParser,
} from "./graph.parse.mjs";

/**
 * Разбор модуля — одна запись на текст, которую читают граф, имена,
 * поверхность, привязки модели свода и импорт листа стилей. Реализаций две:
 * регулярными выражениями и компилятором TypeScript из пакетов проекта.
 * Здесь закреплено, что запись говорит о каждой форме строки импорта и
 * экспорта, — у обеих реализаций одно и то же; где они расходятся, это
 * названо отдельным случаем; и на коде посадки они дают одну запись.
 */
const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(TOOL_DIR, "..", "..");
const ts = compilerAt(ROOT);

it("компилятор TypeScript есть среди пакетов посадки", () => {
  expect(ts).not.toBe(null);
  expect(parserFor(ROOT).name).toContain("компилятор TypeScript");
});

it("компилятор — только из пакетов проекта, не глобальная установка", () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "razbor-"));
  try {
    fs.writeFileSync(path.join(box, "package.json"), "{}");
    expect(compilerAt(box)).toBe(null);
    expect(parserFor(box).name).toBe("регулярные выражения");
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

it("пакеты проекта, поставленные ссылкой, — тоже пакеты проекта", () => {
  // Так их связывает песочница пробы: ссылка на папку пакетов стенда.
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "razbor-"));
  const link = path.join(box, "node_modules");
  try {
    fs.writeFileSync(path.join(box, "package.json"), "{}");
    fs.symlinkSync(path.join(ROOT, "node_modules"), link, "junction");
    expect(compilerAt(box)).not.toBe(null);
    expect(parserFor(box).name).toContain("компилятор TypeScript");
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(box, { recursive: true, force: true });
  }
});

it("манифест без кода — не пакет: поиск идёт выше, к пакетам проекта", () => {
  // Так лежит песочница фальсификации: внутри проекта, с одними манифестами.
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "razbor-"));
  const inner = path.join(box, "inner");
  const link = path.join(box, "node_modules");
  try {
    const pkg = path.join(inner, "node_modules", "typescript");
    fs.mkdirSync(pkg, { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, "node_modules", "typescript", "package.json"),
      path.join(pkg, "package.json"),
    );
    fs.writeFileSync(path.join(inner, "package.json"), "{}");
    expect(compilerAt(inner)).toBe(null);
    expect(parserFor(inner).name).toBe("регулярные выражения");
    fs.symlinkSync(path.join(ROOT, "node_modules"), link, "junction");
    expect(compilerAt(inner)).not.toBe(null);
    expect(parserFor(inner).name).toContain("компилятор TypeScript");
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(box, { recursive: true, force: true });
  }
});

const PARSERS = [
  ["регулярные выражения", (src) => parseModuleRegex(src)],
  ["компилятор", (src, file = "m.tsx") => parseModuleTs(src, ts, file)],
];

describe.each(PARSERS)("разбор модуля (%s): строки импорта", (_, parse) => {
  const one = (src) => parse(src).froms[0];

  it("взятое по умолчанию", () => {
    expect(one('import x from "a";')).toMatchObject({
      keyword: "import",
      spec: "a",
      typeOnly: false,
      star: false,
      namespace: null,
      specifiers: [],
      defaultLocal: "x",
    });
  });

  it("скобки: имя там, имя здесь, пометка типа", () => {
    expect(one('import { a, b as c, type D } from "b";')).toMatchObject({
      specifiers: [
        { there: "a", here: "a", typeOnly: false },
        { there: "b", here: "c", typeOnly: false },
        { there: "D", here: "D", typeOnly: true },
      ],
      defaultLocal: "",
    });
  });

  it("строка о типах целиком", () => {
    expect(one('import type { T } from "c";')).toMatchObject({
      typeOnly: true,
      specifiers: [{ there: "T", here: "T", typeOnly: false }],
    });
  });

  it("пространство имён и взятое по умолчанию рядом с ним", () => {
    expect(one('import * as ns from "d";')).toMatchObject({
      star: true,
      namespace: "ns",
      defaultLocal: "",
    });
    expect(one('import x, * as ns from "e";')).toMatchObject({
      star: true,
      namespace: "ns",
      defaultLocal: "x",
    });
  });

  it("скобки в несколько строк", () => {
    expect(one('import {\n  a,\n  b,\n} from "m";').specifiers).toEqual([
      { there: "a", here: "a", typeOnly: false },
      { there: "b", here: "b", typeOnly: false },
    ]);
  });

  it("импорт-побочный-эффект и смещения за кавычкой адреса", () => {
    const src = 'import a from "x";\nimport "y";\n';
    const parsed = parse(src);
    expect(parsed.bare).toEqual([{ spec: "y", end: src.indexOf('"y"') + 3 }]);
    expect(parsed.froms[0].end).toBe(src.indexOf('"x"') + 3);
    expect(parse('import "z";').bare).toEqual([{ spec: "z", end: 10 }]);
  });

  it("неровные пробелы: отступ, табуляция, ни одного пробела у кавычки и скобки", () => {
    expect(one("  import \t x \t from \t 'a';")).toMatchObject({
      spec: "a",
      defaultLocal: "x",
    });
    expect(one('import {a}from"b";')).toMatchObject({
      spec: "b",
      specifiers: [{ there: "a", here: "a", typeOnly: false }],
    });
    expect(parse('  import"c";').bare.map((b) => b.spec)).toEqual(["c"]);
  });

  it("строка импорта не с начала строки — не строка импорта", () => {
    const src = '// was: import x from "a";\n// was: import "b";\nexport const k = 1;';
    expect(parse(src).froms).toEqual([]);
    expect(parse(src).bare).toEqual([]);
  });

  it("клаузы с type и as: взятое по умолчанию о типах, переименование с пометкой типа", () => {
    expect(one('import type X from "a";')).toMatchObject({
      typeOnly: true,
      defaultLocal: "X",
      specifiers: [],
    });
    expect(one('import X, { type A as B, c  as  d } from "b";')).toMatchObject({
      typeOnly: false,
      defaultLocal: "X",
      specifiers: [
        { there: "A", here: "B", typeOnly: true },
        { there: "c", here: "d", typeOnly: false },
      ],
    });
    expect(one('export type { A as B } from "t";')).toMatchObject({
      keyword: "export",
      typeOnly: true,
      specifiers: [{ there: "A", here: "B", typeOnly: false }],
    });
    expect(parse("const a = 1;\nexport { type a as b };").local).toEqual([
      { here: "a", out: "b" },
    ]);
  });
});

describe.each(PARSERS)("разбор модуля (%s): экспорт", (_, parse) => {
  const one = (src) => parse(src).froms[0];

  it("переотдача целиком, с именем и по скобкам", () => {
    expect(one('export * from "f";')).toMatchObject({
      keyword: "export",
      star: true,
      namespace: null,
      defaultLocal: "",
    });
    expect(one('export * as ns from "g";')).toMatchObject({
      star: true,
      namespace: "ns",
    });
    expect(one('export { a as b } from "h";')).toMatchObject({
      star: false,
      namespace: null,
      specifiers: [{ there: "a", here: "b", typeOnly: false }],
    });
  });

  it("объявленные экспортом имена", () => {
    const src = [
      "export const A = 1;",
      "export async function f() {}",
      "export class K {}",
      "export type T = 1;",
      "export interface I {}",
      "export enum E { X }",
    ].join("\n");
    expect([...parse(src).own]).toEqual(["A", "f", "K", "T", "I", "E"]);
  });

  it("отдача по умолчанию: своя и взятая импортом", () => {
    const bound = parse('import X from "x";\nexport default X;');
    expect(bound.hasDefault).toBe(true);
    expect(bound.defaultBinding).toBe("X");
    const own = parse("export default function () {}");
    expect(own.hasDefault).toBe(true);
    expect(own.defaultBinding).toBe(null);
    expect(own.surface.has("default")).toBe(true);
  });

  it("скобки без источника — в местной отдаче, с источником — только в поверхности", () => {
    const parsed = parse(
      'const a = 1;\nexport { a as b };\nexport type { T } from "t";',
    );
    expect(parsed.local).toEqual([{ here: "a", out: "b" }]);
    expect([...parsed.surface].sort()).toEqual(["T", "b"]);
  });

  it("константы, отданные с начала строки", () => {
    expect(
      parse("export const LIMIT = 1;\nexport const other = 2;").constants,
    ).toEqual(["LIMIT"]);
  });

  it("пространство имён, генератор со звёздочкой через пробел и экспорт разбором", () => {
    const src = [
      "export namespace N {}",
      "export declare namespace D {}",
      "export function *g() {}",
      "export const { a, b: c, d = 1, ...rest } = o;",
      "export const [x, , y, [z]] = arr;",
    ].join("\n");
    expect([...parse(src).own].sort()).toEqual(
      ["D", "N", "a", "c", "d", "g", "rest", "x", "y", "z"].sort(),
    );
    expect(parse(src).constants).toEqual([]);
  });

  it("export =, отдача по умолчанию выражением и let с именем константы", () => {
    const assigned = parse("const foo = 1;\nexport = foo;");
    expect(assigned.hasDefault).toBe(false);
    expect([...assigned.surface]).toEqual([]);
    const member = parse('import a from "a";\nexport default a.b;');
    expect(member.hasDefault).toBe(true);
    expect(member.defaultBinding).toBe(null);
    const loose = parse("export let LIMIT = 1;\nexport var MAX = 2;");
    expect([...loose.own]).toEqual(["LIMIT", "MAX"]);
    expect(loose.constants).toEqual([]);
  });
});

describe.each(PARSERS)(
  "разбор модуля (%s): импорт во время работы",
  (_, parse) => {
    const calls = (src) => parse(src).dynamic.map((d) => d.call + " " + d.spec);

    it("вызов импорта и `require` на любой глубине, адрес строкой и шаблоном", () => {
      const src = [
        'const lazy = () => import("../app/App");',
        "export const load = async () => {",
        "  const m = await import(`./part`);",
        '  return require("./sync").value + m.x;',
        "};",
      ].join("\n");
      expect(calls(src)).toEqual([
        "import ../app/App",
        "import ./part",
        "require ./sync",
      ]);
      expect(parse(src).dynamic[0].end).toBe(src.indexOf('"../app/App"') + 12);
    });

    it("тип через импорт и импорт в строчном комментарии — не ребро", () => {
      expect(
        calls(
          [
            'type T = import("./t").Foo;',
            'let u: typeof import("./u");',
            '// const later = import("./later");',
            "export const v = 1;",
          ].join("\n"),
        ),
      ).toEqual([]);
    });

    it("адрес, собранный выражением, идёт своим списком: постоянные начало и хвост", () => {
      const src = [
        'const at = "./x";',
        "import(at);",
        "import(`./pages/${at}.tsx`);",
        "require(`${base}/x`);",
        "// import(`./later/${at}`);",
      ].join("\n");
      expect(calls(src)).toEqual([]);
      expect(
        parse(src).computed.map((one) => [one.call, one.prefix, one.suffix, src.slice(one.at, one.at + 3)]),
      ).toEqual([
        ["import", "", "", "at)"],
        ["import", "./pages/", ".tsx", "`./"],
        ["require", "", "/x", "`${"],
      ]);
    });

    it("второй довод — настройки импорта, адрес — первый", () => {
      const src = [
        'const j = import("./x.json", { with: { type: "json" } });',
        "const t = import(`./p/${n}.json`, { with: { type: \"json\" } });",
      ].join("\n");
      expect(calls(src)).toEqual(["import ./x.json"]);
      expect(parse(src).dynamic[0].end).toBe(src.indexOf('"./x.json"') + 10);
      expect(parse(src).computed.map((one) => [one.prefix, one.suffix])).toEqual([
        ["./p/", ".json"],
      ]);
    });

    it("за строчным комментарием смещение адреса прежнее", () => {
      const src = 'go(); // note: call\nconst m = import("./x");';
      expect(parse(src).dynamic).toEqual([
        { spec: "./x", end: src.indexOf('"./x"') + 5, call: "import" },
      ]);
    });
  },
);

/**
 * Где реализации расходятся — и права в каждом случае вторая: регулярные
 * выражения читают текст строками, компилятор — синтаксис.
 */
describe("разбор модуля: в чём компилятор точнее регулярных выражений", () => {
  const both = (src, file = "m.ts") => [
    parseModuleRegex(src),
    parseModuleTs(src, ts, file),
  ];

  it("импорт внутри шаблонной строки — не импорт", () => {
    const [regex, compiler] = both(
      'export const code = `\nimport fake from "nowhere";\n`;',
    );
    expect(regex.froms.map((s) => s.spec)).toEqual(["nowhere"]);
    expect(compiler.froms).toEqual([]);
  });

  it("экспорт внутри строки — не экспорт", () => {
    const [regex, compiler] = both('const s = "export const FAKE = 1";');
    expect([...regex.own]).toEqual(["FAKE"]);
    expect([...compiler.own]).toEqual([]);
  });

  it("отдача по умолчанию без точки с запятой знает имя", () => {
    const [regex, compiler] = both('import X from "x";\nexport default X');
    expect(regex.defaultBinding).toBe(null);
    expect(compiler.defaultBinding).toBe("X");
  });

  it("константа не с начала строки — для образца не таблица настроек", () => {
    const [regex, compiler] = both("const a = 1; export const LIMIT = 2;");
    expect(regex.constants).toEqual([]);
    expect(compiler.constants).toEqual(["LIMIT"]);
  });

  it("имя строкой и точка в имени: образец такое имя не берёт", () => {
    const [regex, compiler] = both('const a = 1;\nexport { a as "kebab-name" };');
    expect([...regex.surface]).toEqual([]);
    expect([...compiler.surface]).toEqual(["kebab-name"]);
    const [inString] = both('const s = "export { a.b }";');
    expect([...inString.surface]).toEqual([]);
  });

  it("константы одной строкой объявления — все", () => {
    const [regex, compiler] = both("export const A = 1, B = 2;");
    expect(regex.constants).toEqual(["A"]);
    expect(compiler.constants).toEqual(["A", "B"]);
  });

  it("импорт во время работы внутри строки — не импорт", () => {
    const [regex, compiler] = both("const s = \"import('./fake')\";");
    expect(regex.dynamic.map((d) => d.spec)).toEqual(["./fake"]);
    expect(compiler.dynamic).toEqual([]);
  });

  it("обобщение стрелочной функции в .ts не ломает разбор следующих строк", () => {
    const src = "const id = <T>(x: T) => x;\nexport const LATER = id(1);";
    expect([...parseModuleTs(src, ts, "m.ts").own]).toEqual(["LATER"]);
  });
});

/** Файлы кода под папкой, кроме объявлений типов. */
const codeUnder = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .map((one) => path.join(dir, String(one)))
        .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !f.endsWith(".d.ts"))
    : [];
/** Запись в виде, который сравнивают: множества — списками по порядку. */
const comparable = (parsed) => ({
  ...parsed,
  own: [...parsed.own].sort(),
  surface: [...parsed.surface].sort(),
});

/**
 * Каждая форма строки импорта и экспорта, по одной на строку. Тесты выше
 * писали их ровно с одним пробелом, и мутант «пробел один и ровно один» в
 * образце разбора выживал: замер подшага 1.6 а, `131` выживший.
 */
const FORMS = [
  '// lead: import("./c0");',
  'import x from "a";',
  'import { a, b as c, type D } from "b";',
  'import type { T } from "c";',
  'import type X from "c2";',
  'import mytype, { mytype as mt } from "my";',
  'import * as ns from "d";',
  'import x2, * as ns2 from "e";',
  'import "side";',
  'export * from "f";',
  'export * as ns3 from "g";',
  'export { a as b2 } from "h";',
  'export type { T2 as T3 } from "t";',
  "export const A = 1;",
  "export const LIMITx = 1;",
  "export const myLIMIT = 2;",
  "export const MAX_1 = 3;",
  "export let L = 1;",
  "export declare const DC: number;",
  "export declare const { dd1 }: { dd1: number };",
  "export async function f() {}",
  "export function* g() {}",
  "export class K {}",
  "export abstract class AK {}",
  "export type TT = 1;",
  "export interface I {}",
  "export enum E { X }",
  "export namespace N {}",
  "export module MM {}",
  "export import QQ = N.QQ;",
  "export const { o1, o2: o3, o4: { o5, o6 }, o7 = f(1, 2) } = obj;",
  "export const [x3, , y3 = 1, [z3]] = arr;",
  "const loc = 1;",
  "const loc3 = 1;",
  "export { loc as loc2, };",
  "export { type loc3 };",
  "export { mytype as mt3 };",
  "type TL = 1;",
  "export type { TL };",
  "export default loc;",
  'const lazy = () => import("./lazy");',
  'const th = import("./then").then((m) => m);',
  'type TI = import("./ti").Foo;',
  'let u: typeof import("./u");',
  'const ty = typeof v + import("./tv");',
  'const json = import("./x.json", { with: { type: "json" } });',
  "const tpl = import(`./p/${n}.ts`);",
  "const nl = import(`./nl\n`);",
  "const val = import(at);",
  'const req = require("./req");',
  "const r0 = require();",
].join("\n");
/** Пробелы раздуты: у каждого знака препинания и вместо каждого пробела —
 * пробел и табуляция, у каждой строки — отступ. Шаблон `${` не трогается. */
const inflated = (src) =>
  src
    .replace(/ /g, " \t ")
    .replace(/(?<!\$)([(){},;*=:])/g, " $1 ")
    .replace(/^/gm, "  ");
/** Пробелы сжаты до нуля там, где язык их не требует. */
const deflated = (src) =>
  src
    .replace(/[ \t]*([(){},;*=:])[ \t]*/g, "$1")
    .replace(/(from|import)[ \t]+(["'`])/g, "$1$2");

describe("разбор модуля: пробелы не меняют записи", () => {
  it.each([
    ["как написано", FORMS],
    ["пробелы раздуты", inflated(FORMS)],
    ["пробелы сжаты", deflated(FORMS)],
  ])("%s: образец даёт ту же запись, что компилятор", (_, src) => {
    expect(comparable(parseModuleRegex(src))).toEqual(
      comparable(parseModuleTs(src, ts, "m.tsx")),
    );
  });

  it("корпус несёт каждую форму: имена, взятое, импорт во время работы", () => {
    const parsed = parseModuleTs(FORMS, ts, "m.tsx");
    expect([...parsed.own].sort()).toEqual(
      ["A", "AK", "DC", "E", "I", "K", "L", "LIMITx", "MAX_1", "MM", "N", "TT", "dd1", "f", "g", "myLIMIT", "o1", "o3", "o5", "o6", "o7", "x3", "y3", "z3"].sort(),
    );
    expect(parsed.constants).toEqual(["A", "MAX_1"]);
    expect(parsed.froms.find((one) => one.spec === "my")).toMatchObject({
      defaultLocal: "mytype",
      specifiers: [{ there: "mytype", here: "mt", typeOnly: false }],
    });
    expect(parsed.dynamic.map((d) => d.spec)).toEqual([
      "./lazy",
      "./then",
      "./tv",
      "./x.json",
      "./req",
    ]);
    expect(parsed.local).toEqual([
      { here: "loc", out: "loc2" },
      { here: "loc3", out: "loc3" },
      { here: "mytype", out: "mt3" },
      { here: "TL", out: "TL" },
    ]);
  });
});

describe("разбор модуля: выбор реализации и её запись", () => {
  it("выбранный разбор отдаёт запись своей реализации", () => {
    const src = 'import x from "a";\nexport const B = 1;';
    expect(parserFor(ROOT).parse(src, "m.ts")).toEqual(parseModuleTs(src, ts, "m.ts"));
    expect(regexParser.parse(src)).toEqual(parseModuleRegex(src));
  });

  it("без имени файла разметка читается как разметка", () => {
    // Обратная кавычка в тексте разметки: прочитанная как TS, она открывает
    // шаблон, и он съедает строки за ней.
    const src = "export const C = () => <p>`</p>;\nexport const LATER = 1;";
    expect([...parseModuleTs(src, ts).own]).toEqual(["C", "LATER"]);
  });

  // Разбор идёт на каждом хуке правки, и файл бывает недописан.
  it.each(PARSERS)("недописанный файл посреди правки (%s): разбор не падает и берёт написанное", (_, parse) => {
    expect([...parse("export const { a, b").own]).toEqual(["a", "b"]);
    expect([...parse("export class {").own]).toEqual([]);
  });

  it("пакет компилятора, падающий при загрузке, — ошибка, а не «пакета нет»", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "razbor-"));
    try {
      const pkg = path.join(box, "node_modules", "typescript");
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, "package.json"), '{ "main": "index.js" }');
      fs.writeFileSync(path.join(pkg, "index.js"), 'throw new Error("boom");');
      expect(() => compilerAt(box)).toThrow("boom");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

describe("разбор модуля: обе реализации на коде", () => {
  it("на коде посадки и семян одна запись", () => {
    const corpus = [
      ...codeUnder(path.join(ROOT, "src")),
      ...codeUnder(path.join(TOOL_DIR, "..", "seat", "templates", "src")),
    ];
    expect(corpus.length).toBeGreaterThan(0);
    for (const f of corpus) {
      const src = fs.readFileSync(f, "utf8");
      expect(comparable(parseModuleTs(src, ts, f)), f).toEqual(
        comparable(parseModuleRegex(src)),
      );
    }
  });

  it("на модулях обвязки: строки импорта те же, лишнее у регулярных выражений — код в строках", () => {
    const corpus = fs
      .readdirSync(TOOL_DIR)
      .filter((n) => n.endsWith(".mjs"))
      .map((n) => path.join(TOOL_DIR, n));
    let extra = 0;
    for (const f of corpus) {
      const src = fs.readFileSync(f, "utf8");
      const regex = parseModuleRegex(src);
      const compiler = parseModuleTs(src, ts, f);
      expect(compiler.froms, f).toEqual(regex.froms);
      expect(compiler.bare, f).toEqual(regex.bare);
      for (const name of compiler.surface)
        expect(regex.surface.has(name), f + ": " + name).toBe(true);
      // Импорт во время работы компилятор видит только в коде, а образец —
      // и в строках: всё, что видит компилятор, видит и образец.
      const seen = new Set(regex.dynamic.map((d) => d.call + " " + d.spec));
      for (const d of compiler.dynamic)
        expect(seen.has(d.call + " " + d.spec), f + ": " + d.spec).toBe(true);
      const shaped = (one) => one.call + " " + one.prefix + "…" + one.suffix;
      const seenComputed = new Set(regex.computed.map(shaped));
      for (const one of compiler.computed)
        expect(seenComputed.has(shaped(one)), f + ": " + shaped(one)).toBe(true);
      extra += regex.surface.size - compiler.surface.size;
    }
    // Тесты режимов несут код посадки строками: его «экспорты» регулярные
    // выражения и находят. Ноль здесь значил бы, что сверять стало нечего.
    expect(extra).toBeGreaterThan(0);
  });
});
