import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

/** Режим, которому нужен путь, получает файл этого самого набора: он есть
 * всегда и лежит там же, где инструмент. */
const SUBJECT = path.relative(
  path.join(TOOL_DIR, "..", ".."),
  fileURLToPath(import.meta.url),
);

/** Режимы вне дымового прогона — с причиной у каждого.
 *
 * Причина у всех одна по сути: побочное действие за пределами репозитория либо
 * стоимость, несовместимая с цепочкой. Ни один не исключён потому, что «падал». */
const OUTSIDE = {
  falsify:
    "ломает предмет каждой сверки на копии дерева и гоняет по ней цепочку — минуты, а не секунды",
  handoff: "кладёт снимок обвязки ПАПКОЙ рядом с репозиторием",
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
const CRASH =
  /ReferenceError|TypeError|SyntaxError|is not defined|is not a function|Cannot read propert/;

describe("режимы инструмента запускаются", () => {
  it("инструмент назвал свои режимы", () => {
    expect(modes.length, "список режимов не прочитан").toBeGreaterThan(0);
  });

  it.each(smoke)("%s", (mode) => {
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
    expect(said, `${mode}: пустой вывод — режим ничего не сказал`).not.toBe("");
    const hit = CRASH.exec(said);
    expect(
      hit === null,
      `${mode} упал: ${said.split("\n").find((l) => CRASH.test(l)) ?? ""}`,
    ).toBe(true);
  });

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
