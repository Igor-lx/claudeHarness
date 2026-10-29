import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEAT_PACKAGES, TOOL_DIR } from "./graph.modes.shared.mjs";
import { layShelfLive } from "./graph.seat.mjs";

/**
 * Корпус чужих проектов. Обвязку проверяли на проектах, которые она сама и
 * создала: посадка, магазин, стенд собраны из её семян её же написанием, и
 * всё, что инструмент ждёт увидеть, там написано именно так. Чужое
 * написание встречалось только при посадке по инструкции, и каждая давала две-три
 * находки — найдено прогоном проб по холодной оси.
 *
 * Здесь проекты собраны не из семян, каждый отличается от умолчаний обвязки
 * по одной оси, а образец `create-vite` — похожий проект, какой ставят люди.
 * Каждый сажается механикой фазы 1 — семена разложены,
 * столкнувшиеся отложены в `.seat`, — и сверка базы обязана исполниться без
 * единого падения, а её находки — совпасть с эталоном `expect`, который
 * просмотрен человеком: каждая строка эталона — правда о проекте. Эталон
 * переписывает `UPDATE_CORPUS=1`, и дифф эталона читают до коммита.
 *
 * Порядок посадки здесь не проверяется — его проверяет посадка по инструкции по
 * `seat/seat.md`. Здесь — как инструмент читает чужой проект.
 */
const CORPUS_AT = path.join(TOOL_DIR, "foreign-corpus.json");
const CORPUS = JSON.parse(fs.readFileSync(CORPUS_AT, "utf8"));
const UPDATE = process.env.UPDATE_CORPUS === "1";

const git = (box, ...args) =>
  execFileSync("git", args, { cwd: box, encoding: "utf8" }).trim();

const plant = (project) => {
  const box = fs.mkdtempSync(
    path.join(os.tmpdir(), "corpus-" + project.name + "-"),
  );
  for (const [rel, text] of Object.entries(project.files)) {
    fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
    fs.writeFileSync(
      path.join(box, rel),
      project.crlf === true ? text.replace(/\n/g, "\r\n") : text,
    );
  }
  git(box, "init", "-q");
  git(box, "config", "user.email", "corpus@example.com");
  git(box, "config", "user.name", "corpus");
  git(box, "config", "core.autocrlf", "false");
  git(box, "add", "-A");
  git(box, "commit", "-qm", "проект", "--no-verify");
  const head = git(box, "rev-parse", "HEAD");
  const deferred = layShelfLive(path.join(TOOL_DIR, ".."), box);
  // Ответы фазы 1, которые обвязка знать не может, — данными проекта.
  const cfg = path.join(box, ".context", "graph.config.mjs");
  let text = fs.readFileSync(cfg, "utf8");
  for (const [field, value] of Object.entries({
    ...project.config,
    barSince: head,
    seriesSince: head,
  }))
    text = text.replace(
      new RegExp("^ {2}" + field + ": .*,$", "m"),
      "  " + field + ": " + JSON.stringify(value) + ",",
    );
  text = text.replace(/^ {4}since: .*,$/m, "    since: " + JSON.stringify(head) + ",");
  fs.writeFileSync(cfg, text);
  git(
    box,
    "config",
    "core.hooksPath",
    project.hooksPath ?? ".claude/hooks/git",
  );
  fs.symlinkSync(SEAT_PACKAGES, path.join(box, "node_modules"), "dir");
  return { box, head, deferred };
};

// Находка — с именем секции и без следа машины: папка посадки и хеши
// коммитов обезличены. Секции-предупреждения прогон не роняют и говорят о
// машине — версиях среды и пакетов, — в эталон они не идут.
const findingsOf = (out, box, head) => {
  const found = new Set();
  let section = null;
  for (const line of out.split("\n")) {
    const title = /^=== (.+) ===$/.exec(line);
    if (title !== null) section = title[1];
    else if (
      /^ {4}\S/.test(line) &&
      section !== null &&
      !section.includes("прогон не роняет")
    )
      found.add(
        section +
          " | " +
          line
            .trim()
            .split(box)
            .join("<проект>")
            .split(head)
            .join("<коммит>")
            .replace(/\b[0-9a-f]{12,40}\b/g, "<хеш>"),
      );
  }
  return [...found].sort();
};

describe("корпус чужих проектов", () => {
  for (const project of CORPUS.projects)
    it(
      project.name + " — " + project.axis,
      () => {
        const { box, head } = plant(project);
        try {
          const got = spawnSync(
            process.execPath,
            [
              path.join(box, ".claude", "tools", "graph.mjs"),
              "verify",
              "--full",
            ],
            { cwd: box, encoding: "utf8" },
          );
          expect(got.stderr).toBe("");
          expect(got.stdout).toContain("  упало исключением: 0");
          const found = {
            status: got.status,
            findings: findingsOf(got.stdout, box, head),
          };
          if (UPDATE) {
            const book = JSON.parse(fs.readFileSync(CORPUS_AT, "utf8"));
            book.projects.find((p) => p.name === project.name).expect = found;
            fs.writeFileSync(CORPUS_AT, JSON.stringify(book, null, 2) + "\n");
            return;
          }
          expect(
            project.expect,
            "эталона нет: просмотреть находки и записать (UPDATE_CORPUS=1)",
          ).not.toBeNull();
          expect(found).toEqual(project.expect);
          // Связи, которых сверка не печатает: куда ведёт импорт. Досье
          // файла обязано назвать одни адреса и не называть другие.
          for (const one of project.briefs ?? []) {
            const brief = spawnSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), "brief", one.file],
              { cwd: box, encoding: "utf8" },
            );
            expect(brief.status, one.file).toBe(0);
            for (const line of one.has) expect(brief.stdout).toContain(line);
            for (const line of one.hasNot ?? [])
              expect(brief.stdout).not.toContain(line);
          }
        } finally {
          fs.rmSync(box, { recursive: true, force: true });
        }
      },
      60000,
    );
});
