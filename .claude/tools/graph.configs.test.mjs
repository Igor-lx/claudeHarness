import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  BY_LOADER,
  BY_TEXT,
  RUNNER_DEFAULT_INCLUDE,
  globMatcher,
  lintOffWritten,
  parseJsonc,
  runnerConfigLoad,
  runnerEffective,
  runnerRank,
  testSectionOf,
  tsconfigRead,
} from "./graph.configs.mjs";
import { compilerAt } from "./graph.parse.mjs";
import { BAR_PAGES_DIR } from "./graph.predicates.mjs";

// Папка внутри пакетов посадки видит её компилятор, сборщик и
// сопоставитель, а git её не видит: тесты в корне посадки, идущие
// параллельно, её конфигов не читают. Папка во временной системы пакетов не
// видит, и ответ идёт запасным путём.
const SEAT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const withPackages = fs.mkdtempSync(
  path.join(SEAT, "node_modules", ".zz-configs-"),
);
const without = fs.mkdtempSync(path.join(os.tmpdir(), "zz-configs-"));
// Пакет лежит только в своём `node_modules`, выше его нет: так видно, что
// пакет ищут от корня проекта, а не от папки над ним.
const TOOL_DIR_OF_TEST = path.dirname(fileURLToPath(import.meta.url));
const own = fs.mkdtempSync(path.join(os.tmpdir(), "zz-configs-own-"));
afterAll(() => {
  for (const root of [withPackages, without, own])
    fs.rmSync(root, { recursive: true, force: true });
});
const put = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

describe("конфиг компилятора — компилятором проекта", () => {
  it("`extends` из пакета даёт его опции; без компилятора — разбор текста без них", () => {
    for (const root of [withPackages, without]) {
      put(
        root,
        "node_modules/@zz/strict/package.json",
        '{"name":"@zz/strict"}',
      );
      put(
        root,
        "node_modules/@zz/strict/tsconfig.json",
        '{"compilerOptions":{"strict":true}}',
      );
      put(root, "src/a.ts", "export const a = 1;\n");
      put(
        root,
        "tsconfig.json",
        '{\n  // проект\n  "extends": "@zz/strict/tsconfig.json",\n  "compilerOptions": {"noEmit": true}\n}\n',
      );
    }
    const loaded = tsconfigRead(
      path.join(withPackages, "tsconfig.json"),
      withPackages,
    );
    expect(loaded.via).toBe(BY_LOADER);
    expect(loaded.options.strict).toBe(true);
    expect(loaded.options.noEmit).toBe(true);
    expect(loaded.raw.compilerOptions).toEqual({ noEmit: true });
    expect(loaded.references).toEqual([]);
    expect(loaded.fileNames).toContain(path.join(withPackages, "src", "a.ts"));
    const text = tsconfigRead(path.join(without, "tsconfig.json"), without);
    expect(text.via).toBe(BY_TEXT);
    expect(text.options.strict).toBeUndefined();
    expect(text.options.noEmit).toBe(true);
  });

  it("папка вместо файла и ссылки на проекты", () => {
    put(
      withPackages,
      "pkg/a/tsconfig.json",
      '{"compilerOptions":{"strict":true}}',
    );
    put(
      withPackages,
      "pkg/tsconfig.json",
      '{"files":[],"references":[{"path":"./a"}]}',
    );
    const got = tsconfigRead(path.join(withPackages, "pkg"), withPackages);
    expect(got.at).toBe(path.join(withPackages, "pkg", "tsconfig.json"));
    expect(got.references).toEqual([
      path.join(withPackages, "pkg", "a", "tsconfig.json"),
    ]);
    expect(
      tsconfigRead(path.join(withPackages, "nothere"), withPackages),
    ).toBeNull();
  });
});

