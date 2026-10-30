import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  envLowOf,
  factsWithBaseline,
  inPlaceKindOf,
  layShelfLive,
  lintBlockersOf,
  mergedLines,
  testCountsOf,
  tiersFrom,
  withoutFrameRows,
  sandboxPackages,
  peerConflictsOf,
  projectFilesOf,
  rangeAllows,
  stackApply,
  stackSurveyOf,
  workspaceManifestsOf,
  eslintBoundaryOf,
} from "./graph.seat.mjs";
import { OUT_OF_TREE } from "./graph.predicates.mjs";

// Посадка на месте одной командой: полка лежит в `.claude` папки, режим
// делает фазу 1 целиком (решение разработчика Р1, `2026-10-20`). Чистые
// половины — здесь же, режим целиком — во временных папках, пакеты ссылкой
// на пакеты посадки, где идёт набор.

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHELF = path.join(TOOL_DIR, "..");
const ROOT = path.join(SHELF, "..");
delete process.env.CLAUDE_CODE_CHILD_SESSION;

const OWN_IN_HARNESS = new Set(
  JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "map.json"), "utf8"))
    .projectOwnedInsideHarness ?? [],
);

/** Папка с одной полкой — так её оставляет копирование снимка. */
const boxWithShelf = (prefix) => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(SHELF, path.join(dest, ".claude"), {
    recursive: true,
    filter: (src) =>
      !(path.dirname(src) === SHELF && OWN_IN_HARNESS.has(path.basename(src))),
  });
  return dest;
};
const seatHere = (dest, ...rest) =>
  spawnSync(
    process.execPath,
    [path.join(dest, ".claude", "tools", "graph.mjs"), "seat", dest, ...rest],
    { cwd: dest, encoding: "utf8" },
  );
/** Ответ подставного раннера той же формы, что у `runTool`. */
const ran = (status, stdout, stderr) => ({ status, stdout, stderr, out: stdout + stderr, error: null });
const gitIn = (dest, ...args) =>
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@local", ...args],
    { cwd: dest, encoding: "utf8" },
  ).trim();

describe("посадка на месте: что лежит рядом с полкой", () => {
  const read = (files) => (rel) => files[rel] ?? null;
  const viteReadme = "# React + TypeScript + Vite\n\nThis template provides…\n";
  const viteApp = "<p>Edit <code>src/App.tsx</code> and save to test HMR</p>\n";

  it("пусто и служебный мусор файлового менеджера — пустая папка", () => {
    expect(inPlaceKindOf([], read({}), 0).kind).toBe("пусто");
    expect(inPlaceKindOf([".DS_Store"], read({}), 0).kind).toBe("пусто");
  });

  it("описание, лицензия и список исключений git — витрина хостинга", () => {
    const kind = inPlaceKindOf(["README.md", "LICENSE", ".gitignore"], read({}), 1);
    expect(kind.kind).toBe("витрина");
  });

  it("свежий шаблон — по трём признакам сразу, и его файлы названы к удалению", () => {
    const entries = ["README.md", "src", "package.json", "index.html", ".oxlintrc.json"];
    const files = { "README.md": viteReadme, "src/App.tsx": viteApp };
    const kind = inPlaceKindOf(entries, read(files), 1);
    expect(kind.kind).toBe("шаблон");
    expect(kind.remove).toEqual([...entries].sort());
    expect(inPlaceKindOf(entries, read(files), 2).kind).toBe("живой");
    expect(
      inPlaceKindOf(entries, read({ ...files, "src/App.tsx": "own app\n" }), 0).kind,
    ).toBe("живой");
    expect(
      inPlaceKindOf(entries, read({ ...files, "README.md": "# Shop\n" }), 0).kind,
    ).toBe("живой");
  });

  it("полный ответ у пустой папки, витрины и шаблона; мусор всех трёх систем — не содержимое", () => {
    expect(inPlaceKindOf(["Thumbs.db", "desktop.ini"], read({}), 0)).toEqual({
      kind: "пусто",
      remove: [],
      extra: [],
    });
    expect(inPlaceKindOf(["README", "LICENSE.md", ".gitignore"], read({}), 1)).toEqual({
      kind: "витрина",
      remove: [],
      extra: [],
    });
    const files = { "README.md": viteReadme, "src/App.tsx": viteApp };
    expect(inPlaceKindOf(["README.md", "src"], read(files), 0)).toEqual({
      kind: "шаблон",
      remove: ["README.md", "src"],
      extra: [],
    });
  });

  it("имя, похожее на имя витрины или шаблона, — чужой файл, а не их", () => {
    for (const near of ["xreadme.md", "readme.md.bak", "xlicense", "license.txt.old", "x.gitignore", ".gitignore.bak"])
      expect(inPlaceKindOf([near], read({}), 0).kind, near).toBe("живой");
    const files = { "README.md": viteReadme, "src/App.tsx": viteApp };
    const base = ["README.md", "src"];
    const whole = [
      ".gitignore", ".oxlintrc.json", "README.md", "eslint.config.js", "index.html", "node_modules",
      "package-lock.json", "package.json", "public", "src", "tsconfig.app.json", "tsconfig.json",
      "tsconfig.node.json", "vite.config.ts",
    ];
    expect(inPlaceKindOf(whole, read(files), 1)).toEqual({ kind: "шаблон", remove: whole, extra: [] });
    for (const near of [
      "xindex.html", "index.html.bak", "xpackage.json", "package.json.bak", "xnode_modules",
      "node_modules2", "xtsconfig.json", "tsconfig.json.bak", "tsconfig.app.json.old", "xvite.config.ts",
      "vite.config.ts.bak", "x.oxlintrc.json", ".oxlintrc.json.bak", "xeslint.config.js",
      "eslint.config.js.bak", "x.gitignore", ".gitignore.bak", "xREADME.md", "README.md.bak",
      "xpublic", "public2", "xsrc", "src2",
    ])
      expect(inPlaceKindOf([...base, near], read(files), 0).kind, near).toBe("живой");
  });

  it("первая строка описания шаблона — с концом строки Windows и без файла компонента", () => {
    const crlf = { "README.md": "# React + TypeScript + Vite\r\n", "src/App.tsx": viteApp };
    expect(inPlaceKindOf(["README.md", "src"], read(crlf), 0).kind).toBe("шаблон");
    expect(inPlaceKindOf(["README.md", "src"], read({ "README.md": viteReadme }), 0).kind).toBe(
      "живой",
    );
  });

  it("шаблон со своим файлом рядом и свой код — живой проект, и лишнее названо", () => {
    const files = { "README.md": viteReadme, "src/App.tsx": viteApp };
    const kind = inPlaceKindOf(["README.md", "src", "server"], read(files), 0);
    expect(kind).toEqual({ kind: "живой", remove: [], extra: ["README.md", "server", "src"] });
    expect(inPlaceKindOf(["src"], read({}), 0).extra).toEqual(["src"]);
  });
});

