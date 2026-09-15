import { describe, expect, it } from "vitest";

import * as vocabulary from "./graph.predicates.mjs";

const { PREDICATE_CASES, classifyRun, inComment, sectionsOf, selfCheck } =
  vocabulary;

/** Перевод строки — тот же, которым инструмент разбирает свой вывод. */
const NEWLINE = String.fromCharCode(10);

/** Предикаты области — выводятся из самого модуля, а не перечисляются здесь.
 * Признак: экспортированная функция от ОДНОГО аргумента. `selfCheck` берёт
 * ноль, `inComment` — два, и оба отсеиваются сами. Списком это стояло руками, и
 * список был ложью формы «зелёное молчание»: предикат, добавленный без единого
 * случая, проходил 33 теста из 33 — проверено подсадкой. Обещание «таблица
 * покрывает каждый предикат» держалось вниманием ровно до первого добавления. */
const PREDICATE_NAMES = Object.entries(vocabulary)
  .filter(([, value]) => typeof value === "function" && value.length === 1)
  .map(([name]) => name);

/**
 * Набор на словарь области инструмента.
 *
 * Инструмент — единственная часть обвязки, которая держит все остальные, и до
 * этого файла его не держало ничто: `0` экспортов, обход репозитория при
 * импорте, и потому ни одной точки, куда можно было бы войти тестом. Три
 * дефекта подряд нашлись только потому, что проба случайно посмотрела именно
 * туда, — и все три жили в одном месте: в решении «к какому файлу относится
 * этот вопрос».
 *
 * Таблица случаев живёт **в самом словаре**, а не здесь, и её же гоняет
 * самопроверка инструмента на каждом вызове. Два списка разошлись бы молча:
 * обе стороны были бы зелёными, просто про разное.
 */

describe("словарь области", () => {
  // Та же таблица, что гоняет сам инструмент. Здесь она даёт читаемый отчёт:
  // самопроверка умеет только отказаться работать.
  it.each(PREDICATE_CASES)("%s(%s) === %s", (name, input, want) => {
    expect(PREDICATE_NAMES, `${name} — не предикат области`).toContain(name);
    expect(vocabulary[name](input)).toBe(want);
  });

  it("самопроверка не находит расхождений", () => {
    expect(selfCheck()).toEqual([]);
  });

  it("таблица покрывает каждый предикат области", () => {
    const covered = new Set(PREDICATE_CASES.map(([name]) => name));
    expect(
      PREDICATE_NAMES.length,
      "предикатов не найдено вовсе",
    ).toBeGreaterThan(0);
    for (const name of PREDICATE_NAMES) {
      expect(covered.has(name), `${name} без единого случая`).toBe(true);
    }
  });

  // Различение, а не совпадение: у каждого предиката в таблице обязаны быть обе
  // стороны. Список только из `true` зелен и на предикате, который всегда
  // говорит «да».
  it("у каждого предиката в таблице есть и «да», и «нет»", () => {
    const sides = new Map();
    for (const [name, , want] of PREDICATE_CASES) {
      const seen = sides.get(name) ?? new Set();
      seen.add(want);
      sides.set(name, seen);
    }
    for (const [name, seen] of sides) {
      expect(seen.size, `${name} проверен только одной стороной`).toBe(2);
    }
  });
});

describe("inComment", () => {
  // Своя группа: предикат берёт не путь, а строку и позицию, и таблицей путей
  // его не выразить.
  it("видит хвост строчного комментария", () => {
    const line = "const a = 1; // имя";
    expect(inComment(line, line.indexOf("имя"))).toBe(true);
  });

  it("не считает комментарием код перед ним", () => {
    const line = "const a = 1; // имя";
    expect(inComment(line, line.indexOf("const"))).toBe(false);
  });

  it("видит строку блочного комментария и её продолжение", () => {
    expect(inComment("  /* имя", 5)).toBe(true);
    expect(inComment("   * имя", 5)).toBe(true);
  });

  it("не считает комментарием обычный код", () => {
    const line = 'export const NAME = "x";';
    expect(inComment(line, line.indexOf("NAME"))).toBe(false);
  });
});

