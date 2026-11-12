import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  envLowOf,
  factsWithBaseline,
  copyTree,
  inPlaceKindOf,
  lintBlockersOf,
  mergedLines,
  npmOfShelf,
  testCountsOf,
  tiersFrom,
  sandboxPackages,
  peerConflictsOf,
  projectFilesOf,
  rangeAllows,
  stackApply,
  stackSurveyOf,
  eslintBoundaryOf,
  enclosingRepoOf,
  gitBusyOf,
  gitPathOf,
  SEAT_MARKER,
  stackBreakingCharOf,
  statusEntries,
  unknownFlagsOf,
  verifiedOf,
  walkFiles,
  withRefusal,
  withToolsOf,
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

  it("свежий шаблон — по четырём признакам сразу, и его файлы названы к удалению", () => {
    const entries = ["README.md", "src", "package.json", "index.html", ".oxlintrc.json"];
    const files = { "README.md": viteReadme, "src/App.tsx": viteApp };
    const kind = inPlaceKindOf(entries, read(files), 1);
    expect(kind.kind).toBe("шаблон");
    expect(kind.remove).toEqual([...entries].sort());
    // Четвёртый: в `src` и `public` нет файлов сверх шаблона. Свой файл там
    // делает папку живой — иначе посадка удалила бы его вместе с шаблоном.
    const template = ["src/App.tsx", "src/App.css", "src/main.tsx", "src/index.css", "src/vite-env.d.ts", "src/assets/react.svg", "src/assets/hero.png", "public/vite.svg", "package.json", "index.html"];
    expect(inPlaceKindOf(entries, read(files), 0, template).kind).toBe("шаблон");
    for (const own of ["src/cart.ts", "src/App.test.tsx", "src/pages/Home.tsx", "public/data.json", "src/assets/icons/x.svg"])
      expect(inPlaceKindOf(entries, read(files), 0, [...template, own]).kind, own).toBe("живой");
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

  // Выведено корпусом: `js-configs` без интерфейса оставался на Vite `5` при
  // согласии на приведение, а Vitest поднимался до `4`.
  it("проект без интерфейса: объявленный пакет оси интерфейса приводится к связке, недостающий не дописывается", () => {
    const s = survey({ devDependencies: { vite: "^5.4.11", vitest: "^2.1.8", typescript: "~5.6.3" } }, ["src/clamp.ts"]);
    const plan = planOf(s);
    expect(plan.vite).toEqual({ name: "vite", from: "^5.4.11", to: OURS.vite, section: "devDependencies" });
    for (const name of ["react", "react-dom", "@vitejs/plugin-react", "@types/react"]) expect(plan[name], name).toBeUndefined();
    const bare = survey({ devDependencies: { vitest: "^2.1.8", typescript: "~5.6.3" } }, ["src/clamp.ts"]);
    expect(planOf(bare).vite).toBeUndefined();
    expect(bare.rows.find((r) => r.axis === "сборщик").state).toBe("без предмета");
  });

  it("пакет оси, которого нет в проверенной связке, план не трогает", () => {
    const { vitest: _gone, ...partial } = OURS;
    const s = stackSurveyOf({
      manifest: { devDependencies: { vitest: "^2.1.8", typescript: "~5.6.3" } },
      files: ["src/a.ts"],
      axes: AXES,
      verified: partial,
      withTools: [],
      ui: PLATFORM.ui,
      alternatives: PLATFORM.alternatives,
    });
    expect(planOf(s).vitest).toBeUndefined();
  });

  it("предшественник пакета оси — план снимает его, установка удаляет из манифеста", () => {
    // Выведено одиннадцатой посадкой: `@typescript-eslint/*` `7` держат пиром
    // ESLint `8`, и `--apply` с ESLint `10` падал на конфликте.
    const old = { eslint: "^8.57.0", "@typescript-eslint/parser": "^7.18.0", "@typescript-eslint/eslint-plugin": "^7.18.0" };
    const s = stackSurveyOf({
      manifest: { devDependencies: { ...OURS, ...old } },
      files: ["src/main.tsx"],
      axes: AXES,
      verified: OURS,
      ui: PLATFORM.ui,
      alternatives: PLATFORM.alternatives,
    });
    const removed = s.plan.filter((one) => one.to === null);
    expect(removed).toEqual([
      { name: "@typescript-eslint/parser", from: "^7.18.0", to: null, section: "devDependencies" },
      { name: "@typescript-eslint/eslint-plugin", from: "^7.18.0", to: null, section: "devDependencies" },
    ]);
    expect(s.verdict).toBe("наше, неполное");
    expect(s.rows.find((r) => r.axis === "линтер").note).toContain("@typescript-eslint/parser ^7.18.0 → снять");
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stack-predecessor-"));
    try {
      fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ devDependencies: { ...OURS, ...old } }));
      expect(stackApply(dest, s, {}, () => ran(0, "", "")).ok).toBe(true);
      const root = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).devDependencies;
      expect(Object.keys(root).filter((one) => one.startsWith("@typescript-eslint/"))).toEqual([]);
      expect(root.eslint).toBe(OURS.eslint);
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

  it("установка — `npm`; без блокировки откат её не заводит; ключи секции по порядку", () => {
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
      "ESLint поднят ^8.57.1 → 10.13.0: старый конфиг .eslintrc.cjs он не читает: посадка кладёт конфиг обвязки действующим, а старый — рядом `.eslintrc.project*` (`seat/seat.md`, шаг 1-бис).",
    );
    for (const legacy of [".eslintrc", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml", ".eslintrc.js"])
      expect(eslintBoundaryOf(up, [legacy]), legacy).not.toBeNull();
    expect(eslintBoundaryOf(up, ["eslint.config.js", ".eslintrc.cjs.bak"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], from: "^9.30.0" }], [".eslintrc.cjs"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], from: null }], [".eslintrc.cjs"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], name: "prettier" }], [".eslintrc.cjs"])).toBeNull();
    expect(eslintBoundaryOf([{ ...up[0], to: "8.57.1" }], [".eslintrc.cjs"])).toBeNull();
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

  it("команда без папки и магазин на месте — отказ до работы", () => {
    const dest = boxWithShelf("seat-cli-");
    try {
      const bare = spawnSync(process.execPath, [path.join(dest, ".claude", "tools", "graph.mjs"), "seat"], {
        cwd: dest,
        encoding: "utf8",
      });
      expect(bare.status).toBe(1);
      expect(bare.stdout).toContain("Куда сажать, не сказано: seat <папка> [--shop].");
      const shop = seatHere(dest, "--shop");
      expect(shop.status).toBe(1);
      expect(shop.stdout).toContain("Магазин кладут на посадку в отдельную папку, а не на месте.");
      expect(fs.existsSync(path.join(dest, "CLAUDE.md"))).toBe(false);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 120000);

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

  it("живой проект: без git и с незакоммиченным — отказ; знакомому без согласия на стек — план, проект как был", () => {
    const bare = boxWithShelf("seat-live-");
    const dirty = boxWithShelf("seat-dirty-");
    const asked = boxWithShelf("seat-plan-");
    try {
      fs.mkdirSync(path.join(bare, "src"));
      fs.writeFileSync(path.join(bare, "src", "main.ts"), "export const x = 1;\n");
      const said = seatHere(bare, "--packages", ROOT);
      expect(said.status).toBe(1);
      expect(said.stdout).toContain("Живой проект без репозитория git");
      expect(fs.readdirSync(bare).sort()).toEqual([".claude", "src"]);
      for (const box of [dirty, asked]) {
        fs.mkdirSync(path.join(box, "src"));
        fs.writeFileSync(path.join(box, "src", "main.ts"), "export const x = 1;\n");
        fs.writeFileSync(
          path.join(box, "package.json"),
          JSON.stringify({ type: "module", devDependencies: { typescript: "~5.6.3", vitest: "^2.1.8" } }),
        );
        fs.renameSync(path.join(box, ".claude"), box + "-shelf");
        gitIn(box, "init", "-q");
        gitIn(box, "add", "-A");
        gitIn(box, "commit", "-qm", "project");
        fs.renameSync(box + "-shelf", path.join(box, ".claude"));
      }
      fs.writeFileSync(path.join(dirty, "src", "main.ts"), "export const x = 2;\n");
      fs.writeFileSync(path.join(dirty, "заметка.md"), "x\n");
      const busy = seatHere(dirty, "--packages", ROOT);
      expect(busy.status).toBe(1);
      expect(busy.stdout).toContain("Незакоммиченное в проекте");
      // Имя не в ASCII отказ называет как есть, а не кодами git.
      expect(busy.stdout).toContain("?? заметка.md");
      const plan = seatHere(asked, "--packages", ROOT);
      expect(plan.status).toBe(1);
      expect(plan.stdout).toContain("=== Посадка ждёт слова: стек приводится к связке ===");
      expect(plan.stdout).toContain("vitest: ^2.1.8 → ");
      expect(plan.stdout).toContain("seat . --apply");
      expect(gitIn(asked, "status", "--porcelain")).toBe("?? .claude/");
    } finally {
      for (const box of [bare, dirty, asked]) fs.rmSync(box, { recursive: true, force: true });
    }
  });

  it("git отказал на коммите пустой посадки — откат: папки git и метки нет, папка как была", () => {
    const dest = boxWithShelf("seat-nocommit-");
    const hooks = fs.mkdtempSync(path.join(os.tmpdir(), "seat-nocommit-hooks-"));
    const global = path.join(hooks, "gitconfig");
    try {
      fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\necho refused by the global hook >&2\nexit 1\n", { mode: 0o755 });
      fs.writeFileSync(global, "[user]\n\tname = t\n\temail = t@local\n[core]\n\thooksPath = " + hooks.replace(/\\/g, "/") + "\n");
      const run = spawnSync(
        process.execPath,
        [path.join(dest, ".claude", "tools", "graph.mjs"), "seat", dest, "--packages", ROOT],
        { cwd: dest, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1" } },
      );
      expect(run.status, run.stdout + run.stderr).toBe(1);
      expect(run.stdout).toContain("Коммит посадки не прошёл — git отказал:");
      expect(run.stdout).toContain("refused by the global hook");
      expect(run.stdout).toContain("Папка возвращена в прежний вид.");
      expect(fs.readdirSync(dest)).toEqual([".claude"]);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.rmSync(hooks, { recursive: true, force: true });
    }
  }, 300000);

  it("файлы посадки под правилом игнорирования — отказ с правилом: пустая под глобальным, живая под своим", () => {
    const dest = boxWithShelf("seat-hidden-");
    const live = boxWithShelf("seat-hidden-live-");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "seat-hidden-home-"));
    const global = path.join(home, "gitconfig");
    try {
      fs.writeFileSync(path.join(home, "ignore"), ".claude/\n");
      fs.writeFileSync(global, "[user]\n\tname = t\n\temail = t@local\n[core]\n\texcludesFile = " + path.join(home, "ignore").replace(/\\/g, "/") + "\n");
      const run = spawnSync(
        process.execPath,
        [path.join(dest, ".claude", "tools", "graph.mjs"), "seat", dest, "--packages", ROOT],
        { cwd: dest, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1" } },
      );
      expect(run.status, run.stdout + run.stderr).toBe(1);
      expect(run.stdout).toContain("Файлы посадки скрыты от git правилом игнорирования");
      expect(run.stdout).toMatch(/\.claude\/\S+ — правило .*ignore:1 `\.claude\/`/);
      expect(fs.readdirSync(dest)).toEqual([".claude"]);
      // Живой проект: своё правило в .gitignore, отказ до записи — проект как был.
      fs.writeFileSync(path.join(live, ".gitignore"), "node_modules/\n.claude/\n");
      fs.mkdirSync(path.join(live, "src"));
      fs.writeFileSync(path.join(live, "src", "main.ts"), "export const x = 1;\n");
      fs.writeFileSync(path.join(live, "package.json"), JSON.stringify({ type: "module", devDependencies: { typescript: "~5.6.3", vitest: "^2.1.8" } }));
      gitIn(live, "init", "-q");
      gitIn(live, "add", "-A");
      gitIn(live, "commit", "-qm", "project");
      const said = seatHere(live, "--apply", "--packages", ROOT);
      expect(said.status, said.stdout + said.stderr).toBe(1);
      expect(said.stdout).toContain("Файлы посадки скрыты от git правилом игнорирования");
      expect(said.stdout).toContain("правило .gitignore:2 `.claude/`");
      expect(gitIn(live, "status", "--porcelain")).toBe("");
      expect(gitIn(live, "log", "--format=%s").trim()).toBe("project");
    } finally {
      for (const one of [dest, live, home]) fs.rmSync(one, { recursive: true, force: true });
    }
  }, 300000);

  it("путь с «#» — отказ до работы с причиной: стек в таком пути файлов не находит", () => {
    const box = boxWithShelf("seat-hash#-");
    try {
      const said = seatHere(box, "--packages", ROOT);
      expect(said.status, said.stdout + said.stderr).toBe(1);
      expect(said.stdout).toContain("В пути папки есть «#»");
      expect(said.stdout).toContain("Перенести папку в путь без «#»");
      expect(fs.readdirSync(box)).toEqual([".claude"]);
      // `?` на Windows в пути запрещён, на Linux допустим: признак — одной функцией.
      expect(["/a/b#c", "/a/b?c", "/a/b c/д%e&f(g)!h"].map(stackBreakingCharOf)).toEqual(["#", "?", null]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);

  it("ключ, назвавший не то, — отказ до работы: --with= не ось-инструмент, --packages без папки", () => {
    const map = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "map.json"), "utf8"));
    expect(withToolsOf(["seat", ".", "--with=раннер тестов,линтер"], map)).toMatchObject({ tools: ["раннер тестов", "линтер"], unknown: [] });
    expect(withToolsOf(["seat", "."], map).tools).toEqual([]);
    const typo = withToolsOf(["env", ".", "--with=раннер"], map);
    expect(typo.unknown).toEqual(["раннер"]);
    expect(withRefusal(typo)?.[0]).toBe("Ключ --with= назвал не ось-инструмент карты: раннер.");
    // Ось без инструмента переставить нечем — она тоже не ось-инструмент.
    expect(withToolsOf(["env", ".", "--with=структура"], map).unknown).toEqual(["структура"]);
    expect(withRefusal(withToolsOf(["seat", "."], map))).toBeNull();
    // Пробелы вокруг имён и пустые места между запятыми — не имена; карты нет — осей нет.
    expect(withToolsOf(["seat", ".", "--with= линтер ,, раннер тестов ,"], map)).toMatchObject({ tools: ["линтер", "раннер тестов"], unknown: [] });
    expect(withToolsOf(["seat", ".", "--with=линтер"], undefined)).toMatchObject({ tools: [], unknown: ["линтер"], known: [] });
    const box = boxWithShelf("seat-flags-");
    try {
      const wrong = seatHere(box, "--with=раннер");
      expect(wrong.status, wrong.stdout).toBe(1);
      expect(wrong.stdout).toContain("Ключ --with= назвал не ось-инструмент карты: раннер.");
      const bare = seatHere(box, "--packages");
      expect(bare.status, bare.stdout).toBe(1);
      expect(bare.stdout).toContain("Ключ --packages без папки");
      expect(unknownFlagsOf(["seat", ".", "--apply", "--with=линтер", "--packages", "x", "--aply"], ["--apply", "--with=", "--packages"])).toEqual(["--aply"]);
      // Значение у ключа без значения — не тот ключ: `--apply=no` сделал бы обратное.
      expect(unknownFlagsOf(["--apply=no", "--with", "--packages=x"], ["--apply", "--with=", "--packages"])).toEqual(["--apply=no", "--with", "--packages=x"]);
      const typoFlag = seatHere(box, "--aply");
      expect(typoFlag.status, typoFlag.stdout).toBe(1);
      expect(typoFlag.stdout).toContain("Ключ посадке неизвестен: --aply.");
      const valued = seatHere(box, "--apply=no");
      expect(valued.status, valued.stdout).toBe(1);
      expect(valued.stdout).toContain("Ключ посадке неизвестен: --apply=no.");
      const envTypo = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", box, "--aply"], { cwd: ROOT, encoding: "utf8" });
      expect(envTypo.status, envTypo.stdout).toBe(1);
      expect(envTypo.stdout).toContain("=== Ключ режиму env неизвестен ===");
      const envNowhere = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", path.join(box, "nowhere")], { cwd: ROOT, encoding: "utf8" });
      expect(envNowhere.status, envNowhere.stdout + envNowhere.stderr).toBe(1);
      expect(envNowhere.stdout).toContain("Папки проекта нет:");
      expect(envNowhere.stderr).not.toMatch(/\n\s+at /);
      const env = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", box, "--with=раннер"], { cwd: ROOT, encoding: "utf8" });
      expect(env.status, env.stdout).toBe(1);
      expect(env.stdout).toContain("Ключ --with= назвал не ось-инструмент карты: раннер.");
      expect(fs.readdirSync(box)).toEqual([".claude"]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);

  it("настройка лежит незакоммиченной — посадку оборвали, а не «уже посажена»; закоммиченная — посажена", () => {
    const box = boxWithShelf("seat-cut-");
    const bare = boxWithShelf("seat-cut-bare-");
    try {
      const seedConfig = fs.readFileSync(path.join(SHELF, "seat", "templates", "graph.config.mjs"), "utf8");
      fs.writeFileSync(path.join(box, "main.ts"), "export const x = 1;\n");
      fs.renameSync(path.join(box, ".claude"), box + "-shelf");
      gitIn(box, "init", "-q");
      gitIn(box, "add", "-A");
      gitIn(box, "commit", "-qm", "project");
      fs.renameSync(box + "-shelf", path.join(box, ".claude"));
      fs.mkdirSync(path.join(box, ".context"));
      fs.writeFileSync(path.join(box, ".context", "graph.config.mjs"), seedConfig);
      const cut = seatHere(box, "--packages", ROOT);
      expect(cut.status, cut.stdout).toBe(1);
      expect(cut.stdout).toContain("Прошлую посадку оборвали до её коммита");
      expect(cut.stdout).toContain("git checkout -- . и git clean -fd -e .claude");
      expect(cut.stdout).not.toContain("уже посажена");
      gitIn(box, "add", ".context/graph.config.mjs");
      gitIn(box, "commit", "-qm", "seated");
      expect(seatHere(box, "--packages", ROOT).stdout).toContain("Обвязка здесь уже посажена");
      fs.mkdirSync(path.join(bare, ".context"));
      fs.writeFileSync(path.join(bare, ".context", "graph.config.mjs"), seedConfig);
      const loose = seatHere(bare, "--packages", ROOT);
      expect(loose.status, loose.stdout).toBe(1);
      expect(loose.stdout).toContain("Убрать из папки всё, кроме .claude");
      // Вход мастерской — посадка в папку с полки снаружи — опознаёт обрыв так же.
      fs.rmSync(path.join(bare, ".claude"), { recursive: true, force: true });
      const outside = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "seat", bare], { cwd: ROOT, encoding: "utf8" });
      expect(outside.status, outside.stdout).toBe(1);
      expect(outside.stdout).toContain("Прошлую посадку оборвали до её коммита");
      expect(outside.stdout).toContain("Убрать из папки всё, кроме .claude");
    } finally {
      for (const one of [box, bare, box + "-shelf"]) fs.rmSync(one, { recursive: true, force: true });
    }
  }, 120000);

  it("путь в папку git и репозиторий выше — у git, а не руками; у папки без `.git` — свой путь", () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "seat-gitpath-"));
    try {
      const lone = path.join(outer, "lone");
      fs.mkdirSync(lone);
      expect(gitPathOf(lone, "x")).toBe(path.join(lone, ".git", "x"));
      expect(enclosingRepoOf(lone)).toBeNull();
      const repo = path.join(outer, "repo");
      fs.mkdirSync(repo);
      gitIn(repo, "init", "-q");
      fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
      gitIn(repo, "add", "-A");
      gitIn(repo, "commit", "-qm", "a");
      expect(gitPathOf(repo, "x")).toBe(path.join(repo, ".git", "x"));
      expect(enclosingRepoOf(repo)).toBeNull();
      const sub = path.join(repo, "sub");
      fs.mkdirSync(sub);
      expect(fs.realpathSync(enclosingRepoOf(sub))).toBe(fs.realpathSync(repo));
      // Своего `.git` у подпапки нет — путь её, а не репозитория выше.
      expect(gitPathOf(sub, "x")).toBe(path.join(sub, ".git", "x"));
      // `.git` файлом, который ведёт в никуда: git не отвечает — путь у корня.
      const broken = path.join(outer, "broken");
      fs.mkdirSync(broken);
      fs.writeFileSync(path.join(broken, ".git"), "gitdir: " + path.join(outer, "nowhere") + "\n");
      expect(gitPathOf(broken, "x")).toBe(path.join(broken, ".git", "x"));
      const wt = path.join(outer, "wt");
      gitIn(repo, "worktree", "add", "-q", wt);
      expect(fs.statSync(path.join(wt, ".git")).isFile()).toBe(true);
      const marker = gitPathOf(wt, "x");
      expect(marker).not.toBe(path.join(wt, ".git", "x"));
      expect(fs.existsSync(path.dirname(marker))).toBe(true);
      expect(enclosingRepoOf(wt)).toBeNull();
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });

  it("пустая папка внутри чужого репозитория — отказ теми же словами, что живому проекту, вложенного репозитория нет", () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "seat-outer-"));
    const shelfBox = boxWithShelf("seat-inner-src-");
    try {
      gitIn(outer, "init", "-q");
      fs.writeFileSync(path.join(outer, "README.md"), "# outer\n");
      gitIn(outer, "add", "-A");
      gitIn(outer, "commit", "-qm", "outer");
      const inner = path.join(outer, "app");
      fs.mkdirSync(inner);
      fs.cpSync(path.join(shelfBox, ".claude"), path.join(inner, ".claude"), { recursive: true });
      const r = seatHere(inner, "--packages", ROOT);
      expect(r.status, r.stdout).toBe(1);
      expect(r.stdout).toContain("Проект лежит внутри репозитория");
      expect(r.stdout).toContain("Позвать посадку из корня репозитория");
      expect(fs.existsSync(path.join(inner, ".git"))).toBe(false);
      expect(fs.readdirSync(inner)).toEqual([".claude"]);
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
      fs.rmSync(shelfBox, { recursive: true, force: true });
    }
  }, 120000);

  // Отказы по доводам вызова: ни один из них прежде не исполнял ни один тест.
  it("довод, на котором посадка не начинается, назван, и папка не тронута: файл вместо папки, пакеты без node_modules, пакеты поверх своих, конфиг компилятора, который не разбирается", () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "seat-args-"));
    try {
      const file = path.join(outer, "file.txt");
      fs.writeFileSync(file, "x\n");
      const asFile = spawnSync(process.execPath, [path.join(SHELF, "tools", "graph.mjs"), "seat", file], { encoding: "utf8" });
      expect(asFile.status, asFile.stdout).toBe(1);
      expect(asFile.stdout).toContain("Это файл, а не папка: ");
      expect(fs.readFileSync(file, "utf8")).toBe("x\n");

      const empty = boxWithShelf("seat-nopk-");
      const noModules = path.join(outer, "nopk");
      fs.mkdirSync(noModules);
      const bare = seatHere(empty, "--packages", noModules);
      expect(bare.status, bare.stdout).toBe(1);
      expect(bare.stdout).toContain("Ключ --packages назвал папку без node_modules: ");
      expect(fs.readdirSync(empty)).toEqual([".claude"]);
      fs.rmSync(empty, { recursive: true, force: true });

      const own = boxWithShelf("seat-ownpk-");
      fs.mkdirSync(path.join(own, "src"));
      fs.writeFileSync(
        path.join(own, "package.json"),
        JSON.stringify({ name: "x", private: true, type: "module", devDependencies: { typescript: "~6.0.0", vitest: "^4.1.0" } }) + "\n",
      );
      fs.writeFileSync(path.join(own, "src", "one.ts"), "export const one = 1\n");
      fs.writeFileSync(path.join(own, ".gitignore"), "node_modules\n");
      gitIn(own, "init", "-q");
      gitIn(own, "add", "package.json", "src", ".gitignore");
      gitIn(own, "commit", "-qm", "project", "--no-verify");
      fs.mkdirSync(path.join(own, "node_modules"));
      const before = gitIn(own, "rev-parse", "HEAD");
      const over = seatHere(own, "--apply", "--packages", ROOT);
      expect(over.status, over.stdout).toBe(1);
      expect(over.stdout).toContain("Пакеты ссылкой кладутся только в проект без своей папки node_modules.");
      expect(gitIn(own, "rev-parse", "HEAD")).toBe(before);
      expect(gitIn(own, "status", "--porcelain", "--", "package.json", "src")).toBe("");
      fs.rmSync(own, { recursive: true, force: true });

      // Конфиг компилятора проекта, который не разбирается: сложение отказывает.
      const broken = boxWithShelf("seat-badts-");
      fs.mkdirSync(path.join(broken, "src"));
      fs.writeFileSync(
        path.join(broken, "package.json"),
        JSON.stringify({ name: "x", private: true, type: "module", devDependencies: { typescript: "~6.0.0", vitest: "^4.1.0" } }) + "\n",
      );
      fs.writeFileSync(path.join(broken, "src", "one.ts"), "export const one = 1\n");
      fs.writeFileSync(path.join(broken, "tsconfig.json"), '{ "compilerOptions": { "strict": true,\n');
      gitIn(broken, "init", "-q");
      gitIn(broken, "add", "package.json", "src", "tsconfig.json");
      gitIn(broken, "commit", "-qm", "project", "--no-verify");
      const unparsed = seatHere(broken, "--apply", "--packages", ROOT);
      expect(unparsed.status, unparsed.stdout).toBe(1);
      expect(unparsed.stdout).toContain("Конфиги проекта не сложились с конфигами обвязки: tsconfig.json проекта не разбирается");
      expect(unparsed.stdout).toContain("Проект возвращён в прежний вид.");
      expect(gitIn(broken, "status", "--porcelain")).toBe("?? .claude/");
      fs.rmSync(broken, { recursive: true, force: true });
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  }, 300000);

  it("репозиторий посреди операции либо на отсоединённой вершине — отказ до работы, папка не тронута", () => {
    const box = boxWithShelf("seat-busy-");
    try {
      expect(gitBusyOf(box)).toBeNull();
      fs.writeFileSync(path.join(box, "main.ts"), "export const x = 1;\n");
      fs.renameSync(path.join(box, ".claude"), box + "-shelf");
      gitIn(box, "init", "-q");
      gitIn(box, "add", "-A");
      gitIn(box, "commit", "-qm", "project");
      fs.renameSync(box + "-shelf", path.join(box, ".claude"));
      expect(gitBusyOf(box)).toBeNull();
      for (const [name, said] of [["rebase-merge", "перебазирование"], ["rebase-apply", "перебазирование"], ["MERGE_HEAD", "слияние"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["BISECT_LOG", "bisect"]]) {
        const at = path.join(box, ".git", name);
        if (name.startsWith("rebase-")) fs.mkdirSync(at);
        else fs.writeFileSync(at, "x\n");
        expect(gitBusyOf(box), name).toContain(said);
        expect(gitBusyOf(box), name).toContain("коммиты посадки легли бы посреди неё");
        fs.rmSync(at, { recursive: true, force: true });
      }
      gitIn(box, "checkout", "-q", "--detach");
      expect(gitBusyOf(box)).toContain("detached HEAD");
      const r = seatHere(box, "--packages", ROOT);
      expect(r.status, r.stdout).toBe(1);
      expect(r.stdout).toContain("Вершина отсоединена (detached HEAD)");
      expect(gitIn(box, "status", "--porcelain")).toBe("?? .claude/");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      fs.rmSync(box + "-shelf", { recursive: true, force: true });
    }
  }, 120000);

  it("битый манифест живого проекта — отказ с его именем, а не «package.json нет»; осмотр среды так же", () => {
    const box = boxWithShelf("seat-badjson-");
    try {
      fs.mkdirSync(path.join(box, "src"));
      fs.writeFileSync(path.join(box, "src", "main.ts"), "export const x = 1;\n");
      fs.writeFileSync(path.join(box, "package.json"), '{\n<<<<<<< HEAD\n  "name": "a"\n=======\n  "name": "b"\n>>>>>>> other\n}\n');
      fs.renameSync(path.join(box, ".claude"), box + "-shelf");
      gitIn(box, "init", "-q");
      gitIn(box, "add", "-A");
      gitIn(box, "commit", "-qm", "project");
      fs.renameSync(box + "-shelf", path.join(box, ".claude"));
      const said = seatHere(box, "--packages", ROOT);
      expect(said.status, said.stdout + said.stderr).toBe(1);
      expect(said.stdout).toContain("package.json проекта не разбирается как JSON");
      expect(said.stdout).not.toContain("package.json нет");
      expect(gitIn(box, "status", "--porcelain")).toBe("?? .claude/");
      const env = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "env", box], { cwd: ROOT, encoding: "utf8" });
      expect(env.status, env.stdout + env.stderr).toBe(1);
      expect(env.stdout).toContain("=== Окружение проекта не осмотрено ===");
      expect(env.stdout).toContain("package.json проекта не разбирается как JSON");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      fs.rmSync(box + "-shelf", { recursive: true, force: true });
    }
  }, 120000);

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

