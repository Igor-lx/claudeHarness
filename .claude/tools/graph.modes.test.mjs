import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
      const filled = fs
        .readFileSync(protoAt, "utf8")
        .split("\n")
        .map((line) => {
          const c = line.split("|");
          // строка исхода: критерий, предмет, о чём, исход, адрес, что, судьба
          if (
            c.length === 9 &&
            !/^ П\d+ $/.test(c[1]) &&
            c[4].trim() === "" &&
            !/^\s*-+\s*$/.test(c[1]) &&
            c[1].trim() !== "критерий"
          ) {
            c[4] = " нет предмета ";
            c[6] = " проба ревизии ";
            return c.join("|");
          }
          if (c.length === 6 && /zzGone|zzKept/.test(c[1]))
            return (
              "| `" +
              c[1].trim().replace(/`/g, "") +
              "` | правлено | не требуется | `.context/00-map.md` — проба ревизии |"
            );
          // Итог по уровням: строка на предмет уровня, диапазоном называет
          // все строки модели — и сдвиги в их числе.
          if (c.length === 7 && ["узел", "слой", "приложение"].includes(c[1].trim()))
            return "| " + c[1].trim() + " | " + c[2].trim() + " | П1–П99 проба ревизии | да | П1–П99 |";
          return line;
        })
        .join("\n");
      fs.writeFileSync(protoAt, filled);
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
 * умолчанию называет диапазоном все строки модели — и сдвиги в их числе. */
const fillBar = (protoAt, { release, pick = {}, holds = "да" }) =>
  fs.writeFileSync(
    protoAt,
    fs
      .readFileSync(protoAt, "utf8")
      .split("\n")
      .map((line) => {
        const c = line.split("|");
        // строка модели: семь граф
        if (c.length === 9 && /^ П\d+ $/.test(c[1])) {
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
          return "| " + level + " | " + c[2].trim() + " | П1–П99 разобраны | " + said + " | П1–П99 |";
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
          return "| " + id + " | " + subject + " | x | чисто |  | снимается, см. П1–П99 |  |";
        if (c[4].trim() === "") {
          const core = c[3].includes("**ядро.**");
          c[4] = core ? " чисто " : " нет предмета ";
          c[6] = core ? " П1–П99 проба " : " проба ";
        }
        return c.join("|");
      })
      .join("\n"),
  );

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
          .replace(/\| нет \|$/gm, "| не нужно: проба |"),
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
        .replace(/П1–П99 проба/g, "проба")
        .replace(/см\. П1–П99/g, "см. выше")
        .replace(/П1–П99 разобраны \| да \| П1–П99/g, "разобраны | да | проба");
      fs.writeFileSync(protoAt, lazy);
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(/A5 для `shared`: чисто, а ребро идёт против правила направления: П\d+/);
      expect(refused).toMatch(/A9-бис для `app`: чисто, а правка завела цикл: П\d+/);
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

  it("переход: протокол ядра на каждый предмет, находка — долгом, шаг не закрыть без печати", () => {
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
      // Назван строкой реестра находок — факт принят, код ноль.
      const regAt = path.join(box, ".context", "16-findings.md");
      fs.writeFileSync(
        regAt,
        fs
          .readFileSync(regAt, "utf8")
          .replace(
            "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n",
            "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n| 1 | цикл `src/app/zzA.ts` | проба | — | нечем | открыта |\n",
          ),
      );
      const named = tool("levels");
      expect(named.out).toMatch(/цикл: [^\n]*— назван: /);
      expect(named.code).toBe(0);
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
