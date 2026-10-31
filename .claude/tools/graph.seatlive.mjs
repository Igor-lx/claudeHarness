import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { composeLive } from "./graph.configs.mjs";
import { SCENARIO_NAMES, foreignOffer } from "./graph.profile.mjs";
import {
  SEAT_HERE_MARKER,
  claimSandbox,
  factsWithBaseline,
  mergedLines,
  norm,
  projectFilesOf,
  runTool,
  saidBy,
  sandboxPackages,
  systemTemp,
  tailOf,
  testCountsOf,
  tiersFrom,
  uncolored,
  walkFiles,
  withSeatingBase,
} from "./graph.seat.mjs";

/** Посадка живого проекта одной командой — знакомого и чужого (решение
 * разработчика `2026-10-30`). Знакомый приводится к обвязке композицией:
 * конфиг проекта того же инструмента ложится рядом `*.project.config.*` и
 * подключается из конфига обвязки; скрипт звена — семенной, прежний
 * проектный — `<имя>:own`. Чужому кладутся полка и база без установки, а
 * отчёт называет, чего обвязка не видит, и два пути дальше. Код проекта
 * посадка не трогает ни в одном сценарии. */

const CODE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** Списки строк: проектные строки остаются, недостающие строки семени
 * дописываются. */
const LISTS = new Set([".gitignore", ".gitattributes", ".prettierignore"]);
/** Скрипты звеньев, которые посадка пишет живому проекту. */
const LIVE_SCRIPTS = ["typecheck", "lint", "format:check", "test", "test:coverage", "mutate", "check"];

/** Строка `git status --porcelain` — неотслеживаемый файл самой полки, а не
 * работа проекта. Проект, уже державший своё в `.claude/`, видит полку не
 * одной строкой `?? .claude/`, а по файлу, и посадка отказывала ему вовсе.
 * Своё проекта внутри полки — `projectOwnedInsideHarness` и `harnessInside`
 * карты. */
export const shelfUntracked = (line, map) => {
  const m = /^\?\? "?(\.claude(?:\/[^"]*)?)"?$/.exec(line);
  if (m === null) return false;
  const parts = m[1].split("/").slice(1).filter(Boolean);
  if (parts.length === 0) return true;
  if ((map?.projectOwnedInsideHarness ?? []).includes(parts[0])) return false;
  const inside = map?.harnessInside?.[parts[0]];
  return inside === undefined || parts.length === 1 || inside.includes(parts[1]);
};

/** Настройки среды проекта со своими строками и строками семени: разрешения
 * — объединением, хуки — недостающими группами по команде. Свой файл проекта
 * оставался как был, и в проекте не стояли ни запреты обвязки, ни её хуки —
 * ворота конца хода и страж обхода. */