// Рекурсивное `cpSync` без фильтра роняет процесс на Windows, когда путь не
// по-латински (прогоны `72` и `74`); копия папки идёт через `copyTree`.
it("копия папки переносит вложенные папки и каждый файл, в путь не по-латински тоже", () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "zz-копия-"));
  try {
    const from = path.join(box, "откуда");
    fs.mkdirSync(path.join(from, "вложенная"), { recursive: true });
    fs.writeFileSync(path.join(from, "a.txt"), "a\n");
    fs.writeFileSync(path.join(from, "вложенная", "b.txt"), "b\n");
    const to = path.join(box, "куда");
    copyTree(from, to);
    expect(fs.readFileSync(path.join(to, "a.txt"), "utf8")).toBe("a\n");
    expect(fs.readFileSync(path.join(to, "вложенная", "b.txt"), "utf8")).toBe("b\n");
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

it("код инструмента не копирует папку рекурсивным cpSync без фильтра", () => {
  const bare = [];
  for (const name of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))) {
    const text = fs.readFileSync(path.join(TOOL_DIR, name), "utf8");
    for (let at = text.indexOf("cpSync("); at >= 0; at = text.indexOf("cpSync(", at + 1)) {
      let depth = 0;
      let end = at + "cpSync".length;
      do {
        if (text[end] === "(") depth += 1;
        if (text[end] === ")") depth -= 1;
        end += 1;
      } while (depth > 0 && end < text.length);
      const call = text.slice(at, end);
      if (/recursive:\s*true/.test(call) && !/filter:/.test(call))
        bare.push(name + ":" + text.slice(0, at).split("\n").length);
    }
  }
  expect(bare).toEqual([]);
});

