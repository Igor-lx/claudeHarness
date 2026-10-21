import { execFileSync, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Временная папка системы, годная для записи, — либо ошибка, которая её
 * называет. Режимы, заводящие там песочницу, брали её каждый сам и при
 * негодной папке падали сырым стеком, а `handoff` оставлял непроверенный
 * снимок. Найдено пробой по холодному контуру.
 *
 * Отдаётся настоящее имя папки. Windows при имени пользователя длиннее восьми
 * букв задаёт `TEMP` коротким именем (`RUNNER~1`), а git и сборщик видят ту
 * же папку длинным: `vitest` в песочнице не находил файл подготовки, суд
 * пробы не узнавал свою песочницу. Найдено прогоном на Windows. */
export const systemTemp = () => {
  const dir = tmpdir();
  try {
    accessSync(dir, constants.W_OK);
    if (!statSync(dir).isDirectory()) throw new Error("это не папка");
  } catch (e) {
    throw new Error(
      `временная папка системы недоступна: ${dir} (${e.code ?? e.message}) — задать ${process.platform === "win32" ? "TEMP" : "TMPDIR"}`,
    );
  }
  return realpathSync.native(dir);
};

/** Запуск внешней команды — один на инструмент. На Windows менеджер пакетов
 * и их бинарники — файлы `.cmd`, и без оболочки их не найти. Исполняемому
 * файлу оболочка только мешает: `cmd.exe` разбирает его доводы заново, и
 * скрипт `node -e` с кавычками и скобками приходил разломанным — обёртка
 * долга типов считала ноль ошибок (W-6). Не запустившаяся команда называет
 * причину в `error`, а вывод всегда строка: прежде места без этой поправки
 * печатали «код 1» с пустым журналом либо падали на сложении `undefined`. */
export const runTool = (
  command,
  args,
  opts = {},
  platform = process.platform,
) => {
  const shell =
    platform === "win32" &&
    command !== process.execPath &&
    !/\.(?:exe|com)$/i.test(command);
  const run = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell,
    ...opts,
  });
  // Ненайденную команду `cmd.exe` не отличает: отвечает кодом 1 своими
  // словами. Её ищут сами, и ненайденная с ненулевым кодом — не
  // запустившаяся, без вывода, как везде; встроенная команда оболочки
  // файла не имеет, но код у неё ноль.
  const missing =
    shell &&
    run.error === undefined &&
    run.status !== 0 &&
    !onWindowsPath(command, opts);
  const stdout = missing ? "" : String(run.stdout ?? "");
  const stderr = missing ? "" : String(run.stderr ?? "");
  return {
    status: run.error === undefined && !missing ? run.status : null,
    stdout,
    stderr,
    out: stdout + stderr,
    error:
      run.error !== undefined
        ? "не запустилась: " +
          command +
          " (" +
          (run.error.code ?? run.error.message) +
          ")"
        : missing
          ? "не запустилась: " + command + " (ENOENT)"
          : null,
  };
};

/** Есть ли файл команды там, где его ищет `cmd.exe`: по пути, а голое имя —
 * в папке запуска и в `PATH`, с каждым расширением `PATHEXT`. */
const onWindowsPath = (command, { cwd = process.cwd(), env = process.env } = {}) => {
  const exts = String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const dirs = /[\\/]/.test(command)
    ? [cwd]
    : [cwd, ...String(env.PATH ?? env.Path ?? "").split(path.delimiter)];
  return dirs
    .filter(Boolean)
    .map((dir) => path.resolve(dir, command))
    .some((base) => [base, ...exts.map((e) => base + e)].some((f) => existsSync(f)));
};

/** Сравнение версий — одно на инструмент. Отрицательное — первая ниже.
 * Сравниваются первые `depth` частей; приставка `v` и хвост `-pre`
 * отбрасываются. */
