import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BAR_CHECK_KINDS,
  BAR_CUTS,
  BAR_PRESENT,
  BAR_SIGNALS,
  WITNESS_COLUMNS,
  bareCodeOf,
  crossCandidatesOf,
  crossWordsOf,
} from "./graph.predicates.mjs";
import { layShelf } from "./graph.seat.mjs";

/**
 * Дымовой набор на РЕЖИМЫ инструмента.
 *
 * Режимы не входят в цепочку проверок, и запускать их было некому: сломанный
 * режим жил при зелёном прогоне. Замерено — две правки подряд уронили `bar` и
 * `tested` ссылкой на необъявленное, и узнал об этом не прогон, а ручной
 * запуск, случившийся по другому поводу.
 *
 * Набор ДЫМОВОЙ намеренно: он не судит о том, ЧТО режим напечатал, — это
 * работа сверок и ревизии. Он отвечает на один вопрос, на который до него не
 * отвечал никто: запускается ли режим вообще.
 *
 * Список неохваченных — не умолчание, а объявление: каждый назван с причиной,
 * и режим, заведённый без разбора, роняет набор сам.
 */

export const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TOOL = path.join(TOOL_DIR, "graph.mjs");

// Набор зовёт инструмент во временных папках, и признак сессии, унаследованный
// от того, кто набор запустил, требовал бы там следа стража, которого там нет.
// Снимается для всех запусков; тест следа ставит его себе сам.
delete process.env.CLAUDE_CODE_CHILD_SESSION;

/** Цель для режима, которому нужен путь: САМЫЙ НАСЫЩЕННЫЙ файл исходников.
 *
 * Прежде целью служил файл самого набора. Путь при этом передавался, и
 * набор выглядел полным — но `.mjs` в папке инструмента не лежит в графе
 * проекта, и режим выходил раньше, чем доходил до веток, работающих по
 * коду. То есть по коду режимы не гонялись НИ РАЗУ.
 *
 * Замерено сценарием на стенде: `brief` падал на живом файле с
 * `ReferenceError`, а набор был зелёный.
 *
 * ГРАНИЦА ОХВАТА, и она объявляется, а не подразумевается: набор гоняет
 * режимы по коду ЭТОГО проекта. Ветка режима, которую код проекта не
 * достаёт, не проверяется ничем. На полке, живущей каркасом, у корневого
 * компонента хуков ноль — то самое падение там не ловится; на стенде с
 * готовым узлом ловится. Это не дефект набора, а его предмет: дымовой
 * прогон отвечает «запускается ли режим на здешнем коде», и шире отвечать
 * не может.
 *
 * Насыщенность считается числом хуков: файл, держащий состояние и эффекты,
 * заводит в режимах ветки, которых простой файл не заводит, — долг базы по
 * предмету, порядок, радиус. Выбор детерминирован: при равном счёте берётся
 * первый по алфавиту.
 */
export const SUBJECT = (() => {
  const root = path.join(TOOL_DIR, "..", "..");
  const src = path.join(root, "src");
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, e.name);
      if (e.isDirectory()) walk(at);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name))
        out.push(at);
    }
  };
  walk(src);
  if (!out.length) return path.relative(root, fileURLToPath(import.meta.url));
  const HOOKS = /use[A-Z][A-Za-z]*\s*\(/g;
  const score = (f) => (fs.readFileSync(f, "utf8").match(HOOKS) ?? []).length;
  out.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  return path.relative(root, out[0]).split(path.sep).join("/");
})();

/** Режимы вне дымового прогона — с причиной у каждого.
 *
 * Причина у всех одна по сути: побочное действие за пределами репозитория либо
 * стоимость, несовместимая с цепочкой. Ни один не исключён потому, что «падал». */
export const OUTSIDE = {
  falsify:
    "ломает предмет каждой сверки на копии дерева и гоняет по ней цепочку — минуты, а не секунды",
  handoff:
    "без пути кладёт снимок ПАПКОЙ рядом с репозиторием; гоняется отдельным тестом ниже — во временную папку",
  "bar-probe": "заводит песочницу, в которой работает человек, а не набор",
  seat: "сажает обвязку в папку и ставит пакеты; гоняется отдельным тестом ниже — во временную папку",
  series: "гоняет цепочку проверок проекта на каждой части во временной копии — минуты; гоняется отдельным тестом ниже",
};