describe("конфиг раннера — сборщиком проекта", () => {
  const CONFIG = `import { defineConfig, mergeConfig } from "vitest/config";
const shared = { setupFiles: ["./lib/setup.ts"] };
export default defineConfig(() =>
  mergeConfig({}, { test: { ...shared, include: ["./lib/**/*.spec.ts"] } }),
);
`;

  it("функция конфига и слияние вычислены, как их вычислит раннер", async () => {
    put(withPackages, "runner/vite.config.mjs", CONFIG);
    const got = await runnerConfigLoad(
      path.join(withPackages, "runner", "vite.config.mjs"),
      withPackages,
    );
    expect(got.via).toBe(BY_LOADER);
    expect(got.test.include).toEqual(["./lib/**/*.spec.ts"]);
    expect(got.test.setupFiles).toEqual(["./lib/setup.ts"]);
    expect(typeof got.text).toBe("string");
  });

  it("функции конфига переданы команда и режим раннера", async () => {
    put(
      withPackages,
      "mode/vite.config.mjs",
      "export default ({ command, mode }) => ({ test: { include: [command + '-' + mode] } });\n",
    );
    const got = await runnerConfigLoad(
      path.join(withPackages, "mode", "vite.config.mjs"),
      withPackages,
    );
    expect(got.test.include).toEqual(["serve-test"]);
  });

  it("сборщика нет — разбор текста, и секция без пробела узнаётся", async () => {
    put(
      without,
      "vite.config.ts",
      'export default {\n  test:{ include: ["src/**/*.test.ts"], setupFiles: "./src/setup.ts", globals: true },\n};\n',
    );
    const got = await runnerConfigLoad(
      path.join(without, "vite.config.ts"),
      without,
    );
    expect(got.via).toBe(BY_TEXT);
    expect(got.broke).toBeUndefined();
    expect(got.test).toEqual({
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/setup.ts"],
      globals: true,
    });
    expect(
      await runnerConfigLoad(path.join(without, "nothere.ts"), without),
    ).toBeNull();
  });

  it("конфиг, который сборщик не загрузил, назван и прочитан текстом", async () => {
    put(
      withPackages,
      "broken/vite.config.mjs",
      'import "zz-no-such-plugin";\nexport default { test: { include: ["a/**"] } };\n',
    );
    const got = await runnerConfigLoad(
      path.join(withPackages, "broken", "vite.config.mjs"),
      withPackages,
    );
    expect(got.broke).toMatch(/zz-no-such-plugin/);
    expect(got.via).toBe(BY_TEXT);
    expect(got.test.include).toEqual(["a/**"]);
  });
});

describe("образцы путей — сопоставителем раннера", () => {
  it("образец по умолчанию, точка в начале, исключение", () => {
    const m = globMatcher(RUNNER_DEFAULT_INCLUDE, withPackages);
    expect(m.via).toBe(BY_LOADER);
    expect(m("src/a/b.test.tsx")).toBe(true);
    expect(m("src/a/b.spec.mts")).toBe(true);
    expect(m("src/a/b.ts")).toBe(false);
    const dot = globMatcher(["./src/**/*.ts", "!src/skip/**"], withPackages);
    expect(dot("src/x/y.ts")).toBe(true);
    expect(dot("src/skip/y.ts")).toBe(false);
    expect(dot("lib/y.ts")).toBe(false);
    expect(globMatcher(["././src/**"], withPackages)("src/a.ts")).toBe(true);
  });

  it("пакет проекта ищется от его корня", () => {
    put(
      own,
      "node_modules/picomatch/package.json",
      '{"name":"picomatch","main":"index.js"}',
    );
    put(
      own,
      "node_modules/picomatch/index.js",
      "module.exports = (list) => (f) => list.includes(f);\n",
    );
    const m = globMatcher(["a.ts"], own);
    expect(m.via).toBe(BY_LOADER);
    expect(m("a.ts")).toBe(true);
    expect(BY_LOADER).toBeTruthy();
    expect(BY_TEXT).toBeTruthy();
  });

  it("без сопоставителя — запасной разбор звёзд и перечня", () => {
    const m = globMatcher(["./src/**/*.test.{ts,tsx}", "!src/old/**"], without);
    expect(m.via).toBe(BY_TEXT);
    expect(m("src/a/b.test.tsx")).toBe(true);
    expect(m("src/old/b.test.ts")).toBe(false);
    expect(m("lib/b.test.ts")).toBe(false);
  });
});

