import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BAR_CUTS,
  BAR_PRESENT,
  BAR_SIGNALS,
  WITNESS_COLUMNS,
} from "./graph.predicates.mjs";

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

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(TOOL_DIR, "graph.mjs");

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
const SUBJECT = (() => {
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
const OUTSIDE = {
  falsify:
    "ломает предмет каждой сверки на копии дерева и гоняет по ней цепочку — минуты, а не секунды",
  handoff:
    "без пути кладёт снимок ПАПКОЙ рядом с репозиторием; гоняется отдельным тестом ниже — во временную папку",
  "bar-probe": "заводит песочницу, в которой работает человек, а не набор",
};

/** Имена режимов берутся у самого инструмента: список руками разошёлся бы с
 * ним молча. Инструмент печатает их, когда режим не назван. */
const modes = (() => {
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

const smoke = modes.filter((m) => OUTSIDE[m] === undefined);

/** Признаки того, что режим не отработал, а СЛОМАЛСЯ. Код возврата под это не
 * годится: у части режимов единица — законный ответ «предмет есть, и он не в
 * порядке», и отличать одно от другого по коду нельзя. */
/** Форма, которой инструмент называет размер осмотренного, — одна на сверки
 * и на режимы. Набор требует её от КАЖДОГО режима: изнутри одного прогона
 * такой вопрос не задать, виден только он сам. Режим, печатающий ноль находок
 * и молчащий о корпусе, неотличим от слепого — тот же дефект, что чинился у
 * сверок мета-сверкой «Каждая сверка называет свой корпус». */
const LOOKED = /^\s*осмотрено .+: \d+\s*$/m;

const CRASH =
  /ReferenceError|TypeError|SyntaxError|is not defined|is not a function|Cannot read propert/;

/** База, какой она была до прогона.
 *
 * Режимы не только читают: свод по планке ПИШЕТ протокол. Пока целью
 * служил файл самого набора, режим выходил раньше записи и побочного
 * действия не было видно. Как только целью стал живой исходник, прогон
 * набора стал превращать запечатанный протокол текущей работы в пустой
 * скелет — предмет не совпал, и свод начался заново.
 *
 * Круг от этого замыкался: набор гоняется звеном `test`, звено входит в
 * связку проверок, а сверка базы требует печати — то есть связка стирала
 * печать, которую сама же потом и спрашивала. Замерено воспроизведением:
 * печать «на изменение» до прогона, пустой скелет «на чтение» после.
 *
 * Снимается и возвращается вся папка базы, а не один протокол: писать туда
 * может любой режим, и список имён разошёлся бы с ними молча.
 */
const BASE_DIR = path.join(TOOL_DIR, "..", "..", ".context");
let baseWas = null;

beforeAll(() => {
  if (!fs.existsSync(BASE_DIR)) return;
  baseWas = new Map();
  for (const name of fs.readdirSync(BASE_DIR)) {
    const at = path.join(BASE_DIR, name);
    if (fs.statSync(at).isDirectory()) continue;
    baseWas.set(name, fs.readFileSync(at));
  }
});

afterAll(() => {
  if (baseWas === null) return;
  for (const name of fs.readdirSync(BASE_DIR)) {
    const at = path.join(BASE_DIR, name);
    if (fs.statSync(at).isDirectory()) continue;
    if (!baseWas.has(name)) fs.rmSync(at);
  }
  for (const [name, body] of baseWas)
    fs.writeFileSync(path.join(BASE_DIR, name), body);
});
describe("режимы инструмента запускаются", () => {
  it("инструмент назвал свои режимы", () => {
    expect(modes.length, "список режимов не прочитан").toBeGreaterThan(0);
  });

  it.each(smoke)(
    "%s",
    (mode) => {
      let said = "";
      try {
        said = execFileSync(process.execPath, [TOOL, mode, SUBJECT], {
          cwd: path.join(TOOL_DIR, "..", ".."),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120000,
        });
      } catch (e) {
        said = String(e.stdout ?? "") + String(e.stderr ?? "");
      }
      expect(said, `${mode}: пустой вывод — режим ничего не сказал`).not.toBe(
        "",
      );
      const hit = CRASH.exec(said);
      expect(
        hit === null,
        `${mode} упал: ${said.split("\n").find((l) => CRASH.test(l)) ?? ""}`,
      ).toBe(true);
      expect(
        LOOKED.test(said),
        `${mode} не назвал размер осмотренного: строки «осмотрено <чего>: <сколько>» в выводе нет`,
      ).toBe(true);
      // Срок теста назван ЯВНО и совпадает со сроком подпроцесса. Умолчание
      // раннера — пять секунд, и режим, отработавший дольше, падал сообщением
      // «Test timed out in 5000ms»: про обвязку оно не говорит ничего, а
      // случается на любом проекте, который больше стенда. Замерено посадкой
      // стенда с двумя деревьями: verify отработал за шесть секунд.
    },
    120000,
  );

  it("каждый режим либо в дымовом прогоне, либо назван с причиной", () => {
    for (const mode of modes) {
      const covered = smoke.includes(mode) || OUTSIDE[mode] !== undefined;
      expect(covered, `${mode} — ни в прогоне, ни в списке с причиной`).toBe(
        true,
      );
    }
    for (const mode of Object.keys(OUTSIDE)) {
      expect(
        modes.includes(mode),
        `${mode} назван причиной, а такого режима нет`,
      ).toBe(true);
    }
  });
});

/**
 * Сборка снимка — отдельно, во ВРЕМЕННУЮ папку: без пути режим кладёт снимок
 * рядом с репозиторием, а с путём побочного действия у него нет.
 *
 * Сборка не просто копирует: она сажает снимок в пустую папку и требует от
 * сверки базы кода ноль. То есть этот тест держит и то, что свежая посадка
 * под флагом не краснеет. Держать это было нечем: режим никто не звал, и
 * когда вердикт прогона перестал смягчать сверки под флагом, снимок
 * перестал собираться — молча, до первой сборки руками, после десятков
 * коммитов. Замерено посадками руками.
 */
describe("снимок обвязки собирается", () => {
  it("handoff во временную папку отдаёт код 0 и сажается в пустую", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "snimok-"));
    try {
      const out = execFileSync(process.execPath, [TOOL, "handoff", box], {
        cwd: path.join(TOOL_DIR, "..", ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(out).toContain("СНИМОК СОБРАН");
      expect(out).toContain("сверка базы — код 0");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Ворота пропускают ОДНО приведение формата и не пропускают смысл под его
 * видом. Держать это прогоном нечем: ворота зовёт хук git, а не цепочка, и
 * отдельный коммит формата, которого требует посадка, не проходил их ни в
 * одном проекте, чей код форматтер переписывает. Замерено на копии стенда.
 *
 * Обвязка сажается в пустую папку со своим репозиторием, и с ней едет один
 * пакет форматтера хозяина: инструменту из пакетов нужен только он. Ссылкой на
 * папку пакетов не обходятся намеренно — рекурсивное удаление временной папки
 * не должно иметь дороги в живые пакеты хозяина.
 */
describe("ворота и приведение формата", () => {
  it("коммит одного формата проходит, смысл под видом формата — нет", async () => {
    const home = path.join(TOOL_DIR, "..", "..");
    // Посаженный пустой проект, а не копия хозяина: копия зависела от его
    // раскладки и падала в любом проекте без `src/app/`.
    const box = seatEmpty("vorota-");
    try {
      fs.cpSync(
        path.join(home, "node_modules", "prettier"),
        path.join(box, "node_modules", "prettier"),
        { recursive: true },
      );
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=vorota",
            "-c",
            "user.email=vorota@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      // Файл проекта, а не семя: нетронутое семя ворота пропускают по
      // своему признаку, и приведение на нём не проверило бы ничего.
      const file = path.join(box, "src", "app", "zzOwn.ts");
      const neat = [
        "export const zzOwn = (n: number): number => {",
        "  return n + 1;",
        "};",
        "",
      ].join("\n");
      fs.writeFileSync(file, neat);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "база", "--no-verify");
      fs.writeFileSync(file, neat.split("return ").join("return    "));
      git("commit", "-qam", "старый код без формата", "--no-verify");
      fs.writeFileSync(file, neat);
      git("add", "-A");
      const gate = () => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), "gate"],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      const clean = gate();
      expect(clean.out).toContain("одно приведение формата");
      expect(clean.code).toBe(0);
      fs.writeFileSync(file, neat + "export const zzMeant = 1;\n");
      git("add", "-A");
      const meant = gate();
      expect(meant.out).toContain("КОММИТ НЕ ПРОХОДИТ");
      expect(meant.code).toBe(1);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("ревизия сводов по истории", () => {
  it("снос узла не делает накрытый сводом коммит красным задним числом", () => {
    const box = seatEmpty("istoriya-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=istoriya",
            "-c",
            "user.email=istoriya@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      const base = git("rev-parse", "HEAD").trim();
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs
          .readFileSync(cfgAt, "utf8")
          .replace("  barSince: null,", '  barSince: "' + base + '",'),
      );
      git("commit", "-qam", "основание сводов", "--no-verify");
      // Коммит трогает ДВА своих файла, и снесён потом будет один: свод
      // называет оба, а корпус после сноса — только оставшийся.
      const app = path.join(box, "src", "app");
      fs.writeFileSync(
        path.join(app, "zzGone.ts"),
        "export const zzGone = (n: number): number => n + 1;\n",
      );
      fs.writeFileSync(
        path.join(app, "zzKept.ts"),
        "export const zzKept = (n: number): number => n - 1;\n",
      );
      tool("bar");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const text = fs.readFileSync(protoAt, "utf8");
      const all = barRowsCited(text);
      const filled = text
        .split("\n")
        .map((line) => {
          const c = line.split("|");
          // строка исхода: критерий, предмет, о чём, исход, адрес, что, судьба
          const witness = fillWitness(c);
          if (witness !== null) return witness;
          if (
            c.length === 9 &&
            !/^ П\d+ $/.test(c[1]) &&
            c[4].trim() === "" &&
            !/^\s*-+\s*$/.test(c[1]) &&
            c[1].trim() !== "критерий"
          ) {
            // Новый файл сверяют с единицами его слоя: о повторённой логике
            // предмет есть, и ответ опирается на каталог. О критериях
            // свидетелей предмет есть тоже: ответ опирается на них.
            const versus =
              c[1].trim() === "A6-бис" ||
              WITNESS_ASKED.includes(c[1].trim()) ||
              askedIn(c[1].trim(), text);
            c[4] = versus ? " чисто " : " нет предмета ";
            c[6] = versus ? " " + all + " сверено с каталогом слоя " : " проба ревизии ";
            return c.join("|");
          }
          if (c.length === 6 && /zzGone|zzKept/.test(c[1]))
            return (
              "| `" +
              c[1].trim().replace(/`/g, "") +
              "` | правлено | не требуется | `.context/00-map.md` — проба ревизии |"
            );
          // Итог по уровням: строка на предмет уровня, называет каждую
          // строку модели номером — и сдвиги в их числе.
          if (c.length === 7 && ["узел", "слой", "приложение"].includes(c[1].trim()))
            return "| " + c[1].trim() + " | " + c[2].trim() + " | " + all + " проба ревизии | да | " + all + " |";
          return line;
        })
        .join("\n");
      fs.writeFileSync(protoAt, filled);
      fillWords(protoAt);
      expect(tool("bar")).toContain("печать поставлена");
      git("add", "-A");
      git("commit", "-qm", "свой код со сводом", "--no-verify");
      fs.rmSync(path.join(app, "zzGone.ts"));
      git("add", "-A");
      git("commit", "-qm", "снос узла", "--no-verify");
      const rows = tool("verify").split("\n");
      const at = rows.indexOf("=== Коммит с кодом накрыт сводом ===");
      expect(at).toBeGreaterThan(-1);
      expect(rows.slice(at + 1, at + 3)).toContain("  без свода: 0");
      // Вторая сторона — ради неё сверка и заведена: коммит с кодом мимо
      // свода краснеет. Рецепта у сверки нет по устройству — в песочнице
      // фальсификации истории нет, — и здоровье её держит эта строка.
      fs.writeFileSync(
        path.join(app, "zzBare.ts"),
        "export const zzBare = 1;\n",
      );
      git("add", "-A");
      git("commit", "-qm", "код мимо свода", "--no-verify");
      const later = tool("verify").split("\n");
      const bare = later.indexOf("=== Коммит с кодом накрыт сводом ===");
      expect(later.slice(bare + 1, bare + 3)).toContain("  без свода: 1");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/** Обвязка, посаженная в пустую папку, — образец, одинаковый в любом проекте.
 *
 * Прежде образцом была копия проекта-хозяина, и тесты верили, что у хозяина
 * нет ни одной находки, а звенья названы семенными именами. Так было только
 * в мастерской: в живом проекте со своими находками два теста падали, и
 * звено тестов проекта краснело из-за обвязки. Сажается тем же порядком,
 * что и самопроверка снимка. */
const seatEmpty = (prefix) => {
  const shelf = path.join(TOOL_DIR, "..");
  const map = JSON.parse(
    fs.readFileSync(path.join(shelf, "seat", "map.json"), "utf8"),
  );
  const own = new Set(map.projectOwnedInsideHarness ?? []);
  const box = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const d of map.dirs)
    fs.mkdirSync(path.join(box, d), { recursive: true });
  fs.cpSync(shelf, path.join(box, ".claude"), {
    recursive: true,
    filter: (src) =>
      path.dirname(src) !== shelf || !own.has(path.basename(src)),
  });
  for (const one of map.copy) {
    if (one.notAtSeating !== undefined) continue;
    const dst = path.join(box, one.to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(shelf, one.from), dst);
  }
  return box;
};
/** Файл перехода из семени, поле настройки под него и пункты долга. */
const withTransitionDebt = (box, rows) => {
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
const verifyIn = (box) => {
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

/**
 * Песочница фальсификации лежит внутри репозитория минутами, и прогон рядом с
 * ней — вторая консоль, крючок среды, ворота — обязан её не видеть. Прежде её
 * исключала одна лишь копия, и соседний прогон краснел на десятках строк про
 * чужую копию проекта. Держит это общий список того, что вне дерева; тест
 * держит сам список: мусор в папке песочницы не меняет ни одной находки.
 */
describe("песочница фальсификации не видна прогону", () => {
  it("мусор в папке песочницы не даёт ни одной новой находки", () => {
    const box = seatEmpty("pesochnica-");
    try {
      const before = verifyIn(box);
      const junk = path.join(box, ".проба-сверок");
      fs.mkdirSync(path.join(junk, "src", "app"), { recursive: true });
      fs.mkdirSync(path.join(junk, ".claude", "rules"), { recursive: true });
      fs.writeFileSync(
        path.join(junk, "src", "app", "zz.ts"),
        "// комментарий не на том языке\nexport const zz = 1;\n",
      );
      fs.writeFileSync(
        path.join(junk, ".claude", "rules", "zz.md"),
        "# Проба\n\nСсылка [сюда](./нету.md), 7 сверок.\n",
      );
      fs.writeFileSync(path.join(junk, "zz.md"), "# Проза вне корпуса\n");
      const after = verifyIn(box);
      expect([...after.entries()]).toEqual([...before.entries()]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Долг `comments` у трёх сверок комментариев один и мерится суммой их
 * находок. Пока каждая сравнивала поле со своим счётом, честный долг за
 * длинный комментарий прогон называл лишним, строку реестра с именем его
 * сверки не признавал, а долг под одну сверку прощал находки соседних.
 * Замерено посадкой стенда с длинным комментарием.
 */
describe("долг комментариев — сумма находок трёх сверок", () => {
  it("честный долг держит, лишняя находка соседней сверки краснеет", () => {
    const box = seatEmpty("dolg-");
    try {
      const code = path.join(box, "src", "app", "zzWordy.ts");
      fs.writeFileSync(
        code,
        [
          "// Этот комментарий нарочно длиннее потолка: в нём гораздо больше",
          "// пятнадцати слов подряд, и сверка обязана назвать его длинным рядом.",
          "export const zzWordy = 1;",
          "",
        ].join("\n"),
      );
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const had = fs.readFileSync(cfg, "utf8");
      const withDebt = had.replace(
        /(\n {2}debt: \{[\s\S]*?\n {4})comments: null,/,
        "$1comments: 1,",
      );
      expect(withDebt).not.toBe(had);
      fs.writeFileSync(cfg, withDebt);
      withTransitionDebt(box, [
        "| 1 | Длинный комментарий кода, написанного до посадки | `1` | «Комментарий не перерос в прозу» | сократить ряд в `src/app/zzWordy.ts:1` | `1` место |",
      ]);
      const held = verifyIn(box);
      for (const s of [
        "Комментарий не перерос в прозу",
        "Закомментированного кода нет",
        "Объявленный долг не больше фактического",
        "Объявленный долг назван планом перехода",
      ])
        expect([s, held.get(s) ?? []]).toEqual([s, []]);
      // Вторая находка — у СОСЕДНЕЙ сверки: сумма выше долга, и прогон
      // обязан покраснеть, а не простить её долгом, объявленным под первую.
      fs.appendFileSync(
        code,
        [
          "// const was = useState(0);",
          "// function Old() {",
          "//   return null;",
          "// }",
          "",
        ].join("\n"),
      );
      const over = verifyIn(box);
      expect(
        (over.get("Закомментированного кода нет") ?? []).length,
      ).toBeGreaterThan(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Звенья цепочки проект вправе держать под своими именами — `types`, `fmt`, —
 * и базовая линия пишет их теми же именами. Сверка «Красное звено названо
 * находкой» спрашивала звенья по семенным именам: проект, назвавший по-своему
 * все звенья, получал ложное «в базовой линии не опознано ни одного» на верно
 * записанной линии. Замерено посадкой руками в проект со звеном `types`.
 */
describe("звенья под проектными именами опознаются в базовой линии", () => {
  it("своё имя звена — не слепота, а красное под ним без записи — находка", () => {
    const box = seatEmpty("zvenya-");
    try {
      const own = {
        typecheck: "types",
        lint: "lint:js",
        "format:check": "fmt",
        test: "unit",
      };
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      const scripts = {};
      for (const [name, body] of Object.entries(pkg.scripts))
        scripts[own[name] ?? name] = body;
      scripts.check = Object.entries(own).reduce(
        (s, [from, to]) =>
          s.split("npm run " + from + " ").join("npm run " + to + " "),
        pkg.scripts.check.split("npm test").join("npm run unit"),
      );
      pkg.scripts = scripts;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const factsAt = path.join(box, ".context", "01-facts.md");
      let facts = fs
        .readFileSync(factsAt, "utf8")
        .replace(
          /<!-- ПУСТО -->[\s\S]*?<!-- \/ПУСТО -->/,
          [
            "| Звено | Исход | Чем получено |",
            "| --- | --- | --- |",
            "| `typecheck` | зелено | `npm run typecheck` |",
            "| `lint` | зелено | `npm run lint` |",
            "| `format:check` | зелено | `npm run format:check` |",
            "| `test` | зелено | `npm test` |",
          ].join("\n"),
        );
      for (const [from, to] of Object.entries(own))
        facts = facts.split("| `" + from + "` |").join("| `" + to + "` |");
      fs.writeFileSync(factsAt, facts);
      const named = verifyIn(box);
      expect(named.get("Красное звено названо находкой") ?? []).toEqual([]);
      fs.writeFileSync(
        factsAt,
        facts.replace("| `types` | зелено |", "| `types` | красно, код `2` |"),
      );
      const red = verifyIn(box);
      expect(
        (red.get("Красное звено названо находкой") ?? []).join(" "),
      ).toContain("`types` пришло красным");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Долг ошибок типов держит обёртка команды компилятора, а не сверка базы:
 * она сравнивает счёт `error TS…` с полем `debt.types` в обе стороны. Без
 * долга звено типов стояло в связке первым и не пускало её дальше себя —
 * замерено на стенде с `20` ошибками от строгости, дописанной посадкой.
 * Счёт идёт по выводу со снятыми цветами: ключ `--pretty` красит `error`.
 */
describe("долг ошибок типов держит обёртка компилятора", () => {
  it("столько же — зелено, больше и меньше — красно, цвет не мешает счёту", () => {
    const box = seatEmpty("tipy-");
    try {
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const had = fs.readFileSync(cfg, "utf8");
      const withDebt = had.replace(
        /(\n {2}debt: \{[\s\S]*?\n {4})types: null,/,
        "$1types: 2,",
      );
      expect(withDebt).not.toBe(had);
      fs.writeFileSync(cfg, withDebt);
      const esc = String.fromCharCode(27);
      const colored =
        "a.ts:1:1 - " +
        esc +
        "[91merror" +
        esc +
        "[0m" +
        esc +
        "[90m TS2322: " +
        esc +
        "[0mx";
      const tool = path.join(box, ".claude", "tools", "graph.mjs");
      const statusOf = (command) => {
        try {
          execFileSync(process.execPath, [tool, "types", "--", ...command], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
          return 0;
        } catch (e) {
          return e.status;
        }
      };
      const printing = (lines) => [
        process.execPath,
        "-e",
        lines.map((l) => "console.log(" + JSON.stringify(l) + ");").join("") +
          "process.exit(" +
          (lines.length ? 2 : 0) +
          ");",
      ];
      const plain = "b.ts(1,1): error TS2322: x";
      expect(statusOf(printing([colored, plain]))).toBe(0);
      expect(statusOf(printing([colored, plain, plain]))).toBe(1);
      expect(statusOf(printing([plain]))).toBe(1);
      // Долг погашен целиком: подсказка называет пустое поле так, как его
      // пишет семя, — иначе настройка расходится с семенем формой пустоты.
      const paidSaid = (() => {
        try {
          execFileSync(process.execPath, [tool, "types", "--", ...printing([])], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
          return "";
        } catch (e) {
          return String(e.stdout ?? "");
        }
      })();
      expect(paidSaid).toContain("`debt.types: null`");
      // Команда упала, не назвав ни одной ошибки типов: её код уходит
      // наружу, а не подменяется вердиктом о долге.
      expect(statusOf([process.execPath, "-e", "process.exit(3)"])).toBe(3);
      expect(statusOf(["zz-no-such-command"])).toBe(1);
      // Долг кода держит ПУНКТ ДОЛГА ПЕРЕХОДА с тем же числом, а не строка
      // реестра: реестр для поломок обвязки и находок работы.
      const said = () =>
        verifyIn(box).get("Объявленный долг назван планом перехода") ?? [];
      expect(said().join(" ")).toContain("typecheck");
      fs.appendFileSync(
        path.join(box, ".context", "16-findings.md"),
        "| 9997 | Звено «typecheck»: ошибки типов от строгости посадки объявлены долгом | проба долга |  |  | открыта |\n",
      );
      expect(said().join(" ")).toContain("typecheck");
      withTransitionDebt(box, [
        "| 1 | Ошибки типов под строгостью обвязки | `3` | звено «typecheck» | разобрать `a.ts`, `b.ts` | `3` места |",
      ]);
      expect(said().join(" ")).toContain("пункт 1 говорит `3`");
      const plan = path.join(box, ".context", "15-transition.md");
      fs.writeFileSync(
        plan,
        fs.readFileSync(plan, "utf8").replace("| `3` | звено", "| `2` | звено"),
      );
      expect(said()).toEqual([]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("ошибка настройки звена долгом не гасится, линт держит свой долг", () => {
  it("TS5xxx и код 2 линтера красны при любом долге; линт сверх долга красен", () => {
    const box = seatEmpty("lintdolg-");
    try {
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const had = fs.readFileSync(cfg, "utf8");
      fs.writeFileSync(
        cfg,
        had
          .replace(/(\n {2}debt: \{[\s\S]*?\n {4})types: null,/, "$1types: 5,")
          .replace(/(\n {2}debt: \{[\s\S]*?\n {4})lint: null,/, "$1lint: 2,"),
      );
      const tool = path.join(box, ".claude", "tools", "graph.mjs");
      const run = (mode, lines, code) => {
        const command = [
          process.execPath,
          "-e",
          lines.map((l) => "console.log(" + JSON.stringify(l) + ");").join("") +
            "process.exit(" +
            code +
            ");",
        ];
        try {
          return {
            status: 0,
            out: execFileSync(process.execPath, [tool, mode, "--", ...command], {
              cwd: box,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            }),
          };
        } catch (e) {
          return { status: e.status, out: String(e.stdout ?? "") };
        }
      };
      // Ошибка настройки компилятора: одна строка при долге пять — красно.
      const setup = run("types", ["tsconfig.json(3,5): error TS5107: x"], 1);
      expect(setup.status).toBe(1);
      expect(setup.out).toContain("ошибка НАСТРОЙКИ");
      // Линт: итог линтера — счёт; столько же, сколько долг, — зелено.
      expect(run("lint", ["✖ 3 problems (2 errors, 1 warning)"], 1).status).toBe(0);
      expect(run("lint", ["✖ 4 problems (3 errors, 1 warning)"], 1).status).toBe(1);
      // Код возврата 2 у линтера — настройка, а не находки.
      const broken = run("lint", ["Oops! Something went wrong! :("], 2);
      expect(broken.status).toBe(1);
      expect(broken.out).toContain("ошибка НАСТРОЙКИ");
      // Долг линта держит пункт долга перехода, называющий звено линта.
      const said = () =>
        (verifyIn(box).get("Объявленный долг назван планом перехода") ?? []).join(" ");
      expect(said()).toContain("lint — долг КОДА");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  // Храповик линта живёт обёрткой команды, и звено, обёрнутое им, остаётся
  // звеном линта. Образец опознания знал обёртку только у звена типов:
  // обёрнутый линт не опознавался, и конфиг линтера объявлялся лежащим без
  // вызова. Замерено переводом библиотеки на долг линта.
  it("звено линта, обёрнутое храповиком, опознаётся как звено линта", () => {
    const box = seatEmpty("lintobyortka-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts.lint = "node .claude/tools/graph.mjs lint -- " + pkg.scripts.lint;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const found = verifyIn(box);
      for (const s of [
        "Звену цепочки есть на чём работать",
        "Связка проверок зовёт живые звенья",
        "Звено цепочки не задвоено",
      ])
        expect([s, found.get(s) ?? []]).toEqual([s, []]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("связка проверок: прогон с покрытием и запуск списком", () => {
  it("тесты только с покрытием и связка через run-s — звенья живы и зовутся", () => {
    const box = seatEmpty("svyazka-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      delete pkg.scripts.test;
      delete pkg.scripts["test:coverage"];
      pkg.scripts["test:unit"] = "vitest run --coverage";
      pkg.scripts.check =
        'run-s typecheck lint "format:*" test:unit && node .claude/tools/graph.mjs verify';
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const found = verifyIn(box);
      const bundle = (found.get("Связка проверок зовёт живые звенья") ?? []).join("\n");
      expect(bundle).not.toContain("не зовёт");
      expect(bundle).not.toContain("которой в манифесте нет");
      expect(
        (found.get("Звену цепочки есть на чём работать") ?? []).join("\n"),
      ).not.toContain("звено-спутник написано");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Описанием файла в карте считается только ЕГО запись: строка таблицы с путём
 * первой графой либо заголовок, называющий один этот файл. Упоминание прозой
 * или в чужой строке засчитывалось, и файл без своей строки считался
 * описанным — замерено на стенде, где из `восьми` «описанных» файлов своя
 * строка была у `одного`.
 */
describe("карта засчитывает только свою запись файла", () => {
  it("строка и заголовок описывают, упоминание в чужой строке — нет", () => {
    const box = seatEmpty("karta-");
    try {
      for (const name of ["zzRow", "zzHead", "zzProse"])
        fs.writeFileSync(
          path.join(box, "src", "app", name + ".ts"),
          "export const " + name + " = 1;\n",
        );
      fs.appendFileSync(
        path.join(box, ".context", "00-map.md"),
        [
          "",
          "## Проба своей записи",
          "",
          "| Файл | Отвечает за | Состояние | Эффекты |",
          "| --- | --- | --- | --- |",
          "| `src/app/zzRow.ts` | проба, зовёт `src/app/zzProse.ts` | нет | нет |",
          "",
          "### `src/app/zzHead.ts`",
          "",
          "Проба заголовка.",
          "",
        ].join("\n"),
      );
      const missing = verifyIn(box).get("Покрытие карты") ?? [];
      expect(missing.some((l) => l.includes("zzProse"))).toBe(true);
      expect(missing.some((l) => l.includes("zzRow"))).toBe(false);
      expect(missing.some((l) => l.includes("zzHead"))).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Имя в разделе карты принадлежит папке раздела, а не одноимённому файлу в
 * корне исходников. Замерено переходом библиотеки: у каждой папки свои
 * `index.ts` и `props.ts`, и строки под заголовками папок засчитывались
 * корневым файлам — тридцать файлов числились неописанными при стоящих строках.
 *
 * Импорт ESM пишет расширение выходного файла, `./x.js` при исходнике
 * `./x.ts`, — и граф такого проекта был пуст: у узла не было ни импортёров,
 * ни тестов.
 */
describe("разрешение адресов: раздел карты и импорт ESM", () => {
  it("голое имя под заголовком папки — файл этой папки; импорт .js — исходник .ts", () => {
    const box = seatEmpty("adresa-");
    try {
      const app = path.join(box, "src", "app");
      fs.mkdirSync(path.join(app, "zzPart"), { recursive: true });
      fs.writeFileSync(
        path.join(app, "zzPart", "index.ts"),
        "export const zzPart = 1;\n",
      );
      // Одноимённый файл в корне исходников: голое имя, разрешённое от корня
      // раньше префикса раздела, досталось бы ему.
      fs.writeFileSync(
        path.join(box, "src", "index.ts"),
        "export const zzRoot = 1;\n",
      );
      fs.writeFileSync(
        path.join(app, "zzUser.ts"),
        'import { zzPart } from "./zzPart/index.js";\nexport const zzUser = zzPart;\n',
      );
      fs.appendFileSync(
        path.join(box, ".context", "00-map.md"),
        [
          "",
          "## `src/app/zzPart`",
          "",
          "| Файл | Отвечает за | Состояние | Эффекты |",
          "| --- | --- | --- | --- |",
          "| `index.ts` | проба | pure | нет |",
          "",
        ].join("\n"),
      );
      const missing = verifyIn(box).get("Покрытие карты") ?? [];
      expect(missing.some((l) => l.includes("zzPart/index.ts"))).toBe(false);
      const brief = execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "brief",
          "app/zzPart/index.ts",
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const importers =
        brief.split("--- пользуются им")[1]?.split("---")[1] ?? "";
      expect(importers).toContain("app/zzUser.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/** Секция досье — строки между её заголовком и следующим. */
const sectionOf = (out, head) =>
  out.split("--- " + head)[1]?.split("\n---")[0] ?? "";

describe("связи мимо графа: публичная поверхность, имена в коде, приставки", () => {
  it("вход пакета, общая константа и собранное помощником имя видны сверкам и досье", () => {
    const box = seatEmpty("svyazi-");
    try {
      const lib = path.join(box, "src", "shared", "zzLib");
      const app = path.join(box, "src", "app");
      fs.mkdirSync(lib, { recursive: true });
      fs.writeFileSync(
        path.join(lib, "topics.ts"),
        'export const ZZ_TOPIC = "zz-topic";\nexport const zzVar = (name: string) => `--zz__${name}`;\n',
      );
      fs.writeFileSync(
        path.join(lib, "core.ts"),
        'export const zzCore = () => 1;\n',
      );
      fs.writeFileSync(
        path.join(lib, "index.ts"),
        'export { zzCore } from "./core.js";\n',
      );
      fs.writeFileSync(
        path.join(app, "zzPub.ts"),
        'import { ZZ_TOPIC, zzVar } from "../shared/zzLib/topics.js";\nexport const zzPub = () => [ZZ_TOPIC, zzVar("w")];\n',
      );
      fs.writeFileSync(
        path.join(app, "zzSub.ts"),
        'import { ZZ_TOPIC } from "../shared/zzLib/topics.js";\nexport const zzSub = (t: string) => t === ZZ_TOPIC;\n',
      );
      fs.writeFileSync(
        path.join(app, "zz.css"),
        ".zzBox {\n  width: var(--zz__w);\n}\n",
      );
      // Пакет публикуется: адрес поставки сопоставляется исходнику.
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      delete pkg.private;
      pkg.exports = { "./zz": { default: "./dist/shared/zzLib/index.js" } };
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      const cfg = fs.readFileSync(cfgAt, "utf8");
      fs.writeFileSync(
        cfgAt,
        cfg
          .replace(
            "  domTables: null,",
            '  domTables: {\n    file: "03-graph.md",\n    headings: ["| Переменная | Кто ставит | Кто читает |", "| Имя в коде | Кто пишет | Кто читает |"],\n  },',
          )
          .replace("  namePrefixes: [],", '  namePrefixes: ["--zz__"],'),
      );
      const graphAt = path.join(box, ".context", "03-graph.md");
      const withRows = (rows) =>
        fs
          .readFileSync(graphAt, "utf8")
          .replace(
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n",
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n| `--zz__w` | `src/app/zzPub.ts` — имя собирает `zzVar` | `src/app/zz.css` |\n",
          )
          .replace(
            "| Имя в коде | Кто пишет | Кто читает |\n| --- | --- | --- |\n",
            "| Имя в коде | Кто пишет | Кто читает |\n| --- | --- | --- |\n" +
              rows,
          );
      const graphSeed = fs.readFileSync(graphAt, "utf8");
      fs.writeFileSync(
        graphAt,
        withRows("| `zz-topic` | `src/app/zzPub.ts` | `src/app/zzSub.ts` |\n"),
      );
      const links = () => verifyIn(box).get("Связи мимо графа импортов") ?? [];
      expect(links()).toEqual([]);

      // Конец связи, который имени не знает, — находка.
      fs.writeFileSync(graphAt, graphSeed);
      fs.writeFileSync(
        graphAt,
        withRows(
          "| `zz-topic` | `src/app/zzPub.ts` | `src/shared/zzLib/core.ts` |\n",
        ),
      );
      expect(links().join("\n")).toContain(
        "zz-topic — названо строкой таблицы, но в shared/zzLib/core.ts его нет",
      );

      const run = (...args) =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const core = run("brief", "shared/zzLib/core.ts");
      expect(sectionOf(core, "публичная поверхность")).toContain(
        "имена: zzCore",
      );
      expect(run("tested", "src/shared/zzLib/core.ts")).toContain(
        "=== Публичная поверхность пакета ===",
      );
      expect(
        sectionOf(run("brief", "app/zzPub.ts"), "делят имена-константы"),
      ).toContain("ZZ_TOPIC — app/zzSub.ts");
      // Переменную ставит свой помощник — чужой связью она не считается.
      expect(run("tested", "src/app/zzPub.ts")).not.toContain(
        "Чужих связей через разметку и стили",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("база о своём: документы узла, сторона тестов, держатель, якоря", () => {
  const toolIn = (box) => (...args) =>
    execFileSync(
      process.execPath,
      [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
      { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

  it("досье находит дверь папки и документ по её имени, а не чужие README по имени", () => {
    const box = seatEmpty("doki-");
    try {
      const unit = path.join(box, "src", "app", "zzWidget");
      fs.mkdirSync(path.join(unit, "docs"), { recursive: true });
      fs.writeFileSync(path.join(unit, "index.ts"), "export const zzWidget = 1;\n");
      fs.writeFileSync(path.join(unit, "docs", "README.md"), "# zzWidget\n");
      fs.mkdirSync(path.join(box, "docs"), { recursive: true });
      fs.writeFileSync(path.join(box, "docs", "zzWidget.md"), "# виджет\n");
      // Чужой README, называющий голое имя, которое в проекте не одно.
      fs.writeFileSync(path.join(box, "src", "index.ts"), "export const zzRoot = 1;\n");
      fs.writeFileSync(path.join(box, "docs", "other.md"), "Вход — `index.ts`.\n");
      const docs = sectionOf(toolIn(box)("brief", "app/zzWidget/index.ts"), "документация: дверь папки");
      expect(docs).toContain("дверь папки: app/zzWidget/docs/README.md");
      expect(docs).toContain("документ по имени папки: docs/zzWidget.md");
      expect(docs).not.toContain("other.md");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("файл объявленной папки тестов — сторона тестов, а не код карты", () => {
    const box = seatEmpty("testdir-");
    try {
      fs.mkdirSync(path.join(box, "zztests"), { recursive: true });
      fs.writeFileSync(path.join(box, "zztests", "helpers.ts"), "export const zzHelp = 1;\n");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs.readFileSync(cfgAt, "utf8").replace("  testDirs: null,", '  testDirs: ["../zztests"],'),
      );
      const found = verifyIn(box);
      expect((found.get("Покрытие карты") ?? []).join("\n")).not.toContain("helpers.ts");
      expect((found.get("Покрытие тестов") ?? []).join("\n")).toContain("helpers.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("файл со своим состоянием назван владельцем, а чтение контекста состоянием не считается", () => {
    const box = seatEmpty("derzhatel-");
    try {
      const app = path.join(box, "src", "app");
      fs.writeFileSync(
        path.join(app, "zzHolder.ts"),
        'import { useState } from "react";\nexport const useZzHolder = () => useState(0);\n',
      );
      fs.writeFileSync(
        path.join(app, "zzReader.ts"),
        'import { useContext, createContext } from "react";\nconst Zz = createContext(0);\nexport const useZzReader = () => useContext(Zz);\n',
      );
      const stateAt = path.join(box, ".context", "04-state.md");
      fs.copyFileSync(
        path.join(box, ".claude", "seat", "templates", "04-state.md"),
        stateAt,
      );
      const seed = fs.readFileSync(stateAt, "utf8");
      const withRow = (row) =>
        fs.writeFileSync(
          stateAt,
          seed.replace(
            "| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n",
            "| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n" + row,
          ),
        );
      const mute = () =>
        (verifyIn(box).get("Предмет из кода назван в своём файле базы") ?? []).join("\n");
      withRow("| счёт | `src/app/App.tsx` | он же | `src/app/zzHolder.ts` | всегда |\n");
      expect(mute()).toContain("не назван в графе «Владелец» app/zzHolder.ts");
      expect(mute()).not.toContain("zzReader.ts");
      withRow("| счёт | `src/app/zzHolder.ts` | он же | он же | всегда |\n");
      expect(mute()).not.toContain("zzHolder.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("семя, которое ложится позже посадки, не называет в чужом проекте того, чего там нет", () => {
    // Семя под предмет и семя перехода кладут в живой проект, когда предмет
    // появился; при посадке сверки их не видят. Пример с адресом внутри
    // такого семени ведёт в никуда в любом проекте, где этих файлов нет, —
    // замерено семенем записи о состоянии.
    const box = seatEmpty("pozzhe-");
    try {
      const shelf = path.join(TOOL_DIR, "..");
      const map = JSON.parse(
        fs.readFileSync(path.join(shelf, "seat", "map.json"), "utf8"),
      );
      const later = [...(map.onSubject ?? []), ...(map.onTransition ?? [])];
      expect(later.length).toBeGreaterThan(0);
      for (const one of later)
        fs.copyFileSync(path.join(shelf, one.from), path.join(box, one.to));
      const found = verifyIn(box);
      for (const section of [
        "Пути в обратных кавычках",
        "Имена из кода в тексте",
        "Имена констант в тексте",
        "Ссылки markdown",
        "Числа в прозе базы",
      ]) {
        const said = (found.get(section) ?? []).join("\n");
        for (const one of later)
          expect(said, section).not.toContain(path.basename(one.to));
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("съехавший якорь называется со строкой, где цитата теперь, и repoint его переставляет", () => {
    const box = seatEmpty("yakor-");
    try {
      const at = path.join(box, "src", "app", "zzAnchored.ts");
      fs.writeFileSync(at, "export const zzOne = 1;\nexport const zzTarget = 2;\n");
      const idioms = path.join(box, ".context", "10-idioms.md");
      fs.appendFileSync(idioms, "\nПроба: `src/app/zzAnchored.ts:2` `zzTarget`.\n");
      expect((verifyIn(box).get("Якоря") ?? []).join("\n")).not.toContain("zzAnchored");
      fs.writeFileSync(at, "// shifted\n" + fs.readFileSync(at, "utf8"));
      expect((verifyIn(box).get("Якоря") ?? []).join("\n")).toContain(
        "съехала на строку 3, номер переставит режим repoint",
      );
      expect(toolIn(box)("repoint")).toContain("переставлено: 1");
      expect(fs.readFileSync(idioms, "utf8")).toContain("`src/app/zzAnchored.ts:3` `zzTarget`");
      expect((verifyIn(box).get("Якоря") ?? []).join("\n")).not.toContain("zzAnchored");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/** Заполнить протокол свода, как заполнила бы его сессия: снятие ресурсов,
 * исходы по умолчанию, база, итог по уровням. `pick` задаёт исход критерия
 * строкой «исход | адрес | что | судьба» — ключом `критерий` на все его
 * строки либо `критерий@предмет` на одну; `holds` — одно слово на все
 * итоги либо ключами `уровень` и `уровень@предмет`. Основание ядра по
 * умолчанию называет КАЖДУЮ строку модели её номером — и сдвиги в их
 * числе: диапазон — опора, а не ответ. */
/** Критерии вне ядра, о которых спрашивает признак, видимый текстом. */
/** Строки модели протокола: вид, сдвиг, пометка. */
const modelRowsIn = (text) =>
  [...text.matchAll(/^\| П\d+ \| ([^|]+) \|[^|\n]*\|[^\n]*?\| ([^|\n]*) \| ([^|\n]*) \| [^|\n]* \| [^|\n]* \|$/gm)].map(
    (m) => ({ sort: m[1].trim(), delta: m[2].trim(), mark: m[3].trim() }),
  );
/** Критерий, о котором модель спрашивает: строка его вида в модели есть, и
 * «нет предмета» при ней ложно — проба отвечает «чисто» с номерами строк.
 * Те же данные, по которым спрашивает свод: список рядом разошёлся бы с ними. */
const askedIn = (id, text) => {
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
const barRowsCited = (text) =>
  [...text.matchAll(/^\| ((?:П|Св)\d+) \|/gm)].map((m) => m[1]).join(", ") || "П1";
/** Ответы пробы на пустые клетки свидетелей: фраза без союза, остальное — по
 * умолчанию «хорошо». Ответ, поставленный инструментом, не трогается. */
const WITNESS_FILL = {
  7: ["даёт пробный ответ своду", "да", "да", "нет"],
  8: ["делает пробную работу", "да", "да", "да", "нет"],
};
/** Строка свидетеля, заполненная ответами пробы; не свидетель — `null`. */
const fillWitness = (c) => {
  if (!/^ Св\d+ $/.test(c[1]) || WITNESS_FILL[c.length - 2] === undefined)
    return null;
  const fill = WITNESS_FILL[c.length - 2];
  for (let k = 0; k < fill.length; k += 1)
    if (c[4 + k].trim() === "") c[4 + k] = " " + fill[k] + " ";
  return c.join("|");
};
/** Критерии, о которых спрашивают свидетели: «нет предмета» при них ложно. */
const WITNESS_ASKED = Object.keys(WITNESS_COLUMNS);
/** Слова страниц чтения: проба снимает их выводом режима — в тесте это
 * проверка механизма, а не чтение. Корень копии — ближайшая папка с обвязкой. */
const pageWordsOf = (protoAt) => {
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
      [path.join(box, ".claude", "tools", "graph.mjs"), "bar-read", protoAt],
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
const fillWords = (protoAt) => {
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
const fillBar = (protoAt, { release, pick = {}, holds = "да" }) => {
  const words = pageWordsOf(protoAt);
  const before = fs.readFileSync(protoAt, "utf8");
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
            : "| " + c[1].trim() + " | правлено | не требуется | `.context/00-map.md` — проба |";
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
};

describe("свод по планке от модели предмета", () => {
  it("модель по уровням: ресурсы, итог уровня, перенос исходов, вопрос", () => {
    const box = seatEmpty("model-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const at = path.join(box, "src", "app", "zzClock.ts");
      fs.writeFileSync(
        at,
        [
          'import { useEffect, useState } from "react";',
          "export const useZzClock = (ms: number) => {",
          "  const [now, setNow] = useState(0);",
          "  useEffect(() => {",
          "    const id = setInterval(() => setNow((n) => n + 1), ms);",
          "    return () => clearInterval(id);",
          "  }, [ms]);",
          "  useEffect(() => {",
          "    const onKey = () => setNow(0);",
          '    window.addEventListener("keydown", onKey);',
          "  }, []);",
          "  return now;",
          "};",
          "",
        ].join("\n"),
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzClock.ts");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toContain("## Модель предмета");
      expect(printed).toContain("### Узел");
      expect(printed).toContain("## Итог по уровням");
      expect(printed).toMatch(
        /\| П\d+ \| ресурс \| `app\/zzClock\.ts:5` \|[^\n]*\| есть: строка 6 \|/,
      );
      // Пустое снятие ресурса — дыра: без неё вердикт о ресурсах не на чем
      // проверять. Пустой итог уровня — тоже.
      const empty = tool("bar", "app/zzClock.ts");
      expect(empty).toMatch(/П\d+: снятие ресурса не названо/);
      expect(empty).toContain("итог, узел `app/zzClock.ts`: не сказано");
      fillBar(protoAt, {
        release: "нет",
        pick: { H7: "нет предмета |  | проба | " },
      });
      const refused = tool("bar", "app/zzClock.ts");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(/F2: чисто, а снятия нет у ресурса П\d+/);

      // Снятие названо — вердикт с моделью согласен, печать ставится.
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .replace(/\| нет \| (код|база|сессия) \|$/gm, "| не нужно: проба | $1 |"),
      );
      const sealed = tool("bar", "app/zzClock.ts");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "уровни: узел `app/zzClock.ts` — держится; слой `app` — держится; приложение — держится",
      );

      // Правка кода: исходы переносятся, «чисто» ядра и итог уровней
      // сбрасываются — они о коде, которого больше нет.
      fs.appendFileSync(at, "export const zzTick = 1;\n");
      const moved = tool("bar", "app/zzClock.ts");
      expect(moved).toContain("исходы перенесены");
      expect(moved).toMatch(/«чисто» ядра сброшено: [1-9]/);
      expect(moved).toContain("итог по уровням сброшен");
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/\| H7 \|[^\n]*\| нет предмета \|/);

      // Находка-развилка: судьба «вопрос» требует записи в списке вопросов.
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { H7: "нашлось | src/app/zzClock.ts:5 | число без имени | вопрос" },
      });
      expect(tool("bar", "app/zzClock.ts")).toContain(
        "H7: «вопрос», а список вопросов",
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/app/zzClock.ts`.\n",
      );
      expect(tool("bar", "app/zzClock.ts")).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("починено вне кода: адрес в правленом файле любого рода, а не только в предмете", () => {
    const box = seatEmpty("vnekoda-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      fs.writeFileSync(path.join(box, "src", "app", "zzCi.ts"), "export const zzCi = 1;\n");
      fs.mkdirSync(path.join(box, ".github", "workflows"), { recursive: true });
      fs.writeFileSync(path.join(box, ".github", "workflows", "ci.yml"), "name: ci\n");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const fixedIn = (where) =>
        fillBar(protoAt, {
          release: "не нужно: проба",
          pick: { J2: "нашлось | " + where + ":1 | конвейер не звал проверок | починено" },
        });
      // Конвейер правлен этой работой — находка в нём починена, хоть он и не код.
      fixedIn(".github/workflows/ci.yml");
      expect(tool("bar")).toContain("печать поставлена");
      // Нетронутый файл починенным быть не может, какого бы рода он ни был.
      fixedIn("package.json");
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toContain("`package.json` в правленом не числится");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("правка, чистая в строках, не запечатывается, пока целое не отвечено", () => {
    const box = seatEmpty("urovni-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      // Общий слой берёт из слоя приложения — против правила таблицы слоёв,
      // — приложение берёт из общего: цикл. Оба пишут один ключ хранилища.
      fs.mkdirSync(path.join(box, "src", "shared", "zzPrefs"), { recursive: true });
      fs.writeFileSync(
        path.join(box, "src", "shared", "zzPrefs", "zzPrefs.ts"),
        'import { ZZ_TITLE } from "../../app/zzTitle";\n\nexport const zzSave = (v: string): void => {\n  window.localStorage.setItem("zz.key", ZZ_TITLE + v);\n};\n',
      );
      fs.writeFileSync(
        path.join(box, "src", "app", "zzTitle.ts"),
        'import { zzSave } from "../shared/zzPrefs/zzPrefs";\n\nexport const ZZ_TITLE = "t";\n\nexport const zzReset = (): void => {\n  window.localStorage.setItem("zz.key", "");\n  zzSave("");\n};\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const model = fs.readFileSync(protoAt, "utf8");
      expect(model).toMatch(/\| П\d+ \| направление \|[^\n]*\| новое \| против правила \|/);
      expect(model).toMatch(/\| П\d+ \| цикл \|[^\n]*\| новое \|/);
      expect(model).toMatch(/\| П\d+ \| писатель \|[^\n]*хранилище «zz\.key»/);
      // Ленивое «чисто» по всем строкам, основания без строк модели: печати
      // нет, и названо, почему — по уровням, а не списком строк.
      fillBar(protoAt, { release: "не нужно: проба" });
      const lazy = fs
        .readFileSync(protoAt, "utf8")
        .replace(/(?:(?:П|Св)\d+, )*(?:П|Св)\d+ проба/g, "проба")
        .replace(/см\. (?:(?:П|Св)\d+, )*(?:П|Св)\d+/g, "см. выше")
        .replace(
          /(?:(?:П|Св)\d+, )*(?:П|Св)\d+ разобраны \| да \| (?:(?:П|Св)\d+, )*(?:П|Св)\d+/g,
          "разобраны | да | проба",
        );
      fs.writeFileSync(protoAt, lazy);
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(/A5 для `shared`: чисто, а ребро идёт против правила направления: П\d+/);
      expect(refused).toMatch(/A9-бис для `app`: чисто, а правка завела цикл: П\d+/);
      // Второй писатель — вопрос к основанию: не названный номером, не отвечен.
      expect(refused).toMatch(/C6-бис: чисто, а у источника больше одного писателя/);
      expect(refused).toMatch(/чисто без опоры на модель своего уровня: назвать строку уровня «приложение»/);
      expect(refused).toMatch(/итог, узел `[^`]+`: опора не называет ни одной строки модели этого уровня/);
      expect(refused).toMatch(/сдвиг без ответа: П\d+/);
      // «Починено», а модель по нынешнему коду показывает то же: не принято.
      // Протокол начинается заново: ленивые основания иначе переехали бы.
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "A5@shared": "нашлось | src/shared/zzPrefs/zzPrefs.ts:1 | общее берёт из приложения | починено",
        },
      });
      expect(tool("bar")).toMatch(/A5 для `shared`: починено, а ребро против правила в модели осталось/);
      // Честный ответ: развилки вынесены вопросом, уровни не держатся.
      fs.rmSync(protoAt);
      tool("bar");
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/shared/zzPrefs/zzPrefs.ts` и `src/app/zzTitle.ts`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        // Предмет у каждого ответа свой: узел заголовка не держится, узел
        // общего — держится, оба слоя и приложение — нет.
        holds: { узел: "нет", "узел@shared/zzPrefs": "да", слой: "нет", приложение: "нет" },
        pick: {
          "A5@shared": "нашлось | src/shared/zzPrefs/zzPrefs.ts:1 | общее берёт из приложения | вопрос",
          "A9-бис@app": "нашлось | src/app/zzTitle.ts:1 | цикл общего и приложения | вопрос",
          "C6-бис": "нашлось | src/app/zzTitle.ts:6 | второй писатель ключа | вопрос",
          "A1@app/zzTitle.ts": "нашлось | src/app/zzTitle.ts:3 | узел и держит заголовок, и пишет хранилище | вопрос",
        },
      });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "уровни: узел `app/zzTitle.ts` — не держится; узел `shared/zzPrefs` — держится; слой `app` — не держится; слой `shared` — не держится; приложение — не держится",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("что завела сама правка, режет само", () => {
  it("обход входа и ещё один писатель ключа: «чисто» не принято, решение и вопрос — законны", () => {
    const box = seatEmpty("zavela-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, "src", ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      put(
        "shared/zzStore/zzStore.ts",
        'const ZZ_KEY = "zz.count";\n\nexport const zzSave = (value: number): void => {\n  window.localStorage.setItem(ZZ_KEY, String(value));\n};\n',
      );
      put("components/ZzA/zzClamp.ts", "export const zzClamp = (v: number): number => Math.min(v, 9);\n");
      put("components/ZzA/types.ts", "export type ZzAProps = { max: number };\n");
      put(
        "components/ZzA/ZzA.tsx",
        'import { zzSave } from "../../shared/zzStore/zzStore";\nimport type { ZzAProps } from "./types";\nimport { zzClamp } from "./zzClamp";\n\nexport function ZzA({ max }: ZzAProps) {\n  return <button onClick={() => zzSave(zzClamp(max))}>a</button>;\n}\n',
      );
      // У этой папки входа нет вовсе: ни бочки, ни файла узла.
      put("components/ZzC/zzInner.ts", "export const zzInner = 1;\n");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      // Кривая правка: помощник соседа мимо входа, тот же ключ — вторым
      // писателем. Типы соседа — его контракт, их взять законно.
      put(
        "components/ZzB/ZzB.tsx",
        'import type { ZzAProps } from "../ZzA/types";\nimport { zzClamp } from "../ZzA/zzClamp";\nimport { zzInner } from "../ZzC/zzInner";\n\nexport function ZzB({ max }: ZzAProps) {\n  const save = () =>\n    window.localStorage.setItem("zz.count", String(zzClamp(max + zzInner)));\n  return <button onClick={save}>b</button>;\n}\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const proto = fs.readFileSync(protoAt, "utf8");
      expect(proto).toMatch(/\| граница \|[^\n]*ZzA\/zzClamp\.ts[^\n]*\| новое \| мимо входа \|/);
      expect(proto).toMatch(/\| граница \|[^\n]*ZzC\/zzInner\.ts[^\n]*\| новое \| входа нет \|/);
      expect(proto).not.toMatch(/\| граница \|[^\n]*ZzA\/types\.ts/);
      // Соседи по графу: взятое мимо входа тянет хозяина — узел той папки.
      expect(proto).toMatch(
        /\| сосед \| `components\/ZzA\/ZzA\.tsx` \| в единице components\/ZzA, из которой берёт components\/ZzB\/ZzB\.tsx/,
      );
      expect(proto).toMatch(/\| писатель \|[^\n]*хранилище «zz\.count»: пишут components\/ZzB\/ZzB\.tsx, shared\/zzStore\/zzStore\.ts \| новое \|/);
      // Прилежное «чисто», каждая строка названа номером: мало.
      fillBar(protoAt, { release: "не нужно: проба" });
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(/A5 для `components`: чисто, а П\d+ — это завела сама правка/);
      expect(refused).toMatch(/B7 для `components\/ZzB`: чисто, а П\d+ — это завела сама правка/);
      // Второй писатель, названный номером, — отвеченный вопрос, не приговор.
      expect(refused).not.toMatch(/C6-бис/);
      // Внутренность папки без входа — вопрос к раскладке, а не приговор.
      const inner = /\| (П\d+) \| граница \|[^\n]*ZzC\/zzInner/.exec(proto)[1];
      expect(refused).not.toMatch(new RegExp("чисто, а " + inner + " — это завела"));
      // «Чисто» о повторённой логике без соседей — не сверено ни с кем.
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "A6-бис": "чисто |  | узел делает одно | " },
      });
      expect(tool("bar")).toMatch(/A6-бис: чисто, а соседи по графу в основании не названы/);
      fs.rmSync(protoAt);
      tool("bar");
      // «Оставляем» обход — решение с обоими файлами; писатель — вопрос.
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nПроба: `src/components/ZzB/ZzB.tsx` берёт `src/components/ZzA/zzClamp.ts` мимо входа — оставляем.\n",
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/components/ZzB/ZzB.tsx`.\n",
      );
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/\| граница \|[^\n]*ZzA\/zzClamp\.ts[^\n]*\| мимо входа · решение \|/);
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { приложение: "нет" },
        pick: { "C6-бис": "нашлось | src/components/ZzB/ZzB.tsx:7 | второй писатель ключа | вопрос" },
      });
      expect(tool("bar")).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("ядро по предметам уровня: правка, чтение, переход", () => {
  const toolAt = (box) => (...args) => {
    try {
      return execFileSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  // Два компонента: корзина держит состояние и отдаёт лишнее имя, панель
  // зовёт корзину.
  const twoUnits = (box) => {
    const cart = path.join(box, "src", "components", "zzCart");
    const bar = path.join(box, "src", "components", "zzBar");
    fs.mkdirSync(cart, { recursive: true });
    fs.mkdirSync(bar, { recursive: true });
    fs.writeFileSync(
      path.join(cart, "zzCart.tsx"),
      'import { useState } from "react";\n\nexport const ZZ_CART_KEY = "cart";\n\nexport const ZzCart = ({ items }: { items: number[] }) => {\n  const [total, setTotal] = useState(items.length);\n  return <button onClick={() => setTotal(0)}>{total}</button>;\n};\n',
    );
    fs.writeFileSync(
      path.join(cart, "zzTotal.ts"),
      "export const zzTotal = (items: number[]): number => items.length;\n",
    );
    fs.writeFileSync(
      path.join(bar, "zzBar.tsx"),
      'import { ZzCart } from "../zzCart/zzCart";\n\nexport const ZzBar = () => <ZzCart items={[1]} />;\n',
    );
  };
  const modelIdOf = (protoAt, sort, where) =>
    new RegExp("\\| (П\\d+) \\| " + sort + " \\| `" + where.replace(/[/.]/g, "\\$&"))
      .exec(fs.readFileSync(protoAt, "utf8"))?.[1] ?? null;

  it("правка двух узлов: ядро узла — по каждому, ответ про один не закрывает другой", () => {
    const box = seatEmpty("predmety-");
    try {
      const tool = toolAt(box);
      execFileSync("git", ["init", "-q"], { cwd: box });
      execFileSync(
        "git",
        ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", "add", "-A"],
        { cwd: box },
      );
      execFileSync(
        "git",
        ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", "commit", "-qm", "посадка", "--no-verify"],
        { cwd: box },
      );
      twoUnits(box);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      expect(tool("bar")).toContain("единиц переноса: components/zzBar, components/zzCart");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toContain("| A1 | `components/zzBar` |");
      expect(printed).toContain("| A1 | `components/zzCart` |");
      // Деталь не раскладывается: одна строка на правку.
      expect(printed.match(/^\| H7 \|/gm)).toHaveLength(1);
      // Ответ про панель, опёртый на строку о корзине, и находка про корзину
      // с адресом в панели — обе не принимаются.
      const cartRow = modelIdOf(protoAt, "ответственность", "components/zzCart/zzCart.tsx");
      expect(cartRow).not.toBeNull();
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "A1@components/zzBar": "чисто |  | один вопрос: " + cartRow + " | ",
          "A1@components/zzCart": "нашлось | src/components/zzBar/zzBar.tsx:1 | две ответственности | починено",
        },
      });
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(
        /A1 для `components\/zzBar`: чисто без опоры на модель своего уровня: назвать строку уровня «узел»/,
      );
      expect(refused).toContain(
        "A1 для `components/zzCart`: находка называет `src/components/zzBar/zzBar.tsx` — вне этого предмета",
      );
      // Лишнее имя корзины — вопрос к её поверхности.
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "B7@components/zzCart": "чисто |  | внутреннее не уходит | " },
      });
      expect(tool("bar")).toMatch(
        /B7 для `components\/zzCart`: чисто, а поверхность узла сдвинулась[^\n]*|B7 для `components\/zzCart`: чисто, а в поверхности есть имена/,
      );
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "уровни: узел `components/zzBar` — держится; узел `components/zzCart` — держится; слой `components` — держится; приложение — держится",
      );
      // Повторный зов по нетронутому протоколу — не «правлен после печати».
      expect(tool("bar")).toContain("печать уже стоит");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("чтение: адрес-папка берёт весь узел, и о состоянии спрашивают, хоть оно и не новое", () => {
    const box = seatEmpty("chtenie-");
    try {
      const tool = toolAt(box);
      twoUnits(box);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      expect(tool("bar", "components/zzCart")).toContain("единиц переноса: components/zzCart;");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toContain("| `components/zzCart/zzCart.tsx` |");
      expect(printed).toContain("| `components/zzCart/zzTotal.ts` |");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { A6: "чисто |  | источник один | ", C7: "нет предмета |  | хранить нечего | " },
      });
      const refused = tool("bar", "components/zzCart");
      expect(refused).toMatch(/A6: чисто, а в предмете есть состояние, и в основании не сказано, почему это не второй источник: П\d+/);
      expect(refused).toMatch(/C7: нет предмета, а в модели он есть: П\d+/);
      // Набор сузился — политика потеряла критерий: протокол пересобирается,
      // а не держит строку, которой в своде больше нет.
      const policy = path.join(box, ".claude", "rules", "quality.md");
      fs.writeFileSync(
        policy,
        fs.readFileSync(policy, "utf8").replace("**H7. Магических чисел нет.** (единица)\n", ""),
      );
      expect(tool("bar", "components/zzCart")).toContain("протокол напечатан");
      expect(fs.readFileSync(protoAt, "utf8")).not.toMatch(/^\| H7 \|/m);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("переход: ядро на узел и слой, приложение целиком, находка — долгом, шаг не закрыть без печати", () => {
    const box = seatEmpty("perehod-");
    try {
      const tool = toolAt(box);
      twoUnits(box);
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs
          .readFileSync(cfgAt, "utf8")
          .replace(
            "  transition: null,",
            '  transition: {\n    file: "15-transition.md",\n    heading: "| № | Шаг | Объём | Чем проверяется |",\n    debtHeading: "| № | Расхождение | Сейчас | Держит | План | Цена |",\n  },',
          ),
      );
      const planAt = path.join(box, ".context", "15-transition.md");
      fs.copyFileSync(path.join(box, ".claude", "seat", "templates", "15-transition.md"), planAt);
      const step = /\| [0-9]+ \| Архитектурный проход[^\n]*\n/;
      expect(fs.readFileSync(planAt, "utf8")).toMatch(step);
      // Бочка слоя — своя единица переноса, но сама ничего не делает.
      fs.writeFileSync(
        path.join(box, "src", "components", "index.ts"),
        'export { ZzCart } from "./zzCart/zzCart";\n',
      );
      // Пустой проход: протоколы напечатаны, код не ноль.
      const first = tool("bar", "--transition");
      expect(first).toContain("предметов: 5 (единиц переноса 3, слоёв 1, приложение 1)");
      const dir = path.join(box, ".context", "15-transition-bar");
      for (const one of [
        "node--components--zzCart.md",
        "node--components--zzBar.md",
        "node--components--index.ts.md",
        "layer--components.md",
        "app.md",
      ])
        expect(fs.existsSync(path.join(dir, one))).toBe(true);
      // Ядро одного уровня — и только оно.
      const cart = fs.readFileSync(path.join(dir, "node--components--zzCart.md"), "utf8");
      expect(cart).toContain("- род: `на переход`");
      expect(cart).toContain("| A1 | `components/zzCart` |");
      expect(cart).not.toMatch(/^\| H7 \|/m);
      expect(cart).not.toMatch(/^\| A6 \|/m);
      expect(cart).not.toMatch(/^\| E7 \|/m);
      // Приложение — целиком, а не ядром: его критерии каждая правка задаёт
      // о всём проекте, и не заданные здесь они ложились на первую правку.
      const app = fs.readFileSync(path.join(dir, "app.md"), "utf8");
      expect(app).toMatch(/^\| A6 \|/m);
      expect(app).toMatch(/^\| G7 \|/m);
      expect(app).toMatch(/^\| J2 \|/m);
      // Предмет перехода — проект вместе с манифестом: о зависимостях
      // спрашивают, а не закрывают заготовкой правки.
      expect(app).toMatch(/^\| R1 \|/m);
      expect(app).not.toContain("манифест этой правкой не тронут");
      // Политику переход читает один раз — страницами протокола приложения,
      // телами ядра узла и слоя и всех критериев приложения; протокол
      // единицы читает её код, слой — свои факты.
      const pages = (text) =>
        [...text.matchAll(/^\| \d+ \| ((?:политика|код|сосед)[^|]+) \|  \|$/gm)].map((m) => m[1].trim());
      expect(pages(app).length).toBeGreaterThan(0);
      expect(pages(app).every((one) => one.startsWith("политика: "))).toBe(true);
      expect(pages(cart)).toEqual([
        "код `components/zzCart/zzCart.tsx`, строки 1–8",
        "код `components/zzCart/zzTotal.ts`, строки 1–1",
      ]);
      expect(pages(fs.readFileSync(path.join(dir, "layer--components.md"), "utf8"))).toEqual([]);
      const policy = execFileSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "bar-read", path.join(dir, "app.md")],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      for (const id of ["A1", "A5", "A6", "G7"]) expect(policy).toContain("**" + id + ". ");
      // У бочки из ядра узла предмет есть только у вопроса о поверхности.
      const barrel = fs.readFileSync(path.join(dir, "node--components--index.ts.md"), "utf8");
      expect(barrel).toContain("| B7 | `components/index.ts` |");
      expect(barrel).not.toMatch(/^\| A1 \|/m);
      // Находка ложится долгом, и план обязан её назвать.
      for (const one of readdirOf(dir))
        fillBar(path.join(dir, one), {
          release: "не нужно: проба",
          holds: { "узел@components/zzCart": "нет" },
          pick: { "B7@components/zzCart": "нашлось | src/components/zzCart/zzCart.tsx:3 | лишнее имя | долг" },
        });
      expect(tool("bar", "--transition")).toContain(
        "«долг», а файл перехода `15-transition.md` не называет `src/components/zzCart/zzCart.tsx`",
      );
      fs.writeFileSync(
        planAt,
        fs
          .readFileSync(planAt, "utf8")
          .replace(
            "| № | Расхождение | Сейчас | Держит | План | Цена |\n| --- | --- | --- | --- | --- | --- |\n",
            "| № | Расхождение | Сейчас | Держит | План | Цена |\n| --- | --- | --- | --- | --- | --- |\n| 1 | Лишняя поверхность «B7» | `1` | `graph.mjs bar` | снять имя в `src/components/zzCart/zzCart.tsx` | `1` строка |\n",
          ),
      );
      const done = tool("bar", "--transition");
      expect(done).toContain("запечатано: 5, с дырами: 0");
      // Сверка: шаг открыт — ход; закрыт — печати; протоколов нет — красное.
      const section = () => {
        let out;
        try {
          out = execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "verify"], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          out = String(e.stdout ?? "");
        }
        return out.split("=== Архитектурный проход перехода запечатан ===")[1].split("\n===")[0];
      };
      expect(section()).toContain("шаг открыт: запечатано на нынешнем коде 5 из 5 предметов");
      fs.writeFileSync(planAt, fs.readFileSync(planAt, "utf8").replace(step, ""));
      expect(section()).toContain("шаг закрыт: протоколов 5, все запечатаны");
      fs.rmSync(dir, { recursive: true, force: true });
      expect(section()).toContain("    шаг «архитектурный проход» закрыт, а протоколов нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("свод на правке — по той же области, что разбор; новое — с каталогом проекта", () => {
  it("соседи по графу и по имени, их факты и записи; новый файл и новое состояние сверяют с каталогом", () => {
    const box = seatEmpty("oblast-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      // Лежащее до правки: общий слой берёт из приложения — против правила;
      // ключ хранилища — общая константа, её берёт и индикатор.
      put("src/app/zzTitle.ts", 'export const ZZ_TITLE = "t";\n');
      put("src/shared/zzKeys/zzKeys.ts", 'export const ZZ_COUNT_KEY = "zz.count";\n');
      put(
        "src/shared/zzStore/zzStore.ts",
        'import { ZZ_TITLE } from "../../app/zzTitle";\nimport { ZZ_COUNT_KEY } from "../zzKeys/zzKeys";\n\nexport const zzSave = (v: number): void => {\n  window.localStorage.setItem(ZZ_COUNT_KEY, ZZ_TITLE + v);\n};\n',
      );
      put(
        "src/components/ZzMeter/ZzMeter.tsx",
        'import { ZZ_COUNT_KEY } from "../../shared/zzKeys/zzKeys";\n\nexport function ZzMeter() {\n  return <span>{ZZ_COUNT_KEY}</span>;\n}\n',
      );
      const stateAt = path.join(box, ".context", "04-state.md");
      fs.copyFileSync(path.join(box, ".claude", "seat", "templates", "04-state.md"), stateAt);
      fs.writeFileSync(
        stateAt,
        fs
          .readFileSync(stateAt, "utf8")
          .replace(
            "| --- | --- | --- | --- | --- |\n",
            "| --- | --- | --- | --- | --- |\n" +
              "| счёт в хранилище | `src/shared/zzStore/zzStore.ts` | `src/shared/zzStore/zzStore.ts` | `src/components/ZzMeter/ZzMeter.tsx` | сеанс |\n" +
              "| заголовок окна | `src/app/zzTitle.ts` | `src/app/zzTitle.ts` | — | сеанс |\n",
          ),
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      // Правка: новый счётчик со своим состоянием берёт хранилище и ключ.
      put(
        "src/components/ZzCounter/ZzCounter.tsx",
        'import { useState } from "react";\nimport { ZZ_COUNT_KEY } from "../../shared/zzKeys/zzKeys";\nimport { zzSave } from "../../shared/zzStore/zzStore";\n\nexport function ZzCounter() {\n  const [n, setN] = useState(0);\n  const add = () => {\n    setN(n + 1);\n    zzSave(n + 1);\n  };\n  return (\n    <button title={ZZ_COUNT_KEY} onClick={add}>\n      {n}\n    </button>\n  );\n}\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      expect(tool("bar")).toContain("соседей в области: 3");
      const proto = fs.readFileSync(protoAt, "utf8");
      // Отпечатки — одно правленое: их сверяют ворота перед коммитом.
      const head = proto.split("## Прочитано")[0].split("## Модель предмета")[0];
      expect(head).toContain("| `components/ZzCounter/ZzCounter.tsx` |");
      expect(head).not.toContain("zzStore.ts");
      // Соседи — своим предметом ядра узла и слоя.
      expect(proto).toContain("| A1 | `соседи` |");
      expect(proto).toContain("| A5 | `соседи` |");
      // Партнёр по имени-константе — сосед, хоть импорта между ними нет.
      expect(proto).toMatch(
        /\| сосед \| `components\/ZzMeter\/ZzMeter\.tsx` \| делит с components\/ZzCounter\/ZzCounter\.tsx имя ZZ_COUNT_KEY/,
      );
      // Факт соседа, который машина видит сама: ребро против правила.
      expect(proto).toMatch(
        /\| П\d+ \| направление \| `shared\/zzStore\/zzStore\.ts` \|[^\n]*\|  \| против правила \|/,
      );
      // База и документация — строка на каждый файл области.
      for (const f of [
        "components/ZzCounter/ZzCounter.tsx",
        "components/ZzMeter/ZzMeter.tsx",
        "shared/zzKeys/zzKeys.ts",
        "shared/zzStore/zzStore.ts",
      ])
        expect(proto).toMatch(
          new RegExp("^\\| `" + f.replace(/[/.]/g, "\\$&") + "` \\|  \\|  \\|  \\|$", "m"),
        );
      // Каталог: новый файл — единицы его слоя; новое состояние — источники
      // проекта, которых модель ещё не показала.
      expect(proto).toMatch(/\| каталог \| `components\/ZzMeter` \|[^\n]*\| слой \|/);
      expect(proto).toMatch(
        /\| каталог \| `\.context\/04-state\.md` \| «заголовок окна»[^\n]*\| источники \|/,
      );
      expect(proto).not.toMatch(/\| каталог \|[^\n]*«счёт в хранилище»/);

      // Прилежное «чисто» по всем строкам: ребро соседа против правила
      // печати не даёт — область читают целиком.
      fillBar(protoAt, { release: "не нужно: проба" });
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(
        /A5 для `соседи`: чисто, а ребро идёт против правила направления: П\d+/,
      );

      // Сверено с соседями по графу, а каталог не назван — мало.
      fs.rmSync(protoAt);
      tool("bar");
      const fresh = fs.readFileSync(protoAt, "utf8");
      const idsOf = (...sorts) =>
        fresh
          .split("\n")
          .filter((l) => /^\| П\d+ \|/.test(l) && sorts.includes(l.split("|")[2].trim()))
          .map((l) => l.split("|")[1].trim())
          .join(", ");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "A6-бис": "чисто |  | сверено с соседями " + idsOf("сосед") + " | ",
          A6: "чисто |  | сверено с источниками " + idsOf("источник", "состояние") + " | ",
        },
      });
      const narrow = tool("bar");
      expect(narrow).toMatch(
        /A6-бис: чисто, а правка завела новый файл, а единицы его слоя в основании не названы[^:]*: П\d+/,
      );
      expect(narrow).toMatch(
        /A6: чисто, а правка завела новое, а каталог источников проекта в основании не назван[^:]*: П\d+/,
      );

      // Честный свод: каталог назван, факт соседа вынесен вопросом. У теста
      // «база не требуется» законно, когда его называет реестр тестов: в карте
      // своей строки у теста нет и быть не может.
      put(
        "src/components/ZzCounter/tests/ZzCounter.test.tsx",
        'import { ZzCounter } from "../ZzCounter";\n\nexport const zzProbe = ZzCounter;\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      const testRow = "| `components/ZzCounter/tests/ZzCounter.test.tsx` |  |  |  |";
      expect(fs.readFileSync(protoAt, "utf8")).toContain(testRow);
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .replace(
            testRow,
            "| `components/ZzCounter/tests/ZzCounter.test.tsx` | не требуется | не требуется | тест описан реестром |",
          ),
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/shared/zzStore/zzStore.ts`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { "слой@соседи": "нет" },
        pick: {
          "A5@соседи": "нашлось | src/shared/zzStore/zzStore.ts:1 | общее берёт из приложения | вопрос",
        },
      });
      expect(tool("bar")).toContain(
        "ZzCounter.test.tsx, база: `не требуется` у теста без своей записи в реестре тестов",
      );
      fs.appendFileSync(
        path.join(box, ".context", "08-tests.md"),
        "\n| `src/components/ZzCounter/tests/ZzCounter.test.tsx` | проба |\n",
      );
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain("слой `соседи` — не держится");
      // Сверка прогона ждёт те же строки, что и режим: протокол без строк о
      // соседях, запечатанный в обход режима, она не принимает.
      const barSection = () =>
        tool("verify").split("=== Планка пройдена покритериально ===")[1].split("\n===")[0];
      expect(barSection()).toContain("свод закрыт печатью");
      const blank = fs
        .readFileSync(protoAt, "utf8")
        .split("\n")
        .filter((l) => !/^\| [^|]+ \| `соседи` \| /.test(l) || /^\| (узел|слой) \|/.test(l))
        .join("\n")
        .replace(/^- печать: `.*`$/m, "- печать: `нет`");
      const forged = createHash("sha1").update(blank).digest("hex").slice(0, 12);
      fs.writeFileSync(protoAt, blank.replace("- печать: `нет`", "- печать: `" + forged + "`"));
      expect(barSection()).toMatch(/исхода нет у строк: [1-9][0-9]* из [0-9]+ — [^\n]*для `соседи`/);

      // Разбор берёт ту же область: партнёр по имени в ней есть.
      tool("bar", "components/ZzMeter");
      const read = fs.readFileSync(protoAt, "utf8").split("## Модель предмета")[0];
      expect(read).toContain("| `components/ZzCounter/ZzCounter.tsx` |");
      expect(read).toContain("| `shared/zzStore/zzStore.ts` |");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("потребитель за областью — строкой радиуса и вопросом о совместимости", () => {
    const box = seatEmpty("radius-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      // Цепочка: помощник ← показ ← экран. Тест есть у показа, у экрана нет.
      put("src/shared/zzFmt/zzFmt.ts", "export const zzFmt = (n: number): string => String(n);\n");
      put(
        "src/components/ZzShow/ZzShow.tsx",
        'import { zzFmt } from "../../shared/zzFmt/zzFmt";\n\nexport function ZzShow({ n }: { n: number }) {\n  return <span>{zzFmt(n)}</span>;\n}\n',
      );
      put(
        "src/components/ZzShow/tests/ZzShow.test.tsx",
        'import { ZzShow } from "../ZzShow";\n\nexport const zzProbe = ZzShow;\n',
      );
      put(
        "src/app/zzScreen.tsx",
        'import { ZzShow } from "../components/ZzShow/ZzShow";\n\nexport function ZzScreen() {\n  return <ZzShow n={1} />;\n}\n',
      );
      // Второй потребитель за областью — с тестом через него: строка обязана
      // их различать, а не говорить «теста нет» обо всех.
      put(
        "src/app/zzOther.tsx",
        'import { ZzShow } from "../components/ZzShow/ZzShow";\n\nexport function ZzOther() {\n  return <ZzShow n={2} />;\n}\n',
      );
      put(
        "src/app/tests/zzOther.test.tsx",
        'import { ZzOther } from "../zzOther";\n\nexport const zzOtherProbe = ZzOther;\n',
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Правка глубокого помощника: оба экрана за областью, тест есть через один.
      // Новый файл, который помощник берёт, своей строки не несёт: каждый его
      // потребитель — правленый либо новый, и их радиус уже назван.
      put("src/shared/zzFmt/zzPad.ts", 'export const zzPad = (s: string): string => s.padStart(4, " ");\n');
      put(
        "src/shared/zzFmt/zzFmt.ts",
        'import { zzPad } from "./zzPad";\n\nexport const zzFmt = (n: number): string => zzPad(n.toFixed(1));\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const first = fs.readFileSync(protoAt, "utf8");
      expect(first).toContain(
        "| радиус | `shared/zzFmt/zzFmt.ts` | за областью потребителей `2`, без теста через них `1`: app/zzOther.tsx — тест app/tests/zzOther.test.tsx; app/zzScreen.tsx — теста через него нет |  | без теста |",
      );
      expect(first.match(/\| радиус \|/g)).toHaveLength(1);
      // О совместимости молчать нельзя: ни «чисто» мимо радиуса, ни «нет предмета».
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "J9-тер": "чисто |  | поведение то же | " },
      });
      expect(tool("bar")).toMatch(
        /J9-тер: чисто, а за областью есть потребители правленого узла[^:]*: П\d+/,
      );
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "J9-тер": "нет предмета |  | тестов не трогали | " },
      });
      expect(tool("bar")).toMatch(/J9-тер: нет предмета, а в модели он есть: П\d+/);
      fs.rmSync(protoAt);
      tool("bar");
      const radiusId = /\| (П\d+) \| радиус \|/.exec(fs.readFileSync(protoAt, "utf8"))[1];
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "J9-тер": "чисто |  | " + radiusId + ": экран показывает ту же строку показа, её держит тест показа | ",
        },
      });
      expect(tool("bar")).toContain("печать поставлена");

      // Тест есть через каждого потребителя за областью — пометки нет.
      put(
        "src/app/tests/zzScreen.test.tsx",
        'import { ZzScreen } from "../zzScreen";\n\nexport const zzScreenProbe = ZzScreen;\n',
      );
      git("add", "-A");
      git("commit", "-qm", "тест экрана", "--no-verify");
      put(
        "src/shared/zzFmt/zzFmt.ts",
        'import { zzPad } from "./zzPad";\n\nexport const zzFmt = (n: number): string => zzPad(n.toFixed(2));\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain(
        "| радиус | `shared/zzFmt/zzFmt.ts` | за областью потребителей `2`, без теста через них `0`: app/zzOther.tsx — тест app/tests/zzOther.test.tsx; app/zzScreen.tsx — тест app/tests/zzScreen.test.tsx |  |  |",
      );

      // Потребителей больше, чем строка называет поимённо: голова — по имени,
      // прочие числом.
      for (let i = 1; i <= 8; i += 1)
        put(
          "src/app/zzS" + i + ".tsx",
          'import { ZzShow } from "../components/ZzShow/ZzShow";\n\nexport function ZzS' + i + "() {\n  return <ZzShow n={" + i + "} />;\n}\n",
        );
      git("add", "-A");
      git("commit", "-qm", "экраны", "--no-verify");
      put(
        "src/shared/zzFmt/zzFmt.ts",
        'import { zzPad } from "./zzPad";\n\nexport const zzFmt = (n: number): string => zzPad(n.toFixed(3));\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      const wide = /\| радиус \| `shared\/zzFmt\/zzFmt\.ts` \| ([^|]*) \|/.exec(fs.readFileSync(protoAt, "utf8"))[1];
      expect(wide).toMatch(/^за областью потребителей `10`, без теста через них `8`: /);
      expect(wide.split("; ")).toHaveLength(9);
      expect(wide).toMatch(/; и ещё `2`$/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("партнёр по строке таблицы связей — в области, в модели и в досье", () => {
    const box = seatEmpty("links-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      // Атрибут и переменную ставит показ, читает панель — ни импорта, ни
      // общей константы между ними нет. Адрес строки берётся от корня
      // репозитория либо от корня исходников — здесь обе формы.
      put(
        "src/components/ZzShow/ZzShow.tsx",
        'export function ZzShow({ n }: { n: number }) {\n  return (\n    <span data-zz-open="1" style={{ "--zz-tone": "red" }}>\n      {n}\n    </span>\n  );\n}\n',
      );
      put(
        "src/components/ZzPanel/ZzPanel.tsx",
        'export function ZzPanel() {\n  return <div>{document.querySelector("[data-zz-open]") ? "open" : "closed"}</div>;\n}\n',
      );
      put("src/components/ZzPanel/ZzPanel.module.css", ".zzPanel {\n  color: var(--zz-tone);\n}\n");
      const graphAt = path.join(box, ".context", "03-graph.md");
      fs.writeFileSync(
        graphAt,
        fs
          .readFileSync(graphAt, "utf8")
          .replace(
            "| Атрибут | Кто ставит | Кто читает |\n| --- | --- | --- |\n",
            "| Атрибут | Кто ставит | Кто читает |\n| --- | --- | --- |\n| `data-zz-open` | `src/components/ZzShow/ZzShow.tsx` | `src/components/ZzPanel/ZzPanel.tsx` |\n",
          )
          .replace(
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n",
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n| `--zz-tone` | `components/ZzShow/ZzShow.tsx` | `components/ZzPanel/ZzPanel.module.css` |\n",
          ),
      );
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs
          .readFileSync(cfgAt, "utf8")
          .replace(
            "  domTables: null,",
            '  domTables: { file: "03-graph.md", headings: ["| Атрибут | Кто ставит | Кто читает |", "| Переменная | Кто ставит | Кто читает |"] },',
          ),
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Разбор показа: партнёры по записанной связи — в области и в модели.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzShow");
      const read = fs.readFileSync(protoAt, "utf8");
      const head = read.split("## Модель предмета")[0];
      expect(head).toContain("| `components/ZzPanel/ZzPanel.tsx` |");
      expect(head).toContain("| `components/ZzPanel/ZzPanel.module.css` |");
      expect(read).toMatch(
        /\| сосед \| `components\/ZzPanel\/ZzPanel\.tsx` \| связан с components\/ZzShow\/ZzShow\.tsx строкой таблицы связей/,
      );
      // Правку сверяют по той же области: оба конца — строками таблицы «база
      // и документация»; шапка предмета на правке — одно правленое.
      put(
        "src/components/ZzShow/ZzShow.tsx",
        'export function ZzShow({ n }: { n: number }) {\n  return (\n    <span data-zz-open="1" style={{ "--zz-tone": "blue" }}>\n      {n}\n    </span>\n  );\n}\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      const change = fs.readFileSync(protoAt, "utf8");
      for (const f of ["components/ZzPanel/ZzPanel.tsx", "components/ZzPanel/ZzPanel.module.css"])
        expect(change).toMatch(
          new RegExp("^\\| `" + f.replace(/[/.]/g, "\\$&") + "` \\|  \\|  \\|  \\|$", "m"),
        );
      // Досье называет их с обеих сторон: у кода и у листа стилей.
      expect(tool("brief", "components/ZzShow/ZzShow.tsx")).toMatch(
        /--- связаны записью таблицы связей[^\n]*\n {2}components\/ZzPanel\/ZzPanel\.module\.css\n {2}components\/ZzPanel\/ZzPanel\.tsx/,
      );
      expect(tool("brief", "components/ZzPanel/ZzPanel.module.css")).toMatch(
        /--- связаны записью таблицы связей ---\n {2}components\/ZzShow\/ZzShow\.tsx/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("признаки, видимые текстом, в модели свода", () => {
  it("строка на признак, вопрос по номеру, пустой перехват режет сам", () => {
    const box = seatEmpty("symptom-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      put(
        "src/shared/zzStore/zzStore.ts",
        "export const zzItems: string[] = [];\nexport const zzConfig = { size: 0 };\nlet zzHits = 0;\nexport const zzBump = () => {\n  zzHits += 1;\n  return zzHits;\n};\n",
      );
      put(
        "src/shared/zzFormat/zzFormat.ts",
        'export const zzDate = (d: Date) => d.toISOString();\nexport const zzMoney = (n: number) => n.toFixed(2) + " $";\n',
      );
      put("src/shared/zzOnly/zzOnly.ts", "export const zzOnly = () => 'one';\n");
      // Сеттер значения флагом не является: булево там — само значение.
      put(
        "src/shared/zzMode/zzMode.ts",
        "export function setZzMode(on: boolean) {\n  return on;\n}\nexport const zzUse = () => setZzMode(true);\n",
      );
      put(
        "src/components/ZzClock/ZzClock.tsx",
        [
          'import { useState } from "react";',
          'import { zzItems, zzConfig } from "../../shared/zzStore/zzStore";',
          'import { zzDate } from "../../shared/zzFormat/zzFormat";',
          'import { zzOnly } from "../../shared/zzOnly/zzOnly";',
          "",
          "export function zzRender(fast: boolean, label = false) {",
          '  return fast ? "f" : label ? "l" : "s";',
          "}",
          "",
          "export function useZzClock() {",
          "  const [open, setOpen] = useState(false);",
          "  const [busy, setBusy] = useState(false);",
          '  zzItems.push("x");',
          "  zzConfig.size = 5;",
          "  const delayMs = 300;",
          "  setTimeout(() => setBusy(!busy), delayMs * 4);",
          "  try {",
          "    zzOnly();",
          "  } catch {",
          "    // nothing to do",
          "  }",
          '  fetch("/x").catch(() => {});',
          "  zzRender(true);",
          "  zzDate(new Date(0));",
          '  const text = "42 items";',
          "  return [open, busy, setOpen, text];",
          "}",
          "",
        ].join("\n"),
      );
      put(
        "src/components/ZzClock/types.ts",
        "export type ZzClockProps = {\n  a: boolean;\n  b?: boolean;\n  c: boolean;\n};\n",
      );
      put(
        "src/components/ZzPrice/ZzPrice.tsx",
        'import { zzMoney } from "../../shared/zzFormat/zzFormat";\nexport const zzPrice = () => zzMoney(3);\nexport const ZzTag = () => <i tabIndex={7} />;\n',
      );

      // Разбор папки часов: строка на признак, места по номерам строк.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzClock");
      const read = fs.readFileSync(protoAt, "utf8");
      const row = (sort, what, mark = "") =>
        new RegExp(
          "^\\| П\\d+ \\| " +
            sort +
            " \\| `[^`]+` \\| " +
            what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            " \\| [^|]* \\| " +
            mark +
            " \\|",
          "m",
        );
      expect(read).toContain("### Единица");
      // Число под именем, в строке и ноль-единица-двойка вопросом не являются:
      // из всех чисел файла осталось одно — множитель без имени.
      expect(read).toMatch(row("число", "числа без имени: строка 16 `4`"));
      expect(read).toMatch(
        row("флаг", "булев параметр либо довод: строка 6 `fast`, строка 6 `label`, строка 23 `zzRender(…)`"),
      );
      expect(read).toMatch(row("перехват", "пустой перехват: строка 19 `catch`, строка 22 `.catch`", "пустой"));
      expect(read).toMatch(row("кортеж", "ответ кортежем: строка 26 `4`"));
      expect(read).toMatch(
        row("мутация", "меняет взятое импортом: строка 13 `zzItems.push(`, строка 14 `zzConfig.size=`"),
      );
      expect(read).toMatch(row("флаги", "булевых полей состояния `2`: строка 11, строка 12", "состояние"));
      expect(read).toMatch(row("флаги", "булевых полей в типах `3`: строка 2, строка 3, строка 4", "вход"));

      // Признаки места и состояние модуля — у своих адресов.
      expect(tool("levels", "shared/zzFormat/zzFormat.ts")).toContain(
        "порознь: потребители берут непересекающиеся части: components/ZzClock — zzDate; components/ZzPrice — zzMoney",
      );
      expect(tool("levels", "shared/zzOnly/zzOnly.ts")).toContain(
        "место: общий узел, а берёт его одна единица переноса: components/ZzClock",
      );
      // Атрибут разметки называет число так же, как ключ объекта.
      expect(tool("levels", "components/ZzPrice/ZzPrice.tsx")).toContain(
        "число: числа без имени: строка 2 3 — components/ZzPrice/ZzPrice.tsx:2",
      );
      const mode = tool("levels", "shared/zzMode/zzMode.ts");
      expect(mode).toContain("флаг: булев параметр либо довод: строка 1 on");
      expect(mode).not.toContain("setZzMode(…)");
      expect(tool("levels", "shared/zzStore/zzStore.ts")).toContain(
        "модульное: изменяемое на уровне модуля: строка 3 zzHits",
      );

      // Беспредметность по признаку ложна.
      const asked = ["H7", "B1", "A4", "E1", "B4", "C8", "B8"];
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: Object.fromEntries(asked.map((id) => [id, "нет предмета |  | проба | "])),
      });
      const holes = tool("bar", "components/ZzClock");
      for (const id of asked)
        expect(holes).toMatch(new RegExp("^ {4}" + id + ": нет предмета, а в модели он есть: П\\d+", "m"));
      const ids = (sort) =>
        [...read.matchAll(new RegExp("^\\| (П\\d+) \\| " + sort + " \\|", "gm"))].map((m) => m[1]);
      const say = (sort, why) => ids(sort).join(", ") + " — " + why;
      const pick = {
        H7: "чисто |  | " + say("число", "множитель задержки, проба") + " | ",
        B1: "чисто |  | " + say("флаг", "проба") + " | ",
        A4: "чисто |  | " + say("флаг", "проба") + " | ",
        E1: "чисто |  | " + say("перехват", "проба") + " | ",
        B4: "чисто |  | " + say("кортеж", "проба") + " | ",
        C8: "чисто |  | " + say("флаги", "проба") + " | ",
        B8: "чисто |  | " + say("флаги", "проба") + " | ",
      };
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .map((line) => {
            const c = line.split("|");
            const id = (c[1] ?? "").trim();
            return c.length === 9 && pick[id] !== undefined
              ? "| " + id + " | " + c[2].trim() + " | x | " + pick[id] + " |"
              : line;
          })
          .join("\n"),
      );
      // Пустой перехват — приговор: основание его не отменяет.
      expect(tool("bar", "components/ZzClock")).toMatch(/^ {4}E1: чисто, а перехват пустой: П\d+$/m);
      const spot = "`src/components/ZzClock/ZzClock.tsx:19`";
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .map((line) =>
            line.startsWith("| E1 |")
              ? "| E1 | — | x | нашлось | " + spot + " | ошибка проглочена | предложено |"
              : line,
          )
          .join("\n"),
      );
      const sealed = tool("bar", "components/ZzClock");
      expect(sealed).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("свидетели в своде по планке", () => {
  it("фраза единицы, ответ по объявлению, вердикт по ответу", () => {
    const box = seatEmpty("witness-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const at = path.join(box, "src", "components", "ZzCard", "ZzCard.tsx");
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(
        at,
        [
          "export function zzActive(isVisible: boolean, isDisabled: boolean) {",
          "  return isVisible && !isDisabled;",
          "}",
          "export const ZZ_LIMIT = 10;",
          "export function ZzCard({ title, count }: { title: string; count: number }) {",
          "  return title + count;",
          "}",
          "",
        ].join("\n"),
      );
      // Карта называет ответственность: фразу, списанную с неё, свод не примет.
      const mapAt = path.join(box, ".context", "00-map.md");
      fs.appendFileSync(
        mapAt,
        "\n| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n" +
          "| `src/components/ZzCard/ZzCard.tsx` | показывает карточку товара | нет | нет |\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzCard");
      const read = fs.readFileSync(protoAt, "utf8");
      // Строка на единицу и на каждое объявление; ответ, которого не спросить,
      // ставит инструмент.
      expect(read).toContain(
        "| Св1 | `components/ZzCard` | строк кода `7`; файлов `1`; полей состояния `0` |  |  |  | полей меньше двух |",
      );
      expect(read).toContain("| Св2 | `components/ZzCard/ZzCard.tsx:1` | `zzActive` |  |  |  |  |  |");
      expect(read).toContain(
        "| Св3 | `components/ZzCard/ZzCard.tsx:4` | `ZZ_LIMIT` |  |  |  | не абстракция | входов меньше двух |",
      );
      expect(read).toContain("| Св4 | `components/ZzCard/ZzCard.tsx:5` | `ZzCard` |  |  |  |  |  |");

      const setRow = (id, cells) =>
        fs.writeFileSync(
          protoAt,
          fs
            .readFileSync(protoAt, "utf8")
            .split("\n")
            .map((line) => {
              if (!line.startsWith("| " + id + " |")) return line;
              const c = line.split("|");
              cells.forEach((v, k) => {
                if (v !== null) c[4 + k] = " " + v + " ";
              });
              return c.join("|");
            })
            .join("\n"),
        );
      const setOutcome = (id, rest) =>
        fs.writeFileSync(
          protoAt,
          fs
            .readFileSync(protoAt, "utf8")
            .split("\n")
            .map((line) => {
              const c = line.split("|");
              return c.length === 9 && c[1].trim() === id
                ? "| " + id + " | " + c[2].trim() + " | x | " + rest + " |"
                : line;
            })
            .join("\n"),
        );
      fillBar(protoAt, { release: "не нужно: проба" });
      // Фраза, списанная с карты, и фраза с союзом без объяснения — не ответ.
      setRow("Св1", ["Показывает карточку товара.", null, null, null]);
      expect(tool("bar", "components/ZzCard")).toMatch(
        /^ {4}Св1 \(components\/ZzCard\): фраза списана с карты: её пишут по коду$/m,
      );
      setRow("Св1", ["считает активность и рисует карточку", "да", null, null]);
      expect(tool("bar", "components/ZzCard")).toMatch(
        /^ {4}Св1 \(components\/ZzCard\): во фразе союз: сказать, почему вопрос один \(«да: …»\), либо «нет»$/m,
      );
      // «Нет» в вопросе об одной ответственности делает «чисто» ложным.
      setRow("Св1", [null, "нет", null, null]);
      expect(tool("bar", "components/ZzCard")).toMatch(
        /^ {4}A1 для `components\/ZzCard`: чисто, а свидетель говорит иначе: Св1$/m,
      );
      // Объявление, не служащее фразе, — вторая ответственность.
      setRow("Св1", ["показывает карточку и её ценник", "да: ценник — часть карточки", null, null]);
      setRow("Св2", [null, "нет", null, null, "да: собирает активность из двух флагов"]);
      const twice = tool("bar", "components/ZzCard");
      expect(twice).toMatch(/^ {4}A1 для `components\/ZzCard`: чисто, а свидетель говорит иначе: Св2$/m);
      expect(twice).toMatch(/^ {4}A2 для `components\/ZzCard`: чисто, а свидетель говорит иначе: Св2$/m);
      // «Чисто» стоит на фразе единицы, «нет предмета» при живом свидетеле ложно.
      setRow("Св2", [null, "да", null, null, "нет"]);
      setOutcome("A1", "чисто |  | Св2 — служит |");
      setOutcome("B5", "нет предмета |  | имён нет |");
      const loose = tool("bar", "components/ZzCard");
      expect(loose).toMatch(/^ {4}A1 для `components\/ZzCard`: чисто без опоры на фразу единицы: назвать Св1$/m);
      expect(loose).toMatch(/^ {4}B5: нет предмета, а свидетели есть: Св2, Св3, Св4$/m);
      // Свидетель не отменяет опоры на модель: ответственность из карты —
      // строка её уровня.
      const duty = /^\| (П\d+) \| ответственность \|/m.exec(read)[1];
      setOutcome("A1", "чисто |  | Св1 — один вопрос, " + duty + " — карта о том же, Св2–Св4 служат ему |");
      setOutcome("B5", "чисто |  | Св2–Св4 — имена говорят |");
      expect(tool("bar", "components/ZzCard")).toContain("печать поставлена");

      // Правленый файл гасит свидетелей о нём: они описывают прежний код.
      fs.appendFileSync(at, "export const zzMore = () => ZZ_LIMIT;\n");
      tool("bar", "components/ZzCard");
      const again = fs.readFileSync(protoAt, "utf8");
      expect(again).toContain("| Св1 | `components/ZzCard` | строк кода `8`; файлов `1`; полей состояния `0` |  |  |  | полей меньше двух |");
      expect(again).toContain("| Св2 | `components/ZzCard/ZzCard.tsx:1` | `zzActive` |  |  |  |  |  |");
      expect(again).toContain("| Св5 | `components/ZzCard/ZzCard.tsx:8` | `zzMore` |  |  |  |  | входов меньше двух |");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("на правке объявление получает свидетеля, только если правка его коснулась", () => {
    const box = seatEmpty("witness3-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const at = path.join(box, "src", "shared", "zzMath", "zzMath.ts");
      fs.mkdirSync(path.dirname(at), { recursive: true });
      const body = (third) =>
        [
          "export const zzAdd = (a: number, b: number): number => a + b;",
          "",
          "export const zzSub = (a: number, b: number): number => {",
          "  return a - b;",
          "};",
          "",
          "export const zzMul = (a: number, b: number): number => " + third + ";",
          "",
        ].join("\n");
      fs.writeFileSync(at, body("a * b"));
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      // Правка тела одной функции — свидетель у неё одной; фраза единицы есть.
      fs.writeFileSync(at, body("b * a"));
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const one = fs.readFileSync(protoAt, "utf8");
      expect(one).toContain("| Св1 | `shared/zzMath` |");
      expect(one).toContain("| Св2 | `shared/zzMath/zzMath.ts:7` | `zzMul` |");
      expect(one).not.toContain("`zzAdd`");
      expect(one).not.toContain("`zzSub`");
      // Правка внутри тела, а не в строке объявления, — тоже касание.
      fs.writeFileSync(at, body("a * b").replace("  return a - b;", "  return a - b - 0;"));
      fs.rmSync(protoAt);
      tool("bar");
      const two = fs.readFileSync(protoAt, "utf8");
      expect(two).toContain("| Св2 | `shared/zzMath/zzMath.ts:3` | `zzSub` |");
      expect(two).not.toContain("`zzMul`");
      // Новый файл тронут целиком: свидетель у каждого его объявления.
      fs.writeFileSync(at, body("a * b"));
      fs.writeFileSync(
        path.join(path.dirname(at), "zzPow.ts"),
        "export const zzSquare = (a: number): number => a * a;\nexport const zzCube = (a: number): number => a * a * a;\n",
      );
      fs.rmSync(protoAt);
      tool("bar");
      const fresh = fs.readFileSync(protoAt, "utf8");
      expect(fresh).toContain("`zzSquare`");
      expect(fresh).toContain("`zzCube`");
      fs.rmSync(path.join(path.dirname(at), "zzPow.ts"));
      // Задача чтения — свидетели всех объявлений.
      fs.rmSync(protoAt);
      tool("bar", "shared/zzMath");
      const read = fs.readFileSync(protoAt, "utf8");
      for (const name of ["zzAdd", "zzSub", "zzMul"]) expect(read).toContain("`" + name + "`");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("свидетель отвечает за свою единицу, а не за соседку по правке", () => {
    const box = seatEmpty("witness2-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      for (const [name, body] of [
        ["ZzCard", "export function ZzCard() {\n  return 'card';\n}\nexport const zzAudit = () => 'log';\n"],
        ["ZzTag", "export function ZzTag() {\n  return 'tag';\n}\n"],
      ]) {
        const at = path.join(box, "src", "components", name, name + ".tsx");
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, body);
      }
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components");
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { "узел@components/ZzCard": "нет" },
      });
      const text = fs.readFileSync(protoAt, "utf8");
      const idOf = (name) =>
        new RegExp("^\\| (Св\\d+) \\| `[^`]+` \\| `" + name + "` \\|", "m").exec(text)[1];
      // Объявление карточки не служит её фразе — находка карточки; ответ
      // «чисто» о метке стоит на её свидетелях и принимается.
      const audit = idOf("zzAudit");
      fs.writeFileSync(
        protoAt,
        text
          .split("\n")
          .map((line) => {
            if (line.startsWith("| " + audit + " |")) {
              const c = line.split("|");
              c[5] = " нет ";
              return c.join("|");
            }
            const c = line.split("|");
            return c.length === 9 && c[1].trim() === "A1" && c[2].includes("components/ZzCard")
              ? "| A1 | " + c[2].trim() + " | x | нашлось | `src/components/ZzCard/ZzCard.tsx:4` | журнал аудита — вторая ответственность | предложено |"
              : line;
          })
          .join("\n"),
      );
      const sealed = tool("bar", "components");
      expect(sealed).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("страницы чтения в своде по планке", () => {
  it("слово каждой страницы, правка гасит слова своих страниц, новый протокол — новая соль", () => {
    const box = seatEmpty("pages-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      put(
        "src/components/ZzNote/ZzNote.tsx",
        'import { zzTrim } from "../../shared/zzText/zzText";\nexport function ZzNote({ text }: { text: string }) {\n  return zzTrim(text);\n}\n',
      );
      // Сосед, у которого предмет берёт: в срезе — объявление взятого.
      put(
        "src/shared/zzText/zzText.ts",
        'export const zzPad = (s: string) => " " + s;\nexport const zzOther = "other";\n\n\nexport const zzTrim = (s: string) => s.trim();\n',
      );
      put(
        "src/app/zzPage.ts",
        'const zzHead = "head";\nconst zzFill = "fill";\n\nimport { ZzNote } from "../components/ZzNote/ZzNote";\n\nconst zzGap = "gap";\nexport const zzPage = () => zzHead + ZzNote({ text: zzFill }) + zzGap;\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzNote");
      const text = fs.readFileSync(protoAt, "utf8");
      const rows = [...text.matchAll(/^\| (\d+) \| ([^|]+) \|  \|$/gm)].map((m) => [m[1], m[2].trim()]);
      // Тела критериев, весь предмет, срез соседа: строки, где он берёт
      // предмет, с соседними.
      // Тела только тех критериев, на которые отвечает сессия: лозунг (A8) и
      // замеренная беспредметность (A5-бис — парных копий нет) разрывают
      // диапазон, и страница их тел не печатает.
      expect(rows[0][1]).toMatch(/^политика: `A1`–`A5`, `A5-тер`–`A7`, `A9`–/);
      const first = tool("bar-read", "1");
      expect(first).not.toContain("**A8.");
      expect(first).not.toContain("**A5-бис.");
      // Диапазон — все тела между концами, а не одни концы.
      for (const id of ["A1", "A2", "A4", "A5", "A5-тер", "A7"]) expect(first).toContain("**" + id + ". ");
      const code = rows.find(([, spec]) => spec.startsWith("код "));
      expect(code[1]).toBe("код `components/ZzNote/ZzNote.tsx`, строки 1–4");
      const near = rows.filter(([, spec]) => spec.startsWith("сосед ")).map(([, spec]) => spec);
      // Строки 4 и 7 берут предмет; с соседними — с третьей по седьмую. У
      // соседа, у которого предмет берёт, — объявление взятого с соседней.
      expect(near).toEqual([
        "сосед `app/zzPage.ts`, строки 3–7",
        "сосед `shared/zzText/zzText.ts`, строки 4–5",
      ]);
      expect(tool("bar-read", "1")).toContain("**A1. Узел отвечает на один вопрос.** (узел)");
      const page = tool("bar-read", code[0]);
      expect(page).toContain("   3 |   return zzTrim(text);");
      const word = /^--- слово страницы \d+: (\S+) ---$/m.exec(page)[1];
      expect(word).toMatch(/^[а-яё]+-[а-яё]+$/);

      // Пустое слово и чужое слово — дыры с номером страницы; верное слово в
      // сообщение не идёт.
      fillBar(protoAt, { release: "не нужно: проба" });
      const wrong = word === "берег-берег" ? "ветер-ветер" : "берег-берег";
      const swap = (from, to) =>
        fs.writeFileSync(
          protoAt,
          fs
            .readFileSync(protoAt, "utf8")
            .replace("| " + code[0] + " | " + code[1] + " | " + from + " |", "| " + code[0] + " | " + code[1] + " | " + to + " |"),
        );
      swap(word, wrong);
      const off = tool("bar", "components/ZzNote");
      expect(off).toContain(
        "страница " + code[0] + " (" + code[1] + "): слово не сходится — страница изменилась либо не прочитана: graph.mjs bar-read " + code[0],
      );
      expect(off).not.toContain(word);
      swap(wrong, "");
      expect(tool("bar", "components/ZzNote")).toContain(
        "страница " + code[0] + " (" + code[1] + "): слово не вписано — graph.mjs bar-read " + code[0],
      );
      swap("", word);
      expect(tool("bar", "components/ZzNote")).toContain("печать поставлена");

      // Правка меняет слово своей страницы и только его: соль та же.
      put(
        "src/components/ZzNote/ZzNote.tsx",
        'import { zzTrim } from "../../shared/zzText/zzText";\nexport function ZzNote({ text }: { text: string }) {\n  return zzTrim(text).toUpperCase();\n}\n',
      );
      tool("bar", "components/ZzNote");
      const after = tool("bar", "components/ZzNote");
      expect(after).toContain("страница " + code[0] + " (" + code[1] + "): слово не сходится");
      expect(after).not.toMatch(/страница 1 \(политика/);

      // Новый протокол — новая соль: вчерашнее слово страницу не открывает.
      const salt = /^- соль чтения: `([0-9a-f]+)`$/m.exec(fs.readFileSync(protoAt, "utf8"))[1];
      fs.rmSync(protoAt);
      tool("bar", "components/ZzNote");
      expect(/^- соль чтения: `([0-9a-f]+)`$/m.exec(fs.readFileSync(protoAt, "utf8"))[1]).not.toBe(salt);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("вывод инструмента в канал доходит целиком", () => {
  // Читающий берёт вывод из канала не сразу: оболочка ждёт две секунды, и за
  // это время инструмент успевает всё напечатать и выйти. Без блокирующего
  // потока `process.exit()` обрывал недописанное, и до читающего доходил
  // один буфер канала — последние страницы со своими словами терялись. На
  // Windows канал устроен иначе, и оболочки с паузой там нет.
  it.skipIf(process.platform === "win32")(
    "все страницы чтения доходят до медленного читающего",
    () => {
      const box = seatEmpty("pipe-");
      try {
        const graph = path.join(box, ".claude", "tools", "graph.mjs");
        const at = path.join(box, "src", "components", "ZzNote", "ZzNote.tsx");
        fs.mkdirSync(path.dirname(at), { recursive: true });
        // Предмет длинный: его страницы кода вместе с телами критериев
        // больше буфера канала с запасом.
        const rows = Array.from({ length: 1200 }, (_, k) => "export const zzLine" + k + ' = "строка ' + k + '";');
        fs.writeFileSync(at, rows.join("\n") + "\n");
        try {
          execFileSync(process.execPath, [graph, "bar", "components/ZzNote"], {
            cwd: box,
            stdio: "ignore",
          });
        } catch {
          // Протокол напечатан, печати нет — так и ждут: читать его страницы.
        }
        const out = execFileSync("sh", ["-c", '"$0" "$1" bar-read | (sleep 2; cat)', process.execPath, graph], {
          cwd: box,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        });
        expect(Buffer.byteLength(out)).toBeGreaterThan(64 * 1024);
        expect(out).toContain("Слово снимают, прочитав страницу, а не программой.");
      } finally {
        fs.rmSync(box, { recursive: true, force: true });
      }
    },
    300000,
  );
});

describe("таблица, переехавшая из объявленного файла, — не копия", () => {
  it("прежний адрес таблицы сверок в настройке называется переездом, а не копией", () => {
    const box = seatEmpty("twin-");
    try {
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const clean = fs.readFileSync(cfg, "utf8");
      const from = 'file: "../.claude/tools/checks.md",';
      expect(clean.split(from).length).toBe(2);
      // Настройка проекта, не обновлённая после переезда таблицы.
      fs.writeFileSync(cfg, clean.replace(from, 'file: "../.claude/rules/base-format.md",'));
      let out = "";
      try {
        out = execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "verify"], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        out = String(e.stdout ?? "");
      }
      expect(out).toMatch(
        /\.claude\/tools\/checks\.md:\d+ — таблица, объявленная в (?:\.\.\/)?\.claude\/rules\/base-format\.md, лежит здесь, а там её нет\. Поправить поле настройки, а не снимать таблицу/,
      );
      expect(out).not.toContain("копия таблицы, объявленной в");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("файл читается один раз, а не на каждое имя или якорь", () => {
  // Счёт работы, а не время: время зависит от машины, а число чтений файла
  // предмета — нет. Модуль, подгруженный перед инструментом, считает чтения
  // файла предмета. Прежде постоянство доводов перечитывало и разбирало файл
  // на каждое его имя, а сверка якорей — на каждый якорь: работа росла как
  // квадрат длины файла.
  const withCounter = (box) => {
    const counter = path.join(box, "zz-count-reads.mjs");
    fs.writeFileSync(
      counter,
      [
        'import fs from "node:fs";',
        'import { syncBuiltinESMExports } from "node:module";',
        "let reads = 0;",
        "const real = fs.readFileSync;",
        "fs.readFileSync = function (file, ...rest) {",
        '  if (typeof file === "string" && file.endsWith("ZzWide.ts")) reads += 1;',
        "  return real.call(this, file, ...rest);",
        "};",
        "syncBuiltinESMExports();",
        'process.on("exit", () => process.stderr.write("ZZ_READS=" + reads + "\\n"));',
        "",
      ].join("\n"),
    );
    const at = path.join(box, "src", "shared", "zzWide", "ZzWide.ts");
    fs.mkdirSync(path.dirname(at), { recursive: true });
    // Файл в `count` имён, свод по нему, затем `mode` со счётчиком чтений.
    return (count, mode) => {
      const rows = Array.from({ length: count }, (_, k) => "export const zzLine" + k + " = " + k + ";");
      fs.writeFileSync(at, rows.join("\n") + "\n");
      fs.rmSync(path.join(box, ".context", "bar-protocol.md"), { force: true });
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      if (mode !== "bar") spawnSync(process.execPath, [graph, "bar", "shared/zzWide"], { cwd: box, encoding: "utf8" });
      const got = spawnSync(
        process.execPath,
        ["--import", counter, graph, ...(mode === "bar" ? ["bar", "shared/zzWide"] : [mode])],
        { cwd: box, encoding: "utf8" },
      );
      return Number(/ZZ_READS=(\d+)/.exec(got.stderr ?? "")?.[1] ?? "-1");
    };
  };

  it("свод: число чтений файла предмета не растёт с числом его имён", () => {
    const box = seatEmpty("reads-");
    try {
      const readsFor = withCounter(box);
      const few = readsFor(50, "bar");
      const many = readsFor(600, "bar");
      // Свод дошёл до модели: иначе чтений мало в обоих прогонах, и тест
      // проходил бы на упавшем инструменте.
      const protocol = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8");
      expect(protocol).toMatch(/^\| П1 \| /m);
      expect(protocol).toContain("zzLine599");
      expect(few).toBeGreaterThan(0);
      expect(many - few).toBeLessThan(10);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("сверка базы: число чтений файла не растёт с числом якорей на него", () => {
    const box = seatEmpty("anchors-");
    try {
      const readsFor = withCounter(box);
      // Протокол свода называет строку каждого объявления: на файл в `600`
      // имён — `600` якорей.
      const few = readsFor(50, "verify");
      const many = readsFor(600, "verify");
      const protocol = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8");
      expect(protocol).toContain("`shared/zzWide/ZzWide.ts:600`");
      expect(few).toBeGreaterThan(0);
      expect(many - few).toBeLessThan(10);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

const readdirOf = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".md"));

describe("проба планки из нескольких файлов", () => {
  it("посаженное против направления слоёв свод называет, суд засчитывает", () => {
    const box = seatEmpty("probaur-");
    let sandbox = null;
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const all = JSON.parse(fs.readFileSync(probes, "utf8"));
      const one = all.plants.find((p) => p.criterion === "A5" && Array.isArray(p.create));
      expect(one).toBeDefined();
      fs.writeFileSync(probes, JSON.stringify({ ...all, plants: [one] }));
      const run = (cwd, ...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args],
            { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const planted = run(box, "bar-probe");
      sandbox = /песочница: (.+)/.exec(planted)?.[1]?.trim() ?? null;
      const id = /bar-probe (\d+)/.exec(planted)?.[1] ?? null;
      expect(sandbox).not.toBeNull();
      expect(id).not.toBeNull();
      // Все файлы посадки лежат в песочнице.
      for (const c of one.create)
        expect(fs.existsSync(path.join(sandbox, "src", c.path))).toBe(true);
      run(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      // Модель показывает ребро против правила — «чисто» по направлению
      // невозможно без суждения.
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/\| направление \|[^\n]*\| против правила \|/);
      fs.appendFileSync(
        path.join(sandbox, ".context", "13-questions.md"),
        "\nВопрос о `src/shared/zzPlantLabel/zzPlantLabel.ts`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { "слой@shared": "нет" },
        pick: {
          "A5@shared": "нашлось | src/shared/zzPlantLabel/zzPlantLabel.ts:1 | общий слой берёт из приложения | вопрос",
        },
      });
      expect(run(sandbox, "bar")).toContain("печать поставлена");
      expect(run(box, "bar-probe", id)).toContain("исход: поймано");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }, 240000);
});

describe("проба планки в существующем коде", () => {
  it("нарушение дописано в живые файлы среди обычной правки, свод его называет, суд засчитывает", () => {
    const box = seatEmpty("probaex-");
    let sandbox = null;
    let markAt = null;
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const all = JSON.parse(fs.readFileSync(probes, "utf8"));
      const one = all.plants.find((p) => p.criterion === "C4" && Array.isArray(p.into));
      expect(one).toBeDefined();
      fs.writeFileSync(probes, JSON.stringify({ ...all, plants: [one] }));
      // Два файла без имён посадки — с импортом наверху; прочие файлы кода
      // эти имена уже несут, и посадка обязана их обойти.
      for (const [rel, text] of [
        ["src/shared/zzA/zzA.ts", 'import { useMemo } from "react";\n\nexport const zzA = (n: number): number => n + 1;\n'],
        ["src/shared/zzB/zzB.ts", 'import { useMemo } from "react";\n\nexport const zzB = (n: number): number => n - 1;\n'],
        ["src/components/ZzC/ZzC.tsx", "export function ZzC() {\n  return 'c';\n}\n"],
        ["src/components/ZzD/ZzD.tsx", "export function ZzD() {\n  return 'd';\n}\n"],
        ["src/components/ZzE/ZzE.tsx", "export function ZzE() {\n  return 'e';\n}\n"],
      ]) {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      }
      const codeUnder = (dir) =>
        fs.readdirSync(path.join(box, dir), { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? e.name === "tests"
              ? []
              : codeUnder(dir + "/" + e.name)
            : /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")
              ? [dir + "/" + e.name]
              : [],
        );
      const busy = codeUnder("src").filter((rel) => !/\/zz[AB]\.ts$/.test(rel));
      expect(busy.length).toBeGreaterThanOrEqual(3);
      for (const rel of busy)
        fs.appendFileSync(
          path.join(box, rel),
          "\nexport const visitLog = 0;\nexport const recordVisit = (): string => \"busy\";\n",
        );
      const run = (cwd, ...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args],
            { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      // Род «новым файлом» флагом отсекается: сажать нечего.
      expect(run(box, "bar-probe", "--new")).toContain("=== Сажать нечего ===");
      const planted = run(box, "bar-probe", "--existing", "--seed=11");
      sandbox = /песочница: (.+)/.exec(planted)?.[1]?.trim() ?? null;
      const id = /bar-probe (\d+)/.exec(planted)?.[1] ?? null;
      expect(sandbox).not.toBeNull();
      markAt = path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json");
      const mark = JSON.parse(fs.readFileSync(markAt, "utf8"));
      expect(mark.kind).toBe("в существующем коде");
      // Виновник берёт у владельца путём, который посадка вычислила сама, и
      // ещё один файл получил обычную правку.
      const culprit = mark.files[0];
      const text = fs.readFileSync(culprit, "utf8");
      // Импорт — к импортам файла, наверх; тело — с типами, как пишут вокруг.
      expect(text.split("\n")[1]).toMatch(/^import \{ visitLog \} from "[^"]+";$/);
      expect(text).toContain("export const recordVisit = (name: string): void => {");
      expect(text).not.toMatch(/zzProbe/);
      const spec = /import \{ visitLog \} from "([^"]+)";/.exec(text)[1];
      const owner = ["", ".ts", ".tsx"]
        .map((ext) => path.resolve(path.dirname(culprit), spec) + ext)
        .find((f) => fs.existsSync(f));
      expect(fs.readFileSync(owner, "utf8")).toContain("export const visitLog = { count: 0, names: [] as string[] };");
      // Файлы, где имя посадки уже было, она обошла.
      expect([culprit, owner].map((f) => path.basename(f)).sort()).toEqual(["zzA.ts", "zzB.ts"]);
      for (const rel of busy)
        expect(fs.readFileSync(path.join(sandbox, rel), "utf8").match(/visitLog/g)?.length).toBe(1);
      const changed = execFileSync("git", ["status", "--porcelain"], { cwd: sandbox, encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
      expect(changed.length).toBe(3);
      run(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      const relCulprit = path.relative(path.join(sandbox, "src"), culprit).split(path.sep).join("/");
      // Признак, видимый текстом, называет правку взятого импортом.
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        new RegExp("\\| мутация \\| `" + relCulprit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + ":\\d+` \\|"),
      );
      const parts = relCulprit.split("/");
      const unit = parts.length >= 3 ? parts.slice(0, 2).join("/") : relCulprit;
      const line = text.split("\n").findIndex((l) => l.includes("visitLog.names.push")) + 1;
      fs.appendFileSync(
        path.join(sandbox, ".context", "13-questions.md"),
        "\nВопрос о `src/" + relCulprit + "`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { ["узел@" + unit]: "нет" },
        pick: {
          ["C4@" + unit]: "нашлось | src/" + relCulprit + ":" + line + " | меняет чужой реестр, взятый импортом | вопрос",
        },
      });
      expect(run(sandbox, "bar")).toContain("печать поставлена");
      // Суд сличает виновника ПУТЁМ: тот же протокол против одноимённого
      // файла в другой папке — адрес другой, а не «поймано».
      const twin = sandbox + "-двойник";
      fs.cpSync(sandbox, twin, { recursive: true });
      const twinMark = path.join(os.tmpdir(), "bar-probe-" + id + "9.plant.json");
      const elsewhere = path.join(twin, "src", "zzElsewhere", path.basename(culprit));
      fs.writeFileSync(
        twinMark,
        JSON.stringify({ ...mark, box: twin, file: elsewhere, files: [elsewhere] }),
      );
      expect(run(box, "bar-probe", id + "9")).toContain("исход: критерий назван, адрес другой");
      fs.rmSync(twin, { recursive: true, force: true });
      const judged = run(box, "bar-probe", id);
      expect(judged).toContain("исход: поймано");
      expect(judged).toContain("в существующем коде: проб 2, поймано 1");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
      if (markAt !== null) fs.rmSync(markAt, { force: true });
    }
  }, 240000);
});

describe("проба планки: зерно", () => {
  it("одно зерно — одна и та же посадка", () => {
    const box = seatEmpty("probaseed-");
    const boxes = [];
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const all = JSON.parse(fs.readFileSync(probes, "utf8"));
      for (let k = 0; k < 6; k += 1) {
        const rel = "src/components/ZzS" + k + "/ZzS" + k + ".tsx";
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), "export function ZzS" + k + "() {\n  return " + k + ";\n}\n");
      }
      const run = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const plantOnce = () => {
        const out = run("bar-probe", "--existing", "--seed=5");
        const sandbox = /песочница: (.+)/.exec(out)[1].trim();
        const id = /bar-probe (\d+)/.exec(out)[1];
        boxes.push(sandbox, path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json"));
        const mark = JSON.parse(fs.readFileSync(boxes[boxes.length - 1], "utf8"));
        const changed = execFileSync("git", ["status", "--porcelain"], { cwd: sandbox, encoding: "utf8" })
          .split("\n")
          .filter(Boolean)
          .sort()
          .join(";");
        return mark.criterion + "|" + path.relative(sandbox, mark.files[0]) + "|" + changed;
      };
      const first = plantOnce();
      for (let k = 0; k < 3; k += 1) expect(plantOnce()).toBe(first);
      expect(all.plants.length).toBeGreaterThan(1);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      for (const one of boxes) fs.rmSync(one, { recursive: true, force: true });
    }
  }, 240000);
});

describe("факты по уровням без протокола", () => {
  it("по адресу печатает уровни, по проекту — требует назвать каждый факт", () => {
    const box = seatEmpty("levels-");
    try {
      const tool = (...args) => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      fs.writeFileSync(
        path.join(box, "src", "app", "zzA.ts"),
        'import { zzB } from "./zzB";\nexport const zzA = (): number => zzB() + 1;\n',
      );
      fs.writeFileSync(
        path.join(box, "src", "app", "zzB.ts"),
        'import { zzA } from "./zzA";\nexport const zzB = (): number => (zzA.length > 0 ? 1 : 0);\n',
      );
      const one = tool("levels", "app/zzA.ts");
      expect(one.code).toBe(0);
      expect(one.out).toContain("--- узел ---");
      expect(one.out).toContain("--- слой ---");
      expect(one.out).toContain("--- приложение ---");
      expect(one.out).toMatch(/цикл: app\/zzA\.ts → app\/zzB\.ts → app\/zzA\.ts/);
      const all = tool("levels");
      expect(all.code).toBe(1);
      expect(all.out).toMatch(/цикл: [^\n]*— НЕ НАЗВАН/);
      // Запись, назвавшая один файл цикла, факта не называет: прежде её
      // хватало, и строка про что угодно в одном из концов держала цикл.
      const regAt = path.join(box, ".context", "16-findings.md");
      const head =
        "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n";
      const reg0 = fs.readFileSync(regAt, "utf8");
      fs.writeFileSync(
        regAt,
        reg0.replace(
          head,
          head + "| 1 | линт в `src/app/zzA.ts` | проба | — | нечем | открыта |\n",
        ),
      );
      const half = tool("levels");
      expect(half.out).toMatch(/цикл: [^\n]*— НЕ НАЗВАН/);
      expect(half.code).toBe(1);
      // Названы оба файла одной строкой — факт принят, код ноль.
      fs.writeFileSync(
        regAt,
        reg0.replace(
          head,
          head +
            "| 1 | цикл `src/app/zzA.ts` и `src/app/zzB.ts` | проба | — | нечем | открыта |\n",
        ),
      );
      const named = tool("levels");
      expect(named.out).toMatch(/цикл: [^\n]*— назван: /);
      expect(named.code).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("факт без записи роняет сверку базы; папку без входа называют одной записью", () => {
    const box = seatEmpty("fakt-");
    try {
      const tool = (...args) => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, "src", ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      const loose = () =>
        (verifyIn(box).get("Архитектурный факт назван записью") ?? []).join("\n");
      // Два компонента пишут один ключ хранилища сами: второй писатель.
      for (const name of ["ZzA", "ZzB"])
        put(
          "components/" + name + "/" + name + ".tsx",
          "export function " +
            name +
            '() {\n  return <button onClick={() => window.localStorage.setItem("zz.count", "1")}>x</button>;\n}\n',
        );
      const two = tool("levels");
      expect(two.code).toBe(1);
      expect(two.out).toMatch(/писатель: хранилище «zz\.count»: пишут components\/ZzA\/ZzA\.tsx, components\/ZzB\/ZzB\.tsx — НЕ НАЗВАН/);
      // Перехода нет — факт без записи роняет и прогон сверки базы.
      expect(loose()).toMatch(/писатель: хранилище «zz\.count»/);
      // Решение, назвавшее все файлы факта, его держит.
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nПроба: `src/components/ZzA/ZzA.tsx` и `src/components/ZzB/ZzB.tsx` пишут один ключ — порядок записи объявлен.\n",
      );
      expect(tool("levels").out).toMatch(/«zz\.count»[^\n]*— назван: /);
      expect(loose()).not.toMatch(/«zz\.count»/);
      // Внутренность папки без входа называют одной записью о папке, а не по
      // записи на каждого, кто в неё ходит.
      put("components/ZzC/zzInner.ts", "export const zzInner = 1;\n");
      put("components/ZzD/ZzD.tsx", 'import { zzInner } from "../ZzC/zzInner";\n\nexport const ZzD = () => zzInner;\n');
      put("components/ZzE/ZzE.tsx", 'import { zzInner } from "../ZzC/zzInner";\n\nexport const ZzE = () => zzInner;\n');
      expect(loose()).toMatch(/ZzD\.tsx → components\/ZzC\/zzInner\.ts — внутренность единицы переноса components\/ZzC, у которой входа нет/);
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nПроба: у папки `src/components/ZzC/` входа нет — берут внутренность.\n",
      );
      expect(loose()).not.toMatch(/ZzC/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("свод отказывает политике, у критерия которой не назван уровень", () => {
    const box = seatEmpty("bezurovnya-");
    try {
      const policy = path.join(box, ".claude", "rules", "quality.md");
      fs.writeFileSync(
        policy,
        fs
          .readFileSync(policy, "utf8")
          .replace("**H7. Магических чисел нет.** (единица)", "**H7. Магических чисел нет.**"),
      );
      fs.writeFileSync(path.join(box, "src", "app", "zzN.ts"), "export const zzN = 1;\n");
      let out = "";
      try {
        execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "bar", "app/zzN.ts"], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        out = String(e.stdout ?? "");
      }
      expect(out).toContain("у критерия не назван уровень: H7");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

describe("предложенное сводом держит строка о критерии и файле", () => {
  it("строка реестра о том же критерии в другом файле находку не закрывает", () => {
    const box = seatEmpty("predlozheno-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzA.ts"),
        "export const zzA = 1;\n",
      );
      fs.writeFileSync(
        path.join(box, ".context", "bar-protocol.md"),
        "# Свод\n\n| критерий | о чём | исход | адрес | что | судьба |\n| --- | --- | --- | --- | --- | --- |\n| E1 | проба | нашлось | src/app/zzA.ts:1 | проба | предложено |\n",
      );
      const regAt = path.join(box, ".context", "16-findings.md");
      const reg = fs.readFileSync(regAt, "utf8");
      const withRow = (where) =>
        fs.writeFileSync(
          regAt,
          reg.replace(
            "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n",
            "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n| 1 | «E1» в `" +
              where +
              "` | проба | — | нечем | открыта |\n",
          ),
        );
      const loose = () =>
        (verifyIn(box).get("Предложенное сводом названо находкой") ?? []).join("\n");
      withRow("src/app/zzB.ts");
      expect(loose()).toContain("E1 — предложено сводом и не названо");
      withRow("src/app/zzA.ts");
      expect(loose()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("мутационный отчёт без исполненных тестов — не замер", () => {
  it("выживший под покрытием при нуле исполненных тестов в реестр не пишется", () => {
    const box = seatEmpty("mutslep-");
    try {
      const at = path.join(box, "src", "app", "zzMut.ts");
      fs.writeFileSync(at, "export const zzMut = (n: number) => n + 1;\n");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      const cfg = fs.readFileSync(cfgAt, "utf8");
      const reportAt = cfg.match(/mutationReport: "([^"]+)"/)[1];
      const stryAt = cfg.match(/mutationConfig: "([^"]+)"/)[1];
      fs.writeFileSync(
        path.join(box, ".context", stryAt),
        JSON.stringify({ mutate: ["src/app/zzMut.ts"] }),
      );
      const report = (testsCompleted) => ({
        config: { mutate: ["src/app/zzMut.ts"] },
        files: {
          "src/app/zzMut.ts": {
            mutants: [
              { status: "Survived", coveredBy: ["t1"], testsCompleted },
            ],
          },
        },
      });
      const write = (r) => {
        const out = path.join(box, ".context", reportAt);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(
          out,
          "<script>app.report = " + JSON.stringify(r) + ";</script>",
        );
      };
      const tool = () => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), "mutated"],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const ledgerAt = path.join(
        box,
        ".context",
        cfg.match(/mutationLedger: "([^"]+)"/)[1],
      );
      write(report(0));
      expect(tool()).toContain("Отчёт мутационного прогона — не замер");
      expect(fs.existsSync(ledgerAt) ? fs.readFileSync(ledgerAt, "utf8") : "").not.toContain("zzMut");
      write(report(3));
      expect(tool()).not.toContain("не замер");
      expect(fs.readFileSync(ledgerAt, "utf8")).toContain("zzMut");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("ворота перед коммитом в конвейере", () => {
  it("свежий клон без `core.hooksPath` красен у разработчика и зелен в конвейере, где коммитов не делают", () => {
    const box = seatEmpty("konveier-");
    try {
      execFileSync("git", ["init", "-q"], { cwd: box, stdio: "ignore" });
      const gate = (env) => {
        let out;
        try {
          out = execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env },
          );
        } catch (e) {
          out = String(e.stdout ?? "");
        }
        return out.split("=== Ворота перед коммитом установлены ===")[1]?.split("===")[0] ?? "";
      };
      const { CI: _ci, ...local } = process.env;
      expect(gate(local)).toContain("`core.hooksPath` не задан");
      const piped = gate({ ...local, CI: "true" });
      expect(piped).not.toMatch(/^ {4}\S/m);
      expect(piped).toContain("конвейер");
      // Хук, который git пропустит, красен и в конвейере: это содержимое
      // репозитория, а не настройка машины.
      const hook = path.join(box, ".claude", "hooks", "git", "pre-commit");
      fs.chmodSync(hook, 0o644);
      expect(gate({ ...local, CI: "true" })).toContain("не исполняемый");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("скрипт манифеста назван и командой с доводами", () => {
  it("`npm run имя -- …` называет скрипт; не названный нигде — предупреждение", () => {
    const box = seatEmpty("skripty-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts["zz-probe"] = "node -e 0";
      pkg.scripts["zz-silent"] = "node -e 0";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      fs.appendFileSync(
        path.join(box, "CLAUDE.md"),
        "\n| Проба по файлам | `npm run zz-probe -- --only <файлы>` |\n",
      );
      const said = (
        verifyIn(box).get("Скрипты манифеста описаны (предупреждение, прогон не роняет)") ?? []
      ).join("\n");
      expect(said).not.toContain("zz-probe —");
      expect(said).toContain("zz-silent —");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("реестр мутаций считает так же, как отчёт, который читает", () => {
  it("мутант с ошибкой раннера не живой; файл, заказанный прогоном и не давший мутантов, промерен", () => {
    const box = seatEmpty("mutschet-");
    try {
      const app = path.join(box, "src", "app");
      fs.writeFileSync(
        path.join(app, "zzMut.ts"),
        "export const zzMut = (n: number) => n + 1;\n",
      );
      fs.writeFileSync(path.join(app, "zzQuiet.ts"), "export const ZZ_QUIET = 1;\n");
      fs.writeFileSync(path.join(app, "zzOther.ts"), "export const ZZ_OTHER = 2;\n");
      const cfg = fs.readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8");
      fs.writeFileSync(
        path.join(box, ".context", cfg.match(/mutationConfig: "([^"]+)"/)[1]),
        JSON.stringify({ mutate: ["src/app/**/*.ts", "!src/**/tests/**"] }),
      );
      // Прогон по файлам правки: своя область отчёта уже области конфига.
      const out = path.join(box, ".context", cfg.match(/mutationReport: "([^"]+)"/)[1]);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const mutant = (status) => ({ status, coveredBy: ["t1"], testsCompleted: 1 });
      fs.writeFileSync(
        out,
        "<script>app.report = " +
          JSON.stringify({
            config: { mutate: ["src/app/zzMut.ts", "src/app/zzQuiet.ts"] },
            files: {
              "src/app/zzMut.ts": {
                mutants: ["Killed", "Survived", "RuntimeError", "CompileError", "Ignored"].map(mutant),
              },
            },
          }) +
          ";</script>",
      );
      const said = execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "mutated",
          "src/app/zzMut.ts",
          "src/app/zzQuiet.ts",
          "src/app/zzOther.ts",
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(said).toContain("zzMut.ts — 50.00 %, живых 1");
      expect(said).toContain("zzQuiet.ts — мутировать нечего");
      // Не заказанный прогоном файл промеренным не становится.
      const never = said.split("Под мутациями не были ни разу:")[1] ?? "";
      expect(never.split("Измерено")[0]).toContain("zzOther.ts");
      expect(never.split("Измерено")[0]).not.toContain("zzQuiet.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("граф по именам: сквозь бочку до объявления", () => {
  it("радиус, зависимости и тесты считаются по взятым именам, а не по строке импорта", () => {
    const box = seatEmpty("imena-");
    try {
      const kit = path.join(box, "src", "shared", "zzKit");
      const app = path.join(box, "src", "app");
      fs.mkdirSync(kit, { recursive: true });
      fs.mkdirSync(path.join(app, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(kit, "core.ts"),
        "export async function zzCore() {\n  return 1;\n}\n",
      );
      fs.writeFileSync(
        path.join(kit, "other.ts"),
        "export const zzOther = () => 2;\n",
      );
      // Бочка отдаёт оба имени: одно звёздочкой, второе поимённо.
      fs.writeFileSync(
        path.join(kit, "index.ts"),
        'export * from "./core.js";\nexport { zzOther } from "./other.js";\n',
      );
      fs.writeFileSync(
        path.join(app, "zzUse.ts"),
        'import { zzCore } from "../shared/zzKit/index.js";\nexport const zzUse = () => zzCore();\n',
      );
      // Берёт из той же бочки СОСЕДНЕЕ имя — от `core.ts` не зависит.
      fs.writeFileSync(
        path.join(app, "zzSide.ts"),
        'import { zzOther } from "../shared/zzKit/index.js";\nexport const zzSide = () => zzOther();\n',
      );
      fs.writeFileSync(
        path.join(app, "tests", "zzUse.test.ts"),
        'import { expect, it } from "vitest";\nimport { zzUse } from "../zzUse.js";\nit("zz", async () => expect(await zzUse()).toBe(1));\n',
      );
      const run = (...args) =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );

      const core = run("brief", "shared/zzKit/core.ts");
      const users = sectionOf(core, "пользуются им");
      expect(users).toContain("app/zzUse.ts");
      expect(users).not.toContain("app/zzSide.ts");
      expect(users).toContain("наружу отдают бочки: shared/zzKit/index.ts");
      expect(sectionOf(core, "гоняют через узлы")).toContain(
        "app/tests/zzUse.test.ts  → app/zzUse.ts",
      );

      const use = run("brief", "app/zzUse.ts");
      expect(sectionOf(use, "импортирует")).toContain(
        "shared/zzKit/core.ts  (через shared/zzKit/index.ts)",
      );

      expect(run("plan", "shared/zzKit/core.ts")).toContain(
        "--- радиус: прямых 1, транзитивно 1 ---",
      );
      const tested = run("tested", "src/shared/zzKit/core.ts");
      expect(tested).not.toContain("ни один тест на это не смотрит");
      expect(tested).toContain("app/tests/zzUse.test.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Один вопрос — один ответ, и для файлов, и для пакетов. Свой конфиг раннера
 * затеняет конфиг сборщика: семя, легшее рядом нетронутым, не действует. Пакет
 * платформы рядом со своей заменой — два компилятора на один вопрос. Замерено
 * посадкой в библиотеку на `sass` со своим `vitest.config.ts`.
 */
describe("семя рядом с затеняющим конфигом и пакет платформы рядом с заменой", () => {
  it("нетронутое семя и вторая замена красны, законная пара — нет", () => {
    const box = seatEmpty("zatenen-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      fs.writeFileSync(
        path.join(box, "vitest.config.ts"),
        'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: {} });\n',
      );
      pkg.devDependencies.sass = "^1.89.2";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const red = verifyIn(box);
      expect(
        (red.get("Один предмет — один файл настройки") ?? []).join("\n"),
      ).toContain("vite.config.ts лежит семенем, а читают vitest.config.ts");
      expect(
        (red.get("Пакет платформы не второй ответ") ?? []).join("\n"),
      ).toContain("sass-embedded рядом с sass");

      const vite = path.join(box, "vite.config.ts");
      fs.writeFileSync(vite, fs.readFileSync(vite, "utf8") + "// build\n");
      delete pkg.devDependencies["sass-embedded"];
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const green = verifyIn(box);
      expect(green.get("Один предмет — один файл настройки")).toBeUndefined();
      expect(green.get("Пакет платформы не второй ответ")).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Что git игнорирует, проекту не принадлежит: сгенерированный сборкой лист
 * стилей в корпусе давал ложные «мёртвые классы». Замерено на библиотеке,
 * чья сборка пишет листы рядом с исходниками: `44` ложных находки.
 */
describe("игнорируемое git в корпус сверок не входит", () => {
  it("однострочное правило читается, а игнорируемый git лист в корпус не входит", () => {
    const box = seatEmpty("ignored-");
    try {
      execFileSync("git", ["init", "-q"], { cwd: box });
      fs.mkdirSync(path.join(box, "src", "gen"), { recursive: true });
      fs.writeFileSync(
        path.join(box, "src", "gen", "zzGen.css"),
        ".zzGenerated { color: red; }\n",
      );
      const seen = verifyIn(box);
      expect(
        (seen.get("Класс из листа стилей спрошен кодом") ?? []).join("\n"),
      ).toContain("zzGenerated");
      fs.appendFileSync(path.join(box, ".gitignore"), "\nsrc/gen/\n");
      const hidden = verifyIn(box);
      expect(
        (hidden.get("Класс из листа стилей спрошен кодом") ?? []).join("\n"),
      ).not.toContain("zzGenerated");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Документ находится от указателя: его называет указатель либо на него ведёт
 * ссылка из документа, до которого указатель доводит, — в том числе маршрутом
 * сайта документации. Прежде смотрелся один верхний уровень папки, и вложенные
 * документы не проверялись ничем: замерено на библиотеке, где так лежали `16`
 * документов из `23`, и один из них не находился ниоткуда.
 */
describe("указатель документации доводит и до вложенных документов", () => {
  it("вложенный документ без пути к нему назван, с маршрутом из названного — нет", () => {
    const box = seatEmpty("ukazatel-");
    try {
      fs.mkdirSync(path.join(box, "docs", "guide"), { recursive: true });
      fs.writeFileSync(path.join(box, "docs", "guide", "deep.md"), "# Deep\n");
      const lost = verifyIn(box);
      expect(
        (lost.get("Документы названы в указателе") ?? []).join("\n"),
      ).toContain("guide/deep.md");
      fs.writeFileSync(
        path.join(box, "docs", "guide.md"),
        "# Guide\n\n- [Deep](/guide/deep) - one level down\n",
      );
      const facts = path.join(box, ".context", "01-facts.md");
      const row = "| что продукт умеет — списком возможностей | `FEATURES.md` |";
      fs.writeFileSync(
        facts,
        fs
          .readFileSync(facts, "utf8")
          .replace(row, row + "\n| как пройти по шагам | `guide.md` |"),
      );
      const found = verifyIn(box);
      expect(found.get("Документы названы в указателе")).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Воротами служит описание, которое собирает проект, то есть зовёт его
 * менеджер пакетов. Публикация документации запросом и запирание обсуждений
 * чужим действием проекта не касаются, и проверок с них не спрашивают.
 * Замерено на библиотеке: из пяти описаний два проекта не собирали.
 */
describe("конвейер спрашивается только с описаний, собирающих проект", () => {
  it("описание без менеджера пакетов в стороне, сборка без проверок красна", () => {
    const box = seatEmpty("konveier-");
    try {
      const wf = path.join(box, ".github", "workflows");
      fs.mkdirSync(wf, { recursive: true });
      fs.writeFileSync(
        path.join(wf, "lock.yml"),
        "on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  lock:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: dessant/lock-threads@v6\n",
      );
      fs.writeFileSync(
        path.join(wf, "build.yml"),
        "on: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          cache: npm\n      - run: npm ci\n      - run: npm run build\n",
      );
      const found = (
        verifyIn(box).get("Конвейер зовёт проверки") ?? []
      ).join("\n");
      expect(found).toContain("build.yml");
      expect(found).not.toContain("lock.yml");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Сверки перехода спрашивали НАЛИЧИЕ записи, а не её правду. Правды машине не
 * узнать, кроме той, что она видит сама: строка карты, сказавшая «нет» в графе
 * состояния или эффектов у файла, где они есть, неверна без суждения.
 * Замерено на карте библиотеки, собранной переходом: `3` отрицания из `104`.
 */
describe("запись карты не спорит с кодом", () => {
  it("отрицание состояния у файла с состоянием красно, описание — нет", () => {
    const box = seatEmpty("karta-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzCounter.ts"),
        'import { useState } from "react";\nexport const useZz = () => useState(0);\n',
      );
      const map = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |";
      const had = fs.readFileSync(map, "utf8");
      expect(had).toContain(head);
      fs.writeFileSync(
        map,
        had.replace(
          head,
          head + "\n| `src/app/zzCounter.ts` | счётчик | нет | нет |",
        ),
      );
      expect(
        (verifyIn(box).get("Запись карты не спорит с кодом") ?? []).join("\n"),
      ).toContain("zzCounter.ts: карта говорит «нет» в графе состояния");
      fs.writeFileSync(
        map,
        had.replace(
          head,
          head + "\n| `src/app/zzCounter.ts` | счётчик | число нажатий | нет |",
        ),
      );
      expect(verifyIn(box).get("Запись карты не спорит с кодом")).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Переход читает весь код и сразу собирает знание, а расхождения проекта с
 * правилами обвязки записывает долгом перехода с планом. Долг печатается
 * списком для каждого отчёта, у каждого пункта есть держатель, и отступление
 * от умолчания пункт объявляет наравне с решением.
 */
describe("долг перехода: список, держатель, отступление долгом", () => {
  it("режим печатает список, пункт без держателя красен, раскладка долгом объявлена", () => {
    const box = seatEmpty("dolgperehoda-");
    try {
      fs.mkdirSync(path.join(box, "src", "zzOwn"), { recursive: true });
      fs.writeFileSync(
        path.join(box, "src", "zzOwn", "zzThing.ts"),
        "export const zzThing = 1;\n",
      );
      const stray = () =>
        (verifyIn(box).get("Новый узел лежит по раскладке") ?? []).join("\n");
      expect(stray()).toContain("zzThing.ts");
      withTransitionDebt(box, [
        "| 1 | Раскладка проекта своя: код в `src/zzOwn/` | `1` | «Новый узел лежит по раскладке» | перенести `src/zzOwn/zzThing.ts` в `src/shared/own/` | `1` файл |",
        "| 2 | Проба без держателя | `1` | когда-нибудь | ничего | `0` |",
      ]);
      const found = verifyIn(box);
      expect(found.get("Новый узел лежит по раскладке")).toBeUndefined();
      expect(
        (found.get("Шаги перехода закрывают измерение") ?? []).join("\n"),
      ).toContain("пункт долга 2 не называет, что его держит");
      const said = execFileSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "transition"],
        { cwd: box, encoding: "utf8" },
      );
      expect(said).toContain("ДОЛГ ПЕРЕХОДА");
      expect(said).toContain("1 — Раскладка проекта своя — сейчас: 1");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Цена ярусов входа считается по КАЖДОМУ классу таблицы ярусов доктрины.
 * Список классов в режиме был зашит, и ярус удаления, дописанный в доктрину,
 * остался без цены и в режиме, и в семени фактов — замерено замером цены на
 * стенде-библиотеке.
 */
describe("цена ярусов: классы берутся из таблицы доктрины", () => {
  it("каждый класс посчитан; неизвестный класс роняет режим", () => {
    const box = seatEmpty("yarusy-");
    try {
      const tool = path.join(box, ".claude", "tools", "graph.mjs");
      const run = () => {
        try {
          return {
            status: 0,
            out: execFileSync(process.execPath, [tool, "tiers"], {
              cwd: box,
              encoding: "utf8",
            }),
          };
        } catch (e) {
          return { status: e.status, out: String(e.stdout ?? "") };
        }
      };
      const loopAt = path.join(box, ".claude", "rules", "loop.md");
      const loop = fs.readFileSync(loopAt, "utf8");
      const lines = loop.split("\n");
      const head = lines.findIndex((l) => l.startsWith("| Класс задачи |"));
      const classes = [];
      for (let i = head + 2; lines[i].startsWith("|"); i += 1)
        classes.push(lines[i].split("|")[1].trim());
      expect(classes.length).toBeGreaterThan(5);
      const clean = run();
      expect(clean.status).toBe(0);
      for (const one of classes) expect(clean.out).toContain(one + " — ");
      expect(clean.out).not.toContain("В таблице фактов нет строки");
      const at = head + 2 + classes.length;
      lines.splice(at, 0, "| Проба нового класса | что-то | то же |");
      fs.writeFileSync(loopAt, lines.join("\n"));
      const extra = run();
      expect(extra.status).toBe(1);
      expect(extra.out).toContain("Состав яруса инструменту не известен: Проба нового класса");
      expect(extra.out).toContain("В таблице фактов нет строки: Проба нового класса");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Файл узла держит модульным объявлением только сам узел. Правило стояло в
 * доктрине без крючка, и переход живого проекта не мог записать такой долг:
 * держать пункт было нечем — замерено переходом библиотеки.
 */
describe("файл узла держит только сам узел", () => {
  it("объявление рядом с узлом названо, обёрнутая функция и типы — нет, долг держит числом", () => {
    const box = seatEmpty("uzelfayl-");
    try {
      const dir = path.join(box, "src", "components", "ZzLone");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "ZzLone.tsx"),
        [
          'import { memo } from "react";',
          "type ZzProps = { size: number };",
          "const zzExtra = 1;",
          "function ZzLoneInner(props: ZzProps) {",
          "  return props.size + zzExtra;",
          "}",
          "export const ZzLone = memo(ZzLoneInner);",
          "",
        ].join("\n"),
      );
      const said = () =>
        (verifyIn(box).get("В файле узла только сам узел") ?? []).join("\n");
      const found = said();
      expect(found).toContain("`zzExtra`");
      expect(found).not.toContain("ZzLoneInner");
      expect(found).not.toContain("ZzProps");
      withTransitionDebt(box, [
        "| 1 | Объявления рядом с узлом | `1` | «В файле узла только сам узел» | перенести `zzExtra` в `src/components/ZzLone/constants/` | `1` объявление |",
      ]);
      expect(said()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Конфиг звена у живого проекта лежит под своим именем, а линт обёрнут
 * храповиком долга. Сверка опоры звена искала конфиг только семенным именем,
 * а сверка заготовок брала область у обёртки, а не у линтера, — обе молчали
 * на поломке. Замерено прогоном рецептов на стенде-библиотеке.
 */
describe("конфиг звена под своим именем и линт под храповиком", () => {
  it("опора звена и исключение заготовок спрашиваются и тогда", () => {
    const box = seatEmpty("svoeimya-");
    try {
      fs.renameSync(
        path.join(box, "eslint.config.mjs"),
        path.join(box, "eslint.config.js"),
      );
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts.lint = "node .claude/tools/graph.mjs lint -- " + pkg.scripts.lint;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const clean = verifyIn(box);
      for (const s of [
        "Звену цепочки есть на чём работать",
        "Заготовки обвязки не разбираются линтом проекта",
      ])
        expect([s, clean.get(s) ?? []]).toEqual([s, []]);
      const cfgAt = path.join(box, "eslint.config.js");
      fs.writeFileSync(
        cfgAt,
        fs.readFileSync(cfgAt, "utf8").replace('      ".claude",\n', ""),
      );
      expect(
        (verifyIn(box).get("Заготовки обвязки не разбираются линтом проекта") ?? []).join("\n"),
      ).toContain("eslint.config.js");
      pkg.scripts.lint = "npm run lint --workspaces --if-present";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      expect(
        (verifyIn(box).get("Звену цепочки есть на чём работать") ?? []).join("\n"),
      ).toContain("eslint.config.js — конфиг звена «lint»");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Номер записи в заголовке — «### Пункт 10. …», «## Вопрос 12. …» — нумерация,
 * а не счёт, и ссылка на такой раздел ёлочками тоже. Двузначный номер со
 * словом из списка счёта за ним краснел — замерено планом перехода стенда.
 */
describe("номер записи в заголовке не счёт", () => {
  it("заголовок и ссылка на него молчат, счёт в прозе краснеет", () => {
    const box = seatEmpty("nomer-");
    try {
      const todo = path.join(box, ".context", "02-todo.md");
      fs.appendFileSync(
        todo,
        "\n### Пункт 10. Файл узла\n\nПлан — раздел «Пункт 10. Файл узла».\n",
      );
      const said = () =>
        (verifyIn(box).get("Числа в прозе базы") ?? []).join("\n");
      expect(said()).toBe("");
      fs.appendFileSync(todo, "\nОсталось 10 файлов.\n");
      expect(said()).toContain("02-todo.md");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Находки прогона обвязки на мини-стенде: посадка, переход и две работы
 * по слову пользователя. Каждая — поломка, которую прежде не ловило ничто,
 * а ловил человек, проходивший процесс руками.
 */
describe("находки мини-стенда: факты, долг, отложенное, перенос", () => {
  const toolAt = (box) => (...args) => {
    try {
      return {
        code: 0,
        out: execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (e) {
      return { code: e.status, out: String(e.stdout ?? "") };
    }
  };
  const write = (box, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
    fs.writeFileSync(path.join(box, rel), text);
  };
  const edit = (box, rel, from, to) => {
    const at = path.join(box, rel);
    const had = fs.readFileSync(at, "utf8");
    expect(had).toContain(from);
    fs.writeFileSync(at, had.replace(from, to));
  };
  // Общий слой берёт компонент, корень композиции — файл узла без бочки.
  const layered = (box) => {
    write(
      box,
      "src/components/zzA/zzA.tsx",
      "export const ZZ_STEP = 1;\n\nexport function ZzA() {\n  return <b>{ZZ_STEP}</b>;\n}\n",
    );
    write(
      box,
      "src/shared/zzs/zzs.ts",
      'import { ZZ_STEP } from "../../components/zzA/zzA";\n\nexport const zzs = (): number => ZZ_STEP;\n',
    );
    write(
      box,
      "src/app/zzApp.tsx",
      'import { ZzA } from "../components/zzA/zzA";\n\nexport const ZzApp = () => <ZzA />;\n',
    );
    edit(
      box,
      ".context/00-map.md",
      "| `shared` | `app` |  |",
      "| `shared` | `app`, `components` |  |",
    );
  };

  it("вход узла без бочки — файл узла; ребро держит запись, назвавшая оба конца", () => {
    const box = seatEmpty("ministend-");
    try {
      layered(box);
      const tool = toolAt(box);
      // Файл узла, названный как папка, при отсутствии бочки — вход.
      expect(tool("levels").out).not.toMatch(/граница: app\/zzApp\.tsx/);
      write(box, "src/components/zzA/index.ts", 'export { ZzA } from "./zzA";\n');
      expect(tool("levels").out).toMatch(/граница: app\/zzApp\.tsx → components\/zzA\/zzA\.tsx/);
      fs.rmSync(path.join(box, "src/components/zzA/index.ts"));
      // Ребро против правила красно, пока его не назовёт запись с ОБОИМИ концами.
      expect(verifyIn(box).get("Правила направления")).toEqual([
        "shared/zzs/zzs.ts → components/zzA/zzA.tsx",
      ]);
      withTransitionDebt(box, [
        "| 1 | Линт в `src/shared/zzs/zzs.ts` | `1` | «lint» | снять | `1` место |",
      ]);
      expect(verifyIn(box).get("Правила направления")).toEqual([
        "shared/zzs/zzs.ts → components/zzA/zzA.tsx",
      ]);
      expect(tool("levels").out).toMatch(/направление: [^\n]*— НЕ НАЗВАН/);
      withTransitionDebt(box, [
        "| 2 | Ребро `src/shared/zzs/zzs.ts` → `src/components/zzA/zzA.tsx` | `1` | «Правила направления» | шаг — параметром | `1` импорт |",
      ]);
      expect(verifyIn(box).get("Правила направления")).toBeUndefined();
      expect(tool("levels").out).toMatch(/направление: [^\n]*— назван: 15-transition\.md/);
      // Ребро к запрещённому ПАКЕТУ: второй конец — имя пакета, и запись
      // без него ребра не держит.
      edit(
        box,
        ".context/00-map.md",
        "| `shared` | `app`, `components` |  |",
        "| `shared` | `app`, `components`, `react` |  |",
      );
      write(box, "src/shared/zzs/zzr.ts", 'import { useId } from "react";\n\nexport const zzr = useId;\n');
      withTransitionDebt(box, [
        "| 3 | Линт в `src/shared/zzs/zzr.ts` | `1` | «lint» | снять | `1` место |",
      ]);
      expect(tool("levels").out).toMatch(/направление: shared\/zzs\/zzr\.ts → react[^\n]*— НЕ НАЗВАН/);
      expect(verifyIn(box).get("Правила направления")).toEqual(["shared/zzs/zzr.ts → react"]);
      withTransitionDebt(box, [
        "| 4 | Общий слой зовёт `react`: `src/shared/zzs/zzr.ts` | `1` | «Правила направления» | убрать | `1` импорт |",
      ]);
      expect(tool("levels").out).toMatch(/направление: shared\/zzs\/zzr\.ts → react[^\n]*— назван/);
      expect(verifyIn(box).get("Правила направления")).toBeUndefined();
      // Новое ребро такой записи не имеет и краснеет.
      write(
        box,
        "src/shared/zzs/zzt.ts",
        'import { ZzA } from "../../components/zzA/zzA";\n\nexport const zzt = ZzA;\n',
      );
      expect(verifyIn(box).get("Правила направления")).toEqual([
        "shared/zzs/zzt.ts → components/zzA/zzA.tsx",
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("пункт про одно описание конвейера другого не держит; номер чужого перечня в отложенном законен", () => {
    const box = seatEmpty("ministend-ci-");
    try {
      const flow = (name) =>
        write(
          box,
          ".github/workflows/" + name,
          "name: b\non: [push]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm run build\n",
        );
      flow("a.yml");
      expect(verifyIn(box).get("Конвейер зовёт проверки")?.length).toBe(1);
      withTransitionDebt(box, [
        "| 1 | Конвейер не зовёт проверок | `1` | «Конвейер зовёт проверки» | `.github/workflows/a.yml` — звать `npm run check` | `1` файл |",
      ]);
      expect(verifyIn(box).get("Конвейер зовёт проверки")).toBeUndefined();
      flow("b.yml");
      const red = verifyIn(box).get("Конвейер зовёт проверки") ?? [];
      expect(red).toHaveLength(1);
      expect(red[0]).toMatch(/^\.github\/workflows\/b\.yml/);
      // Отложенное ссылается на пункт долга перехода — это не его пункт.
      edit(
        box,
        ".context/02-todo.md",
        "Отложенного нет: проект только что посажен, и согласовывать было нечего.",
        "## 1. Проба\n\nГде: `src/app/App.tsx`. Почему отложено: это пункт 10 долга перехода. Чем закроется: пункт 7.",
      );
      expect(verifyIn(box).get("Отложенное без закрытых пунктов")).toEqual([
        expect.stringMatching(/^02-todo\.md:\d+ — пункта 7 там нет$/),
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("протокол прошлой работы в новую не переносится; ушедшая строка модели пересобирает протокол", () => {
    const box = seatEmpty("ministend-perenos-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=m", "-c", "user.email=m@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = toolAt(box);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "seat");
      // Ворота стоят, история есть — основание ревизии обязано быть объявлено.
      execFileSync("git", ["config", "core.hooksPath", ".claude/hooks/git"], { cwd: box });
      const disarmedOf = () => verifyIn(box).get("Сверки, выключенные при живом предмете") ?? [];
      expect(disarmedOf()).toEqual(
        expect.arrayContaining([expect.stringMatching(/CONFIG\.barSince пуст/)]),
      );
      edit(box, ".context/graph.config.mjs", "  barSince: null,", '  barSince: "' + git("rev-parse", "HEAD").trim() + '",');
      expect(disarmedOf().some((one) => one.includes("barSince"))).toBe(false);
      // Состояние даёт модели строку с якорем на строку файла — ту, что
      // досье правки прежде советовало дописать цитатой.
      write(
        box,
        "src/components/zzP/zzP.tsx",
        'import { useState } from "react";\n\nexport function ZzP() {\n  const [on, setOn] = useState(false);\n  return <i onClick={() => setOn(!on)}>p</i>;\n}\n',
      );
      const proto = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      expect(fs.readFileSync(proto, "utf8")).toMatch(/^- строк модели от инструмента: `\d+`$/m);
      fillBar(proto, { release: "нет" });
      expect(tool("bar").out).toContain("печать поставлена");
      // Якоря протокола правят не руками: досье правки их не называет.
      expect(fs.readFileSync(proto, "utf8")).toMatch(/`components\/zzP\/zzP\.tsx:4`/);
      expect(tool("tested").out).not.toMatch(/bar-protocol\.md: `/);
      git("add", "-A");
      git("commit", "-qm", "p");
      write(box, "src/components/zzQ/zzQ.tsx", "export function ZzQ() {\n  return <i>q</i>;\n}\n");
      const next = tool("bar").out;
      expect(next).toContain("протокол напечатан");
      expect(next).not.toContain("исходы перенесены");
      // Переход: строка «граница» ушла из конца модели узла — протокол пересобран.
      layered(box);
      write(box, "src/components/zzA/index.ts", 'export { ZzA } from "./zzA";\n');
      withTransitionDebt(box, []);
      tool("bar", "--transition");
      const appProto = path.join(box, ".context", "15-transition-bar", "node--app--zzApp.tsx.md");
      expect(fs.readFileSync(appProto, "utf8")).toMatch(/\| граница \|/);
      fillBar(appProto, { release: "нет" });
      tool("bar", "--transition");
      fs.rmSync(path.join(box, "src/components/zzA/index.ts"));
      const again = tool("bar", "--transition").out;
      expect(again).toContain("пересобран: 15-transition-bar/node--app--zzApp.tsx.md");
      expect(fs.readFileSync(appProto, "utf8")).not.toMatch(/\| граница \|/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("пункт долга, задетый правкой, чинится: ни «чисто», ни «отложено», пункт правится; чтение без второй записи", () => {
    const box = seatEmpty("ministend-dolg-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=m", "-c", "user.email=m@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = toolAt(box);
      layered(box);
      // Цикл: компонент зовёт общий модуль, а тот берёт у компонента шаг.
      write(
        box,
        "src/components/zzA/zzA.tsx",
        'import { zzs } from "../../shared/zzs/zzs";\n\nexport const ZZ_STEP = 1;\n\nexport function ZzA() {\n  return <b>{ZZ_STEP + zzs()}</b>;\n}\n',
      );
      withTransitionDebt(box, [
        "| 1 | Цикл и ребро против слоёв: `src/shared/zzs/zzs.ts` и `src/components/zzA/zzA.tsx` | `1` | «Правила направления» | развести | `1` импорт |",
        "| 2 | Экспорт без потребителя в `src/components/zzA/zzA.tsx` — H4 «Мёртвого кода нет» | `1` | `graph.mjs bar --transition` | снять | `1` имя |",
      ]);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "seat");
      const proto = path.join(box, ".context", "bar-protocol.md");
      const holes = () => tool("bar").out;

      // Правка задела файл цикла: модель помечает цикл известным дефектом.
      edit(box, "src/components/zzA/zzA.tsx", "<b>", "<i>");
      edit(box, "src/components/zzA/zzA.tsx", "</b>", "</i>");
      tool("bar");
      expect(fs.readFileSync(proto, "utf8")).toMatch(/\| цикл \|[^\n]*\| долг перехода \|/);
      // «Чисто» при нём ложно: пункт долга называет и цикл, и H4 в файле правки.
      fillBar(proto, { release: "нет" });
      let said = holes();
      expect(said).toMatch(/A9-бис[^\n]*чисто, а П\d+ — известный дефект \(долг перехода\): правка его задела/);
      expect(said).toMatch(/H4[^\n]*«нет предмета», а пункт 2 долга перехода называет H4 в `components\/zzA\/zzA\.tsx`/);
      // «Отложено» заводит вторую запись — не принимается ни у факта, ни у пункта.
      fillBar(proto, {
        release: "нет",
        pick: {
          "A9-бис": "нашлось | `src/components/zzA/zzA.tsx:1` | цикл | отложено",
          H4: "нашлось | `src/components/zzA/zzA.tsx:3` | мёртвое имя | отложено",
        },
      });
      said = holes();
      expect(said).toMatch(/A9-бис[^\n]*отложено, а П\d+ — известный дефект \(долг перехода\)/);
      expect(said).toMatch(/H4[^\n]*«отложено», а находка — пункт 2 долга перехода/);
      // «Починено» при неправленом пункте — неправда; правленый пункт — законно.
      fillBar(proto, {
        release: "нет",
        pick: { H4: "нашлось | `src/components/zzA/zzA.tsx:3` | мёртвое имя | починено" },
      });
      expect(holes()).toMatch(/H4[^\n]*«починено», а пункт 2 долга перехода не правлен/);
      edit(box, ".context/15-transition.md", "| `1` | `graph.mjs bar --transition` | снять | `1` имя |", "| `0` | `graph.mjs bar --transition` | снять | `1` имя |");
      expect(holes()).not.toMatch(/пункт 2 долга перехода не правлен/);

      // Чтение: предложенное держит сам пункт долга — второй записи не нужно.
      git("checkout", "-q", "--", ".");
      fs.rmSync(proto, { force: true });
      tool("bar", "src/components/zzA");
      fillBar(proto, {
        release: "нет",
        pick: {
          "A9-бис": "нашлось | `src/components/zzA/zzA.tsx:1` | цикл | предложено",
          H4: "нашлось | `src/components/zzA/zzA.tsx:3` | мёртвое имя | предложено",
          "H6-тер": "нашлось | `src/components/zzA/zzA.tsx:5` | сокращение | предложено",
        },
      });
      const loose = verifyIn(box).get("Предложенное сводом названо находкой") ?? [];
      expect(loose).toHaveLength(1);
      expect(loose[0]).toMatch(/^H6-тер/);

      // Правила направления нет — факт остаётся циклом, и пункт, назвавший
      // его файлы, держит его: сверка не падает на факте без имён пакетов.
      edit(box, ".context/00-map.md", "| `shared` | `app`, `components` |  |", "| `shared` | `app` |  |");
      const whole = tool("verify").out;
      expect(whole).toContain("=== Шаги перехода закрывают измерение ===");
      expect(whole).not.toContain("пункт долга 1 держит факт");
      edit(box, ".context/00-map.md", "| `shared` | `app` |  |", "| `shared` | `app`, `components` |  |");

      // Цикл и ребро починены — пункт, державший их, закрыт и не удалён.
      fs.rmSync(proto, { force: true });
      write(box, "src/shared/zzs/zzs.ts", "export const zzs = (): number => 1;\n");
      const steps = () => verifyIn(box).get("Шаги перехода закрывают измерение") ?? [];
      expect(steps().some((one) => one.includes("пункт долга 1 держит факт, которого в коде нет"))).toBe(true);
      edit(
        box,
        ".context/15-transition.md",
        "| 1 | Цикл и ребро против слоёв: `src/shared/zzs/zzs.ts` и `src/components/zzA/zzA.tsx` | `1` | «Правила направления» | развести | `1` импорт |\n",
        "",
      );
      expect(steps().some((one) => one.includes("пункт долга 1"))).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("тесты обвязки — своей командой, вне прогона проекта", () => {
  it("правка обвязки печатает в досье правки команду её тестов", () => {
    const box = seatEmpty("harness-tests-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=m", "-c", "user.email=m@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tested = () =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "tested"],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "seat");
      expect(tested()).not.toContain("=== Тронута обвязка ===");
      fs.appendFileSync(path.join(box, ".claude", "tools", "graph.md"), "\n");
      expect(tested()).toMatch(
        /=== Тронута обвязка ===\n  файлов инструмента в правке: 1\n[^\n]*\n    npx vitest run --config \.claude\/tools\/vitest\.config\.mjs/,
      );
      // Семя конфига сборщика в прогон проекта обвязку не зовёт.
      const seed = fs.readFileSync(path.join(box, "vite.config.ts"), "utf8");
      expect(seed).toMatch(/include: \["src\/\*\*\/\*\.test\.\{ts,tsx\}"\]/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

describe("признаки по всей планке в модели свода", () => {
  const toolIn = (box) => (...args) => {
    try {
      return execFileSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  /** Строки модели протокола: вид, где, сдвиг, пометка. */
  const modelOf = (box) =>
    [
      ...fs
        .readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8")
        .matchAll(
          /^\| П\d+ \| ([^|]+) \| `([^`]*)` \|[^\n]*?\| ([^|\n]*) \| ([^|\n]*) \| [^|\n]* \| [^|\n]* \|$/gm,
        ),
    ].map((m) => ({
      sort: m[1].trim(),
      where: m[2],
      delta: m[3].trim(),
      mark: m[4].trim(),
    }));
  const has = (rows, sort, mark, where) =>
    rows.some(
      (r) =>
        r.sort === sort &&
        r.mark === mark &&
        (where === undefined || r.where.startsWith(where)),
    );

  it("код, лист стилей и тест дают строки; мёртвый раздел — нет", () => {
    const box = seatEmpty("whole-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      put(
        "src/components/ZzPanel/ZzPanel.tsx",
        [
          'import { useState } from "react";',
          "",
          "// workaround for the double render",
          "export function ZzPanel({ items }: { items: string[] }) {",
          "  const [open, setOpen] = useState(false);",
          "  const load = async () => {",
          '    const res = await fetch("/zz");',
          "    setOpen(res.ok);",
          "  };",
          "  return (",
          "    <div onClick={load}>",
          "      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>",
          "      {open && <p>{items.length}</p>}",
          "    </div>",
          "  );",
          "}",
          "",
        ].join("\n"),
      );
      put("src/components/ZzPanel/ZzPanel.css", ".zzPanel { color: red !important; }\n");
      put(
        "src/components/ZzPanel/tests/ZzPanel.test.tsx",
        [
          'import { it, vi } from "vitest";',
          'import { ZzPanel } from "../ZzPanel";',
          "// the panel is mocked so the list stays empty",
          'vi.mock("../ZzPanel");',
          'it("renders", () => {',
          "  ZzPanel({ items: [] });",
          "});",
          "",
        ].join("\n"),
      );
      tool("bar", "components/ZzPanel");
      const rows = modelOf(box);
      for (const [sort, mark] of [
        ["комментарий", "предупреждение"],
        ["имя", "булево"],
        ["имя", "сокращение"],
        ["внешнее", "сеть"],
        ["разметка", ""],
        ["гонка", "без отмены"],
        ["список", "ключ по позиции"],
        ["доступность", "не кнопка"],
        ["тест", "подмена"],
        ["тест", "без утверждения"],
        ["тесты", ""],
      ])
        expect(has(rows, sort, mark), sort + "/" + mark).toBe(true);
      // Тест — тоже код: его комментарий встаёт строкой, как комментарий модуля.
      expect(
        has(rows, "комментарий", "", "components/ZzPanel/tests/ZzPanel.test.tsx:3"),
      ).toBe(true);
      // Раздел стилей объявлен неприменимым: о листе не спросит ни один
      // живой критерий, и строки о нём в модели нет.
      expect(rows.some((r) => r.sort === "стиль")).toBe(false);
      const facts = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        facts,
        fs
          .readFileSync(facts, "utf8")
          .replace("| O. Стили и адаптивность | нет |", "| O. Стили и адаптивность | да |"),
      );
      tool("bar", "components/ZzPanel");
      expect(
        has(modelOf(box), "стиль", "важнее всех", "components/ZzPanel/ZzPanel.css"),
      ).toBe(true);
      // «Чисто» без номера строки признака — вопрос без ответа.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { H3: "чисто |  | комментарии в порядке | " },
      });
      expect(tool("bar", "components/ZzPanel")).toMatch(
        /H3: чисто, а в предмете есть комментарии, и в основании не сказано, что каждый прошёл четыре вопроса: П\d+/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });

  it("парная копия и повторённое условие — строками модели", () => {
    const box = seatEmpty("twin-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      const rule = [
        "export const zzAllowed = (account: { isAdmin: boolean; isActive: boolean }): boolean => {",
        "  if (account.isAdmin && account.isActive) return true;",
        "  return false;",
        "};",
        "",
      ].join("\n");
      put("src/shared/zzLeft/zzRule.ts", rule);
      put("src/shared/zzRight/zzRule.ts", rule);
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const was = fs.readFileSync(cfg, "utf8");
      expect(was.split("  forks: [],").length).toBe(2);
      fs.writeFileSync(
        cfg,
        was.replace("  forks: [],", '  forks: [{ from: "shared/zzLeft", to: "shared/zzRight" }],'),
      );
      tool("bar", "shared/zzLeft/zzRule.ts");
      const rows = modelOf(box);
      expect(has(rows, "близнец", "", "shared/zzLeft/zzRule.ts")).toBe(true);
      expect(has(rows, "повтор", "условие", "shared/zzLeft/zzRule.ts:2")).toBe(true);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });

  it("мутационный замер файла: не мерен, устарел, оставил выживших", () => {
    const box = seatEmpty("mutrow-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      put("src/shared/zzMut/zzMut.ts", "export const zzMut = (n: number) => n + 1;\n");
      put(
        "src/shared/zzMut/tests/zzMut.test.ts",
        'import { expect, it } from "vitest";\nimport { zzMut } from "../zzMut";\nit("adds", () => {\n  expect(zzMut(1)).toBe(2);\n});\n',
      );
      const cfg = fs.readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8");
      fs.writeFileSync(
        path.join(box, ".context", cfg.match(/mutationConfig: "([^"]+)"/)[1]),
        JSON.stringify({ mutate: ["src/shared/zzMut/zzMut.ts"] }),
      );
      const ledgerAt = path.join(box, ".context", cfg.match(/mutationLedger: "([^"]+)"/)[1]);
      const markOf = () =>
        modelOf(box).find((r) => r.sort === "мутации")?.mark ?? "строки нет";
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("не мерено");
      fs.writeFileSync(
        ledgerAt,
        JSON.stringify({ "src/shared/zzMut/zzMut.ts": { killed: 3, alive: 0, hash: "000000000000" } }),
      );
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("устарело");
      const stamp = createHash("sha1")
        .update(fs.readFileSync(path.join(box, "src", "shared", "zzMut", "zzMut.ts"), "utf8"))
        .digest("hex")
        .slice(0, 12);
      fs.writeFileSync(
        ledgerAt,
        JSON.stringify({ "src/shared/zzMut/zzMut.ts": { killed: 3, alive: 2, hash: stamp } }),
      );
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("выжили");
      // Чистый замер на нынешнем содержимом — вопроса нет, и строки нет.
      fs.writeFileSync(
        ledgerAt,
        JSON.stringify({ "src/shared/zzMut/zzMut.ts": { killed: 5, alive: 0, hash: stamp } }),
      );
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("строки нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });

  it("граф: повтор, постоянный довод, тесты, союз, приглушение, зависимость", () => {
    const box = seatEmpty("graph-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const block = [
        "  const total = values.reduce((sum, one) => sum + one.weight, 0);",
        "  const ready = values.filter((one) => one.weight > limit && one.enabled);",
        "  const names = ready.map((one) => one.name.trim().toLowerCase());",
        "  const unique = names.filter((name, at) => names.indexOf(name) === at);",
        "  const share = unique.length / Math.max(total, 1);",
        "  return { total, unique, share };",
      ];
      const shape = "values: { weight: number; enabled: boolean; name: string }[], limit: number";
      put(
        "src/shared/zzMath/zzMath.ts",
        [
          "export const zzScale = (value: number, factor: number) => value * factor;",
          "export const zzSum = (" + shape + ") => {",
          ...block,
          "};",
          "export const zzFrame = (step: FrameRequestCallback) => requestAnimationFrame(step);",
          "",
        ].join("\n"),
      );
      put(
        "src/shared/zzMath/zzCopy.ts",
        ["export const zzOther = (" + shape + ") => {", ...block, "};", ""].join("\n"),
      );
      put(
        "src/app/zzUse.ts",
        [
          'import { zzScale } from "../shared/zzMath/zzMath";',
          "export const zzA = (a: number) => zzScale(a, 2);",
          "export const zzB = (b: number) => zzScale(b, 2);",
          "",
        ].join("\n"),
      );
      fs.appendFileSync(
        path.join(box, ".context", "00-map.md"),
        [
          "",
          "## Проба союза",
          "",
          "| Файл | Отвечает за | Состояние | Эффекты |",
          "| --- | --- | --- | --- |",
          "| `src/shared/zzMath/zzMath.ts` | масштабирует значения и считает сводку | нет | нет |",
          "",
        ].join("\n"),
      );
      tool("bar", "shared/zzMath/zzMath.ts");
      const text = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8");
      const rows = modelOf(box);
      expect(has(rows, "повтор", "", "shared/zzMath/zzMath.ts")).toBe(true);
      expect(text).toMatch(/повторены в `shared\/zzMath\/zzCopy\.ts:\d+`/);
      expect(text).toMatch(/zzScale\(…\): довод 2 всегда `2`, мест вызова `2`/);
      expect(has(rows, "тесты", "нет")).toBe(true);
      expect(has(rows, "ответственность", "союз")).toBe(true);
      // Кадры есть, а приглушённого движения нет нигде в проекте.
      expect(has(rows, "приглушение", "нет", "проект")).toBe(true);

      // Правка, добавившая зависимость диапазоном, спрашивает о ней.
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.dependencies = { ...(pkg.dependencies ?? {}), "zz-lib": "^1.0.0" };
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      fs.appendFileSync(path.join(box, "src", "app", "zzUse.ts"), "export const zzC = 3;\n");
      tool("bar");
      expect(has(modelOf(box), "зависимость", "диапазон")).toBe(true);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

describe("чем держится каждый критерий планки", () => {
  it("матрица сходится и краснеет на каждой из восьми поломок", () => {
    const box = seatEmpty("hold-");
    try {
      const vocab = path.join(box, ".claude", "tools", "graph.predicates.mjs");
      const clean = fs.readFileSync(vocab, "utf8");
      const run = () => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), "bar-hold"],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      const ok = run();
      expect(ok.code).toBe(0);
      expect(ok.out).toContain("у каждого критерия есть решение, чем он держится");
      expect(ok.out).toMatch(
        /^\| B4 \| единица \| вопрос модели: кортеж \| вопрос модели \| объект с полями «на всякий случай»; [^|]+ \| (?:—|\d+(?:, поймано)?) \|$/m,
      );
      expect(ok.out).toMatch(/^\| H3 \| единица \| [^|]+ \| сверка \| закрыто \| /m);
      // Общая форма о тестовом файле: у числа без имени она есть, у
      // доступности — раздела о продукте — нет.
      expect(ok.out).toMatch(/^\| H7 \| [^\n]*нарушение внутри тестового файла/m);
      expect(ok.out).not.toMatch(/^\| P4 \| [^\n]*нарушение внутри тестового файла/m);
      // Свидетель — ступень, где сессия отвечает, а машина проверяет форму.
      expect(ok.out).toMatch(/^\| B5 \| единица \| свидетель \| свидетель \| /m);
      // Итог по ступеням сходится с графой опоры строка в строку.
      const grips = [...ok.out.matchAll(/^\| [A-U][0-9][^|]* \| [^|]+ \| [^|]+ \| ([^|]+) \| /gm)].map(
        (m) => m[1].trim(),
      );
      const count = (...kinds) => grips.filter((g) => kinds.includes(g)).length;
      expect(ok.out).toContain(
        "  по самой сильной опоре: машина решает — " +
          count("сверка") +
          "; машина находит, сессия судит — " +
          count("вопрос модели") +
          "; сессия отвечает, машина проверяет форму — " +
          count("свидетель", "ядро") +
          "; одно внимание — " +
          count("вниманием") +
          "; лозунгов — " +
          count("лозунг"),
      );
      expect(count("сверка", "вопрос модели", "свидетель", "ядро", "вниманием", "лозунг")).toBe(
        Number(/осмотрено критериев планки: (\d+)/.exec(ok.out)?.[1]),
      );
      expect(ok.out).toMatch(/^  формы вне держателя: \d+ у \d+ критериев; закрытых наборов: 1 из \d+/m);
      const broken = (from, to) => {
        expect(clean.split(from).length, from).toBe(2);
        fs.writeFileSync(vocab, clean.replace(from, to));
        const got = run();
        fs.writeFileSync(vocab, clean);
        expect(got.code).toBe(1);
        return got.out;
      };
      // Критерий без держателя и без записанной причины.
      expect(
        broken('  S1: "способ узнать об отказе в бою живёт вне предмета, у проекта он один",\n', ""),
      ).toContain("S1: нет решения, чем держится");
      // Данные называют критерий, которого в политике нет.
      expect(
        broken('  J2: "правило о правилах', '  Z8: "нет такого",\n  J2: "правило о правилах'),
      ).toContain("Z8: данные называют критерий, которого в политике нет");
      // Внимание записано при машинном держателе.
      expect(
        broken('  J2: "правило о правилах', '  B4: "лишняя запись",\n  J2: "правило о правилах'),
      ).toContain("B4: записано вниманием, а держатель есть");
      // Названной сверки нет.
      expect(
        broken('  U3: ["Точечные исключения линта", "Выключения правил линта"],', '  U3: ["Исключения, которых нет"],'),
      ).toContain("«Исключения, которых нет»: сверки с таким названием нет");
      // Машинный держатель без решения, каких форм он не видит.
      expect(broken("  F1: [UNSEEN.resource],\n", "")).toContain(
        "F1: нет решения, каких форм нарушения держатель не видит",
      );
      // Формы записаны у критерия, которого держит одно внимание.
      expect(
        broken("  F1: [UNSEEN.resource],", '  F1: [UNSEEN.resource],\n  Q5: ["лишняя форма — лишняя причина"],'),
      ).toContain("Q5: формы вне держателя записаны у критерия, которого держит одно внимание");
      // Набор закрыт, а строки критерия о тестовом файле не встают.
      expect(
        broken(
          '  H7: [\n    "число, присвоенное имени без смысла',
          '  H7: "закрыто: проба",\n  "zz-H7": [\n    "число, присвоенное имени без смысла',
        ),
      ).toContain("H7: набор закрыт, а строки критерия о тестовом файле не встают");
      // Решение записано не по форме: форма без причины.
      expect(broken("  F1: [UNSEEN.resource],", '  F1: ["форма без причины"],')).toContain(
        "F1: решение о формах записано не по форме: форма без причины",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

/**
 * Гарантия поведения — то, что продукт обещает пользователю, с тестом,
 * который это держит. Тест закрепляет то, что написал его автор; обещанное
 * не было записано нигде, и снятый тест обещания не ронял ничего.
 */
describe("гарантия поведения держится тестом", () => {
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  const HEAD =
    "| Гарантия | Род | Что наблюдают | Источник | Узлы | Тест |\n| --- | --- | --- | --- | --- | --- |\n";
  const promise = (box, rows) => {
    const at = path.join(box, ".context", "05-flows.md");
    fs.writeFileSync(
      at,
      fs.readFileSync(at, "utf8").replace(HEAD, HEAD + rows.map((r) => r + "\n").join("")),
    );
  };
  const badge = (put) => {
    put(
      "src/components/ZzBadge/ZzBadge.tsx",
      'export function ZzBadge({ label }: { label: string }) {\n  return <span>{label}</span>;\n}\n',
    );
    put(
      "src/components/ZzBadge/tests/ZzBadge.test.tsx",
      'import { it } from "vitest";\nimport { ZzBadge } from "../ZzBadge";\n\nit("zz badge shows its label", () => {\n  ZzBadge({ label: "x" });\n});\n',
    );
  };
  const ROW =
    "| REQ-1 | должно | на значке видна подпись | разработчик, 2026-10-04 | `components/ZzBadge/ZzBadge.tsx` | `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label» |";
  // Та же строка с другим источником: остальные графы верны, и красное — о нём.
  const sourced = (source) => ROW.replace("разработчик, 2026-10-04", source);

  it("тест, снятый с гарантии, висящий номер и витрина без гарантии краснеют; верная строка — нет", () => {
    const box = seatEmpty("garant-");
    try {
      const put = putIn(box);
      badge(put);
      promise(box, [ROW]);
      expect(verifyIn(box).get("Гарантия держится тестом")).toBeUndefined();

      // Источник: не назван, путь, которого нет, решение, которого нет, и
      // не дата — краснеют; документ, который есть, и задача трекера — нет.
      const flows = path.join(box, ".context", "05-flows.md");
      const table = fs.readFileSync(flows, "utf8");
      const sourceSays = (source) => {
        fs.writeFileSync(flows, table.replace(ROW, sourced(source)));
        return (verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n");
      };
      expect(sourceSays("")).toContain("REQ-1: источник не назван");
      expect(sourceSays("так задумано")).toContain("REQ-1: источник не назван");
      expect(sourceSays("`docs/zz-spec.md`")).toContain(
        "REQ-1: источника `docs/zz-spec.md` нет на диске",
      );
      expect(sourceSays("ADR-7")).toContain("REQ-1: решения ADR-7 нет");
      expect(sourceSays("разработчик, 2026-02-30")).toContain(
        "REQ-1: «2026-02-30» — не дата",
      );
      // Месяц, которого нет, — не дата, а не обвал сверки.
      expect(sourceSays("разработчик, 2026-13-45")).toContain(
        "REQ-1: «2026-13-45» — не дата",
      );
      put("docs/zz-spec.md", "# Spec\n\nThe badge shows its label.\n");
      expect(sourceSays("`docs/zz-spec.md`")).toBe("");
      expect(sourceSays("#12, `docs/zz-spec.md`")).toBe("");
      fs.writeFileSync(flows, table);

      // Шапка, объявленная без графы источника, не читается вовсе.
      const configAt = path.join(box, ".context", "graph.config.mjs");
      const configWas = fs.readFileSync(configAt, "utf8");
      fs.writeFileSync(
        configAt,
        configWas.replace(
          "| Гарантия | Род | Что наблюдают | Источник | Узлы | Тест |",
          "| Гарантия | Род | Что наблюдают | Узлы | Тест |",
        ),
      );
      expect((verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n")).toContain(
        "таблица гарантий: в объявленной шапке нет граф «Источник»",
      );
      fs.writeFileSync(configAt, configWas);

      // Тест переименован — гарантию не держит ничто.
      put(
        "src/components/ZzBadge/tests/ZzBadge.test.tsx",
        'import { it } from "vitest";\nimport { ZzBadge } from "../ZzBadge";\n\nit("zz badge renders", () => {\n  ZzBadge({ label: "x" });\n});\n',
      );
      expect((verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n")).toContain(
        "REQ-1: в `components/ZzBadge/tests/ZzBadge.test.tsx` нет теста «zz badge shows its label»",
      );
      badge(put);

      // Витрина: строка без номера — находка; номер, которого нет в таблице, — тоже.
      const features = path.join(box, "docs", "FEATURES.md");
      const was = fs.readFileSync(features, "utf8");
      fs.writeFileSync(
        features,
        was + "\n## Behaviour\n\n- Shows a label on a badge (REQ-1)\n- Glows on hover\n- Blinks twice (REQ-9)\n",
      );
      const red = (verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n");
      expect(red).toContain("строка витрины не называет гарантию REQ-n");
      expect(red).toContain("REQ-9: в таблице такой нет");
      expect(red.match(/строка витрины не называет гарантию/g)).toHaveLength(1);

      // Долг гасит строки витрины без номера, а висящий номер — нет: это
      // запись о том, чего нет, а не неописанное.
      const config = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        config,
        fs.readFileSync(config, "utf8").replace("    guarantees: null,", "    guarantees: 1,"),
      );
      const owed = (verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n");
      expect(owed).not.toContain("строка витрины не называет гарантию");
      expect(owed).toContain("REQ-9: в таблице такой нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("оракул теста: ожидание из кода, правленое ожидание и правленый тест гарантии — вопросами J13", () => {
    const box = seatEmpty("oracle-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = putIn(box);
      const badgeAt = "src/components/ZzBadge/ZzBadge.tsx";
      const testAt = "src/components/ZzBadge/tests/ZzBadge.test.tsx";
      put(
        badgeAt,
        'export const ZZ_LABEL = "x";\nexport function ZzBadge({ label }: { label: string }) {\n  return <span>{label}</span>;\n}\n',
      );
      const testText = [
        'import { expect, it } from "vitest";',
        'import { ZzBadge, ZZ_LABEL } from "../ZzBadge";',
        "",
        'it("zz badge shows its label", () => {',
        // Черта в утверждении: образец строки модели её не несёт.
        '  expect(ZzBadge({ label: "x" }).props.children || "").toBe("x");',
        "});",
        "",
        'it("zz badge default", () => {',
        "  expect(ZzBadge({ label: ZZ_LABEL }).props.children).toBe(ZZ_LABEL);",
        "});",
        "",
      ].join("\n");
      put(testAt, testText);
      promise(box, [ROW]);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const rowsOf = () =>
        [
          ...fs
            .readFileSync(protoAt, "utf8")
            .matchAll(
              /^\| (П\d+) \| ([^|]+?) \| `([^`]*)` \| ([^|]*?) \| ([^|]*?) \| ([^|]*?) \| [^|]*? \| [^|]*? \|$/gm,
            ),
        ].map((m) => ({ id: m[1], sort: m[2], where: m[3], what: m[4], delta: m[5], mark: m[6] }));

      // Чтение: ожидаемое из константы проверяемого модуля — строка модели,
      // и «чисто» по J13, не назвавшее её, — вопрос без ответа.
      tool("bar", "components/ZzBadge");
      const fromCode = rowsOf().find((r) => r.sort === "тест" && r.mark === "ожидание из кода");
      expect(fromCode?.where).toBe("components/ZzBadge/tests/ZzBadge.test.tsx:9");
      expect(fromCode?.what).toContain("ZZ_LABEL");
      // Литерал на строке 5 признака не даёт.
      expect(fromCode?.what).not.toContain("строка 5");
      fillBar(protoAt, { release: "не нужно: проба", pick: { J13: "чисто |  | тесты в порядке | " } });
      expect(tool("bar", "components/ZzBadge")).toMatch(
        /J13: чисто, а ожидаемое в тесте взято из проверяемого кода, и в основании не сказано, откуда оно известно независимо от него: П\d+/,
      );
      fs.rmSync(protoAt);

      // Правка: код и ожидание его гарантированного теста сдвинуты вместе.
      put(
        badgeAt,
        'export const ZZ_LABEL = "x";\nexport function ZzBadge({ label }: { label: string }) {\n  return <span>{label.toUpperCase()}</span>;\n}\n',
      );
      put(testAt, testText.replace('.toBe("x");', '.toBe("X");'));
      tool("bar");
      const rows = rowsOf();
      const edited = rows.find((r) => r.sort === "тест" && r.mark === "ожидание правлено");
      expect(edited?.where).toBe("components/ZzBadge/tests/ZzBadge.test.tsx:4");
      expect(edited?.delta).toBe("изменено");
      expect(edited?.what).toContain("строка 5 последнего коммита, тест «zz badge shows its label»");
      const guarded = rows.find((r) => r.sort === "гарантия" && r.mark === "тест правлен");
      expect(guarded?.what).toContain(
        "REQ-1 (должно): утверждения теста components/ZzBadge/tests/ZzBadge.test.tsx «zz badge shows its label» изменены этой работой, а строка гарантии — нет",
      );
      fillBar(protoAt, { release: "не нужно: проба", pick: { J13: "чисто |  | тесты в порядке | " } });
      expect(tool("bar")).toMatch(
        /J13: чисто, а работа изменила утверждения теста гарантии, и в основании не сказано, держит ли он прежнее обещание или строка гарантии изменена той же правкой: П\d+/,
      );
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "    тест правлен: REQ-1 (должно) на значке видна подпись; источник: разработчик, 2026-10-04; тест `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label»",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("гарантия области и новая возможность — строками модели и вопросами J11 и J12", () => {
    const box = seatEmpty("garant-bar-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = putIn(box);
      badge(put);
      promise(box, [ROW]);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Правка узла гарантии и новый компонент рядом.
      put(
        "src/components/ZzBadge/ZzBadge.tsx",
        'export function ZzBadge({ label }: { label: string }) {\n  return <b>{label}</b>;\n}\n',
      );
      put(
        "src/components/ZzChip/ZzChip.tsx",
        'export function ZzChip({ text }: { text: string }) {\n  return <i>{text}</i>;\n}\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const first = fs.readFileSync(protoAt, "utf8");
      expect(first).toMatch(
        /\| гарантия \| `05-flows\.md:\d+` \| REQ-1 \(должно\): на значке видна подпись — источник: разработчик, 2026-10-04; узлы в работе: components\/ZzBadge\/ZzBadge\.tsx; тест: components\/ZzBadge\/tests\/ZzBadge\.test\.tsx «zz badge shows its label» \|  \| затронута \|/,
      );
      expect(first).toContain(
        "| гарантия | `components/ZzChip/ZzChip.tsx` | новый файл в слое компонентов — гарантии, называющие узел: нет | новое | новая возможность |",
      );
      // Ни «чисто» мимо строк, ни «нет предмета» при них.
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { J11: "чисто |  | тест прогнан | ", J12: "нет предмета |  | ничего нового | " },
      });
      const said = tool("bar");
      expect(said).toMatch(/J11: чисто, а гарантия поведения называет узел этой работы[^:]*: П\d+/);
      expect(said).toMatch(/J12: нет предмета, а в модели он есть: П\d+/);
      fs.rmSync(protoAt);
      tool("bar");
      const ids = [...fs.readFileSync(protoAt, "utf8").matchAll(/\| (П\d+) \| гарантия \|/g)].map((m) => m[1]);
      expect(ids).toHaveLength(2);
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          J11: "чисто |  | " + ids[0] + ": тест значка проверяет подпись, и подпись та же | ",
          J12: "чисто |  | " + ids[1] + ": значок-заготовка, наружу не виден | ",
        },
      });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain("гарантии против последнего коммита: без изменений");

      // Сдвиг таблицы печатается под печатью дословно — для отчёта.
      promise(box, [
        "| REQ-2 | никогда | у фишки нет пустого текста | #41 | `components/ZzChip/ZzChip.tsx` | `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label» |",
      ]);
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(tool("bar")).toContain(
        "    новая: REQ-2 (никогда) у фишки нет пустого текста; источник: #41; тест `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label»",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Запись о ключе хранилища — не только то, что она есть, но и то, что она
 * говорит: каждый файл, где код пишет или снимает ключ, назван в ней, и конец
 * записи назван графой времени жизни. Ключ, который пишет узел области,
 * встаёт строкой модели с тем, что его снимает, — вопрос о конце жизни (`K6`).
 */
describe("конец жизни сохранённого и запись о состоянии", () => {
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  const STATE_HEAD =
    "# Состояние\n\n| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n";
  const store = (put) =>
    put(
      "src/shared/zzStore/zzStore.ts",
      'export const zzSave = (n: number): void => {\n  localStorage.setItem("zz-count", String(n));\n};\n',
    );

  it("писатель ключа, которого запись не называет, и пустое время жизни краснеют", () => {
    const box = seatEmpty("state-rec-");
    try {
      const put = putIn(box);
      store(put);
      put(
        "src/app/zzClear.ts",
        'export const zzClear = (): void => {\n  localStorage.removeItem("zz-count");\n};\n',
      );
      const state = (rows) => put(".context/04-state.md", STATE_HEAD + rows.join("\n") + "\n");
      // Однофамилец — состояние экрана с тем же именем — запись ключа не
      // подменяет: файл, названный им, писателем ключа не засчитан.
      state([
        "| `zz-count` на экране | `src/app/zzClear.ts` | обработчик | подпись | пока смонтирован |",
        "| ключ `zz-count` в `localStorage` | `src/shared/zzStore/zzStore.ts` | `zzSave` | никто | до вызова очистки |",
      ]);
      expect((verifyIn(box).get("Запись о состоянии не спорит с кодом") ?? []).join("\n")).toContain(
        "ключ `zz-count`: код пишет его в `app/zzClear.ts`, а запись этот файл не называет ни владельцем, ни писателем",
      );
      state([
        "| ключ `zz-count` в `localStorage` | `src/shared/zzStore/zzStore.ts` | `zzSave`; `zzClear` в `src/app/zzClear.ts` | никто | до вызова очистки |",
      ]);
      expect(verifyIn(box).get("Запись о состоянии не спорит с кодом")).toBeUndefined();
      state([
        "| ключ `zz-count` в `localStorage` | `src/shared/zzStore/zzStore.ts` | `zzSave`; `zzClear` в `src/app/zzClear.ts` | никто |  |",
      ]);
      const red = (verifyIn(box).get("Запись о состоянии не спорит с кодом") ?? []).join("\n");
      expect(red).not.toContain("не называет");
      expect(red).toContain("графа «Время жизни» пуста — конец записи не назван");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("ключ, который пишет узел области, — строкой хранения и вопросом K6", () => {
    const box = seatEmpty("store-bar-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = putIn(box);
      const facts = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        facts,
        fs.readFileSync(facts, "utf8").replace("| K. Внешние данные | нет |", "| K. Внешние данные | да |"),
      );
      put("src/shared/zzStore/zzStore.ts", "export const zzSave = (n: number): void => {\n  void n;\n};\n");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Правка заводит ключ, который не снимает никто.
      store(put);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain(
        "| хранение | `shared/zzStore/zzStore.ts:2` | хранилище «zz-count»: пишут shared/zzStore/zzStore.ts; снимает никто | новое | без снятия |",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { K6: "чисто |  | ключ живёт вечно | " },
      });
      expect(tool("bar")).toMatch(
        /K6: чисто, а в области пишут ключ хранилища, и в основании не сказано, где кончается жизнь записи[^:]*: П\d+/,
      );

      // Снятие по ключу появилось — пометки нет, а строка называет снимающего.
      put(
        "src/shared/zzStore/zzDrop.ts",
        'export const zzDrop = (): void => {\n  localStorage.removeItem("zz-count");\n};\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        /\| хранение \| `shared\/zzStore\/zz(?:Store|Drop)\.ts:2` \| хранилище «zz-count»: пишут shared\/zzStore\/zzDrop\.ts, shared\/zzStore\/zzStore\.ts; снимает по ключу — shared\/zzStore\/zzDrop\.ts \| новое \|  \|/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Рост стоимости с объёмом данных: узел с подпиской, нарисованный в обходе
 * списка, берёт её на каждый элемент.
 */
describe("рост стоимости с объёмом данных", () => {
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  const toolIn = (box) => (...args) => {
    try {
      return execFileSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };

  it("узел с подпиской, нарисованный в обходе списка, — строкой роста и вопросом G9", () => {
    const box = seatEmpty("per-item-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = toolIn(box);
      const put = putIn(box);
      put(
        "src/components/ZzRow/ZzRow.tsx",
        [
          'import { useEffect } from "react";',
          "",
          "export function ZzRow({ id }: { id: string }) {",
          "  useEffect(() => {",
          "    const on = () => undefined;",
          '    window.addEventListener("resize", on);',
          '    return () => window.removeEventListener("resize", on);',
          "  }, []);",
          "  return <li>{id}</li>;",
          "}",
          "",
        ].join("\n"),
      );
      const list = (cls) =>
        put(
          "src/app/zzList.tsx",
          'import { ZzRow } from "../components/ZzRow/ZzRow";\n\nexport function ZzList({ ids }: { ids: string[] }) {\n  return <ul className="' +
            cls +
            '">{ids.map((id) => <ZzRow key={id} id={id} />)}</ul>;\n}\n',
        );
      list("a");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      list("b");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain(
        "| рост | `app/zzList.tsx:4` | ZzRow из components/ZzRow/ZzRow.tsx — подписка на каждый элемент списка: слушатель события |  | на элемент |  | код |",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { G9: "чисто |  | список короткий | " },
      });
      expect(tool("bar")).toMatch(
        /G9: чисто, а работа растёт с объёмом данных, и в основании не назван её рост[^:]*: П\d+/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Строка модели называет, откуда она: из кода, из записи базы либо дописана
 * сессией. Печать называет, сколько «чисто» стоит только на записях базы, и
 * каталоги, с которыми сверено «чисто» о целом, вместе с их незаписанным.
 */
describe("происхождение строк модели и каталоги под печатью", () => {
  it("строка модели называет, откуда она, а печать — сколько «чисто» стоит на одной базе и каков каталог", () => {
    const box = seatEmpty("origin-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      fs.writeFileSync(
        path.join(box, "src", "app", "zzTick.tsx"),
        'import { useState } from "react";\n\nexport function ZzTick() {\n  const [n, setN] = useState(0);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}\n',
      );
      const mapAt = path.join(box, ".context", "00-map.md");
      const MAP_HEAD = "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |";
      fs.writeFileSync(
        mapAt,
        fs
          .readFileSync(mapAt, "utf8")
          .replace(MAP_HEAD, MAP_HEAD + "\n| `app/zzTick.tsx` | счётчик нажатий | `n` | нет |"),
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzTick.tsx");
      const printed = fs.readFileSync(protoAt, "utf8");
      const resp = /^\| (П\d+) \| ответственность \|[^\n]*\| база \|$/m.exec(printed);
      expect(resp).not.toBeNull();
      expect(printed).toMatch(/^\| П\d+ \| состояние \|[^\n]*\| код \|$/m);
      expect(printed).toContain(
        "записей о состоянии `0`, файлов с состоянием `1`, из них без записи `1`",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { G8: "чисто |  | " + resp[1] + ": по карте узел ничего не оптимизирует | " },
      });
      const sealed = tool("bar", "app/zzTick.tsx");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toMatch(/«чисто» с опорой только на записи базы: 1 —/);
      // Каждое «чисто» стоит на самой сильной опоре своего критерия, и
      // опоры делят все «чисто» без остатка.
      const total = Number(/«чисто»: (\d+);/.exec(sealed)?.[1]);
      const grip =
        /«чисто» по самой сильной опоре критерия: сверкой, срезом или фактом — (\d+); вопросом модели — (\d+) \(строка встала у (\d+), признак не встал у (\d+)\); свидетелем — (\d+); основанием ядра — (\d+); одним вниманием — (\d+)/.exec(
          sealed,
        );
      expect(grip).not.toBeNull();
      expect(total).toBeGreaterThan(0);
      const [check, asked, rose, quiet, witness, core, attention] = grip.slice(1).map(Number);
      expect(check + asked + witness + core + attention).toBe(total);
      // У счётчика с состоянием строка встаёт у критериев о состоянии, а у
      // прочих вопросов модели признак не встаёт: обе доли не пусты.
      expect(rose + quiet).toBe(asked);
      expect(rose).toBeGreaterThan(0);
      expect(quiet).toBeGreaterThan(0);
      expect(sealed).toMatch(/«чисто» о целом по каталогам: [1-9]\d*; каталоги — записей о состоянии 0, файлов с состоянием 1, из них без записи 1/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Права и секреты — предмет раздела безопасности: проверка права в коде
 * делает раздел живым, право из данных клиента и секрет в поставке встают
 * строками модели, о которых спрашивают `Q8` и `Q9`; запись наружу —
 * вопрос об исчерпании (`S7`).
 */
describe("права, секреты и исчерпание в своде", () => {
  it("проверка права делает раздел Q живым по замеру", () => {
    const box = seatEmpty("rights-scope-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzGate.ts"),
        'export const zzAllowed = (role: string): boolean => role === "admin";\n',
      );
      expect((verifyIn(box).get("Применимость разделов планки") ?? []).join("\n")).toContain(
        "объявлен неприменимым, а предмет на диске есть: Q",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("право из данных клиента, секрет в поставке и запись наружу — вопросы Q8, Q9 и S7", () => {
    const box = seatEmpty("rights-bar-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const facts = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        facts,
        fs
          .readFileSync(facts, "utf8")
          .replace("| K. Внешние данные | нет |", "| K. Внешние данные | да |")
          .replace("| Q. Безопасность | нет |", "| Q. Безопасность | да |")
          .replace("| S. Наблюдаемость и эксплуатация | нет |", "| S. Наблюдаемость и эксплуатация | да |"),
      );
      fs.writeFileSync(
        path.join(box, "src", "app", "zzGate.ts"),
        [
          "export const zzKey = import.meta.env.VITE_ZZ_SECRET;",
          'export const zzRole = (): string | null => localStorage.getItem("userRole");',
          'export const zzMark = (): void => localStorage.setItem("zz-seen", "1");',
          "",
        ].join("\n"),
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzGate.ts");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toMatch(/^\| П\d+ \| права \| `app\/zzGate\.ts:2` \|[^\n]*\| из клиента \|/m);
      expect(printed).toMatch(/^\| П\d+ \| секрет \| `app\/zzGate\.ts:1` \|[^\n]*\| в поставку \|/m);
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          Q8: "чисто |  | права проверяет сервер | ",
          Q9: "чисто |  | ключ публичный | ",
          S7: "чисто |  | квоты хватит | ",
        },
      });
      const said = tool("bar", "app/zzGate.ts");
      expect(said).toMatch(/Q8: чисто, а право берётся из данных, которые клиент пишет сам[^:]*: П\d+/);
      expect(said).toMatch(/Q9: чисто, а в предмете секрет, который уезжает в поставку[^:]*: П\d+/);
      expect(said).toMatch(/S7: чисто, а предмет пишет наружу, и в основании не сказано, что при исчерпании: полная квота, отказ, переполнение: П\d+/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});