export const versionCmp = (a, b, depth = 3) => {
  const parts = (v) =>
    String(v)
      .replace(/^[^0-9]*/, "")
      .split(".")
      .map((one) => parseInt(one, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < depth; i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/** Проверенная связка из текста семени настройки: имя → версия. Читается
 * внутри своего блока, а не до конца файла. */
export const verifiedOf = (text) => {
  const from = text.indexOf("verifiedVersions: {");
  if (from < 0) return {};
  const block = text.slice(from, text.indexOf("}", from));
  return Object.fromEntries(
    [...block.matchAll(/^\s*"?([^\s":]+)"?:\s*"([^"]+)"/gm)].map((m) => [
      m[1],
      m[2],
    ]),
  );
};

/** Версия установленного орудия среды: у `node` — своя, у прочих —
 * ответ `--version`; молчание — `null`. */
export const toolVersion = (name) => {
  if (name === "node") return process.versions.node;
  const run = runTool(name, ["--version"]);
  return run.status === 0 ? run.stdout.trim() : null;
};

/** Среда против проверенной связки: что отвечает и что ниже. Спрашиваются
 * среда и менеджер пакетов — пакеты на этом шаге ещё не стоят. Команда
 * подъёма отдаётся готовой: «поднимите менеджер» заставляло гадать. */
export const envLowOf = (declared, versionOf = toolVersion) => {
  const low = [];
  const seen = [];
  for (const name of ["node", "npm"]) {
    const need = declared[name] ?? null;
    if (need === null) continue;
    const have = versionOf(name);
    if (have === null) {
      low.push({ name, have: "не отвечает", need, how: "поставить" });
      continue;
    }
    seen.push(name + " " + have + " (нужно " + need + ")");
    if (versionCmp(have, need) < 0)
      low.push({
        name,
        have,
        need,
        how:
          name === "npm"
            ? "npm i -g npm@" + need.split(".")[0]
            : "поставить отдельно: менеджером версий среды либо установщиком",
      });
  }
  return { seen, low };
};

/** Почему линт обвязки на живом проекте не встанет: TypeScript новее
 * проверенного по второй части версии либо свой линтер `oxlint`. Пусто —
 * помех нет. Правила `2026-10-19` в `seat/seat.md`, раздел «Умолчание — это
 * то, что привезла обвязка». */
export const lintBlockersOf = (manifest, declared) => {
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const out = [];
  const ts = deps.typescript ?? "";
  if (
    declared.typescript !== undefined &&
    /\d/.test(ts) &&
    versionCmp(ts, declared.typescript, 2) > 0
  )
    out.push(
      "TypeScript " +
        ts +
        " новее проверенного " +
        declared.typescript +
        ": правила линта обвязки его не принимают",
    );
  if (deps.oxlint !== undefined)
    out.push("линтер проекта — oxlint: конфиг линта обвязки ему не читается");
  return out;
};

/** Песочница прогона под номером, занятая атомарно: два запуска одного режима
 * в одну миллисекунду стирали друг другу папку посреди работы. Занятый номер
 * обходится, чужая папка не стирается. */
export const claimSandbox = (
  parent,
  prefix,
  from = Number(String(Date.now()).slice(-8)),
) => {
  for (let seq = from; ;) {
    const at = path.join(parent, prefix + seq);
    try {
      mkdirSync(at);
      return { at, id: String(seq) };
    } catch (e) {
      // Родителя снял соседний прогон, уходя: завести и повторить номер.
      if (e.code === "ENOENT") mkdirSync(parent, { recursive: true });
      else if (e.code === "EEXIST") seq += 1;
      else throw e;
    }
  }
};

/** Манифесты установленных пакетов — и только они.
 *
 * Папка зависимостей в песочницу не копируется: она весит сотни мегабайт и
 * к содержимому сверок отношения не имеет. Но сверка версий читает именно
 * её — номер версии лежит в манифесте каждого пакета, — и в песочнице ей
 * нечего было читать: она не краснела НИКОГДА, то есть рецепта под неё не
 * существовало в принципе. Манифесты весят килобайты, и этого довольно.
 *
 * Найдено при выплате долга рецептов: поломка, работающая на самом проекте,
 * в песочнице молчала. */
export const sandboxManifests = (from, to) => {
  if (!existsSync(from)) return;
  for (const e of readdirSync(from)) {
    const dir = path.join(from, e);
    if (!statSync(dir).isDirectory()) continue;
    if (e.startsWith("@")) {
      sandboxManifests(dir, path.join(to, e));
      continue;
    }
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    mkdirSync(path.join(to, e), { recursive: true });
    writeFileSync(path.join(to, e, "package.json"), readFileSync(manifest));
  }
};

/** Пакеты проекта для песочницы пробы — ссылкой на каждый пакет.
 *
 * Свод в песочнице пробы зовёт линт проекта, а линту нужны пакеты целиком.
 * С одними манифестами `eslint` не разрешался: свод печатал «линт
 * недоступен», правила линта как держатели в пробе молчали, и проба мерила
 * проход не в тех условиях, в которых его делают. Найдено пробой планки.
 *
 * Копия весила бы сотни мегабайт, ссылка не весит ничего. Скрытые папки,
 * кроме `.bin`, не связываются: туда пишут кэши раннеров, и запись из
 * песочницы легла бы в папку проекта. Песочница фальсификации держит одни
 * манифесты: рецепт ломает то, что лежит в песочнице, и ссылка донесла бы
 * поломку до проекта. Ссылку завести нельзя — пакет едет манифестом. */
export const sandboxPackages = (from, to) => {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) {
    if (e.startsWith(".") && e !== ".bin") continue;
    const dir = path.join(from, e);
    try {
      symlinkSync(dir, path.join(to, e), "junction");
    } catch {
      if (!statSync(dir).isDirectory()) continue;
      if (e.startsWith("@")) sandboxManifests(dir, path.join(to, e));
      else if (existsSync(path.join(dir, "package.json"))) {
        mkdirSync(path.join(to, e), { recursive: true });
        writeFileSync(
          path.join(to, e, "package.json"),
          readFileSync(path.join(dir, "package.json")),
        );
      }
    }
  }
};

const norm = (p) => p.split(path.sep).join("/");

/** Метка посадки в папке git: её ставит первый вызов `seat`. Только с ней
 * повторный вызов вправе стирать в `.claude/`, и по ней сверки описания полки
 * узнают испытательную посадку. */
export const SEAT_MARKER = "claude-seat";
/** Метка посадки на месте — своя: проект, посаженный на месте, живой, и
 * сверки испытательной посадки, которые узнают её по `SEAT_MARKER`, к нему не
 * относятся. Нужна одному повторному вызову. */
export const SEAT_HERE_MARKER = "claude-seat-here";

const walkFiles = (root, rel = ".", out = []) => {
  for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) walkFiles(root, r, out);
    else out.push(r);
  }
  return out;
};

/** Файлы полки — всё, что едет с обвязкой, кроме файлов проекта внутри неё. */
const shelfFiles = (shelf, own) =>
  walkFiles(shelf).filter((r) => !(path.dirname(r) === "." && own.has(r)));

/** Обвязка с полки в папку проекта: папки посадки, полка без файлов проекта,
 * семена, кроме тех, что кладут не при посадке. Порядок один на всех, кто
 * сажает: режим `seat`, стенд проб, самопроверка снимка, тесты обвязки. Пока
 * каждый держал свою копию, пометка семени появилась данными, самопроверка
 * снимка её не узнала, и снимок перестал собираться. Отдаёт число файлов
 * полки. */