describe("один читатель на конфиг проекта", () => {
  // Имя конфига в коде, который читает диск проекта, — второй читатель
  // предмета: списки имён расходились с картой посадки, а разбор текста — с
  // загрузчиком проекта. Имена берут из карты, читают модулем конфигов.
  const CONFIG_NAME =
    /^\.?(?:tsconfig|jsconfig|vite|vitest|eslint|stryker|prettier|jest|babel)(?:\.[\w-]+)*\.(?:json5?|[cm]?[jt]s|ya?ml|toml)$|^\.(?:eslintrc|prettierrc)$/;
  // Разбором, а не сканером: сканер без разбора читает косую регулярного
  // выражения делением, кавычку внутри него — началом строки и сбивается.
  const literalsOf = (ts, text) => {
    const out = [];
    const walk = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        out.push(node.text);
      ts.forEachChild(node, walk);
    };
    walk(ts.createSourceFile("one.mjs", text, ts.ScriptTarget.Latest, false));
    return out;
  };
  const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
  const readersOfDisk = () =>
    fs
      .readdirSync(TOOL_DIR)
      .filter(
        (n) =>
          n.endsWith(".mjs") &&
          !n.endsWith(".test.mjs") &&
          n !== "graph.configs.mjs",
      )
      .map((n) => [n, fs.readFileSync(path.join(TOOL_DIR, n), "utf8")])
      .filter(([, text]) => /from "node:fs"/.test(text));

  it("в коде, читающем диск, имён конфигов нет — кроме модуля конфигов", () => {
    const ts = compilerAt(SEAT);
    const found = readersOfDisk().flatMap(([n, text]) =>
      literalsOf(ts, text)
        .filter((one) => CONFIG_NAME.test(one))
        .map((one) => n + ": " + one),
    );
    expect(found).toEqual([]);
  });

  it("страж узнаёт имя конфига в строке и не путает с комментарием", () => {
    const ts = compilerAt(SEAT);
    const got = literalsOf(
      ts,
      '// "eslint.config.js"\nconst a = ["eslint.config.js", `stryker.conf.mjs`, ".eslintrc", "src/a.ts"];',
    ).filter((one) => CONFIG_NAME.test(one));
    expect(got).toEqual(["eslint.config.js", "stryker.conf.mjs", ".eslintrc"]);
  });
});

