import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compilerAt } from "./graph.parse.mjs";
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
 * Каждая альтернатива образца словаря держится случаем: снятая, она роняет
 * самопроверку. Случаи держали одну-две формы признака из многих, и форма,
 * выпавшая правкой, уходила без красного — замерено прогоном проб: `650`
 * альтернатив из `805` снимались молча, среди них образец, не узнававший
 * кириллическую пометку ограничения вовсе. Альтернатива, которую не ловит ни
 * один случай, либо получает случай, либо мёртвая и снимается.
 *
 * Образцы, собранные из строк, сюда не попадают: их альтернативы держат
 * случаи предикатов, которые их собирают. `inComment` — двух доводов, и его
 * держат тесты ниже.
 */
describe("каждая альтернатива образца в словаре держится случаем", () => {
  it("снятие любой альтернативы роняет самопроверку", async () => {
    const toolDir = path.dirname(fileURLToPath(import.meta.url));
    const ts = compilerAt(path.join(toolDir, "..", ".."));
    expect(ts, "без компилятора образцы не найти").not.toBe(null);
    const name = "graph.predicates.mjs";
    const src = fs.readFileSync(path.join(toolDir, name), "utf8");
    const file = ts.createSourceFile(
      name,
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const exempt = file.statements
      .filter(
        (st) =>
          ts.isVariableStatement(st) &&
          st.declarationList.declarations.some(
            (d) => d.name.getText(file) === "inComment",
          ),
      )
      .map((st) => [st.getStart(file), st.end]);
    // Спаны альтернатив в каждой группе тела, включая внешнюю.
    const groupsOf = (body) => {
      const out = [];
      const stack = [{ start: 0, bars: [] }];
      for (let k = 0; k < body.length; k += 1) {
        const ch = body[k];
        if (ch === "\\") k += 1;
        else if (ch === "[") {
          for (k += 1; k < body.length && body[k] !== "]"; k += 1)
            if (body[k] === "\\") k += 1;
        } else if (ch === "(") {
          const lead = /^\?(?:[:=!]|<[=!]|<[A-Za-z_$][\w$]*>)/.exec(
            body.slice(k + 1),
          );
          stack.push({ start: k + 1 + (lead?.[0].length ?? 0), bars: [] });
        } else if (ch === ")") {
          const g = stack.pop();
          if (g.bars.length > 0) out.push({ ...g, end: k });
        } else if (ch === "|") stack[stack.length - 1].bars.push(k);
      }
      if (stack[0].bars.length > 0) out.push({ ...stack[0], end: body.length });
      return out;
    };
    const mutants = [];
    const visit = (node) => {
      if (
        node.kind === ts.SyntaxKind.RegularExpressionLiteral &&
        !exempt.some(([a, b]) => node.getStart(file) >= a && node.end <= b)
      ) {
        const text = node.getText(file);
        const close = text.lastIndexOf("/");
        const body = text.slice(1, close);
        for (const g of groupsOf(body)) {
          const cuts = [g.start, ...g.bars.map((b) => b + 1)];
          const ends = [...g.bars, g.end];
          for (let k = 0; k < cuts.length; k += 1) {
            const [a, b] =
              k === 0 ? [cuts[0], cuts[1]] : [ends[k - 1], ends[k]];
            mutants.push({
              where:
                file.getLineAndCharacterOfPosition(node.getStart(file)).line +
                1,
              alternative: body.slice(cuts[k], ends[k]),
              text:
                src.slice(0, node.getStart(file)) +
                "/" +
                body.slice(0, a) +
                body.slice(b) +
                text.slice(close) +
                src.slice(node.end),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(
      mutants.length,
      "образцов с альтернативами не нашлось",
    ).toBeGreaterThan(500);
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "formy-"));
    try {
      mutants.forEach((one, k) => {
        fs.mkdirSync(path.join(box, "m" + k));
        fs.writeFileSync(path.join(box, "m" + k, name), one.text);
      });
      // Мутант — свежий модуль, а модуль процесс не выгружает: пачка на
      // процесс держит память в пределах, процессы идут по ядрам.
      const worker = path.join(box, "worker.mjs");
      // Адрес модуля — ссылкой на файл: голый путь Windows импорт не берёт,
      // и каждый мутант читался бы убитым.
      fs.writeFileSync(
        worker,
        "import { pathToFileURL } from 'node:url';\n" +
          "const out = [];\n" +
          "for (const d of process.argv.slice(2)) {\n" +
          "  try { out.push((await import(pathToFileURL(d + '/" +
          name +
          "').href)).selfCheck().length); }\n" +
          "  catch { out.push(-1); }\n" +
          "}\n" +
          "console.log(JSON.stringify(out));\n",
      );
      const BATCH = 60;
      const batches = [];
      for (let k = 0; k < mutants.length; k += BATCH)
        batches.push(
          mutants
            .slice(k, k + BATCH)
            .map((_, j) => path.join(box, "m" + (k + j))),
        );
      const runBatch = (dirs) =>
        new Promise((done, fail) => {
          const child = spawn(process.execPath, [worker, ...dirs], {
            stdio: ["ignore", "pipe", "inherit"],
          });
          let said = "";
          child.stdout.on("data", (x) => (said += x));
          child.on("error", fail);
          child.on("close", () => done(JSON.parse(said.trim() || "[]")));
        });
      // Контроль: исходный модуль через тот же путь грузится и проходит
      // самопроверку. Без него сломанный исполнитель убивал бы каждого.
      fs.mkdirSync(path.join(box, "control"));
      fs.writeFileSync(path.join(box, "control", name), src);
      expect(await runBatch([path.join(box, "control")])).toEqual([0]);
      const counts = [];
      const lanes = Math.max(1, Math.min(4, os.cpus().length));
      for (let k = 0; k < batches.length; k += lanes)
        for (const one of await Promise.all(
          batches.slice(k, k + lanes).map(runBatch),
        ))
          counts.push(...one);
      expect(counts.length).toBe(mutants.length);
      const survivors = mutants
        .filter((_, k) => counts[k] === 0)
        .map((one) => one.where + ": −" + one.alternative);
      expect(survivors).toEqual([]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 600000);
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
  }, 180000);

  it("в тестовых файлах выключены ровно объявленные правила держателя", async () => {
    const rules = await rulesOf("src/zz/tests/probe.test.tsx");
    const off = named.filter((rule) => rules[rule] === 0);
    expect(off).toEqual([...vocabulary.BAR_LINT_OFF_IN_TESTS].sort());
    const weak = named.filter(
      (rule) => !vocabulary.BAR_LINT_OFF_IN_TESTS.has(rule) && rules[rule] !== 2,
    );
    expect(weak, "правила держателя, ослабленные в тестах без объявления").toEqual([]);
  }, 180000);
});

/**
 * Семя кода приезжает отформатированным: иначе звено формата нового проекта
 * краснеет до первой собственной строки. Сверка «Семена приезжают
 * отформатированными» видит в проекте одни семена с суффиксом отложенного, а
 * прочие, пока они лежат на полке, форматтер проекта не видит: папку обвязки
 * проект из него исключает. Тест читает каждое семя тем форматтером, которым
 * его гоняет проект, и с настройками семени, и потому идёт только там, где
 * форматтер поставлен, — в посадке. Найдено прогоном звеньев стенда: семя
 * настройки инструмента держало две строки шире поля.
 */
describe("семена кода приезжают отформатированными", () => {
  // Что форматтер проекта разбирает по расширению, кроме прозы: её проект
  // из форматтера исключает.
  const FORMATTED = /\.(?:[cm]?[jt]sx?|json|css|scss|less|html)$/;
  it("каждое семя кода проходит форматтер с настройками семени", async () => {
    const prettier = await import("prettier");
    const shelf = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const map = JSON.parse(fs.readFileSync(path.join(shelf, "seat", "map.json"), "utf8"));
    // Семя, которое ложится в папку обвязки, форматтер проекта не видит и там.
    const seeds = [...(map.copy ?? []), ...(map.onSubject ?? []), ...(map.onTransition ?? [])]
      .filter((e) => !e.to.startsWith(".claude/") && FORMATTED.test(e.to))
      .map((e) => e.from);
    expect(seeds.length, "семян кода в карте не нашлось").toBeGreaterThan(3);
    const rough = [];
    for (const from of seeds) {
      const at = path.join(shelf, from);
      const filepath = at.replace(/\.seed$/, "");
      const options = (await prettier.resolveConfig(filepath)) ?? {};
      if (!(await prettier.check(fs.readFileSync(at, "utf8"), { ...options, filepath })))
        rough.push(from);
    }
    expect(rough, "семена, которые форматтер проекта переписал бы").toEqual([]);
  }, 180000);
});

/**
 * Обращение к имени, которого нет, роняет ветку только у того, кто в неё
 * попал: правка, снявшая местное выражение, оставила второе обращение к нему,
 * и режимы `levels` и `bar` падали на любом проекте с единицей переноса.
 * Модули инструмента читаются линтом посадки одним правилом.
 */
describe("код инструмента", () => {
  it("каждое имя, на которое ссылается модуль инструмента, объявлено", async () => {
    const { ESLint } = await import("eslint");
    const { default: globals } = await import("globals");
    const lint = new ESLint({
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      overrideConfigFile: true,
      overrideConfig: {
        languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.node },
        rules: { "no-undef": "error" },
      },
    });
    const results = await lint.lintFiles(["*.mjs"]);
    expect(results.map((r) => path.basename(r.filePath))).toContain("graph.mjs");
    const undeclared = results.flatMap((r) =>
      r.messages.map((m) => path.basename(r.filePath) + ":" + m.line + ": " + m.message),
    );
    expect(undeclared).toEqual([]);
  }, 180000);
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

/**
 * Шапка правила о коде грузит правило, когда сессия открыла файл под её
 * образец, а инструмент судит код по своему перечню расширений. Два перечня
 * расходились: шапки знали `.mjs` и `.mts`, обход корпуса — нет, а `.styl`
 * знал только инструмент. Шапки сличаются с перечнем словаря.
 */
describe("шапки правил о коде — перечнем словаря", () => {
  it("расширения в шапке каждого правила с образцом — ровно расширения кода и стилей", () => {
    const rules = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rules");
    const want = [...vocabulary.CODE_EXTENSIONS, ...vocabulary.STYLE_EXTENSIONS].sort();
    let headed = 0;
    for (const name of fs.readdirSync(rules).filter((n) => n.endsWith(".md"))) {
      const head = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(path.join(rules, name), "utf8"));
      if (head === null || !/^paths:/m.test(head[1])) continue;
      headed += 1;
      const exts = [...head[1].matchAll(/"\*\*\/\*\.\{([^}]+)\}"/g)].flatMap((m) => m[1].split(","));
      expect(exts.sort(), name).toEqual(want);
    }
    expect(headed).toBeGreaterThan(3);
  });
});

describe("расширения звеньев и линта семени — перечнем словаря", () => {
  it("звено типов читает TypeScript, звено линта — весь код, линт семени разбирает каждое расширение кода", () => {
    const shelf = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const map = JSON.parse(fs.readFileSync(path.join(shelf, "seat", "map.json"), "utf8"));
    const link = (name) => map.chainScripts.find((one) => one.name === name).needsFiles.slice().sort();
    expect(link("typecheck")).toEqual([...vocabulary.TS_EXTENSIONS].sort());
    expect(link("lint")).toEqual([...vocabulary.CODE_EXTENSIONS].sort());
    const lint = fs.readFileSync(path.join(shelf, "seat", "templates", "eslint.config.mjs"), "utf8");
    const linted = new Set(
      [...lint.matchAll(/"\*\*\/\*\.\{([^}]+)\}"/g)].flatMap((m) => m[1].split(",")),
    );
    expect([...linted].sort()).toEqual([...vocabulary.CODE_EXTENSIONS].sort());
  });
});