describe("посадка на месте: чистые помощники", () => {
  it("список исключений: свои строки первыми, недостающие строки семени дописаны один раз", () => {
    expect(mergedLines("secret.env\n", "# why\nnode_modules\nsecret.env\n")).toBe(
      "secret.env\n# why\nnode_modules\n",
    );
    expect(mergedLines("a", "b\n")).toBe("a\nb\n");
    expect(mergedLines("a\nb\n", "b\na\n")).toBe("a\nb\n");
    expect(mergedLines("", "a\n")).toBe("a\n");
    expect(mergedLines("a", "   \nb\n")).toBe("a\nb\n");
    expect(mergedLines("node_modules \n", "node_modules\r\n dist\n")).toBe("node_modules \n dist\n");
  });

  it("число тестов и файлов берётся из итога раннера; нет итога — null", () => {
    const out = " Test Files  2 passed (2)\n      Tests  7 passed (7)\n";
    expect(testCountsOf(out)).toEqual({ tests: 7, files: 2 });
    expect(testCountsOf("No test files found")).toBe(null);
    expect(testCountsOf("      Tests  12 passed (12)\n")).toBe(null);
    expect(testCountsOf(" Test Files  3 passed (3)\n")).toBe(null);
    const noisy = "x Tests  9 passed, x Test Files  8 passed\n  Test Files  13 passed (13)\n      Tests  27 passed (27)\n";
    expect(testCountsOf(noisy)).toEqual({ tests: 27, files: 13 });
    // Так `vitest` печатает на Windows и без терминала.
    const colored =
      "\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m\n" +
      "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m\u001b[90m (5)\u001b[39m\n";
    expect(testCountsOf(colored)).toEqual({ tests: 5, files: 2 });
  });

  it("порядок цены по классу читается и в одно, и в два слова", () => {
    const out = [
      "    577  сотни           Где что лежит, что уже решено — карта кода целиком",
      "  57278  десятки тысяч   Удаление узла или возможности — полный вход",
    ].join("\n");
    expect([...tiersFrom(out)]).toEqual([
      ["Где что лежит, что уже решено", "сотни"],
      ["Удаление узла или возможности", "десятки тысяч"],
    ]);
  });

  it("базовая линия встаёт на место пометок пустоты, цена — в каждую клетку замера", () => {
    const seed = fs.readFileSync(path.join(SHELF, "seat", "templates", "01-facts.md"), "utf8");
    const classes = [...seed.matchAll(/^\| ([^|]+?) \| <замер> \|$/gm)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(0);
    const tiers = new Map(classes.map((c) => [c, "сотни"]));
    const rows = [{ name: "test", result: "зелено, тестов `7` в файлах `2`", how: "npm test" }];
    const facts = factsWithBaseline(seed, rows, tiers, "2026-10-20");
    expect(facts).toContain(
      "## Базовая линия\n\n| Звено | Исход | Чем получено |\n| --- | --- | --- |\n| `test` | зелено, тестов `7` в файлах `2` | `npm test` |\n\n",
    );
    expect(facts.split("## Базовая линия")).toHaveLength(2);
    expect(facts.split("<!-- ПУСТО -->").length).toBe(seed.split("<!-- ПУСТО -->").length - 1);
    expect(facts).not.toContain("<замер>");
    expect(facts.split("\n")).toContain(
      "| " + classes[0] + " | `сотни`, замер `2026-10-20` командой `graph.mjs tiers` |",
    );
    expect(() => factsWithBaseline(seed, rows, new Map(), "2026-10-20")).toThrow(
      "режим ярусов не назвал класс",
    );
    for (const broken of [
      "# Факты\n",
      "## Базовая линия\n\nбез пометок\n",
      "## Базовая линия\n\n<!-- ПУСТО -->\nбез закрытия\n",
      "## Базовая линия\n\n<!-- /ПУСТО -->\nбез открытия\n",
      "<!-- ПУСТО -->\nбез заголовка\n<!-- /ПУСТО -->\n",
    ])
      expect(() => factsWithBaseline(broken, rows, tiers, "2026-10-20"), broken).toThrow(
        "места под базовую линию",
      );
  });

  it("место базовой линии ищется под её заголовком, а цена — только в строке таблицы из двух граф", () => {
    const rows = [{ name: "lint", result: "зелено", how: "npm run lint" }];
    const text = [
      "## Базовая линия",
      "",
      "<!-- ПУСТО -->",
      "место",
      "<!-- /ПУСТО -->",
      "",
      "| Класс | <замер> |",
      "| Класс   | <замер> |",
      "x| Класс | <замер> |",
      "| Класс | <замер> | третья |",
      "",
    ].join("\n");
    const facts = factsWithBaseline(text, rows, new Map([["Класс", "тысячи"]]), "2026-10-20");
    expect(facts.split("\n").slice(0, 4)).toEqual([
      "## Базовая линия",
      "",
      "| Звено | Исход | Чем получено |",
      "| --- | --- | --- |",
    ]);
    expect(facts).toContain("| Класс | `тысячи`, замер `2026-10-20` командой `graph.mjs tiers` |\n");
    expect(facts).toContain("| Класс   | `тысячи`, замер");
    expect(facts).toContain("x| Класс | <замер> |");
    expect(facts).toContain("| Класс | <замер> | третья |");
    const padded = "## Базовая линия\n<!-- ПУСТО -->\n<!-- /ПУСТО -->\n| Класс   | <замер> |\n";
    expect(() => factsWithBaseline(padded, rows, new Map(), "d")).toThrow(/класс: Класс$/);
    const earlier = "## Прочее\n\n<!-- ПУСТО -->\nчужое\n<!-- /ПУСТО -->\n\n" + text;
    expect(factsWithBaseline(earlier, rows, new Map([["Класс", "тысячи"]]), "d")).toContain(
      "<!-- ПУСТО -->\nчужое",
    );
  });

  it("среда ниже связки названа с загрузчиком посадки; молчащая — «не отвечает»", () => {
    const declared = { node: "22.23.2", npm: "11.0.0" };
    const at = (have) => (name) => have[name] ?? null;
    expect(envLowOf(declared, at({ node: "22.23.2", npm: "11.2.0" }))).toEqual({
      seen: ["node 22.23.2 (нужно 22.23.2)", "npm 11.2.0 (нужно 11.0.0)"],
      low: [],
    });
    const { low } = envLowOf(declared, at({ node: "22.22.0", npm: "10.9.4" }));
    expect(low).toEqual([
      { name: "node", have: "22.22.0", need: "22.23.2", how: "bash .claude/seat/bootstrap.sh" },
      { name: "npm", have: "10.9.4", need: "11.0.0", how: "bash .claude/seat/bootstrap.sh" },
    ]);
    expect(envLowOf(declared, at({ node: "22.23.2" })).low).toEqual([
      { name: "npm", have: "не отвечает", need: "11.0.0", how: "bash .claude/seat/bootstrap.sh" },
    ]);
    expect(envLowOf({ node: "22.23.2" }, at({ node: "22.23.2" })).low).toEqual([]);
  });

  it("линт обвязки не встаёт на TypeScript новее связки по второй части и на oxlint", () => {
    const declared = { typescript: "6.0.3" };
    const of = (deps) => lintBlockersOf({ devDependencies: deps }, declared);
    expect(of({ typescript: "~6.0.3" })).toEqual([]);
    expect(of({ typescript: "^6.0.9" })).toEqual([]);
    expect(of({ typescript: "latest" })).toEqual([]);
    expect(of({ typescript: "6.1.0" })).toHaveLength(1);
    expect(of({ typescript: "7" })).toHaveLength(1);
    expect(of({ typescript: "~7.0.2" })).toEqual([
      "TypeScript ~7.0.2 новее проверенного 6.0.3: правила линта обвязки его не принимают",
    ]);
    expect(of({ oxlint: "^1.0.0" })).toEqual([
      "линтер проекта — oxlint: конфиг линта обвязки ему не читается",
    ]);
    expect(of({})).toEqual([]);
    expect(lintBlockersOf({ dependencies: { typescript: "~7.0.2" } }, {})).toEqual([]);
  });
});

describe("осмотр окружения проекта по осям карты посадки", () => {
  const AXES = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "map.json"), "utf8")).stackAxes;
  const SEED = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "templates", "package.json"), "utf8"));
  const OURS = { ...SEED.dependencies, ...SEED.devDependencies };
  const PLATFORM = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "map.json"), "utf8")).platformPackages;
  const survey = (manifest, files, withTools = []) =>
    stackSurveyOf({
      manifest,
      files,
      axes: AXES,
      verified: OURS,
      withTools,
      ui: PLATFORM.ui,
      alternatives: PLATFORM.alternatives,
    });
  const planOf = (s) => Object.fromEntries(s.plan.map((p) => [p.name, p]));

  it("предшественник пакета оси в корне и в пакете — план снимает его, установка удаляет из манифестов", () => {
    // Выведено одиннадцатой посадкой: `@typescript-eslint/*` `7` держат пиром
    // ESLint `8`, и `--apply` с ESLint `10` падал на конфликте.
    const old = { eslint: "^8.57.0", "@typescript-eslint/parser": "^7.18.0", "@typescript-eslint/eslint-plugin": "^7.18.0" };
    const app = { name: "app", devDependencies: { "@typescript-eslint/parser": "^7.18.0" } };
    const s = stackSurveyOf({
      manifest: { devDependencies: { ...OURS, ...old } },
      files: ["src/main.tsx"],
      axes: AXES,
      verified: OURS,
      ui: PLATFORM.ui,
      alternatives: PLATFORM.alternatives,
      workspaces: [{ at: "packages/app/package.json", manifest: app }],
    });
    const removed = s.plan.filter((one) => one.to === null);
    expect(removed).toEqual([
      { name: "@typescript-eslint/parser", from: "^7.18.0", to: null, section: "devDependencies" },
      { name: "@typescript-eslint/parser", from: "^7.18.0", to: null, section: "devDependencies", at: "packages/app/package.json" },
      { name: "@typescript-eslint/eslint-plugin", from: "^7.18.0", to: null, section: "devDependencies" },
    ]);
    expect(s.verdict).toBe("наше, неполное");
    expect(s.rows.find((r) => r.axis === "линтер").note).toContain("@typescript-eslint/parser ^7.18.0 → снять");
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-predecessor-"));
    try {
      fs.mkdirSync(path.join(dest, "packages", "app"), { recursive: true });
      fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ devDependencies: { ...OURS, ...old } }));
      fs.writeFileSync(path.join(dest, "packages", "app", "package.json"), JSON.stringify(app));
      expect(stackApply(dest, s, {}, () => ran(0, "", "")).ok).toBe(true);
      const root = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).devDependencies;
      const pkg = JSON.parse(fs.readFileSync(path.join(dest, "packages", "app", "package.json"), "utf8")).devDependencies;
      expect(Object.keys(root).filter((one) => one.startsWith("@typescript-eslint/"))).toEqual([]);
      expect(root.eslint).toBe(OURS.eslint);
      expect(pkg).toEqual({});
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("пустая папка — «пусто», плана нет: посадка ставит всё сама", () => {
    const s = survey(null, []);
    expect(s.verdict).toBe("пусто");
    expect(s.plan).toEqual([]);
    expect(survey(null, ["README.md"]).verdict).toBe("пусто");
  });

  it("наше окружение без звеньев и ниже связки — «наше, неполное», план поднимает до точных версий связки", () => {
    const s = survey(
      {
        dependencies: { react: "^19.1.0", "react-dom": "^19.1.0", zod: "^4.1.12" },
        devDependencies: { typescript: "~5.8.3", vite: "^7.0.4", "@vitejs/plugin-react": "^4.6.0" },
      },
      ["src/main.tsx", "src/app/app.module.scss", "vite.config.ts"],
    );
    expect(s.verdict).toBe("наше, неполное");
    expect(s.foreign).toEqual([]);
    const plan = planOf(s);
    expect(plan.typescript).toEqual({ name: "typescript", from: "~5.8.3", to: OURS.typescript, section: "devDependencies" });
    expect(plan.react).toEqual({ name: "react", from: "^19.1.0", to: OURS.react, section: "dependencies" });
    expect(plan["@vitejs/plugin-react"].to).toBe(OURS["@vitejs/plugin-react"]);
    for (const absent of ["vitest", "eslint", "prettier", "@stryker-mutator/core", "sass-embedded"])
      expect(plan[absent], absent).toMatchObject({ from: null, to: OURS[absent], section: "devDependencies" });
    expect(plan.zod).toBeUndefined();
  });

  it("версия выше связки опускается до неё, точная версия связки в план не идёт, полная связка — «наше»", () => {
    const above = survey({ devDependencies: { ...OURS, typescript: "7.0.2" } }, ["src/main.tsx", "a.scss"]);
    expect(above.plan).toEqual([
      { name: "typescript", from: "7.0.2", to: OURS.typescript, section: "devDependencies" },
    ]);
    const exact = survey({ dependencies: SEED.dependencies, devDependencies: SEED.devDependencies }, ["src/main.tsx"]);
    expect(exact.plan).toEqual([]);
    expect(exact.verdict).toBe("наше");
  });

  it("объявленная замена пакета платформы — наше: плагин на SWC не тянет обычный", () => {
    const swc = survey({ devDependencies: { "@vitejs/plugin-react-swc": "^4.0.0", vite: OURS.vite } }, ["src/main.tsx"]);
    expect(planOf(swc)["@vitejs/plugin-react"]).toBeUndefined();
    expect(swc.rows.find((r) => r.axis === "сборщик").note).toContain("@vitejs/plugin-react-swc — объявленная замена");
  });

  it("листов стилей нет — sass не ставится; объявленная замена sass — наше", () => {
    expect(planOf(survey({ devDependencies: { typescript: "6.0.3" } }, ["src/main.tsx"]))["sass-embedded"]).toBeUndefined();
    const withSass = survey({ devDependencies: { sass: "^1.80.0" } }, ["src/main.tsx", "src/a.scss"]);
    expect(planOf(withSass)["sass-embedded"]).toBeUndefined();
    expect(withSass.rows.find((r) => r.axis === "листы стилей").state).toBe("наше");
  });

  it("без интерфейса фреймворк и сборщик без предмета; одноранговый react не ставится", () => {
    const lib = survey({ devDependencies: { typescript: "6.0.3" } }, ["src/index.ts"]);
    expect(planOf(lib).react).toBeUndefined();
    expect(planOf(lib).vite).toBeUndefined();
    expect(lib.rows.find((r) => r.axis === "фреймворк").state).toBe("без предмета");
    const peer = survey({ peerDependencies: { react: "^19.0.0" } }, ["src/index.tsx"]);
    expect(planOf(peer).react).toBeUndefined();
    expect(planOf(peer)["@types/react"].from).toBeNull();
  });

  it("Vue и yarn — «чужое» по двум осям, посадка не встаёт; ось-инструмент заменяется своей по слову", () => {
    const s = survey({ dependencies: { vue: "^3.5.0" }, devDependencies: { oxlint: "^1.0.0" } }, [
      "src/App.vue",
      "src/main.ts",
      "yarn.lock",
    ]);
    expect(s.verdict).toBe("чужое");
    expect(s.foreign.map((f) => f.axis).sort()).toEqual(["линтер", "менеджер пакетов", "фреймворк"].sort());
    expect(s.foreign.find((f) => f.axis === "линтер").tool).toBe("lint");
    expect(s.foreign.find((f) => f.axis === "фреймворк").tool).toBeNull();
    expect(planOf(s).eslint).toBeUndefined();
    // Vue is an interface: the bundler is ours, React and its helpers are not.
    const vue = planOf(s);
    expect(vue.vite.to).toBe(OURS.vite);
    for (const react of ["react", "@types/react", "@vitejs/plugin-react", "@testing-library/react"])
      expect(vue[react], react).toBeUndefined();
    const chosen = survey({ devDependencies: { oxlint: "^1.0.0", typescript: "6.0.3" } }, ["src/index.ts"], ["линтер"]);
    expect(chosen.foreign).toEqual([]);
    expect(chosen.scripts).toEqual(["lint"]);
    expect(planOf(chosen).eslint.to).toBe(OURS.eslint);
    expect(survey({}, ["src/index.js"]).foreign.map((f) => f.axis)).toEqual(["язык"]);
  });

  it("строки осей называют состояние и что не так — словами, которые печатает `env`", () => {
    const s = survey(
      { dependencies: { react: "^19.1.0" }, devDependencies: { typescript: OURS.typescript } },
      ["src/main.tsx", "src/app.module.scss"],
    );
    const row = (axis) => s.rows.find((r) => r.axis === axis);
    expect(row("язык")).toEqual({ axis: "язык", state: "наше", note: "версии связки" });
    expect(row("фреймворк")).toEqual({
      axis: "фреймворк",
      state: "наше, не по связке",
      note:
        "react ^19.1.0 → " + OURS.react + "; react-dom — нет; @types/react — нет; @types/react-dom — нет",
    });
    expect(planOf(s)["react-dom"]).toMatchObject({ section: "dependencies", from: null });
    expect(planOf(s)["@types/react"]).toMatchObject({ section: "devDependencies" });
    const lib = survey({ devDependencies: { typescript: OURS.typescript } }, ["src/index.ts"]);
    expect(lib.rows.find((r) => r.axis === "сборщик")).toEqual({
      axis: "сборщик",
      state: "без предмета",
      note: "интерфейса нет",
    });
    expect(lib.rows.find((r) => r.axis === "листы стилей")).toEqual({
      axis: "листы стилей",
      state: "без предмета",
      note: "файлов `.scss` и `.sass` нет",
    });
    // Объявленный пакет стилей без листов — предмет есть: версия приводится.
    const declared = survey({ devDependencies: { "sass-embedded": "^1.80.0" } }, ["src/index.ts"]);
    expect(planOf(declared)["sass-embedded"].to).toBe(OURS["sass-embedded"]);
  });

  it("менеджер — по полю `packageManager` и по блокировке; язык — JS без TS, без конфигов и объявлений типов", () => {
    const pnpm = survey({ packageManager: "pnpm@10.28.0" }, ["src/a.ts"]);
    expect(pnpm.foreign).toEqual([{ axis: "менеджер пакетов", what: "pnpm", tool: null }]);
    expect(survey({ packageManager: "npm@11.21.1" }, ["src/a.ts"]).foreign).toEqual([]);
    expect(survey({}, ["src/a.ts", "pnpm-lock.yaml"]).foreign[0].what).toBe("pnpm-lock.yaml");
    // Конфиг на JS и объявление типов кодом проекта не считаются.
    expect(survey({}, ["vite.config.js", "src/a.ts"]).foreign).toEqual([]);
    expect(survey({}, ["src/env.d.ts", "src/a.js"]).foreign.map((f) => f.axis)).toEqual(["язык"]);
    expect(survey({ devDependencies: { typescript: "6.0.3" } }, ["src/a.js"]).foreign).toEqual([]);
    expect(survey(null, ["vite.config.js"]).verdict).toBe("пусто");
    expect(survey(null, ["src/a.js"]).verdict).toBe("чужое");
    // Слово «замени своим» действует только на оси-инструменты.
    const vue = survey({ dependencies: { vue: "^3.5.0" } }, ["src/App.vue"], ["фреймворк"]);
    expect(vue.foreign.map((f) => f.axis)).toEqual(["фреймворк"]);
    expect(vue.scripts).toEqual([]);
    expect(vue.foreign[0].what).toBe("vue");
  });

  it("краевые формы осмотра: что делает код кодом, интерфейс интерфейсом и секцию секцией", () => {
    // Пустой манифест — не пустая папка; ответ «пусто» — целиком пустой.
    expect(survey({}, []).verdict).not.toBe("пусто");
    expect(survey(null, [])).toEqual({ verdict: "пусто", rows: [], foreign: [], plan: [], scripts: [] });
    expect(survey({}, ["src/a.ts"]).rows.map((r) => r.axis)).toEqual(AXES.map((a) => a.axis));
    // Конфиг на JS кодом не считается в любом из трёх видов.
    for (const config of ["vite.config.js", "vite.config.mjs", "vite.config.cjs"])
      expect(survey({}, [config]).foreign, config).toEqual([]);
    expect(survey({}, ["src/a.ts", "src/b.js"]).foreign).toEqual([]);
    expect(survey({}, ["src/a.js"]).foreign).toEqual([{ axis: "язык", what: "JavaScript без TypeScript", tool: null }]);
    // Код чужого фреймворка — по расширению, без пакета; одноранговый пакет — тоже признак.
    const svelte = survey({}, ["src/App.svelte", "src/main.ts"]);
    expect(svelte.foreign).toEqual([{ axis: "фреймворк", what: "svelte", tool: null }]);
    expect(planOf(svelte).react).toBeUndefined();
    expect(planOf(svelte).vite.to).toBe(OURS.vite);
    expect(survey({ peerDependencies: { vue: "^3.5.0" } }, ["src/index.ts"]).foreign[0].axis).toBe("фреймворк");
    expect(survey({ packageManager: "yarn@1.22.22" }, ["src/a.ts", "yarn.lock"]).foreign[0].what).toBe("yarn.lock, yarn");
    // Интерфейс — по `.tsx` среди прочих файлов; без интерфейса React-помощники тестов не ставятся.
    expect(planOf(survey({}, ["src/a.tsx", "src/b.ts"])).vite.to).toBe(OURS.vite);
    expect(planOf(survey({}, ["src/index.ts"]))["@testing-library/react"]).toBeUndefined();
    expect(planOf(survey({}, ["src/main.tsx"])).react.section).toBe("dependencies");
    expect(planOf(survey({ devDependencies: { react: "^19.1.0" } }, ["src/main.tsx"])).react.section).toBe("devDependencies");
    expect(
      planOf(survey({ peerDependencies: { react: "^19.0.0" }, devDependencies: { react: "^19.1.0" } }, ["src/a.tsx"]))
        .react,
    ).toEqual({ name: "react", from: "^19.1.0", to: OURS.react, section: "devDependencies" });
    // Листы стилей узнаются по расширению с точкой, а замена называется рядом с версиями.
    expect(planOf(survey({}, ["src/a.ts", "src/xscss"]))["sass-embedded"]).toBeUndefined();
    const withSass = survey({ devDependencies: { sass: "^1.80.0" } }, ["src/a.ts", "src/a.scss"]);
    expect(withSass.rows.find((r) => r.axis === "листы стилей").note).toBe(
      "sass — объявленная замена sass-embedded; версии связки",
    );
    // Расширение читается целиком: `.json` не JavaScript, `.tsbuildinfo` не TypeScript, `notvue` не Vue.
    expect(survey({}, ["src/data.json"]).foreign).toEqual([]);
    expect(survey({}, ["src/a.js", "x.tsbuildinfo"]).foreign.map((f) => f.axis)).toEqual(["язык"]);
    expect(survey({}, ["src/notvue", "src/a.ts"]).foreign).toEqual([]);
    expect(planOf(survey({}, ["src/notvue", "src/a.ts"])).vite).toBeUndefined();
    expect(planOf(survey({}, ["src/a.tsx.snap", "src/b.ts"])).vite).toBeUndefined();
    expect(planOf(survey({ dependencies: { vue: "^3.5.0" } }, ["src/main.ts"])).vite.to).toBe(OURS.vite);
    // Пакет чужого фреймворка без его файлов — тоже чужой интерфейс; React в зависимостях без `.tsx` — наш.
    expect(planOf(survey({ dependencies: { vue: "^3.5.0" } }, ["src/main.ts"])).react).toBeUndefined();
    expect(planOf(survey({ dependencies: { react: "^19.1.0" } }, ["src/hooks.ts"])).vite.to).toBe(OURS.vite);
    expect(survey({ dependencies: { vue: "^3.5.0" } }, ["src/main.ts"]).rows.find((r) => r.axis === "фреймворк")).toEqual(
      { axis: "фреймворк", state: "чужое", note: "vue" },
    );
    // Без умолчаний вызов не падает: ни инструментов, ни платформы.
    expect(stackSurveyOf({ manifest: {}, files: ["src/a.ts"], axes: AXES, verified: OURS }).scripts).toEqual([]);
  });

  it("файлы проекта для осмотра: без зависимостей, истории, обвязки и сборки, с пределом глубины", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-files-"));
    try {
      const put = (rel) => {
        fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
        fs.writeFileSync(path.join(dest, rel), "x\n");
      };
      for (const rel of [
        "node_modules/x/index.js",
        ".git/HEAD",
        ".claude/tools/graph.mjs",
        "dist/a.js",
        "build/b.js",
        "coverage/c.js",
        ".next/d.js",
        ".stryker-tmp/sandbox-1/src/a.ts",
        ".проба-сверок/1/src/a.ts",
        "src/a/b.ts",
        "package.json",
        // Каждая папка вне дерева инструмента — из общего списка, а не своего.
        ...[...OUT_OF_TREE].map((dir) => dir + "/x/y.ts"),
      ])
        put(rel);
      expect(projectFilesOf(dest).sort()).toEqual(["package.json", "src/a/b.ts"]);
      expect(projectFilesOf(dest, 1)).toEqual(["package.json"]);
      expect(projectFilesOf(path.join(dest, "нет-такой"))).toEqual([]);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("план ложится в манифест точными версиями, скрипт звена — семенной, прежний рядом; упала установка — всё как было", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-apply-"));
    try {
      const manifest = {
        scripts: { lint: "oxlint ." },
        devDependencies: { react: "^19.1.0", typescript: "~5.8.3" },
      };
      const text = JSON.stringify(manifest, null, 2) + "\n";
      fs.writeFileSync(path.join(dest, "package.json"), text);
      fs.writeFileSync(path.join(dest, "package-lock.json"), "{\"lock\":1}\n");
      const s = {
        plan: [
          { name: "typescript", from: "~5.8.3", to: "6.0.3", section: "devDependencies" },
          { name: "react", from: "^19.1.0", to: "19.3.1", section: "dependencies" },
        ],
        scripts: ["lint"],
      };
      const calls = [];
      const ok = stackApply(dest, s, { lint: "eslint ." }, (cmd, args, opts) => {
        calls.push([cmd, args[0], opts.cwd]);
        return ran(0, "", "");
      });
      expect(ok).toEqual({ ok: true, manager: "npm" });
      expect(calls).toEqual([["npm", "install", dest]]);
      const after = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
      expect(after.dependencies).toEqual({ react: "19.3.1" });
      expect(after.devDependencies).toEqual({ typescript: "6.0.3" });
      expect(after.scripts).toEqual({ lint: "eslint .", "lint:own": "oxlint ." });
      // Второй вызов с тем же ключом: скрипт уже семенной, и прежний
      // `lint:own` им не затирается.
      const applied = fs.readFileSync(path.join(dest, "package.json"), "utf8");
      stackApply(dest, { plan: [], scripts: ["lint"] }, { lint: "eslint ." }, () => ran(0, "", ""));
      expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(applied);

      fs.writeFileSync(path.join(dest, "package.json"), text);
      const failed = stackApply(dest, s, { lint: "eslint ." }, () => {
        fs.writeFileSync(path.join(dest, "package-lock.json"), "broken");
        return ran(1, "", "npm error ERESOLVE\nconflict");
      });
      expect(failed).toEqual({ ok: false, manager: "npm", tail: ["npm error ERESOLVE", "conflict"] });
      expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(text);
      expect(fs.readFileSync(path.join(dest, "package-lock.json"), "utf8")).toBe("{\"lock\":1}\n");
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("менеджера блокировки на машине нет — манифест на месте, а причина названа, а не пустая строка", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-nomanager-"));
    const before = process.env.PATH;
    try {
      const text = JSON.stringify({ name: "x", devDependencies: { typescript: "5.0.0" } }) + "\n";
      fs.writeFileSync(path.join(dest, "package.json"), text);
      fs.writeFileSync(path.join(dest, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      // Настоящий раннер, а не подставной: причину незапуска даёт только он.
      process.env.PATH = path.join(dest, "нет-такой-папки");
      const plan = [{ name: "typescript", from: "5.0.0", to: OURS.typescript, section: "devDependencies" }];
      const failed = stackApply(dest, { plan, scripts: [] }, {});
      expect(failed).toEqual({ ok: false, manager: "pnpm", tail: ["не запустилась: pnpm (ENOENT)"] });
      expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(text);
    } finally {
      process.env.PATH = before;
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("установка зовёт менеджера по его блокировке; без блокировки откат её не заводит; ключи секции по порядку", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-lock-"));
    try {
      const manifest = {
        scripts: { lint: "eslint .", test: "vitest" },
        dependencies: { zod: "^4.0.0" },
        devDependencies: { zeta: "1.0.0", react: "^19.1.0" },
      };
      const text = JSON.stringify(manifest, null, 2) + "\n";
      const s = {
        plan: [
          { name: "react", from: "^19.1.0", to: "19.3.1", section: "dependencies" },
          { name: "alpha", from: null, to: "2.0.0", section: "dependencies" },
        ],
        scripts: ["lint", "test", "mutate"],
      };
      const seen = [];
      const ok = (cmd, args) => {
        seen.push([cmd, ...args].join(" "));
        return ran(0, "", "");
      };
      fs.writeFileSync(path.join(dest, "package.json"), text);
      expect(stackApply(dest, s, { lint: "eslint .", test: "vitest run" }, ok)).toEqual({ ok: true, manager: "npm" });
      const after = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
      expect(Object.keys(after.dependencies)).toEqual(["alpha", "react", "zod"]);
      expect(after.devDependencies).toEqual({ zeta: "1.0.0" });
      expect(after.scripts).toEqual({ lint: "eslint .", test: "vitest run", "test:own": "vitest" });
      for (const [lock, cmd] of [
        ["pnpm-lock.yaml", "pnpm install"],
        ["bun.lock", "bun install"],
        ["bun.lockb", "bun install"],
      ]) {
        fs.writeFileSync(path.join(dest, "package.json"), text);
        fs.writeFileSync(path.join(dest, lock), "lock\n");
        stackApply(dest, { plan: [], scripts: [] }, {}, ok);
        fs.rmSync(path.join(dest, lock));
        expect(seen.at(-1)).toBe(cmd);
      }
      expect(seen[0]).toBe("npm install --no-audit --no-fund --loglevel=error");
      fs.writeFileSync(path.join(dest, "package.json"), text);
      const long = Array.from({ length: 14 }, (_, i) => "line " + i).join("\n");
      // Упавшая установка успела положить блокировку: откат снимает и её.
      const failed = stackApply(dest, s, {}, () => {
        fs.writeFileSync(path.join(dest, "package-lock.json"), "half\n");
        return ran(1, "  " + long, "\n");
      });
      expect(failed.tail).toEqual(Array.from({ length: 12 }, (_, i) => "line " + (i + 2)));
      expect(fs.existsSync(path.join(dest, "package-lock.json"))).toBe(false);
      expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(text);
      // Пакет уходит из обычных зависимостей в зависимости разработки; секции может не быть вовсе.
      fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ dependencies: { vite: "^7.0.0" } }) + "\n");
      stackApply(dest, { plan: [{ name: "vite", from: "^7.0.0", to: "8.3.5", section: "devDependencies" }], scripts: [] }, {}, ok);
      const raw = fs.readFileSync(path.join(dest, "package.json"), "utf8");
      expect(raw.endsWith("}\n")).toBe(true);
      expect(JSON.parse(raw)).toEqual({ dependencies: {}, devDependencies: { vite: "8.3.5" } });
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("монорепозиторий: пакеты рабочих пространств читаются, их версии приводятся там, где их держат", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-ws-"));
    try {
      const write = (rel, value) => {
        fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
        fs.writeFileSync(path.join(dest, rel), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
      };
      write("package.json", { private: true, workspaces: ["packages/*", "tools/lint"] });
      write("packages/app/package.json", {
        dependencies: { react: "^19.1.0" },
        devDependencies: { typescript: "~5.8.3", vite: "^7.0.4" },
      });
      write("packages/ui/package.json", { peerDependencies: { react: "^19.0.0" }, devDependencies: { vitest: "^3.2.4" } });
      write("packages/empty/README.md", "no manifest\n");
      write("tools/lint/package.json", { devDependencies: {} });
      write("pnpm-workspace.yaml", "packages:\n  - 'extra/*'\n");
      write("extra/one/package.json", { devDependencies: {} });
      const ws = workspaceManifestsOf(dest);
      expect(ws.map((w) => w.at)).toEqual([
        "extra/one/package.json",
        "packages/app/package.json",
        "packages/ui/package.json",
        "tools/lint/package.json",
      ]);
      expect(workspaceManifestsOf(path.join(dest, "нет-такой"))).toEqual([]);
      const s = stackSurveyOf({
        manifest: JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")),
        files: ["packages/app/src/main.tsx", "packages/ui/src/index.ts"],
        axes: AXES,
        verified: OURS,
        ui: PLATFORM.ui,
        alternatives: PLATFORM.alternatives,
        workspaces: ws,
      });
      const plan = planOf(s);
      expect(plan.typescript).toEqual({
        name: "typescript",
        from: "~5.8.3",
        to: OURS.typescript,
        section: "devDependencies",
        at: "packages/app/package.json",
      });
      expect(plan.vitest.at).toBe("packages/ui/package.json");
      expect(plan.react).toMatchObject({ section: "dependencies", at: "packages/app/package.json" });
      // Не объявленное нигде ставится в корень.
      expect(plan.eslint).toEqual({ name: "eslint", from: null, to: OURS.eslint, section: "devDependencies" });
      expect(s.rows.find((r) => r.axis === "язык").note).toBe("typescript ~5.8.3 → " + OURS.typescript + " (packages/app)");
      const ok = () => ran(0, "", "");
      expect(stackApply(dest, s, {}, ok)).toEqual({ ok: true, manager: "npm" });
      const app = JSON.parse(fs.readFileSync(path.join(dest, "packages/app/package.json"), "utf8"));
      expect(app.devDependencies).toEqual({ typescript: OURS.typescript, vite: OURS.vite });
      expect(JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).devDependencies.eslint).toBe(OURS.eslint);
      // Упала установка — все тронутые манифесты возвращаются как были.
      write("packages/app/package.json", { devDependencies: { typescript: "~5.8.3" } });
      const appBefore = fs.readFileSync(path.join(dest, "packages/app/package.json"), "utf8");
      const rootBefore = fs.readFileSync(path.join(dest, "package.json"), "utf8");
      const failed = stackApply(dest, s, {}, () => ran(1, "", "x"));
      expect(failed.ok).toBe(false);
      expect(fs.readFileSync(path.join(dest, "packages/app/package.json"), "utf8")).toBe(appBefore);
      expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(rootBefore);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("диапазон пира пускает версию плана по правилам semver; непонятный диапазон — не ответ", () => {
    const yes = [
      ["^8.56.0 || ^9.0.0", "9.39.1"],
      [">=8.40", "10.13.0"],
      [">= 4.8.4 < 6.1", "6.0.3"],
      ["^0.2.0", "0.2.9"],
      ["~5.5", "5.5.4"],
      ["8.x || 9.x || 10.x", "10.13.0"],
      ["1.2 - 2.3", "2.3.9"],
      ["*", "1.0.0"],
      ["", "1.0.0"],
      ["<=9", "9.9.9"],
      [">9.0.0-alpha", "9.0.1"],
      ["=6.0.3", "6.0.3"],
    ];
    for (const [range, version] of yes) expect(rangeAllows(range, version), range).toBe(true);
    const no = [
      ["^8.56.0", "10.13.0"],
      ["^0.2.0", "0.3.0"],
      ["^0.0.3", "0.0.4"],
      ["~5.5.0", "5.6.0"],
      [">=4.8.4 <5.6.0", "6.0.3"],
      ["8.x", "9.0.0"],
      ["1.2 - 2.3", "2.4.0"],
      [">9", "9.9.9"],
      ["<9", "9.0.0"],
      ["6.0.2", "6.0.3"],
    ];
    for (const [range, version] of no) expect(rangeAllows(range, version), range).toBe(false);
    for (const range of ["workspace:*", "npm:eslint@8", "github:a/b", "latest-ish"])
      expect(rangeAllows(range, "1.0.0"), range).toBeNull();
  });

  it("держатель, чей пир не пускает версию плана либо снимаемый пакет, назван до установки", () => {
    // Выведено одиннадцатой посадкой: держатель вне `predecessors` называл
    // только хвост упавшей `npm install`, когда манифест уже был переписан.
    const plan = [
      { name: "eslint", from: "^8.57.0", to: "10.13.0", section: "devDependencies" },
      { name: "typescript", from: "~5.4.5", to: "6.0.3", section: "devDependencies", at: "packages/app/package.json" },
      { name: "@typescript-eslint/parser", from: "^7.18.0", to: null, section: "devDependencies" },
      { name: "prettier", from: "^3.0.0", to: "3.9.10", section: "devDependencies" },
    ];
    const installed = {
      "eslint-plugin-import": { version: "2.29.1", peerDependencies: { eslint: "^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8" } },
      "eslint-plugin-ok": { version: "1.0.0", peerDependencies: { eslint: ">=9" } },
      "eslint-import-resolver-typescript": {
        version: "3.6.1",
        peerDependencies: { "@typescript-eslint/parser": "*", "eslint-plugin-import": "*" },
      },
      "eslint-plugin-optional": {
        version: "1.0.0",
        peerDependencies: { "@typescript-eslint/parser": "^7", eslint: "workspace:*" },
        peerDependenciesMeta: { "@typescript-eslint/parser": { optional: true } },
      },
      "ts-thing": { version: "1.0.0", peerDependencies: { typescript: ">=4.8 <5.6" } },
    };
    const read = (name) => installed[name] ?? null;
    const out = peerConflictsOf({
      plan,
      places: [
        {
          at: null,
          m: {
            devDependencies: {
              eslint: "^8.57.0",
              "@typescript-eslint/parser": "^7.18.0",
              "eslint-plugin-import": "^2.29.1",
              "eslint-plugin-ok": "^1.0.0",
              "eslint-import-resolver-typescript": "^3.6.1",
              "eslint-plugin-optional": "^1.0.0",
              "eslint-plugin-absent": "^1.0.0",
              prettier: "^3.0.0",
            },
          },
        },
        { at: "packages/app/package.json", m: { dependencies: { "ts-thing": "^1.0.0" }, devDependencies: { typescript: "~5.4.5" } } },
      ],
      installed: read,
    });
    expect(out.conflicts).toEqual([
      { holder: "eslint-import-resolver-typescript", version: "3.6.1", at: null, peer: "@typescript-eslint/parser", range: "*", to: null },
      { holder: "eslint-plugin-import", version: "2.29.1", at: null, peer: "eslint", range: "^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8", to: "10.13.0" },
      { holder: "ts-thing", version: "1.0.0", at: "packages/app/package.json", peer: "typescript", range: ">=4.8 <5.6", to: "6.0.3" },
    ]);
    // Не установлен — пиры не прочитаны, и это названо, а не пропущено.
    expect(out.unread).toEqual([
      { name: "eslint-plugin-absent", at: null, why: "не установлен" },
      { name: "eslint-plugin-optional", at: null, why: "диапазон пира eslint «workspace:*» не разобран" },
    ]);
    expect(peerConflictsOf({ plan: [], places: [{ at: null, m: { dependencies: { a: "1" } } }], installed: () => null })).toEqual({
      conflicts: [],
      unread: [],
    });
  });

  it("подъём ESLint через границу плоского конфига при старом конфиге назван; без старого либо в пределах мажора — нет", () => {
    const up = [{ name: "eslint", from: "^8.57.1", to: "10.13.0", section: "devDependencies" }];
    expect(eslintBoundaryOf(up, [".eslintrc.cjs", "package.json"])).toBe(
      "ESLint поднят ^8.57.1 → 10.13.0: старый конфиг .eslintrc.cjs он не читает, и линт проекта падает до разбора. Шаг 1-бис кладёт конфиг семени действующим, старый снимает (`seat/seat.md`, шаг 1-бис).",
    );
    for (const legacy of [".eslintrc", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml", ".eslintrc.js"])
      expect(eslintBoundaryOf(up, [legacy]), legacy).not.toBeNull();
    expect(eslintBoundaryOf(up, ["eslint.config.js", ".eslintrc.cjs.bak"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], from: "^9.30.0" }], [".eslintrc.cjs"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], from: null }], [".eslintrc.cjs"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], name: "prettier" }], [".eslintrc.cjs"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], to: "8.57.1" }], [".eslintrc.cjs"])).toBeNull();
  });

  it("проект на yarn ставится командой yarn, и откат возвращает его блокировку", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-yarn-"));
    try {
      const text = JSON.stringify({ devDependencies: { typescript: "~5.8.3" } }, null, 2) + "\n";
      fs.writeFileSync(path.join(dest, "package.json"), text);
      fs.writeFileSync(path.join(dest, "yarn.lock"), "# yarn lockfile v1\n");
      const s = { plan: [{ name: "typescript", from: "~5.8.3", to: "6.0.3", section: "devDependencies" }], scripts: [] };
      const calls = [];
      const failed = stackApply(dest, s, {}, (cmd, args) => {
        calls.push([cmd, ...args]);
        fs.writeFileSync(path.join(dest, "yarn.lock"), "broken");
        return ran(1, "", "error");
      });
      expect(calls).toEqual([["yarn", "install"]]);
      expect(failed.ok).toBe(false);
      expect(fs.readFileSync(path.join(dest, "yarn.lock"), "utf8")).toBe("# yarn lockfile v1\n");
      expect(fs.existsSync(path.join(dest, "package-lock.json"))).toBe(false);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe("посадка на месте одной командой", () => {
  it("пустая папка: фаза 1 целиком, испытание звеньев, базовая линия, два коммита; второй вызов — уже сделано", () => {
    // Пробел в пути: папка «My Projects» — обычное место проекта на чужой машине.
    const dest = boxWithShelf("seat here-");
    try {
      const run = seatHere(dest, "--packages", ROOT);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain("ПОСАДКА НЕ ЗАВЕРШЕНА. Фаза 1 закончена.");
      expect(run.stdout).toContain("обнаружили 5 из 5");
      expect(run.stdout).toContain("ФАЗА 2 — ЗАВЕРШЕНИЕ ПОСАДКИ, ОЖИДАЕТ ОТВЕТА");
      const facts = fs.readFileSync(path.join(dest, ".context", "01-facts.md"), "utf8");
      expect(facts).toMatch(/\| `test` \| зелено, тестов `\d+` в файлах `\d+` \|/);
      expect(facts).toMatch(/\| `mutate` \| зелено, убито `[1-9]\d*` из `\d+`/);
      expect(facts).not.toContain("<замер>");
      expect(gitIn(dest, "log", "--format=%s").split("\n")).toEqual([
        "chore: record the seating bases of the bar, the series and the findings",
        "chore: seat the harness",
      ]);
      expect(gitIn(dest, "log", "--format=%an")).not.toContain("seat");
      expect(run.stdout).not.toContain("git не знает, кто вы");
      expect(gitIn(dest, "config", "core.hooksPath")).toBe(".claude/hooks/git");
      const seated = fs.readFileSync(path.join(dest, ".context", "graph.config.mjs"), "utf8");
      const base = gitIn(dest, "rev-list", "--max-parents=0", "HEAD").trim();
      for (const line of [/^ {2}barSince: "(\w+)",/m, /^ {2}seriesSince: "(\w+)",/m, /^ {4}since: "(\w+)",/m])
        expect(line.exec(seated)?.[1], String(line)).toBe(base);
      expect(gitIn(dest, "status", "--porcelain")).toBe("");
      expect(fs.existsSync(path.join(dest, ".git", "claude-seat"))).toBe(false);
      const again = seatHere(dest, "--packages", ROOT);
      expect(again.status, again.stdout).toBe(0);
      expect(again.stdout).toContain("=== Посадка уже сделана ===");
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 300000);

  it("git без имени пользователя: посадка коммитит от имени seat и говорит об этом в отчёте", () => {
    // Свежая машина: git стоит, а имени нет, и первый свой коммит человека
    // упал бы «Please tell me who you are». Выведено посадкой с голой машины.
    const dest = boxWithShelf("seat-noname-");
    const none = path.join(dest, "..", path.basename(dest) + ".gitconfig");
    try {
      fs.writeFileSync(none, "");
      const run = spawnSync(
        process.execPath,
        [path.join(dest, ".claude", "tools", "graph.mjs"), "seat", dest, "--packages", ROOT],
        {
          cwd: dest,
          encoding: "utf8",
          env: { ...process.env, GIT_CONFIG_GLOBAL: none, GIT_CONFIG_NOSYSTEM: "1" },
        },
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(gitIn(dest, "log", "--format=%an <%ae>").split("\n")).toEqual([
        "seat <seat@local>",
        "seat <seat@local>",
      ]);
      expect(run.stdout).toContain("git не знает, кто вы");
      expect(run.stdout).toContain('git config --global user.name "Имя"');
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.rmSync(none, { force: true });
    }
  }, 300000);

  it("витрина хостинга: свои строки списка исключений первыми, описание не тронуто, история продолжена", () => {
    const dest = boxWithShelf("seat-hosting-");
    try {
      fs.writeFileSync(path.join(dest, "README.md"), "# My app\n");
      fs.writeFileSync(path.join(dest, "LICENSE"), "MIT\n");
      fs.writeFileSync(path.join(dest, ".gitignore"), "secret.env\n");
      fs.renameSync(path.join(dest, ".claude"), path.join(dest, "..", path.basename(dest) + "-shelf"));
      gitIn(dest, "init", "-q");
      gitIn(dest, "add", "-A");
      gitIn(dest, "commit", "-qm", "init");
      fs.renameSync(path.join(dest, "..", path.basename(dest) + "-shelf"), path.join(dest, ".claude"));
      const run = seatHere(dest, "--packages", ROOT);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain("В .gitignore дописаны строки обвязки");
      const ignore = fs.readFileSync(path.join(dest, ".gitignore"), "utf8").split("\n");
      expect(ignore[0]).toBe("secret.env");
      expect(ignore).toContain("node_modules");
      expect(fs.readFileSync(path.join(dest, "README.md"), "utf8")).toBe("# My app\n");
      expect(gitIn(dest, "rev-list", "--count", "HEAD")).toBe("3");
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 300000);

  it("свежий шаблон сборщика убирается и заменяется заготовкой обвязки, список убранного напечатан", () => {
    const dest = boxWithShelf("seat-vite-");
    try {
      fs.mkdirSync(path.join(dest, "src"));
      fs.mkdirSync(path.join(dest, "public"));
      fs.writeFileSync(path.join(dest, "README.md"), "# React + TypeScript + Vite\n");
      fs.writeFileSync(
        path.join(dest, "src", "App.tsx"),
        "export default () => <p>Edit and save to test HMR</p>;\n",
      );
      fs.writeFileSync(path.join(dest, "package.json"), '{"name":"vite-app"}\n');
      fs.writeFileSync(path.join(dest, ".oxlintrc.json"), "{}\n");
      const run = seatHere(dest, "--packages", ROOT);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain(
        "убраны .oxlintrc.json, README.md, package.json, public, src.",
      );
      expect(run.stdout).toContain("ESLint вместо oxlint");
      expect(fs.existsSync(path.join(dest, "src", "App.tsx"))).toBe(false);
      expect(fs.existsSync(path.join(dest, ".oxlintrc.json"))).toBe(false);
      expect(fs.existsSync(path.join(dest, "src", "app", "App.tsx"))).toBe(true);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 300000);

  it("живой проект и своя история — отказ до единой правки, папка как была", () => {
    const live = boxWithShelf("seat-live-");
    const history = boxWithShelf("seat-history-");
    try {
      fs.mkdirSync(path.join(live, "src"));
      fs.writeFileSync(path.join(live, "src", "main.ts"), "export const x = 1;\n");
      const said = seatHere(live, "--packages", ROOT);
      expect(said.status).toBe(1);
      expect(said.stdout).toContain("Живой проект: сажать по инструкции");
      expect(said.stdout).toContain("Кроме обвязки здесь лежит: src.");
      expect(fs.readdirSync(live).sort()).toEqual([".claude", "src"]);
      gitIn(history, "init", "-q");
      gitIn(history, "commit", "-q", "--allow-empty", "-m", "one");
      gitIn(history, "commit", "-q", "--allow-empty", "-m", "two");
      const again = seatHere(history, "--packages", ROOT);
      expect(again.status).toBe(1);
      expect(again.stdout).toContain("У репозитория своя история — коммитов 2");
      expect(fs.readdirSync(history).sort()).toEqual([".claude", ".git"]);
    } finally {
      fs.rmSync(live, { recursive: true, force: true });
      fs.rmSync(history, { recursive: true, force: true });
    }
  });

  it("звено, не поймавшее посаженную ошибку, — отказ, и папка возвращена в прежний вид", () => {
    const dest = boxWithShelf("seat-blind-");
    try {
      const seedAt = path.join(dest, ".claude", "seat", "templates", "package.json");
      const seed = JSON.parse(fs.readFileSync(seedAt, "utf8"));
      seed.scripts.typecheck = "node -e 0";
      fs.writeFileSync(seedAt, JSON.stringify(seed, null, 2) + "\n");
      const run = seatHere(dest, "--packages", ROOT);
      expect(run.status, run.stdout).toBe(1);
      expect(run.stdout).toContain("Проверка не поймала посаженную ошибку — typecheck.");
      expect(run.stdout).toContain("Папка возвращена в прежний вид.");
      expect(fs.readdirSync(dest)).toEqual([".claude"]);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 300000);
});

describe("среда посадки называет, чего лишится живой проект на стеке новее связки", () => {
  const envOf = (deps) => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "env-stack-"));
    try {
      fs.writeFileSync(
        path.join(dest, "package.json"),
        JSON.stringify({ devDependencies: deps }) + "\n",
      );
      return spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", dest], {
        cwd: ROOT,
        encoding: "utf8",
      }).stdout;
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  };

  it("TypeScript новее связки — предупреждение с критериями линта; проверенный — молчание", () => {
    const newer = envOf({ typescript: "~7.0.2" });
    expect(newer).toContain("=== Линт обвязки на этом проекте не встанет (предупреждение) ===");
    expect(newer).toContain("J1");
    expect(envOf({ typescript: "~6.0.3" })).not.toContain("не встанет");
  });

  // Подставной `npm` — скрипт оболочки: на Windows его не позвать.
  it.skipIf(process.platform === "win32")(
    "`--apply`: предупреждение о линте — по манифесту после установки; поднятый ESLint при старом конфиге назван; сборка — менеджером",
    () => {
      const dest = fs.mkdtempSync(path.join(os.tmpdir(), "env-apply-"));
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "env-apply-bin-"));
      try {
        fs.writeFileSync(
          path.join(dest, "package.json"),
          JSON.stringify({
            scripts: { build: "tsc" },
            devDependencies: { typescript: "~7.0.2", eslint: "^8.57.0" },
          }) + "\n",
        );
        fs.writeFileSync(path.join(dest, "package-lock.json"), "{}\n");
        fs.writeFileSync(path.join(dest, ".eslintrc.cjs"), "module.exports = {};\n");
        fs.writeFileSync(
          path.join(bin, "npm"),
          '#!/bin/sh\ncase "$1" in install) exit 0;; run) echo "ran $2"; exit 0;; esac\nPATH="$REAL_PATH" exec npm "$@"\n',
          { mode: 0o755 },
        );
        const run = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", dest, "--apply"], {
          cwd: ROOT,
          encoding: "utf8",
          env: { ...process.env, REAL_PATH: process.env.PATH, PATH: bin + path.delimiter + process.env.PATH },
        });
        expect(run.stdout).toContain("=== Стек приведён к связке: да ===");
        expect(run.stdout).not.toContain("не встанет");
        expect(run.stdout).toMatch(/ESLint поднят \^8\.57\.0 → \d+\.\d+\.\d+: старый конфиг \.eslintrc\.cjs/);
        expect(run.stdout).toContain("npm run build: код 0");
        expect(run.stdout).toContain("typecheck: скрипта нет — типы на новой связке не проверены");
        const after = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
        expect(after.devDependencies.typescript).toMatch(/^6\.\d+\.\d+$/);
      } finally {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.rmSync(bin, { recursive: true, force: true });
      }
    },
    120000,
  );

  it.skipIf(process.platform === "win32")(
    "держатель с пиром на прежней версии назван в плане, и `--apply` отказывает до установки, не тронув манифест",
    () => {
      const dest = fs.mkdtempSync(path.join(os.tmpdir(), "env-peers-"));
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "env-peers-bin-"));
      try {
        const text = JSON.stringify({ devDependencies: { eslint: "^8.57.0", "eslint-plugin-import": "^2.29.1" } }) + "\n";
        fs.writeFileSync(path.join(dest, "package.json"), text);
        fs.writeFileSync(path.join(dest, "package-lock.json"), "{}\n");
        fs.mkdirSync(path.join(dest, "node_modules", "eslint-plugin-import"), { recursive: true });
        fs.writeFileSync(
          path.join(dest, "node_modules", "eslint-plugin-import", "package.json"),
          JSON.stringify({ name: "eslint-plugin-import", version: "2.29.1", peerDependencies: { eslint: "^7.2.0 || ^8" } }),
        );
        const called = path.join(bin, "called");
        fs.writeFileSync(
          path.join(bin, "npm"),
          '#!/bin/sh\ncase "$1" in install) touch ' + JSON.stringify(called) + '; exit 0;; esac\nPATH="$REAL_PATH" exec npm "$@"\n',
          { mode: 0o755 },
        );
        const env = { ...process.env, REAL_PATH: process.env.PATH, PATH: bin + path.delimiter + process.env.PATH };
        const look = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", dest], { cwd: ROOT, encoding: "utf8", env });
        expect(look.stdout).toContain("=== Пиры не пустят план: установка упадёт ===");
        expect(look.stdout).toMatch(/eslint-plugin-import 2\.29\.1: пир eslint \^7\.2\.0 \|\| \^8 — план ставит \d+\.\d+\.\d+/);
        expect(look.stdout).toContain("Вопрос разработчику до `--apply`");
        expect(look.stdout).not.toContain("пиры не прочитаны");
        const run = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", dest, "--apply"], { cwd: ROOT, encoding: "utf8", env });
        expect(run.status, run.stdout).toBe(1);
        expect(run.stdout).toContain("=== Стек приведён к связке: нет ===");
        expect(run.stdout).toContain("установка не начата");
        expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(text);
        expect(fs.existsSync(called)).toBe(false);
        // Пакеты не установлены — пиры не прочитаны, и это сказано строкой.
        fs.rmSync(path.join(dest, "node_modules"), { recursive: true });
        const bare = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", dest], { cwd: ROOT, encoding: "utf8", env });
        expect(bare.stdout).not.toContain("Пиры не пустят план");
        expect(bare.stdout).toContain("пиры не прочитаны у 1 пакетов проекта: не установлены");
      } finally {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.rmSync(bin, { recursive: true, force: true });
      }
    },
    120000,
  );
});

describe("семя разрешений держит то, что доктрина называет разрешённым", () => {
  // `environment.md`: запасной поиск — `grep` и `find` одной командой, `cd`
  // стоит отдельно, белый список запуска. Запись, снятая с семени, ломала бы
  // эти правила без признака: сверка разрешений сверяет только запреты.
  it("каждая команда, названная разрешённой, стоит в allow семени", () => {
    const allow = JSON.parse(
      fs.readFileSync(path.join(SHELF, "seat", "templates", "settings.json"), "utf8"),
    ).permissions.allow;
    for (const command of ["grep", "find", "cd", "npm", "npx", "node", "cp", "git"])
      expect(allow, command).toContain("Bash(" + command + " *)");
  });
});

describe("семя правил в живом проекте без строк скриптов каркаса", () => {
  // Решено разработчиком `2026-10-26`: строки `dev`, `build`, `preview`, которых у
  // проекта нет, снимает фаза 1, а не сессия руками по красной сверке.
  const TABLE = [
    "| Проверка | Команда |",
    "| --- | --- |",
    "| Сервер разработки | `npm run dev` |",
    "| Сборка | `npm run build` |",
    "| Тесты | `npm test` |",
    "Скрипт `npm run dev` в прозе остаётся.",
  ].join("\n");

  it("снимает строку таблицы, чьего скрипта каркаса у проекта нет, и только её", () => {
    expect(withoutFrameRows(TABLE, ["dev", "build", "preview"], ["build", "test"])).toBe(
      [
        "| Проверка | Команда |",
        "| --- | --- |",
        "| Сборка | `npm run build` |",
        "| Тесты | `npm test` |",
        "Скрипт `npm run dev` в прозе остаётся.",
      ].join("\n"),
    );
  });

  it("скрипт не из списка каркаса не снимает, даже если у проекта его нет", () => {
    expect(withoutFrameRows(TABLE, ["preview"], [])).toBe(TABLE);
  });

  it("строка таблицы с отступом и пробелами в хвосте — тоже строка; имя без команды и длиннее — нет", () => {
    const rows = [
      "  | Сервер | `npm run dev` |",
      "| Сервер | `npm run dev` |   ",
      "| Скрипт | `dev` |",
      "| Отладка | `npm run devtools` |",
    ].join("\n");
    expect(withoutFrameRows(rows, ["dev"], [])).toBe(
      ["| Скрипт | `dev` |", "| Отладка | `npm run devtools` |"].join("\n"),
    );
  });

  it("механика фазы 1 не везёт своё проекта с полки и правит только прозу", () => {
    const shelf = fs.mkdtempSync(path.join(os.tmpdir(), "own-shelf-"));
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "own-box-"));
    try {
      const put = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(shelf, rel)), { recursive: true });
        fs.writeFileSync(path.join(shelf, rel), text);
      };
      const row = "| Сервер | `npm run dev` |\n";
      put(
        "seat/map.json",
        JSON.stringify({
          projectOwnedInsideHarness: ["own.json", "agents"],
          frameScripts: ["dev"],
          copy: [
            { from: "seat/rules.md", to: "RULES.md" },
            { from: "seat/table.txt", to: "table.txt" },
          ],
        }),
      );
      put("seat/rules.md", row);
      put("seat/table.txt", row);
      put("own.json", "{}");
      put("agents/review.md", "своё");
      put("agents-kit/tool.md", "обвязка");
      put("rules/loop.md", "обвязка");
      layShelfLive(shelf, box);
      const laid = (rel) => fs.existsSync(path.join(box, ".claude", rel));
      expect([laid("own.json"), laid("agents/review.md")]).toEqual([false, false]);
      expect([laid("agents-kit/tool.md"), laid("rules/loop.md")]).toEqual([true, true]);
      expect(fs.readFileSync(path.join(box, "RULES.md"), "utf8")).toBe("");
      expect(fs.readFileSync(path.join(box, "table.txt"), "utf8")).toBe(row);
    } finally {
      fs.rmSync(shelf, { recursive: true, force: true });
      fs.rmSync(box, { recursive: true, force: true });
    }
  });

  it("механика фазы 1 кладёт семя правил и его отложенную копию без таких строк", () => {
    const frame = JSON.parse(
      fs.readFileSync(path.join(SHELF, "seat", "map.json"), "utf8"),
    ).frameScripts;
    expect(frame).toEqual(["dev", "build", "preview"]);
    for (const busy of [false, true]) {
      const box = fs.mkdtempSync(path.join(os.tmpdir(), "frame-rows-"));
      try {
        fs.writeFileSync(
          path.join(box, "package.json"),
          JSON.stringify({ scripts: { build: "vite build", test: "vitest" } }),
        );
        if (busy) fs.writeFileSync(path.join(box, "CLAUDE.md"), "# свои правила\n");
        layShelfLive(SHELF, box);
        const laid = fs.readFileSync(
          path.join(box, busy ? "CLAUDE.md.seat" : "CLAUDE.md"),
          "utf8",
        );
        expect(laid).not.toContain("`npm run dev`");
        expect(laid).not.toContain("`npm run preview`");
        expect(laid).toContain("`npm run build`");
        expect(laid).toContain("`npm run typecheck`");
      } finally {
        fs.rmSync(box, { recursive: true, force: true });
      }
    }
  });
});

