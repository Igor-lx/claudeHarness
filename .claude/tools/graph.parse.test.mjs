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
    expect(one('export { a as b } from "h";').specifiers).toEqual([
      { there: "a", here: "b", typeOnly: false },
    ]);
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
