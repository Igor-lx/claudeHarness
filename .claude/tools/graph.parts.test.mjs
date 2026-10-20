import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  applyParts,
  changedLinesOf,
  componentsOf,
  hunksOf,
  linesOf,
  partsSectionOf,
  partsTableOf,
  recordsOf,
} from "./graph.parts.mjs";

/** Ханки, как их печатает git, — тем же разбором, что в работе. */
const diffOf = (before, after) => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "parts-"));
  try {
    fs.writeFileSync(path.join(box, "a"), before);
    fs.writeFileSync(path.join(box, "b"), after);
    return spawnSync("git", ["diff", "--no-index", "-U0", "a", "b"], {
      cwd: box,
      encoding: "utf8",
    }).stdout;
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
};

describe("части правки: таблица в протоколе", () => {
  it("раздел печатается и читается обратно; раздела нет — null", () => {
    const body = [
      "# протокол",
      "",
      "| 1 | страница | слово |",
      "",
      ...partsSectionOf([
        { files: ["components/A/A.tsx", "components/A/a.ts"], what: "кнопка" },
        { files: ["shared/x/x.ts"], what: "" },
      ]),
      "## Дальше",
      "| 9 | `x.ts` | чужое |",
    ].join("\n");
    expect(
      partsTableOf(body).map(({ n, files, what }) => ({ n, files, what })),
    ).toEqual([
      {
        n: "1",
        files: ["components/A/A.tsx", "components/A/a.ts"],
        what: "кнопка",
      },
      { n: "2", files: ["shared/x/x.ts"], what: "" },
    ]);
    expect(partsTableOf("# протокол\n| 1 | `x.ts` | что |\n")).toBeNull();
  });

  it("раздел первой строкой и последним в тексте, строка короче трёх клеток, дефис в номере", () => {
    const body = [
      "## Части правки",
      "| часть | файлы | что |",
      "| --- | --- | --- |",
      "| -1 | `a.ts` | правка |",
      "| 2- |",
      "| 3 | `b.ts` |",
    ].join("\n");
    expect(partsTableOf(body)).toEqual([
      { n: "-1", files: ["a.ts"], what: "правка", line: 4 },
      { n: "2-", files: [], what: "", line: 5 },
      { n: "3", files: ["b.ts"], what: "", line: 6 },
    ]);
    expect(partsTableOf("")).toBeNull();
  });
});

describe("части правки: компоненты связности", () => {
  it("связь по цепочке собирает одну компоненту, несвязанное — своя", () => {
    const link = (a, b) => (a + b === "ab" || a + b === "bc" ? "импорт" : null);
    expect(componentsOf(["a", "b", "c", "d"], link)).toEqual([
      ["a", "b", "c"],
      ["d"],
    ]);
    expect(componentsOf(["a", "d"], () => null)).toEqual([["a"], ["d"]]);
  });
});

describe("части правки: записи файла базы", () => {
  it("строка таблицы с путём — своя запись, прочее — раздел до заголовка", () => {
    const lines = linesOf(
      "# Карта\n\nтекст\n| Файл | Что |\n| `a.ts` | a |\n| `b.ts` | b |\n## Второй\nещё\n",
    );
    const r = recordsOf(lines);
    expect(r[4]).toEqual([4, 4]);
    expect(r[5]).toEqual([5, 5]);
    expect(r[3]).toEqual([0, 5]);
    expect(r[2]).toEqual([0, 5]);
    expect(r[7]).toEqual([6, 7]);
    // Заголовок — в своём разделе, а не в прежнем.
    expect(r[6]).toEqual([6, 7]);
    expect(r[0]).toEqual([0, 5]);
    expect(linesOf("")).toEqual([]);
    expect(recordsOf([])).toEqual([]);
  });
});

describe("части правки: наложение частей", () => {
  it("каждое подмножество частей собирается, все части дают новый вид", () => {
    const before = "a\nb\nc\n| `x.ts` | x |\n";
    const after = "a\nB\nc\n| `x.ts` | X |\n| `y.ts` | y |";
    const hunks = hunksOf(diffOf(before, after));
    const { removed, added } = changedLinesOf(hunks);
    const oldLines = linesOf(before);
    const newLines = linesOf(after);
    const partOf = { removed: new Map(), added: new Map() };
    // b → B — часть 1; строка x — часть 2; новая строка y — часть 3.
    for (const i of removed)
      partOf.removed.set(i, oldLines[i].startsWith("b") ? 1 : 2);
    for (const i of added)
      partOf.added.set(
        i,
        newLines[i].startsWith("B") ? 1 : newLines[i].includes("y") ? 3 : 2,
      );
    const at = (chosen) =>
      applyParts(oldLines, newLines, hunks, partOf, new Set(chosen));
    expect(at([1, 2, 3])).toBe(after);
    expect(at([])).toBe(before);
    expect(at([1])).toBe("a\nB\nc\n| `x.ts` | x |\n");
    expect(at([1, 2])).toBe("a\nB\nc\n| `x.ts` | X |\n");
    expect(at([3])).toBe("a\nb\nc\n| `x.ts` | x |\n| `y.ts` | y |");
  });
});
