import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TOOL_DIR,
  TOOL,
  SUBJECT,
  OUTSIDE,
  modes,
  smoke,
  LOOKED,
  CRASH,
  seatEmpty,
  verifyIn,
} from "./graph.modes.shared.mjs";

// Тесты, которые гоняют режимы в корне этой посадки: хуки ниже снимают и
// возвращают её базу, и параллельный файл не должен застать её посреди прогона.

/** База, какой она была до прогона.
 *
 * Режимы не только читают: свод по планке ПИШЕТ протокол. Пока целью
 * служил файл самого набора, режим выходил раньше записи и побочного
 * действия не было видно. Как только целью стал живой исходник, прогон
 * набора стал превращать запечатанный протокол текущей работы в пустой
 * скелет — предмет не совпал, и свод начался заново.
 *
 * Круг от этого замыкался: набор гоняется звеном `test`, звено входит в
 * связку проверок, а сверка базы требует печати — то есть связка стирала
 * печать, которую сама же потом и спрашивала. Замерено воспроизведением:
 * печать «на изменение» до прогона, пустой скелет «на чтение» после.
 *
 * Снимается и возвращается вся папка базы, а не один протокол: писать туда
 * может любой режим, и список имён разошёлся бы с ними молча.
 */
const BASE_DIR = path.join(TOOL_DIR, "..", "..", ".context");
let baseWas = null;

beforeAll(() => {
  if (!fs.existsSync(BASE_DIR)) return;
  baseWas = new Map();
  for (const name of fs.readdirSync(BASE_DIR)) {
    const at = path.join(BASE_DIR, name);
    if (fs.statSync(at).isDirectory()) continue;
    baseWas.set(name, fs.readFileSync(at));
  }
});

afterAll(() => {
  if (baseWas === null) return;
  for (const name of fs.readdirSync(BASE_DIR)) {
    const at = path.join(BASE_DIR, name);
    if (fs.statSync(at).isDirectory()) continue;
    if (!baseWas.has(name)) fs.rmSync(at);
  }
  for (const [name, body] of baseWas)
    fs.writeFileSync(path.join(BASE_DIR, name), body);
});
// Правило раскладки держит этот тест, а не справочник: тест из корня
// посадки, положенный в часть, шёл бы параллельно с хуками базы выше.
describe("корень посадки трогают только тесты этого файла", () => {
  it("ни одна часть тестов режимов не обращается к корню посадки", () => {
    const root = /TOOL_DIR, "\.\.", "\.\."|\bSUBJECT\b|\bBASE_DIR\b/;
    const offenders = fs
      .readdirSync(TOOL_DIR)
      .filter(
        (n) =>
          /^graph\.modes\..+\.test\.mjs$/.test(n) &&
          !n.endsWith(".root.test.mjs"),
      )
      .flatMap((n) =>
        fs
          .readFileSync(path.join(TOOL_DIR, n), "utf8")
          .split("\n")
          .map((line, i) => [n + ":" + (i + 1), line])
          .filter(([, line]) => root.test(line))
          .map(([at]) => at),
      );
    expect(offenders).toEqual([]);
  });
});

describe("режимы инструмента запускаются", () => {
  it("инструмент назвал свои режимы", () => {
    expect(modes.length, "список режимов не прочитан").toBeGreaterThan(0);
  });

  it.each(smoke)(
    "%s",
    (mode) => {
      let said = "";
      try {
        said = execFileSync(process.execPath, [TOOL, mode, SUBJECT], {
          cwd: path.join(TOOL_DIR, "..", ".."),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120000,
        });
      } catch (e) {
        said = String(e.stdout ?? "") + String(e.stderr ?? "");
      }
      expect(said, `${mode}: пустой вывод — режим ничего не сказал`).not.toBe(
        "",
      );
      const hit = CRASH.exec(said);
      expect(
        hit === null,
        `${mode} упал: ${said.split("\n").find((l) => CRASH.test(l)) ?? ""}`,
      ).toBe(true);
      expect(
        LOOKED.test(said),
        `${mode} не назвал размер осмотренного: строки «осмотрено <чего>: <сколько>» в выводе нет`,
      ).toBe(true);
      // Срок теста назван ЯВНО и совпадает со сроком подпроцесса. Умолчание
      // раннера — пять секунд, и режим, отработавший дольше, падал сообщением
      // «Test timed out in 5000ms»: про обвязку оно не говорит ничего, а
      // случается на любом проекте, который больше стенда. Замерено посадкой
      // стенда с двумя деревьями: verify отработал за шесть секунд.
    },
    120000,
  );

  it("каждый режим либо в дымовом прогоне, либо назван с причиной", () => {
    for (const mode of modes) {
      const covered = smoke.includes(mode) || OUTSIDE[mode] !== undefined;
      expect(covered, `${mode} — ни в прогоне, ни в списке с причиной`).toBe(
        true,
      );
    }
    for (const mode of Object.keys(OUTSIDE)) {
      expect(
        modes.includes(mode),
        `${mode} назван причиной, а такого режима нет`,
      ).toBe(true);
    }
  });
});

/**
 * Сборка снимка — отдельно, во ВРЕМЕННУЮ папку: без пути режим кладёт снимок
 * рядом с репозиторием, а с путём побочного действия у него нет.
 *
 * Сборка не просто копирует: она сажает снимок в пустую папку и требует от
 * сверки базы кода ноль. То есть этот тест держит и то, что свежая посадка
 * под флагом не краснеет. Держать это было нечем: режим никто не звал, и
 * когда вердикт прогона перестал смягчать сверки под флагом, снимок
 * перестал собираться — молча, до первой сборки руками, после десятков
 * коммитов. Замерено посадками по инструкции.
 */
/**
 * Проверенная связка объявлена полем `verifiedVersions` семени настройки, а
 * README мастерской и обвязки повторяют её числа прозой. Поле правят — проза
 * остаётся прежней без признака: её не читает ни одна сверка, README
 * мастерской лежит вне `.claude`. Найдено прогоном проб по холодной оси.
 * Мастерскую называет метка посадки: тесты обвязки идут на посадке режима
 * `seat`, и она пишет в метку адрес полки.
 */
