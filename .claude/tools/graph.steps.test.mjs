import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  VERIFY_TAIL,
  headsAtRisk,
  statementsOutsideSteps,
  stepsOutline,
  stepsTouchedBy,
} from "./graph.steps.mjs";

const ts = createRequire(import.meta.url)("typescript");
const TOOL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "graph.mjs",
);

const SAMPLE = `
if (mode === "verify") {
  const a = checkStep(() => compute());
  const out = [];
  checkStep(() => {
    for (const x of a) out.push(x);
  });
  const other = [];
  checkStep(() => {
    other.push(1);
  });
  checkStep(() => {
    checkHead("S1", () => ({ n: out.length }));
  });
  checkStep(() => {
    checkHead("S2", () => ({ n: other.length }));
  });
  // ${VERIFY_TAIL}
  done();
}
`;

describe("шаги сверки по тексту инструмента", () => {
  it("след упавшего шага идёт по данным, а не по соседству", () => {
    // Шаг 1 считает `a`; шаг 2 читает его и пишет `out`; секцию S1 печатает
    // шаг 4, читая `out`. Шаги 3 и 5 с ним данных не делят.
    expect([...stepsTouchedBy(ts, SAMPLE, [1])]).toEqual([
      [2, 1],
      [4, 1],
    ]);
    expect([...stepsTouchedBy(ts, SAMPLE, [3])]).toEqual([[5, 3]]);
  });

  it("упавший шаг, задетый упавшим раньше, — его следствие", () => {
    expect(stepsTouchedBy(ts, SAMPLE, [1, 2]).get(2)).toBe(1);
  });

  it("без компилятора разбора нет", () => {
    expect(stepsTouchedBy(null, SAMPLE, [1])).toBeNull();
  });

  it("шаг секции знает свою секцию", () => {
    expect(stepsOutline(ts, SAMPLE).map((s) => s.head)).toEqual([
      null,
      null,
      null,
      "S1",
      "S2",
    ]);
  });

  it("код сверки вне шага назван; в шагах — нет", () => {
    expect(statementsOutsideSteps(ts, SAMPLE)).toEqual([]);
    const loose = SAMPLE.replace(
      "  const other = [];",
      "  const other = [];\n  const sum = a.reduce((n, x) => n + x, 0);\n  for (const x of a) other.push(x);",
    );
    expect(statementsOutsideSteps(ts, loose)).toEqual([
      expect.stringMatching(/const sum = a\.reduce/),
      expect.stringMatching(/for \(const x of a\) other\.push/),
    ]);
  });

  it("заголовок не первым в шаге и счёт до заголовка названы", () => {
    expect(headsAtRisk(ts, SAMPLE)).toEqual([]);
    const late = SAMPLE.replace(
      '    checkHead("S2", () => ({ n: other.length }));',
      '    const n = other.length;\n    checkHead("S2", { n });',
    );
    expect(headsAtRisk(ts, late)).toEqual([
      expect.stringMatching(/"S2" — заголовок не первым в шаге$/),
      expect.stringMatching(/"S2" — счёт корпуса до заголовка$/),
    ]);
  });

  it("вложенный заголовок — только в области, названный её перечнем", () => {
    const nested = SAMPLE.replace(
      `  // ${VERIFY_TAIL}`,
      `  checkStep(() => {
    if (other.length) checkHead("S3", { n: 1 });
    checkRegion(["S4"], () => {
      checkHead("S4", { n: 1 });
      checkHead("S5", { n: 1 });
      checkHead(other.title, { n: 1 });
    });
  });
  // ${VERIFY_TAIL}`,
    );
    expect(headsAtRisk(ts, nested)).toEqual([
      expect.stringMatching(
        /"S3" — заголовок вглубь шага, вне области с перечнем$/,
      ),
      expect.stringMatching(/"S5" — секция не названа перечнем области$/),
      expect.stringMatching(
        /other\.title — имя секции вычисляется — перечень с ним не сверить$/,
      ),
    ]);
  });

  it("у сверки базы самого инструмента заголовки не под угрозой", () => {
    expect(headsAtRisk(ts, fs.readFileSync(TOOL, "utf8"))).toEqual([]);
  });

  it("весь код сверки базы самого инструмента лежит в шагах", () => {
    expect(statementsOutsideSteps(ts, fs.readFileSync(TOOL, "utf8"))).toEqual(
      [],
    );
  });
});

// Формы, которых нет в первом образце: вызов шага в скобках, с `??` и с
// `await`; деструктуризация с пропуском; объявление функции; ключи
// свойств с именами верхнего уровня; простые значения всех видов.
const FORMS = `
if (mode === "verify") {
  let none;
  const s = "x", t = \`t\`, nl = null, yes = true, no = false, num = 1;
  const fn = () => 1, fe = function () {}, chain = cfg.a.b;
  const empty = [], fresh = new Map(), bare = new Set;
  const { a, b: [, c] } = checkStep(() => load());
  function helper() { return a; }
  (checkStep(() => helper()));
  const d = checkStep(() => c) ?? [];
  await checkStepAsync(async () => { use(obj.a, { a: 1 }); });
  const e = await checkStepAsync(async () => d);
  checkStep(() => { checkHead(title.text, () => ({ n: 1 })); });
  checkStep(() => { checkHead("S6"); });
  checkStep();
  checkStep(() => { checkHead(); });
  checkStep(run);
  checkStep(() => { note("X"); use({ k: c }); });
  // ${VERIFY_TAIL}
  done();
}
`;