/** Имена режимов берутся у самого инструмента: список руками разошёлся бы с
 * ним молча. Инструмент печатает их, когда режим не назван. */
export const modes = (() => {
  let said = "";
  try {
    execFileSync(process.execPath, [TOOL], {
      cwd: path.join(TOOL_DIR, "..", ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    said = String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  const line = said.split("\n").find((l) => l.includes("есть:"));
  return line === undefined
    ? []
    : line
        .slice(line.indexOf("есть:") + 5)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
})();

export const smoke = modes.filter((m) => OUTSIDE[m] === undefined);

/** Признаки того, что режим не отработал, а СЛОМАЛСЯ. Код возврата под это не
 * годится: у части режимов единица — законный ответ «предмет есть, и он не в
 * порядке», и отличать одно от другого по коду нельзя. */
/** Форма, которой инструмент называет размер осмотренного, — одна на сверки
 * и на режимы. Набор требует её от КАЖДОГО режима: изнутри одного прогона
 * такой вопрос не задать, виден только он сам. Режим, печатающий ноль находок
 * и молчащий о корпусе, неотличим от слепого — тот же дефект, что чинился у
 * сверок мета-сверкой «Каждая сверка называет свой корпус». */
export const LOOKED = /^\s*осмотрено .+: \d+\s*$/m;

export const CRASH =
  /ReferenceError|TypeError|SyntaxError|is not defined|is not a function|Cannot read propert/;

/** Обвязка, посаженная в пустую папку, — образец, одинаковый в любом проекте.
 *
 * Прежде образцом была копия проекта-хозяина, и тесты верили, что у хозяина
 * нет ни одной находки, а звенья названы семенными именами. Так было только
 * в мастерской: в живом проекте со своими находками два теста падали, и
 * звено тестов проекта краснело из-за обвязки. Сажается тем же порядком,
 * что и самопроверка снимка. */
/** Пакеты посадки — для песочницы, которой нужны загрузчики проекта:
 * ссылкой, только на чтение. Корень посадки тестам частей трогать нельзя —
 * его базу снимают и возвращают тесты корня; пакеты они не трогают. */
export const SEAT_PACKAGES = path.join(TOOL_DIR, "..", "..", "node_modules");
export const seatEmpty = (prefix) => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  layShelf(path.join(TOOL_DIR, ".."), box);
  return box;
};
/** Файл перехода из семени, поле настройки под него и пункты долга. */
export const withTransitionDebt = (box, rows) => {
  const shelf = path.join(TOOL_DIR, "..");
  const plan = path.join(box, ".context", "15-transition.md");
  if (!fs.existsSync(plan))
    fs.copyFileSync(
      path.join(shelf, "seat", "templates", "15-transition.md"),
      plan,
    );
  fs.appendFileSync(plan, rows.map((r) => r + "\n").join(""));
  const cfg = path.join(box, ".context", "graph.config.mjs");
  const had = fs.readFileSync(cfg, "utf8");
  if (had.includes("\n  transition: null,"))
    fs.writeFileSync(
      cfg,
      had.replace(
        "\n  transition: null,",
        '\n  transition: { file: "15-transition.md", heading: "| № | Шаг | Объём | Чем проверяется |", debtHeading: "| № | Расхождение | Сейчас | Держит | План | Цена |" },',
      ),
    );
};
/** Прогон сверки базы в копии: код возврата и строки находок по секциям. */
export const verifyIn = (box) => {
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
      { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    out = String(e.stdout ?? "");
  }
  const found = new Map();
  let section = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("=== ")) section = line.slice(4, -4);
    else if (/^ {4}\S/.test(line) && section !== null)
      found.set(section, [...(found.get(section) ?? []), line.trim()]);
  }
  return found;
};

/** Секция досье — строки между её заголовком и следующим. */
export const sectionOf = (out, head) =>
  out.split("--- " + head)[1]?.split("\n---")[0] ?? "";

/** Заполнить протокол свода, как заполнила бы его сессия: снятие ресурсов,
 * исходы по умолчанию, база, итог по уровням. `pick` задаёт исход критерия
 * строкой «исход | адрес | что | судьба» — ключом `критерий` на все его
 * строки либо `критерий@предмет` на одну; `holds` — одно слово на все
 * итоги либо ключами `уровень` и `уровень@предмет`. Основание ядра по
 * умолчанию называет КАЖДУЮ строку модели её номером — и сдвиги в их
 * числе: диапазон — опора, а не ответ. */
/** Критерии вне ядра, о которых спрашивает признак, видимый текстом. */
/** Строки модели протокола: вид, сдвиг, пометка. */
export const modelRowsIn = (text) =>
  [...text.matchAll(/^\| П\d+ \| ([^|]+) \|[^|\n]*\|[^\n]*?\| ([^|\n]*) \| ([^|\n]*) \| [^|\n]* \| [^|\n]* \|$/gm)].map(
    (m) => ({ sort: m[1].trim(), delta: m[2].trim(), mark: m[3].trim() }),
  );
/** Критерий, о котором модель спрашивает: строка его вида в модели есть, и
 * «нет предмета» при ней ложно — проба отвечает «чисто» с номерами строк.
 * Те же данные, по которым спрашивает свод: список рядом разошёлся бы с ними. */
export const askedIn = (id, text) => {
  const rows = modelRowsIn(text);
  const hit = (spec) =>
    rows.some(
      (r) =>
        r.sort === spec.sort &&
        (spec.mark === undefined || [spec.mark].flat().includes(r.mark)) &&
        (spec.scope !== "fresh" || r.delta !== ""),
    );
  return (
    [...BAR_SIGNALS, ...BAR_CUTS].some((one) => one.ids.includes(id) && hit(one)) ||
    (BAR_PRESENT[id] ?? []).some(hit)
  );
};
export const barRowsCited = (text) =>
  [...text.matchAll(/^\| ((?:П|Св)\d+) \|/gm)].map((m) => m[1]).join(", ") || "П1";
/** Ответы пробы на пустые клетки свидетелей: фраза без союза, остальное — по
 * умолчанию «хорошо». Ответ, поставленный инструментом, не трогается. */
export const WITNESS_FILL = {
  7: ["даёт пробный ответ своду", "да", "да", "нет"],
  8: ["делает пробную работу", "да", "да", "да", "нет"],
};
/** Строка свидетеля, заполненная ответами пробы; не свидетель — `null`. */
export const fillWitness = (c) => {
  if (!/^ Св\d+ $/.test(c[1]) || WITNESS_FILL[c.length - 2] === undefined)
    return null;
  const fill = WITNESS_FILL[c.length - 2];
  for (let k = 0; k < fill.length; k += 1)
    if (c[4 + k].trim() === "") c[4 + k] = " " + fill[k] + " ";
  return c.join("|");
};
/** Критерии, о которых спрашивают свидетели: «нет предмета» при них ложно. */
export const WITNESS_ASKED = Object.keys(WITNESS_COLUMNS);
/** Слова страниц чтения: проба снимает их выводом режима — в тесте это
 * проверка механизма, а не чтение. Корень копии — ближайшая папка с обвязкой. */
export const pageWordsOf = (protoAt) => {
  let box = path.dirname(protoAt);
  while (!fs.existsSync(path.join(box, ".claude", "tools", "graph.mjs"))) {
    const up = path.dirname(box);
    if (up === box) return new Map();
    box = up;
  }
  let out = "";
  try {
    out = execFileSync(
      process.execPath,
      [
        path.join(box, ".claude", "tools", "graph.mjs"),
        "bar-read",
        protoAt,
        "--print",
      ],
      { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    out = String(e.stdout ?? "");
  }
  return new Map(
    [...out.matchAll(/^--- слово страницы (\d+): (\S+) ---$/gm)].map((m) => [m[1], m[2]]),
  );
};
/** Вписать слова страниц чтения — и ничего больше. */
export const fillWords = (protoAt) => {
  const words = pageWordsOf(protoAt);
  fs.writeFileSync(
    protoAt,
    fs
      .readFileSync(protoAt, "utf8")
      .split("\n")
      .map((line) => {
        const c = line.split("|");
        return c.length === 5 && /^ \d+ $/.test(c[1]) && c[3].trim() === ""
          ? "|" + c[1] + "|" + c[2] + "| " + (words.get(c[1].trim()) ?? "") + " |"
          : line;
      })
      .join("\n"),
  );
};
/** Мутационный замер на нынешнем содержимом каждого файла кода под `src` —
 * реестр, какой оставляет сессия, прогнавшая замер по правке. Печать на
 * правке узла с тестами без свежего замера «чисто» по `J10` не ставит, а
 * тесту, который судит другое, нужен честный свод. */
export const mutationMeasured = (box) => {
  const cfg = fs.readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8");
  const at = path.join(box, ".context", cfg.match(/mutationLedger: "([^"]+)"/)[1]);
  const ledger = fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, "utf8")) : {};
  for (const one of fs.readdirSync(path.join(box, "src"), { recursive: true })) {
    const rel = String(one).split(path.sep).join("/");
    if (!/\.[cm]?[jt]sx?$/.test(rel) || rel.endsWith(".d.ts")) continue;
    if (/(^|\/)tests\//.test(rel) || rel.includes(".test.")) continue;
    const text = fs.readFileSync(path.join(box, "src", rel), "utf8").split("\r\n").join("\n");
    ledger["src/" + rel] = {
      killed: 1,
      alive: 0,
      hash: createHash("sha1").update(text).digest("hex").slice(0, 12),
    };
  }
  fs.writeFileSync(at, JSON.stringify(ledger, null, 2) + "\n");
};

export const fillBar = (
  protoAt,
  { release, pick = {}, holds = "да", keepParts = false },
) => {
  const words = pageWordsOf(protoAt);
  const before = fs.readFileSync(protoAt, "utf8");
  // «Правлено» у базы называет файл, правленый работой: проба правит запись
  // идиом — она модели не питает, и протокол от этого не пересобирается.
  // Проба, сдающая правку частями, идиом не трогает: у каждого файла своя
  // запись карты, и база ему не требуется.
  const idioms = path.join(protoAt.slice(0, protoAt.lastIndexOf(path.sep + ".context" + path.sep)), ".context", "10-idioms.md");
  if (!keepParts && fs.existsSync(idioms)) fs.appendFileSync(idioms, "\n");
  const all = barRowsCited(before);
  fs.writeFileSync(
    protoAt,
    before
      .split("\n")
      .map((line) => {
        const c = line.split("|");
        // страница чтения: номер, описание, слово
        if (c.length === 5 && /^ \d+ $/.test(c[1]) && c[3].trim() === "")
          return "|" + c[1] + "|" + c[2] + "| " + (words.get(c[1].trim()) ?? "") + " |";
        // свидетель: единица — семь граф, объявление — восемь
        const witness = fillWitness(c);
        if (witness !== null) return witness;
        // строка модели: восемь граф
        if (c.length === 10 && /^ П\d+ $/.test(c[1])) {
          if (c[2].trim() === "ресурс" && c[7].trim() === "")
            c[7] = c[4].includes("setInterval") || c[3].includes(":4")
              ? " строка 6 "
              : " " + release + " ";
          return c.join("|");
        }
        // итог по уровням: уровень, предмет, что, держится, опора
        if (c.length === 7 && ["узел", "слой", "приложение"].includes(c[1].trim())) {
          const level = c[1].trim();
          const subject = c[2].trim().replace(/`/g, "");
          const said =
            typeof holds === "string"
              ? holds
              : (holds[level + "@" + subject] ?? holds[level] ?? "да");
          return "| " + level + " | " + c[2].trim() + " | " + all + " разобраны | " + said + " | " + all + " |";
        }
        // база и документация: строка на файл предмета
        if (c.length === 6 && /^\s*`[^`]+`\s*$/.test(c[1]))
          return c[2].trim() !== ""
            ? line
            : keepParts
              ? "| " +
                c[1].trim() +
                " | не требуется | не требуется | запись карты на месте |"
              : "| " +
                c[1].trim() +
                " | правлено | не требуется | `.context/10-idioms.md` — проба |";
        // строка исхода: критерий, предмет, о чём, исход, адрес, что, судьба
        if (c.length !== 9 || /^\s*-+\s*$/.test(c[1])) return line;
        const id = c[1].trim();
        if (id === "критерий") return line;
        const subject = c[2].trim();
        const chosen = pick[id + "@" + subject.replace(/`/g, "")] ?? pick[id];
        if (chosen !== undefined) return "| " + id + " | " + subject + " | x | " + chosen + " |";
        if (["F1", "F2", "E4", "C12"].includes(id))
          return "| " + id + " | " + subject + " | x | чисто |  | снимается, см. " + all + " |  |";
        if (c[4].trim() === "") {
          // Признак, видимый текстом, делает предмет у своего критерия: там
          // «нет предмета» ложно, и проба отвечает «чисто» с номерами строк.
          const core =
            c[3].includes("**ядро.**") ||
            askedIn(id, before) ||
            // Свидетели объявлений делают предмет у имени и абстракции.
            (["B5", "H8"].includes(id) && /^\| Св\d+ \| `[^`]+:\d+` \|/m.test(before));
          c[4] = core ? " чисто " : " нет предмета ";
          c[6] = core ? " " + all + " проба " : " проба ";
        }
        return c.join("|");
      })
      .join("\n"),
  );
  fs.writeFileSync(
    protoAt,
    // Корень — над папкой базы: протокол перехода лежит в ней уровнем ниже.
    (keepParts ? partsNamed : partsMerged)(
      crossFilled(fs.readFileSync(protoAt, "utf8"), protoAt.slice(0, protoAt.lastIndexOf(path.sep + ".context" + path.sep))),
    ),
  );
};

// Части правки, которые проба сдаёт порознь: графа «что» каждой — сообщение
// её коммита. Строка части похожа на страницу чтения, и слово страницы,
// вписанное в неё выше, здесь заменяется.
export const partsNamed = (text) => {
  const lines = text.split("\n");
  const at = lines.indexOf("## Части правки");
  if (at === -1) return text;
  for (
    let i = at + 1;
    i < lines.length && !lines[i].startsWith("## ");
    i += 1
  ) {
    const m = /^\| ([0-9]+) \| (.+?) \| [^|]* \|$/.exec(lines[i]);
    if (m !== null)
      lines[i] = "| " + m[1] + " | " + m[2] + " | add part " + m[1] + " |";
  }
  return lines.join("\n");
};

// Части правки: проба сдаёт правку одним коммитом — как сессия, слившая
// все части в одну строку. Иначе дописанная выше строка в идиомах не
// называла бы файлов ни одной части.
export const partsMerged = (text) => {
  const lines = text.split("\n");
  const at = lines.indexOf("## Части правки");
  if (at === -1) return text;
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
  const rows = lines.slice(at, end).filter((l) => /^\| [0-9]+ \| /.test(l));
  if (rows.length === 0) return text;
  const files = rows.flatMap((l) =>
    [...l.matchAll(/`[^`]+`/g)].map((m) => m[0]),
  );
  const first = lines.indexOf(rows[0]);
  const out = lines.filter((l) => !rows.includes(l));
  out.splice(first, 0, "| 1 | " + files.join(", ") + " | проба |");
  return out.join("\n");
};

// Цепочка проверок проекта в серии — заглушка, красная, пока лежит файл-метка
// `red`. Кладут до коммита-основания: иначе манифест — часть правки.
export const fakeCheck = (box, red = "RED") => {
  const pkgAt = path.join(box, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
  pkg.scripts.check =
    "node -e \"process.exit(require('fs').existsSync('" + red + "') ? 1 : 0)\"";
  fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
};

// Индекс — дерево первой части серии: коммит с кодом ворота пускают только
// так. Вывод обоих вызовов — для сообщения упавшего ожидания.
export const seriesStaged = (box) => {
  const tool = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
      { cwd: box, encoding: "utf8" },
    );
  const ran = tool("series");
  const staged = tool("series", "--stage", "1");
  expect(staged.status, ran.stdout + staged.stdout).toBe(0);
};

// Перекрёстная сверка: строка на находку, как её пишет режим, — кандидатов
// считает та же функция обвязки. Ответа ещё нет — «не X» о каждом кандидате
// либо «никакие»: так проба отвечает на неё, как отвечала бы сессия, не
// нашедшая связи.
export const crossFilled = (text, root) => {
  const lines = text.split("\n");
  const head = lines.indexOf("| находка | что | кандидаты | также |");
  if (head === -1) return text;
  let end = head + 1;
  while (end < lines.length && lines[end].startsWith("|")) end += 1;
  const cellsOf = (line) => line.split(/(?<!\\)\|/).slice(1, -1).map((x) => x.trim());
  const said = new Map(
    lines.slice(head + 2, end).map(cellsOf).map((c) => [c[0], c[3]]),
  );
  const keyOf = (place) => {
    const m = /^`?(.+?):([0-9]+)`?$/.exec(place.trim());
    if (m === null) return null;
    const file = fs.existsSync(path.join(root, m[1])) ? m[1] : "src/" + m[1];
    return file + ":" + Number(m[2]);
  };
  const written = new Map();
  const findings = [];
  const askable = new Set();
  const modelAt = new Map();
  for (const line of lines) {
    const c = cellsOf(line);
    if (c.length === 8 && /^П[0-9]+$/.test(c[0])) {
      const key = keyOf(c[2]);
      if (key !== null) modelAt.set(key, [...(modelAt.get(key) ?? []), { sort: c[1], mark: c[5] }]);
      continue;
    }
    if (c.length !== 7 || !/^[A-ZА-Я][0-9]+/.test(c[0])) continue;
    if (c[3] !== "лозунг") askable.add(c[0]);
    if (c[3] !== "нашлось") continue;
    const more = /ещё (?:мест|нарушений)(?:\s*`[0-9]+`)?\s*:\s*(.+)$/.exec(c[5]);
    const keys = [c[4], ...(more === null ? [] : more[1].split(","))]
      .map(keyOf)
      .filter((key) => key !== null);
    for (const key of keys) written.set(key, (written.get(key) ?? new Set()).add(c[0]));
    if (keys.length > 0)
      findings.push({ who: c[0] + (c[1] === "—" ? "" : " для " + c[1]), keys, what: c[5] });
  }
  const partsOf = (key) => [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
  const rows = findings
    .sort((x, y) => {
      const [fx, lx] = partsOf(x.keys[0]);
      const [fy, ly] = partsOf(y.keys[0]);
      if (fx !== fy) return fx < fy ? -1 : 1;
      if (lx !== ly) return lx - ly;
      return x.who < y.who ? -1 : x.who > y.who ? 1 : 0;
    })
    .map((one) => {
      const finding = one.who + " — `" + one.keys[0] + "`";
      const mine = new Set(one.keys.flatMap((key) => [...(written.get(key) ?? [])]));
      const what = crossWordsOf(one.what);
      const cand = crossCandidatesOf(one.who.split(" ")[0], {
        rows: modelAt.get(one.keys[0]) ?? [],
        live: new Set([...askable].filter((id) => !mine.has(id))),
      });
      const answer = said.get(finding) || (cand.length > 0 ? cand.map((id) => "не " + id).join(", ") : "никакие");
      return "| " + finding + " | " + what + " | " + cand.join(", ") + " | " + answer + " |";
    });
  return [...lines.slice(0, head + 2), ...rows, ...lines.slice(end)].join("\n");
};

/**
 * Серия: цепочка проверок проекта на каждой части правки, по дереву «последний
 * коммит плюс части с первой по эту», с отметкой по хешу дерева. Связка
 * проверок в наборе подменена дешёвой: краснеет, когда в корне дерева лежит
 * файл `RED`.
 */
// Ответы свода — файлом: строка ответа на строку таблицы. Ключи — по
// справочнику, режим `bar-fill`: таблицу строки узнают по её разделу.
export const answersOf = (blank, filled) => {
  const cellsOf = (line) =>
    line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((c) => c.trim());
  const untick = (x) => x.split("`").join("").trim();
  const was = blank.split("\n");
  const out = [];
  let section = "";
  filled.split("\n").forEach((line, k) => {
    if (line.startsWith("## ")) section = line;
    if (!line.startsWith("| ") || line === was[k]) return;
    const now = cellsOf(line);
    const before = cellsOf(was[k]);
    const head = now[0];
    let key = null;
    let fill = null;
    if (section === "## Прочитано") [key, fill] = ["стр " + head, [2]];
    else if (section === "## Модель предмета") [key, fill] = [head, [6]];
    else if (section === "## Свидетели")
      [key, fill] = [head, now.length === 7 ? [3, 4, 5, 6] : [3, 4, 5, 6, 7]];
    else if (section === "## Исходы")
      [key, fill] = [
        untick(now[1]) === "—" ? head : head + "@" + untick(now[1]),
        [3, 4, 5, 6],
      ];
    else if (section === "## Итог по уровням")
      [key, fill] = [
        untick(now[1]) === "—" ? head : head + "@" + untick(now[1]),
        [2, 3, 4],
      ];
    else if (section === "## База и документация")
      [key, fill] = [untick(head), [1, 2, 3]];
    if (key === null) throw new Error("строка вне таблиц ответа: " + line);
    out.push(
      [
        key,
        ...fill.map((c) =>
          now[c] === before[c] && now[c] !== "" ? "=" : now[c],
        ),
      ].join(" | "),
    );
  });
  return out.join("\n") + "\n";
};

export const readdirOf = (dir) =>
  fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
