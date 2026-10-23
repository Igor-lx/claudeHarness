import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BAR_CHECK_KINDS } from "./graph.predicates.mjs";
import {
  TOOL_DIR,
  seatEmpty,
  withTransitionDebt,
  verifyIn,
  sectionOf,
  askedIn,
  barRowsCited,
  fillWitness,
  WITNESS_ASKED,
  fillWords,
  fillBar,
  partsMerged,
  fakeCheck,
  seriesStaged,
  answersOf,
  readdirOf,
} from "./graph.modes.shared.mjs";

// Тесты режимов, часть 1 из 3: файлы делят набор, чтобы он шёл параллельно.

/**
 * Ворота конца хода спрашивают свод с рабочего дерева, когда сессия
 * заканчивает ход. Держит: отказ без свода, пауза только на свой вид правки,
 * клапан против петли со следом для следующей сессии и снятие всего этого
 * запечатанным сводом.
 */
describe("ворота конца хода", () => {
  it("отказ, пауза на вид правки, клапан со следом, печать снимает всё", () => {
    const box = seatEmpty("stop-");
    try {
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=stop", "-c", "user.email=stop@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(process.execPath, [graph, ...args], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const hook = () =>
        spawnSync(process.execPath, [graph, "stop", "--hook"], {
          cwd: box,
          encoding: "utf8",
          input: "{}",
        });
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      expect(hook().status).toBe(0);
      const at = path.join(box, "src", "app", "zzStop.ts");
      fs.writeFileSync(at, "export const zzStop = 1;\n");
      // Начало сессии называет правку без свода человеку и агенту.
      const opened = JSON.parse(tool("stop", "--session"));
      expect(opened.systemMessage).toContain("правка кода без свода");
      expect(opened.systemMessage).toContain("app/zzStop.ts");
      expect(opened.hookSpecificOutput).toEqual({
        hookEventName: "SessionStart",
        additionalContext: opened.systemMessage,
      });
      const stopped = hook();
      expect(stopped.status).toBe(2);
      expect(stopped.stderr).toContain("app/zzStop.ts");
      tool("stop", "--pause", "жду ответа о границе");
      expect(hook().status).toBe(0);
      expect(tool("stop", "--session")).toContain(
        "незаконченная работа — жду ответа о границе",
      );
      // Правки между сессиями не стало — пауза ни о чём, и начало сессии
      // о ней молчит.
      fs.renameSync(at, at + ".off");
      expect(tool("stop", "--session")).toBe("");
      fs.renameSync(at + ".off", at);
      // Правка после паузы: пауза о прежнем виде, ход снова не кончается.
      fs.writeFileSync(at, "export const zzStop = 2;\n");
      expect(hook().status).toBe(2);
      expect(hook().status).toBe(2);
      // Третий отказ подряд — клапан: ход кончается, след остаётся, и
      // человек узнаёт об этом строкой.
      const valve = hook();
      expect(valve.status).toBe(0);
      expect(JSON.parse(valve.stdout).systemMessage).toContain(
        "третий отказ подряд",
      );
      const told = tool("stop", "--session");
      expect(told).toContain("ход кончен без свода");
      expect(told).not.toContain("незаконченная работа");
      // След называет ту же правку — второй строкой о ней не говорят.
      expect(told).not.toContain("правка кода без свода");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "Дальше — `node .claude/tools/graph.mjs tested`",
      );
      expect(hook().status).toBe(0);
      expect(tool("stop", "--session")).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("сосед либо политика сменились после печати — ход не кончается, вернули — кончается", () => {
    const box = seatEmpty("stop-ground-");
    try {
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=stop",
            "-c",
            "user.email=stop@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(process.execPath, [graph, ...args], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const hook = () =>
        spawnSync(process.execPath, [graph, "stop", "--hook"], {
          cwd: box,
          encoding: "utf8",
          input: "{}",
        });
      const nearAt = path.join(box, "src", "shared", "zzBase", "zzBase.ts");
      fs.mkdirSync(path.dirname(nearAt), { recursive: true });
      fs.writeFileSync(
        nearAt,
        "export const zzBase = (n: number): number => n + 1;\n",
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      fs.writeFileSync(
        path.join(box, "src", "app", "zzUse.ts"),
        'import { zzBase } from "../shared/zzBase/zzBase";\n\nexport const zzUse = (n: number): number => zzBase(n) * 2;\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain(
        "- сосед: `shared/zzBase/zzBase.ts`",
      );
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(tool("bar")).toContain("печать поставлена");
      expect(hook().status).toBe(0);
      // Сосед сменился чужим коммитом под запечатанным сводом: в предмет он
      // не входит, правка в рабочем дереве та же.
      const near = fs.readFileSync(nearAt, "utf8");
      const commitNear = (text) => {
        fs.writeFileSync(nearAt, text);
        git("add", nearAt);
        git("commit", "-qm", "сосед", "--no-verify");
      };
      commitNear(near.replace("n + 1", "n + 2"));
      const moved = hook();
      expect(moved.status).toBe(2);
      expect(moved.stderr).toContain(
        "основание свода сменилось после печати — соседи области: shared/zzBase/zzBase.ts",
      );
      commitNear(near);
      expect(hook().status).toBe(0);
      // Политика качества сменилась.
      const policyAt = path.join(box, ".claude", "rules", "quality.md");
      const policy = fs.readFileSync(policyAt, "utf8");
      fs.writeFileSync(policyAt, policy + "\n");
      const ruled = hook();
      expect(ruled.status).toBe(2);
      expect(ruled.stderr).toContain(
        "основание свода сменилось после печати — политика качества",
      );
      fs.writeFileSync(policyAt, policy);
      expect(hook().status).toBe(0);
      // Инструмент — каждый его модуль: вход, словарь и вынесенный разбор
      // кода, который строит модель. Тесты инструмента основанием не служат.
      for (const name of [
        "graph.mjs",
        "graph.predicates.mjs",
        "graph.parse.mjs",
      ]) {
        const toolAt = path.join(box, ".claude", "tools", name);
        const tool = fs.readFileSync(toolAt, "utf8");
        fs.writeFileSync(toolAt, tool + "\n");
        const retooled = hook();
        expect(retooled.status, name).toBe(2);
        expect(retooled.stderr).toContain(
          "основание свода сменилось после печати — инструмент",
        );
        fs.writeFileSync(toolAt, tool);
        expect(hook().status, name).toBe(0);
      }
      const testAt = path.join(box, ".claude", "tools", "graph.parse.test.mjs");
      fs.appendFileSync(testAt, "\n");
      expect(hook().status).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("без git начало сессии говорит, что ворота правку не проверяют", () => {
    const box = seatEmpty("stop-bez-git-");
    try {
      const said = JSON.parse(
        execFileSync(
          process.execPath,
          [
            path.join(box, ".claude", "tools", "graph.mjs"),
            "stop",
            "--session",
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
      expect(said.systemMessage).toContain("репозитория нет");
      expect(said.hookSpecificOutput.additionalContext).toBe(
        said.systemMessage,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Хуки зовут обёртку запуском без оболочки: режим и ключи лежат в `args`.
 * Сверки, искавшие вызов в одной строке команды, его не видели. Путь от
 * текущей папки из подпапки сессии инструмента не находит, вызов мимо обёртки
 * кончает ход при отказе инструмента, а поле `disableAllHooks` выключает хуки,
 * не трогая их объявления.
 */
describe("хуки обвязки стоят и исполнимы из любой папки", () => {
  it("вызов в `args` виден; путь от текущей папки, мимо обёртки и выключенные хуки названы", () => {
    const box = seatEmpty("huki-");
    try {
      const at = path.join(box, ".claude", "settings.json");
      const seed = fs.readFileSync(at, "utf8");
      const said = (section) => (verifyIn(box).get(section) ?? []).join("\n");
      const GATES = "Ворота конца хода и страж обхода включены";
      const REMIND = "Напоминание о переходе включено";
      withTransitionDebt(box, []);
      expect(said(GATES)).toBe("");
      expect(said(REMIND)).toBe("");
      fs.writeFileSync(
        at,
        seed.replace('"transition",\n              "--hook"', '"transition"'),
      );
      expect(said(REMIND)).toContain("без `--hook`");
      fs.writeFileSync(
        at,
        seed.replace(
          '"${CLAUDE_PROJECT_DIR}/.claude/tools/hook.mjs"',
          '".claude/tools/hook.mjs"',
        ),
      );
      expect(said(GATES)).toContain("не от каталога проекта");
      fs.writeFileSync(
        at,
        seed.replace(
          '"${CLAUDE_PROJECT_DIR}/.claude/tools/hook.mjs"',
          '"${CLAUDE_PROJECT_DIR}/.claude/tools/graph.mjs"',
        ),
      );
      expect(said(GATES)).toContain("мимо обёртки");
      expect(said(GATES)).not.toContain("не от каталога проекта");
      fs.writeFileSync(at, seed);
      expect(seed).toContain('"matcher": "Bash|Read"');
      fs.writeFileSync(
        at,
        seed.replace('"matcher": "Bash|Read"', '"matcher": "Bash"'),
      );
      expect(said(GATES)).toContain("вызов Read");
      fs.writeFileSync(
        at,
        seed.replace('"matcher": "Bash|Read"', '"matcher": "Edit"'),
      );
      expect(said(GATES)).toContain("вызов Bash");
      expect(said(GATES)).toContain("вызов Read");
      fs.writeFileSync(at, seed);
      const wrapper = path.join(box, ".claude", "tools", "hook.mjs");
      fs.renameSync(wrapper, wrapper + ".hidden");
      expect(said(GATES)).toContain("обёртки хуков нет");
      fs.renameSync(wrapper + ".hidden", wrapper);
      expect(said(GATES)).toBe("");
      fs.writeFileSync(
        at,
        seed.replace('"hooks": {', '"disableAllHooks": true,\n  "hooks": {'),
      );
      expect(said(GATES)).toContain("в общем файле настроек");
      fs.writeFileSync(at, seed);
      fs.writeFileSync(
        path.join(box, ".claude", "settings.local.json"),
        '{ "disableAllHooks": true }\n',
      );
      expect(said(GATES)).toContain("в местном файле настроек");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Обёртка хуков отвечает за инструмент, который не отработал: среда держит ход
 * и вызов только кодом `2`, а упавший режим отдаёт `1`. Держит: у конца хода —
 * отказ с причиной, а повтор в том же запросе — пропуск со строкой человеку;
 * у стража — вопрос человеку для команд git; у начала сессии и напоминания —
 * строку человеку и агенту. Отработавший режим обёртка отдаёт как есть.
 */
describe("обёртка хуков держит, когда инструмент не отработал", () => {
  // Свой срок у вызова: синхронный запуск срок теста не прерывает, и
  // зависшая обёртка повесила бы весь прогон вместо падения теста.
  const ask = (box, args, said) =>
    spawnSync(
      process.execPath,
      [path.join(box, ".claude", "tools", "hook.mjs"), ...args],
      {
        cwd: box,
        encoding: "utf8",
        input: JSON.stringify(said),
        timeout: 30000,
      },
    );
  const json = (r) => (r.stdout.trim() === "" ? {} : JSON.parse(r.stdout));
  const bash = (command) => ({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
  const halt = (graph) =>
    graph.replace(
      "const mode = process.argv[2];",
      "const mode = process.argv[2];\nawait new Promise(() => setInterval(() => {}, 60000));",
    );

  it("чтение файла не затирает след стража: ворота коммита видят команду коммита, а не путь", () => {
    const box = seatEmpty("sled-");
    try {
      execFileSync("git", ["init", "-q"], { cwd: box });
      const traceAt = path.join(box, ".git", "claude-harness-guard.json");
      ask(box, ["guard", "--hook"], bash("git commit -m x"));
      const commit = JSON.parse(fs.readFileSync(traceAt, "utf8"));
      expect(commit.command).toBe("git commit -m x");
      const read = ask(box, ["guard", "--hook"], {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: path.join(box, "src", "app", "App.tsx") },
      });
      expect(read.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(traceAt, "utf8"))).toEqual(commit);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("обёртка не зависит от инструмента и настройки: она импортирует только встроенные модули", () => {
    const source = fs.readFileSync(path.join(TOOL_DIR, "hook.mjs"), "utf8");
    const loaded = [
      ...source.matchAll(
        /^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"|^import\s+"([^"]+)"/gm,
      ),
    ].map((m) => m[1] ?? m[2]);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.filter((one) => !one.startsWith("node:"))).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });

  it("сломанная настройка, отсутствующий инструмент, падение режима — у каждого хука", () => {
    const box = seatEmpty("obertka-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=obertka",
            "-c",
            "user.email=obertka@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      const graphAt = path.join(box, ".claude", "tools", "graph.mjs");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      const recordAt = path.join(box, ".git", "claude-harness-hook.json");
      const graph = fs.readFileSync(graphAt, "utf8");
      const cfg = fs.readFileSync(cfgAt, "utf8");

      // Отработавший режим — как есть: отказ стража с его причиной, конец
      // хода без правки кода.
      const bypass = ask(
        box,
        ["guard", "--hook"],
        bash("git commit --no-verify -m x"),
      );
      expect(bypass.status).toBe(2);
      expect(bypass.stderr).toContain("commit --no-verify");
      expect(
        ask(box, ["stop", "--hook"], {
          hook_event_name: "Stop",
          prompt_id: "p0",
        }).status,
      ).toBe(0);

      const failures = [
        [
          "сломанная настройка",
          () => fs.writeFileSync(cfgAt, "export const BASE = ;\n"),
          "SyntaxError",
        ],
        [
          "отсутствующий инструмент",
          () => fs.rmSync(graphAt),
          "Cannot find module",
        ],
        [
          "падение режима",
          () =>
            fs.writeFileSync(
              graphAt,
              graph.replace(
                "const mode = process.argv[2];",
                'const mode = process.argv[2];\nthrow new Error("проба падения режима");',
              ),
            ),
          "проба падения режима",
        ],
      ];
      for (const [kind, spoil, cause] of failures) {
        spoil();
        const turn = { hook_event_name: "Stop", prompt_id: kind };
        const held = ask(box, ["stop", "--hook"], turn);
        expect(held.status, kind).toBe(2);
        expect(held.stderr, kind).toContain("инструмент не отработал");
        expect(held.stderr, kind).toContain(cause);
        const again = ask(box, ["stop", "--hook"], turn);
        expect(again.status, kind).toBe(0);
        expect(json(again).systemMessage, kind).toContain(
          "второй раз за запрос",
        );
        expect(
          ask(box, ["stop", "--hook"], { ...turn, prompt_id: kind + "-2" })
            .status,
          kind,
        ).toBe(2);
        // Страж разбирается до настройки: сломанная настройка его не трогает.
        const commit = ask(box, ["guard", "--hook"], bash("git commit -m x"));
        expect(commit.status, kind).toBe(0);
        if (kind === "сломанная настройка")
          expect(commit.stdout, kind).toBe("");
        else {
          const said = json(commit).hookSpecificOutput;
          expect(said.permissionDecision, kind).toBe("ask");
          expect(said.permissionDecisionReason, kind).toContain(cause);
          const ls = ask(box, ["guard", "--hook"], bash("ls -la"));
          expect([ls.status, ls.stdout], kind).toEqual([0, ""]);
        }
        for (const [args, event] of [
          [["stop", "--session"], "SessionStart"],
          [["transition"], "SessionStart"],
          [["transition", "--hook"], "PreToolUse"],
        ]) {
          const told = ask(box, args, { hook_event_name: event });
          expect(told.status, kind + ": " + args.join(" ")).toBe(0);
          const said = json(told);
          expect(said.systemMessage, kind + ": " + args.join(" ")).toContain(
            cause,
          );
          expect(said.hookSpecificOutput, kind + ": " + args.join(" ")).toEqual(
            {
              hookEventName: event,
              additionalContext: said.systemMessage,
            },
          );
        }
        fs.writeFileSync(graphAt, graph);
        fs.writeFileSync(cfgAt, cfg);
      }

      // Отработавший инструмент снимает запись клапана: следующий отказ в
      // том же запросе снова держит ход.
      expect(fs.existsSync(recordAt)).toBe(true);
      expect(
        ask(box, ["stop", "--hook"], {
          hook_event_name: "Stop",
          prompt_id: "падение режима",
        }).status,
      ).toBe(0);
      expect(fs.existsSync(recordAt)).toBe(false);

      // Запись клапана не ложится — ход не держится: петлю нечем прервать.
      fs.mkdirSync(recordAt);
      fs.rmSync(graphAt);
      const loose = ask(box, ["stop", "--hook"], {
        hook_event_name: "Stop",
        prompt_id: "p9",
      });
      expect(loose.status).toBe(0);
      expect(json(loose).systemMessage).toContain("запись клапана не легла");
      fs.writeFileSync(graphAt, graph);
      fs.rmSync(recordAt, { recursive: true });
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("зависший режим называет обёртка, а без git клапан стоит во временной папке", () => {
    const box = seatEmpty("obertka-bez-git-");
    try {
      const hookAt = path.join(box, ".claude", "tools", "hook.mjs");
      const graphAt = path.join(box, ".claude", "tools", "graph.mjs");
      const wrapper = fs.readFileSync(hookAt, "utf8");
      const graph = fs.readFileSync(graphAt, "utf8");
      expect(wrapper).toContain("const LIMIT_S = 120;");
      fs.writeFileSync(
        hookAt,
        wrapper.replace("const LIMIT_S = 120;", "const LIMIT_S = 2;"),
      );
      fs.writeFileSync(graphAt, halt(graph));
      const turn = { hook_event_name: "Stop", prompt_id: "zavis" };
      const held = ask(box, ["stop", "--hook"], turn);
      expect(held.status).toBe(2);
      expect(held.stderr).toContain("не ответил за 2 с");
      expect(ask(box, ["stop", "--hook"], turn).status).toBe(0);
      const commit = json(
        ask(box, ["guard", "--hook"], bash("git commit -m x")),
      );
      expect(commit.hookSpecificOutput.permissionDecisionReason).toContain(
        "не ответил за 2 с",
      );
      // Отработавший инструмент снимает запись и без git.
      fs.writeFileSync(graphAt, graph);
      expect(ask(box, ["stop", "--hook"], turn).status).toBe(0);
      fs.writeFileSync(graphAt, halt(graph));
      expect(ask(box, ["stop", "--hook"], turn).status).toBe(2);
      fs.writeFileSync(graphAt, graph);
      expect(ask(box, ["stop", "--hook"], turn).status).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Пути берутся у git с ключом `-z`. Без него git берёт имя не в ASCII и с
 * пробелом в кавычки с восьмеричными кодами, и разбор его не узнавал: такой
 * файл выпадал из предмета конца хода, ворот и ревизии, и правка в нём
 * проходила без свода.
 */
describe("пути из git с кириллицей и пробелом", () => {
  it("попадают в предмет конца хода, ворот и ревизии", () => {
    const box = seatEmpty("puti-");
    try {
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=puti",
            "-c",
            "user.email=puti@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const run = (...args) =>
        spawnSync(process.execPath, [graph, ...args], {
          cwd: box,
          encoding: "utf8",
          input: "{}",
        });
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs
          .readFileSync(cfgAt, "utf8")
          .replace(
            "  barSince: null,",
            '  barSince: "' + git("rev-parse", "HEAD").trim() + '",',
          ),
      );
      git("commit", "-qam", "основание сводов", "--no-verify");
      const names = ["кириллица.ts", "с пробелом.ts"];
      for (const name of names)
        fs.writeFileSync(
          path.join(box, "src", "app", name),
          "export const zz = 1;\n",
        );
      const stop = run("stop", "--hook");
      expect(stop.status).toBe(2);
      for (const name of names) expect(stop.stderr).toContain("app/" + name);
      git("add", "-A");
      const gate = run("gate");
      expect(gate.status).toBe(1);
      for (const name of names) expect(gate.stdout).toContain("app/" + name);
      // Ревизия: каждый файл — своим коммитом мимо ворот, оба без свода.
      git("reset", "-q");
      for (const name of names) {
        git("add", path.join("src", "app", name));
        git("commit", "-qm", "мимо свода: " + name, "--no-verify");
      }
      const rows = run("verify").stdout.split("\n");
      const at = rows.indexOf("=== Коммит с кодом накрыт сводом ===");
      expect(at).toBeGreaterThan(-1);
      expect(rows.slice(at + 1, at + 3)).toContain("  без свода: 2");
      // Сверка новых якорей берёт новый файл базы у git, а имя правленого —
      // из заголовка диффа: оба обязаны прийти как на диске.
      const note = ".context/заметка с пробелом.md";
      fs.writeFileSync(
        path.join(box, note),
        "Якорь `src/app/App.tsx:1` без цитаты.\n",
      );
      expect(run("verify").stdout).toContain(
        note + ": `src/app/App.tsx:1` — якорь без цитаты",
      );
      git("add", "-A");
      git("commit", "-qm", "заметка", "--no-verify");
      fs.appendFileSync(
        path.join(box, note),
        "Ещё `src/app/App.tsx:2` без цитаты.\n",
      );
      expect(run("verify").stdout).toContain(
        note + ": `src/app/App.tsx:2` — якорь без цитаты",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Хуки, объявленные верно, могут не исполняться: сессия, стартовавшая выше
 * проекта, его настроек не читает. Исполнение доказывает след стража, который
 * обёртка пишет на каждом вызове Bash; ворота и сверка базы, запущенные
 * сессией, требуют его свежим, а ворота — ещё и о коммите.
 */
describe("хуки исполняются: след стража", () => {
  it("обёртка пишет след; ворота и сверка из сессии требуют его свежим", () => {
    const box = seatEmpty("sled-");
    try {
      const tools = path.join(box, ".claude", "tools");
      const session = { ...process.env, CLAUDE_CODE_CHILD_SESSION: "1" };
      const run = (args, env = process.env) =>
        spawnSync(process.execPath, [path.join(tools, "graph.mjs"), ...args], {
          cwd: box,
          encoding: "utf8",
          input: "{}",
          env,
        });
      const guard = (command) =>
        spawnSync(
          process.execPath,
          [path.join(tools, "hook.mjs"), "guard", "--hook"],
          {
            cwd: box,
            encoding: "utf8",
            input: JSON.stringify({
              hook_event_name: "PreToolUse",
              tool_name: "Bash",
              tool_input: { command },
            }),
          },
        );
      const HOOKS = "=== Хуки проекта исполняются в этой сессии ===";
      const said = (env) => {
        const rows = run(["verify"], env).stdout.split("\n");
        const at = rows.indexOf(HOOKS);
        expect(at).toBeGreaterThan(-1);
        return rows.slice(at + 1, at + 4).join("\n");
      };
      execFileSync("git", ["init", "-q"], { cwd: box });
      const traceAt = path.join(box, ".git", "claude-harness-guard.json");

      // Следа нет: из сессии ворота держат, сверка называет; вне — тихо.
      const held = run(["gate"], session);
      expect(held.status).toBe(1);
      expect(held.stdout).toContain("хуки проекта не исполняются");
      expect(held.stdout).toContain("/cd");
      expect(run(["gate"]).status).toBe(0);
      expect(said(session)).toContain("не исполняются");
      expect(said(process.env)).toContain("прогон не из сессии");

      // Обёртка пишет след на вызове Bash; коммит и сверка проходят.
      guard("git commit -m x");
      expect(JSON.parse(fs.readFileSync(traceAt, "utf8")).command).toBe(
        "git commit -m x",
      );
      expect(run(["gate"], session).status).toBe(0);
      expect(said(session)).toContain("след стража свежий");

      // Последний вызов не коммит: ворота держат, сверке довольно свежести.
      guard("ls -la");
      const notCommit = run(["gate"], session);
      expect(notCommit.status).toBe(1);
      expect(notCommit.stdout).toContain("не коммит");
      expect(said(session)).toContain("след стража свежий");

      // След старше окна: держат и ворота, и сверка.
      fs.writeFileSync(
        traceAt,
        JSON.stringify({
          at: "2000-01-01T00:00:00.000Z",
          command: "git commit",
        }),
      );
      expect(run(["gate"], session).stdout).toContain("старше окна");
      expect(said(session)).toContain("старше окна");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Удаление кода — тоже правка. Предмет собирался из корпуса, а корпус — обходом
 * диска, и удалённый файл в него не попадал: удалённый тест проходил конец
 * хода, ворота и ревизию. Теперь удалённое входит в предмет с отпечатком «нет
 * файла» и держит ход и коммит, пока свод его не назовёт.
 */
describe("удалённый файл кода в предмете", () => {
  it("удалённые модуль и тест держат конец хода и ворота, пока свод их не назовёт", () => {
    const box = seatEmpty("udalen-");
    try {
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=udalen",
            "-c",
            "user.email=udalen@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const run = (...args) =>
        spawnSync(process.execPath, [graph, ...args], {
          cwd: box,
          encoding: "utf8",
          input: "{}",
        });
      const app = path.join(box, "src", "app");
      fs.writeFileSync(
        path.join(app, "zzDel.ts"),
        "export const zzDel = (n: number): number => n + 1;\n",
      );
      fs.writeFileSync(
        path.join(app, "tests", "zzDel.test.ts"),
        [
          'import { expect, it } from "vitest";',
          'import { zzDel } from "../zzDel";',
          "",
          'it("adds one", () => {',
          "  expect(zzDel(1)).toBe(2);",
          "});",
          "",
        ].join("\n"),
      );
      fakeCheck(box);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      fs.rmSync(path.join(app, "zzDel.ts"));
      fs.rmSync(path.join(app, "tests", "zzDel.test.ts"));
      const names = ["app/zzDel.ts", "app/tests/zzDel.test.ts"];
      const stop = run("stop", "--hook");
      expect(stop.status).toBe(2);
      for (const name of names) expect(stop.stderr).toContain(name);
      git("add", "-A");
      const gate = run("gate");
      expect(gate.status).toBe(1);
      for (const name of names) expect(gate.stdout).toContain(name);
      // Свод называет удалённое отпечатком «нет файла» — ход и коммит идут.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      run("bar");
      const said = fs.readFileSync(protoAt, "utf8");
      for (const name of names) expect(said).toContain(name);
      expect(said).toContain("нет файла");
      // Строка предмета об удалённом — законная запись, а не битый путь:
      // иначе цепочка красна на самом протоколе, и удаление не коммитится.
      const pathsOf = () =>
        (verifyIn(box).get("Пути в обратных кавычках") ?? []).filter((l) =>
          l.includes("bar-protocol.md"),
        );
      expect(pathsOf()).toEqual([]);
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(run("bar").stdout).toContain("печать поставлена");
      expect(run("stop", "--hook").status).toBe(0);
      seriesStaged(box);
      expect(run("gate").status).toBe(0);
      // Переименование `git mv`: прежний путь — удалённый, и свод, ход и
      // ворота видят оба пути, как после `mv`.
      git("commit", "-qm", "снос со сводом", "--no-verify");
      fs.writeFileSync(path.join(app, "zzOld.ts"), "export const zzOld = 1;\n");
      git("add", "-A");
      git("commit", "-qm", "файл под переименование", "--no-verify");
      git("mv", "src/app/zzOld.ts", "src/app/zzNew.ts");
      const moved = run("stop", "--hook");
      expect(moved.status).toBe(2);
      for (const name of ["app/zzOld.ts", "app/zzNew.ts"])
        expect(moved.stderr).toContain(name);
      run("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain("app/zzOld.ts");
      expect(pathsOf()).toEqual([]);
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(run("bar").stdout).toContain("печать поставлена");
      expect(run("stop", "--hook").status).toBe(0);
      seriesStaged(box);
      expect(run("gate").status).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Имя, которое потребитель берёт через бочку, взято и у самой бочки. Строка
 * поверхности считала взятым только имя, объявленное файлом сам, и у каждой
 * тронутой бочки писала «снаружи не берут» обо всех её именах — ложный
 * вопрос `B7` и `H4` (находка Н-8 плана `2026-10-20`).
 */
describe("поверхность бочки в модели свода", () => {
  it("имена, взятые через бочку, у неё взяты; не взятое никем — названо", () => {
    const box = seatEmpty("bochka-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=b", "-c", "user.email=b@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, stdio: ["ignore", "pipe", "pipe"] },
        );
      const area = path.join(box, "src", "shared", "zzArea");
      const use = path.join(box, "src", "components", "ZzUse");
      fs.mkdirSync(area, { recursive: true });
      fs.mkdirSync(use, { recursive: true });
      fs.writeFileSync(path.join(area, "zzA.ts"), "export const zzA = (n: number): number => n + 1;\n");
      fs.writeFileSync(path.join(area, "index.ts"), 'export { zzA } from "./zzA";\n');
      fs.writeFileSync(
        path.join(use, "ZzUse.tsx"),
        'import { zzA } from "../../shared/zzArea";\n\nexport const ZzUse = () => <p>{zzA(1)}</p>;\n',
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "база", "--no-verify");
      fs.writeFileSync(path.join(area, "zzB.ts"), "export const zzB = (n: number): number => n - 1;\n");
      fs.appendFileSync(path.join(area, "index.ts"), 'export { zzB } from "./zzB";\n');
      git("add", "-A");
      spawnSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "bar"], {
        cwd: box,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const row = fs
        .readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8")
        .split("\n")
        .find((l) => /\| поверхность \| `shared\/zzArea\/index\.ts` \|/.test(l));
      expect(row, "строка поверхности бочки").toBeDefined();
      expect(row).toContain("имена: zzA, zzB");
      expect(row).toContain("снаружи не берут: zzB");
      expect(row).not.toMatch(/снаружи не берут: [^|]*zzA/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  // Удалённый узел уносит потребителя: имя, которое держит один тест,
  // мёртвое в коде, а файла с ним в предмете нет (находка Н-9).
  it("удаление: имя, которое брал удалённый, без потребителя — строка поверхности с пометкой", () => {
    const box = seatEmpty("sirota-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=s", "-c", "user.email=s@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, stdio: ["ignore", "pipe", "pipe"] },
        );
      const area = path.join(box, "src", "shared", "zzLib");
      fs.mkdirSync(path.join(area, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(area, "zzLib.ts"),
        "export const zzOnly = (n: number): number => n + 1;\nexport const zzKept = (n: number): number => n - 1;\n",
      );
      fs.writeFileSync(
        path.join(area, "zzUser.ts"),
        'import { zzKept, zzOnly } from "./zzLib";\n\nexport const zzUser = (n: number): number => zzOnly(zzKept(n));\n',
      );
      fs.writeFileSync(
        path.join(area, "zzOther.ts"),
        'import { zzKept } from "./zzLib";\n\nexport const zzOther = (n: number): number => zzKept(n);\n',
      );
      fs.writeFileSync(
        path.join(area, "tests", "zzLib.test.ts"),
        'import { expect, it } from "vitest";\nimport { zzOnly } from "../zzLib";\n\nit("adds one", () => {\n  expect(zzOnly(1)).toBe(2);\n});\n',
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "база", "--no-verify");
      git("rm", "-q", "src/shared/zzLib/zzUser.ts");
      spawnSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "bar"], {
        cwd: box,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const rows = fs
        .readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8")
        .split("\n")
        .filter((l) => /\| поверхность \| `shared\/zzLib\/zzLib\.ts` \|/.test(l));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(
        "после удаления shared/zzLib/zzUser.ts снаружи не берут: zzOnly |",
      );
      expect(rows[0]).toMatch(/\| снято \| лишнее \|/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Печать — открытый отпечаток, и посчитать её можно руками. Протокол со
 * словом «чисто» в каждой пустой строке исхода и такой печатью проходил
 * ворота по одной печати, а сверку — по счёту исходов. Теперь ворота и сверка
 * принимают его тем же приёмом, что режим `bar` перед печатью.
 */
describe("печать, посчитанная руками", () => {
  it("ворота и сверка держат протокол, запечатанный мимо режима, и пропускают честный", () => {
    const box = seatEmpty("ruki-");
    try {
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=ruki",
            "-c",
            "user.email=ruki@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const run = (...args) =>
        spawnSync(process.execPath, [graph, ...args], {
          cwd: box,
          encoding: "utf8",
          input: "{}",
        });
      const barSection = () =>
        run("verify")
          .stdout.split("=== Планка пройдена покритериально ===")[1]
          .split("\n===")[0];
      fakeCheck(box);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      fs.writeFileSync(
        path.join(box, "src", "app", "zzRuki.ts"),
        "export const zzRuki = (n: number): number => n + 1;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      run("bar");
      // Подлог: «чисто» в каждой пустой клетке исхода, печать — руками.
      const blank = fs
        .readFileSync(protoAt, "utf8")
        .split("\n")
        .map((line) => {
          const c = line.split("|");
          if (
            c.length !== 9 ||
            !/^ [A-U][0-9]+(-[а-я]+)? $/.test(c[1]) ||
            c[4].trim() !== ""
          )
            return line;
          c[4] = " чисто ";
          return c.join("|");
        })
        .join("\n");
      expect(blank).toContain("| чисто |");
      const seal = createHash("sha1").update(blank).digest("hex").slice(0, 12);
      fs.writeFileSync(
        protoAt,
        blank.replace("- печать: `нет`", "- печать: `" + seal + "`"),
      );
      git("add", "-A");
      const gate = run("gate");
      expect(gate.status).toBe(1);
      expect(gate.stdout).toContain("печать стоит, а протокол не принят");
      expect(barSection()).toContain("протокол не принят:");
      // Честный свод тот же приём принимает: печать ставит режим, ворота
      // пропускают, сверка называет протокол принятым.
      fs.rmSync(protoAt);
      run("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(run("bar").stdout).toContain("печать поставлена");
      seriesStaged(box);
      expect(run("gate").status).toBe(0);
      expect(barSection()).toContain("свод закрыт печатью и принят");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("красная сверка-держатель режет печать", () => {
  it("«чисто» о строгости при снятой строгости не принимают ни свод, ни ворота, находку-вопрос — принимают", () => {
    const box = seatEmpty("derzh-");
    try {
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=derzh",
            "-c",
            "user.email=derzh@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const run = (...args) =>
        spawnSync(process.execPath, [graph, ...args], {
          cwd: box,
          encoding: "utf8",
          input: "{}",
        });
      fakeCheck(box);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      const tsAt = path.join(box, "tsconfig.json");
      const ts = fs.readFileSync(tsAt, "utf8");
      expect(ts).toContain('"strict": true');
      fs.writeFileSync(tsAt, ts.replace('"strict": true', '"strict": false'));
      const strictLine =
        ts.split("\n").findIndex((l) => l.includes('"strict"')) + 1;
      fs.writeFileSync(
        path.join(box, "src", "app", "zzRatio.ts"),
        "export const zzRatio = (a: number, b: number): number => a / b;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      expect(run("bar").stdout).toContain(
        "красна сверка-держатель о предмете строки: D1 («Строгость компилятора там, где проверяются типы»)",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { D1: "чисто |  | строгость объявлена конфигом | " },
      });
      const refused = run("bar").stdout;
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toContain(
        "D1: сверка «Строгость компилятора там, где проверяются типы» видит нарушение (tsconfig.json",
      );
      // Подлог мимо режима: та же «чисто», печать руками. Ворота считают
      // сверки сами и протокол не принимают.
      const body = fs.readFileSync(protoAt, "utf8");
      const seal = createHash("sha1").update(body).digest("hex").slice(0, 12);
      fs.writeFileSync(
        protoAt,
        body.replace("- печать: `нет`", "- печать: `" + seal + "`"),
      );
      git("add", "-A");
      const gate = run("gate");
      expect(gate.status).toBe(1);
      expect(gate.stdout).toContain(
        "D1: сверка «Строгость компилятора там, где проверяются типы» видит нарушение",
      );
      // Находка-развилка, названная списком вопросов, печать получает.
      fs.rmSync(protoAt);
      run("bar");
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\n## Вопрос 1. Строгость снята\n\n**Задан:** проба, `tsconfig.json`.\n\n" +
          "**Что решить.** Вернуть ли строгость.\n\n" +
          "**Последствие отсутствия ответа.** Типы проверяются без строгости.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          D1:
            "нашлось | tsconfig.json:" +
            strictLine +
            " | строгость снята | вопрос",
        },
        holds: { приложение: "нет" },
      });
      expect(run("bar").stdout).toContain("печать поставлена");
      seriesStaged(box);
      expect(run("gate").status).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("граф видит импорт во время работы", () => {
  it("`import()` против правила слоёв краснит направление и встаёт срезом в модели свода, цикл через `require` — цикл", () => {
    const box = seatEmpty("dinam-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const boot = path.join(box, "src", "shared", "boot");
      fs.mkdirSync(boot, { recursive: true });
      fs.writeFileSync(
        path.join(boot, "boot.ts"),
        'export const boot = () => import("../../app/App");\n',
      );
      expect(
        (verifyIn(box).get("Правила направления") ?? []).join("\n"),
      ).toContain("shared/boot/boot.ts → app/App.tsx");
      tool("bar", "shared/boot/boot.ts");
      expect(
        fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8"),
      ).toMatch(
        /\| П\d+ \| направление \| `shared\/boot\/boot\.ts` \|[^\n]*\| против правила \|/,
      );
      fs.writeFileSync(
        path.join(boot, "a.ts"),
        'export const a = (): unknown => require("./b");\n',
      );
      fs.writeFileSync(
        path.join(boot, "b.ts"),
        'export const b = (): unknown => require("./a");\n',
      );
      expect(tool("cycles")).toContain("Различных циклов: 1.");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("отложенное держит решение", () => {
  it("«отложено» без записи решения печати не получает, с ней — получает", () => {
    const box = seatEmpty("otlozh-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      fs.writeFileSync(
        path.join(box, "src", "app", "zzLater.ts"),
        "export const zzLater = (n: number): number => n * 427;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const later = {
        release: "не нужно: проба",
        pick: {
          H7: "нашлось | src/app/zzLater.ts:1 | число без имени | отложено",
        },
      };
      tool("bar", "app/zzLater.ts");
      fs.appendFileSync(
        path.join(box, ".context", "02-todo.md"),
        "\n## Имя числу\n\nЧто именно: `src/app/zzLater.ts` — число без имени.\n",
      );
      fillBar(protoAt, later);
      const refused = tool("bar", "app/zzLater.ts");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toContain("H7: «отложено», а реестр решений");
      // Решение о файле, а не о находке, судьбы не держит: реестр с первого
      // дня называет точку входа и корневой компонент, и прежде любая их
      // запись держала «отложено» по любой находке в них.
      const decisions = path.join(box, ".context", "09-decisions.md");
      fs.appendFileSync(
        decisions,
        "\n## Файл заведён для пробы\n\nФайл `src/app/zzLater.ts` — проба.\n" +
          "\n| Решение | Почему |\n| --- | --- |\n" +
          "| файл `src/app/zzLater.ts` — проба | — |\n| H7 — отдельно | — |\n",
      );
      fs.rmSync(protoAt);
      tool("bar", "app/zzLater.ts");
      fillBar(protoAt, later);
      expect(tool("bar", "app/zzLater.ts")).toContain("в одной записи с");
      fs.appendFileSync(
        decisions,
        "\n## Число без имени отложено\n\nКем решено: разработчик, `2026-10-05`. " +
          "Файл `src/app/zzLater.ts`, находка `H7`: имя числу — отдельной задачей.\n",
      );
      fs.rmSync(protoAt);
      tool("bar", "app/zzLater.ts");
      fillBar(protoAt, later);
      expect(tool("bar", "app/zzLater.ts")).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("применимость разделов видит пакеты в коде, редирект и выкладку", () => {
  it("подарок полки в коде, переход по адресу страницы и конфиг площадки включают свои разделы", () => {
    const box = seatEmpty("primen-");
    try {
      const said = () =>
        (verifyIn(box).get("Применимость разделов планки") ?? []).join("\n");
      const drift = () =>
        said()
          .match(/предмет на диске есть: [K-U]/g)
          ?.map((one) => one.slice(-1))
          .sort()
          .join("") ?? "";
      const plant = (at, text) => {
        fs.mkdirSync(path.dirname(path.join(box, at)), { recursive: true });
        fs.writeFileSync(path.join(box, at), text);
      };
      expect(drift()).toBe("");
      plant(
        "src/shared/zzApi/zzApi.ts",
        'import axios from "axios";\n\nexport const zzApi = (id: string) => axios.get("/zz/" + id);\n',
      );
      // Запрос асинхронен по определению: сеть оживляет и раздел асинхронности.
      expect(drift()).toBe("KL");
      expect(said()).toContain("L — следует из K (сеть): импорт `axios`");
      // Переход на постоянный адрес рядом с чтением адреса — не адрес снаружи.
      plant(
        "src/app/zzHome.tsx",
        'export const zzHome = (navigate: (to: string) => void) => {\n  const tab = new URLSearchParams(window.location.search).get("tab");\n  navigate("/home");\n  return tab;\n};\n',
      );
      expect(drift()).toBe("KL");
      plant(
        "src/app/zzHello.tsx",
        'import { useTranslation } from "react-i18next";\n\nexport const ZzHello = () => {\n  const { t } = useTranslation();\n  return <p>{t("hello")}</p>;\n};\n',
      );
      expect(drift()).toBe("KLT");
      plant(
        "src/app/zzLogin.tsx",
        'export const zzLogin = () => {\n  const next = new URLSearchParams(window.location.search).get("next") ?? "/";\n  window.location.assign(next);\n};\n',
      );
      expect(drift()).toBe("KLQT");
      plant("vercel.json", "{}\n");
      expect(drift()).toBe("KLQST");
      plant(
        "src/app/zzDrag.tsx",
        "export const ZzDrag = ({ on }: { on: () => void }) => <div onPointerMove={on} style={{ width: 4 }} />;\n",
      );
      expect(drift()).toBe("KLNOQST");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("адрес маршрута и обещание без async оживляют разделы, а расхождение называет свидетеля", () => {
    const box = seatEmpty("primen-svid-");
    try {
      const said = () =>
        (verifyIn(box).get("Применимость разделов планки") ?? []).join("\n");
      const plant = (at, text) => {
        fs.mkdirSync(path.dirname(path.join(box, at)), { recursive: true });
        fs.writeFileSync(path.join(box, at), text);
      };
      expect(said()).not.toContain("предмет на диске есть");
      plant(
        "src/app/zzItem.tsx",
        'import { useParams } from "react-router";\n\nexport const ZzItem = () => {\n  const { id } = useParams();\n  return <p>{id}</p>;\n};\n',
      );
      expect(said()).toContain("предмет на диске есть: K — адрес: `useParams(`");
      expect(said()).not.toContain("предмет на диске есть: L");
      plant(
        "src/shared/zzWait/zzWait.ts",
        "export const zzWait = (next: { then: (f: (n: number) => number) => number }) =>\n  next.then((n) => n + 1);\n",
      );
      expect(said()).toContain("предмет на диске есть: L — ожидание ответа: `.then(`");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("карта качества сверяется и на втором уровне", () => {
  it("подхарактеристика без строки, критерий чужой характеристики и имя первого уровня без подхарактеристики роняют сверку, а bar-hold печатает опору", () => {
    const box = seatEmpty("iso-sub-");
    try {
      const said = () =>
        (verifyIn(box).get("Характеристика качества названа в планке") ?? []).join("\n");
      const at = path.join(box, ".claude", "rationale", "quality.md");
      const was = fs.readFileSync(at, "utf8");
      const plant = (from, to) => {
        expect(was).toContain(from);
        fs.writeFileSync(at, was.replace(from, to));
        const out = said();
        fs.writeFileSync(at, was);
        return out;
      };
      expect(said()).toBe("");
      expect(
        plant(
          "| производительность | ёмкость | `G6-бис`, `G9` |",
          "| производительность | всплеск | `G6-бис`, `G9` |",
        ),
      ).toContain("«производительность / ёмкость»: строки во втором уровне нет");
      expect(
        plant(
          "| управляемость | `P1`, `P2`, `P3-бис`, `P4-бис` |",
          "| управляемость | `P1`, `P2`, `P3-бис`, `P4-бис`, `N2` |",
        ),
      ).toContain("N2 не назван строкой «взаимодействие с пользователем» первого уровня");
      expect(
        plant("| сосуществование | `O1`, `O2-бис`, `R2` |", "| сосуществование | `O1`, `O2-бис` |"),
      ).toContain("«совместимость»: R2 назван первым уровнем, а ни одной подхарактеристикой — нет");
      let hold;
      try {
        hold = execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "bar-hold"], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        hold = String(e.stdout ?? "");
      }
      expect(hold).toContain("=== Подхарактеристики ISO/IEC 25010: самая сильная опора ===");
      expect(hold).toContain("| производительность | ёмкость | G6-бис, G9 |");
      expect(hold).toContain("| безвредность | безопасный отказ | — | вне планки |");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("ревизия сводов по истории", () => {
  it("снос узла не делает накрытый сводом коммит красным задним числом", () => {
    const box = seatEmpty("istoriya-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=istoriya",
            "-c",
            "user.email=istoriya@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      const base = git("rev-parse", "HEAD").trim();
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs
          .readFileSync(cfgAt, "utf8")
          .replace("  barSince: null,", '  barSince: "' + base + '",'),
      );
      git("commit", "-qam", "основание сводов", "--no-verify");
      // Коммит трогает ДВА своих файла, и снесён потом будет один: свод
      // называет оба, а корпус после сноса — только оставшийся.
      const app = path.join(box, "src", "app");
      fs.writeFileSync(
        path.join(app, "zzGone.ts"),
        "export const zzGone = (n: number): number => n + 1;\n",
      );
      fs.writeFileSync(
        path.join(app, "zzKept.ts"),
        "export const zzKept = (n: number): number => n - 1;\n",
      );
      tool("bar");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const text = fs.readFileSync(protoAt, "utf8");
      const all = barRowsCited(text);
      const filled = text
        .split("\n")
        .map((line) => {
          const c = line.split("|");
          // строка исхода: критерий, предмет, о чём, исход, адрес, что, судьба
          const witness = fillWitness(c);
          if (witness !== null) return witness;
          if (
            c.length === 9 &&
            !/^ П\d+ $/.test(c[1]) &&
            c[4].trim() === "" &&
            !/^\s*-+\s*$/.test(c[1]) &&
            c[1].trim() !== "критерий"
          ) {
            // Новый файл сверяют с единицами его слоя: о повторённой логике
            // предмет есть, и ответ опирается на каталог. О критериях
            // свидетелей предмет есть тоже: ответ опирается на них.
            const versus =
              c[1].trim() === "A6-бис" ||
              WITNESS_ASKED.includes(c[1].trim()) ||
              askedIn(c[1].trim(), text);
            c[4] = versus ? " чисто " : " нет предмета ";
            c[6] = versus ? " " + all + " сверено с каталогом слоя " : " проба ревизии ";
            return c.join("|");
          }
          if (c.length === 6 && /zzGone|zzKept/.test(c[1]))
            return (
              "| `" +
              c[1].trim().replace(/`/g, "") +
              "` | правлено | не требуется | `.context/10-idioms.md` — проба ревизии |"
            );
          // Итог по уровням: строка на предмет уровня, называет каждую
          // строку модели номером — и сдвиги в их числе.
          if (c.length === 7 && ["узел", "слой", "приложение"].includes(c[1].trim()))
            return "| " + c[1].trim() + " | " + c[2].trim() + " | " + all + " проба ревизии | да | " + all + " |";
          return line;
        })
        .join("\n");
      fs.writeFileSync(protoAt, partsMerged(filled));
      // «Правлено» называет правленый файл базы: проба правит запись идиом.
      fs.appendFileSync(path.join(box, ".context", "10-idioms.md"), "\n");
      fillWords(protoAt);
      expect(tool("bar")).toContain("печать поставлена");
      git("add", "-A");
      git("commit", "-qm", "свой код со сводом", "--no-verify");
      // Снос узла — тоже правка: свод называет удалённый файл.
      fs.rmSync(path.join(app, "zzGone.ts"));
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(tool("bar")).toContain("печать поставлена");
      git("add", "-A");
      git("commit", "-qm", "снос узла", "--no-verify");
      const rows = tool("verify").split("\n");
      const at = rows.indexOf("=== Коммит с кодом накрыт сводом ===");
      expect(at).toBeGreaterThan(-1);
      expect(rows.slice(at + 1, at + 3)).toContain("  без свода: 0");
      // Вторая сторона — ради неё сверка и заведена: коммит с кодом мимо
      // свода краснеет. Рецепта у сверки нет по устройству — в песочнице
      // фальсификации истории нет, — и здоровье её держит эта строка.
      fs.writeFileSync(
        path.join(app, "zzBare.ts"),
        "export const zzBare = 1;\n",
      );
      git("add", "-A");
      git("commit", "-qm", "код мимо свода", "--no-verify");
      const later = tool("verify").split("\n");
      const bare = later.indexOf("=== Коммит с кодом накрыт сводом ===");
      expect(later.slice(bare + 1, bare + 3)).toContain("  без свода: 1");
      // Удаление мимо свода краснеет так же, как код мимо свода.
      fs.rmSync(path.join(app, "zzKept.ts"));
      git("add", "-A");
      git("commit", "-qm", "снос мимо свода", "--no-verify");
      const last = tool("verify").split("\n");
      const gone = last.indexOf("=== Коммит с кодом накрыт сводом ===");
      expect(last.slice(gone + 1, gone + 3)).toContain("  без свода: 2");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Песочница фальсификации лежит внутри репозитория минутами, и прогон рядом с
 * ней — вторая консоль, крючок среды, ворота — обязан её не видеть. Прежде её
 * исключала одна лишь копия, и соседний прогон краснел на десятках строк про
 * чужую копию проекта. Держит это общий список того, что вне дерева; тест
 * держит сам список: мусор в папке песочницы не меняет ни одной находки.
 */
describe("песочница фальсификации не видна прогону", () => {
  it("мусор в папке песочницы не даёт ни одной новой находки", () => {
    const box = seatEmpty("pesochnica-");
    try {
      const before = verifyIn(box);
      const junk = path.join(box, ".проба-сверок");
      fs.mkdirSync(path.join(junk, "src", "app"), { recursive: true });
      fs.mkdirSync(path.join(junk, ".claude", "rules"), { recursive: true });
      fs.writeFileSync(
        path.join(junk, "src", "app", "zz.ts"),
        "// комментарий не на том языке\nexport const zz = 1;\n",
      );
      fs.writeFileSync(
        path.join(junk, ".claude", "rules", "zz.md"),
        "# Проба\n\nСсылка [сюда](./нету.md), 7 сверок.\n",
      );
      fs.writeFileSync(path.join(junk, "zz.md"), "# Проза вне корпуса\n");
      const after = verifyIn(box);
      expect([...after.entries()]).toEqual([...before.entries()]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Долг `comments` у трёх сверок комментариев один и мерится суммой их
 * находок. Пока каждая сравнивала поле со своим счётом, честный долг за
 * длинный комментарий прогон называл лишним, строку реестра с именем его
 * сверки не признавал, а долг под одну сверку прощал находки соседних.
 * Замерено посадкой стенда с длинным комментарием.
 */
describe("долг комментариев — сумма находок трёх сверок", () => {
  it("честный долг держит, лишняя находка соседней сверки краснеет", () => {
    const box = seatEmpty("dolg-");
    try {
      const code = path.join(box, "src", "app", "zzWordy.ts");
      fs.writeFileSync(
        code,
        [
          "// Этот комментарий нарочно длиннее потолка: в нём гораздо больше",
          "// пятнадцати слов подряд, и сверка обязана назвать его длинным рядом.",
          "export const zzWordy = 1;",
          "",
        ].join("\n"),
      );
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const had = fs.readFileSync(cfg, "utf8");
      const withDebt = had.replace(
        /(\n {2}debt: \{[\s\S]*?\n {4})comments: null,/,
        "$1comments: 1,",
      );
      expect(withDebt).not.toBe(had);
      fs.writeFileSync(cfg, withDebt);
      withTransitionDebt(box, [
        "| 1 | Длинный комментарий кода, написанного до посадки | `1` | «Комментарий не перерос в прозу» | сократить ряд в `src/app/zzWordy.ts:1` | `1` место |",
      ]);
      const held = verifyIn(box);
      for (const s of [
        "Комментарий не перерос в прозу",
        "Закомментированного кода нет",
        "Объявленный долг не больше фактического",
        "Объявленный долг назван планом перехода",
      ])
        expect([s, held.get(s) ?? []]).toEqual([s, []]);
      // Вторая находка — у СОСЕДНЕЙ сверки: сумма выше долга, и прогон
      // обязан покраснеть, а не простить её долгом, объявленным под первую.
      fs.appendFileSync(
        code,
        [
          "// const was = useState(0);",
          "// function Old() {",
          "//   return null;",
          "// }",
          "",
        ].join("\n"),
      );
      const over = verifyIn(box);
      expect(
        (over.get("Закомментированного кода нет") ?? []).length,
      ).toBeGreaterThan(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("конфиг в корне — под границей языка", () => {
  it("семена конфигов на языке кода, русский комментарий своего конфига назван", () => {
    const box = seatEmpty("konfig-yazyk-");
    try {
      const SECTION = "Язык внутри корня исходников";
      expect(verifyIn(box).get(SECTION) ?? []).toEqual([]);
      fs.writeFileSync(
        path.join(box, "zz.config.mjs"),
        "// комментарий конфига корня не на языке кода\nexport default {};\n",
      );
      expect(verifyIn(box).get(SECTION) ?? []).toEqual([
        "zz.config.mjs:1 — комментарий на русском, а код проекта пишут по-английски",
      ]);
      // Конфиг с комментарием под решёткой — тоже конфиг корня; русское имя
      // папки в образце пути комментарием не является.
      fs.rmSync(path.join(box, "zz.config.mjs"));
      fs.writeFileSync(
        path.join(box, ".dockerignore"),
        "# комментарий списка игнорирования\n.проба-сверок\n",
      );
      expect(verifyIn(box).get(SECTION) ?? []).toEqual([
        ".dockerignore:1 — комментарий на русском, а код проекта пишут по-английски",
      ]);
      // Семя прежней редакции после обновления обвязки: находка по нему
      // называет, что файл лёг семенем и полка несёт другую его редакцию.
      fs.rmSync(path.join(box, ".dockerignore"));
      fs.writeFileSync(
        path.join(box, ".gitignore"),
        "# отчёты прогонов\nreports\n",
      );
      const printed = spawnSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
        { cwd: box, encoding: "utf8" },
      ).stdout;
      expect(printed).toContain(
        ".gitignore:1 — комментарий на русском, а код проекта пишут по-английски",
      );
      expect(printed).toContain(
        "легли семенем, а полка несёт другую их редакцию: .gitignore ← seat/templates/.gitignore",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Звенья цепочки проект вправе держать под своими именами — `types`, `fmt`, —
 * и базовая линия пишет их теми же именами. Сверка «Красное звено названо
 * находкой» спрашивала звенья по семенным именам: проект, назвавший по-своему
 * все звенья, получал ложное «в базовой линии не опознано ни одного» на верно
 * записанной линии. Замерено посадкой по инструкции в проект со звеном `types`.
 */
describe("звенья под проектными именами опознаются в базовой линии", () => {
  it("своё имя звена — не слепота, а красное под ним без записи — находка", () => {
    const box = seatEmpty("zvenya-");
    try {
      const own = {
        typecheck: "types",
        lint: "lint:js",
        "format:check": "fmt",
        test: "unit",
      };
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      const scripts = {};
      for (const [name, body] of Object.entries(pkg.scripts))
        scripts[own[name] ?? name] = body;
      scripts.check = Object.entries(own).reduce(
        (s, [from, to]) =>
          s.split("npm run " + from + " ").join("npm run " + to + " "),
        pkg.scripts.check.split("npm test").join("npm run unit"),
      );
      pkg.scripts = scripts;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const factsAt = path.join(box, ".context", "01-facts.md");
      let facts = fs
        .readFileSync(factsAt, "utf8")
        .replace(
          /<!-- ПУСТО -->[\s\S]*?<!-- \/ПУСТО -->/,
          [
            "| Звено | Исход | Чем получено |",
            "| --- | --- | --- |",
            "| `typecheck` | зелено | `npm run typecheck` |",
            "| `lint` | зелено | `npm run lint` |",
            "| `format:check` | зелено | `npm run format:check` |",
            "| `test` | зелено | `npm test` |",
          ].join("\n"),
        );
      for (const [from, to] of Object.entries(own))
        facts = facts.split("| `" + from + "` |").join("| `" + to + "` |");
      fs.writeFileSync(factsAt, facts);
      const named = verifyIn(box);
      expect(named.get("Красное звено названо находкой") ?? []).toEqual([]);
      fs.writeFileSync(
        factsAt,
        facts.replace("| `types` | зелено |", "| `types` | красно, код `2` |"),
      );
      const red = verifyIn(box);
      expect(
        (red.get("Красное звено названо находкой") ?? []).join(" "),
      ).toContain("`types` пришло красным");
      // Красный формат — замер до приведения фазой 2, а не долг: пункта долга
      // он не требует и под своим именем проекта.
      fs.writeFileSync(
        factsAt,
        facts.replace("| `fmt` | зелено |", "| `fmt` | красно, файлов `7` |"),
      );
      expect(verifyIn(box).get("Красное звено названо находкой") ?? []).toEqual(
        [],
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Долг ошибок типов держит обёртка команды компилятора, а не сверка базы:
 * она сравнивает счёт `error TS…` с полем `debt.types` в обе стороны. Без
 * долга звено типов стояло в связке первым и не пускало её дальше себя —
 * замерено на стенде с `20` ошибками от строгости, дописанной посадкой.
 * Счёт идёт по выводу со снятыми цветами: ключ `--pretty` красит `error`.
 */
describe("долг ошибок типов держит обёртка компилятора", () => {
  it("столько же — зелено, больше и меньше — красно, цвет не мешает счёту", () => {
    const box = seatEmpty("tipy-");
    try {
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const had = fs.readFileSync(cfg, "utf8");
      const withDebt = had.replace(
        /(\n {2}debt: \{[\s\S]*?\n {4})types: null,/,
        "$1types: 2,",
      );
      expect(withDebt).not.toBe(had);
      fs.writeFileSync(cfg, withDebt);
      const esc = String.fromCharCode(27);
      const colored =
        "a.ts:1:1 - " +
        esc +
        "[91merror" +
        esc +
        "[0m" +
        esc +
        "[90m TS2322: " +
        esc +
        "[0mx";
      const tool = path.join(box, ".claude", "tools", "graph.mjs");
      const statusOf = (command) => {
        try {
          execFileSync(process.execPath, [tool, "types", "--", ...command], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
          return 0;
        } catch (e) {
          return e.status;
        }
      };
      const printing = (lines) => [
        process.execPath,
        "-e",
        lines.map((l) => "console.log(" + JSON.stringify(l) + ");").join("") +
          "process.exit(" +
          (lines.length ? 2 : 0) +
          ");",
      ];
      const plain = "b.ts(1,1): error TS2322: x";
      expect(statusOf(printing([colored, plain]))).toBe(0);
      expect(statusOf(printing([colored, plain, plain]))).toBe(1);
      expect(statusOf(printing([plain]))).toBe(1);
      // Долг погашен целиком: подсказка называет пустое поле так, как его
      // пишет семя, — иначе настройка расходится с семенем формой пустоты.
      const paidSaid = (() => {
        try {
          execFileSync(process.execPath, [tool, "types", "--", ...printing([])], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
          return "";
        } catch (e) {
          return String(e.stdout ?? "");
        }
      })();
      expect(paidSaid).toContain("`debt.types: null`");
      // Команда упала, не назвав ни одной ошибки типов: её код уходит
      // наружу, а не подменяется вердиктом о долге.
      expect(statusOf([process.execPath, "-e", "process.exit(3)"])).toBe(3);
      expect(statusOf(["zz-no-such-command"])).toBe(1);
      // Долг кода держит ПУНКТ ДОЛГА ПЕРЕХОДА с тем же числом, а не строка
      // реестра: реестр для поломок обвязки и находок работы.
      const said = () =>
        verifyIn(box).get("Объявленный долг назван планом перехода") ?? [];
      expect(said().join(" ")).toContain("typecheck");
      fs.appendFileSync(
        path.join(box, ".context", "16-findings.md"),
        "| 9997 | Звено «typecheck»: ошибки типов от строгости посадки объявлены долгом | проба долга |  |  | открыта |\n",
      );
      expect(said().join(" ")).toContain("typecheck");
      withTransitionDebt(box, [
        "| 1 | Ошибки типов под строгостью обвязки | `3` | звено «typecheck» | разобрать `a.ts`, `b.ts` | `3` места |",
      ]);
      expect(said().join(" ")).toContain("пункт 1 говорит `3`");
      const plan = path.join(box, ".context", "15-transition.md");
      fs.writeFileSync(
        plan,
        fs.readFileSync(plan, "utf8").replace("| `3` | звено", "| `2` | звено"),
      );
      expect(said()).toEqual([]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("ошибка настройки звена долгом не гасится, линт держит свой долг", () => {
  it("TS5xxx и код 2 линтера красны при любом долге; линт сверх долга красен", () => {
    const box = seatEmpty("lintdolg-");
    try {
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const had = fs.readFileSync(cfg, "utf8");
      fs.writeFileSync(
        cfg,
        had
          .replace(/(\n {2}debt: \{[\s\S]*?\n {4})types: null,/, "$1types: 5,")
          .replace(/(\n {2}debt: \{[\s\S]*?\n {4})lint: null,/, "$1lint: 2,"),
      );
      const tool = path.join(box, ".claude", "tools", "graph.mjs");
      const run = (mode, lines, code) => {
        const command = [
          process.execPath,
          "-e",
          lines.map((l) => "console.log(" + JSON.stringify(l) + ");").join("") +
            "process.exit(" +
            code +
            ");",
        ];
        try {
          return {
            status: 0,
            out: execFileSync(process.execPath, [tool, mode, "--", ...command], {
              cwd: box,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            }),
          };
        } catch (e) {
          return { status: e.status, out: String(e.stdout ?? "") };
        }
      };
      // Ошибка настройки компилятора: одна строка при долге пять — красно.
      const setup = run("types", ["tsconfig.json(3,5): error TS5107: x"], 1);
      expect(setup.status).toBe(1);
      expect(setup.out).toContain("ошибка настройки");
      // Линт: итог линтера — счёт; столько же, сколько долг, — зелено.
      expect(run("lint", ["✖ 3 problems (2 errors, 1 warning)"], 1).status).toBe(0);
      expect(run("lint", ["✖ 4 problems (3 errors, 1 warning)"], 1).status).toBe(1);
      // Код возврата 2 у линтера — настройка, а не находки.
      const broken = run("lint", ["Oops! Something went wrong! :("], 2);
      expect(broken.status).toBe(1);
      expect(broken.out).toContain("ошибка настройки");
      // Ошибка разбора — файл правилами не проверен, хотя код возврата 1 и
      // итог в пределах долга: прежде такие строки шли долгом.
      const parse = run(
        "lint",
        [
          "/p/src/a.ts",
          '  0:0  error  Parsing error: Enabling "project" does nothing when "projectService" is enabled',
          "✖ 2 problems (2 errors, 0 warnings)",
        ],
        1,
      );
      expect(parse.status).toBe(1);
      expect(parse.out).toContain("ошибка настройки (Parsing error");
      // Долг линта держит пункт долга перехода, называющий звено линта.
      const said = () =>
        (verifyIn(box).get("Объявленный долг назван планом перехода") ?? []).join(" ");
      expect(said()).toContain("lint — долг кода");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  // Храповик линта живёт обёрткой команды, и звено, обёрнутое им, остаётся
  // звеном линта. Образец опознания знал обёртку только у звена типов:
  // обёрнутый линт не опознавался, и конфиг линтера объявлялся лежащим без
  // вызова. Замерено переводом библиотеки на долг линта.
  it("звено линта, обёрнутое храповиком, опознаётся как звено линта", () => {
    const box = seatEmpty("lintobyortka-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts.lint = "node .claude/tools/graph.mjs lint -- " + pkg.scripts.lint;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const found = verifyIn(box);
      for (const s of [
        "Звену цепочки есть на чём работать",
        "Связка проверок зовёт живые звенья",
        "Звено цепочки не задвоено",
      ])
        expect([s, found.get(s) ?? []]).toEqual([s, []]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  // Конфиг звена читает и скрипт из нескольких команд: сборка `tsc -b &&
  // vite build` зовёт компилятор, хотя звеном типов не служит. Сверка судила
  // по целому скрипту и называла конфиг компилятора лежащим без вызова —
  // найдено образцом заготовки `create vite` в корпусе.
  it("конфиг звена, чей инструмент зовёт одна команда скрипта сборки, не лежит без вызова", () => {
    const box = seatEmpty("sostavnoy-");
    try {
      const pkgAt = path.join(box, "package.json");
      const idle = (build) => {
        const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
        delete pkg.scripts.typecheck;
        pkg.scripts.build = build;
        fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
        return (verifyIn(box).get("Звену цепочки есть на чём работать") ?? []).join("\n");
      };
      const said = "tsconfig.json — конфиг звена «typecheck» лежит, а инструмент его не зовёт ни один скрипт манифеста";
      expect(idle("tsc -b && vite build")).not.toContain(said);
      expect(idle("vite build")).toContain(said);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("связка проверок: прогон с покрытием и запуск списком", () => {
  it("тесты только с покрытием и связка через run-s — звенья живы и зовутся", () => {
    const box = seatEmpty("svyazka-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      delete pkg.scripts.test;
      delete pkg.scripts["test:coverage"];
      pkg.scripts["test:unit"] = "vitest run --coverage";
      pkg.scripts.check =
        'run-s typecheck lint "format:*" test:unit && node .claude/tools/graph.mjs verify';
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const found = verifyIn(box);
      const bundle = (found.get("Связка проверок зовёт живые звенья") ?? []).join("\n");
      expect(bundle).not.toContain("не зовёт");
      expect(bundle).not.toContain("которой в манифесте нет");
      expect(
        (found.get("Звену цепочки есть на чём работать") ?? []).join("\n"),
      ).not.toContain("звено-спутник написано");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Описанием файла в карте считается только ЕГО запись: строка таблицы с путём
 * первой графой либо заголовок, называющий один этот файл. Упоминание прозой
 * или в чужой строке засчитывалось, и файл без своей строки считался
 * описанным — замерено на стенде, где из `восьми` «описанных» файлов своя
 * строка была у `одного`.
 */
describe("карта засчитывает только свою запись файла", () => {
  it("строка и заголовок описывают, упоминание в чужой строке — нет", () => {
    const box = seatEmpty("karta-");
    try {
      for (const name of ["zzRow", "zzHead", "zzProse"])
        fs.writeFileSync(
          path.join(box, "src", "app", name + ".ts"),
          "export const " + name + " = 1;\n",
        );
      fs.appendFileSync(
        path.join(box, ".context", "00-map.md"),
        [
          "",
          "## Проба своей записи",
          "",
          "| Файл | Отвечает за | Состояние | Эффекты |",
          "| --- | --- | --- | --- |",
          "| `src/app/zzRow.ts` | проба, зовёт `src/app/zzProse.ts` | нет | нет |",
          "",
          "### `src/app/zzHead.ts`",
          "",
          "Проба заголовка.",
          "",
        ].join("\n"),
      );
      const missing = verifyIn(box).get("Покрытие карты") ?? [];
      expect(missing.some((l) => l.includes("zzProse"))).toBe(true);
      expect(missing.some((l) => l.includes("zzRow"))).toBe(false);
      expect(missing.some((l) => l.includes("zzHead"))).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Имя в разделе карты принадлежит папке раздела, а не одноимённому файлу в
 * корне исходников. Замерено переходом библиотеки: у каждой папки свои
 * `index.ts` и `props.ts`, и строки под заголовками папок засчитывались
 * корневым файлам — тридцать файлов числились неописанными при стоящих строках.
 *
 * Импорт ESM пишет расширение выходного файла, `./x.js` при исходнике
 * `./x.ts`, — и граф такого проекта был пуст: у узла не было ни импортёров,
 * ни тестов.
 */
describe("разрешение адресов: раздел карты и импорт ESM", () => {
  it("голое имя под заголовком папки — файл этой папки; импорт .js — исходник .ts", () => {
    const box = seatEmpty("adresa-");
    try {
      const app = path.join(box, "src", "app");
      fs.mkdirSync(path.join(app, "zzPart"), { recursive: true });
      fs.writeFileSync(
        path.join(app, "zzPart", "index.ts"),
        "export const zzPart = 1;\n",
      );
      // Одноимённый файл в корне исходников: голое имя, разрешённое от корня
      // раньше префикса раздела, досталось бы ему.
      fs.writeFileSync(
        path.join(box, "src", "index.ts"),
        "export const zzRoot = 1;\n",
      );
      fs.writeFileSync(
        path.join(app, "zzUser.ts"),
        'import { zzPart } from "./zzPart/index.js";\nexport const zzUser = zzPart;\n',
      );
      fs.appendFileSync(
        path.join(box, ".context", "00-map.md"),
        [
          "",
          "## `src/app/zzPart`",
          "",
          "| Файл | Отвечает за | Состояние | Эффекты |",
          "| --- | --- | --- | --- |",
          "| `index.ts` | проба | pure | нет |",
          "",
        ].join("\n"),
      );
      const missing = verifyIn(box).get("Покрытие карты") ?? [];
      expect(missing.some((l) => l.includes("zzPart/index.ts"))).toBe(false);
      const brief = execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "brief",
          "app/zzPart/index.ts",
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const importers =
        brief.split("--- пользуются им")[1]?.split("---")[1] ?? "";
      expect(importers).toContain("app/zzUser.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("связи мимо графа: публичная поверхность, имена в коде, приставки", () => {
  it("вход пакета, общая константа и собранное помощником имя видны сверкам и досье", () => {
    const box = seatEmpty("svyazi-");
    try {
      const lib = path.join(box, "src", "shared", "zzLib");
      const app = path.join(box, "src", "app");
      fs.mkdirSync(lib, { recursive: true });
      fs.writeFileSync(
        path.join(lib, "topics.ts"),
        'export const ZZ_TOPIC = "zz-topic";\nexport const zzVar = (name: string) => `--zz__${name}`;\n',
      );
      fs.writeFileSync(
        path.join(lib, "core.ts"),
        'export const zzCore = () => 1;\n',
      );
      fs.writeFileSync(
        path.join(lib, "index.ts"),
        'export { zzCore } from "./core.js";\n',
      );
      fs.writeFileSync(
        path.join(app, "zzPub.ts"),
        'import { ZZ_TOPIC, zzVar } from "../shared/zzLib/topics.js";\nexport const zzPub = () => [ZZ_TOPIC, zzVar("w")];\n',
      );
      fs.writeFileSync(
        path.join(app, "zzSub.ts"),
        'import { ZZ_TOPIC } from "../shared/zzLib/topics.js";\nexport const zzSub = (t: string) => t === ZZ_TOPIC;\n',
      );
      fs.writeFileSync(
        path.join(app, "zz.css"),
        ".zzBox {\n  width: var(--zz__w);\n}\n",
      );
      // Пакет публикуется: адрес поставки сопоставляется исходнику.
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      delete pkg.private;
      pkg.exports = { "./zz": { default: "./dist/shared/zzLib/index.js" } };
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      const cfg = fs.readFileSync(cfgAt, "utf8");
      fs.writeFileSync(
        cfgAt,
        cfg
          .replace(
            "  domTables: null,",
            '  domTables: {\n    file: "03-graph.md",\n    headings: ["| Переменная | Кто ставит | Кто читает |", "| Имя в коде | Кто пишет | Кто читает |"],\n  },',
          )
          .replace("  namePrefixes: [],", '  namePrefixes: ["--zz__"],'),
      );
      const graphAt = path.join(box, ".context", "03-graph.md");
      const withRows = (rows) =>
        fs
          .readFileSync(graphAt, "utf8")
          .replace(
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n",
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n| `--zz__w` | `src/app/zzPub.ts` — имя собирает `zzVar` | `src/app/zz.css` |\n",
          )
          .replace(
            "| Имя в коде | Кто пишет | Кто читает |\n| --- | --- | --- |\n",
            "| Имя в коде | Кто пишет | Кто читает |\n| --- | --- | --- |\n" +
              rows,
          );
      const graphSeed = fs.readFileSync(graphAt, "utf8");
      fs.writeFileSync(
        graphAt,
        withRows("| `zz-topic` | `src/app/zzPub.ts` | `src/app/zzSub.ts` |\n"),
      );
      const links = () => verifyIn(box).get("Связи мимо графа импортов") ?? [];
      expect(links()).toEqual([]);

      // Конец связи, который имени не знает, — находка.
      fs.writeFileSync(graphAt, graphSeed);
      fs.writeFileSync(
        graphAt,
        withRows(
          "| `zz-topic` | `src/app/zzPub.ts` | `src/shared/zzLib/core.ts` |\n",
        ),
      );
      expect(links().join("\n")).toContain(
        "zz-topic — названо строкой таблицы, но в shared/zzLib/core.ts его нет",
      );

      const run = (...args) =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const core = run("brief", "shared/zzLib/core.ts");
      expect(sectionOf(core, "публичная поверхность")).toContain(
        "имена: zzCore",
      );
      expect(run("tested", "src/shared/zzLib/core.ts")).toContain(
        "=== Публичная поверхность пакета ===",
      );
      expect(
        sectionOf(run("brief", "app/zzPub.ts"), "делят имена-константы"),
      ).toContain("ZZ_TOPIC — app/zzSub.ts");
      // Переменную ставит свой помощник — чужой связью она не считается.
      expect(run("tested", "src/app/zzPub.ts")).not.toContain(
        "Чужих связей через разметку и стили",
      );

      // `id` сверяется так же, как класс: живое имя проходит, мёртвое и
      // половина переименования — находки, а имя неузнанной формы не
      // выпадает из сверки.
      fs.writeFileSync(
        path.join(app, "zz.css"),
        ".zzBox {\n  width: var(--zz__w);\n}\n#zzRoot {\n  color: #fff;\n}\n",
      );
      fs.writeFileSync(
        path.join(app, "zzPub.ts"),
        'import { ZZ_TOPIC, zzVar } from "../shared/zzLib/topics.js";\nexport const zzPub = () => [ZZ_TOPIC, zzVar("w"), "zzRoot"];\n',
      );
      const idRow = (name) =>
        withRows(
          "| `zz-topic` | `src/app/zzPub.ts` | `src/app/zzSub.ts` |\n" +
            `| \`${name}\` | \`src/app/zzPub.ts\` | \`src/app/zz.css\` |\n`,
        );
      fs.writeFileSync(graphAt, graphSeed);
      fs.writeFileSync(graphAt, idRow("#zzRoot"));
      expect(links()).toEqual([]);
      fs.writeFileSync(graphAt, graphSeed);
      fs.writeFileSync(graphAt, idRow("#zzGone"));
      expect(links().join("\n")).toContain(
        "названо в таблице, нет в коде: #zzGone",
      );
      // Цвет `#fff` — не имя: в селекторе его нет.
      fs.writeFileSync(graphAt, graphSeed);
      fs.writeFileSync(graphAt, idRow("#fff"));
      expect(links().join("\n")).toContain("нет в коде: #fff");
      fs.writeFileSync(graphAt, graphSeed);
      fs.writeFileSync(graphAt, idRow("#зз"));
      expect(links().join("\n")).toContain("форма имени не узнана: #зз");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("база о своём: документы узла, сторона тестов, держатель, якоря", () => {
  const toolIn = (box) => (...args) =>
    execFileSync(
      process.execPath,
      [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
      { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

  it("досье находит дверь папки и документ по её имени, а не чужие README по имени", () => {
    const box = seatEmpty("doki-");
    try {
      const unit = path.join(box, "src", "app", "zzWidget");
      fs.mkdirSync(path.join(unit, "docs"), { recursive: true });
      fs.writeFileSync(path.join(unit, "index.ts"), "export const zzWidget = 1;\n");
      fs.writeFileSync(path.join(unit, "docs", "README.md"), "# zzWidget\n");
      fs.mkdirSync(path.join(box, "docs"), { recursive: true });
      fs.writeFileSync(path.join(box, "docs", "zzWidget.md"), "# виджет\n");
      // Чужой README, называющий голое имя, которое в проекте не одно.
      fs.writeFileSync(path.join(box, "src", "index.ts"), "export const zzRoot = 1;\n");
      fs.writeFileSync(path.join(box, "docs", "other.md"), "Вход — `index.ts`.\n");
      const docs = sectionOf(toolIn(box)("brief", "app/zzWidget/index.ts"), "документация: дверь папки");
      expect(docs).toContain("дверь папки: app/zzWidget/docs/README.md");
      expect(docs).toContain("документ по имени папки: docs/zzWidget.md");
      expect(docs).not.toContain("other.md");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("досье, план и уровни на документ отвечают про документ, на файл правил — вне области разбора", () => {
    const box = seatEmpty("dokument-");
    try {
      const unit = path.join(box, "src", "components", "ZzDoc");
      fs.mkdirSync(path.join(unit, "docs"), { recursive: true });
      fs.writeFileSync(path.join(unit, "ZzDoc.tsx"), "export const ZzDoc = () => null;\n");
      fs.writeFileSync(path.join(unit, "docs", "README.md"), "# ZzDoc\n");
      fs.mkdirSync(path.join(box, "docs"), { recursive: true });
      fs.writeFileSync(path.join(box, "docs", "zzGuide.md"), "# руководство\n");
      const said = (...args) =>
        spawnSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), ...args], {
          cwd: box,
          encoding: "utf8",
        }).stdout;
      for (const [m, a] of [
        ["brief", "src/components/ZzDoc/docs/README.md"],
        ["brief", "docs/zzGuide.md"],
        ["plan", "ZzDoc/docs/README.md"],
        ["levels", "docs/zzGuide.md"],
      ]) {
        const out = said(m, a);
        expect(out, m + " " + a).toContain("— это документ:");
        expect(out, m + " " + a).not.toContain("вне области разбора");
      }
      expect(said("brief", ".claude/rules/quality.md")).toContain("вне области разбора");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("файл объявленной папки тестов — сторона тестов, а не код карты", () => {
    const box = seatEmpty("testdir-");
    try {
      fs.mkdirSync(path.join(box, "zztests"), { recursive: true });
      fs.writeFileSync(path.join(box, "zztests", "helpers.ts"), "export const zzHelp = 1;\n");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs.readFileSync(cfgAt, "utf8").replace("  testDirs: null,", '  testDirs: ["../zztests"],'),
      );
      const found = verifyIn(box);
      expect((found.get("Покрытие карты") ?? []).join("\n")).not.toContain("helpers.ts");
      expect((found.get("Покрытие тестов") ?? []).join("\n")).toContain("helpers.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("файл со своим состоянием назван владельцем, а чтение контекста состоянием не считается", () => {
    const box = seatEmpty("derzhatel-");
    try {
      const app = path.join(box, "src", "app");
      fs.writeFileSync(
        path.join(app, "zzHolder.ts"),
        'import { useState } from "react";\nexport const useZzHolder = () => useState(0);\n',
      );
      fs.writeFileSync(
        path.join(app, "zzReader.ts"),
        'import { useContext, createContext } from "react";\nconst Zz = createContext(0);\nexport const useZzReader = () => useContext(Zz);\n',
      );
      const stateAt = path.join(box, ".context", "04-state.md");
      fs.copyFileSync(
        path.join(box, ".claude", "seat", "templates", "04-state.md"),
        stateAt,
      );
      const seed = fs.readFileSync(stateAt, "utf8");
      const withRow = (row) =>
        fs.writeFileSync(
          stateAt,
          seed.replace(
            "| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n",
            "| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n" + row,
          ),
        );
      const mute = () =>
        (verifyIn(box).get("Предмет из кода назван в своём файле базы") ?? []).join("\n");
      withRow("| счёт | `src/app/App.tsx` | он же | `src/app/zzHolder.ts` | всегда |\n");
      expect(mute()).toContain("не назван в графе «Владелец» app/zzHolder.ts");
      expect(mute()).not.toContain("zzReader.ts");
      withRow("| счёт | `src/app/zzHolder.ts` | он же | он же | всегда |\n");
      expect(mute()).not.toContain("zzHolder.ts");
      // Пробел в файле порядка держателем владельца состояния не служит: C6
      // спорит только со строкой о записи состояния.
      fs.writeFileSync(
        path.join(app, "zzTick.ts"),
        'import { useEffect } from "react";\nexport const useZzTick = (): void => {\n  useEffect(() => undefined, []);\n};\n',
      );
      fs.copyFileSync(
        path.join(box, ".claude", "seat", "templates", "06-timing.md"),
        path.join(box, ".context", "06-timing.md"),
      );
      withRow("| счёт | `src/app/App.tsx` | он же | `src/app/zzHolder.ts` | всегда |\n");
      const lines = mute().split("\n");
      const kind = BAR_CHECK_KINDS["Предмет из кода назван в своём файле базы"].C6;
      const stateLine = lines.find((l) => l.includes("zzHolder.ts"));
      const timingLine = lines.find((l) => l.includes("zzTick.ts"));
      expect(stateLine).toMatch(kind);
      expect(timingLine).toContain("не назван в графе «Что происходит»");
      expect(timingLine).not.toMatch(kind);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("семя, которое ложится позже посадки, не называет в чужом проекте того, чего там нет", () => {
    // Семя под предмет и семя перехода кладут в живой проект, когда предмет
    // появился; при посадке сверки их не видят. Пример с адресом внутри
    // такого семени ведёт в никуда в любом проекте, где этих файлов нет, —
    // замерено семенем записи о состоянии.
    const box = seatEmpty("pozzhe-");
    try {
      const shelf = path.join(TOOL_DIR, "..");
      const map = JSON.parse(
        fs.readFileSync(path.join(shelf, "seat", "map.json"), "utf8"),
      );
      const later = [...(map.onSubject ?? []), ...(map.onTransition ?? [])];
      expect(later.length).toBeGreaterThan(0);
      for (const one of later)
        fs.copyFileSync(path.join(shelf, one.from), path.join(box, one.to));
      const found = verifyIn(box);
      for (const section of [
        "Пути в обратных кавычках",
        "Имена из кода в тексте",
        "Имена констант в тексте",
        "Ссылки markdown",
        "Числа в прозе базы",
      ]) {
        const said = (found.get(section) ?? []).join("\n");
        for (const one of later)
          expect(said, section).not.toContain(path.basename(one.to));
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("съехавший якорь называется со строкой, где цитата теперь, и repoint его переставляет", () => {
    const box = seatEmpty("yakor-");
    try {
      const at = path.join(box, "src", "app", "zzAnchored.ts");
      fs.writeFileSync(at, "export const zzOne = 1;\nexport const zzTarget = 2;\n");
      const idioms = path.join(box, ".context", "10-idioms.md");
      fs.appendFileSync(idioms, "\nПроба: `src/app/zzAnchored.ts:2` `zzTarget`.\n");
      expect((verifyIn(box).get("Якоря") ?? []).join("\n")).not.toContain("zzAnchored");
      fs.writeFileSync(at, "// shifted\n" + fs.readFileSync(at, "utf8"));
      expect((verifyIn(box).get("Якоря") ?? []).join("\n")).toContain(
        "съехала на строку 3, номер переставит режим repoint",
      );
      expect(toolIn(box)("repoint")).toContain("переставлено: 1");
      expect(fs.readFileSync(idioms, "utf8")).toContain("`src/app/zzAnchored.ts:3` `zzTarget`");
      expect((verifyIn(box).get("Якоря") ?? []).join("\n")).not.toContain("zzAnchored");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("свод по планке от модели предмета", () => {
  it("модель по уровням: ресурсы, итог уровня, перенос исходов, вопрос", () => {
    const box = seatEmpty("model-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const at = path.join(box, "src", "app", "zzClock.ts");
      fs.writeFileSync(
        at,
        [
          'import { useEffect, useState } from "react";',
          "export const useZzClock = (ms: number) => {",
          "  const [now, setNow] = useState(0);",
          "  useEffect(() => {",
          "    const id = setInterval(() => setNow((n) => n + 1), ms);",
          "    return () => clearInterval(id);",
          "  }, [ms]);",
          "  useEffect(() => {",
          "    const onKey = () => setNow(0);",
          '    window.addEventListener("keydown", onKey);',
          "  }, []);",
          "  return now;",
          "};",
          "",
        ].join("\n"),
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzClock.ts");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toContain("## Модель предмета");
      expect(printed).toContain("### Узел");
      expect(printed).toContain("## Итог по уровням");
      expect(printed).toMatch(
        /\| П\d+ \| ресурс \| `app\/zzClock\.ts:5` \|[^\n]*\| есть: строка 6 \|/,
      );
      // Пустое снятие ресурса — дыра: без неё вердикт о ресурсах не на чем
      // проверять. Пустой итог уровня — тоже.
      const empty = tool("bar", "app/zzClock.ts");
      expect(empty).toMatch(/П\d+: снятие ресурса не названо/);
      expect(empty).toContain("итог, узел `app/zzClock.ts`: не сказано");
      fillBar(protoAt, {
        release: "нет",
        pick: { H7: "нет предмета |  | проба | " },
      });
      const refused = tool("bar", "app/zzClock.ts");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(/F2: чисто, а снятия нет у ресурса П\d+/);

      // Снятие названо — вердикт с моделью согласен, печать ставится.
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .replace(/\| нет \| (код|база|сессия) \|$/gm, "| не нужно: проба | $1 |"),
      );
      const sealed = tool("bar", "app/zzClock.ts");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "уровни: узел `app/zzClock.ts` — держится; слой `app` — держится; приложение — держится",
      );

      // Правка кода: исходы переносятся, «чисто» ядра и итог уровней
      // сбрасываются — они о коде, которого больше нет.
      fs.appendFileSync(at, "export const zzTick = 1;\n");
      const moved = tool("bar", "app/zzClock.ts");
      expect(moved).toContain("исходы перенесены");
      expect(moved).toMatch(/«чисто» ядра сброшено: [1-9]/);
      expect(moved).toContain("итог по уровням сброшен");
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/\| H7 \|[^\n]*\| нет предмета \|/);

      // Находка-развилка: судьба «вопрос» требует записи в списке вопросов.
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { H7: "нашлось | src/app/zzClock.ts:5 | число без имени | вопрос" },
      });
      expect(tool("bar", "app/zzClock.ts")).toContain(
        "H7: «вопрос», а список вопросов",
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/app/zzClock.ts`.\n",
      );
      expect(tool("bar", "app/zzClock.ts")).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  // Строка критерия единицы одна на работу; второе нарушение в другом файле
  // называют в графе «что» после «ещё мест:», и сверяется оно, как адрес.
  it("прочие места находки в графе «что» сверяются, как адрес", () => {
    const box = seatEmpty("more-places-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), ...args], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      // Булев параметр ставит на строку находки признак «флаг»: он спрашивает
      // `B1` и `A4`, и находка `B1` получает кандидатом `A4`.
      fs.writeFileSync(
        path.join(box, "src", "app", "zzWide.ts"),
        "export const zzWide = (width: number, strict: boolean): boolean => (strict ? width > 1 : width > 0);\n",
      );
      fs.writeFileSync(path.join(box, "src", "app", "zzTall.ts"), "export const zzTall = (height: number): boolean => height > 0;\n");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzWide.ts");
      const found = (more) => ({
        release: "не нужно: проба",
        pick: { B1: "нашлось | src/app/zzWide.ts:1 | булев параметр делит функцию надвое; ещё мест: " + more + " | вопрос" },
      });
      fs.appendFileSync(path.join(box, ".context", "13-questions.md"), "\nВопрос о `src/app/zzWide.ts`.\n");
      fillBar(protoAt, found("`src/app/zzNope.ts:1`"));
      expect(tool("bar", "app/zzWide.ts")).toContain("B1: файла `src/app/zzNope.ts` нет");
      fillBar(protoAt, found("`zzTall`"));
      expect(tool("bar", "app/zzWide.ts")).toContain("B1: место в графе «что» не вида путь:строка: «zzTall»");
      fillBar(protoAt, found("`src/app/zzTall.ts:1`"));
      const unnamed = tool("bar", "app/zzWide.ts");
      expect(unnamed).toContain("B1: «вопрос», а список вопросов");
      expect(unnamed).toContain("zzTall.ts");
      fs.appendFileSync(path.join(box, ".context", "13-questions.md"), "\nВопрос о `src/app/zzTall.ts`.\n");
      expect(tool("bar", "app/zzWide.ts")).toContain("печать поставлена");
      // Найденное по одному критерию — находка в каждом, чьё тело его
      // называет: «чисто» со ссылкой на чужую находку не принимается.
      fillBar(protoAt, { release: "не нужно: проба", pick: { H6: "чисто |  | имя названо находкой B1 | " } });
      expect(tool("bar", "app/zzWide.ts")).toContain("H6: чисто со ссылкой на находку другого критерия");

      // Без ссылки — та же находка, забытая у другого критерия. Её держит
      // перекрёстная сверка: у находки ответ, кого ещё она нарушает, и о
      // каждом кандидате — «X» либо «не X». Свод выше запечатан; работа
      // продолжается — печать снимается.
      fs.writeFileSync(protoAt, fs.readFileSync(protoAt, "utf8").replace(/^- печать: .*$/m, "- печать: `нет`"));
      const finding = "B1 — `src/app/zzWide.ts:1`";
      const rowRe = /^(\| B1 — `src\/app\/zzWide\.ts:1` \| [^|]+ \| ([^|]*) \|).*$/m;
      const also = (value) =>
        fs.writeFileSync(protoAt, fs.readFileSync(protoAt, "utf8").replace(rowRe, "$1 " + value + " |"));
      const candidates = () =>
        rowRe.exec(fs.readFileSync(protoAt, "utf8"))[2].split(",").map((x) => x.trim()).filter((x) => x !== "");
      fillBar(protoAt, { release: "не нужно: проба", pick: { H6: "чисто |  | имя говорит, что считают | " } });
      // Кандидат — другой критерий того же вопроса модели на месте находки.
      expect(candidates()).toEqual(["A4"]);
      also("H6");
      const named = tool("bar", "app/zzWide.ts");
      expect(named).toContain(
        "H6: назван у находки " +
          finding +
          " перекрёстной сверкой, а «нашлось» с её основным местом у него нет",
      );
      expect(named).toMatch(/перекрёстная сверка, B1 — `src\/app\/zzWide\.ts:1`: кандидаты без ответа — [^;]*A4/);
      also("Z99");
      expect(tool("bar", "app/zzWide.ts")).toContain("перекрёстная сверка, " + finding + ": «Z99» — не критерий этого свода");
      also("никакие, A4");
      expect(tool("bar", "app/zzWide.ts")).toContain("перекрёстная сверка, " + finding + ": «никакие» вместе с названными критериями");
      also("");
      expect(tool("bar", "app/zzWide.ts")).toContain("перекрёстная сверка: находок с пустой графой «также» — 1");
      // Строку о находке режим дописывает сам и принимает протокол заново в
      // том же вызове: дыра — уже о пустой графе дописанной строки, а не о
      // том, что таблица не сходится.
      fs.writeFileSync(protoAt, fs.readFileSync(protoAt, "utf8").replace(/^\| B1 — `src\/app\/zzWide\.ts:1` .*\n/m, ""));
      const rewritten = tool("bar", "app/zzWide.ts");
      expect(rewritten).not.toContain("таблица не сходится");
      expect(rewritten).toContain(
        "перекрёстная сверка: находок с пустой графой «также» — 1",
      );
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/^\| B1 — `src\/app\/zzWide\.ts:1` \| [^|]+ \| [^|]* \|\s+\|$/m);
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { H6: "нашлось | src/app/zzWide.ts:1 | имя не говорит, что считают | вопрос" },
        holds: { приложение: "нет" },
      });
      also(["H6", ...candidates().map((id) => "не " + id)].join(", "));
      expect(tool("bar", "app/zzWide.ts")).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  // Строка признака называет все свои места; кандидатов находке даёт любое
  // из них, а отсекает и засчитывает только её основное место.
  it("кандидаты — по любому месту строки модели и по основному месту находки", () => {
    const box = seatEmpty("cross-places-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            {
              cwd: box,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      fs.writeFileSync(
        path.join(box, "src", "app", "zzTwo.ts"),
        "export const zzOne = (w: number, strict: boolean): boolean => (strict ? w > 1 : w > 0);\n" +
          "export const zzTwo = (h: number, loose: boolean): boolean => (loose ? h > 0 : h > 1);\n",
      );
      fs.writeFileSync(
        path.join(box, "src", "app", "zzTall.ts"),
        "export const zzTall = (height: number): boolean => height > 0;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzTwo.ts");
      // Одна строка признака «флаг» на файл: первое место — строка 1, второе — 2.
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        /^\| П[0-9]+ \| флаг \| `app\/zzTwo\.ts:1` \| [^|]*строка 2/m,
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/app/zzTwo.ts`.\n\nВопрос о `src/app/zzTall.ts`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          B1: "нашлось | src/app/zzTwo.ts:2 | второй флаг делит функцию надвое; ещё мест: `src/app/zzTall.ts:1` | вопрос",
          A4: "нашлось | src/app/zzTall.ts:1 | флаг на побочном месте находки | вопрос",
        },
      });
      tool("bar", "app/zzTwo.ts");
      const rowRe =
        /^(\| B1 — `src\/app\/zzTwo\.ts:2` \| [^|]+ \| ([^|]*) \|).*$/m;
      const candidates = () =>
        rowRe
          .exec(fs.readFileSync(protoAt, "utf8"))[2]
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x !== "");
      // Находка на втором месте строки получает её кандидата, и «нашлось» на
      // побочном месте находки его не отсекает.
      expect(candidates()).toContain("A4");
      fs.writeFileSync(
        protoAt,
        fs.readFileSync(protoAt, "utf8").replace(rowRe, "$1 A4 |"),
      );
      expect(tool("bar", "app/zzTwo.ts")).toContain(
        "A4: назван у находки B1 — `src/app/zzTwo.ts:2` перекрёстной сверкой, а «нашлось» с её основным местом у него нет",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  // Суть строки модели обрезается по длине, а разбор протокола снимает
  // пробелы с краёв клетки: обрезок с пробелом на конце давал «модель
  // другая» на каждом зове, и печать не вставала никогда. Найдено пробой.
  it("строка модели, обрезанная на пробеле, не пересобирает протокол на каждом зове", () => {
    const box = seatEmpty("model-trim-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), ...args], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      fs.writeFileSync(
        path.join(box, "src", "app", "zzTitle.ts"),
        [
          'import { useState } from "react";',
          "export const useZzTitle = () => {",
          '  const [zzTitle, setZzTitle] = useState("' + "a".repeat(29) + ' bbbb");',
          "  return { zzTitle, setZzTitle };",
          "};",
          "",
        ].join("\n"),
      );
      expect(tool("bar", "app/zzTitle.ts")).toContain("протокол напечатан");
      const again = tool("bar", "app/zzTitle.ts");
      expect(again).not.toContain("исходы перенесены");
      expect(again).not.toContain("пересобран");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  // Черта в графе «что» без экранирования рвала строку исхода на лишние
  // графы, и при пересборке исход пропадал — найдено ревьюером пробы.
  it("черта в графе «что» не теряет исход при пересборке", () => {
    const box = seatEmpty("pipe-");
    try {
      const tool = (...args) => {
        try {
          return execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), ...args], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const code = path.join(box, "src", "app", "zzPipe.ts");
      fs.writeFileSync(code, "export const zzPipe = (a: number): number => a + 1;\n");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzPipe.ts");
      const h1 = /^\| H1 \|.*$/m;
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(h1);
      fs.writeFileSync(
        protoAt,
        fs.readFileSync(protoAt, "utf8").replace(h1, (row) => {
          const c = row.split("|");
          c[4] = " чисто ";
          c[6] = " ветка a | b объяснима ";
          return c.join("|");
        }),
      );
      fs.writeFileSync(code, "export const zzPipe = (a: number): number => a + 2;\n");
      expect(tool("bar", "app/zzPipe.ts")).toContain("исходы перенесены");
      const row = h1.exec(fs.readFileSync(protoAt, "utf8"))[0];
      expect(row).toContain("| чисто |");
      expect(row).toContain("ветка a \\| b объяснима");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("починено вне кода: адрес в правленом файле любого рода, а не только в предмете", () => {
    const box = seatEmpty("vnekoda-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      fs.writeFileSync(path.join(box, "src", "app", "zzCi.ts"), "export const zzCi = 1;\n");
      fs.mkdirSync(path.join(box, ".github", "workflows"), { recursive: true });
      fs.writeFileSync(path.join(box, ".github", "workflows", "ci.yml"), "name: ci\n");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const fixedIn = (where) =>
        fillBar(protoAt, {
          release: "не нужно: проба",
          pick: { J2: "нашлось | " + where + ":1 | конвейер не звал проверок | починено" },
        });
      // Конвейер правлен этой работой — находка в нём починена, хоть он и не код.
      fixedIn(".github/workflows/ci.yml");
      expect(tool("bar")).toContain("печать поставлена");
      // Нетронутый файл починенным быть не может, какого бы рода он ни был.
      fixedIn("package.json");
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toContain("`package.json` в правленом не числится");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("правка, чистая в строках, не запечатывается, пока целое не отвечено", () => {
    const box = seatEmpty("urovni-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      // Общий слой берёт из слоя приложения — против правила таблицы слоёв,
      // — приложение берёт из общего: цикл. Оба пишут один ключ хранилища.
      fs.mkdirSync(path.join(box, "src", "shared", "zzPrefs"), { recursive: true });
      fs.writeFileSync(
        path.join(box, "src", "shared", "zzPrefs", "zzPrefs.ts"),
        'import { ZZ_TITLE } from "../../app/zzTitle";\n\nexport const zzSave = (v: string): void => {\n  window.localStorage.setItem("zz.key", ZZ_TITLE + v);\n};\n',
      );
      fs.writeFileSync(
        path.join(box, "src", "app", "zzTitle.ts"),
        'import { zzSave } from "../shared/zzPrefs/zzPrefs";\n\nexport const ZZ_TITLE = "t";\n\nexport const zzReset = (): void => {\n  window.localStorage.setItem("zz.key", "");\n  zzSave("");\n};\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const model = fs.readFileSync(protoAt, "utf8");
      expect(model).toMatch(/\| П\d+ \| направление \|[^\n]*\| новое \| против правила \|/);
      expect(model).toMatch(/\| П\d+ \| цикл \|[^\n]*\| новое \|/);
      expect(model).toMatch(/\| П\d+ \| писатель \|[^\n]*хранилище «zz\.key»/);
      // Ленивое «чисто» по всем строкам, основания без строк модели: печати
      // нет, и названо, почему — по уровням, а не списком строк.
      fillBar(protoAt, { release: "не нужно: проба" });
      const lazy = fs
        .readFileSync(protoAt, "utf8")
        .replace(/(?:(?:П|Св)\d+, )*(?:П|Св)\d+ проба/g, "проба")
        .replace(/см\. (?:(?:П|Св)\d+, )*(?:П|Св)\d+/g, "см. выше")
        .replace(
          /(?:(?:П|Св)\d+, )*(?:П|Св)\d+ разобраны \| да \| (?:(?:П|Св)\d+, )*(?:П|Св)\d+/g,
          "разобраны | да | проба",
        );
      fs.writeFileSync(protoAt, lazy);
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(/A5 для `shared`: чисто, а ребро идёт против правила направления: П\d+/);
      expect(refused).toMatch(/A9-бис для `app`: чисто, а правка завела цикл: П\d+/);
      // Второй писатель — вопрос к основанию: не названный номером, не отвечен.
      expect(refused).toMatch(/C6-бис: чисто, а у источника больше одного писателя/);
      expect(refused).toMatch(/чисто без опоры на модель своего уровня: назвать строку уровня «приложение»/);
      expect(refused).toMatch(/итог, узел `[^`]+`: опора не называет ни одной строки модели этого уровня/);
      expect(refused).toMatch(/сдвиг без ответа: П\d+/);
      // «Починено», а модель по нынешнему коду показывает то же: не принято.
      // Протокол начинается заново: ленивые основания иначе переехали бы.
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "A5@shared": "нашлось | src/shared/zzPrefs/zzPrefs.ts:1 | общее берёт из приложения | починено",
        },
      });
      expect(tool("bar")).toMatch(/A5 для `shared`: починено, а ребро против правила в модели осталось/);
      // Честный ответ: развилки вынесены вопросом, уровни не держатся.
      fs.rmSync(protoAt);
      tool("bar");
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/shared/zzPrefs/zzPrefs.ts` и `src/app/zzTitle.ts`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        // Предмет у каждого ответа свой: узел заголовка не держится, узел
        // общего — держится, оба слоя и приложение — нет.
        holds: { узел: "нет", "узел@shared/zzPrefs": "да", слой: "нет", приложение: "нет" },
        pick: {
          "A5@shared": "нашлось | src/shared/zzPrefs/zzPrefs.ts:1 | общее берёт из приложения | вопрос",
          "A9-бис@app": "нашлось | src/app/zzTitle.ts:1 | цикл общего и приложения | вопрос",
          "C6-бис": "нашлось | src/app/zzTitle.ts:6 | второй писатель ключа | вопрос",
          "A1@app/zzTitle.ts": "нашлось | src/app/zzTitle.ts:3 | узел и держит заголовок, и пишет хранилище | вопрос",
        },
      });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "уровни: узел `app/zzTitle.ts` — не держится; узел `shared/zzPrefs` — держится; слой `app` — не держится; слой `shared` — не держится; приложение — не держится",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("что завела сама правка, режет само", () => {
  it("обход входа и ещё один писатель ключа: «чисто» не принято, решение и вопрос — законны", () => {
    const box = seatEmpty("zavela-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, "src", ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      put(
        "shared/zzStore/zzStore.ts",
        'const ZZ_KEY = "zz.count";\n\nexport const zzSave = (value: number): void => {\n  window.localStorage.setItem(ZZ_KEY, String(value));\n};\n',
      );
      put("components/ZzA/zzClamp.ts", "export const zzClamp = (v: number): number => Math.min(v, 9);\n");
      put("components/ZzA/types.ts", "export type ZzAProps = { max: number };\n");
      put(
        "components/ZzA/ZzA.tsx",
        'import { zzSave } from "../../shared/zzStore/zzStore";\nimport type { ZzAProps } from "./types";\nimport { zzClamp } from "./zzClamp";\n\nexport function ZzA({ max }: ZzAProps) {\n  return <button onClick={() => zzSave(zzClamp(max))}>a</button>;\n}\n',
      );
      // У этой папки входа нет вовсе: ни бочки, ни файла узла.
      put("components/ZzC/zzInner.ts", "export const zzInner = 1;\n");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      // Кривая правка: помощник соседа мимо входа, тот же ключ — вторым
      // писателем. Типы соседа — его контракт, их взять законно.
      put(
        "components/ZzB/ZzB.tsx",
        'import type { ZzAProps } from "../ZzA/types";\nimport { zzClamp } from "../ZzA/zzClamp";\nimport { zzInner } from "../ZzC/zzInner";\n\nexport function ZzB({ max }: ZzAProps) {\n  const save = () =>\n    window.localStorage.setItem("zz.count", String(zzClamp(max + zzInner)));\n  return <button onClick={save}>b</button>;\n}\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const proto = fs.readFileSync(protoAt, "utf8");
      expect(proto).toMatch(/\| граница \|[^\n]*ZzA\/zzClamp\.ts[^\n]*\| новое \| мимо входа \|/);
      expect(proto).toMatch(/\| граница \|[^\n]*ZzC\/zzInner\.ts[^\n]*\| новое \| входа нет \|/);
      expect(proto).not.toMatch(/\| граница \|[^\n]*ZzA\/types\.ts/);
      // Соседи по графу: взятое мимо входа тянет хозяина — узел той папки.
      expect(proto).toMatch(
        /\| сосед \| `components\/ZzA\/ZzA\.tsx` \| в единице components\/ZzA, из которой берёт components\/ZzB\/ZzB\.tsx/,
      );
      expect(proto).toMatch(/\| писатель \|[^\n]*хранилище «zz\.count»: пишут components\/ZzB\/ZzB\.tsx, shared\/zzStore\/zzStore\.ts \| новое \|/);
      // Прилежное «чисто», каждая строка названа номером: мало.
      fillBar(protoAt, { release: "не нужно: проба" });
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(/A5 для `components`: чисто, а П\d+ — это завела сама правка/);
      expect(refused).toMatch(/B7 для `components\/ZzB`: чисто, а П\d+ — это завела сама правка/);
      // Второй писатель, названный номером, — отвеченный вопрос, не приговор.
      expect(refused).not.toMatch(/C6-бис/);
      // Внутренность папки без входа — вопрос к раскладке, а не приговор.
      const inner = /\| (П\d+) \| граница \|[^\n]*ZzC\/zzInner/.exec(proto)[1];
      expect(refused).not.toMatch(new RegExp("чисто, а " + inner + " — это завела"));
      // «Чисто» о повторённой логике без соседей — не сверено ни с кем.
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "A6-бис": "чисто |  | узел делает одно | " },
      });
      expect(tool("bar")).toMatch(/A6-бис: чисто, а соседи по графу в основании не названы/);
      fs.rmSync(protoAt);
      tool("bar");
      // «Оставляем» обход — решение с обоими файлами; писатель — вопрос.
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nПроба: `src/components/ZzB/ZzB.tsx` берёт `src/components/ZzA/zzClamp.ts` мимо входа — оставляем.\n",
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/components/ZzB/ZzB.tsx`.\n",
      );
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/\| граница \|[^\n]*ZzA\/zzClamp\.ts[^\n]*\| мимо входа · решение \|/);
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { приложение: "нет" },
        pick: { "C6-бис": "нашлось | src/components/ZzB/ZzB.tsx:7 | второй писатель ключа | вопрос" },
      });
      expect(tool("bar")).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("ядро по предметам уровня: правка, чтение, переход", () => {
  const toolAt = (box) => (...args) => {
    try {
      return execFileSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  // Два компонента: корзина держит состояние и отдаёт лишнее имя, панель
  // зовёт корзину.
  const twoUnits = (box) => {
    const cart = path.join(box, "src", "components", "zzCart");
    const bar = path.join(box, "src", "components", "zzBar");
    fs.mkdirSync(cart, { recursive: true });
    fs.mkdirSync(bar, { recursive: true });
    fs.writeFileSync(
      path.join(cart, "zzCart.tsx"),
      'import { useState } from "react";\n\nexport const ZZ_CART_KEY = "cart";\n\nexport const ZzCart = ({ items }: { items: number[] }) => {\n  const [total, setTotal] = useState(items.length);\n  return <button onClick={() => setTotal(0)}>{total}</button>;\n};\n',
    );
    fs.writeFileSync(
      path.join(cart, "zzTotal.ts"),
      "export const zzTotal = (items: number[]): number => items.length;\n",
    );
    fs.writeFileSync(
      path.join(bar, "zzBar.tsx"),
      'import { ZzCart } from "../zzCart/zzCart";\n\nexport const ZzBar = () => <ZzCart items={[1]} />;\n',
    );
  };
  const modelIdOf = (protoAt, sort, where) =>
    new RegExp("\\| (П\\d+) \\| " + sort + " \\| `" + where.replace(/[/.]/g, "\\$&"))
      .exec(fs.readFileSync(protoAt, "utf8"))?.[1] ?? null;

  it("правка двух узлов: ядро узла — по каждому, ответ про один не закрывает другой", () => {
    const box = seatEmpty("predmety-");
    try {
      const tool = toolAt(box);
      execFileSync("git", ["init", "-q"], { cwd: box });
      execFileSync(
        "git",
        ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", "add", "-A"],
        { cwd: box },
      );
      execFileSync(
        "git",
        ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", "commit", "-qm", "посадка", "--no-verify"],
        { cwd: box },
      );
      twoUnits(box);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      expect(tool("bar")).toContain("единиц переноса: components/zzBar, components/zzCart");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toContain("| A1 | `components/zzBar` |");
      expect(printed).toContain("| A1 | `components/zzCart` |");
      // Деталь не раскладывается: одна строка на правку.
      expect(printed.match(/^\| H7 \|/gm)).toHaveLength(1);
      // Ответ про панель, опёртый на строку о корзине, и находка про корзину
      // с адресом в панели — обе не принимаются.
      const cartRow = modelIdOf(protoAt, "ответственность", "components/zzCart/zzCart.tsx");
      expect(cartRow).not.toBeNull();
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "A1@components/zzBar": "чисто |  | один вопрос: " + cartRow + " | ",
          "A1@components/zzCart": "нашлось | src/components/zzBar/zzBar.tsx:1 | две ответственности | починено",
        },
      });
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(
        /A1 для `components\/zzBar`: чисто без опоры на модель своего уровня: назвать строку уровня «узел»/,
      );
      expect(refused).toContain(
        "A1 для `components/zzCart`: находка называет `src/components/zzBar/zzBar.tsx` — вне этого предмета",
      );
      // Лишнее имя корзины — вопрос к её поверхности.
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "B7@components/zzCart": "чисто |  | внутреннее не уходит | " },
      });
      expect(tool("bar")).toMatch(
        /B7 для `components\/zzCart`: чисто, а поверхность узла сдвинулась[^\n]*|B7 для `components\/zzCart`: чисто, а в поверхности есть имена/,
      );
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "уровни: узел `components/zzBar` — держится; узел `components/zzCart` — держится; слой `components` — держится; приложение — держится",
      );
      // Повторный зов по нетронутому протоколу — не «правлен после печати».
      expect(tool("bar")).toContain("печать уже стоит");
      // Находка открыта для каждой единицы, где лежит любое её место: второе
      // место в панели делает панель «не держится», хотя адрес — в корзине.
      fs.writeFileSync(protoAt, fs.readFileSync(protoAt, "utf8").replace(/^- печать: .*$/m, "- печать: `нет`"));
      fs.appendFileSync(path.join(box, ".context", "13-questions.md"), "\nВопрос о `src/components/zzCart/zzTotal.ts` и `src/components/zzBar/zzBar.tsx`.\n");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          H4: "нашлось | src/components/zzCart/zzTotal.ts:1 | имя не берут; ещё мест: `src/components/zzBar/zzBar.tsx:3` | вопрос",
        },
        holds: { "узел@components/zzCart": "нет" },
      });
      expect(tool("bar")).toContain("итог, узел `components/zzBar`: держится, а открытых находок уровня: 1");
      // «Правлено» у базы называет правленый работой файл: нетронутый не годится.
      const baseRow = /^\| `components\/zzBar\/zzBar\.tsx` \| правлено \|.*$/m;
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(baseRow);
      fs.writeFileSync(
        protoAt,
        fs.readFileSync(protoAt, "utf8").replace(baseRow, "| `components/zzBar/zzBar.tsx` | правлено | не требуется | `.context/05-flows.md` — проба |"),
      );
      expect(tool("bar")).toContain(
        "components/zzBar/zzBar.tsx, база: «правлено», а графа не называет файла базы, правленого этой работой",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("чтение: адрес-папка берёт весь узел, и о состоянии спрашивают, хоть оно и не новое", () => {
    const box = seatEmpty("chtenie-");
    try {
      const tool = toolAt(box);
      twoUnits(box);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      expect(tool("bar", "components/zzCart")).toContain("единиц переноса: components/zzCart;");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toContain("| `components/zzCart/zzCart.tsx` |");
      expect(printed).toContain("| `components/zzCart/zzTotal.ts` |");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { A6: "чисто |  | источник один | ", C7: "нет предмета |  | хранить нечего | " },
      });
      const refused = tool("bar", "components/zzCart");
      expect(refused).toMatch(/A6: чисто, а в предмете есть состояние, и в основании не сказано, почему это не второй источник: П\d+/);
      expect(refused).toMatch(/C7: нет предмета, а в модели он есть: П\d+/);
      // Набор сузился — политика потеряла критерий: протокол пересобирается,
      // а не держит строку, которой в своде больше нет.
      const policy = path.join(box, ".claude", "rules", "quality.md");
      fs.writeFileSync(
        policy,
        fs.readFileSync(policy, "utf8").replace("**H7. Магических чисел нет.** (единица)\n", ""),
      );
      expect(tool("bar", "components/zzCart")).toContain("протокол напечатан");
      expect(fs.readFileSync(protoAt, "utf8")).not.toMatch(/^\| H7 \|/m);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("переход: ядро на узел и слой, приложение целиком, находка — долгом, шаг не закрыть без печати", () => {
    const box = seatEmpty("perehod-");
    try {
      const tool = toolAt(box);
      twoUnits(box);
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs
          .readFileSync(cfgAt, "utf8")
          .replace(
            "  transition: null,",
            '  transition: {\n    file: "15-transition.md",\n    heading: "| № | Шаг | Объём | Чем проверяется |",\n    debtHeading: "| № | Расхождение | Сейчас | Держит | План | Цена |",\n  },',
          ),
      );
      const planAt = path.join(box, ".context", "15-transition.md");
      fs.copyFileSync(path.join(box, ".claude", "seat", "templates", "15-transition.md"), planAt);
      const step = /\| [0-9]+ \| Архитектурный проход[^\n]*\n/;
      expect(fs.readFileSync(planAt, "utf8")).toMatch(step);
      // Бочка слоя — своя единица переноса, но сама ничего не делает.
      fs.writeFileSync(
        path.join(box, "src", "components", "index.ts"),
        'export { ZzCart } from "./zzCart/zzCart";\n',
      );
      // Пустой проход: протоколы напечатаны, код не ноль.
      const first = tool("bar", "--transition");
      expect(first).toContain("предметов: 5 (единиц переноса 3, слоёв 1, приложение 1)");
      // Проза о заполнении — раз на все протоколы, в выводе режима, а не в
      // каждом протоколе: на стенде повтор стоил `94 703` знака.
      expect(
        first.split("Как заполнять протоколы перехода — один раз на все")
          .length,
      ).toBe(2);
      expect(first).toContain("Скелет печатает режим");
      const dir = path.join(box, ".context", "15-transition-bar");
      for (const one of [
        "node--components--zzCart.md",
        "node--components--zzBar.md",
        "node--components--index.ts.md",
        "layer--components.md",
        "app.md",
      ])
        expect(fs.existsSync(path.join(dir, one))).toBe(true);
      // Ядро одного уровня — и только оно.
      const cart = fs.readFileSync(path.join(dir, "node--components--zzCart.md"), "utf8");
      expect(cart).toContain("- род: `на переход`");
      expect(cart).not.toContain("Скелет печатает режим");
      expect(
        cart.split("Как заполнять — печатает `graph.mjs bar --transition`")
          .length,
      ).toBe(2);
      expect(cart).toContain("| A1 | `components/zzCart` |");
      expect(cart).not.toMatch(/^\| H7 \|/m);
      expect(cart).not.toMatch(/^\| A6 \|/m);
      expect(cart).not.toMatch(/^\| E7 \|/m);
      // Приложение — целиком, а не ядром: его критерии каждая правка задаёт
      // о всём проекте, и не заданные здесь они ложились на первую правку.
      const app = fs.readFileSync(path.join(dir, "app.md"), "utf8");
      expect(app).toMatch(/^\| A6 \|/m);
      expect(app).toMatch(/^\| G7 \|/m);
      expect(app).toMatch(/^\| J2 \|/m);
      // Предмет перехода — проект вместе с манифестом: о зависимостях
      // спрашивают, а не закрывают заготовкой правки.
      expect(app).toMatch(/^\| R1 \|/m);
      expect(app).not.toContain("манифест этой правкой не тронут");
      // Политику переход читает один раз — страницами протокола приложения,
      // телами ядра узла и слоя и всех критериев приложения; протокол
      // единицы читает её код, слой — свои факты.
      const pages = (text) =>
        [...text.matchAll(/^\| \d+ \| ((?:политика|код|сосед)[^|]+) \|  \|$/gm)].map((m) => m[1].trim());
      expect(pages(app).length).toBeGreaterThan(0);
      expect(pages(app).every((one) => one.startsWith("политика: "))).toBe(true);
      expect(pages(cart)).toEqual([
        "код `components/zzCart/zzCart.tsx`, строки 1–8",
        "код `components/zzCart/zzTotal.ts`, строки 1–1",
      ]);
      expect(pages(fs.readFileSync(path.join(dir, "layer--components.md"), "utf8"))).toEqual([]);
      const policy = execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "bar-read",
          path.join(dir, "app.md"),
          "--print",
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      for (const id of ["A1", "A5", "A6", "G7"]) expect(policy).toContain("**" + id + ". ");
      // У бочки из ядра узла предмет есть только у вопроса о поверхности.
      const barrel = fs.readFileSync(path.join(dir, "node--components--index.ts.md"), "utf8");
      expect(barrel).toContain("| B7 | `components/index.ts` |");
      expect(barrel).not.toMatch(/^\| A1 \|/m);
      // Находка ложится долгом, и план обязан её назвать.
      for (const one of readdirOf(dir))
        fillBar(path.join(dir, one), {
          release: "не нужно: проба",
          holds: { "узел@components/zzCart": "нет" },
          pick: { "B7@components/zzCart": "нашлось | src/components/zzCart/zzCart.tsx:3 | лишнее имя | долг" },
        });
      const again = tool("bar", "--transition");
      expect(again).toContain(
        "«долг», а файл перехода `15-transition.md` не называет `src/components/zzCart/zzCart.tsx`",
      );
      // Повторный зов печатает инструкцию снова: по адресу в протоколе её
      // находит сессия, продолжающая переход.
      expect(
        again.split("Как заполнять протоколы перехода — один раз на все")
          .length,
      ).toBe(2);
      fs.writeFileSync(
        planAt,
        fs
          .readFileSync(planAt, "utf8")
          .replace(
            "| № | Расхождение | Сейчас | Держит | План | Цена |\n| --- | --- | --- | --- | --- | --- |\n",
            "| № | Расхождение | Сейчас | Держит | План | Цена |\n| --- | --- | --- | --- | --- | --- |\n| 1 | Лишняя поверхность «B7» | `1` | `graph.mjs bar` | снять имя в `src/components/zzCart/zzCart.tsx` | `1` строка |\n",
          ),
      );
      const done = tool("bar", "--transition");
      expect(done).toContain("запечатано: 5, с дырами: 0");
      // Сверка: шаг открыт — ход; закрыт — печати; протоколов нет — красное.
      const section = () => {
        let out;
        try {
          out = execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "verify"], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          out = String(e.stdout ?? "");
        }
        return out.split("=== Архитектурный проход перехода запечатан ===")[1].split("\n===")[0];
      };
      expect(section()).toContain("шаг открыт: запечатано на нынешнем коде 5 из 5 предметов");
      fs.writeFileSync(planAt, fs.readFileSync(planAt, "utf8").replace(step, ""));
      expect(section()).toContain("шаг закрыт: протоколов 5, все запечатаны");
      fs.rmSync(dir, { recursive: true, force: true });
      expect(section()).toContain("    шаг «архитектурный проход» закрыт, а протоколов нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Части правки: несколько независимых правок проходят планку одним сводом, а
 * в историю уходят коммитом на часть. Части предлагает машина компонентами
 * связности; связь — закрытый перечень, и каждый её вид держит правленое одной
 * частью сам по себе. Раскладку изменённых файлов и записей базы по частям
 * держит приём протокола. Решение разработчика `2026-10-10`.
 */
describe("части правки", () => {
  it("связь держит одной частью, несвязанное — частями; раскладка и её дыры", () => {
    const box = seatEmpty("chasti-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=u",
            "-c",
            "user.email=u@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      const bar = () => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), "bar"],
            {
              cwd: box,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const put = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      };
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const rows = () => {
        bar();
        const proto = fs.readFileSync(protoAt, "utf8");
        const at = proto.indexOf("## Части правки");
        return at < 0
          ? 0
          : proto
              .slice(at)
              .split("\n")
              .filter((l) => /^\| [0-9]+ \| `/.test(l)).length;
      };
      const reset = () => {
        git("checkout", "-q", "--", ".");
        git("clean", "-qfd", "--", "src", ".context");
      };
      // Основание: общий помощник, константа, файл и тот, кто его берёт,
      // файл под переименование.
      put(
        "src/shared/zzh/zzh.ts",
        "export const zzHelp = (n: number): number => n;\n",
      );
      put("src/shared/zzk/zzk.ts", 'export const ZZ_KEY = "zz";\n');
      put("src/shared/zzc/zzc.ts", "export const zzc = 1;\n");
      put(
        "src/shared/zzd/zzd.ts",
        'import { zzc } from "../zzc/zzc";\n\nexport const zzd = zzc;\n',
      );
      put(
        "src/shared/zze/zze.ts",
        "export const zzMoved = (n: number): number => n + 40;\n",
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      const helped = (name) =>
        'import { zzHelp } from "../zzh/zzh";\n\nexport const ' +
        name +
        " = zzHelp(1);\n";
      // Общий нетронутый помощник связью не считается: две части.
      put("src/shared/zza/zza.ts", helped("zza"));
      put("src/shared/zzb/zzb.ts", helped("zzb"));
      expect(rows()).toBe(2);
      // Импорт — одна часть.
      put(
        "src/shared/zzb/zzb.ts",
        'import { zza } from "../zza/zza";\n\nexport const zzb = zza;\n',
      );
      reset();
      put("src/shared/zza/zza.ts", helped("zza"));
      put(
        "src/shared/zzb/zzb.ts",
        'import { zza } from "../zza/zza";\n\nexport const zzb = zza;\n',
      );
      expect(rows()).toBe(0);
      // Общая единица переноса — одна часть.
      reset();
      put("src/shared/zzg/zza.ts", "export const zza = 1;\n");
      put("src/shared/zzg/zzb.ts", "export const zzb = 2;\n");
      expect(rows()).toBe(0);
      // Имя-константа у обоих — одна часть.
      reset();
      const keyed = (name) =>
        'import { ZZ_KEY } from "../zzk/zzk";\n\nexport const ' +
        name +
        " = ZZ_KEY;\n";
      put("src/shared/zza/zza.ts", keyed("zza"));
      put("src/shared/zzb/zzb.ts", keyed("zzb"));
      expect(rows()).toBe(0);
      // Удалённый файл и тот, кто его брал, — одна часть.
      reset();
      fs.rmSync(path.join(box, "src/shared/zzc/zzc.ts"));
      put("src/shared/zzd/zzd.ts", "export const zzd = 1;\n");
      expect(rows()).toBe(0);
      // Переименование — одна часть.
      reset();
      fs.rmSync(path.join(box, "src/shared/zze/zze.ts"));
      put(
        "src/shared/zzf/zzf.ts",
        "export const zzMoved = (n: number): number => n + 40;\n",
      );
      expect(rows()).toBe(0);
      // Строка таблицы связей — одна часть.
      reset();
      const cfg = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfg,
        fs
          .readFileSync(cfg, "utf8")
          .replace(
            "  domTables: null,",
            '  domTables: { file: "03-graph.md", headings: ["| Связь zz | Концы |"] },',
          ),
      );
      fs.appendFileSync(
        path.join(box, ".context", "03-graph.md"),
        "\n## Связи zz\n\n| Связь zz | Концы |\n| --- | --- |\n| zz | `src/shared/zza/zza.ts`, `src/shared/zzb/zzb.ts` |\n",
      );
      put("src/shared/zza/zza.ts", helped("zza"));
      put("src/shared/zzb/zzb.ts", helped("zzb"));
      expect(rows()).toBe(0);
      // Раскладка: две части, у каждой запись карты, — дыр о частях нет, кроме
      // пустой графы «что»; слова в ней — и тех нет.
      reset();
      put("src/shared/zza/zza.ts", helped("zza"));
      put("src/shared/zzb/zzb.ts", helped("zzb"));
      const mapAt = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n";
      fs.writeFileSync(
        mapAt,
        fs
          .readFileSync(mapAt, "utf8")
          .replace(
            head,
            head +
              "| `src/shared/zza/zza.ts` | первое | нет | нет |\n| `src/shared/zzb/zzb.ts` | второе | нет | нет |\n",
          ),
      );
      expect(rows()).toBe(2);
      const partHoles = (out) =>
        out
          .split("\n")
          .filter((l) =>
            /^ {4}(част|файл |запись |зависимости|раскладка)/.test(l),
          )
          .map((l) => l.trim());
      const listed = bar();
      expect(partHoles(listed)).toEqual([
        "часть 1: графа «что» пуста — из неё сообщение коммита части",
        "часть 2: графа «что» пуста — из неё сообщение коммита части",
      ]);
      // Таблицу частей сессия видит в ключах: протокол вне окна модели
      // читать нельзя.
      expect(listed).toContain(
        "таблица частей (ключ — `часть N`): 1 — `shared/zza/zza.ts` — «что» пусто; 2 — `shared/zzb/zzb.ts` — «что» пусто",
      );
      const fill = (edit) =>
        fs.writeFileSync(protoAt, edit(fs.readFileSync(protoAt, "utf8")));
      fill((p) =>
        p
          .replace(
            "| 1 | `shared/zza/zza.ts` |  |",
            "| 1 | `shared/zza/zza.ts` | add zza |",
          )
          .replace(
            "| 2 | `shared/zzb/zzb.ts` |  |",
            "| 2 | `shared/zzb/zzb.ts` | add zzb |",
          ),
      );
      expect(partHoles(bar())).toEqual([]);
      // Путь протокола в записи — не файл части: протокол инструментальный.
      fs.appendFileSync(
        path.join(box, ".context", "10-idioms.md"),
        "\nВторая: `src/shared/zzb/zzb.ts`, свод — `.context/bar-protocol.md`.\n",
      );
      expect(partHoles(bar())).toEqual([]);
      git("checkout", "-q", "--", ".context/10-idioms.md");
      // Конфиг вне частей, зависимости в двух частях.
      fs.appendFileSync(path.join(box, ".prettierrc.json"), "\n");
      expect(partHoles(bar())).toEqual([
        "файл `.prettierrc.json` не отнесён к части — назвать его в графе «файлы» нужной части",
      ]);
      fs.appendFileSync(path.join(box, "package.json"), "\n");
      put("package-lock.json", "{}\n");
      fill((p) =>
        p
          .replace(
            "| `shared/zza/zza.ts` | add zza |",
            "| `shared/zza/zza.ts`, `.prettierrc.json`, `package.json` | add zza |",
          )
          .replace(
            "| `shared/zzb/zzb.ts` | add zzb |",
            "| `shared/zzb/zzb.ts`, `package-lock.json` | add zzb |",
          ),
      );
      // Манифест в предмете меняет набор критериев: протокол пересобирается.
      bar();
      expect(partHoles(bar())).toEqual([
        "зависимости меняют части 1 и 2 — слить части либо разнести правки по разным пачкам",
      ]);
      fs.rmSync(path.join(box, "package-lock.json"));
      git("checkout", "-q", "--", "package.json");
      fill((p) =>
        p
          .replace(", `package.json` | add zza |", " | add zza |")
          .replace(", `package-lock.json` | add zzb |", " | add zzb |"),
      );
      // Связь, появившаяся после раскладки, — запись базы о файлах двух
      // частей либо импорт между ними — сливает части машиной: отказа «слить
      // части» нет, строка таблицы одна, слова обеих частей в ней.
      // Запись в список вопросов протокол не пересобирает: слияние — тем же
      // вызовом, до приёма. Запись ни об одной части идёт с первой без отказа.
      const questionsAt = path.join(box, ".context", "13-questions.md");
      fs.appendFileSync(
        path.join(box, ".context", "10-idioms.md"),
        "\nСтрока без файлов.\n",
      );
      // Первый вызов после правки базы пересобирает протокол; дыры — второй.
      bar();
      expect(partHoles(bar())).toEqual([]);
      git("checkout", "-q", "--", ".context/10-idioms.md");
      fs.appendFileSync(
        questionsAt,
        "\nОба: `src/shared/zza/zza.ts` и `src/shared/zzb/zzb.ts`.\n",
      );
      const merged = bar();
      expect(merged).not.toContain("слить части");
      expect(rows()).toBe(1);
      expect(fs.readFileSync(protoAt, "utf8")).toContain("add zza; add zzb");
      git("checkout", "-q", "--", ".context/13-questions.md");
      put(
        "src/shared/zzb/zzb.ts",
        'import { zza } from "../zza/zza";\n\nexport const zzb = zza;\n',
      );
      expect(bar()).not.toContain("слить части");
      // Одна компонента и одна строка — раздела частей нет: одна часть.
      expect(rows()).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("хранилище протоколов свода", () => {
  it("свод той же области не делается заново, свод чтения не уносит ответы правки, хранится не больше двадцати", () => {
    const box = seatEmpty("bar-store-");
    try {
      const tool = (...args) =>
        String(
          spawnSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            {
              cwd: box,
              encoding: "utf8",
            },
          ).stdout ?? "",
        );
      const git = (...args) =>
        spawnSync(
          "git",
          [
            "-c",
            "user.name=u",
            "-c",
            "user.email=u@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const store = path.join(box, ".git", "graph-bar-store");
      const sealed = (...args) => {
        tool("bar", ...args);
        fillBar(protoAt, { release: "не нужно: проба" });
        const out = tool("bar", ...args);
        expect(out, out).toContain("печать поставлена");
      };
      // Чтение: область А запечатана, затем область Б, затем снова А.
      sealed("src/app");
      // Адрес — от корня исходников, как пишет пути весь инструмент.
      expect(fs.readFileSync(protoAt, "utf8")).toContain("- адрес: `app`");
      expect(tool("bar", "src/shared/styles")).toContain("протокол напечатан");
      expect(fs.readdirSync(store).length).toBe(1);
      expect(tool("bar", "src/app")).toContain("печать уже стоит");
      // Правка: запечатанный протокол правки переживает свод чтения.
      fs.writeFileSync(
        path.join(box, "src", "app", "zzKeep.ts"),
        "export const zzKeep = 1;\n",
      );
      sealed();
      expect(tool("bar", "src/shared/styles")).not.toContain(
        "печать уже стоит",
      );
      expect(tool("bar")).toContain("печать уже стоит");
      // Вытеснение: старейшие сверх двадцати удаляются.
      const old = Date.now() / 1000 - 3600;
      for (let k = 0; k < 25; k += 1) {
        const one = path.join(
          store,
          "zz" + String(k).padStart(10, "0") + ".md",
        );
        fs.writeFileSync(one, "# старый\n");
        fs.utimesSync(one, old + k, old + k);
      }
      tool("bar", "src/shared/styles");
      expect(
        fs.readdirSync(store).filter((n) => n.endsWith(".md")).length,
      ).toBe(20);
      expect(fs.existsSync(path.join(store, "zz0000000000.md"))).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("страница политики", () => {
  it("общая форма вне держателя — раз на страницу, со списком критериев; у критерия — отсылка", () => {
    const box = seatEmpty("forms-once-");
    try {
      const tool = (...args) =>
        String(
          spawnSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            {
              cwd: box,
              encoding: "utf8",
            },
          ).stdout ?? "",
        );
      tool("bar", "src/app");
      const pages = tool("bar-read", "--print")
        .split(/^(?==== Страница )/m)
        .filter((p) => p.includes("политика:"));
      expect(pages.length).toBeGreaterThan(0);
      let shared = 0;
      for (const page of pages) {
        const forms = page
          .split("\n")
          .filter(
            (l) => l.startsWith("- ") && l !== "- и общие формы страницы, выше",
          );
        for (const one of new Set(forms))
          expect(forms.filter((l) => l === one).length, one).toBe(1);
        if (page.includes("Общие формы вне держателя")) {
          shared += 1;
          expect(page).toMatch(/^ {2}у `[^`]+`(?:, `[^`]+`)+$/m);
          expect(page).toContain("- и общие формы страницы, выше");
        }
      }
      expect(shared).toBeGreaterThan(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("страница критериев — заголовки, формы и раз отсылка к политике; тел на ней нет", () => {
    const box = seatEmpty("bodies-off-");
    try {
      const tool = (...args) =>
        String(
          spawnSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            {
              cwd: box,
              encoding: "utf8",
            },
          ).stdout ?? "",
        );
      tool("bar", "src/app");
      const pages = tool("bar-read", "--print")
        .split(/^(?==== Страница )/m)
        .filter((p) => p.includes("политика:"));
      // Файл политики страница называет раз, а не у каждого критерия.
      for (const page of pages) {
        const pointers = page
          .split("\n")
          .filter((l) => l.startsWith("Тела критериев — "));
        expect(pointers.length, page.slice(0, 80)).toBe(1);
        expect(pointers[0]).toMatch(
          /^Тела критериев — `\.claude\/rules\/quality(?:-scoped)?\.md`(?:, `\.claude\/rules\/quality-scoped\.md`)?: приходят с этой страницей по шапке политики\.$/,
        );
      }
      const lines = pages.join("").split("\n");
      const heads = lines.filter((l) => /^\*\*[A-Z][0-9]+/.test(l));
      expect(heads.length).toBeGreaterThan(0);
      expect(lines).toContain("Вне держателя — проверяется чтением:");
      // Первая строка тела каждого критерия страницы стоит в политике, а на
      // странице её нет. Заголовок бывает длиннее строки: тело начинается
      // за строкой с закрывающими звёздочками.
      const policy = ["quality.md", "quality-scoped.md"]
        .map((f) =>
          fs.readFileSync(path.join(box, ".claude", "rules", f), "utf8"),
        )
        .join("\n")
        .split("\n");
      let bodies = 0;
      for (const head of heads) {
        let k = policy.indexOf(head);
        expect(k, head).toBeGreaterThanOrEqual(0);
        while (!policy[k].includes("**", 2)) k += 1;
        const body = policy[k + 1];
        if (body.trim() === "") continue;
        bodies += 1;
        expect(lines, head).not.toContain(body);
      }
      expect(bodies).toBeGreaterThan(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("короткий вывод сверки", () => {
  it("без --full — находки, предупреждения и счёт; код возврата тот же", () => {
    const box = seatEmpty("verify-brief-");
    try {
      const env = { ...process.env };
      delete env.GRAPH_VERIFY_FULL;
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const run = (...args) =>
        spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "verify", ...args],
          {
            cwd: box,
            encoding: "utf8",
            env,
          },
        );
      const full = run("--full");
      const brief = run();
      expect(brief.status).toBe(full.status);
      const sections = String(full.stdout)
        .split(/^(?==== )/m)
        .slice(1);
      const red = sections.find(
        (s) =>
          /^ {4}\S/m.test(s) && !s.split("\n")[0].includes("прогон не роняет"),
      );
      const green = sections.find(
        (s) => !/^ {4}\S/m.test(s) && !/осмотрено [^:]+: 0\s*$/m.test(s),
      );
      expect(red, full.stdout).toBeDefined();
      expect(brief.stdout).toContain(red.trimEnd());
      expect(brief.stdout).not.toContain(green.split("\n")[0]);
      expect(full.stdout).toContain(green.split("\n")[0]);
      expect(brief.stdout).toMatch(
        /зелёных не показано: [1-9][0-9]* — полный вывод: `graph\.mjs verify --full`/,
      );
      expect(brief.stdout.length).toBeLessThan(full.stdout.length / 2);
      // Флаг посадки стоит: баннер обязан дойти до короткого вывода, и
      // первым, а не телом зелёной секции, которую этот вывод прячет.
      const banner = brief.stdout.indexOf("ПОСАДКА НЕ ЗАВЕРШЕНА");
      expect(banner, brief.stdout).toBeGreaterThanOrEqual(0);
      expect(banner).toBeLessThan(brief.stdout.indexOf("=== "));
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("ответы свода файлом", () => {
  it("bar-fill вписывает те же клетки, что правка таблицы; отказ — без записи", () => {
    const box = seatEmpty("bar-fill-");
    try {
      const tool = (...args) => {
        const r = spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
        return { code: r.status, out: String(r.stdout ?? "") };
      };
      const git = (...args) =>
        spawnSync(
          "git",
          [
            "-c",
            "user.name=u",
            "-c",
            "user.email=u@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      fs.writeFileSync(
        path.join(box, "src", "app", "zzFill.ts"),
        "export const zzFill = (n: number): number => n * 2;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const first0 = tool("bar").out;
      expect(first0, first0).toContain("bar-fill <файл>");
      const blank = fs.readFileSync(protoAt, "utf8");
      fillBar(protoAt, { release: "не нужно: проба" });
      // Графу «о чём» проба заполняет своим словом, а `bar` её не судит и
      // `bar-fill` не пишет: сравнение идёт без неё.
      const blankLines = blank.split("\n");
      const filled = fs
        .readFileSync(protoAt, "utf8")
        .split("\n")
        .map((line, k) => {
          const c = line.split("|");
          const d = (blankLines[k] ?? "").split("|");
          return c.length === 9 &&
            d.length === 9 &&
            c[1] === d[1] &&
            c[2] === d[2]
            ? [...c.slice(0, 3), d[3], ...c.slice(4)].join("|")
            : line;
        })
        .join("\n");
      const answers = answersOf(blank, filled);
      // Машинная клетка, оставленная как есть, — «=»: путь проверен.
      expect(answers, answers).toMatch(/ \| =$/m);
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(answersAt, answers);
      fs.writeFileSync(protoAt, blank);
      const done = tool("bar-fill", answersAt);
      expect(done.code, done.out).toBe(0);
      const wrote = fs.readFileSync(protoAt, "utf8").split("\n");
      const odd = filled.split("\n").findIndex((line, k) => line !== wrote[k]);
      expect(
        odd,
        odd < 0 ? "" : filled.split("\n")[odd] + "\n" + wrote[odd],
      ).toBe(-1);
      expect(tool("bar").out).toContain("печать поставлена");
      // Свой файл режим не трогает. Файл по умолчанию — в папке страниц: его
      // путь называют ключи, без него отказ называет путь, вписанный он снят.
      expect(fs.existsSync(answersAt)).toBe(true);
      const keys = fs.readFileSync(
        path.join(box, ".context", "bar-pages", "bar-protocol-ключи.md"),
        "utf8",
      );
      const ownAt = /Write сюда: (\S+)/.exec(keys)?.[1];
      expect(ownAt, keys).toMatch(/bar-pages[\\/]bar-protocol-ответы\.txt$/);
      fs.writeFileSync(protoAt, blank);
      const none = tool("bar-fill");
      expect(none.code).toBe(1);
      expect(none.out).toContain(ownAt);
      fs.writeFileSync(ownAt, answers);
      const own = tool("bar-fill");
      expect(own.code, own.out).toBe(0);
      expect(fs.existsSync(ownAt)).toBe(false);
      expect(fs.readFileSync(protoAt, "utf8")).toBe(wrote.join("\n"));
      // Отказ — целиком: ключа нет, ключ дважды, клеток больше граф.
      const first = answers.split("\n")[0];
      const key = answers
        .split("\n")
        .find((line) => /^[A-U][0-9]/.test(line))
        .split(" | ")[0];
      for (const [bad, why] of [
        ["Z99 | чисто |  |  | ", "ключа «Z99» в протоколе нет"],
        [first + "\n" + first, "дважды"],
        [
          key + " | чисто | — | проба |  | лишняя",
          "клеток 5, а заполняемых граф у «" + key + "» 4",
        ],
      ]) {
        fs.writeFileSync(protoAt, blank);
        fs.writeFileSync(answersAt, bad + "\n");
        const r = tool("bar-fill", answersAt);
        expect(r.code).toBe(1);
        expect(r.out).toContain(why);
        expect(fs.readFileSync(protoAt, "utf8")).toBe(blank);
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("серия", () => {
  // Ослабленный конфиг цепочки уходил в историю зелёным: кода нет — свод не
  // спрашивался (находка Н-10, решение Р7).
  it("коммит конфига цепочки: ворота требуют цепочку, свода не требуют", () => {
    const box = seatEmpty("konfig-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=k", "-c", "user.email=k@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = (...args) => {
        const r = spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8", input: "{}" },
        );
        return { code: r.status, out: String(r.stdout ?? "") };
      };
      fakeCheck(box, "RED");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      const tsAt = path.join(box, "tsconfig.json");
      const was = fs.readFileSync(tsAt, "utf8");
      fs.writeFileSync(tsAt, was.replace('"strict": true', '"strict": false'));
      git("add", "tsconfig.json");
      const held = tool("gate");
      expect(held.code, held.out).toBe(1);
      expect(held.out).toContain("конфигов цепочки в индексе: 1");
      expect(held.out).toContain("    tsconfig.json");
      expect(held.out).toContain("дерево индекса цепочку не проходило");
      // Серия без протокола: правка без кода — одна часть.
      fs.writeFileSync(path.join(box, "RED"), "");
      const red = tool("series");
      expect(red.code, red.out).toBe(1);
      expect(red.out).toContain("=== Серия встала ===");
      fs.rmSync(path.join(box, "RED"));
      const green = tool("series");
      expect(green.code, green.out).toBe(0);
      expect(tool("series", "--stage", "1").code).toBe(0);
      const passed = tool("gate");
      expect(passed.code, passed.out).toBe(0);
      expect(passed.out).toContain("свод не спрашивается, дерево индекса прошло цепочку");
      expect(fs.existsSync(path.join(box, ".context", "bar-protocol.md"))).toBe(false);
      // Настройка инструмента — тоже конфиг цепочки; база — нет.
      git("commit", "-qm", "конфиг", "--no-verify");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.appendFileSync(cfgAt, "\n");
      fs.appendFileSync(path.join(box, ".context", "02-todo.md"), "\n");
      git("add", "-A");
      const tool2 = tool("gate");
      expect(tool2.code, tool2.out).toBe(1);
      expect(tool2.out).toContain("    .context/graph.config.mjs");
      expect(tool2.out).not.toContain("02-todo.md");
      git("reset", "-q", "--", ".context/graph.config.mjs");
      fs.writeFileSync(cfgAt, git("show", "HEAD:.context/graph.config.mjs"));
      const base = tool("gate");
      expect(base.code, base.out).toBe(0);
      expect(base.out).toContain("кода в коммите нет — свод не спрашивается");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("прогон по частям, отметки по дереву, красная часть названа, индекс — ровно дерево части", () => {
    const box = seatEmpty("seriya-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=u",
            "-c",
            "user.email=u@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      const tool = (...args) => {
        const r = spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
        return { code: r.status, out: String(r.stdout ?? "") };
      };
      const put = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      };
      // Красная часть — та, где лежит файл-метка: он в папке второй единицы
      // и уходит с её частью.
      fakeCheck(box, "src/shared/zzb/red.ts");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      const mapAt = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n";
      const mapWas = fs.readFileSync(mapAt, "utf8");
      const mapRows = (rows) =>
        fs.writeFileSync(mapAt, mapWas.replace(head, head + rows));
      const rowsAb =
        "| `src/shared/zza/zza.ts` | первое | нет | нет |\n| `src/shared/zzb/zzb.ts` | второе | нет | нет |\n";
      put("src/shared/zza/zza.ts", "export const zza = 1;\n");
      put("src/shared/zzb/zzb.ts", "export const zzb = 2;\n");
      mapRows(rowsAb);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      // Свод заново — с чистого протокола: слова изменившихся страниц иначе
      // остались бы прежними, а проба страниц не перечитывает.
      const sealed = () => {
        fs.rmSync(protoAt, { force: true });
        tool("bar");
        fillBar(protoAt, { release: "не нужно: проба", keepParts: true });
        const out = tool("bar").out;
        expect(out, out).toContain("печать поставлена");
      };
      tool("bar");
      const proposed = fs.readFileSync(protoAt, "utf8");
      expect(proposed).toContain("| 1 | `shared/zza/zza.ts` |  |");
      expect(proposed).toContain("| 2 | `shared/zzb/zzb.ts` |  |");
      sealed();
      // Без отметки дерево в индекс не кладётся.
      expect(tool("series", "--stage", "1").out).toContain(
        "цепочку не проходило",
      );
      const first = tool("series");
      expect(first.code, first.out).toBe(0);
      expect(first.out).toMatch(/часть 1: дерево [0-9a-f]{7} — код 0\n/);
      expect(first.out).toMatch(/часть 2: дерево [0-9a-f]{7} — код 0\n/);
      // Дерево с отметкой заново не гоняется.
      expect(tool("series").out.match(/отметка была/g)?.length).toBe(2);
      // Правка после свода: серия ждёт свода заново, а он меняет протокол —
      // и протокол лежит в первой части, поэтому гоняются обе.
      put("src/shared/zzb/zzb.ts", "export const zzb = 3;\n");
      const stale = tool("series");
      expect(stale.code).toBe(1);
      expect(stale.out).toContain("свод сделан на другом его виде");
      sealed();
      const again = tool("series").out;
      expect(again).toMatch(/часть 1: дерево [0-9a-f]{7} — код 0\n/);
      expect(again).toMatch(/часть 2: дерево [0-9a-f]{7} — код 0\n/);
      // Красная часть названа, вывод — в файле.
      put("src/shared/zzb/red.ts", "export const red = 1;\n");
      mapRows(rowsAb + "| `src/shared/zzb/red.ts` | метка | нет | нет |\n");
      sealed();
      const red = tool("series");
      expect(red.code).toBe(1);
      expect(red.out).toContain("Часть 2 красная");
      expect(red.out).toMatch(/часть 1: [^\n]*код 0/);
      fs.rmSync(path.join(box, "src", "shared", "zzb", "red.ts"));
      mapRows(rowsAb);
      sealed();
      expect(tool("series").code).toBe(0);
      // Индекс — ровно дерево части: первая часть без второй.
      expect(tool("series", "--stage", "1").out).toContain("часть 1 из 2");
      const staged = git("diff", "--cached", "--name-only")
        .split("\n")
        .filter(Boolean);
      expect(staged).toContain("src/shared/zza/zza.ts");
      expect(staged).not.toContain("src/shared/zzb/zzb.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  // Цепочка проекта на дереве промежуточной части видит протокол всей пачки:
  // сверка свода спрашивает там подмножество, а всю правку и приём — на
  // последней части, чьё дерево равно рабочему.
  it("сверка свода в цепочке серии: промежуточная часть — подмножество, последняя — вся правка", () => {
    const box = seatEmpty("seriya-svod-");
    const sink = path.join(
      os.tmpdir(),
      "seriya-svod-" + process.pid + "-" + Date.now() + ".txt",
    );
    try {
      const git = (...args) =>
        spawnSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", ...args],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
      const tool = (...args) => {
        const r = spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
        return { code: r.status, out: String(r.stdout ?? "") };
      };
      const put = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      };
      // Цепочка — одна сверка свода: красна, если её секция называет дыру;
      // секцию дописывает в файл вне репозитория.
      put(
        "chk.mjs",
        [
          'import { appendFileSync } from "node:fs";',
          'import { spawnSync } from "node:child_process";',
          'const out = spawnSync(process.execPath, [".claude/tools/graph.mjs", "verify"], { encoding: "utf8" }).stdout;',
          'const said = (out.split("=== Планка пройдена покритериально ===")[1] ?? "").split("\\n===")[0];',
          "appendFileSync(" + JSON.stringify(sink) + ", said);",
          "process.exit(/^ {4}\\S/m.test(said) ? 1 : 0);",
          "",
        ].join("\n"),
      );
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts.check = "node chk.mjs";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      const mapAt = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n";
      fs.writeFileSync(
        mapAt,
        fs
          .readFileSync(mapAt, "utf8")
          .replace(
            head,
            head +
              "| `src/shared/zza/zza.ts` | первое | нет | нет |\n| `src/shared/zzb/zzb.ts` | второе | нет | нет |\n",
          ),
      );
      put("src/shared/zza/zza.ts", "export const zza = 1;\n");
      put("src/shared/zzb/zzb.ts", "export const zzb = 2;\n");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба", keepParts: true });
      expect(tool("bar").out).toContain("части ждут коммита: 1–2 из 2");
      const ran = tool("series");
      const said = fs.existsSync(sink) ? fs.readFileSync(sink, "utf8") : "";
      expect(ran.code, ran.out + said).toBe(0);
      expect(said).toContain(
        "часть 1 из 2 серии: код части назван печатью на том же виде",
      );
      expect(said).toContain("свод закрыт печатью и принят");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      fs.rmSync(sink, { force: true });
    }
  }, 300000);

  // Ворота пропускают коммит с кодом, только если индекс — дерево части,
  // прошедшее цепочку, и ложится на дерево предыдущей части; печать протокола
  // при этом сходится. Части коммитят по порядку, через обычные хуки.
  it("коммит на часть через ворота: печать, дерево, порядок; работа в одну часть тем же путём", () => {
    const box = seatEmpty("seriya-vorota-");
    try {
      const git = (...args) =>
        spawnSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", ...args],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
      const tool = (...args) => {
        const r = spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          {
            cwd: box,
            encoding: "utf8",
          },
        );
        return { code: r.status, out: String(r.stdout ?? "") };
      };
      const put = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      };
      fakeCheck(box);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      git("config", "core.hooksPath", ".claude/hooks/git");
      const mapAt = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n";
      const mapRows = (rows) =>
        fs.writeFileSync(
          mapAt,
          fs.readFileSync(mapAt, "utf8").replace(head, head + rows),
        );
      put("src/shared/zza/zza.ts", "export const zza = 1;\n");
      put("src/shared/zzb/zzb.ts", "export const zzb = 2;\n");
      mapRows(
        "| `src/shared/zza/zza.ts` | первое | нет | нет |\n| `src/shared/zzb/zzb.ts` | второе | нет | нет |\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба", keepParts: true });
      const sealed = tool("bar").out;
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain("части ждут коммита: 1–2 из 2");
      // Серия не прогнана — ворота не пускают всю пачку разом.
      git("add", "-A");
      const unrun = git("commit", "-qm", "всё разом");
      expect(unrun.status).not.toBe(0);
      expect(unrun.stdout + unrun.stderr).toContain(
        "дерево индекса цепочку не проходило",
      );
      git("reset", "-q");
      expect(tool("series").code).toBe(0);
      // Не по порядку — отказ; индекс шире части — отказ.
      expect(tool("series", "--stage", "2").out).toContain("следующая — 1");
      expect(tool("series", "--stage", "1").code).toBe(0);
      git("add", "src/shared/zzb/zzb.ts");
      const wider = git("commit", "-qm", "шире части");
      expect(wider.stdout + wider.stderr).toContain(
        "дерево индекса цепочку не проходило",
      );
      // Дерево второй части прямо на основание — мимо первой: отказ.
      const marks = JSON.parse(
        fs.readFileSync(path.join(box, ".git", "graph-series.json"), "utf8"),
      );
      git("read-tree", marks.parts[1].tree);
      const skipped = git("commit", "-qm", "мимо первой");
      expect(skipped.stdout + skipped.stderr).toContain(
        "части коммитят по порядку",
      );
      git("reset", "-q");
      // Протокол правлен после печати — серия не гоняется: деревьям частей
      // ворота верят без отпечатков, и печать обязана покрывать правку.
      const proto = fs.readFileSync(protoAt, "utf8");
      fs.writeFileSync(protoAt, proto + "\n");
      const unsealed = tool("series");
      expect(unsealed.code).toBe(1);
      expect(unsealed.out).toContain("печать не сходится");
      fs.writeFileSync(protoAt, proto);
      // Первая часть — руками. Серия жива: свод и конец хода судят всю
      // пачку от основания, а не остаток против последнего коммита.
      expect(tool("series").code).toBe(0);
      tool("series", "--stage", "1");
      const part1 = git("commit", "-qm", "add part 1");
      expect(part1.status, part1.stdout + part1.stderr).toBe(0);
      const living = tool("bar").out;
      expect(living).toContain("печать уже стоит");
      expect(living).toContain("части ждут коммита: 2 из 2");
      const stop = spawnSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "stop", "--hook"],
        { cwd: box, encoding: "utf8", input: "{}" },
      );
      expect(stop.status, stop.stderr).toBe(0);
      // Остальные части — по слову разработчика, через обычные хуки.
      const done = tool("series", "--commit");
      expect(done.code, done.out).toBe(0);
      expect(done.out).not.toContain("часть 1 закоммичена");
      const log = git("log", "--format=%B%x00", "-2")
        .stdout.split("\0")
        .map((m) => m.trim())
        .filter(Boolean);
      expect(log[1]).toMatch(
        /^add part 1\n\nBar-series: [0-9a-f]+ 1\/2 [0-9a-f]{40}$/,
      );
      expect(log[0]).toMatch(
        /^add part 2\n\nBar-series: [0-9a-f]+ 2\/2 [0-9a-f]{40}$/,
      );
      expect(git("status", "--porcelain").stdout).toBe("");
      // Работа в одну часть — тем же путём: свод, серия, часть в индекс, коммит.
      put("src/shared/zza/zza.ts", "export const zza = 3;\n");
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба", keepParts: true });
      expect(tool("bar").out).toContain("печать поставлена");
      git("add", "-A");
      expect(git("commit", "-qm", "без серии").status).not.toBe(0);
      git("reset", "-q");
      expect(tool("series").code).toBe(0);
      expect(tool("series", "--stage", "1").code).toBe(0);
      const one = git("commit", "-qm", "single part");
      expect(one.status, one.stdout + one.stderr).toBe(0);
      expect(git("log", "--format=%B", "-1").stdout).toMatch(
        /Bar-series: [0-9a-f]+ 1\/1 [0-9a-f]{40}/,
      );
      // Ревизия по истории: основания сводов и серии — первый коммит. Коммиты
      // частей сходятся; коммит с кодом мимо серии и строка с чужим деревом —
      // красные навсегда.
      const first = git("rev-list", "--max-parents=0", "HEAD").stdout.trim();
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      const cfg = fs.readFileSync(cfgAt, "utf8");
      expect(cfg).toMatch(/seriesSince:\s*null/);
      fs.writeFileSync(
        cfgAt,
        cfg
          .replace(/barSince:\s*null/, "barSince: " + JSON.stringify(first))
          .replace(
            /seriesSince:\s*null/,
            "seriesSince: " + JSON.stringify(first),
          ),
      );
      // Настройка инструмента — конфиг цепочки: коммит идёт деревом,
      // прошедшим цепочку, а свода не требует.
      seriesStaged(box);
      expect(git("commit", "-qm", "revision bases").status).toBe(0);
      const past = () =>
        tool("verify")
          .out.split("=== Коммит с кодом накрыт сводом ===")[1]
          ?.split("\n===")[0] ?? "";
      expect(past()).toContain("без свода: 0");
      put("src/shared/zza/zza.ts", "export const zza = 4;\n");
      git("commit", "-qam", "past the series", "--no-verify");
      const bypass = past();
      expect(bypass).toContain("без свода: 1");
      expect(bypass).toContain("без строки серии");
      git("reset", "-q", "--hard", "HEAD^");
      put("src/shared/zza/zza.ts", "export const zza = 4;\n");
      git("add", "-A");
      git(
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "forged\n\nBar-series: abc 1/1 " + "0".repeat(40),
      );
      expect(past()).toContain("строка серии называет не дерево этого коммита");
      // Последняя часть отвечает за всю правку: строка «1/1» на дереве первой
      // из двух частей сходится сама по себе, а протокол называет и вторую.
      git("reset", "-q", "--hard", "HEAD^");
      put("src/shared/zza/zza.ts", "export const zza = 5;\n");
      put("src/shared/zzb/zzb.ts", "export const zzb = 6;\n");
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба", keepParts: true });
      expect(tool("bar").out).toContain("части ждут коммита: 1–2 из 2");
      expect(tool("series").code).toBe(0);
      const sealOf = /- печать: `([0-9a-f]+)`/.exec(
        fs.readFileSync(protoAt, "utf8"),
      )[1];
      const parts = JSON.parse(
        fs.readFileSync(path.join(box, ".git", "graph-series.json"), "utf8"),
      ).parts;
      tool("series", "--stage", "1");
      git(
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "half\n\nBar-series: " + sealOf + " 1/1 " + parts[0].tree,
      );
      expect(past()).toContain("назван сводом, а в правке его нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

// Ссылку на решение код несёт адресом записи базы — так велит правило о
// комментариях. Сверка якорей знала целями одну документацию и прозу полки, и
// живая запись базы читалась «ведущей в никуда». Найдено посадкой по
// инструкции: якорь конфига корня на `.context/09-decisions.md`.
describe("якорь из кода ведёт и в запись базы", () => {
  it("живая запись базы — цель, несуществующая — нет", () => {
    const box = seatEmpty("yakor-baza-");
    try {
      const at = path.join(box, ".prettierignore");
      fs.writeFileSync(
        at,
        fs.readFileSync(at, "utf8") +
          "# Decision: .context/09-decisions.md\n# Gone: .context/zz-nothere.md\n",
      );
      const said = (
        verifyIn(box).get("Якоря на документацию в коде") ?? []
      ).join(" ");
      expect(said).not.toContain("09-decisions.md");
      expect(said).toContain(".prettierignore → .context/zz-nothere.md");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("правка против её тестов называет записи базы, документацию и удалённое", () => {
  // На эти секции `tested` опираются правила: записи соседей (`code.md`,
  // «Как заводится новый узел», пункт 5), документация тронутого файла
  // (`loop.md`, «Петля», шаг 6), записи об удалённом (`code.md`, «Как
  // убирается узел»). Секцию документации, вырезанную целиком, прежде не
  // заметил ни один тест режима.
  it("каждая секция называет адрес своей записи", () => {
    const box = seatEmpty("testedsec-");
    try {
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      put("src/components/ZzCard/ZzCard.tsx", "export function ZzCard() {\n  return null;\n}\n");
      put("src/components/ZzCard/docs/README.md", "# ZzCard\n\nThe card lives in `ZzCard.tsx`.\n");
      put("src/shared/zzGone/zzGone.ts", "export const zzGone = 1;\n");
      const mapAt = path.join(box, ".context", "00-map.md");
      const setupRow = "| `src/tests/setup.ts` |";
      const map = fs.readFileSync(mapAt, "utf8");
      const at = map.indexOf(setupRow);
      const end = map.indexOf("\n", at);
      fs.writeFileSync(
        mapAt,
        map.slice(0, end + 1) +
          "| `src/components/ZzCard/ZzCard.tsx` | карточка | нет | нет |\n" +
          "| `src/shared/zzGone/zzGone.ts` | уходящий узел | нет | нет |\n" +
          map.slice(end + 1),
      );
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=t", "-c", "user.email=t@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      put("src/components/ZzCard/ZzCard.tsx", "export function ZzCard() {\n  return undefined;\n}\n");
      fs.rmSync(path.join(box, "src", "shared", "zzGone"), { recursive: true });
      let out;
      try {
        out = execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "tested"], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        out = String(e.stdout ?? "");
      }
      const part = (head) => out.split("=== " + head + " ===")[1]?.split("\n=== ")[0] ?? "";
      expect(part("Записи базы про тронутые файлы")).toMatch(/components\/ZzCard\/ZzCard\.tsx\n\s+00-map\.md:\d+/);
      expect(part("Записи базы про тронутые файлы")).toContain("таблица в `base-format.md`, раздел «Файлы»");
      expect(part("Документация тронутых файлов")).toContain("components/ZzCard/docs/README.md");
      expect(part("Удалённые файлы: что о них осталось в базе")).toMatch(/shared\/zzGone\/zzGone\.ts\n\s+00-map\.md:\d+/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("хуки называют правила, изменённые после начала сессии", () => {
  // Правила без шапки среда кладёт в контекст при старте и не обновляет:
  // после `git pull` посреди сессии в контексте оставался прежний текст.
  it("снимок на первом вызове, напоминание до чтения, своя правка и правила с шапкой — без напоминания", () => {
    const box = seatEmpty("rules-");
    try {
      execFileSync("git", ["init", "-q"], { cwd: box });
      const hook = (mode, said) => {
        const out = spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), mode, "--hook"],
          { cwd: box, encoding: "utf8", input: JSON.stringify({ session_id: "zz-s", ...said }) },
        );
        const json = out.stdout.trim();
        return json === "" ? "" : (JSON.parse(json).hookSpecificOutput?.additionalContext ?? "");
      };
      const bash = { tool_name: "Bash", tool_input: { command: "ls" } };
      const rule = (name) => path.join(box, ".claude", "rules", name);
      expect(hook("guard", bash)).toBe("");
      fs.appendFileSync(rule("loop.md"), "\nновая строка\n");
      // Правило с шапкой приходит заново, когда открыт его файл: о нём молчат.
      fs.appendFileSync(rule("quality.md"), "\nновая строка\n");
      const said = hook("guard", bash);
      expect(said).toContain("`.claude/rules/loop.md` (изменён)");
      expect(said).not.toContain("quality.md");
      expect(hook("guard", bash)).toContain("loop.md");
      expect(hook("guard", { tool_name: "Read", tool_input: { file_path: rule("loop.md") } })).toBe("");
      // Своя правка через Edit — напоминания нет ни на ней, ни после.
      expect(hook("transition", { tool_name: "Edit", tool_input: { file_path: rule("safety.md") } })).toBe("");
      fs.appendFileSync(rule("safety.md"), "\nсвоя строка\n");
      expect(hook("guard", bash)).toBe("");
      // Новая сессия — новый снимок.
      fs.appendFileSync(rule("base.md"), "\nновая строка\n");
      expect(hook("guard", { ...bash, session_id: "zz-s2" })).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});