export const layShelf = (shelf, target) => {
  const map = JSON.parse(
    readFileSync(path.join(shelf, "seat", "map.json"), "utf8"),
  );
  const files = shelfFiles(shelf, new Set(map.projectOwnedInsideHarness ?? []));
  for (const d of map.dirs ?? [])
    mkdirSync(path.join(target, d), { recursive: true });
  for (const r of files)
    cpSync(path.join(shelf, r), path.join(target, ".claude", r));
  for (const one of map.copy ?? []) {
    if (one.notAtSeating !== undefined) continue;
    const from = path.join(shelf, one.from);
    if (!existsSync(from)) throw new Error("на полке нет семени: " + one.from);
    cpSync(from, path.join(target, one.to));
  }
  return files.length;
};

/** Механика фазы 1 в живой проект: обвязка с полки, папки посадки и
 * семена, кроме каркаса и отложенных; семя, столкнувшееся с файлом проекта,
 * ложится рядом с суффиксом `.seat` — сливает его фаза 2 (`seat/seat.md`,
 * шаг 1). Слияния, которые требуют суждения, — манифест, настройки среды, —
 * здесь не делаются. Зовёт её корпус чужих проектов: он сверяет, как
 * инструмент читает проект, устроенный не по умолчаниям обвязки. Отдаёт
 * отложенные в `.seat`. */
export const layShelfLive = (shelf, target) => {
  const map = JSON.parse(
    readFileSync(path.join(shelf, "seat", "map.json"), "utf8"),
  );
  const files = shelfFiles(shelf, new Set(map.projectOwnedInsideHarness ?? []));
  for (const d of map.dirs ?? [])
    mkdirSync(path.join(target, d), { recursive: true });
  for (const r of files)
    cpSync(path.join(shelf, r), path.join(target, ".claude", r));
  const deferred = [];
  for (const one of map.copy ?? []) {
    if (one.notAtSeating !== undefined || one.onlyWhenEmpty === true) continue;
    const to = path.join(target, one.to);
    const busy = existsSync(to);
    cpSync(path.join(shelf, one.from), busy ? to + ".seat" : to);
    if (busy) deferred.push(one.to);
  }
  return deferred;
};

/** Имена, которые витрина хостинга кладёт в новый репозиторий: описание,
 * лицензия и список исключений git. Кода в них нет. */
const HOSTING_NAMES = [/^readme(\.md|\.txt)?$/i, /^licen[cs]e(\.md|\.txt)?$/i, /^\.gitignore$/];
/** Служебный мусор файловых менеджеров: о проекте он не говорит ничего. */
const OS_LITTER = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
/** Что создаёт шаблон `create vite` и что посадка на его месте убирает. */
const VITE_TEMPLATE = [
  /^index\.html$/,
  /^package(-lock)?\.json$/,
  /^node_modules$/,
  /^tsconfig.*\.json$/,
  /^vite\.config\.ts$/,
  /^\.oxlintrc\.json$/,
  /^eslint\.config\.js$/,
  /^\.gitignore$/,
  /^README\.md$/,
  /^public$/,
  /^src$/,
];

/** Что лежит в папке посадки на месте рядом с полкой. `entries` — имена в
 * корне, кроме `.claude` и `.git`; `read` — текст файла по пути от корня либо
 * `null`; `commits` — коммитов в репозитории. Свежий шаблон узнаётся по трём
 * признакам сразу (`seat/seat.md`, раздел «Умолчание — это то, что привезла
 * обвязка»); всё, что не пусто, не витрина и не шаблон, — живой проект. */
export const inPlaceKindOf = (entries, read, commits) => {
  const own = entries.filter((e) => !OS_LITTER.has(e));
  if (own.length === 0) return { kind: "пусто", remove: [], extra: [] };
  if (own.every((e) => HOSTING_NAMES.some((re) => re.test(e))))
    return { kind: "витрина", remove: [], extra: [] };
  const fromTemplate = own.filter((e) => VITE_TEMPLATE.some((re) => re.test(e)));
  const template =
    commits <= 1 &&
    (read("README.md") ?? "").split("\n")[0].trim() ===
      "# React + TypeScript + Vite" &&
    (read("src/App.tsx") ?? "").includes("and save to test HMR");
  const extra = own.filter((e) => !fromTemplate.includes(e));
  if (template && extra.length === 0)
    return { kind: "шаблон", remove: fromTemplate.sort(), extra: [] };
  return { kind: "живой", remove: [], extra: own.sort() };
};

/** Список исключений git проекта, дополненный строками семени, которых в
 * нём нет; свои строки проекта идут первыми и не трогаются. */
export const mergedLines = (own, seed) => {
  const have = new Set(own.split("\n").map((l) => l.trim()));
  const add = seed
    .split("\n")
    .filter((l) => l.trim() !== "" && !have.has(l.trim()));
  if (add.length === 0) return own;
  return (own.endsWith("\n") || own === "" ? own : own + "\n") + add.join("\n") + "\n";
};

/** Текст без кодов цвета терминала. На Windows раннеры красят вывод и без
 * терминала: строку `Tests  2 passed` `vitest` печатал с кодами внутри, и
 * разбор числа тестов её не узнавал. Найдено прогоном на Windows. */
export const uncolored = (text) =>
  String(text).replace(new RegExp("\\u001b\\[[0-9;]*m", "g"), "");

/** Число тестов и файлов из вывода `vitest run`; не нашлось — `null`. */
export const testCountsOf = (said) => {
  const out = uncolored(said);
  const tests = /^\s*Tests\s+(\d+) passed/m.exec(out);
  const files = /^\s*Test Files\s+(\d+) passed/m.exec(out);
  return tests === null || files === null
    ? null
    : { tests: Number(tests[1]), files: Number(files[1]) };
};

