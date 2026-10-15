import { execFileSync, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
 * снимок. Найдено пробой по холодному контуру. */
export const systemTemp = () => {
  const dir = tmpdir();
  try {
    accessSync(dir, constants.W_OK);
    if (!statSync(dir).isDirectory()) throw new Error("это не папка");
  } catch (e) {
    throw new Error(
      `временная папка системы недоступна: ${dir} (${e.code ?? e.message}) — задать TMPDIR`,
    );
  }
  return dir;
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
  const busy = existsSync(target) && readdirSync(target).length > 0;
  const seated =
    existsSync(path.join(target, ".git")) &&
    existsSync(path.join(target, ".claude", "tools", "graph.mjs"));
  if (busy && (stand || !seated))
    refuse(
      "Папка не пуста" + (stand ? "" : " и не посадка") + ": " + norm(target),
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
      const install = spawnSync(
        "npx",
        ["-y", "npm@11", "install", "--no-audit", "--no-fund"],
        {
          cwd: target,
          encoding: "utf8",
          env,
          shell: process.platform === "win32",
        },
      );
      if (install.status !== 0) {
        rmSync(target, { recursive: true, force: true });
        const said = (
          String(install.stderr ?? "") + String(install.stdout ?? "")
        )
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
