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
 * Мастерская копируется во временную папку со своим репозиторием, и с ней —
 * один пакет форматтера: инструменту из пакетов нужен только он. Ссылкой на
 * папку пакетов не обходятся намеренно — рекурсивное удаление временной папки
 * не должно иметь дороги в живые пакеты мастерской.
 */
describe("ворота и приведение формата", () => {
  it("коммит одного формата проходит, смысл под видом формата — нет", async () => {
    const home = path.join(TOOL_DIR, "..", "..");
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "vorota-"));
    const skip = new Set([
      "node_modules",
      ".git",
      ".проба-сверок",
      ".stryker-tmp",
      "reports",
      "coverage",
      "dist",
    ]);
    try {
      fs.cpSync(home, box, {
        recursive: true,
        filter: (src) => !skip.has(path.basename(src)),
      });
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