describe("проверенная связка в README названа теми же числами", () => {
  it("каждая версия поля есть в README мастерской; версия среды — в README обвязки", async () => {
    const root = path.join(TOOL_DIR, "..", "..");
    const mark = path.join(root, ".git", "claude-seat");
    expect(
      fs.existsSync(mark),
      "тесты обвязки идут на посадке режима seat: нет метки " + mark,
    ).toBe(true);
    const shelf = fs.readFileSync(mark, "utf8").trim();
    const { CONFIG } = await import(
      path.join(TOOL_DIR, "..", "seat", "templates", "graph.config.mjs")
    );
    const versions = Object.entries(CONFIG.verifiedVersions);
    expect(versions.length).toBeGreaterThan(0);
    for (const name of ["README.md", "README.ru.md"]) {
      const text = fs.readFileSync(path.join(shelf, "..", name), "utf8");
      for (const [pkg, version] of versions)
        expect(text.includes(version), name + ": " + pkg + " " + version).toBe(
          true,
        );
    }
    const own = fs.readFileSync(path.join(TOOL_DIR, "..", "README.md"), "utf8");
    expect(own).toContain("`" + CONFIG.verifiedVersions.node + "`");
    expect(own).toContain(
      "npm `" + CONFIG.verifiedVersions.npm.split(".")[0] + "`",
    );
  });
});