// Связку читают текстом — посадка и загрузчик, — а правду о ней говорит
// импорт семени: правка семени, которую разбор текста не переварит, укоротила
// бы план стека без признака.
it("текстовый читатель связки читает семя так же, как его импорт", async () => {
  const seedAt = path.join(SHELF, "seat", "templates", "graph.config.mjs");
  const { CONFIG } = await import(pathToFileURL(seedAt).href);
  expect(verifiedOf(fs.readFileSync(seedAt, "utf8"))).toEqual(CONFIG.verifiedVersions);
});

// Установка пакетов посадкой — вторая копия версии npm: вписанная числом, она
// оставалась прежней при подъёме связки и плавала внутри старшей версии.
it("посадка ставит пакеты npm проверенной связки, и версии npm числом в коде инструмента нет", async () => {
  const { CONFIG } = await import(pathToFileURL(path.join(SHELF, "seat", "templates", "graph.config.mjs")).href);
  expect(npmOfShelf(SHELF)).toBe("npm@" + CONFIG.verifiedVersions.npm);
  // Связка без npm — отказ с причиной, а не установка `npm@undefined`.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "npm-of-shelf-"));
  try {
    fs.mkdirSync(path.join(bare, "seat", "templates"), { recursive: true });
    fs.writeFileSync(path.join(bare, "seat", "templates", "graph.config.mjs"), 'export const CONFIG = {\n  verifiedVersions: {\n    node: "22.23.2",\n  },\n};\n');
    expect(() => npmOfShelf(bare)).toThrow("в проверенной связке семени нет версии npm");
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
  const pinned = [];
  for (const name of fs.readdirSync(TOOL_DIR))
    if (name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
      for (const m of fs.readFileSync(path.join(TOOL_DIR, name), "utf8").matchAll(/npm@\d[\w.]*/g)) pinned.push(name + ": " + m[0]);
  expect(pinned).toEqual([]);
});

// Справочник называет постоянные инструмента числом: человеку нужна величина,
// а проза её не считает. Правка постоянной оставляла бы справочник прежним.
it("справочник называет постоянные инструмента их значениями", () => {
  const valueOf = (file, name) => {
    const m = new RegExp("const " + name + " = (\\d+);").exec(fs.readFileSync(path.join(TOOL_DIR, file), "utf8"));
    expect(m, file + ": " + name).not.toBeNull();
    return m[1];
  };
  const reference = fs.readFileSync(path.join(TOOL_DIR, "graph.md"), "utf8").replace(/\s+/g, " ");
  for (const [file, name, phrase] of [
    ["hook.mjs", "LIMIT_S", (v) => "не ответивший за `" + v + "` с"],
    ["graph.mjs", "BAR_STORE_KEEP", (v) => "не больше `" + v + "` протоколов"],
    ["graph.mjs", "PAGE_SLICE_LINES", (v) => "не длиннее `" + v + "` строк"],
    ["graph.mjs", "BAR_HOLES_GROUP", (v) => "у вида от `" + v + "` дыр"],
  ])
    expect(reference, name).toContain(phrase(valueOf(file, name)));
});

// Проза называет человеку команды и пути, а исполняет их он сам: режим,
// переименованный в инструменте, ключ, снятый с режима, скрипт, убранный из
// семени, и файл, переехавший в полке, оставляли инструкцию неисполнимой.
it("каждая команда, ключ, скрипт и путь полки, названные в прозе, существуют", () => {
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const marker = gitPathOf(ROOT, SEAT_MARKER);
  const workshopShelf = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  const readmes = workshopShelf === "" ? [] : ["README.md", "README.ru.md"].map((one) => path.join(path.dirname(workshopShelf), one)).filter((one) => fs.existsSync(one));
  // Обоснование — история: прежние имена в нём законны; семена — проза проекта.
  const prose = [
    ...walk(SHELF).filter((f) => f.endsWith(".md") && !f.includes(path.sep + "rationale" + path.sep) && !f.includes(path.sep + "templates" + path.sep)),
    ...readmes,
  ];
  const source = (name) => fs.readFileSync(path.join(TOOL_DIR, name), "utf8");
  const modes = new Set([...source("graph.mjs").matchAll(/mode === "([\w-]+)"/g)].map((m) => m[1]));
  const flags = new Set(
    ["graph.mjs", "graph.seat.mjs", "graph.seatlive.mjs", "graph.series.mjs", "hook.mjs"].flatMap((name) =>
      [...source(name).matchAll(/"(--[\w-]+)/g)].map((m) => m[1]),
    ),
  );
  const scripts = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "templates", "package.json"), "utf8")).scripts));
  const missing = [];
  let seen = 0;
  for (const file of prose) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/graph\.mjs\s+([a-z][\w-]*)((?:\s+[^`\n|]*)?)/g)) {
      seen += 1;
      if (!modes.has(m[1])) missing.push(rel + ": режим " + m[1]);
      for (const one of m[2].matchAll(/(--[\w-]+)/g)) if (!flags.has(one[1])) missing.push(rel + ": ключ " + one[1] + " у " + m[1]);
    }
    for (const m of text.matchAll(/npm run (?:-s )?([\w:.-]+)/g)) {
      seen += 1;
      if (!scripts.has(m[1])) missing.push(rel + ": скрипт " + m[1]);
    }
    for (const m of text.matchAll(/`((?:\.claude\/)?(?:rules|tools|seat|skills|rationale|hooks|state)\/[\w./-]+)`/g)) {
      const one = m[1].replace(/^\.claude\//, "").replace(/:\d+$/, "");
      seen += 1;
      if (!fs.existsSync(path.join(SHELF, one))) missing.push(rel + ": путь " + m[1]);
    }
  }
  expect(seen).toBeGreaterThan(100);
  expect(missing).toEqual([]);
});

// Справочник — единственное место, где режим описан человеку: режим без
// статьи существует только для того, кто читал код, статья без режима
// описывает то, чего нет.
it("у каждого режима инструмента своя статья в справочнике, и у каждой статьи — режим", () => {
  const modes = new Set([...fs.readFileSync(path.join(TOOL_DIR, "graph.mjs"), "utf8").matchAll(/mode === "([\w-]+)"/g)].map((m) => m[1]));
  const entries = new Set([...fs.readFileSync(path.join(TOOL_DIR, "graph.md"), "utf8").matchAll(/^### `([\w-]+)/gm)].map((m) => m[1]));
  expect(modes.size).toBeGreaterThan(20);
  expect([...modes].filter((one) => !entries.has(one)), "режим без статьи").toEqual([]);
  expect([...entries].filter((one) => !modes.has(one)), "статья без режима").toEqual([]);
});