describe("шаги сверки — формы записи", () => {
  it("простые значения, вызов шага в любой обёртке — вне шагов ничего", () => {
    expect(statementsOutsideSteps(ts, FORMS)).toEqual([]);
  });

  it("сложное значение и чужой вызов названы, строкой и номером строки", () => {
    const loose = FORMS.replace(
      "  let none;",
      "  let none;\n  const full = [1];\n  const filled = new Map([[1, 2]]);\n  const call = make(\n    1,\n  );\n  other(() => 1);\n  x;",
    );
    expect(statementsOutsideSteps(ts, loose)).toEqual([
      "4: const full = [1];",
      "5: const filled = new Map([[1, 2]]);",
      "6: const call = make(",
      "9: other(() => 1);",
      "10: x;",
    ]);
  });

  it("без сверки и без хвоста — сказано прямо", () => {
    expect(statementsOutsideSteps(ts, "const z = 1;")).toEqual([
      "сверки базы в тексте нет",
    ]);
    expect(
      statementsOutsideSteps(ts, FORMS.replace("// " + VERIFY_TAIL, "")),
    ).toEqual(["хвоста прогона нет: строки «" + VERIFY_TAIL + "»"]);
    expect(stepsOutline(ts, "const z = 1;")).toEqual([]);
    expect(headsAtRisk(ts, "const z = 1;")).toEqual([]);
    expect(stepsTouchedBy(ts, "const z = 1;", [1])).toBeNull();
  });

  it("имена из деструктуризации и объявления функции несут след", () => {
    // Шаг 1 пишет `a` и `c`; шаг 2 зовёт `helper`, читающую `a`, — но
    // функция сама шагом не пишется, след идёт через `c` в шаг 3 и `d` в
    // шаг 5. Шаг 4 берёт `obj.a` и ключ `a` — это не чтение `a`.
    const outline = stepsOutline(ts, FORMS);
    expect(outline.map((x) => [...x.reads].sort())).toEqual([
      [],
      ["helper"],
      ["c"],
      [],
      ["d"],
      [],
      [],
      [],
      [],
      [],
      ["c"],
    ]);
    expect(outline.map((x) => x.head)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "S6",
      null,
      null,
      null,
      null,
    ]);
    expect([...stepsTouchedBy(ts, FORMS, [1])]).toEqual([
      [3, 1],
      [5, 1],
      [11, 1],
    ]);
  });

  it("след берёт первое по чтению происхождение и не перезаписывает его", () => {
    const two = `
if (mode === "verify") {
  const p = checkStep(() => 1);
  const q = checkStep(() => 2);
  const r = checkStep(() => p + q);
  checkStep(() => r);
  // ${VERIFY_TAIL}
}
`;
    expect([...stepsTouchedBy(ts, two, [1, 2])]).toEqual([
      [3, 1],
      [4, 1],
    ]);
    expect([...stepsTouchedBy(ts, two, [2])]).toEqual([
      [3, 2],
      [4, 2],
    ]);
    // Шаг 3 читает `q` первым и несёт след упавшего 2, но `p` уже несёт
    // след упавшего 1 — шаг 4, читающий одно `p`, — следствие упавшего 1.
    const kept = `
if (mode === "verify") {
  const p = checkStep(() => 1);
  const q = checkStep(() => 2);
  checkStep(() => q + p);
  checkStep(() => p);
  // ${VERIFY_TAIL}
}
`;
    expect([...stepsTouchedBy(ts, kept, [1, 2])]).toEqual([
      [3, 2],
      [4, 1],
    ]);
  });

  it("вычисляемое и пропущенное имя названы; заголовок без счёта — нет", () => {
    expect(headsAtRisk(ts, FORMS)).toEqual([
      "13: title.text — имя секции вычисляется — перечень с ним не сверить",
      "16: (без имени) — имя секции вычисляется — перечень с ним не сверить",
    ]);
  });

  it("хвост перед первым оператором: проверять нечего", () => {
    const allTail = FORMS.replace("// " + VERIFY_TAIL, "").replace(
      "  let none;",
      "  // " +
        VERIFY_TAIL +
        "\n  let none;\n  const sum = a.reduce((n, x) => n + x, 0);",
    );
    expect(headsAtRisk(ts, allTail)).toEqual([]);
    expect(statementsOutsideSteps(ts, allTail)).toEqual([]);
  });

  it("без хвоста проверяется и последний шаг", () => {
    const noTail = `
if (mode === "verify") {
  checkStep(() => { checkHead(other.title, () => ({ n: 1 })); });
}
`;
    expect(headsAtRisk(ts, noTail)).toEqual([
      "3: other.title — имя секции вычисляется — перечень с ним не сверить",
    ]);
  });

  it("длинный оператор назван началом в семьдесят знаков", () => {
    const long = FORMS.replace(
      "  let none;",
      "  let none;\n  const veryLongName = compute(" + "x, ".repeat(40) + "y);",
    );
    const [line] = statementsOutsideSteps(ts, long);
    expect(line).toBe(
      "4: " + ("const veryLongName = compute(" + "x, ".repeat(40)).slice(0, 70),
    );
  });
});