export const settingsMerged = (own, seed) => {
  const out = { ...own, permissions: { ...(own.permissions ?? {}) }, hooks: { ...(own.hooks ?? {}) } };
  for (const [kind, list] of Object.entries(seed.permissions ?? {}))
    out.permissions[kind] = [...new Set([...(own.permissions?.[kind] ?? []), ...list])];
  const callOf = (group) => JSON.stringify((group?.hooks ?? []).map((h) => [h.command, ...(h.args ?? [])]));
  for (const [event, groups] of Object.entries(seed.hooks ?? {})) {
    const have = new Set((out.hooks[event] ?? []).map((g) => callOf(g) + "|" + (g.matcher ?? "")));
    out.hooks[event] = [
      ...(out.hooks[event] ?? []),
      ...groups.filter((g) => !have.has(callOf(g) + "|" + (g.matcher ?? ""))),
    ];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
};

/** Текст базы без записей о том, чего в проекте нет: абзацы каркаса между
 * пометками `КАРКАС`, строки таблиц и записи решений, называющие адрес
 * из `gone`. Адрес узнаётся целиком и без корня `src/`: реестр тестов
 * пишет пути от корня исходников. */
export const liveBaseText = (text, gone) => {
  const names = [...new Set(gone.flatMap((one) => [one, one.replace(/^src\//, "")]))];
  const hits = (chunk) => names.some((one) => chunk.includes("`" + one + "`") || chunk.includes("`" + one + ":"));
  const noFrame = text
    .replace(/<!-- КАРКАС -->[\s\S]*?<!-- \/КАРКАС -->\n?/g, "")
    .replace(/\n{3,}/g, "\n\n");
  const blocks = noFrame.split(/\n\n/).map((block) => {
    const lines = block.split("\n");
    if (lines[0].startsWith("**") && hits(block)) return null;
    return lines.filter((line) => !(line.trimStart().startsWith("|") && hits(line))).join("\n");
  });
  return blocks
    .filter((one) => one !== null)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
};

/** Правила проекта со своей раскладкой: раздел о раскладке умолчания
 * заменён местом под ответ фазы 2 — раскладку пишут по фактам с диска, а
 * посадка их не читала. */
export const rulesWithOwnLayout = (text) => {
  const from = text.indexOf("Раскладка умолчания обвязки, три слоя.");
  const tail = "каждая своя папка верхнего уровня названа здесь путём.";
  const to = text.indexOf(tail, from);
  if (from < 0 || to < 0) throw new Error("в семени правил нет раздела о раскладке умолчания");
  return (
    text.slice(0, from) +
    "<Раскладка проекта: папки верхнего уровня, что лежит в каждой, куда кладут\nновый узел и в какую сторону идут зависимости. Пишется по фактам с диска;\nправило — `.claude/rules/code.md`, раздел «Раскладка проекта».>" +
    text.slice(to + tail.length)
  );
};

/** Строки таблиц, чья команда — скрипт, которого у проекта нет. Строка без
 * предмета убирается, а не остаётся пустой (`CLAUDE.md` проекта). */
export const withoutAbsentScripts = (text, scripts) =>
  text
    .split("\n")
    .filter((line) => {
      if (!line.trimStart().startsWith("|")) return true;
      const named = [...line.matchAll(/`npm run ([\w:-]+)`/g)].map((m) => m[1]);
      if (line.includes("`npm test`")) named.push("test");
      return named.every((one) => scripts.includes(one));
    })
    .join("\n");

/** Поле верхнего уровня настройки — одной строкой; поле, записанное
 * списком либо объектом в несколько строк, заменяется целиком. Поля нет —
 * `null`. */
export const configField = (text, field, value) => {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("  " + field + ": "));
  if (at < 0) return null;
  let end = at;
  if (/[[{]$/.test(lines[at])) {
    end = lines.findIndex((l, i) => i > at && /^ {2}[\]}],$/.test(l));
    if (end < 0) return null;
  } else if (!lines[at].endsWith(",")) return null;
  lines.splice(at, end - at + 1, "  " + field + ": " + JSON.stringify(value) + ",");
  return lines.join("\n");
};

/** Список строк поля настройки, записанного списком в несколько строк. */
export const configList = (text, field) => {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l === "  " + field + ": [");
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < lines.length && lines[i] !== "  ],"; i += 1) {
    const m = /^ {4}"([^"]*)",?$/.exec(lines[i]);
    if (m !== null) out.push(m[1]);
  }
  return out;
};

/** Вид долга внутри поля `debt`. */
export const configDebt = (text, kind, value) => {
  const from = text.indexOf("\n  debt: {");
  if (from < 0) return null;
  const re = new RegExp("^    " + kind + ": .*,$", "m");
  const at = text.slice(from).search(re);
  if (at < 0) return null;
  const start = from + at;
  const end = text.indexOf("\n", start);
  return text.slice(0, start) + "    " + kind + ": " + JSON.stringify(value) + "," + text.slice(end);
};

/** Таблица применимости с живыми разделами: предмет, найденный сверкой,
 * становится причиной. */
export const factsWithScopes = (text, scopes) =>
  text.replace(/^\| ([K-U])\. ([^|]+?) \| ([^|]+?) \| (.+) \|$/gm, (line, id, title) =>
    scopes[id] === undefined
      ? line
      : "| " + id + ". " + title + " | да | замер посадки: " + String(scopes[id]).replace(/\|/g, "\\|") + " |",
  );

/** Строки таблицы направления, чей слой либо адрес лежит в `layers`.
 * Пример формы в ограде кода не трогается. */
export const rulesWithout = (text, layers) => {
  let fenced = false;
  return text
    .split("\n")
    .filter((line) => {
      if (line.startsWith("```")) fenced = !fenced;
      if (fenced || !line.startsWith("| `")) return true;
      const first = /^\| `([^`]+)`/.exec(line)?.[1];
      return first === undefined || !layers.includes(first);
    })
    .join("\n");
};

/** Строк данных у таблицы под шапкой `heading`. */
export const tableRows = (text, heading) => {
  const lines = text.split("\n");
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("```")) fenced = !fenced;
    if (fenced || !lines[i].startsWith(heading)) continue;
    let n = 0;
    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j += 1) n += 1;
    return n;
  }
  return 0;
};

/** Файл перехода со строками шагов знания и пунктов долга: шаги — в конец
 * первой таблицы, пункты — в таблицу долга. */
export const transitionWith = (text, { heading, debtHeading }, steps, items) => {
  const lines = text.split("\n");
  const after = (head) => {
    const at = lines.findIndex((l) => l.startsWith(head));
    if (at < 0) throw new Error("в файле перехода нет таблицы: " + head);
    let end = at + 2;
    while (end < lines.length && lines[end].startsWith("|")) end += 1;
    return end;
  };
  const stepsAt = after(heading);
  const first = steps.length > 0 ? Number(/^\| (\d+) /.exec(lines[stepsAt - 1])?.[1] ?? 0) : 0;
  lines.splice(stepsAt, 0, ...steps.map((one, i) => "| " + (first + i + 1) + " | " + one.join(" | ") + " |"));
  const itemsAt = after(debtHeading);
  const had = itemsAt - (lines.findIndex((l) => l.startsWith(debtHeading)) + 2);
  lines.splice(itemsAt, 0, ...items.map((one, i) => "| " + (had + i + 1) + " | " + one.join(" | ") + " |"));
  return lines.join("\n");
};

/** Шаги знания и пункты долга по долгу, который прогон насчитал. Долг базы
 * закрывает чтение — шаг перехода; долг кода — правка кода, пункт долга с
 * тем же числом. Решено разработчиком. */