// Одно знание двумя списками расходится без признака: места конвейера жили
// тремя копиями, и `.circleci` знали две. Тест держит вид: один и тот же
// набор строк в двух местах кода инструмента стоит исключением с причиной.
it("один набор строк не стоит в коде инструмента дважды без причины", () => {
  const EXEMPT = new Map([
    ["ignore|pipe", "опции stdio дочернего процесса, а не знание"],
    ["--verify|-q|HEAD|rev-parse", "доводы одной команды git, а не перечень"],
    ["dir|heading|table", "части двух разных полей настройки, совпавшие составом"],
    ["allow|ask|deny", "в graph.mjs — порядок старшинства видов разрешений, в посадке — проверка их состава"],
  ]);
  const LINT_SHARED = "@eslint-react/web-api-no-leaked-event-listener";
  const seen = new Map();
  for (const file of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.includes(".test.") && f !== "graph.modes.shared.mjs")) {
    const text = fs.readFileSync(path.join(TOOL_DIR, file), "utf8");
    for (const m of text.matchAll(/\[((?:\s*"[^"\n]{1,60}"\s*,){2,}\s*"[^"\n]{1,60}"\s*,?\s*)\]/g)) {
      const key = [...new Set([...m[1].matchAll(/"([^"\n]{1,60})"/g)].map((x) => x[1]))].sort().join("|");
      const at = file + ":" + text.slice(0, m.index).split("\n").length;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(at);
    }
  }
  const used = new Set();
  const twice = [];
  for (const [key, at] of seen) {
    if (at.length < 2) continue;
    // Одно правило линта держит несколько критериев: строка на критерий.
    if (key.includes(LINT_SHARED)) continue;
    if (EXEMPT.has(key)) used.add(key);
    else twice.push(at.join(" ") + " — " + key);
  }
  expect(twice, "один набор строк дважды").toEqual([]);
  expect([...EXEMPT.keys()].filter((key) => !used.has(key)), "исключение, которому нечего исключать").toEqual([]);
});

// Экспорт, которого не берёт никто, — спящая копия: `SCENARIOS` повторял
// ключи `SCENARIO_NAMES` и не читался ни одним файлом. Тест держит вид.
it("каждый экспорт модуля инструмента где-то используется", () => {
  const all = fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs")).map((f) => [f, fs.readFileSync(path.join(TOOL_DIR, f), "utf8")]);
  const unused = [];
  for (const [file, text] of all) {
    if (file.includes(".test.")) continue;
    for (const m of text.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)) {
      const name = new RegExp("\\b" + m[1] + "\\b", "g");
      const uses = all.reduce((n, [, other]) => n + (other.match(name) ?? []).length, 0);
      if (uses <= 1) unused.push(file + ": " + m[1]);
    }
  }
  expect(unused, "экспорт без единого использования").toEqual([]);
});

// Проза называет сверку именем, по которому её ищут в выводе и в таблице:
// «числа в прозе базы» строчной не находился поиском заголовка. Тест держит
// вид: имя сверки в прозе полки — заголовок существующей сверки.
it("каждое имя сверки в прозе полки — заголовок существующей сверки", () => {
  const EXEMPT = new Map([
    ["…", "заполнитель в описании формы, а не имя"],
    ["якорь → пометка", "отклонённый вариант: сверка, которая «краснела бы», не заведена"],
  ]);
  const shelf = path.join(TOOL_DIR, "..");
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const names = new Set(
    [...fs.readFileSync(path.join(TOOL_DIR, "checks.md"), "utf8").matchAll(/^\| ([^|]+?) \|/gm)].map((m) =>
      norm(m[1]).replace(/ \([^)]*\)$/, ""),
    ),
  );
  const prose = [
    ...["rules", "rationale", "tools", "seat"].flatMap((dir) =>
      fs.readdirSync(path.join(shelf, dir)).filter((f) => f.endsWith(".md")).map((f) => path.join(dir, f)),
    ),
    ...fs.readdirSync(path.join(shelf, "skills")).filter((d) => fs.existsSync(path.join(shelf, "skills", d, "SKILL.md"))).map((d) => path.join("skills", d, "SKILL.md")),
    "README.md",
    path.join("skills", "README.md"),
  ];
  const used = new Set();
  const unknown = [];
  for (const rel of prose)
    for (const m of fs.readFileSync(path.join(shelf, rel), "utf8").matchAll(/сверк\p{L}*\s+«([^»«]+)»/gu)) {
      const name = norm(m[1]);
      if (EXEMPT.has(name)) used.add(name);
      else if (!names.has(name)) unknown.push(rel + ": " + name);
    }
  expect(names.size).toBeGreaterThan(100);
  expect(unknown, "имя сверки, которой нет").toEqual([]);
  expect([...EXEMPT.keys()].filter((k) => !used.has(k)), "исключение, которому нечего исключать").toEqual([]);
});

// Пустой перехват превращает сбой в «ничего не случилось», и без строки причины
// не видно, исход ли это или забытая ветка. Тест держит вид: тело перехвата
// без кода несёт строку, что этот исход значит.
it("каждый пустой перехват ошибки в инструменте называет свой исход строкой", () => {
  const bare = [];
  let empty = 0;
  for (const file of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))) {
    const lines = fs.readFileSync(path.join(TOOL_DIR, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = /\} catch(?: \(\w+\))? \{(.*)$/.exec(line);
      if (m === null) return;
      let depth = 1 + (m[1].match(/\{/g) ?? []).length - (m[1].match(/\}/g) ?? []).length;
      const body = m[1].trim() === "" ? [] : [m[1]];
      for (let j = i + 1; j < lines.length && depth > 0; j += 1) {
        depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
        body.push(lines[j]);
      }
      const inner = body.map((one) => one.trim()).filter((one) => one !== "" && one !== "}");
      if (inner.some((one) => !one.startsWith("//"))) return;
      empty += 1;
      if (inner.length === 0) bare.push(file + ":" + (i + 1));
    });
  }
  expect(empty).toBeGreaterThan(10);
  expect(bare, "пустой перехват без строки причины").toEqual([]);
});

