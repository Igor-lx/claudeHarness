import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEAT_PACKAGES, TOOL_DIR } from "./graph.modes.shared.mjs";

/**
 * Корпус посадок. Обвязку проверяли на проектах, которые она сама и
 * создала: посадка, магазин, стенд собраны из её семян её же написанием.
 * Здесь проекты собраны не из семян, по одному на форму, которую посадка
 * обязана встретить, и каждый сажается той же командой, что у человека, —
 * `seat .` из полки, скопированной в проект. Решено разработчиком
 * `2026-10-30`: каждый проект получает свой сценарий, посадку кодом ноль и
 * сверку базы кодом ноль, а чужой — перечень того, чего обвязка не видит.
 * Эталона находок нет: посадка, после которой сверка красная, — поломка.
 */
const CORPUS = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, "foreign-corpus.json"), "utf8"));
const SHELF = path.join(TOOL_DIR, "..");
const OWN_IN_SHELF = new Set(
  JSON.parse(fs.readFileSync(path.join(SHELF, "seat", "map.json"), "utf8")).projectOwnedInsideHarness ?? [],
);
const FOREIGN_HEAD = "=== Чужое окружение — не проверено (предупреждение, прогон не роняет) ===";

const git = (box, ...args) => execFileSync("git", args, { cwd: box, encoding: "utf8" }).trim();

/** Проект с историей и полкой в `.claude`, как его оставляет человек перед
 * командой посадки. */
const plant = (project) => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-" + project.name + "-"));
  for (const [rel, text] of Object.entries(project.files)) {
    fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
    fs.writeFileSync(path.join(box, rel), project.crlf === true ? text.replace(/\n/g, "\r\n") : text);
  }
  if (Object.keys(project.files).length > 0) {
    git(box, "init", "-q");
    git(box, "config", "user.email", "corpus@example.com");
    git(box, "config", "user.name", "corpus");
    git(box, "config", "core.autocrlf", "false");
    git(box, "add", "-A");
    git(box, "commit", "-qm", "project", "--no-verify");
    if (project.hooksPath !== undefined) git(box, "config", "core.hooksPath", project.hooksPath);
  }
  fs.cpSync(SHELF, path.join(box, ".claude"), {
    recursive: true,
    filter: (src) => !(path.dirname(src) === SHELF && OWN_IN_SHELF.has(path.basename(src))),
  });
  return box;
};

const tool = (box, ...args) => {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_CHILD_SESSION;
  return spawnSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), ...args], {
    cwd: box,
    encoding: "utf8",
    env,
  });
};

describe("корпус посадок", () => {
  it("у каждого проекта назван сценарий посадки, у чужого — его чужие оси", () => {
    const wrong = CORPUS.projects
      .filter(
        (p) =>
          !["empty", "familiar", "foreign"].includes(p.scenario) ||
          (p.scenario === "foreign") !== Array.isArray(p.foreignAxes),
      )
      .map((p) => p.name);
    expect(wrong).toEqual([]);
  });

  describe.concurrent("посадка командой", () => {
    for (const project of CORPUS.projects)
      it(
        project.name + " — " + project.scenario + ": " + project.axis,
        () => {
          const box = plant(project);
          try {
            const seat = tool(
              box,
              "seat",
              ".",
              ...(project.scenario === "foreign" ? [] : ["--apply", "--packages", path.dirname(SEAT_PACKAGES)]),
            );
            expect(seat.status, seat.stdout + seat.stderr).toBe(0);
            expect(seat.stderr).toBe("");
            const verify = tool(box, "verify", "--full");
            expect(verify.status, verify.stdout).toBe(0);
            expect(verify.stdout).toContain("  упало исключением: 0");
            const config = fs.readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8");
            expect(config).toContain('  scenario: "' + project.scenario + '",');
            const named = (verify.stdout.split(FOREIGN_HEAD)[1] ?? "").split("\n===")[0];
            for (const axis of project.foreignAxes ?? [])
              expect(named).toContain("    " + axis + " — чужое окружение");
            if (project.scenario === "foreign") expect(seat.stdout).toContain("перейти — новая пустая посадка");
            // Связи, которых сверка не печатает: куда ведёт импорт.
            for (const one of project.briefs ?? []) {
              const brief = tool(box, "brief", one.file);
              expect(brief.status, one.file).toBe(0);
              for (const line of one.has) expect(brief.stdout).toContain(line);
              for (const line of one.hasNot ?? []) expect(brief.stdout).not.toContain(line);
            }
          } finally {
            fs.rmSync(box, { recursive: true, force: true });
          }
        },
        600000,
      );
  });
});
