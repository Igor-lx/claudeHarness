import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { foreignOffer, scenarioByShelf } from "./graph.profile.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHELF = path.join(TOOL_DIR, "..");
const CORPUS = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, "foreign-corpus.json"), "utf8"));

/** Сценарий посадки — один ответ на обвязку, и корпус называет его у каждого
 * проекта. Выведено замером корпуса: прежний осмотр стека ошибался на `4` из
 * `18`, а пустоту решал другой классификатор. Решено разработчиком
 * `2026-10-30`. */
describe("сценарий посадки", () => {
  for (const project of CORPUS.projects)
    it(project.name + " — " + project.scenario, () => {
      const box = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-"));
      try {
        for (const [rel, text] of Object.entries(project.files)) {
          fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
          fs.writeFileSync(path.join(box, rel), text);
        }
        expect(scenarioByShelf({ root: box, shelf: SHELF }).scenario).toBe(project.scenario);
      } finally {
        fs.rmSync(box, { recursive: true, force: true });
      }
    });

  it("инструмент, который велено заменить своим, чужим не считается", () => {
    const jest = CORPUS.projects.find((p) => p.name === "jest");
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-with-"));
    try {
      for (const [rel, text] of Object.entries(jest.files)) {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      }
      expect(scenarioByShelf({ root: box, shelf: SHELF }).scenario).toBe("foreign");
      expect(scenarioByShelf({ root: box, shelf: SHELF, withTools: ["раннер тестов"] }).scenario).toBe("familiar");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });

  it("чужому проекту — что не проверено и два пути; переставить только инструменты", () => {
    const tools = foreignOffer([{ axis: "раннер тестов", what: "jest", tool: "test" }]).join("\n");
    expect(tools).toContain("раннер тестов: jest");
    expect(tools).toContain("env . --apply --with=раннер тестов");
    expect(tools).toContain("перейти — новая пустая посадка");
    const mixed = foreignOffer([
      { axis: "раннер тестов", what: "jest", tool: "test" },
      { axis: "структура", what: "рабочие пространства", tool: null },
    ]).join("\n");
    expect(mixed).not.toContain("--with=");
    expect(mixed).toContain("переставить нельзя одной командой: чужое здесь не только инструменты (структура)");
  });
});
