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
          if (
            c.length === 8 &&
            c[3].trim() === "" &&
            !/^\s*-+\s*$/.test(c[1]) &&
            c[1].trim() !== "критерий"
          ) {
            c[3] = " нет предмета ";
            c[5] = " проба ревизии ";
            return c.join("|");
          }
          if (c.length === 6 && /zzGone|zzKept/.test(c[1]))
            return (
              "| `" +
              c[1].trim().replace(/`/g, "") +
              "` | не требуется | не требуется | проба ревизии |"
            );
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
      const reg = path.join(box, ".context", "16-findings.md");
      fs.appendFileSync(
        reg,
        "| 9998 | «Комментарий не перерос в прозу»: `src/app/zzWordy.ts:1` — ряд длиннее потолка | проба долга |  |  | открыта |\n",
      );
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
  it("своё имя звена — не слепота, а красное под ним без строки реестра — находка", () => {
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
      // Долг кода держит открытая строка реестра, называющая звено типов.
      const said = () =>
        verifyIn(box).get("Объявленный долг назван планом перехода") ?? [];
      expect(said().join(" ")).toContain("typecheck");
      fs.appendFileSync(
        path.join(box, ".context", "16-findings.md"),
        "| 9997 | Звено «typecheck»: ошибки типов от строгости посадки объявлены долгом | проба долга |  |  | открыта |\n",
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
      // Долг линта держит открытая строка реестра, называющая звено линта.
      const said = () =>
        (verifyIn(box).get("Объявленный долг назван планом перехода") ?? []).join(" ");
      expect(said()).toContain("lint — долг КОДА");
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

  it("досье находит дверь папки и документ единицы, а не чужие README по имени", () => {
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
      expect(docs).toContain("документ по имени единицы: docs/zzWidget.md");
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

describe("свод по планке от модели предмета", () => {
  it("модель называет ресурсы, вердикты с ней согласны, исходы переносятся, вопрос записан", () => {
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
      expect(printed).toMatch(
        /\| П\d+ \| ресурс \| `app\/zzClock\.ts:5` \|[^\n]*\| есть: строка 6 \|/,
      );
      // Пустое снятие ресурса — дыра: без неё вердикт о ресурсах не на чем
      // проверять.
      expect(tool("bar", "app/zzClock.ts")).toMatch(
        /П\d+: снятие ресурса не названо/,
      );
      // Заполнить: ресурсы — снятием, критерии — исходом, базу — ответом.
      const fill = (release, a1, h7) =>
        fs.writeFileSync(
          protoAt,
          fs
            .readFileSync(protoAt, "utf8")
            .split("\n")
            .map((line) => {
              const c = line.split("|");
              if (c.length === 8 && /^ П\d+ $/.test(c[1]) && c[2].trim() === "ресурс") {
                if (c[6].trim() === "")
                  c[6] = c[3].includes(":4") ? " строка 6 " : " " + release + " ";
                return c.join("|");
              }
              if (c.length !== 8 || /^\s*-+\s*$/.test(c[1])) return line;
              const id = c[1].trim();
              if (id === "критерий" || /^П\d+$/.test(id)) return line;
              if (id === "A1") return "| A1 | x | " + a1 + " |";
              if (id === "H7") return "| H7 | x | " + h7 + " |";
              if (["F1", "F2", "E4", "C12"].includes(id))
                return "| " + id + " | x | чисто |  | снимается, см. П3 |  |";
              if (c[3].trim() === "") {
                c[3] = " нет предмета ";
                c[5] = " проба ";
              }
              return c.join("|");
            })
            .map((line) =>
              line === "| `app/zzClock.ts` |  |  |  |"
                ? "| `app/zzClock.ts` | не требуется | не требуется | проба |"
                : line,
            )
            .join("\n"),
        );
      fill("нет", "чисто |  | П1 — узел отвечает на один вопрос | ", "нет предмета |  | проба | ");
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
      expect(tool("bar", "app/zzClock.ts")).toContain("печать поставлена");

      // Правка кода: исходы переносятся, «чисто» ядра сбрасывается.
      fs.appendFileSync(at, "export const zzTick = 1;\n");
      const moved = tool("bar", "app/zzClock.ts");
      expect(moved).toContain("исходы перенесены");
      expect(moved).toContain("«чисто» ядра сброшено: 1");
      expect(fs.readFileSync(protoAt, "utf8")).toContain("| H7 | ");
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/\| H7 \|[^\n]*\| нет предмета \|/);

      // Находка-развилка: судьба «вопрос» требует записи в списке вопросов.
      fill(
        "не нужно: проба",
        "чисто |  | П1 — узел отвечает на один вопрос | ",
        "нашлось | src/app/zzClock.ts:5 | число без имени | вопрос",
      );
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