export const debtPlanOf = (debt, { typecheck = "typecheck", lint = "lint" } = {}) => {
  const steps = [];
  const items = [];
  const n = (kind) => debt[kind] ?? 0;
  if (n("map") + n("tests") > 0)
    steps.push([
      "Карта и реестр тестов: строка на каждый файл кода и теста",
      "`" + (n("map") + n("tests")) + "` файлов",
      "«Покрытие карты» и «Покрытие тестов»",
    ]);
  if (n("subjects") > 0)
    steps.push(["Предметы в файлах базы: состояние и порядок — записью о каждом файле", "`" + n("subjects") + "` записей", "«Предмет из кода назван в своём файле базы»"]);
  if (n("decisions") > 0)
    steps.push(["Пометки решений — записью в реестре решений", "`" + n("decisions") + "` пометок", "«Пометки решений»"]);
  if (n("invariants") > 0)
    steps.push(["Пометки ограничений — записью в каталоге ограничений", "`" + n("invariants") + "` пометок", "«Пометки CONSTRAINT»"]);
  if (n("constants") > 0)
    steps.push(["Константы настроек — описанием в документе", "`" + n("constants") + "` констант", "«Константы настроек описаны»"]);
  if (n("readme") > 0)
    steps.push(["Документ каждой папки компонента", "`" + n("readme") + "` папок", "«У компонента есть README»"]);
  const item = (what, kind, holds, plan, unit) =>
    items.push([what, "`" + n(kind) + "`", holds, plan, "`" + n(kind) + "` " + unit]);
  if (n("types") > 0)
    item("Ошибки типов под строгостью обвязки", "types", "«" + typecheck + "»", "адреса печатает `npm run " + typecheck + "`; чинит работа по слову разработчика, долг уменьшают следом", "ошибок");
  if (n("lint") > 0)
    item("Находки линтера под правилами обвязки", "lint", "«" + lint + "»", "адреса печатает `npm run " + lint + "`; чинит работа по слову разработчика, долг уменьшают следом", "находок");
  if (n("pins") > 0)
    item("Версии зависимостей диапазоном", "pins", "«Версии зависимостей закреплены»", "закрепить точными правкой манифеста и блокировки", "зависимостей");
  if (n("markers") > 0)
    item("Маркеры отложенной работы в коде", "markers", "«Найденное — исправлено, а не отложено»", "адреса печатает сверка; починить либо записать решением", "маркеров");
  if (n("comments") > 0)
    item("Комментарии сверх потолка", "comments", "«Комментарий не перерос в прозу» и «Доля комментариев в файле»", "адреса печатают сверки; переписать по `code.md`, раздел «Комментарии: минимум, и по делу»", "мест");
  if (n("tongue") > 0)
    item("Строки кода не на языке кода", "tongue", "«Язык внутри корня исходников»", "адреса печатает сверка; перевести", "строк");
  if (n("guarantees") > 0)
    item("Строки витрины без теста", "guarantees", "«Гарантия держится тестом»", "написать тест и назвать его в строке гарантии", "строк");
  return { steps, items };
};

/** Скрипты звеньев: имена и тела семени. Проектный скрипт того же имени,
 * делающий ту же работу своим вызовом, — образец звена его узнаёт, —
 * заменяется: рядом он был бы близнецом звена. Делающий другую работу
 * остаётся рядом `<имя>:own`. Отдаёт скрипты и заменённые. */
export const scriptsLive = (own, seed, recognise = {}) => {
  const out = { ...own };
  const replaced = [];
  for (const [name, body] of Object.entries(seed)) {
    const was = out[name];
    if (was !== undefined && was !== body) {
      const same = recognise[name] !== undefined && new RegExp(recognise[name]).test(was);
      if (same) replaced.push({ name, was });
      else if (out[name + ":own"] === undefined) out[name + ":own"] = was;
    }
    out[name] = body;
  }
  return { scripts: out, replaced };
};

/** Корень исходников живого проекта: `src`, иначе папки верхнего уровня с
 * кодом. */
export const sourceRootsOf = (files) => {
  if (files.some((f) => f.startsWith("src/") && CODE.test(f))) return ["src"];
  const tops = [...new Set(files.filter((f) => f.includes("/") && CODE.test(f) && !/\.config\./.test(f)).map((f) => f.split("/")[0]))];
  return tops.sort();
};

const readJson = (at) => {
  try {
    return JSON.parse(readFileSync(at, "utf8"));
  } catch {
    return null;
  }
};

