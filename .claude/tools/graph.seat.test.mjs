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
} from "./graph.seat.mjs";

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
        "barSince, seriesSince",
        "seat",
      ]);
      expect(gitIn(dest, "config", "core.hooksPath")).toBe(".claude/hooks/git");
      expect(gitIn(dest, "status", "--porcelain")).toBe("");
      expect(fs.existsSync(path.join(dest, ".git", "claude-seat"))).toBe(false);
      const again = seatHere(dest, "--packages", ROOT);
      expect(again.status, again.stdout).toBe(0);
      expect(again.stdout).toContain("=== Посадка уже сделана ===");
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
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
