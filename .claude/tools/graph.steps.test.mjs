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

  it("у сверки базы самого инструмента заголовки не под угрозой", () => {
    expect(headsAtRisk(ts, fs.readFileSync(TOOL, "utf8"))).toEqual([]);
  });

  it("весь код сверки базы самого инструмента лежит в шагах", () => {
    expect(statementsOutsideSteps(ts, fs.readFileSync(TOOL, "utf8"))).toEqual(
      [],
    );
  });
});