/** Порядок цены по классу задачи из вывода режима `tiers`: строка — число,
 * порядок словом и класс до тире. */
export const tiersFrom = (out) =>
  new Map(
    [...out.matchAll(/^\s*\d+\s+(\S+(?: \S+)?)\s{2,}(.+?) — /gm)].map((m) => [
      m[2],
      m[1],
    ]),
  );

/** Факты проекта с записанной базовой линией и ценой ярусов: место под замер
 * между пометками пустоты снимается вместе с ними, `<замер>` в таблице ярусов
 * получает порядок цены. Класс, которого режим не назвал, — ошибка: таблица
 * осталась бы с подсказкой заготовки. */
export const factsWithBaseline = (text, rows, tiers, date) => {
  const head = text.indexOf("## Базовая линия");
  const from = text.indexOf("<!-- ПУСТО -->", head);
  const to = text.indexOf("<!-- /ПУСТО -->", from);
  if (head < 0 || from < 0 || to < 0)
    throw new Error("в фактах нет места под базовую линию");
  const table = [
    "| Звено | Исход | Чем получено |",
    "| --- | --- | --- |",
    ...rows.map((r) => "| `" + r.name + "` | " + r.result + " | `" + r.how + "` |"),
  ].join("\n");
  const withBase =
    text.slice(0, from) + table + text.slice(to + "<!-- /ПУСТО -->".length);
  return withBase.replace(/^\| ([^|]+?) \| <замер> \|$/gm, (line, cls) => {
    const word = tiers.get(cls.trim());
    if (word === undefined)
      throw new Error("режим ярусов не назвал класс: " + cls.trim());
    return (
      "| " + cls + " | `" + word + "`, замер `" + date + "` командой `graph.mjs tiers` |"
    );
  });
};

/** Посаженные ошибки, по одной на звено: дописываются в заготовку
 * приложения, и звено обязано упасть со словом `mark` в выводе. Сажают в
 * исполняемый текст, а не в комментарий: форматтер комментария не трогает
 * (`seat/seat.md`, шаг 6-бис). */
export const SEAT_TRIALS = [
  {
    name: "typecheck",
    file: "src/app/App.tsx",
    add: 'export const zzSeatTrial: number = "not a number";\n',
    mark: "App.tsx",
  },
  {
    name: "lint",
    file: "src/app/App.tsx",
    add: "export function zzSeatTrial(): void {\n  debugger;\n}\n",
    mark: "no-debugger",
  },
  {
    name: "format:check",
    file: "src/app/App.tsx",
    add: "export const zzSeatTrial   =    1;\n",
    mark: "App.tsx",
  },
  {
    name: "test",
    file: "src/app/tests/App.test.tsx",
    add: '\nit("zz seat trial fails on purpose", () => {\n  expect(1).toBe(2);\n});\n',
    mark: "zz seat trial fails on purpose",
  },
];
/** Файл, по которому мутационный прогон обязан убить хоть одного мутанта. */
const MUTATE_TRIAL = "src/app/App.tsx";

/** Каждое звено ловит свою посаженную ошибку — на временной копии проекта,
 * пакеты ссылкой. Звено, которого в манифесте нет, не испытывается. Мутации:
 * прогон по заготовке убил хоть одного мутанта. */