describe("sectionsOf", () => {
  // Разбор вывода прогона. Находкой считается строка с отступом в четыре
  // пробела — той же формой, какой их печатают все сверки; счётная строка в
  // два пробела находкой не является и попасть в множество не должна.
  const run = [
    "=== Первая ===",
    "  проверено: 3, ведут в никуда: 1",
    "    файл.md: путь/в/никуда",
    "=== Вторая ===",
    "  расхождений: 0",
    "",
  ].join(NEWLINE);

  it("собирает секции и их строки находок", () => {
    const got = sectionsOf(run, NEWLINE);
    expect([...got.keys()]).toEqual(["Первая", "Вторая"]);
    expect([...got.get("Первая")]).toEqual(["    файл.md: путь/в/никуда"]);
    expect(got.get("Вторая").size).toBe(0);
  });

  it("не считает находкой счётную строку в два пробела", () => {
    const got = sectionsOf(run, NEWLINE);
    for (const red of got.values())
      for (const line of red) expect(line.startsWith("    ")).toBe(true);
  });
});

describe("classifyRun", () => {
  // Исход посаженной поломки. Сравниваются СТРОКИ находок, а не флаг
  // «красная»: пока сравнивался флаг, сверка, красная ДО поломки, не могла
  // быть засчитана ни при каком исходе — то есть в живом проекте, где
  // красные сверки есть по определению, здоровая сверка выглядела сломанной.
  const at = (pairs) =>
    new Map(pairs.map(([name, lines]) => [name, new Set(lines)]));

  it("прибавившаяся строка — поймала", () => {
    const clean = at([["А", []]]);
    const after = at([["А", ["    находка"]]]);
    expect(classifyRun(clean, after, "А").how).toBe("caught");
  });

  it("сверка, КРАСНАЯ ДО ПОЛОМКИ, всё равно ловит прибавку", () => {
    const clean = at([["А", ["    старая находка"]]]);
    const after = at([["А", ["    старая находка", "    новая находка"]]]);
    expect(classifyRun(clean, after, "А").how).toBe("caught");
  });

  it("появившаяся секция — поймала", () => {
    const clean = at([]);
    const after = at([["А", []]]);
    expect(classifyRun(clean, after, "А").how).toBe("caught");
  });

  it("пропавшая секция — рецепт устарел", () => {
    const clean = at([["А", []]]);
    const after = at([]);
    expect(classifyRun(clean, after, "А").how).toBe("broken");
  });

  it("прибавилось у ДРУГОЙ сверки — поломка ушла не туда, и та названа", () => {
    const clean = at([
      ["А", []],
      ["Б", []],
    ]);
    const after = at([
      ["А", []],
      ["Б", ["    находка"]],
    ]);
    const got = classifyRun(clean, after, "А");
    expect(got.how).toBe("astray");
    expect(got.why).toContain("Б");
  });

  it("не изменилось нигде — не дошла ни до одной", () => {
    const clean = at([
      ["А", []],
      ["Б", ["    старая"]],
    ]);
    const after = at([
      ["А", []],
      ["Б", ["    старая"]],
    ]);
    expect(classifyRun(clean, after, "А").how).toBe("nowhere");
  });

  it("исчезнувшая у соседа строка поломкой не считается", () => {
    // Убыль — не прибавка. Иначе рецепт, случайно ПОЧИНИВШИЙ чужую находку,
    // числился бы ушедшим не туда, и настоящая причина осталась бы скрытой.
    const clean = at([
      ["А", []],
      ["Б", ["    старая"]],
    ]);
    const after = at([
      ["А", []],
      ["Б", []],
    ]);
    expect(classifyRun(clean, after, "А").how).toBe("nowhere");
  });
});