describe("снимок обвязки собирается", () => {
  it("handoff во временную папку отдаёт код 0 и сажается в пустую", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "snimok-"));
    try {
      const out = execFileSync(process.execPath, [TOOL, "handoff", box], {
        cwd: path.join(TOOL_DIR, "..", ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(out).toContain("СНИМОК СОБРАН");
      expect(out).toContain("сверка базы — код 0");
      const memo = fs.readFileSync(path.join(box, "ЧИТАТЬ-ПЕРВЫМ.md"), "utf8");
      const named = [...memo.matchAll(/`(\.claude\/[^`]+)`/g)].map((m) => m[1]);
      expect(named.length).toBeGreaterThan(0);
      for (const one of named)
        expect(fs.existsSync(path.join(box, one)), one).toBe(true);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Испытательная посадка одной командой. Прежде её заводили процедурой из
 * справочника, копируя в оболочку, и шаг, пропущенный сессией, ломал замер,
 * не давая признака. Пакеты в наборе — ссылкой на пакеты посадки, где он
 * идёт, без сети; отказ без пакетов проверяется с выключенной сетью.
 */
describe("испытательная посадка одной командой", () => {
  const seatIn = (dest, ...rest) =>
    spawnSync(process.execPath, [TOOL, "seat", dest, ...rest], {
      cwd: path.join(TOOL_DIR, "..", ".."),
      encoding: "utf8",
    });

  it("собирается со сверкой ноль; повторный вызов обновляет обвязку и пакеты не трогает", () => {
    const dest = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "seat-")),
      "p",
    );
    try {
      const first = seatIn(dest);
      expect(first.status, first.stdout).toBe(0);
      expect(first.stdout).toContain("=== Посадка собрана ===");
      expect(first.stdout).toContain("пакеты: ссылкой на ");
      expect(first.stdout).toContain("сверка базы: код 0");
      const pkg = path.join(dest, "node_modules", "vitest");
      const linked = fs.readlinkSync(pkg);
      const stray = path.join(dest, ".claude", "tools", "zz-stray.txt");
      fs.writeFileSync(stray, "лишнее\n");
      const again = seatIn(dest);
      expect(again.status, again.stdout).toBe(0);
      expect(again.stdout).toContain("=== Посадка обновлена ===");
      expect(again.stdout).toContain("снято 1");
      expect(again.stdout).toContain("пакеты: не тронуты");
      expect(fs.existsSync(stray)).toBe(false);
      expect(fs.readlinkSync(pkg)).toBe(linked);
      expect(fs.existsSync(path.join(dest, "package-lock.json"))).toBe(false);
      expect(seatIn(dest, "--shop").stdout).toContain("на свежую посадку");
      const self = spawnSync(
        process.execPath,
        [path.join(dest, ".claude", "tools", "graph.mjs"), "seat", dest],
        { cwd: dest, encoding: "utf8" },
      );
      expect(self.status, self.stdout).toBe(1);
      expect(self.stdout).toContain("Полка сажается сама в себя");
    } finally {
      fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    }
  }, 300000);

  // Скрипты, которые посадка пишет в манифест вне связки `check`, не
  // исполняет ни одна проверка: покрытие печатало `100%` при модуле без
  // тестов, сборку не запускал никто. `dev` и `preview` не завершаются сами.
  it("скрипты семени вне связки: сборка собирается, покрытие видит модуль без тестов", () => {
    const dest = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "seat-scripts-")),
      "p",
    );
    try {
      const made = seatIn(dest);
      expect(made.status, made.stdout).toBe(0);
      const untested = path.join(dest, "src", "shared", "zz", "zzUntested.ts");
      fs.mkdirSync(path.dirname(untested), { recursive: true });
      fs.writeFileSync(
        untested,
        "export const zzUntested = (n: number): number => n + 1;\n",
      );
      const npm = (script) =>
        spawnSync("npm", ["run", script], { cwd: dest, encoding: "utf8" });
      const build = npm("build");
      expect(build.status, build.stdout + build.stderr).toBe(0);
      const coverage = npm("test:coverage");
      expect(coverage.status, coverage.stdout + coverage.stderr).toBe(0);
      const report = JSON.parse(
        fs.readFileSync(
          path.join(dest, "coverage", "coverage-final.json"),
          "utf8",
        ),
      );
      expect(Object.keys(report).some((f) => f.endsWith("zzUntested.ts"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    }
  }, 300000);

  // Живой проект с обвязкой выглядит как посадка: `.git` и `graph.mjs`.
  // Повторный вызов стёр бы в его `.claude/` всё, чего нет на полке.
  it("в чужой проект с обвязкой не садится и его файлов не стирает", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "seat-alien-"));
    try {
      fs.mkdirSync(path.join(dest, ".git"));
      fs.mkdirSync(path.join(dest, ".claude", "tools"), { recursive: true });
      fs.mkdirSync(path.join(dest, ".claude", "agents"));
      fs.writeFileSync(path.join(dest, ".claude", "tools", "graph.mjs"), "\n");
      const own = path.join(dest, ".claude", "agents", "reviewer.md");
      fs.writeFileSync(own, "свой агент\n");
      const run = seatIn(dest);
      expect(run.status, run.stdout).toBe(1);
      expect(run.stdout).toContain("нет метки claude-seat");
      expect(fs.readFileSync(own, "utf8")).toBe("свой агент\n");
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  // Магазин лежит данными и собирается поверх посадки: правка семян роняет
  // его без правки его файлов.
  it("магазин поверх: сверка базы и проверки проекта — код ноль", () => {
    const dest = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "seat-shop-")),
      "p",
    );
    try {
      const built = seatIn(dest, "--shop");
      expect(built.status, built.stdout).toBe(0);
      expect(built.stdout).toContain("магазин поверх, файлов: ");
      const env = { ...process.env };
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const check = spawnSync("npm", ["run", "check"], {
        cwd: dest,
        encoding: "utf8",
        env,
      });
      expect(
        check.status,
        (check.stdout + check.stderr).split("\n").slice(-40).join("\n"),
      ).toBe(0);
    } finally {
      fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    }
  }, 300000);

  it("нет пакетов и нет сети — отказ с причиной, папка убрана", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "seat-bare-"));
    try {
      fs.cpSync(path.join(TOOL_DIR, ".."), path.join(box, "shelf", ".claude"), {
        recursive: true,
      });
      const dest = path.join(box, "p");
      const cache = path.join(box, "npm-cache");
      fs.mkdirSync(cache);
      const said = spawnSync(
        process.execPath,
        [
          path.join(box, "shelf", ".claude", "tools", "graph.mjs"),
          "seat",
          dest,
        ],
        {
          cwd: path.join(box, "shelf"),
          encoding: "utf8",
          env: {
            ...process.env,
            npm_config_offline: "true",
            npm_config_cache: cache,
          },
        },
      );
      expect(said.status).toBe(1);
      expect(said.stdout).toContain("=== Посадка не собрана ===");
      expect(said.stdout).toContain("Пакеты не встали");
      expect(fs.existsSync(dest)).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Ворота пропускают ОДНО приведение формата и не пропускают смысл под его
 * видом. Держать это прогоном нечем: ворота зовёт хук git, а не цепочка, и
 * отдельный коммит формата, которого требует посадка, не проходил их ни в
 * одном проекте, чей код форматтер переписывает. Замерено на копии стенда.
 *
 * Обвязка сажается в пустую папку со своим репозиторием, и с ней едет один
 * пакет форматтера хозяина: инструменту из пакетов нужен только он. Ссылкой на
 * папку пакетов не обходятся намеренно — рекурсивное удаление временной папки
 * не должно иметь дороги в живые пакеты хозяина.
 */
describe("ворота и приведение формата", () => {
  it("коммит одного формата проходит, смысл под видом формата — нет", async () => {
    const home = path.join(TOOL_DIR, "..", "..");
    // Посаженный пустой проект, а не копия хозяина: копия зависела от его
    // раскладки и падала в любом проекте без `src/app/`.
    const box = seatEmpty("vorota-");
    try {
      fs.cpSync(
        path.join(home, "node_modules", "prettier"),
        path.join(box, "node_modules", "prettier"),
        { recursive: true },
      );
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=vorota",
            "-c",
            "user.email=vorota@local",
            "-c",
            "core.hooksPath=",
            ...args,
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      // Файл проекта, а не семя: нетронутое семя ворота пропускают по
      // своему признаку, и приведение на нём не проверило бы ничего.
      const file = path.join(box, "src", "app", "zzOwn.ts");
      const neat = [
        "export const zzOwn = (n: number): number => {",
        "  return n + 1;",
        "};",
        "",
      ].join("\n");
      fs.writeFileSync(file, neat);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "база", "--no-verify");
      fs.writeFileSync(file, neat.split("return ").join("return    "));
      git("commit", "-qam", "старый код без формата", "--no-verify");
      fs.writeFileSync(file, neat);
      git("add", "-A");
      const gate = () => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), "gate"],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      const clean = gate();
      expect(clean.out).toContain("одно приведение формата");
      expect(clean.code).toBe(0);
      fs.writeFileSync(file, neat + "export const zzMeant = 1;\n");
      git("add", "-A");
      const meant = gate();
      expect(meant.out).toContain("Коммит не проходит");
      expect(meant.code).toBe(1);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Страж обхода ворот отвечает хуку среды на каждый вызов Bash. Держит три
 * вещи: обход останавливается кодом `2` с причиной для модели, обычная
 * команда проходит, и ответ не зависит от базы проекта — страж разбирается до
 * её чтения, иначе каждый вызов платил бы за обход дерева.
 */
describe("страж обхода ворот", () => {
  const ask = (cwd, command) =>
    spawnSync(process.execPath, [path.join(cwd, ".claude", "tools", "graph.mjs"), "guard", "--hook"], {
      cwd,
      encoding: "utf8",
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    });

  it("останавливает коммит мимо ворот и пропускает обычный", () => {
    const home = path.join(TOOL_DIR, "..", "..");
    const stopped = ask(home, "git add -A && git commit --no-verify -m x");
    expect(stopped.status).toBe(2);
    expect(stopped.stderr).toContain("commit --no-verify");
    expect(ask(home, 'git commit -m "x"').status).toBe(0);
  }, 180000);

  it("останавливает чтение страницы свода оболочкой, называя Read, и пропускает остальное", () => {
    const home = path.join(TOOL_DIR, "..", "..");
    // Страница и файл ключей лежат в одной папке, и отказ называет, откуда
    // берут путь к каждому: страницы — `bar-read`, файл ключей — `bar`.
    for (const page of ["bar-protocol-1.md", "bar-protocol-ключи.md"]) {
      const stopped = ask(home, "cat .context/bar-pages/" + page);
      expect(stopped.status, page).toBe(2);
      expect(stopped.stderr).toContain("инструментом Read, а не `cat`");
      expect(stopped.stderr).toContain("bar-read");
      expect(stopped.stderr).toContain("путь к файлу ключей печатает `bar`");
    }
    for (const fine of [
      "ls .context/bar-pages",
      "git status --short -- .context/bar-pages",
      "node .claude/tools/graph.mjs bar-read 1",
      "cat src/app/App.tsx",
    ])
      expect(ask(home, fine).status, fine).toBe(0);
    // Коммит мимо ворот называется своей причиной, не путаясь со страницей.
    const bypass = ask(home, "git commit --no-verify -m x");
    expect(bypass.status).toBe(2);
    expect(bypass.stderr).toContain("commit --no-verify");
    expect(bypass.stderr).not.toContain("инструментом Read");
  }, 180000);

  it("отвечает в папке без базы проекта", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "strazh-"));
    try {
      fs.cpSync(TOOL_DIR, path.join(box, ".claude", "tools"), {
        recursive: true,
      });
      expect(ask(box, "git -c core.hooksPath=/dev/null commit -m x").status).toBe(2);
      expect(ask(box, "ls -la").status).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  const askRead = (cwd, file, window = {}, wrapper = false) =>
    spawnSync(
      process.execPath,
      [
        path.join(cwd, ".claude", "tools", wrapper ? "hook.mjs" : "graph.mjs"),
        "guard",
        "--hook",
      ],
      {
        cwd,
        encoding: "utf8",
        input: JSON.stringify({
          tool_name: "Read",
          tool_input: { file_path: file, ...window },
        }),
      },
    );
  /** Протокол, в котором модель занимает строки 6–10. */
  const protocolText = [
    "# Протокол",
    "",
    "## Прочитано",
    "| 1 | стр | слово |",
    "",
    "## Модель предмета",
    "",
    "П1",
    "П2",
    "",
    "## Исходы",
    "| A1 | чисто |",
    "",
  ].join("\n");
  const boxWith = (files) => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "strazh-"));
    fs.cpSync(TOOL_DIR, path.join(box, ".claude", "tools"), {
      recursive: true,
    });
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(box, ".context", name)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(box, ".context", name), text);
    }
    return box;
  };

  it("отказывает в чтении протокола вне окна модели и называет окно; окно, другие файлы и протокол перехода проходят", () => {
    const box = boxWith({
      "bar-protocol.md": protocolText,
      "15-transition-bar/node--app.md": protocolText,
      "other.md": protocolText,
    });
    try {
      const at = (name) => path.join(box, ".context", name);
      for (const window of [
        {},
        { offset: 1, limit: 5 },
        { offset: 6, limit: 6 },
      ]) {
        const stopped = askRead(box, at("bar-protocol.md"), window);
        expect(stopped.status, JSON.stringify(window)).toBe(2);
        expect(stopped.stderr).toContain("offset 6 и limit 5");
        expect(stopped.stderr).toContain("путь к файлу ключей");
      }
      for (const window of [
        { offset: 6, limit: 5 },
        { offset: 7, limit: 3 },
      ])
        expect(askRead(box, at("bar-protocol.md"), window).status).toBe(0);
      expect(askRead(box, at("other.md")).status).toBe(0);
      expect(askRead(box, at("15-transition-bar/node--app.md")).status).toBe(0);
      expect(
        askRead(box, path.join(box, ".claude", "tools", "hook.mjs")).status,
      ).toBe(0);
      // Мимо обёртки и через неё отказ тот же: среда держит вызов кодом `2`.
      const wrapped = askRead(box, at("bar-protocol.md"), {}, true);
      expect(wrapped.status).toBe(2);
      expect(wrapped.stderr).toContain("offset 6 и limit 5");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("протокол оболочкой не читается: срез, поиск и вывод называют окно; прочие команды проходят", () => {
    const box = boxWith({ "bar-protocol.md": protocolText });
    try {
      for (const command of [
        "cat .context/bar-protocol.md",
        "sed -n 6,10p .context/bar-protocol.md",
        "grep -n A1 .context/bar-protocol.md",
        "cd .context && head -5 bar-protocol.md",
      ]) {
        const stopped = ask(box, command);
        expect(stopped.status, command).toBe(2);
        expect(stopped.stderr).toContain(
          "протокол свода оболочкой не читается",
        );
        expect(stopped.stderr).toContain("offset 6 и limit 5");
      }
      for (const fine of [
        "ls .context",
        "node .claude/tools/graph.mjs bar",
        "cat .context/bar-protocol.md.bak",
        "git status --short -- .context/bar-protocol.md",
      ])
        expect(ask(box, fine).status, fine).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("протокола нет в проекте либо имя файла другое по настройке — страж берёт имя оттуда", () => {
    const box = boxWith({ "svod.md": protocolText });
    try {
      const config = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        config,
        'export const BASE = "x";\nexport const CONFIG = { barProtocol: "svod.md" };\n',
      );
      const at = (name) => path.join(box, ".context", name);
      expect(askRead(box, at("svod.md")).status).toBe(2);
      expect(ask(box, "cat .context/svod.md").status).toBe(2);
      // Умолчательное имя при другой настройке стражу не предмет.
      expect(ask(box, "cat .context/bar-protocol.md").status).toBe(0);
      fs.rmSync(config);
      expect(askRead(box, at("svod.md")).status).toBe(0);
      expect(askRead(box, at("bar-protocol.md")).status).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Конфиг в корне репозитория — код, и правило о комментариях действует на
 * него без исключения: так решил разработчик на вопросе прогона проб. Прежде
 * сверки комментариев читали одну опись кода, а семя конфига линта несло ряд
 * в `300` слов, не давая ни одной находки. Держит пять вещей: семена
 * конфигов лежат в потолке; длинный ряд и мёртвый якорь в конфиге корня
 * сверки называют; якорь на заметку полки живой; адрес в сети якорем не
 * читается; семя, которое проект лишь привёл к своему формату, судится как
 * семя, а не как его код.
 */
describe("конфиг в корне — под правилом о комментариях", () => {
  const SECTIONS = [
    "Закомментированного кода нет",
    "Комментарий не перерос в прозу",
    "Доля комментариев в файле",
    "Якоря на документацию в коде",
  ];

  it("семена в потолке, ряд и мёртвый якорь конфига корня названы", () => {
    const box = seatEmpty("konfig-");
    try {
      const fresh = verifyIn(box);
      for (const s of SECTIONS)
        expect([s, fresh.get(s) ?? []]).toEqual([s, []]);
      fs.writeFileSync(
        path.join(box, "zz.config.mjs"),
        [
          "// Этот конфиг лежит в корне репозитория, и ряд его комментария нарочно",
          "// длиннее потолка: сверка обязана прочесть корень и назвать его.",
          "export const zzWide = 1;",
          "// See .claude/seat/zz-no-such-note.md",
          "export const zzDead = 1;",
          "// See .claude/seat/eslint.config-why.md",
          "export const zzShelf = 1;",
          "// See https://example.com/guide/README.md",
          "export default {};",
          "",
        ].join("\n"),
      );
      const planted = verifyIn(box);
      expect(planted.get("Комментарий не перерос в прозу") ?? []).toEqual([
        expect.stringMatching(
          /^zz\.config\.mjs:1 — ряд, слов \d+ при потолке 15\./,
        ),
      ]);
      // Якорь на заметку полки живой, а адрес в сети — не якорь вовсе:
      // мёртвым назван только якорь в никуда.
      expect(planted.get("Якоря на документацию в коде") ?? []).toEqual([
        "zz.config.mjs → .claude/seat/zz-no-such-note.md",
      ]);
      // Конфиг с комментарием под решёткой судится так же; образец пути
      // `/*.log` блоком комментария не открывается.
      fs.rmSync(path.join(box, "zz.config.mjs"));
      fs.writeFileSync(
        path.join(box, ".dockerignore"),
        [
          "# This ignore file sits in the repository root, and its comment run is",
          "# longer than the ceiling on purpose: the check must read it too.",
          "/*.log",
          "# See .claude/seat/zz-no-such-note.md",
          "dist",
          "",
        ].join("\n"),
      );
      const hashed = verifyIn(box);
      expect(hashed.get("Комментарий не перерос в прозу") ?? []).toEqual([
        expect.stringMatching(
          /^\.dockerignore:1 — ряд, слов \d+ при потолке 15\./,
        ),
      ]);
      expect(hashed.get("Якоря на документацию в коде") ?? []).toEqual([
        ".dockerignore → .claude/seat/zz-no-such-note.md",
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("доля сверх потолка печатается с десятой", () => {
    const box = seatEmpty("konfig-dolya-");
    try {
      // Строк комментария `7` из `68`: доля чуть выше потолка, и до целого
      // она округлилась бы ровно в потолок.
      const lines = [];
      for (let i = 0; i < 7; i += 1)
        lines.push("// шаг " + i, "export const zzStep" + i + " = " + i + ";");
      for (let i = 7; i < 60; i += 1)
        lines.push("export const zzStep" + i + " = " + i + ";");
      fs.writeFileSync(
        path.join(box, "zz.config.mjs"),
        [...lines, ""].join("\n"),
      );
      expect(verifyIn(box).get("Доля комментариев в файле") ?? []).toEqual([
        "zz.config.mjs — строк комментария 7 из 68, это 10.3 % при потолке 10 %. Объяснения переносят в документ слоя",
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("семя, приведённое к формату проекта, судится как семя", () => {
    const home = path.join(TOOL_DIR, "..", "..");
    const box = seatEmpty("konfig-format-");
    try {
      fs.cpSync(
        path.join(home, "node_modules", "prettier"),
        path.join(box, "node_modules", "prettier"),
        { recursive: true },
      );
      // Свой код есть: без него судится всё, и признак семени не спрашивают.
      fs.writeFileSync(
        path.join(box, "src", "app", "zzOwn.ts"),
        "export const zzOwn = 1;\n",
      );
      // Поле шире сводит код конфига в меньшее число строк, а комментарий
      // оставляет: доля в семени, судимом как свой код, выходит за потолок.
      fs.writeFileSync(
        path.join(box, ".prettierrc.json"),
        JSON.stringify({ printWidth: 400 }) + "\n",
      );
      execFileSync(
        process.execPath,
        [
          path.join(box, "node_modules", "prettier", "bin", "prettier.cjs"),
          "--write",
          "eslint.config.mjs",
        ],
        { cwd: box, stdio: ["ignore", "pipe", "pipe"] },
      );
      const seed = fs.readFileSync(
        path.join(TOOL_DIR, "..", "seat", "templates", "eslint.config.mjs"),
        "utf8",
      );
      expect(
        fs.readFileSync(path.join(box, "eslint.config.mjs"), "utf8"),
      ).not.toBe(seed);
      let out;
      try {
        out = execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (e) {
        out = String(e.stdout ?? "");
      }
      // Счёт осмотренного, а не одни находки: семя в корпусе сверки дало бы
      // файл от потолка строк и выше, а свой файл проекта — однострочный.
      const lines = out.split("\n");
      const share = lines.indexOf("=== Доля комментариев в файле ===");
      expect(lines.slice(share + 1, share + 3)).toEqual([
        "  осмотрено файлов от потолка строк и выше: 0",
        "  файлов сверх потолка: 0",
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Прогон по всей книге требует выбирать посадку, а не ждать, что выпадет, и
 * платить постоянную часть свода раз на пачку. Нарушение бывает только в
 * своём виде файла — в листе стилей, в тесте — и в конфиге. Посадки свои, а
 * не из книги: тест, пересказывающий книгу, выдаёт посаженное.
 */
/**
 * Стенд проб — проект, где у каждого критерия есть предмет. Посадку некуда
 * сажать, если раздел критерия объявлен мёртвым, а пробу нечем судить, если
 * база стенда красная сама: находкой свода стала бы поломка стенда, а не
 * посаженное. Стенд лежит данными и собирается поверх посадки обвязки,
 * поэтому правка семян посадки может уронить его без правки его файлов.
 */
describe("стенд проб", () => {
  it("собирается поверх посадки обвязки, живы все разделы, сверка базы на нём — код ноль", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stand-"));
    try {
      const built = execFileSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "bar-probe", "--stand-build", dest], {
        cwd: path.join(TOOL_DIR, "..", ".."),
        encoding: "utf8",
      });
      expect(built).toContain("=== Стенд проб собран ===");
      const facts = fs.readFileSync(path.join(dest, ".context", "01-facts.md"), "utf8");
      for (const id of "KLMNOPQRSTU")
        expect(facts, id).toMatch(new RegExp("^\\| " + id + "\\. [^|]+ \\| да \\|", "m"));
      const env = { ...process.env };
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const verify = spawnSync(process.execPath, [path.join(dest, ".claude", "tools", "graph.mjs"), "verify"], {
        cwd: dest,
        encoding: "utf8",
        env,
      });
      const red = verify.stdout
        .split("\n")
        .filter((line) => line.startsWith("=== ") || line.startsWith("    "))
        .filter((line, i, all) => line.startsWith("    ") || all[i + 1]?.startsWith("    "))
        .join("\n");
      expect(verify.status, red).toBe(0);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 300000);

  // Страж `!(x > 0)` отсекает NaN, а замена `x <= 0`, которую советовал
  // линт семени, его пропускает: правило линта спорило с планкой (`E2`).
  it("линт семени принимает страж, который требует планка", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stand-guard-"));
    try {
      execFileSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "bar-probe", "--stand-build", dest], {
        cwd: path.join(TOOL_DIR, "..", ".."),
        encoding: "utf8",
      });
      const file = path.join(dest, "src", "shared", "notes", "half.ts");
      fs.writeFileSync(file, "export const half = (value: number): number => {\n  if (!(value > 0)) return 0;\n  return value / 2;\n};\n");
      const lint = spawnSync(path.join(dest, "node_modules", ".bin", "eslint"), ["-f", "json", file], {
        cwd: dest,
        encoding: "utf8",
      });
      const messages = JSON.parse(lint.stdout).flatMap((one) => one.messages);
      expect(messages.map((m) => m.ruleId + ": " + m.message)).toEqual([]);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 300000);

  // Песочница без ворот краснела их сверками, и свод видел поломку, к
  // посаженному не относящуюся.
  it("песочница пробы стоит за воротами и с основанием ревизии, как посаженный проект", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stand-box-"));
    let box = null;
    try {
      execFileSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "bar-probe", "--stand-build", dest], {
        cwd: path.join(TOOL_DIR, "..", ".."),
        encoding: "utf8",
      });
      const env = { ...process.env };
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const run = (cwd, ...args) =>
        spawnSync(process.execPath, [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args], {
          cwd,
          encoding: "utf8",
          env,
        }).stdout;
      const planted = run(dest, "bar-probe", "--criterion=A3", "--seed=1");
      box = /песочница: (.+)/.exec(planted)?.[1]?.trim() ?? null;
      expect(box, planted).not.toBeNull();
      const verify = run(box, "verify");
      const section = (title) =>
        verify.split("=== " + title + " ===")[1]?.split("\n=== ")[0] ?? "";
      expect(section("Ворота перед коммитом установлены")).toContain(
        "не на месте: 0",
      );
      expect(section("Сверки, выключенные при живом предмете")).not.toContain(
        "barSince",
      );
      expect(section("Сверки, выключенные при живом предмете")).not.toContain(
        "seriesSince",
      );
      expect(section("Коммит с кодом накрыт сводом")).not.toContain(
        "не объявлено",
      );
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
      if (box !== null) {
        fs.rmSync(box, { recursive: true, force: true });
        fs.rmSync(box + ".plant.json", { force: true });
      }
    }
  }, 300000);

  // Посадка-суждение, которая роняет ворота проекта, показывает своду чужую
  // поломку вместо посаженного: проба мерила бы не то.
  it("ворота стенда называют посадку-суждение, не прошедшую компилятор, линт, формат или тесты", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stand-gates-"));
    try {
      execFileSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "bar-probe", "--stand-build", dest], {
        cwd: path.join(TOOL_DIR, "..", ".."),
        encoding: "utf8",
      });
      const create = (criterion, file, text) => ({ criterion, why: "проба ворот", create: { path: file, text } });
      const book = {
        plants: [
          create("A3", "shared/gates/clean.ts", "export const commaSeparated = (titles: readonly string[]): string =>\n  titles.join(\", \");\n"),
          create("H7", "shared/gates/machine.ts", "export const beyondLimit = (width: number): boolean => width > 768;\n"),
          create("A9-кватер", "shared/gates/compiler.ts", "export const total: number = \"none\";\n"),
          create("A14", "shared/gates/lint.ts", "export const drop = (error: unknown): void => {\n  void error;\n};\n"),
          create("B5", "shared/gates/format.ts", "export const shout = (text: string): string =>     text.toUpperCase();\n"),
          create(
            "J13",
            "shared/gates/tests/shout.test.ts",
            "import { expect, it } from \"vitest\";\n\nit(\"shouts\", () => {\n  expect(\"a\".toUpperCase()).toBe(\"a\");\n});\n",
          ),
        ],
      };
      fs.writeFileSync(path.join(dest, ".claude", "tools", "bar-probes.json"), JSON.stringify(book));
      const env = { ...process.env };
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const checked = spawnSync(process.execPath, [path.join(dest, ".claude", "tools", "graph.mjs"), "bar-probe", "--stand-check"], {
        cwd: dest,
        encoding: "utf8",
        env,
      });
      expect(checked.status, checked.stdout).toBe(1);
      expect(checked.stdout).toContain("осмотрено посадок-суждений: 5, пачек: 1");
      expect(checked.stdout).toMatch(/#3 A9-кватер — компилятор: TS2322/);
      expect(checked.stdout).toMatch(/#4 A14 — линт: \S*void/);
      expect(checked.stdout).toContain("#5 B5 — формат");
      expect(checked.stdout).toContain("#6 J13 — тест «shouts»: failed");
      expect(checked.stdout).not.toMatch(/#1 A3|#2 H7/);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 300000);

  // Критерий, который решает машина, проверяет не сессия: его посадку ловит
  // скелет свода сам — строкой линта либо среза, красной сверкой-держателем
  // либо фактом модели. Посадка, которую машина не ловит, держателя своего
  // критерия не задевает, и проба по ней мерила бы не то. Одна пачка на всю
  // книгу: строка линта и среза перечисляет все места, и посадки одного
  // правила друг друга не прячут.
  it("каждую посадку критерия, который решает машина, машина ловит сама", async () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stand-machine-"));
    let box = null;
    let markAt = null;
    try {
      execFileSync(process.execPath, [path.join(TOOL_DIR, "graph.mjs"), "bar-probe", "--stand-build", dest], {
        cwd: path.join(TOOL_DIR, "..", ".."),
        encoding: "utf8",
      });
      const P = await import(path.join(TOOL_DIR, "graph.predicates.mjs"));
      const book = JSON.parse(fs.readFileSync(path.join(dest, ".claude", "tools", "bar-probes.json"), "utf8"));
      const machine = book.plants
        .map((p, i) => ({ p, number: i + 1 }))
        .filter(({ p }) => ["сверка", "линт"].includes(P.barGripOf(p.criterion + "|")));
      expect(machine.length).toBeGreaterThan(0);
      const env = { ...process.env };
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const run = (cwd, ...args) =>
        spawnSync(process.execPath, [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args], {
          cwd,
          encoding: "utf8",
          env,
        }).stdout;
      const planted = run(dest, "bar-probe", "--batch=" + machine.map(({ number }) => number).join(","), "--seed=1");
      box = /песочница: (.+)/.exec(planted)?.[1]?.trim() ?? null;
      const id = /bar-probe (\d+)/.exec(planted)?.[1] ?? null;
      expect(box, planted).not.toBeNull();
      expect(planted).not.toContain("не вместились");
      markAt = path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json");
      const skeleton = run(box, "bar");
      const disputed = new Set(
        [
          ...(/красна сверка-держатель о предмете строки: (.+) — исход/.exec(skeleton)?.[1] ?? "").matchAll(
            /([A-Z][0-9]*(?:-[а-я]+)?) \(/g,
          ),
        ].map((m) => m[1]),
      );
      const record = JSON.parse(fs.readFileSync(markAt, "utf8"));
      const judged = run(dest, "bar-probe", id, "--machine").split("  посажено: ").slice(1);
      const proto = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8").split("\n");
      const missed = record.plants
        .filter((p, k) => {
          if (/исход: поймано\n/.test(judged[k] ?? "")) return false;
          if (disputed.has(p.criterion)) return false;
          const files = p.files.map((f) => path.relative(path.join(box, "src"), f).split(path.sep).join("/"));
          return !Object.entries(P.BAR_FACT_CRITERIA)
            .filter(([, ids]) => ids.includes(p.criterion))
            .some(([sort]) =>
              proto.some(
                (line) =>
                  line.includes("| " + sort + " |") &&
                  files.some((f) => line.includes(f)) &&
                  /мимо входа|входа нет|против правила|новое/.test(line),
              ),
            );
        })
        .map((p) => "#" + p.number + " " + p.criterion + " — " + p.why);
      expect(record.plants).toHaveLength(machine.length);
      expect(missed, missed.join("\n")).toEqual([]);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
      if (box !== null) fs.rmSync(box, { recursive: true, force: true });
      if (markAt !== null) fs.rmSync(markAt, { force: true });
    }
  }, 300000);
});

describe("проба планки: выбор, пачка, вид файла и правка конфига", () => {
  const runIn = (cwd, ...args) => {
    try {
      return execFileSync(process.execPath, [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const marked = (out) => {
    const id = /bar-probe (\d+)/.exec(out)?.[1] ?? null;
    return id === null ? null : path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json");
  };

  it("пачка сажает по посадке на критерий в разные файлы своего вида, суд судит каждую", () => {
    const box = seatEmpty("probabatch-");
    let sandbox = null;
    let markAt = null;
    try {
      fs.writeFileSync(path.join(box, "src", "app", "zzLook.module.scss"), ".zzLook {\n  color: red;\n}\n");
      const book = {
        plants: [
          {
            criterion: "H7",
            why: "число без имени",
            create: { path: "shared/zzNum/zzNum.ts", text: "export const zzNum = (n: number): number => n * 427;\n" },
          },
          {
            criterion: "B1",
            why: "булев довод",
            into: [
              {
                file: "модуль",
                text: "export const zzFlagged = (on) => (on ? 1 : 0);",
                ts: "export const zzFlagged = (on: boolean): number => (on ? 1 : 0);",
              },
            ],
          },
          {
            criterion: "D1",
            why: "строгость снята",
            patch: [{ path: "tsconfig.json", find: '"strict": true', replace: '"strict": false' }],
            create: { path: "shared/zzLoose/zzLoose.ts", text: "export const zzLoose = 1;\n" },
            culprits: ["tsconfig.json"],
          },
          { criterion: "H1", why: "правило без причины", into: [{ role: "лист", file: "стиль", text: ".zzExtra {\n  color: blue;\n}" }] },
          { criterion: "J1", why: "тест без утверждения", into: [{ role: "проверка", file: "тест", text: 'it("zz", () => {});' }] },
        ],
        covers: [{ text: "export const zzShield = () => 1;", ts: "export const zzShield = (): number => 1;" }],
      };
      fs.writeFileSync(path.join(box, ".claude", "tools", "bar-probes.json"), JSON.stringify(book));
      const out = runIn(box, "bar-probe", "--batch=H7,B1,D1,H1,J1,Q9", "--seed=7");
      sandbox = /песочница: (.+)/.exec(out)?.[1]?.trim() ?? null;
      markAt = marked(out);
      expect(sandbox, out).not.toBeNull();
      expect(out).toContain("пачка: посадок 5; не вместились критерии: Q9");
      const record = JSON.parse(fs.readFileSync(markAt, "utf8"));
      expect(record.plants.map((p) => p.criterion)).toEqual(["H7", "B1", "D1", "H1", "J1"]);
      const fileOf = (c) => record.plants.find((p) => p.criterion === c).files[0];
      expect(fileOf("H7")).toMatch(/\/src\/shared\/zzNum\/zzNum\.ts$/);
      expect(fileOf("B1")).toMatch(/\/src\/shared\/styles\/mergeStyleMaps\.ts$/);
      expect(fileOf("D1")).toBe(path.join(sandbox, "tsconfig.json").split(path.sep).join("/"));
      expect(fileOf("H1")).toMatch(/\/src\/app\/zzLook\.module\.scss$/);
      expect(fileOf("J1")).toMatch(/\/tests\/[^/]+\.test\.tsx?$/);
      expect(new Set(record.plants.map((p) => p.files[0])).size).toBe(5);
      expect(fs.readFileSync(fileOf("B1"), "utf8")).toContain("zzFlagged = (on: boolean)");
      expect(fs.readFileSync(fileOf("H1"), "utf8")).toContain(".zzExtra {");
      expect(fs.readFileSync(fileOf("J1"), "utf8")).toContain('it("zz", () => {});');
      expect(fs.readFileSync(fileOf("D1"), "utf8")).toContain('"strict": false');
      expect(fs.readFileSync(path.join(box, "tsconfig.json"), "utf8")).toContain('"strict": true');

      runIn(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      const said = { H7: "src/shared/zzNum/zzNum.ts:1", D1: "tsconfig.json:14", H1: "src/app/App.tsx:1" };
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .map((line) => {
            const c = line.split("|");
            if (c.length !== 9 || said[c[1].trim()] === undefined) return line;
            c[4] = " нашлось ";
            c[5] = " " + said[c[1].trim()] + " ";
            return c.join("|");
          })
          .join("\n"),
      );
      // Суд одной машины печати не требует, следа не пишет и песочницу
      // оставляет зовущему.
      const machine = runIn(box, "bar-probe", path.basename(markAt).replace(/^bar-probe-|\.plant\.json$/g, ""), "--machine");
      expect(machine.match(/исход: поймано/g)?.length, machine).toBe(2);
      expect(machine).toContain("исход: критерий назван, адрес другой");
      expect(machine.match(/исход: мимо/g)?.length).toBe(2);
      expect(fs.existsSync(markAt)).toBe(true);
      expect(fs.existsSync(path.join(box, ".context", "bar-probe-ledger.json"))).toBe(false);
      // Обычный суд требует печати, пишет в след каждую посадку и считает
      // пачку отдельной долей.
      const judged = runIn(box, "bar-probe", path.basename(markAt).replace(/^bar-probe-|\.plant\.json$/g, ""));
      expect(judged.match(/исход: свод без печати/g)?.length).toBe(5);
      expect(judged).toContain("пачкой: проб 5, поймано 0");
      const runs = JSON.parse(fs.readFileSync(path.join(box, ".context", "bar-probe-ledger.json"), "utf8")).runs;
      expect(runs.map((r) => r.batch)).toEqual([5, 5, 5, 5, 5]);
      // Не поймано ни одной: песочница и запись о посадке остаются для разбора.
      expect(judged).toContain("песочница оставлена для разбора промаха");
      expect(fs.existsSync(markAt)).toBe(true);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
      if (markAt !== null) fs.rmSync(markAt, { force: true });
    }
  }, 300000);

  it("номер и критерий выбирают посадку; посадки с таким выбором нет — так и сказано", () => {
    const box = seatEmpty("probapick-");
    const leftovers = [];
    try {
      const make = (criterion, name) => ({
        criterion,
        why: "проба выбора",
        create: { path: "shared/" + name + "/" + name + ".ts", text: "export const " + name + " = 1;\n" },
      });
      fs.writeFileSync(
        path.join(box, ".claude", "tools", "bar-probes.json"),
        JSON.stringify({ plants: [make("H7", "zzOne"), make("H7", "zzTwo"), make("B1", "zzThree")], covers: [] }),
      );
      const pick = (...args) => {
        const out = runIn(box, "bar-probe", ...args);
        const sandbox = /песочница: (.+)/.exec(out)?.[1]?.trim();
        const at = marked(out);
        expect(sandbox, out).toBeDefined();
        leftovers.push(sandbox, at);
        return JSON.parse(fs.readFileSync(at, "utf8"));
      };
      expect(pick("--plant=2").file).toMatch(/\/zzTwo\/zzTwo\.ts$/);
      expect(pick("--criterion=B1", "--seed=4").file).toMatch(/\/zzThree\/zzThree\.ts$/);
      const none = runIn(box, "bar-probe", "--criterion=Q9");
      expect(none).toContain("=== Сажать нечего ===");
      expect(none).toContain("Посадок с таким выбором в книге нет.");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      for (const one of leftovers) if (one) fs.rmSync(one, { recursive: true, force: true });
    }
  }, 240000);

  it("стенд собирается посадкой обвязки и своими файлами в пустую папку", () => {
    const box = seatEmpty("probastand-");
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "probastand-dest-"));
    try {
      fs.writeFileSync(
        path.join(box, ".claude", "tools", "bar-stand.json"),
        JSON.stringify({
          files: { "src/app/zzStand.ts": "export const zzStand = 1;\n" },
          remove: ["docs/FEATURES.md"],
        }),
      );
      expect(runIn(box, "bar-probe", "--stand-build")).toContain("Куда собирать, не сказано");
      // Пакеты — ссылкой на пакеты посадки, где идёт набор: без них сборка
      // ставила бы их из сети. Свой файл стенда в карте не описан, и сверка
      // базы на нём красная — сборка об этом говорит, а не молчит.
      fs.symlinkSync(path.join(TOOL_DIR, "..", "..", "node_modules"), path.join(box, "node_modules"), "junction");
      const out = runIn(box, "bar-probe", "--stand-build", dest);
      expect(out).toContain("=== Стенд проб собран — сверка базы красная ===");
      for (const one of [".claude/tools/graph.mjs", "CLAUDE.md", "src/app/App.tsx", "src/app/zzStand.ts"])
        expect(fs.existsSync(path.join(dest, one)), one).toBe(true);
      expect(fs.existsSync(path.join(dest, "docs", "FEATURES.md"))).toBe(false);
      expect(runIn(box, "bar-probe", "--stand-build", dest)).toContain("Папка не пуста");
    } finally {
      // Ссылка снимается сама по себе: удаление папки не идёт в пакеты посадки.
      fs.rmSync(path.join(box, "node_modules"), { force: true });
      fs.rmSync(box, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Другие имена настройки в карте посадки — тот список, который читает сам
 * пакет, а не набранный руками: у карты не было `.prettierrc.yaml`, и семя
 * легло рядом с проектным, перебив его без единой красной сверки.
 */
describe("другие имена настройки в карте — те, что читает сам пакет", () => {
  it("prettier, eslint, stryker, vite и vitest: каждое имя пакета есть в карте", async () => {
    const modules = path.join(TOOL_DIR, "..", "..", "node_modules");
    const map = JSON.parse(
      fs.readFileSync(path.join(TOOL_DIR, "..", "seat", "map.json"), "utf8"),
    );
    const namesOf = (to) => {
      const e = map.copy.find((one) => one.to === to);
      return new Set([e.to, ...(e.alsoKnownAs ?? []), ...(e.shadowedBy ?? [])]);
    };
    const strings = (file, re) =>
      new Set(
        [...fs.readFileSync(path.join(modules, file), "utf8").matchAll(re)].map(
          (m) => m[1],
        ),
      );
    const missing = [];
    const need = (to, names) => {
      // Пустой разбор пакета прошёл бы вхолостую.
      expect([...names].length, to).toBeGreaterThan(0);
      const have = namesOf(to);
      for (const n of names) if (!have.has(n)) missing.push(to + ": " + n);
    };
    need(
      ".prettierrc.json",
      strings(
        "prettier/index.mjs",
        /"(\.prettierrc(?:\.[a-z0-9]+)?|prettier\.config\.[a-z]+)"/g,
      ),
    );
    need(
      "eslint.config.mjs",
      strings(
        "eslint/lib/config/config-loader.js",
        /"(eslint\.config\.[a-z]+)"/g,
      ),
    );
    const { SUPPORTED_CONFIG_FILE_NAMES } = await import(
      path.join(
        modules,
        "@stryker-mutator/core/dist/src/config/config-file-formats.js",
      )
    );
    need("stryker.config.json", SUPPORTED_CONFIG_FILE_NAMES);
    const viteDist = path.join(modules, "vite", "dist", "node", "chunks");
    const viteNames = new Set();
    for (const f of fs.readdirSync(viteDist))
      for (const m of fs
        .readFileSync(path.join(viteDist, f), "utf8")
        .matchAll(/"(vite\.config\.[a-z]+)"/g))
        viteNames.add(m[1]);
    need("vite.config.ts", viteNames);
    const vitestDist = path.join(modules, "vitest", "dist", "chunks");
    const vitestNames = [];
    for (const f of fs.readdirSync(vitestDist)) {
      const hit = /const CONFIG_EXTENSIONS = \[([^\]]+)\]/.exec(
        fs.readFileSync(path.join(vitestDist, f), "utf8"),
      );
      if (hit !== null)
        for (const m of hit[1].matchAll(/"([^"]+)"/g))
          vitestNames.push("vitest.config" + m[1]);
    }
    need("vite.config.ts", vitestNames);
    expect(missing).toEqual([]);
  });
});