/** Посадка живого проекта: `profile` — ответ `scenarioOf`. */
export const runSeatLive = ({ shelf, target, env, packagesFrom, apply, profile }) => {
  const say = (...lines) => {
    for (const one of lines) console.log(one);
  };
  const refuse = (...why) => {
    say("=== Посадка не собрана ===", ...why.map((one) => "  " + one));
    process.exit(1);
  };
  const familiar = profile.scenario === "familiar";
  const at = (rel) => path.join(target, rel);
  const read = (rel) => (existsSync(at(rel)) && statSync(at(rel)).isFile() ? readFileSync(at(rel), "utf8") : null);
  const quiet = { cwd: target, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] };
  const asked = (args) => {
    try {
      return execFileSync("git", args, quiet).trim();
    } catch {
      return null;
    }
  };
  if (!existsSync(at(".git"))) {
    // Репозиторий выше папки проекта — другая причина и другой выход.
    const top = asked(["rev-parse", "--show-toplevel"]);
    refuse(
      ...(top !== null && top !== ""
        ? [
            "Проект лежит внутри репозитория " + norm(top) + ", а не в его корне: посадка коммитит в корне репозитория проекта.",
            "Позвать посадку из корня репозитория либо вынести проект в свой репозиторий.",
          ]
        : [
            "Живой проект без репозитория git: посадка коммитит своё поверх истории проекта.",
            "Завести репозиторий, закоммитить проект и позвать посадку снова.",
          ]),
    );
  }
  const map = readJson(path.join(shelf, "seat", "map.json"));
  const dirty = (asked(["status", "--porcelain"]) ?? "")
    .split("\n")
    .filter((l) => l.trim() !== "" && !shelfUntracked(l, map));
  if (dirty.length > 0)
    refuse(
      "Незакоммиченное в проекте — посадка его не смешивает со своим:",
      ...dirty.slice(0, 6).map((l) => "  " + l),
      "Закоммитить либо убрать и позвать посадку снова.",
    );
  const plan = profile.survey?.plan ?? [];
  if (familiar && plan.length > 0 && !apply) {
    say(
      "=== Посадка ждёт слова: стек приводится к связке ===",
      "  Сценарий посадки: " + SCENARIO_NAMES.familiar + ".",
      "  Пакеты ставятся точными версиями проверенной связки:",
      ...plan.map(
        (one) =>
          "    " + one.name + ": " + (one.from ?? "нет") + " → " + (one.to ?? "снять"),
      ),
      "  Это меняет зависимости проекта. Согласие — та же команда с ключом --apply:",
      "    node .claude/tools/graph.mjs seat . --apply",
      "  Проект не тронут.",
    );
    process.exit(1);
  }

  const seedDir = path.join(shelf, "seat", "templates");
  const seedOf = (rel) => readFileSync(path.join(seedDir, rel), "utf8");
  // Откат: всё, что положила посадка до первого коммита, снимается.
  const undo = [];
  // Файл проекта посадка пишет поверх, только если перенесла его рядом либо
  // он из объявленного короткого списка: прежде занятое имя — свой
  // `CLAUDE.project.md`, свой `eslint.project.config.js` — затиралось без
  // признака.
  const ownFiles = new Set((asked(["ls-files", "-z"]) ?? "").split("\0").filter(Boolean));
  const movedAway = new Set();
  const overwritable = new Set([...LISTS, "package.json", ".claude/settings.json"]);
  const taken = (rel, why) =>
    fail("Имя " + rel + " уже занято файлом проекта, а посадка кладёт туда " + why + ".", "Переименовать свой файл, закоммитить и позвать посадку снова.");
  const write = (rel, text) => {
    if (ownFiles.has(rel) && !movedAway.has(rel) && !overwritable.has(rel)) taken(rel, "свой файл");
    const was = read(rel);
    let made = null;
    for (let dir = path.dirname(at(rel)); !existsSync(dir); dir = path.dirname(dir)) made = dir;
    mkdirSync(path.dirname(at(rel)), { recursive: true });
    writeFileSync(at(rel), text);
    undo.push(() => {
      if (was === null) rmSync(at(rel), { force: true });
      else writeFileSync(at(rel), was);
      if (made !== null) rmSync(made, { recursive: true, force: true });
    });
  };
  const move = (from, to) => {
    if (existsSync(at(to))) taken(to, from + " проекта");
    renameSync(at(from), at(to));
    movedAway.add(from);
    undo.push(() => {
      renameSync(at(to), at(from));
      movedAway.delete(from);
    });
  };
  // Установка меняет папку пакетов на месте, и откат вернуть её не может:
  // отказ после неё так и говорит.
  let reinstalled = false;
  const fail = (...why) => {
    for (const step of undo.reverse()) step();
    refuse(
      ...why,
      reinstalled
        ? "Файлы проекта возвращены как были; папку node_modules установка переставила по новому манифесту — вернуть её: npm ci."
        : "Проект возвращён в прежний вид.",
    );
  };
  const report = [];
  const files = projectFilesOf(target);
  const roots = sourceRootsOf(files);
  const manifest = readJson(at("package.json"));
  const ownScripts = { ...(manifest?.scripts ?? {}) };

  // 1. Стек и манифест — только знакомому.
  let strict = null;
  let liveScripts = Object.keys(ownScripts);
  if (familiar) {
    const m = { ...manifest };
    for (const one of plan) {
      for (const section of ["dependencies", "devDependencies"])
        if (section !== one.section && m[section]?.[one.name] !== undefined) {
          m[section] = { ...m[section] };
          delete m[section][one.name];
        }
      m[one.section] = { ...(m[one.section] ?? {}) };
      if (one.to === null) delete m[one.section][one.name];
      else m[one.section][one.name] = one.to;
      m[one.section] = Object.fromEntries(Object.entries(m[one.section]).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    let composed;
    try {
      composed = composeLive({
        exists: (rel) => existsSync(at(rel)),
        read,
        seed: seedOf,
        map,
        roots,
        prettierInManifest: manifest?.prettier !== undefined,
      });
    } catch (e) {
      fail("Конфиги проекта не сложились с конфигами обвязки: " + e.message + ".", "Поправить конфиг проекта, закоммитить и позвать посадку снова.");
    }
    strict = composed.strict;
    const seedScripts = readJson(path.join(seedDir, "package.json")).scripts;
    const bodies = Object.fromEntries(
      LIVE_SCRIPTS.filter((one) => seedScripts[one] !== undefined).map((one) => [
        one,
        one === "typecheck"
          ? "node .claude/tools/graph.mjs types -- " + strict.call
          : one === "lint"
            ? "node .claude/tools/graph.mjs lint -- " + seedScripts.lint
            : seedScripts[one],
      ]),
    );
    const merged = scriptsLive(
      ownScripts,
      bodies,
      Object.fromEntries((map.chainScripts ?? []).filter((e) => e.recognise != null).map((e) => [e.name, e.recognise])),
    );
    m.scripts = merged.scripts;
    liveScripts = Object.keys(m.scripts);
    for (const one of merged.replaced)
      report.push("Скрипт " + one.name + " заменён скриптом обвязки: та же работа своим вызовом, было `" + one.was + "`.");
    const kept = Object.keys(m.scripts).filter((n) => n.endsWith(":own") && ownScripts[n] === undefined);
    if (kept.length > 0) report.push("Прежние скрипты проекта, делающие другую работу, лежат рядом: " + kept.join(", ") + ".");
    if (m.engines === undefined) m.engines = readJson(path.join(seedDir, "package.json")).engines;
    write("package.json", JSON.stringify(m, null, 2) + "\n");
    for (const [from, to] of composed.moves) move(from, to);
    for (const [rel, text] of Object.entries(composed.files)) write(rel, text);
    report.push(...composed.report);
  }

  // 2. Списки, правила, документы, база.
  const gone = (map.copy ?? []).filter((e) => e.onlyWhenEmpty === true || e.onlyWith !== undefined).map((e) => e.to);
  for (const e of map.copy ?? []) {
    if (e.notAtSeating !== undefined || e.onlyWhenEmpty === true || e.onlyWith !== undefined) continue;
    const seed = readFileSync(path.join(shelf, e.from), "utf8");
    if (LISTS.has(e.to)) {
      // Чужому — только исключения git: песочницы инструмента не уходят в
      // коммит. Концы строк и список форматтера — политика его репозитория.
      if (!familiar && e.to !== ".gitignore") continue;
      write(e.to, mergedLines(read(e.to) ?? "", seed));
      continue;
    }
    if (e.to === "CLAUDE.md") {
      if (existsSync(at("CLAUDE.md"))) {
        move("CLAUDE.md", "CLAUDE.project.md");
        report.push("Свой CLAUDE.md проекта лежит как CLAUDE.project.md; фаза 2 переносит нужное в CLAUDE.md.");
      }
      write("CLAUDE.md", withoutAbsentScripts(liveBaseText(seed, gone), liveScripts));
      continue;
    }
    if (e.to.startsWith(".context/") || e.to.startsWith("docs/")) {
      if (existsSync(at(e.to))) {
        // `.context/` — папка базы обвязки: свой файл проекта там занимает
        // имя записи, и посадка кончалась красной сверкой без заготовки.
        if (e.to.startsWith(".context/")) taken(e.to, "запись базы обвязки");
        report.push(e.to + " проекта сохранён; заготовка обвязки не легла.");
        continue;
      }
      write(e.to, e.to.endsWith(".md") ? liveBaseText(seed, gone) : seed);
      continue;
    }
    if (e.to === ".claude/settings.json") {
      const own = read(e.to);
      if (own === null) write(e.to, seed);
      else {
        let parsed;
        try {
          parsed = JSON.parse(own);
        } catch (err) {
          fail("Свой .claude/settings.json проекта не разбирается: " + err.message, "Поправить файл и позвать посадку снова.");
        }
        write(e.to, JSON.stringify(settingsMerged(parsed, JSON.parse(seed)), null, 2) + "\n");
        report.push("Свой .claude/settings.json проекта сохранён; разрешения и хуки обвязки дописаны в него.");
      }
      continue;
    }
    // Конфиги стека знакомому положила композиция; чужому их не кладут.
  }
  const transitionAt = (map.onTransition ?? [])[0];
  write(transitionAt.to, readFileSync(path.join(shelf, transitionAt.from), "utf8"));

  // 3. Настройка: сценарий, корни, переход.
  const configRel = ".context/graph.config.mjs";
  let config = read(configRel);
  const field = (name, value) => {
    const next = configField(config, name, value);
    if (next === null) throw new Error("в настройке нет поля одной строкой: " + name);
    config = next;
  };
  try {
    field("scenario", profile.scenario);
    field("foreignAxes", profile.foreign.map((one) => one.axis));
    // Кода на языках обвязки нет вовсе — корень исходников остаётся семенным:
    // пустой список настройка не принимает, а весь проект корнем взял бы и
    // саму базу.
    if (roots.length > 0) field("src", roots.length === 1 ? "../" + roots[0] : roots.map((r) => "../" + r));
    const seeded = configList(config, "seeded") ?? [];
    field("seeded", seeded.filter((one) => existsSync(path.join(target, ".context", one))));
    if (!familiar) field("lintConfigOff", null);
    field("transition", {
      file: path.basename(transitionAt.to),
      heading: "| № | Шаг | Объём | Чем проверяется |",
      debtHeading: "| № | Расхождение | Сейчас | Держит | План | Цена |",
    });
  } catch (e) {
    fail("Настройка не записалась: " + e.message);
  }
  write(configRel, config);

  // 4. Пакеты и замер звеньев — знакомому.
  const rows = [];
  const npmRun = (name) => runTool("npm", ["run", "-s", name], { cwd: target, env });
  if (familiar) {
    const needed = Object.keys({ ...readJson(at("package.json")).dependencies, ...readJson(at("package.json")).devDependencies });
    const from = packagesFrom === null ? null : path.join(packagesFrom, "node_modules");
    const linked = from !== null && needed.every((n) => existsSync(path.join(from, n, "package.json")));
    const hadModules = existsSync(at("node_modules"));
    if (linked) {
      if (hadModules) fail("Пакеты ссылкой кладутся только в проект без своей папки node_modules.");
      sandboxPackages(from, at("node_modules"));
      undo.push(() => rmSync(at("node_modules"), { recursive: true, force: true }));
    } else {
      const lockWas = read("package-lock.json");
      undo.push(() => (lockWas === null ? rmSync(at("package-lock.json"), { force: true }) : writeFileSync(at("package-lock.json"), lockWas)));
      const install = runTool("npx", ["-y", "npm@11", "install", "--no-audit", "--no-fund"], { cwd: target, env });
      // Не запустившаяся установка папку пакетов не трогала.
      reinstalled = install.error === null;
      if (install.status !== 0)
        fail("Пакеты не встали: установка `npx -y npm@11 install` упала:", ...tailOf(saidBy(install), 6));
    }
    report.push("Пакеты: " + needed.length + (linked ? ", ссылкой на " + norm(from) : ", установлены") + (plan.length > 0 ? "; к связке приведено " + plan.length : "") + ".");
    // Цена строгости и правил линта — долгом: звено зелёно на нынешнем
    // числе и красно на новом.
    for (const [name, kind] of [["typecheck", "types"], ["lint", "lint"]]) {
      const run = npmRun(name);
      const out = uncolored(run.out);
      if (/ошибка настройки/.test(out)) fail("Звено " + name + " не проверяет код — ошибка настройки:", ...tailOf(out, 8));
      const found = Number(/осмотрено (?:ошибок компилятора|ошибок линтера): (\d+)/.exec(out)?.[1] ?? NaN);
      if (!Number.isFinite(found)) fail("Звено " + name + " не назвало число ошибок:", ...tailOf(out, 8));
      const next = configDebt(read(configRel), kind, found === 0 ? null : found);
      if (next === null) fail("В настройке нет вида долга " + kind + ".");
      write(configRel, next);
    }
  }

  // 5. Факты прогоном сверки: живые разделы, файлы по предмету, раскладка.
  const facts = () => {
    const out = path.join(systemTemp(), "seat-facts-" + process.pid + ".json");
    runTool(process.execPath, [at(".claude/tools/graph.mjs"), "verify"], {
      cwd: target,
      env: { ...env, GRAPH_SEAT_FACTS: out },
    });
    const got = readJson(out);
    rmSync(out, { force: true });
    if (got === null) fail("Сверка базы не отдала факты посадки.");
    return got;
  };
  const first = facts();
  write(".context/01-facts.md", factsWithScopes(read(".context/01-facts.md"), first.scopes));
  for (const to of first.subjects) {
    const seed = (map.onSubject ?? []).find((one) => one.to === to);
    if (seed !== undefined && !existsSync(at(to))) write(to, readFileSync(path.join(shelf, seed.from), "utf8"));
  }
  if (first.strays.length > 0 || first.emptyRules.length > 0)
    write("CLAUDE.md", rulesWithOwnLayout(read("CLAUDE.md")));
  if (first.emptyRules.length > 0) {
    const mapText = rulesWithout(read(".context/00-map.md"), first.emptyRules);
    write(".context/00-map.md", mapText);
    if (tableRows(mapText, "| Слой | Что ему запрещено импортировать |") === 0) {
      config = read(configRel);
      field("rulesHeading", null);
      write(configRel, config);
    }
  }
  // Своя раскладка — слоя компонентов умолчания у проекта нет: формы поля
  // для компонента-файла нет (`seat/seat.md`, решение `2026-10-30`).
  if (first.strays.length > 0) {
    config = read(configRel);
    field("componentsAt", []);
    write(configRel, config);
  }
  const layout = [];
  // Тесты вне `tests/` держит пункт своим числом, адреса печатает сверка:
  // список папок рос бы с проектом и стоял вторым рядом с настройкой.
  if (first.testsAway.length > 0)
    layout.push([
      "Тесты вне папки `tests/`",
      "`" + first.testsAway.length + "`",
      "«Тесты лежат в `tests/`»",
      "перенести в `tests/` своего слоя по слову разработчика; адреса печатает сверка",
      "`" + first.testsAway.length + "` тестов",
    ]);

  // 6. Долг вторым прогоном: файлы по предмету уже легли.
  const second = facts();
  if (second.strays.length > 0)
    layout.unshift([
      "Раскладка проекта своя: файлы кода вне слоёв умолчания",
      "`" + second.strays.length + "`",
      "«Новый узел лежит по раскладке»",
      "раскладка проекта остаётся, пока разработчик не скажет привести; адреса печатает сверка",
      "`" + second.strays.length + "` файлов",
    ]);
  config = read(configRel);
  for (const [kind, value] of Object.entries(second.debt)) {
    if (kind === "types" || kind === "lint") continue;
    const next = configDebt(config, kind, value === 0 ? null : value);
    if (next !== null) config = next;
  }
  write(configRel, config);
  const debtNow = { ...second.debt };
  for (const kind of ["types", "lint"]) {
    const m = new RegExp("^    " + kind + ": (\\d+),$", "m").exec(config);
    if (m !== null) debtNow[kind] = Number(m[1]);
  }
  const debtPlan = debtPlanOf(debtNow);
  if (second.unprobed > 0)
    layout.push([
      "Код под мутациями не мерян",
      "`" + second.unprobed + "`",
      "`graph.mjs mutated`",
      "мерить `npm run mutate` по слову разработчика; выживших разбирать тремя исходами (`code.md`, раздел «Мутационный прогон — машинная форма критерия о падающем тесте»)",
      "`" + second.unprobed + "` файлов",
    ]);
  write(
    transitionAt.to,
    transitionWith(
      read(transitionAt.to),
      { heading: "| № | Шаг | Объём | Чем проверяется |", debtHeading: "| № | Расхождение | Сейчас | Держит | План | Цена |" },
      debtPlan.steps,
      [...debtPlan.items, ...layout],
    ),
  );

  // 7. Испытание звеньев и базовая линия — знакомому.
  let redTests = 0;
  if (familiar) {
    const ownTestsGreen = runTool("npm", ["test"], { cwd: target, env }).status === 0;
    const trials = trialLiveLinks(target, env, roots, files, readJson(at("package.json")).scripts, ownTestsGreen);
    if (!ownTestsGreen) report.push("Мутации не испытаны: начальный прогон мутатора гоняет тесты проекта, а они красные.");
    const blind = trials.filter((t) => !t.caught);
    if (blind.length > 0)
      fail("Проверка не поймала посаженную ошибку — " + blind.map((t) => t.name).join(", ") + ". Это поломка обвязки, а не проекта:", ...tailOf(blind[0].said));
    const debtSaid = (kind) => {
      const m = new RegExp("^    " + kind + ": (\\d+),$", "m").exec(read(configRel));
      return m === null ? "" : ", долг `" + m[1] + "`";
    };
    for (const name of ["typecheck", "lint"]) {
      const run = npmRun(name);
      if (run.status !== 0) fail("Звено " + name + " красное на свежей посадке:", ...tailOf(saidBy(run)));
      rows.push({ name, result: "зелено" + debtSaid(name === "typecheck" ? "types" : "lint"), how: "npm run " + name });
    }
    const format = npmRun("format:check");
    const unformatted = (uncolored(format.out).match(/^\[warn\] (?!Code style)/gm) ?? []).length;
    rows.push({
      name: "format:check",
      result: format.status === 0 ? "зелено" : "красно: файлов `" + unformatted + "` — приводит фаза 2 отдельным коммитом",
      how: "npm run format:check",
    });
    // Тесты, красные на коде до посадки, — долг проекта, а не поломка
    // посадки: держит их пункт долга, называющий звено.
    const test = runTool("npm", ["test"], { cwd: target, env });
    const counts = testCountsOf(test.out);
    if (test.status === 0)
      rows.push({
        name: "test",
        result: counts === null ? "зелено" : "зелено, тестов `" + counts.tests + "` в файлах `" + counts.files + "`",
        how: "npm test",
      });
    else {
      const failed = Number(/Test Files\s+(\d+) failed/.exec(uncolored(test.out))?.[1] ?? 1);
      rows.push({ name: "test", result: "красно: падают файлов тестов `" + failed + "` — пункт долга перехода «test»", how: "npm test" });
      redTests = failed;
      report.push("Тесты проекта красные на коде до посадки: падают файлов " + failed + "; записаны в план перехода.");
    }
    if (redTests > 0)
      write(
        transitionAt.to,
        transitionWith(read(transitionAt.to), { heading: "| № | Шаг | Объём | Чем проверяется |", debtHeading: "| № | Расхождение | Сейчас | Держит | План | Цена |" }, [], [
          ["Тесты проекта красные на коде до посадки", "`" + redTests + "`", "«test»", "адреса печатает `npm test`; чинит работа по слову разработчика", "`" + redTests + "` файлов тестов"],
        ]),
      );
    const mutated = trials.find((t) => t.name === "mutate");
    if (mutated !== undefined)
      rows.push({
        name: "mutate",
        result: "испытан пробной парой: убито `" + mutated.killed + "` из `" + mutated.total + "`",
        how: "npm run mutate -- --mutate <файл>",
      });
    report.push("Проверки испытаны посаженной ошибкой: обнаружили " + trials.length + " из " + trials.length + ".");
  }
  const tiersRun = runTool(process.execPath, [at(".claude/tools/graph.mjs"), "tiers"], { cwd: target, env });
  try {
    write(".context/01-facts.md", factsWithBaseline(read(".context/01-facts.md"), rows, tiersFrom(tiersRun.out), new Date().toISOString().slice(0, 10)));
  } catch (e) {
    fail("Базовая линия не записалась: " + e.message, ...tailOf(tiersRun.out));
  }

  // 8. Коммиты, основания, ворота.
  const identity = asked(["config", "user.email"]) ? [] : ["-c", "user.name=seat", "-c", "user.email=seat@local"];
  const git = (...args) => execFileSync("git", [...identity, ...args], quiet).trim();
  // Свои ворота проекта посадка не обходит: не пустили коммит — отказ, и
  // проект как был. Отказ git на любом из двух коммитов — занятый индекс,
  // подпись, хук — идёт тем же откатом: прежде `git add` мимо него оставлял
  // проект посаженным наполовину.
  const startHead = asked(["rev-parse", "HEAD"]);
  const markerAt = path.join(target, ".git", SEAT_HERE_MARKER);
  const commitFailed = (e) => {
    asked(["reset", "-q", ...(startHead === null ? [] : [startHead])]);
    rmSync(markerAt, { force: true });
    fail("Коммит посадки не прошёл — ворота проекта либо git:", ...tailOf(String(e.stdout ?? "") + String(e.stderr ?? "") || String(e.message), 8));
  };
  try {
    git("add", "-A");
    git("commit", "-qm", "chore: seat the harness");
  } catch (e) {
    commitFailed(e);
  }
  try {
    writeFileSync(markerAt, norm(shelf) + "\n");
    const base = git("rev-parse", "HEAD");
    write(configRel, withSeatingBase(read(configRel), base));
    git("commit", "-qam", "chore: record the seating bases of the bar, the series and the findings");
  } catch (e) {
    commitFailed(e);
  }
  if (familiar) git("config", "core.hooksPath", ".claude/hooks/git");
  const verify = runTool(process.execPath, [at(".claude/tools/graph.mjs"), "verify"], { cwd: target, env });

  say(
    "ПОСАДКА НЕ ЗАВЕРШЕНА. Фаза 1 закончена.",
    "",
    "СЦЕНАРИЙ: " + SCENARIO_NAMES[profile.scenario],
    "",
    "СДЕЛАНО",
    "  1. Рабочие правила и инструмент лежат в .claude/: файлов " + walkFiles(at(".claude")).length + ".",
    "  2. Заведены записи о проекте — файлов в .context/: " + walkFiles(at(".context")).length + ". Своего кода посадка не читала: что не описано, названо числом в плане перехода.",
    familiar
      ? "  3. Проверки приведены композицией: конфиги проекта лежат рядом `*.project.config.*` и подключены из конфигов обвязки."
      : "  3. Конфиги, пакеты и скрипты проекта не тронуты.",
    ...report.map((one, i) => "  " + (i + 4) + ". " + one),
    "  " + (report.length + 4) + ". Репозиторий: посадка — двумя коммитами" + (familiar ? "; проверка перед каждым коммитом подключена." : "; ворот перед коммитом нет: цепочка проверок у проекта своя."),
  );
  if (!familiar) say("", "ЧТО ОБВЯЗКА НЕ ВИДИТ", ...foreignOffer(profile.foreign).map((one) => "  " + one));
  say(
    "",
    "ФАЗА 2 — ЗАВЕРШЕНИЕ ПОСАДКИ, ОЖИДАЕТ ОТВЕТА",
    "  1. Что это за проект. Ответ ПО СЛОТАМ, по фразе на каждый: что это; для кого и",
    "     зачем; чем НЕ является; что законно, хотя со стороны читается нарушением.",
    "  Дальше переход: `.claude/seat/transition.md`.",
  );
  if (verify.status !== 0)
    say("", "Записи о проекте красные — посадка сделана не до конца. Разобрать:", "  node .claude/tools/graph.mjs verify", ...tailOf(verify.out, 12));
  process.exit(verify.status === 0 ? 0 : 1);
};

/** Звенья живого проекта ловят посаженную ошибку — на копии проекта,
 * пакеты ссылкой. Ошибка сажается новым файлом в корень исходников: файл
 * проекта звено может уже называть, и тогда поимка неотличима от
 * слепоты. Мутации — пробная пара функции и теста. */
export const trialLiveLinks = (target, env, roots, files, scripts, mutate = true) => {
  const { at: box } = claimSandbox(systemTemp(), "seat-trial-");
  try {
    cpSync(target, box, {
      recursive: true,
      filter: (src) => {
        const top = path.relative(target, src).split(path.sep)[0];
        // Секреты проекта в песочницу не уезжают: проверкам они не нужны.
        return top !== "node_modules" && top !== ".git" && !/^\.env(?:\..+)?$/.test(path.basename(src));
      },
    });
    sandboxPackages(path.join(target, "node_modules"), path.join(box, "node_modules"));
    const root = roots[0] ?? "src";
    const ownTest = files.find((f) => TEST.test(f) && f.startsWith(root + "/")) ?? null;
    const testDir = ownTest === null ? root : path.posix.dirname(ownTest);
    const suffix = ownTest === null ? ".test.ts" : /(\.(?:test|spec)\.[cm]?[jt]sx?)$/.exec(ownTest)[1];
    const trials = [
      { name: "typecheck", file: root + "/zzSeatTrial.ts", text: 'export const zzSeatTrial: number = "not a number";\n', mark: "zzSeatTrial" },
      { name: "lint", file: root + "/zzSeatTrial.ts", text: "export function zzSeatTrial(): void {\n  debugger;\n}\n", mark: "no-debugger" },
      { name: "format:check", file: root + "/zzSeatTrial.ts", text: "export const zzSeatTrial   =    1;\n", mark: "zzSeatTrial" },
      {
        name: "test",
        file: testDir + "/zzSeatTrial" + suffix,
        text: 'import { expect, it } from "vitest";\n\nit("zz seat trial fails on purpose", () => {\n  expect(1).toBe(2);\n});\n',
        mark: "zz seat trial fails on purpose",
      },
    ];
    const out = [];
    for (const t of trials) {
      if (scripts[t.name] === undefined) continue;
      const file = path.join(box, t.file);
      writeFileSync(file, t.text);
      const run = runTool("npm", ["run", "-s", t.name], { cwd: box, env });
      rmSync(file, { force: true });
      out.push({ name: t.name, caught: run.status !== 0 && uncolored(run.out).includes(t.mark), said: saidBy(run) });
    }
    if (scripts.mutate !== undefined && mutate) {
      const unit = root + "/zzSeatTrialSum.ts";
      const rel = path.posix.relative(testDir, root + "/zzSeatTrialSum");
      writeFileSync(path.join(box, unit), "export const zzSeatTrialSum = (a: number, b: number): number => a + b;\n");
      writeFileSync(
        path.join(box, testDir, "zzSeatTrialSum" + suffix),
        'import { expect, it } from "vitest";\nimport { zzSeatTrialSum } from "' + (rel.startsWith(".") ? rel : "./" + rel) + '";\n\nit("zz seat trial sums", () => {\n  expect(zzSeatTrialSum(2, 3)).toBe(5);\n});\n',
      );
      const run = runTool("npm", ["run", "-s", "mutate", "--", "--mutate", unit, "--reporters", "json"], { cwd: box, env });
      const report = path.join(box, "reports", "mutation", "mutation.json");
      const mutants = existsSync(report)
        ? Object.values(JSON.parse(readFileSync(report, "utf8")).files ?? {}).flatMap((f) => f.mutants ?? [])
        : [];
      const killed = mutants.filter((m) => m.status === "Killed").length;
      out.push({ name: "mutate", caught: run.status === 0 && killed > 0, said: saidBy(run), killed, total: mutants.length });
    }
    return out;
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
};
