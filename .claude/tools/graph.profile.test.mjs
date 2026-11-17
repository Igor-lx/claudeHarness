import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { foreignOffer, manifestOf, scenarioByShelf, scenarioOf } from "./graph.profile.mjs";

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
    expect(tools).toContain('env . --apply --with="раннер тестов";');
    expect(tools).toContain("перейти — новая пустая посадка");
    const mixed = foreignOffer([
      { axis: "раннер тестов", what: "jest", tool: "test" },
      { axis: "структура", what: "рабочие пространства", tool: null },
    ]).join("\n");
    expect(mixed).not.toContain("--with=");
    expect(mixed).toContain("переставить нельзя одной командой: чужое здесь не только инструменты (структура)");
  });
});

/** Версия среды ниже связки лежит у проекта до трёх мест — файл семени, его
 * другие имена из карты, поле манифеста, — и план стека спрашивает каждое,
 * что есть на диске. Шаг 6.1 прогона `2026-11-14`: мутант, снявший любое из
 * мест, проходил тесты. */
describe("осмотр стека получает каждое место версии среды", () => {
  it("файл семени, его другое имя и поле манифеста — в плане; файла, которого нет, — нет", () => {
    const project = CORPUS.projects.find((p) => p.name === "exact-seed");
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-node-"));
    try {
      for (const [rel, text] of Object.entries(project.files)) {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      }
      const manifest = JSON.parse(project.files["package.json"]);
      fs.writeFileSync(path.join(box, "package.json"), JSON.stringify({ ...manifest, volta: { node: "20.11.0" } }));
      fs.writeFileSync(path.join(box, ".nvmrc"), "20\n");
      fs.writeFileSync(path.join(box, ".node-version"), "v18.19.0\n");
      const plan = scenarioByShelf({ root: box, shelf: SHELF }).survey.plan.filter((one) => one.section === "versionFile" || one.section === "pin");
      expect(plan.map(({ name, from, section }) => ({ name, from, section }))).toEqual([
        { name: ".nvmrc", from: "20", section: "versionFile" },
        { name: ".node-version", from: "18.19.0", section: "versionFile" },
        { name: "volta.node", from: "20.11.0", section: "pin" },
      ]);
      // Карта без записи о файле версии — мест версии нет, а не падение.
      const seed = JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "templates", "package.json"), "utf8").replace(/^﻿/, ""));
      const bare = scenarioOf({ root: box, map: {}, seed }).survey.plan;
      expect(bare.filter((one) => one.section === "versionFile" || one.section === "pin")).toEqual([]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

describe("манифест проекта — один читатель", () => {
  it("нет файла — null; BOM — как без него; битый, null и массив — ошибка с именем файла", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-of-"));
    const put = (text) => fs.writeFileSync(path.join(box, "package.json"), text);
    try {
      expect(manifestOf(box)).toBeNull();
      put('\uFEFF{ "name": "a", "devDependencies": { "vitest": "4.1.11" } }');
      expect(manifestOf(box)).toEqual({ name: "a", devDependencies: { vitest: "4.1.11" } });
      put('{ "name": "a\uFEFFb" }');
      expect(manifestOf(box)).toEqual({ name: "a\uFEFFb" });
      put('{\n<<<<<<< HEAD\n  "name": "a"\n=======\n}\n');
      expect(() => manifestOf(box)).toThrow("package.json проекта не разбирается как JSON");
      for (const text of ["null", "[]", "3"]) {
        put(text);
        expect(() => manifestOf(box), text).toThrow("package.json проекта — не объект JSON");
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});