describe("ссылка на раздел доктрины в тексте инструмента ведёт в существующий заголовок", () => {
  // Сверка «Ссылки на разделы» читает прозу, а не строки инструмента:
  // перенос таблицы файлов базы в `base-format.md` оставил вывод `tested`
  // посылать в `base.md`, и ничто этого не назвало.
  it("каждая ссылка вида «файл, раздел «…»» находит свой заголовок", () => {
    const docs = new Map();
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const at = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== "node_modules") walk(at);
        else if (e.name.endsWith(".md"))
          docs.set(at, [...fs.readFileSync(at, "utf8").matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].trim()));
      }
    };
    walk(SHELF);
    const tools = path.join(SHELF, "tools");
    const refs = [];
    for (const f of fs.readdirSync(tools).filter((f) => /^graph[\w.]*\.mjs$/.test(f) && !f.endsWith(".test.mjs")))
      fs.readFileSync(path.join(tools, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          // Комментарий описывает форму ссылки, а не ссылается.
          if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
          for (const m of line.matchAll(/`([\w./-]+\.md)`, раздел[ае]? «([^»]+)»/g))
            refs.push({ where: f + ":" + (i + 1), file: path.basename(m[1]), head: m[2] });
        });
    expect(refs.length).toBeGreaterThan(0);
    const missing = refs.filter(
      (r) =>
        ![...docs]
          .filter(([at]) => path.basename(at) === r.file)
          .some(([, heads]) => heads.some((h) => h.startsWith(r.head))),
    );
    expect(missing).toEqual([]);
  });
});