const trialLinks = (target, env) => {
  const { at: box } = claimSandbox(systemTemp(), "seat-trial-");
  try {
    cpSync(target, box, {
      recursive: true,
      filter: (src) => {
        const top = path.relative(target, src).split(path.sep)[0];
        return top !== "node_modules" && top !== ".git";
      },
    });
    sandboxPackages(path.join(target, "node_modules"), path.join(box, "node_modules"));
    const scripts =
      JSON.parse(readFileSync(path.join(box, "package.json"), "utf8")).scripts ?? {};
    const out = [];
    for (const t of SEAT_TRIALS) {
      if (scripts[t.name] === undefined) continue;
      const at = path.join(box, t.file);
      const was = readFileSync(at, "utf8");
      writeFileSync(at, was + t.add);
      const run = runTool("npm", ["run", "-s", t.name], { cwd: box, env });
      writeFileSync(at, was);
      out.push({
        name: t.name,
        caught: run.status !== 0 && uncolored(run.out).includes(t.mark),
        said: run.out,
      });
    }
    if (scripts.mutate !== undefined) {
      const run = runTool(
        "npm",
        ["run", "-s", "mutate", "--", "--mutate", MUTATE_TRIAL, "--reporters", "json"],
        { cwd: box, env },
      );
      const report = path.join(box, "reports", "mutation", "mutation.json");
      const mutants = existsSync(report)
        ? Object.values(JSON.parse(readFileSync(report, "utf8")).files ?? {}).flatMap(
            (f) => f.mutants ?? [],
          )
        : [];
      const killed = mutants.filter((m) => m.status === "Killed").length;
      out.push({
        name: "mutate",
        caught: run.status === 0 && killed > 0,
        said: run.out,
        killed,
        total: mutants.length,
      });
    }
    return out;
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
};

/** Последние строки вывода — для отказа: причина обычно в конце. */
const tailOf = (text, n = 6) =>
  text.trim() === ""
    ? ["  (вывода нет)"]
    : text.trim().split("\n").slice(-n).map((l) => "  " + l);

/** Посадка в пустую папку на месте: полка уже лежит в `.claude` этой
 * папки, и режим делает фазу 1 целиком — среду, семена, пакеты, испытание
 * звеньев, базовую линию, репозиторий и ворота, сверку базы — и печатает
 * отчёт фазы 1 с вопросом фазы 2 (решение разработчика Р1, `2026-10-20`).
 * Отказ до первого коммита возвращает папку в прежний вид: повторный вызов
 * после починки идёт с начала. */
const runSeatHere = ({ shelf, target, env, packagesFrom }) => {
  const say = (...lines) => {
    for (const one of lines) console.log(one);
  };
  const refuse = (...why) => {
    say("=== Посадка не собрана ===", ...why.map((one) => "  " + one));
    process.exit(1);
  };
  const gitDir = path.join(target, ".git");
  const marker = path.join(gitDir, SEAT_HERE_MARKER);
  if (existsSync(marker)) {
    say(
      "=== Посадка уже сделана ===",
      "  Фаза 1 собрана этой командой — метка " + SEAT_HERE_MARKER + " стоит; повторять нечего.",
      "  Дальше фаза 2: `.claude/seat/seat.md`, раздел «Фаза 2. Завершение посадки».",
    );
    process.exit(0);
  }
  const quiet = { cwd: target, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] };
  const asked = (args) => {
    try {
      return execFileSync("git", args, quiet).trim();
    } catch {
      return "";
    }
  };
  const commits = existsSync(gitDir)
    ? Number(asked(["rev-list", "--count", "HEAD"]) || 0)
    : 0;
  if (commits > 1)
    refuse(
      "У репозитория своя история — коммитов " + commits + ": это живой проект.",
      "Сажать по инструкции `.claude/seat/seat.md`.",
    );
  const read = (rel) => {
    const at = path.join(target, rel);
    return existsSync(at) && statSync(at).isFile() ? readFileSync(at, "utf8") : null;
  };
  const entries = readdirSync(target).filter((e) => e !== ".claude" && e !== ".git");
  const kind = inPlaceKindOf(entries, read, commits);
  if (kind.kind === "живой")
    refuse(
      "Живой проект: сажать по инструкции `.claude/seat/seat.md`.",
      "Кроме обвязки здесь лежит: " +
        kind.extra.slice(0, 6).join(", ") +
        (kind.extra.length > 6 ? ", …" : "") +
        ".",
    );
  const declared = verifiedOf(
    readFileSync(path.join(shelf, "seat", "templates", "graph.config.mjs"), "utf8"),
  );
  const { low } = envLowOf(declared);
  if (low.length > 0)
    refuse(
      "Среда ниже проверенной связки — посадка не начата, папка не тронута:",
      ...low.map((one) => "  " + one.name + " " + one.have + " — нужно " + one.need),
      "Чем поднять:",
      ...low.map((one) => "  " + one.how),
      "Поднимать ли — решает разработчик; после подъёма команду зовут снова.",
    );

  // Откат: всё, что положила посадка, снимается в обратном порядке.
  const undo = [];
  const rollback = () => {
    for (const step of undo.reverse()) step();
  };
  const fail = (...why) => {
    rollback();
    refuse(...why, "Папка возвращена в прежний вид.");
  };
  // Шаблон уезжает во временную папку, а не стирается: откат возвращает его,
  // удачная посадка снимает копию.
  let keep = null;
  if (kind.remove.length > 0) {
    keep = claimSandbox(systemTemp(), "seat-template-").at;
    for (const name of kind.remove) {
      cpSync(path.join(target, name), path.join(keep, name), { recursive: true });
      rmSync(path.join(target, name), { recursive: true, force: true });
    }
    undo.push(() => {
      for (const name of kind.remove)
        cpSync(path.join(keep, name), path.join(target, name), { recursive: true });
      rmSync(keep, { recursive: true, force: true });
    });
  }

  const map = JSON.parse(readFileSync(path.join(shelf, "seat", "map.json"), "utf8"));
  const conflicts = [];
  let mergedIgnore = false;
  try {
    for (const d of map.dirs ?? []) {
      const at = path.join(target, d);
      if (existsSync(at)) continue;
      mkdirSync(at, { recursive: true });
      undo.push(() => rmSync(at, { recursive: true, force: true }));
    }
    for (const one of map.copy ?? []) {
      if (one.notAtSeating !== undefined) continue;
      const from = path.join(shelf, one.from);
      const to = path.join(target, one.to);
      if (existsSync(to)) {
        const was = readFileSync(to, "utf8");
        const seed = readFileSync(from, "utf8");
        if (was === seed) continue;
        if (one.to === ".gitignore") {
          writeFileSync(to, mergedLines(was, seed));
          mergedIgnore = true;
          undo.push(() => writeFileSync(to, was));
          continue;
        }
        cpSync(from, to + ".seat");
        conflicts.push(one.to);
        undo.push(() => rmSync(to + ".seat", { force: true }));
        continue;
      }
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(from, to);
      undo.push(() => rmSync(to, { force: true }));
    }
  } catch (e) {
    fail("Семена не легли: " + e.message);
  }

  const manifest = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
  const needed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const from = packagesFrom === null ? null : path.join(packagesFrom, "node_modules");
  undo.push(() => {
    rmSync(path.join(target, "node_modules"), { recursive: true, force: true });
    rmSync(path.join(target, "package-lock.json"), { force: true });
  });
  const linked =
    from !== null && needed.every((n) => existsSync(path.join(from, n, "package.json")));
  if (linked) sandboxPackages(from, path.join(target, "node_modules"));
  else {
    const install = runTool("npx", ["-y", "npm@11", "install", "--no-audit", "--no-fund"], {
      cwd: target,
      env,
    });
    if (install.status !== 0)
      fail(
        "Пакеты не встали: установка `npx -y npm@11 install` упала:",
        ...tailOf(install.error ?? install.out, 3),
        "Нужна сеть; после её появления команду зовут снова.",
      );
  }

  const trials = trialLinks(target, env);
  const blind = trials.filter((t) => !t.caught);
  if (blind.length > 0)
    fail(
      "Проверка не поймала посаженную ошибку — " +
        blind.map((t) => t.name).join(", ") +
        ". Это поломка обвязки, а не проекта:",
      ...tailOf(blind[0].said),
    );

  const npmRun = (name) => runTool("npm", ["run", "-s", name], { cwd: target, env });
  const rows = [];
  for (const name of ["typecheck", "lint", "format:check", "test"]) {
    if (manifest.scripts?.[name] === undefined) continue;
    const run = npmRun(name);
    if (run.status !== 0)
      fail("Проверка красная на свежей посадке — " + name + ":", ...tailOf(run.out));
    const counts = name === "test" ? testCountsOf(run.out) : null;
    rows.push({
      name,
      result:
        counts === null
          ? "зелено"
          : "зелено, тестов `" + counts.tests + "` в файлах `" + counts.files + "`",
      how: name === "test" ? "npm test" : "npm run " + name,
      counts,
    });
  }
  const mutated = trials.find((t) => t.name === "mutate");
  if (mutated !== undefined)
    rows.push({
      name: "mutate",
      result:
        "зелено, убито `" + mutated.killed + "` из `" + mutated.total + "` по `" + MUTATE_TRIAL + "`",
      how: "npm run mutate -- --mutate " + MUTATE_TRIAL,
      counts: null,
    });
  const tool = path.join(target, ".claude", "tools", "graph.mjs");
  const tiersRun = runTool(process.execPath, [tool, "tiers"], { cwd: target, env });
  const factsAt = path.join(target, ".context", "01-facts.md");
  try {
    writeFileSync(
      factsAt,
      factsWithBaseline(
        readFileSync(factsAt, "utf8"),
        rows,
        tiersFrom(tiersRun.out),
        new Date().toISOString().slice(0, 10),
      ),
    );
  } catch (e) {
    fail("Базовая линия не записалась: " + e.message, ...tailOf(tiersRun.out));
  }

  // Репозиторий, коммит посадки, основания ревизии и серии, ворота. Отката
  // дальше нет: коммиты — уже история.
  const hadGit = existsSync(gitDir);
  if (!hadGit) execFileSync("git", ["init", "-q"], quiet);
  const identity =
    asked(["config", "user.email"]) === "" ? ["-c", "user.name=seat", "-c", "user.email=seat@local"] : [];
  const git = (...args) => execFileSync("git", [...identity, ...args], quiet).trim();
  writeFileSync(marker, norm(shelf) + "\n");
  git("add", "-A");
  git("commit", "-qm", "seat");
  const base = git("rev-parse", "HEAD");
  const configAt = path.join(target, ".context", "graph.config.mjs");
  writeFileSync(
    configAt,
    readFileSync(configAt, "utf8")
      .replace(/^ {2}barSince: null,/m, '  barSince: "' + base + '",')
      .replace(/^ {2}seriesSince: null,/m, '  seriesSince: "' + base + '",'),
  );
  git("commit", "-qam", "barSince, seriesSince");
  git("config", "core.hooksPath", ".claude/hooks/git");
  if (keep !== null) rmSync(keep, { recursive: true, force: true });
  const verify = runTool(process.execPath, [tool, "verify"], { cwd: target, env });

  const count = (dir) => walkFiles(path.join(target, dir)).length;
  const caught = trials.length;
  const tested = rows.find((r) => r.name === "test")?.counts ?? null;
  const outcome = (name) => (rows.some((r) => r.name === name) ? "зелено" : "не объявлены");
  say(
    "ПОСАДКА НЕ ЗАВЕРШЕНА. Фаза 1 закончена.",
    "",
    "СДЕЛАНО",
    "  1. Рабочие правила и инструмент лежат в .claude/: файлов " + count(".claude") + ".",
    "  2. Заведены записи о проекте — файлов в .context/: " +
      count(".context") +
      ". Заготовки пусты; что и когда в них вносят, сказано внутри каждой.",
    "  3. Установлены файлы в корне: правила этого репозитория (CLAUDE.md), настройки",
    "     проверок, документы для человека. Заготовка приложения установлена: проект",
    "     пуст, и проверкам нужен предмет.",
    "  4. Пакеты по package.json — " +
      needed.length +
      (linked ? ", ссылкой на уже установленные: " + norm(from) + "." : ", установлены."),
    "  5. Проверки прогнаны: типы " +
      outcome("typecheck") +
      ", линт " +
      outcome("lint") +
      ", формат " +
      outcome("format:check") +
      ", тесты " +
      (tested === null ? outcome("test") : tested.tests + ", зелено") +
      ", записи о проекте " +
      (verify.status === 0 ? "зелено" : "красно") +
      ".",
    "  6. Проверки испытаны посаженной ошибкой: обнаружили " + caught + " из " + caught + ".",
    "  7. Числа прогона и цена ярусов входа записаны как точка отсчёта (.context/01-facts.md).",
    "  8. Репозиторий git " +
      (hadGit ? "был" : "заведён") +
      ", посадка — двумя коммитами; проверка перед каждым коммитом подключена.",
  );
  if (kind.kind === "шаблон")
    say(
      "  9. Заготовка шаблона сборщика заменена заготовкой обвязки: убраны " +
        kind.remove.join(", ") +
        ".",
    );
  if (mergedIgnore)
    say("  9. В .gitignore дописаны строки обвязки; свои строки не тронуты.");
  if (conflicts.length > 0)
    say(
      "",
      "КОНФЛИКТЫ С СУЩЕСТВУЮЩИМИ ФАЙЛАМИ",
      ...conflicts.map(
        (one) =>
          "  - " +
          one +
          " — привезённый файл положен рядом как " +
          one +
          ".seat; что из него перенести в существующий, решает фаза 2.",
      ),
    );
  say(
    "",
    "ФАЗА 2 — ЗАВЕРШЕНИЕ ПОСАДКИ, ОЖИДАЕТ ОТВЕТА",
    "  1. Что это за проект. Ответ ПО СЛОТАМ, по фразе на каждый — свободной",
    "     прозой не отвечать:",
    "       — что это: приложение, библиотека, витрина, полигон, инструмент;",
    "       — для кого и зачем;",
    "       — чем НЕ является: за что можно принять по ошибке;",
    "       — что законно, хотя со стороны читается нарушением: намеренное",
    "         дублирование, широкая поверхность, копия ради изоляции.",
    "         «Таких нет» — полноценный ответ, но написать его надо.",
    "     Из ответа заполняются: заголовок и вводный абзац CLAUDE.md, краткая",
    "     сводка о проекте в карте кода и раздел об устройстве. Названное",
    "     законным заводит запись в реестре решений.",
    "",
    "ЗНАТЬ СРАЗУ",
    "  - Скиллы /task, /probe, /bar-probe, /audit, /handoff эта сессия не увидит:",
    "    перечень собирается на старте. Нужен перезапуск в папке проекта.",
  );
  if (kind.kind === "шаблон")
    say(
      "  - Версии шаблона заменены проверенными: TypeScript — " +
        declared.typescript +
        (kind.remove.includes(".oxlintrc.json") ? ", линтер — ESLint вместо oxlint." : "."),
    );
  if (verify.status !== 0)
    say(
      "",
      "Записи о проекте красные — посадка сделана не до конца. Разобрать:",
      "  node .claude/tools/graph.mjs verify",
      ...tailOf(verify.out, 12),
    );
  process.exit(verify.status === 0 ? 0 : 1);
};

