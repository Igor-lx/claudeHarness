import { describe, expect, it } from "vitest";

import * as vocabulary from "./graph.predicates.mjs";

const {
  PREDICATE_CASES,
  classifyRun,
  inComment,
  printedIsRed,
  sectionsOf,
  selfCheck,
} = vocabulary;

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

  // Различение, а не совпадение: у каждого случая в таблице обязаны быть обе
  // стороны. Список только из `true` зелен и на предикате, который всегда
  // говорит «да».
  //
  // Сторона считается по РОДУ функции, и родов три.
  //
  // У предиката-ВОПРОСА это «да» и «нет».
  //
  // У функции, ПРЕОБРАЗУЮЩЕЙ вход, — «изменила» и «оставила как было»: список
  // из одних изменённых зелен и на функции, которая режет всё подряд, а
  // список из одних нетронутых — на функции, которая не делает ничего.
  //
  // У функции-ПРИГОВОРА — «нашла» и «не нашла»: вход отображается в название
  // дыры либо в пустую строку. Приговор не равен входу никогда, и под
  // правилом преобразования у него выходила одна сторона при обеих в
  // таблице. Род этот не мелочь: список из одних «чисто» зелен на функции,
  // которая молчит всегда, — то есть ровно на сломанной.
  //
  // Прежде требовалось ровно два разных ответа, и род не различался. Первая
  // же преобразующая функция словаря уронила тест пятью разными строками —
  // при том, что обе её стороны в таблице были.
  it("у каждого случая в таблице есть обе стороны", () => {
    const sides = new Map();
    for (const [name, input, want] of PREDICATE_CASES) {
      const seen = sides.get(name) ?? new Set();
      seen.add(
        typeof want === "boolean" ? want : want === "" ? false : input !== want,
      );
      sides.set(name, seen);
    }
    for (const [name, seen] of sides) {
      expect(seen.size, `${name} проверен только одной стороной`).toBe(2);
    }
  });
});

/**
 * Держатель «линт» — словарь «критерий → правила» — обещает, что цепочка
 * краснеет на нарушении. Это правда, только пока семя конфига линта включает
 * каждое названное правило ошибкой: предупреждение цепочку не роняет, а
 * правило с опечаткой в имени не включено вовсе. Тест читает семя тем же
 * линтом, которым его гоняет проект, и потому идёт только там, где линт
 * поставлен, — в посадке.
 */
describe("держатель «линт» и семя конфига линта", () => {
  const seed = new URL("../seat/templates/eslint.config.mjs", import.meta.url).pathname;
  const severity = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    return { off: 0, warn: 1, error: 2 }[raw] ?? raw;
  };
  const rulesOf = async (file) => {
    const { ESLint } = await import("eslint");
    const lint = new ESLint({ cwd: process.cwd(), overrideConfigFile: seed });
    const config = await lint.calculateConfigForFile(file);
    return Object.fromEntries(
      Object.entries(config.rules ?? {}).map(([rule, value]) => [rule, severity(value)]),
    );
  };
  const named = [...new Set(Object.values(vocabulary.BAR_LINT).flat())].sort();

  it("каждое правило держателя включено ошибкой в исходниках", async () => {
    const rules = await rulesOf("src/zz/probe.tsx");
    const weak = named.filter((rule) => rules[rule] !== 2);
    expect(weak, "правила держателя, которые семя не включает ошибкой").toEqual([]);
  });

  it("в тестовых файлах выключены ровно объявленные правила держателя", async () => {
    const rules = await rulesOf("src/zz/tests/probe.test.tsx");
    const off = named.filter((rule) => rules[rule] === 0);
    expect(off).toEqual([...vocabulary.BAR_LINT_OFF_IN_TESTS].sort());
    const weak = named.filter(
      (rule) => !vocabulary.BAR_LINT_OFF_IN_TESTS.has(rule) && rules[rule] !== 2,
    );
    expect(weak, "правила держателя, ослабленные в тестах без объявления").toEqual([]);
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

describe("printedIsRed", () => {
  // Вердикт прогона по напечатанному. Смягчённая секция печатает находки той
  // же формой, что и любая, — иначе рецепт фальсификации её не узнает, — и
  // прогон не роняет только она сама, а не всё, что идёт за ней.
  const WARN = "прогон не роняет";
  const none = new Set();
  const lines = [
    "=== Шаблон ===",
    "  осталось: 1",
    "    CLAUDE.md: <ИМЯ ПРОЕКТА>",
    "=== Версии (предупреждение, прогон не роняет) ===",
    "    npm выше проверенной",
    "=== Карта ===",
    "  не упомянуто: 0",
  ];

  it("краснеет на находке в обычной секции", () => {
    expect(printedIsRed(lines, WARN, none)).toBe(true);
  });

  it("не краснеет на находке предупреждения", () => {
    expect(printedIsRed(lines.slice(3), WARN, none)).toBe(false);
  });

  it("не краснеет на находке смягчённой секции", () => {
    expect(printedIsRed(lines, WARN, new Set(["Шаблон"]))).toBe(false);
  });

  it("смягчение кончается на заголовке следующей секции", () => {
    const after = [...lines, "    src/zzProbe.ts"];
    expect(printedIsRed(after, WARN, new Set(["Шаблон"]))).toBe(true);
  });

  it("строка в два пробела находкой не является", () => {
    expect(printedIsRed(["=== А ===", "  проверено: 3"], WARN, none)).toBe(
      false,
    );
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