describe("служебные папки инструмента — в каждом семени исключений", () => {
  // Список служебных папок один — `OUT_OF_TREE` инструмента; семена
  // исключений держат каждое свою копию, и `.prettierignore` разошёлся с
  // ним: форматтер проекта проверял песочницу фальсификации.
  it("`.gitignore`, `.prettierignore` и конфиг линта называют каждую", () => {
    const ts = compilerAt(SEAT);
    const source = fs.readFileSync(
      path.join(TOOL_DIR_OF_TEST, "graph.mjs"),
      "utf8",
    );
    const sf = ts.createSourceFile(
      "graph.mjs",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    let names = null;
    // Папка, которую называет константа словаря, стоит в списке её именем.
    const named = { BAR_PAGES_DIR };
    const walk = (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        n.name.getText(sf) === "OUT_OF_TREE" &&
        n.initializer !== undefined &&
        ts.isNewExpression(n.initializer)
      )
        names = n.initializer.arguments[0].elements.map((e) =>
          ts.isIdentifier(e) ? named[e.text] : e.text,
        );
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(names).toContain(".проба-сверок");
    expect(names).toContain(BAR_PAGES_DIR);
    // `.git` исключает сам git, а прочие инструменты его не обходят.
    const wanted = names.filter((one) => one !== ".git");
    const seed = (name) =>
      fs.readFileSync(
        path.join(TOOL_DIR_OF_TEST, "..", "seat", "templates", name),
        "utf8",
      );
    const lines = (text) => text.split("\n").map((one) => one.trim());
    const missing = [];
    for (const name of [".gitignore", ".prettierignore"])
      for (const one of wanted)
        if (!lines(seed(name)).includes(one)) missing.push(name + ": " + one);
    const lint = seed("eslint.config.mjs");
    for (const one of wanted)
      if (!lint.includes('"**/' + one + '/**"'))
        missing.push("eslint.config.mjs: " + one);
    expect(missing).toEqual([]);
  });
});

describe("выключения линта, написанные автором", () => {
  it("кавычки любые, ключ без кавычек, массив; ноль в опциях — не выключение", () => {
    const text = [
      "export default [",
      "  {",
      '    files: ["src/**", \'tests/**\'],',
      "    rules: {",
      "      'a/one': 'off',",
      '      curly: ["off"],',
      '      "max-lines": ["error", { max: 0 }],',
      "    },",
      "  },",
      '  { rules: { "b-two": "off" } },',
      "];",
    ].join("\n");
    expect(
      lintOffWritten(
        [
          "{",
          '  files:["x/**"],',
          '  rules: { "tight":"off", \'spaced\' : \'off\', wide: [ "off" ] },',
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      { scope: "x/**", rule: "tight" },
      { scope: "x/**", rule: "spaced" },
      { scope: "x/**", rule: "wide" },
    ]);
    // Длинный массив форматтер переносит на строки: область та же.
    expect(
      lintOffWritten(
        ["{", "  files: [", '    "x/**",', "  ],", '  rules: { tight: "off" },', "}"].join(
          "\n",
        ),
      ),
    ).toEqual([{ scope: "x/**", rule: "tight" }]);
    expect(lintOffWritten(text)).toEqual([
      { scope: "src/**", rule: "a/one" },
      { scope: "tests/**", rule: "a/one" },
      { scope: "src/**", rule: "curly" },
      { scope: "tests/**", rule: "curly" },
      { scope: "**", rule: "b-two" },
    ]);
  });
});

describe("запасной разбор текста — написания, ради которых он есть", () => {
  it("JSON с комментариями: строки с `//` и `/*`, экранированная кавычка", () => {
    const cases = [
      ['{"a": 1}', { a: 1 }],
      ['{\n  // c\n  "a": 1\n}', { a: 1 }],
      ['{ /* c */ "a": 1 }', { a: 1 }],
      [
        '{ "u": "http://x/*y*/", "a": 1 } // tail',
        { u: "http://x/*y*/", a: 1 },
      ],
      [
        '{ "q": "say \\"hi\\" // not", "a": 1 } /* x */',
        { q: 'say "hi" // not', a: 1 },
      ],
      ['{ "a": 1 } /* never closed', { a: 1 }],
      ['{ "q": "x \\" // y", "a": 1 } /* c */', { q: 'x " // y', a: 1 }],
      ['{ /*/ inner */ "a": 1 }', { a: 1 }],
      ["{ broken", null],
    ];
    for (const [raw, want] of cases) expect(parseJsonc(raw), raw).toEqual(want);
  });

  it("конфиг компилятора: `extends` цепочкой, без `.json`, массивом и по кругу", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zz-configs-tc-"));
    try {
      put(
        root,
        "base.json",
        '{"compilerOptions":{"strict":true,"noEmit":true}}',
      );
      put(
        root,
        "mid.json",
        '{"extends":"./base","compilerOptions":{"noEmit":false}}',
      );
      put(root, "loop.json", '{"extends":"./tsconfig.json"}');
      put(root, "extra.json", '{"compilerOptions":{"noUnusedLocals":true}}');
      put(root, "pkg/x.json", '{"compilerOptions":{"noImplicitAny":true}}');
      put(
        root,
        "tsconfig.json",
        '{"extends":["./mid","pkg/x","./loop.json","./extra.json"],"compilerOptions":{"baseUrl":"./src","paths":{"~/*":["./*"]}},"references":[{"path":"./sub"}]}',
      );
      fs.mkdirSync(path.join(root, "sub"));
      put(root, "bad/tsconfig.json", "{ not json");
      const got = tsconfigRead(path.join(root, "tsconfig.json"), root);
      expect(got.via).toBe(BY_TEXT);
      expect(got.options.strict).toBe(true);
      expect(got.options.noEmit).toBe(false);
      expect(got.options.noUnusedLocals).toBe(true);
      expect(got.options.noImplicitAny).toBeUndefined();
      expect(got.options.baseUrl).toBe(path.join(root, "src"));
      expect(got.options.pathsBasePath).toBe(root);
      expect(got.references).toEqual([path.join(root, "sub", "tsconfig.json")]);
      expect(tsconfigRead(path.join(root, "bad"), root)).toBeNull();
      const plain = tsconfigRead(path.join(root, "base.json"), root);
      expect(plain.options).toEqual({ strict: true, noEmit: true });
      expect(plain.options.pathsBasePath).toBeUndefined();
      expect(plain.references).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("конфиг раннера: область покрытия не принимается за область сбора", async () => {
    const at = (name, text) => {
      put(without, name, text);
      return runnerConfigLoad(path.join(without, name), without);
    };
    const got = await at(
      "cov.config.ts",
      'export default { test: {\n  coverage: { include: ["src/**"] },\n  setupFiles: ["./a.ts", "./b.ts"],\n  globals:true,\n} };\n',
    );
    expect(got.test).toStrictEqual({
      setupFiles: ["./a.ts", "./b.ts"],
      globals: true,
    });
    const after = await at(
      "after.config.ts",
      'export default { test: {\n  coverage: { include: ["x/**"], reporter: { a: 1 } },\n  include: ["lib/**"],\n  setupFiles:["./s.ts"],\n} };\n',
    );
    expect(after.test).toStrictEqual({
      include: ["lib/**"],
      setupFiles: ["./s.ts"],
    });
    const both = await at(
      "both.config.ts",
      'export default { test: {\n  include: [],\n  include:  ["lib/**"],\n  coverage : { include: ["x/**"] },\n} };\n',
    );
    expect(both.test).toEqual({ include: ["lib/**"] });
    const none = await at("none.config.ts", "export default { build: {} };\n");
    expect(none.test).toBeNull();
    expect(typeof none.text).toBe("string");
  });

  it("образцы путей: `**` без косой, одиночная звезда, перечень, спецсимволы", () => {
    const m = (globs, file) => globMatcher(globs, without)(file);
    expect(m(["src/**"], "src/a/b.ts")).toBe(true);
    expect(m(["src/*.ts"], "src/a.ts")).toBe(true);
    expect(m(["src/*.ts"], "src/a/b.ts")).toBe(false);
    expect(m(["src/**/x.ts"], "src/x.ts")).toBe(true);
    expect(m(["src/**/x.ts"], "src/a/b/x.ts")).toBe(true);
    expect(m(["src/**x.ts"], "src/a/bx.ts")).toBe(true);
    expect(m(["a.{js,ts}"], "a.ts")).toBe(true);
    expect(m(["a.{js,ts}"], "a.css")).toBe(false);
    expect(m(["a.{js,ts}"], "a.js")).toBe(true);
    expect(m(["**/*.ts"], "a/b.ts")).toBe(true);
    expect(m(["**/*.ts"], "b.ts")).toBe(true);
    expect(m(["././src/**"], "src/a.ts")).toBe(true);
    expect(m(["a+b.ts"], "a+b.ts")).toBe(true);
    expect(m(["a+b.ts"], "aab.ts")).toBe(false);
    expect(m(["a.ts"], "aXts")).toBe(false);
    expect(m(["{x"], "{x")).toBe(true);
    expect(m(["lib/**", "src/**"], "src/a.ts")).toBe(true);
    expect(m(["src/a.ts"], "src/a.ts.bak")).toBe(false);
  });
});

describe("секция тестов в тексте конфига", () => {
  it("узнаётся в начале, в кавычках и с пробелом перед двоеточием", () => {
    for (const body of [
      "test: { a: 1 }",
      'x = { "test": { a: 1 } }',
      "x = { 'test' : { a: 1 } }",
      "x = {test:{ a: 1 } }",
    ])
      expect(testSectionOf(body)).toMatch(/^\W?["']?test["']?\s*:/);
    expect(testSectionOf("x = { contest: { a: 1 } }")).toBeNull();
    expect(testSectionOf("x = { other: 1 }")).toBeNull();
  });
});

describe("действующий конфиг раннера", () => {
  it("старшинство — порядок, в котором конфиг ищет сам раннер", () => {
    const order = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
    const names = ["vitest.config", "vite.config"].flatMap((n) =>
      order.map((ext) => n + ext),
    );
    expect(
      [...names].reverse().sort((a, b) => runnerRank(a) - runnerRank(b)),
    ).toEqual(names);
    for (const other of ["foo.config.ts", "vitest.config.json", "vitest.ts"])
      expect(runnerRank(other)).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      runnerEffective([{ name: "vite.config.ts" }, { name: "vitest.config.mts" }])
        .name,
    ).toBe("vitest.config.mts");
    expect(runnerEffective([])).toBeUndefined();
  });
});