/** Испытательная посадка одной командой — режим `seat` и сборка стенда проб.
 *
 * Прежде посадку заводили процедурой из справочника, копируя её в оболочку:
 * семь шагов, и шаг, пропущенный сессией, ломал замер, не давая признака —
 * посадка без `barSince` или без ворот краснела сверками, к пробе не
 * относящимися. Слово разработчика `2026-10-11`: «просто прогони скилл».
 *
 * Работает до настройки проекта, как режим `env`: в мастерской обвязки её
 * нет, а посадка нужна именно там. Обвязка берётся каждый раз с полки, а не
 * из готовой копии: копия застыла бы прежней редакцией. Поверх посадки
 * ложатся данные — стенд проб либо магазин, — и они входят в первый коммит:
 * основание ревизии сводов стоит на нём, и правкой они не считаются. */
export const runSeat = ({ toolDir, argv }) => {
  const shelf = path.join(toolDir, "..");
  const stand = argv[0] === "bar-probe";
  const flag = stand ? "--stand-build" : null;
  const dest = stand ? argv[argv.indexOf(flag) + 1] : argv[1];
  const shop = !stand && argv.includes("--shop");
  const title = stand ? "Стенд" : "Посадка";
  const refuse = (...why) => {
    console.log("=== " + title + " не собран" + (stand ? "" : "а") + " ===");
    for (const one of why) console.log("  " + one);
    process.exit(1);
  };
  const own = new Set(
    JSON.parse(readFileSync(path.join(shelf, "seat", "map.json"), "utf8"))
      .projectOwnedInsideHarness ?? [],
  );
  const onShelf = shelfFiles(shelf, own);
  console.log("  осмотрено файлов обвязки: " + onShelf.length);
  if (dest === undefined || dest.startsWith("--"))
    refuse(
      stand
        ? "Куда собирать, не сказано: bar-probe --stand-build <папка>."
        : "Куда сажать, не сказано: seat <папка> [--shop].",
    );
  const overlayAt = stand
    ? path.join(toolDir, "bar-stand.json")
    : shop
      ? path.join(toolDir, "probe-shop.json")
      : null;
  if (overlayAt !== null && !existsSync(overlayAt))
    refuse("Ожидался файл: " + norm(overlayAt));
  const target = path.resolve(dest);
  if (existsSync(target) && !statSync(target).isDirectory())
    refuse("Это файл, а не папка: " + norm(target));
  // Полка — это `.claude` самой папки: посадка на месте, фаза 1 целиком.
  if (!stand && path.resolve(target, ".claude") === path.resolve(shelf)) {
    if (shop) refuse("Магазин кладут на посадку в отдельную папку, а не на месте.");
    const env = { ...process.env };
    delete env.CLAUDE_CODE_CHILD_SESSION;
    const at = argv.indexOf("--packages");
    runSeatHere({
      shelf,
      target,
      env,
      packagesFrom: at < 0 || argv[at + 1] === undefined ? null : path.resolve(argv[at + 1]),
    });
  }
  const busy = existsSync(target) && readdirSync(target).length > 0;
  // По `.git` и `graph.mjs` живой проект с обвязкой от посадки не отличить.
  const marker = path.join(target, ".git", SEAT_MARKER);
  if (busy && path.resolve(target, ".claude") === path.resolve(shelf))
    refuse("Полка сажается сама в себя: " + norm(target));
  if (busy && (stand || !existsSync(marker)))
    refuse(
      "Папка не пуста" +
        (stand ? "" : " и не посадка этой команды — нет метки " + SEAT_MARKER) +
        ": " +
        norm(target),
    );
  if (busy && shop)
    refuse(
      "Магазин кладут на свежую посадку: поверх правленой он стёр бы правку.",
    );

  const made = [];
  // Посадка не проект этой сессии: её хуки здесь не исполняются, и сверка
  // следа стража в ней краснела бы по праву, а не по посадке.
  const env = { ...process.env };
  delete env.CLAUDE_CODE_CHILD_SESSION;
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=seat", "-c", "user.email=seat@local", ...args],
      { cwd: target, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();

  if (busy) {
    // Повторный вызов: обвязка с полки, удалённое на полке удаляется; файлы
    // проекта внутри обвязки и пакеты не трогаются.
    const harness = path.join(target, ".claude");
    const want = new Set(onShelf);
    for (const r of onShelf) cpSync(path.join(shelf, r), path.join(harness, r));
    let gone = 0;
    for (const r of walkFiles(harness))
      if (!(path.dirname(r) === "." && own.has(r)) && !want.has(r)) {
        rmSync(path.join(harness, r));
        gone += 1;
      }
    made.push(
      "обвязка: обновлена с полки, файлов " + want.size + ", снято " + gone,
    );
    made.push("пакеты: не тронуты");
  } else {
    mkdirSync(target, { recursive: true });
    layShelf(shelf, target);
    made.push("обвязка: с полки " + norm(shelf) + ", семена разложены");
    if (overlayAt !== null) {
      const data = JSON.parse(readFileSync(overlayAt, "utf8"));
      for (const [p, text] of Object.entries(data.files ?? {})) {
        mkdirSync(path.dirname(path.join(target, p)), { recursive: true });
        writeFileSync(path.join(target, p), text);
      }
      for (const p of data.remove ?? [])
        rmSync(path.join(target, p), { recursive: true, force: true });
      made.push(
        (stand ? "своих файлов стенда: " : "магазин поверх, файлов: ") +
          Object.keys(data.files ?? {}).length,
      );
    }
    // Пакеты — ссылкой у того, откуда зовут, когда там стоит каждый пакет
    // манифеста посадки; иначе установкой. `npm` версии `10` падает на семени
    // без lock-файла ошибкой `edgesOut`, поэтому установка — через `npm@11`.
    const from = path.join(shelf, "..", "node_modules");
    const manifest = JSON.parse(
      readFileSync(path.join(target, "package.json"), "utf8"),
    );
    const needed = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    const absent = needed.filter(
      (name) => !existsSync(path.join(from, name, "package.json")),
    );
    if (absent.length === 0) {
      sandboxPackages(from, path.join(target, "node_modules"));
      made.push("пакеты: ссылкой на " + norm(from));
    } else {
      const install = runTool(
        "npx",
        ["-y", "npm@11", "install", "--no-audit", "--no-fund"],
        { cwd: target, env },
      );
      if (install.status !== 0) {
        rmSync(target, { recursive: true, force: true });
        const said = (install.error ?? install.stderr + install.stdout)
          .trim()
          .split("\n")
          .slice(-3);
        refuse(
          "Пакеты не встали: у того, откуда зовут, их нет (" +
            absent.slice(0, 3).join(", ") +
            (absent.length > 3 ? ", …" : "") +
            "), а установка `npx -y npm@11 install` упала:",
          ...said.map((line) => "  " + line),
          "Папка убрана. Нужна сеть либо вызов из проекта, где пакеты стоят.",
        );
      }
      made.push("пакеты: установлены `npm@11 install`");
    }
    git("init", "-q");
    writeFileSync(marker, norm(shelf) + "\n");
    git("add", "-A");
    git("commit", "-qm", "seat");
    const base = git("rev-parse", "HEAD");
    const configAt = path.join(target, ".context", "graph.config.mjs");
    const config = readFileSync(configAt, "utf8");
    // Основания ревизии сводов и серии — один коммит: история посадки
    // начинается с него.
    for (const field of ["barSince", "seriesSince"])
      if (!new RegExp("^ {2}" + field + ": null,", "m").test(config))
        refuse(
          "В семени настройки нет строки `" + field + ": null,` — основание",
          "ревизии ставить некуда: " + norm(configAt),
        );
    writeFileSync(
      configAt,
      config
        .replace(/^ {2}barSince: null,/m, '  barSince: "' + base + '",')
        .replace(/^ {2}seriesSince: null,/m, '  seriesSince: "' + base + '",'),
    );
    git("commit", "-qam", "barSince, seriesSince");
    // Ворота ставятся последними: оба коммита посадки — её собственные, и
    // своду в них судить нечего.
    git("config", "core.hooksPath", ".claude/hooks/git");
    made.push(
      "git: основание ревизии сводов и серии " +
        base.slice(0, 7) +
        ", ворота перед коммитом стоят",
    );
  }

  const verify = spawnSync(
    process.execPath,
    [path.join(target, ".claude", "tools", "graph.mjs"), "verify"],
    { cwd: target, encoding: "utf8", env },
  );
  const ok = verify.status === 0;
  console.log(
    "=== " +
      (stand
        ? "Стенд проб собран"
        : busy
          ? "Посадка обновлена"
          : "Посадка собрана") +
      (ok ? "" : " — сверка базы красная") +
      " ===",
  );
  console.log("  папка: " + norm(target));
  for (const line of made) console.log("  " + line);
  console.log(
    "  сверка базы: код " +
      verify.status +
      " — без признака сессии: посадка не проект этой сессии",
  );
  if (!ok) {
    console.log("");
    console.log("  Разобрать:");
    console.log(
      "    cd " +
        norm(target) +
        " && env -u CLAUDE_CODE_CHILD_SESSION node .claude/tools/graph.mjs verify",
    );
    process.exit(1);
  }
  if (stand) {
    console.log("");
    console.log("  Пробы — внутри папки стенда:");
    console.log("    cd " + norm(target));
    console.log(
      "    node .claude/tools/graph.mjs bar-probe --criterion=<критерий> | --batch=<критерии через запятую>",
    );
  }
  process.exit(0);
};