// Режим, который не зовёт ни один тест, меняет ответ без признака: `sizes` и
// `twins` не звал никто, и `sizes` отвечал нулём на адрес, где файл есть.
it("каждый режим инструмента зовёт хоть один тест", () => {
  const modes = [...fs.readFileSync(path.join(TOOL_DIR, "graph.md"), "utf8").matchAll(/^### `([\w-]+)/gm)].map((m) => m[1]);
  const tests = fs
    .readdirSync(TOOL_DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => fs.readFileSync(path.join(TOOL_DIR, f), "utf8"))
    .join("\n");
  expect(modes.length).toBeGreaterThan(20);
  expect(modes.filter((m) => !tests.includes('"' + m + '"')), "режим без теста").toEqual([]);
});

// Отказ, до которого не доходит ни один тест, меняет текст и код возврата без
// признака, а человек получает его как ответ инструмента. Тест держит вид
// целиком: новый отказ без теста роняет набор, пока его не назовут тестом либо
// исключением с причиной.
it("каждый отказ инструмента назван тестом либо исключением с причиной", () => {
  // EXITS-EXEMPT-BEGIN
  const EXEMPT = [
    ["outOfScope(", "общий ответ на адрес без ответа — тест «режим с адресом на адрес без ответа»"],
    ["noRadiusOf(", "тот же общий ответ у режимов радиуса"],
    ['console.log("  команда " + run.error)', "звено не запустилось — сбой среды"],
    ["Отдавать нельзя: у получателя он не встанет", "снимок не прошёл самопроверку — ломается только сама полка, её держат тесты полки"],
    ["git недоступен — передай пути аргументами", "git недоступен — сбой среды"],
    ["git недоступен — ворота проверить нечем", "git недоступен — сбой среды"],
    ["Связка мутатора и раннера не гоняет тесты", "сбой орудия мутаций, не ввод человека"],
    ['"  Коммит части " + t.part', "git отказал в коммите части — сбой среды"],
    ['"=== Ответы не вписаны ==="', "причины отказа bar-fill держит его тест поимённо"],
    ["корпус назван, но это не число", "страж самого инструмента: сверка напечатала не число"],
    ["Таблицу применимости прочитать не удалось", "таблица применимости в фактах сломана руками — теста нет, не взято"],
    ["Предмет свода не определить", "git недоступен — сбой среды"],
    ["=== Ворота стенда ===", "инфраструктура проб планки: стенд"],
    ["=== Книга проб планки не читается ===", "инфраструктура проб планки: книга посадок"],
    ["живых критериев планки", "инфраструктура проб планки: посадка без живого критерия"],
    ["=== Рецептов фальсификации нет ===", "рецептов нет только у сломанной полки — их держат тесты falsify"],
    ["=== Обвязка не заявлена ===", "handoff вне посадки — теста нет, не взято"],
    ["протокол уже закрыт и правлен после этого", "правка запечатанного протокола — теста на этот текст нет, не взято"],
    ["слой судят по фактам модели", "страницы протокола слоя — теста на этот текст нет, не взято"],
    ["Папка не тронута.", "текст отказа — ответ gitBusyOf, его держит тест gitBusyOf"],
    ["Поправить файл, закоммитить и позвать посадку снова", "текст — ответ profileOf; ветку проходит тест «package.json проекта не разбирается»"],
    ["Семена не легли", "внутренний сбой посадки: откат один, его держит тест «звено, не поймавшее посаженную ошибку»"],
    ["Проверка красная на свежей посадке", "внутренний сбой посадки: тот же откат"],
    ["Базовая линия не записалась", "внутренний сбой посадки: тот же откат"],
    ["Ожидался файл: ", "инфраструктура стенда проб: файл магазина"],
    ["Полка сажается сама в себя", "достижим только сборкой стенда проб"],
    ["Магазин кладут на свежую посадку", "инфраструктура стенда проб: магазин"],
    ["В семени настройки нет строки", "сломанное семя — сломанная полка"],
    ["Настройка не записалась", "внутренний сбой живой посадки: откат один, его держит тест «Посадка упала посреди работы»"],
    ["не назвало число ошибок", "внутренний сбой живой посадки: тот же откат"],
    ["В настройке нет вида долга", "сломанное семя — сломанная полка"],
    ["Сверка базы не отдала факты посадки", "внутренний сбой живой посадки: тот же откат"],
    ["красное на свежей посадке", "внутренний сбой живой посадки: тот же откат"],
  ];
  // EXITS-EXEMPT-END
  const own = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const tests = fs
    .readdirSync(TOOL_DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => fs.readFileSync(path.join(TOOL_DIR, f), "utf8"))
    .join("\n")
    .replace(own, own.slice(0, own.indexOf("// EXITS-EXEMPT-BEGIN")) + own.slice(own.indexOf("// EXITS-EXEMPT-END")));
  // Два признака, и каждый ошибается в свою сторону: двадцать знаков подряд не
  // видят короткой подстроки в утверждении, строка утверждения не видит
  // регулярного выражения и склейки. Окно в четырнадцать знаков находило в двух
  // мегабайтах тестов общий оборот любого нового отказа.
  const asserted = [
    ...new Set(
      [...tests.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)]
        .map((m) => m[2].replace(/\s+/g, " ").trim())
        .filter((one) => /[а-яё]/i.test(one) && one.length >= 12),
    ),
  ];
  const named = (literal) => {
    const text = literal.replace(/\s+/g, " ").replace(/^[=\s]+|[=\s:.]+$/g, "").trim();
    const width = Math.min(20, text.length);
    for (let k = 0; k + width <= text.length; k += 1) if (tests.includes(text.slice(k, k + width))) return true;
    return text.length >= 12 && asserted.some((one) => text.includes(one) || one.includes(text));
  };
  const used = new Set();
  const bare = [];
  let exits = 0;
  for (const file of ["graph.mjs", "hook.mjs", "graph.series.mjs"]) {
    const lines = fs.readFileSync(path.join(TOOL_DIR, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/process\.exit\(\s*[12]\s*\)|process\.exitCode\s*=\s*[12]\b/.test(line)) return;
      exits += 1;
      const window = lines.slice(Math.max(0, i - 10), i + 1).join("\n");
      const literals = [...window.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((one) => /[а-яё]/i.test(one) && one.trim().length >= 14);
      if (literals.some(named)) return;
      const hit = EXEMPT.find(([key]) => window.includes(key));
      if (hit === undefined) bare.push(file + ":" + (i + 1) + " " + (literals.at(-1) ?? "").trim());
      else used.add(hit[0]);
    });
  }
  // Отказы посадки идут через `refuse` и `fail` её модулей, а не через выход.
  for (const file of ["graph.seat.mjs", "graph.seatlive.mjs", "graph.profile.mjs", "graph.configs.mjs"]) {
    const text = fs.readFileSync(path.join(TOOL_DIR, file), "utf8");
    for (const m of text.matchAll(/\b(?:refuse|fail)\(/g)) {
      let depth = 1;
      let end = m.index + m[0].length;
      for (; end < text.length && depth > 0; end += 1)
        if (text[end] === "(") depth += 1;
        else if (text[end] === ")") depth -= 1;
      const call = text.slice(m.index, end);
      const literals = [...call.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).filter((one) => /[а-яё]/i.test(one) && one.trim().length >= 12);
      if (literals.length === 0) continue;
      exits += 1;
      if (literals.some(named)) continue;
      const hit = EXEMPT.find(([key]) => call.includes(key));
      if (hit === undefined) bare.push(file + ":" + text.slice(0, m.index).split("\n").length + " " + literals[0].trim());
      else used.add(hit[0]);
    }
  }
  expect(exits).toBeGreaterThan(80);
  expect(bare, "отказ без теста и без исключения").toEqual([]);
  expect(EXEMPT.map(([key]) => key).filter((key) => !used.has(key)), "исключение, которому нечего исключать").toEqual([]);
});

// Адрес режима, прочитанный мимо общего разбора, не узнаёт формы, которые
// узнают прочие режимы: `sizes` отвечал «файлов: 0» с кодом 0 на `src/app/App`
// и на путь с обратной косой Windows. Тест держит вид: каждое чтение довода
// режима идёт через общий разбор либо стоит исключением с причиной.
it("каждый довод режима из командной строки приводится общим разбором либо исключён с причиной", () => {
  const EXEMPT = [
    ['command = process.argv.slice(3).join(" ")', "команда стража — строка оболочки, а не адрес"],
    ["const rest = process.argv.slice(3);", "путь журнала расхода — файл системы, его читает existsSync как есть"],
    ["const projectAt = process.argv[3]", "папка посадки — путь системы, её разрешает path.resolve посадки"],
    ["unknownFlagsOf(process.argv.slice(3)", "ключи посадки, не адрес"],
    ["const asked = process.argv[3] ?? null;", "папка снимка handoff — путь системы"],
    ["const judged = process.argv.slice(3)", "номер посадки пробы планки, не адрес"],
    ["const refreshArgs = process.argv.slice(3);", "ключ согласия refresh, не адрес"],
    ['process.argv[3] === "--fired"', "ключ режима, не адрес"],
    ['const logAt = process.argv[4] ?? ""', "журнал срабатываний — файл системы"],
    ['"  `" + process.argv[3] + "`', "адрес, напечатанный человеку как он его дал"],
  ];
  const lines = fs.readFileSync(path.join(TOOL_DIR, "graph.mjs"), "utf8").split("\n");
  const SHARED = /argPath\(|canonicalList\(|canonical\(|path\.resolve\(/;
  const used = new Set();
  const bare = [];
  let reads = 0;
  lines.forEach((line, i) => {
    if (!/process\.argv\[[3-9]\]|process\.argv\.slice\([3-9]\)/.test(line)) return;
    reads += 1;
    const hit = EXEMPT.find(([key]) => line.includes(key));
    if (hit !== undefined) return void used.add(hit[0]);
    if (!SHARED.test(lines.slice(i, i + 5).join("\n"))) bare.push(i + 1 + ": " + line.trim());
  });
  expect(reads).toBeGreaterThan(15);
  expect(bare, "довод режима мимо общего разбора").toEqual([]);
  expect(EXEMPT.map(([key]) => key).filter((key) => !used.has(key)), "исключение, которому нечего исключать").toEqual([]);
});

// Дата, которую инструмент пишет человеку, — день его часов. Срез `toISOString`
// даёт день по UTC: посадка в поясе UTC+3 после полуночи получала вчерашний.
it("дата для человека — по местным часам в любом поясе, а не срез UTC", () => {
  const seatAt = pathToFileURL(path.join(TOOL_DIR, "graph.seat.mjs")).href;
  const dayIn = (zone, instant) =>
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `import { localDay } from ${JSON.stringify(seatAt)}; console.log(localDay(new Date(${JSON.stringify(instant)})))`],
      { encoding: "utf8", env: { ...process.env, TZ: zone } },
    ).trim();
  expect(dayIn("Europe/Moscow", "2026-03-01T22:30:00Z")).toBe("2026-03-02");
  expect(dayIn("America/Los_Angeles", "2026-03-02T03:30:00Z")).toBe("2026-03-01");
  expect(dayIn("UTC", "2026-12-31T23:59:00Z")).toBe("2026-12-31");
  const sliced = [];
  for (const file of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    fs.readFileSync(path.join(TOOL_DIR, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Разбор даты из текста обратно в ту же форму — по UTC с обеих
        // сторон, и он законен: строку проверки даты пропускают.
        if (/Date\.parse\(d \+ "T00:00:00Z"\)|new Date\(t\)\.toISOString\(\)\.slice\(0, 10\) !== d/.test(line)) return;
        // День для человека срезом метки ISO — в любой записи: от `new Date()`
        // и от сохранённой метки `at` паузы и следа.
        if (/toISOString\(\)\.slice\(0, ?10\)|\b(iso|at)\b[^;]*\.slice\(0, ?10\)/.test(line)) sliced.push(file + ":" + (i + 1));
      });
  expect(sliced, "дата для человека срезом UTC").toEqual([]);
});

// Чтение среды и платформы ведёт себя по-разному на другой машине, а другая
// машина проверяется только набором на Windows: место, до которого не доходит
// тест, там не проверено ничем. Тест держит вид: переменная среды названа
// тестом, обращение к платформе — исключением с причиной.
it("каждое чтение среды и платформы в инструменте названо тестом либо исключением с причиной", () => {
  const PLATFORM_EXEMPT = [
    ["graph.mjs", 'process.platform !== "win32"', "бит исполнения хука git на Windows не читается; сверку хуков гоняет набор на Windows"],
    ["graph.mjs", "homedir()", "папка журналов по умолчанию; тест расхода задаёт CLAUDE_CONFIG_DIR"],
    ["graph.modes.shared.mjs", "os.tmpdir()", "оснастка тестов"],
    ["graph.seat.mjs", "tmpdir()", "systemTemp: настоящее имя временной папки, найдено набором на Windows; держит тест systemTemp"],
    ["graph.seat.mjs", 'process.platform === "win32" ? "TEMP" : "TMPDIR"', "текст отказа systemTemp"],
    ["graph.seat.mjs", "platform = process.platform", "runTool: платформа доводом, тест подставляет win32"],
    ["hook.mjs", "tmpdir()", "запись клапана хука вне git — тест «без git клапан конца хода пишет запись во временную папку»"],
  ];
  const ENV_EXEMPT = new Map([
    ["PATH", "обёртки долга дописывают .bin; npm run уже кладёт его сам, а Node на Windows берёт первый ключ по сортировке — PATH раньше Path"],
    ["GRAPH_BAR_CHECKS", "метка вложенного verify свода — ставит и читает сам инструмент, её проходит любой тест bar"],
    ["GRAPH_SEAT_FACTS", "файл фактов посадки — ставит посадка, её проходит корпусный тест"],
    ["GRAPH_SERIES_PART", "номер части серии — ставит серия, её проходят тесты series"],
  ]);
  const tools = ["graph.mjs", "graph.modes.shared.mjs", "graph.seat.mjs", "graph.seatlive.mjs", "graph.profile.mjs", "graph.configs.mjs", "graph.series.mjs", "hook.mjs"];
  const tests = fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".test.mjs")).map((f) => fs.readFileSync(path.join(TOOL_DIR, f), "utf8")).join("\n");
  const bareEnv = [];
  const barePlatform = [];
  const used = new Set();
  const texts = new Map(tools.map((file) => [file, fs.readFileSync(path.join(TOOL_DIR, file), "utf8")]));
  // Имя переменной стоит константой и в соседнем модуле: разрешают по всем.
  const consts = new Map([...[...texts.values()].join("\n").matchAll(/const (\w+) = "([A-Z_]+)";/g)].map((m) => [m[1], m[2]]));
  for (const [file, text] of texts) {
    for (const m of text.matchAll(/process\.env\.([A-Z_]+)|process\.env\[(\w+)\]/g)) {
      const name = m[1] ?? consts.get(m[2]) ?? m[2];
      if (ENV_EXEMPT.has(name)) used.add("env:" + name);
      else if (!tests.includes(name)) bareEnv.push(file + ": " + name);
    }
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line) || !/process\.platform|tmpdir\(\)|homedir\(\)/.test(line)) return;
      const hit = PLATFORM_EXEMPT.find(([f, key]) => f === file && line.includes(key));
      if (hit === undefined) barePlatform.push(file + ":" + (i + 1) + ": " + line.trim());
      else used.add(hit[0] + hit[1]);
    });
  }
  expect(bareEnv, "переменная среды без теста и без исключения").toEqual([]);
  expect(barePlatform, "обращение к платформе без исключения").toEqual([]);
  const stale = [
    ...PLATFORM_EXEMPT.filter(([f, key]) => !used.has(f + key)).map(([f, key]) => f + ": " + key),
    ...[...ENV_EXEMPT.keys()].filter((name) => !used.has("env:" + name)),
  ];
  expect(stale, "исключение, которому нечего исключать").toEqual([]);
});