describe("записка к семени называет те значения, что стоят в семени", () => {
  // Записка `*-why.md` объясняет настройки семени и называет их формой
  // «`ключ: значение`»; правка семени без правки записки оставляла её
  // объяснять значение, которого нет, и ничто этого не называло.
  it("каждая пара «ключ: значение» записки есть в её семени", () => {
    const seat = path.join(SHELF, "seat");
    const templates = path.join(seat, "templates");
    const flat = (text) => text.replace(/["'\s]/g, "");
    const pairs = [];
    for (const note of fs.readdirSync(seat).filter((n) => n.endsWith("-why.md"))) {
      const stem = note.slice(0, -"-why.md".length);
      const seed = fs.readdirSync(templates).find((n) => n === stem || n.startsWith(stem + "."));
      expect(seed, note).toBeDefined();
      const body = flat(fs.readFileSync(path.join(templates, seed), "utf8"));
      for (const m of fs.readFileSync(path.join(seat, note), "utf8").matchAll(/`([A-Za-z][\w.]*): ([^`]+)`/g)) {
        const key = m[1].split(".").at(-1);
        pairs.push({ note, pair: m[0], found: body.includes(flat(key + ":" + m[2])) });
      }
    }
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.filter((p) => !p.found)).toEqual([]);
  });
});

// Загрузчик среды ставит Node.js и npm проверенной связки и git сам, по
// решению разработчика `2026-10-23`: человек с чистой машиной говорит
// «посади обвязку» и не настраивает ничего. План сверяется на поддельных
// орудиях, без сети; настоящую установку держит сценарий конвейера на трёх
// системах (`.github/workflows/harness-bootstrap.yml`).
describe("загрузчик среды посадки", () => {
  const BOOT = path.join(SHELF, "seat", "bootstrap.sh");
  const declared = verifiedOfSeed();
  const fakeBin = (tools) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boot-bin-"));
    for (const [name, version] of Object.entries(tools)) {
      const at = path.join(dir, name);
      fs.writeFileSync(at, "#!/bin/sh\necho v" + version + "\n");
      fs.chmodSync(at, 0o755);
    }
    for (const name of ["sed", "head", "uname", "cut", "grep", "dirname", "id", "printf"]) {
      const real = spawnSync("sh", ["-c", "command -v " + name], { encoding: "utf8" }).stdout.trim();
      if (real.startsWith("/")) fs.symlinkSync(real, path.join(dir, name));
    }
    return dir;
  };
  const bashAt = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
  const plan = (tools) => {
    const bin = fakeBin(tools);
    try {
      return spawnSync(bashAt, [BOOT, "--plan"], {
        encoding: "utf8",
        env: { HOME: os.tmpdir(), PATH: bin },
      });
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  };

  it.skipIf(process.platform === "win32" || bashAt === "")(
    "ставит Node.js, которого нет либо который ниже связки, и поднимает отставший npm",
    () => {
      const none = plan({ git: "2.43.0" });
      expect(none.status, none.stderr).toBe(0);
      expect(none.stdout).toContain("node: нет — поставить " + declared.node);
      expect(none.stdout).toMatch(new RegExp("/v" + declared.node + "/node-v" + declared.node + "-[a-z]+-(x64|arm64)\\.(tar\\.gz|zip) в "));
      expect(none.stdout).toContain("откат: удалить папку ");
      const old = plan({ node: "22.0.0", npm: declared.npm, git: "2.43.0" });
      expect(old.stdout).toContain("node: 22.0.0 — поставить " + declared.node);
      const npmOld = plan({ node: declared.node, npm: "10.9.4", git: "2.43.0" });
      expect(npmOld.stdout).toContain("npm: 10.9.4 — поднять до " + declared.npm);
      expect(npmOld.stdout).not.toContain("— поставить");
      const fine = plan({ node: declared.node, npm: declared.npm, git: "2.43.0" });
      expect(fine.stdout).toContain("ставить нечего");
      const newer = plan({ node: "24.1.0", npm: "11.30.0", git: "2.43.0" });
      expect(newer.stdout).toContain("ставить нечего");
      expect(none.stdout).toContain("скачать нечем: нет ни curl, ни wget");
      const noGit = plan({ node: declared.node, npm: declared.npm });
      expect(noGit.stdout).toContain("git: нет — поставить: руками");
      if (process.platform === "linux") {
        const apt = plan({ node: declared.node, npm: declared.npm, "apt-get": "2.7.14" });
        expect(apt.stdout).toMatch(/git: нет — поставить: (sudo )?apt-get update && (sudo )?apt-get install -y git/);
      }
    },
  );

  // Установка с архива, который отдаёт поддельный `nodejs.org` по `file://`:
  // сумма сходится всегда, а запустится ли поставленное — решает его `node`.
  const shell = ["curl", "tar", "gzip", "mktemp", "rm", "mkdir", "mv", "touch", "tail", "ln", "readlink"];
  const canInstall =
    process.platform === "linux" &&
    bashAt !== "" &&
    ["sha256sum", ...shell].every((name) => spawnSync("sh", ["-c", "command -v " + name]).status === 0);
  const install = (nodeSays, before = () => {}, without = "", sums = (text) => text) => {
    // Апостроф в пути — как в имени профиля `O'Brien`.
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "boot-o'brien-"));
    const name = "node-v" + declared.node + "-linux-" + (os.arch() === "arm64" ? "arm64" : "x64");
    const dist = path.join(box, "dist", "v" + declared.node);
    const pkg = path.join(box, "pkg", name, "bin");
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "node"), "#!/bin/sh\n" + nodeSays + "\n");
    fs.writeFileSync(path.join(pkg, "npm"), "#!/bin/sh\necho " + declared.npm + "\n");
    for (const one of ["node", "npm"]) fs.chmodSync(path.join(pkg, one), 0o755);
    spawnSync("tar", ["-czf", path.join(dist, name + ".tar.gz"), "-C", path.join(box, "pkg"), name]);
    const sum = spawnSync("sha256sum", [name + ".tar.gz"], { cwd: dist, encoding: "utf8" }).stdout;
    fs.writeFileSync(path.join(dist, "SHASUMS256.txt"), sums(sum));
    const bin = fakeBin({ git: "2.43.0" });
    for (const one of ["sha256sum", ...shell].filter((one) => one !== without)) {
      const real = spawnSync("sh", ["-c", "command -v " + one], { encoding: "utf8" }).stdout.trim();
      fs.symlinkSync(real, path.join(bin, one));
    }
    const home = path.join(box, "home");
    fs.mkdirSync(home);
    const dest = path.join(home, ".claude-harness", name);
    before(dest);
    const run = spawnSync(bashAt, [BOOT], {
      encoding: "utf8",
      env: { HOME: home, PATH: bin, CLAUDE_HARNESS_NODE_DIST: "file://" + path.join(box, "dist") },
    });
    const profile = path.join(home, ".profile");
    const out = {
      run,
      profile: fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : null,
      left: fs.existsSync(path.dirname(dest)) ? fs.readdirSync(path.dirname(dest)).sort() : [],
      dest,
    };
    fs.rmSync(box, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
    return out;
  };

  it.skipIf(!canInstall)("ставит запускаемый Node.js и записывает PATH только после проверки запуском", () => {
    const fine = install("echo v" + declared.node);
    expect(fine.run.status, fine.run.stdout + fine.run.stderr).toBe(0);
    expect(fine.run.stdout).toContain("node: не было → " + declared.node);
    expect(fine.run.stdout).toContain("откат: удалить папку " + fine.dest + " и строки «claude-harness»");
    expect(fine.profile).toContain(fine.dest + "/bin:$PATH");
    expect(fine.left).toEqual([path.basename(fine.dest)]);

    const broken = install('echo "version GLIBC_2.28 not found" >&2; exit 127');
    expect(broken.run.status).toBe(1);
    expect(broken.run.stdout).toContain("на этой системе не запускается: version GLIBC_2.28 not found");
    expect(broken.profile).toBe(null);
    expect(broken.left).toEqual([]);

    // Полупапка от прерванной установки готовой не считается.
    const stale = install("echo v" + declared.node, (dest) => {
      fs.mkdirSync(path.join(dest, "bin"), { recursive: true });
      fs.writeFileSync(path.join(dest, "bin", "node"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    });
    expect(stale.run.status, stale.run.stdout + stale.run.stderr).toBe(0);
    expect(stale.left).toEqual([path.basename(stale.dest)]);

    const blind = install("echo v" + declared.node, () => {}, "curl");
    expect(blind.run.status).toBe(1);
    expect(blind.run.stdout).toContain("скачать нечем: нет ни curl, ни wget");
    expect(blind.left).toEqual([]);

    const forged = install("echo v" + declared.node, () => {}, "", (text) => (text[0] === "0" ? "1" : "0") + text.slice(1));
    expect(forged.run.stdout).toContain("не сошлась с SHASUMS256.txt");
    const unlisted = install("echo v" + declared.node, () => {}, "", () => "");
    expect(unlisted.run.stdout).toContain("нет строки для node-v" + declared.node);
    expect([forged.left, unlisted.left, forged.profile, unlisted.profile]).toEqual([[], [], null, null]);
  });
});

function verifiedOfSeed() {
  const text = fs.readFileSync(path.join(SHELF, "seat", "templates", "graph.config.mjs"), "utf8");
  const block = text.slice(text.indexOf("verifiedVersions: {"));
  return {
    node: /\bnode: "([^"]+)"/.exec(block)[1],
    npm: /\bnpm: "([^"]+)"/.exec(block)[1],
  };
}

