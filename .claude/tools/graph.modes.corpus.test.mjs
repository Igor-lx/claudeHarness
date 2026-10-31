import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEAT_PACKAGES, TOOL_DIR } from "./graph.modes.shared.mjs";
import { runTool } from "./graph.seat.mjs";

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
    // Хук проекта исполняем: иначе git на Linux его пропускает, а на Windows
    // запускает, и посадка проверялась бы на двух системах по-разному.
    const hook = project.hooksPath !== undefined && rel.startsWith(project.hooksPath + "/");
    fs.writeFileSync(path.join(box, rel), project.crlf === true ? text.replace(/\n/g, "\r\n") : text, {
      mode: hook ? 0o755 : 0o644,
    });
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

/** Файлы проекта с содержимым — снимок до посадки. */
const snapshot = (box) => {
  if (!fs.existsSync(path.join(box, ".git"))) return new Map();
  return new Map(
    git(box, "ls-files")
      .split("\n")
      .filter(Boolean)
      .map((rel) => [rel, fs.readFileSync(path.join(box, rel))]),
  );
};
/** `npm` — через запуск инструмента: на Windows это `npm.cmd`, и без оболочки
 * он не запускается. */
const npm = (box, ...args) => {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_CHILD_SESSION;
  return runTool("npm", args, { cwd: box, env });
};
/** Что посадка вправе сделать с файлом проекта: знакомому — дописать
 * списки и манифест и положить свой конфиг рядом под проектным именем;
 * чужому — дописать только исключения git. Прочее — байт в байт. */
const OWN_CHANGED = {
  familiar: [".gitignore", ".gitattributes", ".prettierignore", "package.json", ".claude/settings.json"],
  foreign: [".gitignore", ".claude/settings.json"],
};
const besideName = (rel) =>
  rel === "CLAUDE.md"
    ? "CLAUDE.project.md"
    : /^\.eslintrc/.test(rel)
      ? rel.replace(/^\.eslintrc/, ".eslintrc.project")
      : rel.replace(/\.(config|conf)\./, (m, word) => ".project." + word + ".");

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
            const before = snapshot(box);
            const hooksBefore = before.size > 0 ? spawnSync("git", ["config", "core.hooksPath"], { cwd: box, encoding: "utf8" }).stdout.trim() : "";
            const commitsBefore = before.size > 0 ? Number(git(box, "rev-list", "--count", "HEAD")) : 0;
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
            // Тесты вне `tests/` держит число пункта долга, а не список папок.
            expect(config).toContain("  testsOutside: null,");
            const named = (verify.stdout.split(FOREIGN_HEAD)[1] ?? "").split("\n===")[0];
            for (const axis of project.foreignAxes ?? [])
              expect(named).toContain("    " + axis + " — чужое окружение");
            if (project.scenario === "foreign") expect(seat.stdout).toContain("перейти — новая пустая посадка");
            // Посажено как задумано: всё закоммичено двумя коммитами поверх
            // истории проекта, файлы проекта не тронуты сверх названного,
            // ворота — по сценарию, песочниц не осталось, второй вызов
            // говорит «уже сделана», не тронув ничего.
            expect(git(box, "status", "--porcelain")).toBe("");
            expect(Number(git(box, "rev-list", "--count", "HEAD"))).toBe(commitsBefore + 2);
            // Пустой папке шаблон сборщика посадка снимает по устройству.
            const allowed = OWN_CHANGED[project.scenario] ?? [];
            const touched = [];
            for (const [rel, bytes] of project.scenario === "empty" ? [] : before) {
              const at = path.join(box, rel);
              if (fs.existsSync(at) && fs.readFileSync(at).equals(bytes)) continue;
              if (fs.existsSync(at) && allowed.includes(rel)) continue;
              const beside = path.join(box, besideName(rel));
              // Перенесён рядом: на своём месте его нет либо лежит файл обвязки.
              if (project.scenario === "familiar" && fs.existsSync(beside) && fs.readFileSync(beside).equals(bytes)) continue;
              touched.push(rel);
            }
            expect(touched, "файлы проекта, тронутые посадкой").toEqual([]);
            const hooks = spawnSync("git", ["config", "core.hooksPath"], { cwd: box, encoding: "utf8" }).stdout.trim();
            expect(hooks).toBe(project.scenario === "foreign" ? hooksBefore : ".claude/hooks/git");
            // Свой хук проекта посадка не обходит: оба её коммита прошли через него.
            if (project.hooksPath !== undefined)
              expect(fs.readFileSync(path.join(box, ".git", "hook-ran"), "utf8").trim().split("\n")).toHaveLength(2);
            if (project.scenario === "foreign") expect(fs.existsSync(path.join(box, "node_modules"))).toBe(false);
            for (const left of [".stryker-tmp", ".проба-сверок", "reports"]) expect(fs.existsSync(path.join(box, left)), left).toBe(false);
            const head = git(box, "rev-parse", "HEAD");
            const again = tool(box, "seat", ".");
            expect(again.status, again.stdout).toBe(0);
            expect(again.stdout).toContain("=== Посадка уже сделана ===");
            expect(git(box, "rev-parse", "HEAD")).toBe(head);
            expect(git(box, "status", "--porcelain")).toBe("");
            // Звенья знакомого проекта зелены на долге, тесты проекта —
            // зелены либо названы пунктом долга перехода; пустая папка
            // проходит всю цепочку.
            if (project.scenario === "familiar") {
              for (const link of ["typecheck", "lint"]) expect(npm(box, "run", "-s", link).status, link).toBe(0);
              const facts = fs.readFileSync(path.join(box, ".context", "01-facts.md"), "utf8");
              if (npm(box, "test").status !== 0) {
                expect(facts).toMatch(/\| `test` \| красно: падают файлов тестов `\d+`/);
                expect(fs.readFileSync(path.join(box, ".context", "15-transition.md"), "utf8")).toContain("Тесты проекта красные");
              } else expect(facts).toMatch(/\| `test` \| зелено/);
            }
            if (project.scenario === "empty") {
              const chain = npm(box, "run", "-s", "check");
              expect(chain.status, chain.out).toBe(0);
            }
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