// На Windows менеджер пакетов и его бинарники — файлы `.cmd`: без оболочки их
// не найти, а строку оболочки `cmd.exe` разбирает по-своему. Набор на Windows
// видит только то, до чего дошёл тест. Тест держит вид: запуск внешней
// программы — `git` либо сам Node напрямую (оба `.exe`) или общий `runTool`.
it("каждый запуск внешней программы в инструменте идёт напрямую к git и Node либо общим запуском", () => {
  const DIRECT = new Set(['"git"', "process.execPath"]);
  const EXEMPT = [["graph.seat.mjs", "spawnSync(command, said", "runTool — сам общий запуск; платформу держат его тесты с win32"]];
  const used = new Set();
  const bare = [];
  let launches = 0;
  for (const file of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))) {
    const text = fs.readFileSync(path.join(TOOL_DIR, file), "utf8");
    const lineOf = (at) => text.slice(0, at).split("\n").length;
    for (const m of text.matchAll(/import\s*(\{[^}]*\}|\*\s*as\s+\w+|\w+)\s*from\s*"(?:node:)?child_process"|import\(\s*"(?:node:)?child_process"\s*\)/g))
      if (m[1] === undefined || !/^\{\s*(?:execFileSync|spawnSync)(?:\s*,\s*(?:execFileSync|spawnSync))?\s*\}$/.test(m[1]))
        bare.push(file + ":" + lineOf(m.index) + " импорт мимо execFileSync и spawnSync: " + m[0]);
    // Предел вывода — одна постоянная инструмента и её копия в обёртке хуков.
    if (!["graph.seat.mjs", "hook.mjs"].includes(file) && /\d+ \* 1024 \* 1024/.test(text)) bare.push(file + " предел вывода числом, а не CHILD_OUTPUT_BYTES");
    for (const m of text.matchAll(/(?<![.\w])(execFileSync|spawnSync)\(\s*([^,]*?)\s*,/gs)) {
      if (/^\s*(\/\/|\*)/.test(text.split("\n")[lineOf(m.index) - 1])) continue;
      launches += 1;
      // Умолчание Node — `1` МиБ вывода: журнал большой истории его переходит,
      // и отказ читался как «истории нет». Предел несёт каждый запуск — в
      // самом вызове либо в объекте настроек, названном рядом.
      let depth = 0;
      let end = m.index;
      for (; end < text.length; end += 1)
        if (text[end] === "(") depth += 1;
        else if (text[end] === ")" && (depth -= 1) === 0) break;
      const call = text.slice(m.index, end);
      const named = /,\s*(\w+)\s*,?\s*$/.exec(call);
      const held = /maxBuffer/.test(call) || (named !== null && new RegExp("const " + named[1] + " = \\{[^}]*maxBuffer").test(text));
      if (!held) bare.push(file + ":" + lineOf(m.index) + " без maxBuffer");
      if (DIRECT.has(m[2].replace(/\s+/g, " "))) continue;
      const hit = EXEMPT.find(([f, key]) => f === file && text.startsWith(key, m.index));
      if (hit === undefined) bare.push(file + ":" + lineOf(m.index) + " " + m[1] + "(" + m[2].slice(0, 60));
      else used.add(hit[0] + hit[1]);
    }
  }
  expect(launches).toBeGreaterThan(50);
  expect(bare, "запуск мимо git, Node и runTool").toEqual([]);
  // Обёртка хуков инструмент не импортирует и держит предел своей копией.
  const limitOf = (file) => /const CHILD_OUTPUT_BYTES = ([^;]+);/.exec(fs.readFileSync(path.join(TOOL_DIR, file), "utf8"))?.[1];
  expect(limitOf("hook.mjs"), "предел обёртки хуков").toBe(limitOf("graph.seat.mjs"));
  expect(limitOf("graph.seat.mjs")).toBeDefined();
  expect(EXEMPT.filter(([f, key]) => !used.has(f + key)).map(([f, key]) => f + ": " + key), "исключение, которому нечего исключать").toEqual([]);
});

// Без `-z` git берёт путь не в ASCII в кавычки с восьмеричными кодами: отказ
// посадки называл файл `"\320\267..."`, а такого пути на диске нет. Тест держит
// вид: каждый список доводов git, печатающий пути, несёт `-z`.
it("каждый вызов git, печатающий пути, читает их через -z либо назван исключением", () => {
  const EXEMPT = [
    ["graph.mjs", '["status", "--porcelain", "--", protoAt]', "читает только пустоту вывода, путь не разбирает"],
    ["graph.seat.mjs", '["ls-files", "--error-unmatch",', "только код возврата, вывод погашен"],
  ];
  const used = new Set();
  const bare = [];
  let lists = 0;
  for (const file of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))) {
    const text = fs.readFileSync(path.join(TOOL_DIR, file), "utf8");
    for (const m of text.matchAll(/\[\s*(?:"-c",\s*"[^"]*",\s*)?"(?:status|ls-files|diff)"[^\]]*\]/g)) {
      const flat = m[0].replace(/\s+/g, " ").replace(/\[ /, "[").replace(/,? \]$/, "]");
      if (!/"(?:status|ls-files)"|"--name-(?:only|status)"/.test(flat)) continue;
      lists += 1;
      if (flat.includes('"-z"')) continue;
      const hit = EXEMPT.find(([f, key]) => f === file && flat.startsWith(key));
      if (hit === undefined) bare.push(file + ":" + text.slice(0, m.index).split("\n").length + " " + flat);
      else used.add(hit[0] + hit[1]);
    }
  }
  expect(lists).toBeGreaterThan(8);
  expect(bare, "путь из вывода git без -z").toEqual([]);
  expect(EXEMPT.filter(([f, key]) => !used.has(f + key)).map(([f, key]) => f + ": " + key), "исключение, которому нечего исключать").toEqual([]);
  // Разбор: путь как есть, прежний путь переименования и копии — своим полем.
  expect(statusEntries("?? заметка.md\0R  new.ts\0old.ts\0 M a b.md\0C  c2.ts\0c.ts\0")).toEqual([
    { xy: "??", path: "заметка.md", from: null },
    { xy: "R ", path: "new.ts", from: "old.ts" },
    { xy: " M", path: "a b.md", from: null },
    { xy: "C ", path: "c2.ts", from: "c.ts" },
  ]);
  expect(statusEntries(null)).toEqual([]);
});

// Семя настройки едет в каждый проект, и сверка «Настройка проекта знает все
// поля семени» требует переписать каждое его поле. Поле, которое код не
// читает, проект ведёт впустую, и признака этого нет нигде. Тест держит вид:
// поле семени читается кодом инструмента.
it("каждое поле семени настройки читается кодом инструмента", () => {
  const seed = fs.readFileSync(path.join(SHELF, "seat", "templates", "graph.config.mjs"), "utf8");
  const code = fs
    .readdirSync(TOOL_DIR)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .map((f) => fs.readFileSync(path.join(TOOL_DIR, f), "utf8"))
    .join("\n");
  const unread = [];
  let top = null;
  let fields = 0;
  const debtSeed = [];
  for (const line of seed.split("\n")) {
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    const outer = /^ {2}([A-Za-z_]\w*)\s*:/.exec(line);
    if (outer !== null) {
      top = outer[1];
      fields += 1;
      if (!new RegExp("CONFIG\\??\\." + top + "\\b").test(code)) unread.push(top);
      continue;
    }
    const inner = /^ {4}"?([A-Za-z_][\w-]*)"?\s*:/.exec(line);
    // Связка — данные: имена пакетов читают перебором, а не по одному.
    if (inner === null || top === "verifiedVersions") continue;
    fields += 1;
    if (top === "debt") debtSeed.push(inner[1]);
    else if (!new RegExp("\\.\\??" + inner[1] + "\\b|\"" + inner[1] + "\"|\\{[^}]*\\b" + inner[1] + "\\b[^}]*\\}\\s*=").test(code))
      unread.push(top + "." + inner[1]);
  }
  expect(fields).toBeGreaterThan(90);
  expect(unread, "поле семени, которого код не читает").toEqual([]);
  // Виды долга читают по имени строкой: список видов в коде — тот же, что в семени.
  const kinds = /const DEBT_KINDS = \[([^\]]*)\]/.exec(code);
  expect(kinds).not.toBeNull();
  expect([...kinds[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort()).toEqual(debtSeed.sort());
});

// Незапустившаяся программа отдаёт вывод `undefined`, и шаг, читавший его
// строкой, падал исключением: без git на машине так падали два шага сверок.
// Тест держит вид разом по всем шагам. На Windows `PATH` в среде ребёнка
// двоится по регистру имени — там вид держит тот же код, проверенный здесь.
it.skipIf(process.platform === "win32")("без git на машине ни один шаг сверок не падает исключением", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-git-path-"));
  try {
    const env = { ...process.env, PATH: empty };
    delete env.CLAUDE_CODE_CHILD_SESSION;
    const run = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "verify", "--full"], { cwd: ROOT, encoding: "utf8", env });
    const steps = /=== Шаги сверок исполнились ===\n([\s\S]*?)(?:\n===|$)/.exec(run.stdout);
    expect(steps, run.stdout.slice(-400)).not.toBeNull();
    expect(steps[1]).not.toContain("упал исключением");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
}, 300000);