describe("пакеты песочницы под pnpm", () => {
  // Пакеты `pnpm` лежат в скрытой `.pnpm`, а обёртки `.bin` зовут их путём
  // от себя: без ссылки на неё в песочнице серии не запускался ни один
  // инструмент. Выведено седьмой посадкой — приложение на `pnpm`.
  it("хранилище `.pnpm` и `.bin` связаны, кэши раннеров — нет", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "zz-pnpm-"));
    try {
      const from = path.join(box, "from", "node_modules");
      const real = path.join(from, ".pnpm", "zz@1.0.0", "node_modules", "zz");
      fs.mkdirSync(real, { recursive: true });
      fs.writeFileSync(path.join(real, "package.json"), '{ "name": "zz" }');
      fs.symlinkSync(path.relative(from, real), path.join(from, "zz"), "junction");
      fs.mkdirSync(path.join(from, ".bin"));
      fs.mkdirSync(path.join(from, ".vite"));
      const to = path.join(box, "to", "node_modules");
      sandboxPackages(from, to);
      expect(fs.existsSync(path.join(to, ".pnpm", "zz@1.0.0", "node_modules", "zz", "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(to, "zz", "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(to, ".bin"))).toBe(true);
      expect(fs.existsSync(path.join(to, ".vite"))).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});