// Связка записана в настройке семени, а её вторые копии — в манифесте и
// `.nvmrc` семени, в конвейерах мастерской. Разошедшись, копия видна лишь
// предупреждением «Версии установленного», которое прогон не роняет. Тест
// держит вид: каждая копия равна связке либо читает её из семени.
it("версии среды в семенах и конвейерах — те же, что проверенная связка", () => {
  const verified = verifiedOf(fs.readFileSync(path.join(SHELF, "seat", "templates", "graph.config.mjs"), "utf8"));
  const seed = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "templates", "package.json"), "utf8").replace(/^﻿/, ""));
  const declared = { ...seed.dependencies, ...seed.devDependencies };
  const apart = Object.entries(verified)
    .filter(([name, v]) => declared[name] !== undefined && declared[name] !== v)
    .map(([name, v]) => name + ": семя " + declared[name] + ", связка " + v);
  expect(Object.keys(verified).length).toBeGreaterThan(20);
  expect(apart, "пакет семени не той версией").toEqual([]);
  expect(fs.readFileSync(path.join(SHELF, "seat", "templates", ".nvmrc"), "utf8").trim()).toBe(verified.node);
  expect(seed.engines).toEqual({ node: ">=" + verified.node, npm: ">=" + verified.npm });
  // Конвейеры мастерской берут Node и npm из семени, а не своим числом.
  const marker = gitPathOf(ROOT, SEAT_MARKER);
  const workshopShelf = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  const workshopFlows = path.join(path.dirname(workshopShelf), ".github", "workflows");
  if (workshopShelf !== "" && fs.existsSync(workshopFlows))
    for (const f of fs.readdirSync(workshopFlows))
      expect(fs.readFileSync(path.join(workshopFlows, f), "utf8"), f).not.toMatch(/node-version:\s*['"]?\d|npm@\d/);
});

// Скрипт манифеста семени исполняется у принимающей стороны: программа,
// которой нет среди зависимостей семени, находится только там, где её
// поставили вручную. Тест держит вид: программа скрипта — из `bin` пакета
// зависимостей семени либо сам Node и менеджер пакетов.
it("каждый скрипт манифеста семени зовёт программу из зависимостей семени", () => {
  const seed = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "templates", "package.json"), "utf8").replace(/^﻿/, ""));
  const bins = new Set(["node", "npm", "npx"]);
  for (const dep of Object.keys({ ...seed.dependencies, ...seed.devDependencies })) {
    const at = path.join(ROOT, "node_modules", dep, "package.json");
    if (!fs.existsSync(at)) continue;
    const bin = JSON.parse(fs.readFileSync(at, "utf8")).bin;
    if (typeof bin === "string") bins.add(dep.split("/").pop());
    else for (const name of Object.keys(bin ?? {})) bins.add(name);
  }
  const bare = [];
  for (const [name, body] of Object.entries(seed.scripts ?? {}))
    for (const part of body.split(/&&|\|\||;/)) {
      const words = part.trim().split(/\s+/);
      const program = words[0] === "npx" ? words[1] : words[0];
      if (!bins.has(program)) bare.push(name + ": " + program);
    }
  expect(bins.size).toBeGreaterThan(8);
  expect(bare, "скрипт семени зовёт программу не из зависимостей").toEqual([]);
});

// Временная папка, которую не сняли, копится от прогона к прогону: двенадцать
// песочниц по `600M` заполнили диск облачной сессии. Тест держит вид: каждая
// папка, заведённая инструментом, снимается в том же модуле по своему имени.
it("каждая временная папка инструмента снимается по своему имени", () => {
  const bare = [];
  let made = 0;
  for (const file of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))) {
    const text = fs.readFileSync(path.join(TOOL_DIR, file), "utf8");
    for (const m of text.matchAll(/(?:const|let)\s+(?:(\{\s*at(?::\s*(\w+))?[^}]*\})|(\w+))\s*=\s*(?:mkdtempSync|claimSandbox)\(|(\w+)\s*=\s*(?:mkdtempSync\(|claimSandbox\([^)]*\)\.at)/g)) {
      const name = m[1] !== undefined ? (m[2] ?? "at") : (m[3] ?? m[4]);
      made += 1;
      if (!new RegExp("rmSync\\(\\s*(?:record\\.)?" + name + "\\b").test(text.slice(m.index))) bare.push(file + ":" + text.slice(0, m.index).split("\n").length + " " + name);
    }
  }
  expect(made).toBeGreaterThan(7);
  expect(bare, "временная папка без снятия").toEqual([]);
});

// Конфиг семени — код, и его «почему» лежит заметкой на полке, а в конфиге
// стоит её адрес. Семя `tsconfig.json` уезжало без заметки вовсе. Тест держит
// вид: семя в корне проекта называет существующую заметку либо исключено.
it("каждое семя в корне проекта называет свою заметку «почему», и заметка лежит на полке", () => {
  const EXEMPT = new Map([
    ["CLAUDE.md", "само правила проекта"],
    ["package.json", "манифест: формат без комментария, ключи читает менеджер пакетов; порядок — seat.md, шаг 1-бис"],
    [".nvmrc", "одна строка версии, комментария формат не несёт"],
    [".prettierrc.json", "формат без комментария, а неизвестный ключ prettier печатает предупреждением на каждом прогоне; заметку называет seat.md"],
    ["index.html", "страница каркаса, не конфиг"],
  ]);
  const map = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "map.json"), "utf8"));
  const bare = [];
  const used = new Set();
  for (const e of map.copy) {
    if (e.to.includes("/")) continue;
    if (EXEMPT.has(e.to)) {
      used.add(e.to);
      continue;
    }
    const why = /\.claude\/seat\/([\w.-]+-why\.md)/.exec(fs.readFileSync(path.join(SHELF, e.from.replace(/^\.claude\//, "")), "utf8"));
    if (why === null) bare.push(e.to + " — без адреса заметки");
    else if (!fs.existsSync(path.join(SHELF, "seat", why[1]))) bare.push(e.to + " — заметки " + why[1] + " нет");
  }
  expect(bare, "семя без заметки «почему»").toEqual([]);
  expect([...EXEMPT.keys()].filter((k) => !used.has(k)), "исключение, которому нечего исключать").toEqual([]);
  expect(fs.readFileSync(path.join(SHELF, "seat", "seat.md"), "utf8")).toContain(".prettierrc-why.md");
});

// Файл состояния, который обвязка пишет сама, рвётся посреди записи и правится
// руками. Читатель обязан назвать порчу либо сделать работы больше, а не
// меньше. Тест держит вид: новый файл состояния не пройдёт, пока его не
// назовут здесь вместе с тем, как его читатель переживает порчу.
it("каждый файл состояния обвязки назван вместе с тем, как читатель переживает порчу", () => {
  const STATE = new Map([
    ["claude-harness-stop.json", "readOwn: порчу называет сверка «Файл, написанный обвязкой, читается»"],
    ["claude-harness-rules.json", "readOwn: то же"],
    ["claude-harness-rules-", "readOwn: то же, вне git — во временной папке"],
    ["claude-harness-guard.json", "readJson: то же; след без команды — хуки названы неисполняемыми"],
    ["claude-harness-hook.json", "порча — «отказа ещё не было»: ход держится снова; тест обёртки хуков"],
    ["claude-harness-hook-", "то же, вне git"],
    ["graph-series.json", "порча — пустые отметки: серия гоняет цепочку заново; проверка ниже"],
    ["graph-series-", "временные файлы серии — индекс части, песочница, журнал части: обратно их не читают"],
    [".plant.json", "readJson: суд на порче отказывает «Запись пробы испорчена»; проверка ниже"],
    [".tests.json", "readJson: отчёт раннера стенда, оборванный падением, — «тесты не отработали», а не стек"],
  ]);
  const used = new Set();
  const bare = [];
  for (const file of fs.readdirSync(TOOL_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    for (const m of fs.readFileSync(path.join(TOOL_DIR, file), "utf8").matchAll(/"((?:claude-harness|graph-series)[a-z-]*(?:\.json)?|\.(?:plant|tests)\.json)"/g))
      if (STATE.has(m[1])) used.add(m[1]);
      else bare.push(file + ": " + m[1]);
  expect(bare, "файл состояния без названного читателя").toEqual([]);
  expect([...STATE.keys()].filter((k) => !used.has(k)), "исключение, которому нечего исключать").toEqual([]);
  // Порченые отметки серии читаются пустыми, а не роняют её.
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "series-spoiled-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: box });
    fs.writeFileSync(path.join(box, ".git", "graph-series.json"), '{"base": "abc", "trees": {');
    const series = pathToFileURL(path.join(TOOL_DIR, "graph.series.mjs")).href;
    const said = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `import { readMarks } from ${JSON.stringify(series)}; console.log(JSON.stringify(readMarks(process.argv[1])));`, box],
      { encoding: "utf8" },
    );
    expect(said.trim()).toBe('{"base":null,"trees":{}}');
    // Оборванная запись посадки пробы: суд называет порчу, а не падает стеком.
    fs.writeFileSync(path.join(box, "bar-probe-777002.plant.json"), '{"box": "x", "pla');
    const judged = spawnSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "bar-probe", "777002"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, TMPDIR: box, TEMP: box, TMP: box } });
    expect(judged.status, judged.stdout + judged.stderr).toBe(1);
    expect(judged.stdout).toContain("=== Запись пробы испорчена ===");
    expect(judged.stdout).toContain("не разбирается как JSON");
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

// Правила мастерской и метод плана лежат вне полки, и сверка путей полки их не
// читает: метод звал «справку «Сессия-работник»», которой нет. Тест держит
// вид: каждый путь и каждая ссылка на раздел в них ведёт в существующее.
describe("правила мастерской и метод плана называют существующее", () => {
  const marker = gitPathOf(ROOT, SEAT_MARKER);
  const shelfAt = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  const workshop = shelfAt === "" ? "" : path.dirname(shelfAt);
  const has = workshop !== "" && fs.existsSync(path.join(workshop, "workshop", "plan.md"));
  it.skipIf(!has)("пути и разделы `CLAUDE.md` мастерской и `workshop/plan.md`", () => {
    const roots = [".", ".claude", ".claude/rules", ".claude/tools", ".claude/seat", ".claude/skills"].map((r) => path.join(workshop, r));
    const find = (rel) => roots.map((r) => path.join(r, rel)).find((at) => fs.existsSync(at));
    const headsOf = (at) => fs.readFileSync(at, "utf8").split("\n").filter((l) => /^#+ /.test(l)).map((l) => l.replace(/^#+\s*/, "").toLowerCase());
    // О файлах площадки метод говорит, но в мастерской их нет.
    const platform = (rel) => rel.startsWith(".context/") || rel === "tsconfig.json";
    // Ссылка без пути называет файл словами — «скилл `probe`», «README мастерской»:
    // её заголовок ищут по всей прозе мастерской.
    const prose = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") walk(path.join(dir, e.name));
        else if (e.name.endsWith(".md")) prose.push(path.join(dir, e.name));
    })(workshop);
    const own = prose.flatMap(headsOf);
    const bare = [];
    for (const rel of ["CLAUDE.md", "workshop/plan.md"]) {
      const flat = fs.readFileSync(path.join(workshop, rel), "utf8").replace(/\s+/g, " ");
      for (const m of flat.matchAll(/`([\w./-]+\.(?:md|mjs|json|yml|sh|bundle))`/g))
        if (!platform(m[1]) && find(m[1]) === undefined) bare.push(rel + ": путь " + m[1]);
      for (const m of flat.matchAll(/(`([\w./-]+\.md)`,?\s+)?(?:справк[аеиу]|раздел[аеуы]?)\s+«([^»]+)»/g)) {
        const name = m[3].toLowerCase();
        // Раздел прогона в todo заводят на прогон и снимают по его концу.
        if (name === "прогон плана приёмки") continue;
        const at = m[2] === undefined ? null : find(m[2]);
        const heads = at === null ? own : at === undefined ? [] : headsOf(at);
        if (!heads.some((h) => h.includes(name))) bare.push(rel + ": раздел «" + m[3] + "»" + (m[2] ? " в " + m[2] : ""));
      }
    }
    expect(bare, "проза мастерской называет несуществующее").toEqual([]);
  });
});

// README мастерской переписывают проверенную связку прозой для человека:
// подъём связки в семени обязан поднять и их. Мастерскую испытательная
// посадка знает по своей метке — в ней путь полки, с которой посажена.
describe("README мастерской называет проверенную связку", () => {
  const marker = gitPathOf(ROOT, SEAT_MARKER);
  const workshopShelf = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  const workshop = workshopShelf === "" ? "" : path.dirname(workshopShelf);
  const hasReadme = workshop !== "" && fs.existsSync(path.join(workshop, "README.md"));
  it.skipIf(!hasReadme)("каждая версия `x.y.z` в README — значение связки, и корневые README называют каждое", () => {
    const seed = fs.readFileSync(path.join(workshopShelf, "seat", "templates", "graph.config.mjs"), "utf8");
    const values = new Set(Object.values(verifiedOf(seed)));
    expect(values.size).toBeGreaterThan(0);
    const versionsIn = (rel) =>
      new Set(
        [...fs.readFileSync(path.join(workshop, rel), "utf8").matchAll(/(?<![v\d.])\d+\.\d+\.\d+(?![\d.])/g)].map((m) => m[0]),
      );
    for (const rel of ["README.md", "README.ru.md", ".claude/README.md"]) {
      const named = versionsIn(rel);
      expect([...named].filter((v) => !values.has(v)), rel + ": версии не из связки").toEqual([]);
      if (rel !== ".claude/README.md")
        expect([...values].filter((v) => !named.has(v)), rel + ": значения связки, которых нет").toEqual([]);
    }
  });

  // Раздел «Что внутри» перечисляет папки полки; сверка перечней читает прозу
  // самой полки, а README мастерской с полкой не едут.
  it.skipIf(!hasReadme)("README мастерской называют каждую папку полки", () => {
    const folders = fs
      .readdirSync(workshopShelf, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => "`" + e.name + "/`");
    expect(folders.length).toBeGreaterThan(2);
    for (const rel of ["README.md", "README.ru.md"]) {
      const text = fs.readFileSync(path.join(workshop, rel), "utf8");
      expect(folders.filter((one) => !text.includes(one)), rel).toEqual([]);
    }
  });

  // Команды установки стоят в трёх файлах: в двух README мастерской и в
  // памятке полки. Правка одного оставляла два других с прежней командой.
  it.skipIf(!hasReadme)("команды установки одни и те же в обоих README и в памятке полки", () => {
    const install = (rel) => {
      const text = fs.readFileSync(path.join(workshop, rel), "utf8");
      const block = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes("git clone"));
      return (block ?? "").trim().replace(/<[^>]*>/g, "<>");
    };
    const at = ["README.md", "README.ru.md", ".claude/README.md"];
    expect(install(at[0])).toContain("git clone");
    for (const rel of at.slice(1)) expect(install(rel), rel).toBe(install(at[0]));
  });

  // Перевод правят в одном файле, а второй отстаёт без признака. Фрагмент
  // кода переводом не меняется, кроме слов в заполнителе `<путь>`.
  it.skipIf(!hasReadme)("README на двух языках несут одни и те же фрагменты кода", () => {
    const spans = (rel) =>
      new Set(
        [...fs.readFileSync(path.join(workshop, rel), "utf8").replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map((m) =>
          m[1].replace(/<[^>]*>/g, "<>"),
        ),
      );
    const en = spans("README.md");
    const ru = spans("README.ru.md");
    expect([...en].filter((one) => !ru.has(one)), "только в README.md").toEqual([]);
    expect([...ru].filter((one) => !en.has(one)), "только в README.ru.md").toEqual([]);
  });
});

// Команду с переменной оболочки среда сессии спрашивает при любом списке
// разрешений, и задача без присмотра встаёт. Команда — строка блока либо
// фрагмент с пробелом; голое `${…}` — имя предмета. Обоснование не учит.
describe("проза полки не даёт сессии команду с переменной оболочки", () => {
  const RUN_BY_GIT = new Set(['node .claude/tools/graph.mjs gate --message "$1"']);
  it("ни в норме, ни в скилле, ни в справочнике", () => {
    const shelf = path.join(TOOL_DIR, "..");
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const at = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!(dir === shelf && ["rationale", "state", "node_modules"].includes(e.name))) walk(at);
        } else if (e.name.endsWith(".md")) files.push(at);
      }
    };
    walk(shelf);
    expect(files.length).toBeGreaterThan(10);
    const VARIABLE = /\$(\?|\{|[A-Za-z_]|[0-9])/;
    const asks = [];
    const used = new Set();
    for (const at of files) {
      const text = fs.readFileSync(at, "utf8");
      const commands = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split("\n"));
      for (const m of text.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`]+)`/g))
        if (/\s/.test(m[1].trim())) commands.push(m[1]);
      for (const one of commands.map((c) => c.trim()))
        if (VARIABLE.test(one))
          if (RUN_BY_GIT.has(one)) used.add(one);
          else asks.push(path.relative(shelf, at) + ": " + one);
    }
    expect(asks).toEqual([]);
    expect([...RUN_BY_GIT].filter((one) => !used.has(one)), "исключение, которому нечего исключать").toEqual([]);
  });
});

// Что ломается только на Windows, здесь не видно ничем, кроме конвейера, а
// конвейер видит лишь то, что он гоняет и на что он запускается.
describe("полка не несёт того, что ломается на другой системе молча", () => {
  // Рекурсивное `cpSync` без фильтра на Windows роняет процесс без строки на
  // пути не по-латински (`copyTree`); новый вызов без фильтра — тот же сбой.
  it("рекурсивная копия в коде инструмента идёт с фильтром", () => {
    const callsOf = (text) => {
      const out = [];
      for (const m of text.matchAll(/\bcpSync\(/g)) {
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < text.length && depth > 0; i += 1) {
          if (text[i] === "(") depth += 1;
          else if (text[i] === ")") depth -= 1;
        }
        out.push(text.slice(m.index, i));
      }
      return out;
    };
    const unfiltered = [];
    for (const name of fs.readdirSync(TOOL_DIR))
      if (name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
        for (const call of callsOf(fs.readFileSync(path.join(TOOL_DIR, name), "utf8")))
          if (/recursive:\s*true/.test(call) && !/\bfilter:/.test(call)) unfiltered.push(name + ": " + call);
    expect(callsOf("cpSync(a, b, { recursive: true, filter: (s) => f(s) });")).toHaveLength(1);
    expect(unfiltered).toEqual([]);
  });

  // Два пути, различные одним регистром, на Windows и macOS — один файл:
  // клон молча кладёт второй поверх первого.
  it("пути полки различаются не одним регистром", () => {
    const seen = new Map();
    const clash = [];
    for (const rel of walkFiles(SHELF)) {
      const key = rel.toLowerCase();
      if (seen.has(key)) clash.push(seen.get(key) + " — " + rel);
      else seen.set(key, rel);
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(clash).toEqual([]);
  });

  // Конвейер Windows запускается по путям: папка полки с исполняемым, которой
  // в них нет, правится без прогона на Windows. Без прогона остаётся одна проза.
  const marker = gitPathOf(ROOT, SEAT_MARKER);
  const workshopShelf = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  const flow = workshopShelf === "" ? "" : path.join(path.dirname(workshopShelf), ".github", "workflows", "harness-windows.yml");
  it.skipIf(flow === "" || !fs.existsSync(flow))("конвейер Windows запускается на правке каждой папки полки, кроме прозы", () => {
    const PROSE = new Set(["rules", "rationale", "skills", "state"]);
    const text = fs.readFileSync(flow, "utf8");
    const folders = fs
      .readdirSync(workshopShelf, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !PROSE.has(e.name))
      .map((e) => e.name);
    expect(folders).toContain("tools");
    expect(folders.filter((one) => !text.includes("- .claude/" + one + "/**"))).toEqual([]);
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
  const install = (
    nodeSays,
    before = () => {},
    without = "",
    sums = (text) => text,
    { system = {}, npmSays = "echo " + declared.npm } = {},
  ) => {
    // Апостроф в пути — как в имени профиля `O'Brien`.
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "boot-o'brien-"));
    const name = "node-v" + declared.node + "-linux-" + (os.arch() === "arm64" ? "arm64" : "x64");
    const dist = path.join(box, "dist", "v" + declared.node);
    const pkg = path.join(box, "pkg", name, "bin");
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "node"), "#!/bin/sh\n" + nodeSays + "\n");
    fs.writeFileSync(path.join(pkg, "npm"), "#!/bin/sh\n" + npmSays + "\n");
    for (const one of ["node", "npm"]) fs.chmodSync(path.join(pkg, one), 0o755);
    spawnSync("tar", ["-czf", path.join(dist, name + ".tar.gz"), "-C", path.join(box, "pkg"), name]);
    const sum = spawnSync("sha256sum", [name + ".tar.gz"], { cwd: dist, encoding: "utf8" }).stdout;
    fs.writeFileSync(path.join(dist, "SHASUMS256.txt"), sums(sum));
    const bin = fakeBin({ git: "2.43.0" });
    for (const [name, body] of Object.entries(system))
      fs.writeFileSync(path.join(bin, name), "#!/bin/sh\n" + body + "\n", { mode: 0o755 });
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

  // Подъём npm засчитывается по версии, которая отвечает после: на Windows новый
  // npm встаёт в свою папку, а в PATH раньше стоит старый из папки Node.js.
  it.skipIf(!canInstall)("npm поднят, только когда отвечает версией связки; иначе — свой Node.js, а свой не поднялся — отказ", () => {
    const node = "echo v" + declared.node;
    const oldNpm = (onInstall) => 'case "$1" in --version) echo 10.9.4 ;; *) ' + onInstall + " ;; esac";
    const raised = install(node, () => {}, "", (t) => t, {
      system: {
        node,
        npm: 'f="$(dirname "$0")/raised"; case "$1" in --version) if [ -f "$f" ]; then echo ' + declared.npm + '; else echo 10.9.4; fi ;; *) touch "$f" ;; esac',
      },
    });
    expect(raised.run.status, raised.run.stdout + raised.run.stderr).toBe(0);
    expect(raised.run.stdout).toContain("npm: 10.9.4 → " + declared.npm);
    expect(raised.left).toEqual([]);

    const locked = install(node, () => {}, "", (t) => t, {
      system: { node, npm: oldNpm('echo "npm error code EACCES" >&2; exit 243') },
    });
    const shadowed = install(node, () => {}, "", (t) => t, { system: { node, npm: oldNpm("exit 0") } });
    for (const [one, why] of [
      [locked, "npm error code EACCES"],
      [shadowed, "после установки отвечает npm 10.9.4: в PATH раньше стоит другой"],
    ]) {
      expect(one.run.status, one.run.stdout + one.run.stderr).toBe(0);
      expect(one.run.stdout).toContain("системный npm не поднялся до связки — " + why);
      expect(one.run.stdout).toContain("npm: 10.9.4 → " + declared.npm);
      expect(one.profile).toContain(one.dest + "/bin:$PATH");
    }

    const ownLow = install(node, () => {}, "", (t) => t, { system: { node, npm: oldNpm("exit 0") }, npmSays: "echo 10.9.4" });
    expect(ownLow.run.status).toBe(1);
    expect(ownLow.run.stdout).toContain("npm " + declared.npm + " не встал в " + ownLow.dest);
    expect(ownLow.run.stdout).toContain("после установки отвечает npm 10.9.4");
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
