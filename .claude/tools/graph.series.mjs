/** Серия — прогон цепочки проверок проекта на каждой части правки.
 *
 * Свод по планке один на пачку правок, а в историю правка уходит коммитом на
 * часть. Каждый такой коммит обязан давать код ноль на цепочке проверок, и
 * держит это машина, а не внимание: серия собирает дерево «основание плюс
 * части с первой по эту» во временной копии, гоняет цепочку и пишет отметку
 * «часть, хеш дерева, код ноль» в папку git. Дерево с отметкой заново не
 * гоняется; правка части меняет её дерево и деревья после неё — их серия и
 * догоняет. Решение разработчика `2026-10-10`.
 *
 * Деревья собираются через временный индекс: рабочее дерево и индекс
 * проекта серия не трогает, кроме ключа `--stage`, который кладёт в индекс
 * ровно дерево части. */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { applyParts } from "./graph.parts.mjs";
import { sandboxPackages, systemTemp } from "./graph.seat.mjs";

const norm = (p) => p.split(path.sep).join("/");

/** Папка git проекта: там лежат отметки и вывод красной части. Зовущие
 * ловят отказ (проекта без git ещё нет), поэтому `stderr` git не наследуется:
 * иначе «fatal: not a git repository» ложился в отчёт режима. */
export const gitDirOf = (repoRoot) =>
  path.resolve(
    repoRoot,
    execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
  );

/** Имя переменной среды, которой серия говорит цепочке «часть k из n». Дерево
 * промежуточной части несёт протокол всей пачки, и сверка свода по нему
 * спрашивает подмножество: код части назван печатью на том же виде. */
export const SERIES_PART = "GRAPH_SERIES_PART";

/** Отметки серии: основание и деревья, прошедшие цепочку. */
const marksAt = (repoRoot) =>
  path.join(gitDirOf(repoRoot), "graph-series.json");
export const readMarks = (repoRoot) => {
  try {
    return JSON.parse(readFileSync(marksAt(repoRoot), "utf8"));
  } catch {
    return { base: null, trees: {} };
  }
};
const writeMarks = (repoRoot, marks) =>
  writeFileSync(marksAt(repoRoot), JSON.stringify(marks, null, 2) + "\n");

/** Деревья частей: на каждую — хеш дерева «основание плюс части с первой по
 * эту». `whole` — файл целиком к своей части; `splits` — файл по записям, с
 * частью каждой изменённой строки. */
export const partTreesOf = ({ repoRoot, base, count, whole, splits }) => {
  const index = path.join(
    gitDirOf(repoRoot),
    "graph-series-" + randomBytes(4).toString("hex") + ".index",
  );
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      input,
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  const relOf = (abs) => norm(path.relative(repoRoot, abs));
  const blobOf = (text) => git(["hash-object", "-w", "--stdin"], text);
  const modeOf = (abs) =>
    (statSync(abs).mode & 0o111) !== 0 ? "100755" : "100644";
  const zero = "0".repeat(40);
  // Целый файл хешируется раз: в каждом дереве он либо новый, либо прежний.
  const wholeRows = [...whole].map(([abs, part]) => ({
    part,
    now: existsSync(abs)
      ? modeOf(abs) +
        " " +
        git(["hash-object", "-w", relOf(abs)]) +
        "\t" +
        relOf(abs)
      : "0 " + zero + "\t" + relOf(abs),
  }));
  const trees = [];
  try {
    for (let k = 1; k <= count; k += 1) {
      const chosen = new Set(Array.from({ length: k }, (_, i) => i + 1));
      git(["read-tree", base]);
      const rows = wholeRows.filter((r) => r.part <= k).map((r) => r.now);
      for (const [abs, d] of splits) {
        const all = [...d.partOf.removed.values(), ...d.partOf.added.values()];
        const gone = d.after === null && all.every((p) => chosen.has(p));
        rows.push(
          gone
            ? "0 " + zero + "\t" + relOf(abs)
            : "100644 " +
                blobOf(
                  applyParts(d.oldLines, d.newLines, d.hunks, d.partOf, chosen),
                ) +
                "\t" +
                relOf(abs),
        );
      }
      if (rows.length > 0)
        git(["update-index", "--index-info"], rows.join("\n") + "\n");
      trees.push({ part: k, tree: git(["write-tree"]) });
    }
  } finally {
    rmSync(index, { force: true });
  }
  return trees;
};

/** Прогон серии: цепочка на каждом дереве без отметки, по порядку, до первого
 * ненулевого кода. Отметки чужого основания снимаются; отметки того же
 * основания остаются: откат правки возвращает дерево, уже прошедшее цепочку. */
export const runSeries = ({ repoRoot, base, trees, command, packagesFrom }) => {
  const was = readMarks(repoRoot);
  // Деревья частей по порядку — для ворот и для основания живой серии.
  const marks = {
    base,
    parts: trees.map(({ part, tree }) => ({ part, tree })),
    trees: was.base === base ? was.trees : {},
  };
  const out = [];
  const todo = trees.filter((t) => marks.trees[t.tree]?.code !== 0);
  if (todo.length === 0) {
    writeMarks(repoRoot, marks);
    return trees.map((t) => ({ ...t, code: 0, was: true }));
  }
  const dir = path.join(
    systemTemp(),
    "graph-series-" + randomBytes(4).toString("hex"),
  );
  // Признак сессии в копии не нужен: цепочка судит дерево, а не сессию.
  const env = { ...process.env };
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.GIT_INDEX_FILE;
  const git = (args, cwd = repoRoot) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(["worktree", "add", "--detach", "--no-checkout", dir, base]);
  try {
    sandboxPackages(
      path.join(packagesFrom, "node_modules"),
      path.join(dir, "node_modules"),
    );
    let stopped = false;
    for (const t of trees) {
      if (stopped) {
        out.push({ ...t, code: null });
        continue;
      }
      if (marks.trees[t.tree]?.code === 0) {
        out.push({ ...t, code: 0, was: true });
        continue;
      }
      git(["read-tree", "-u", "--reset", t.tree], dir);
      const run = spawnSync(command[0], command.slice(1), {
        cwd: dir,
        env: { ...env, [SERIES_PART]: t.part + "/" + trees.length },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const code = run.status ?? 1;
      if (code === 0) marks.trees[t.tree] = { part: t.part, code: 0 };
      else {
        const log = path.join(
          gitDirOf(repoRoot),
          "graph-series-" + t.part + ".log",
        );
        mkdirSync(path.dirname(log), { recursive: true });
        writeFileSync(log, String(run.stdout ?? "") + String(run.stderr ?? ""));
        out.push({ ...t, code, log });
        stopped = true;
        continue;
      }
      out.push({ ...t, code });
    }
  } finally {
    try {
      git(["worktree", "remove", "--force", dir]);
    } catch {
      rmSync(dir, { recursive: true, force: true });
      git(["worktree", "prune"]);
    }
    writeMarks(repoRoot, marks);
  }
  return out;
};

/** Индекс проекта — ровно дерево части. */
export const stageTree = (repoRoot, tree) =>
  execFileSync("git", ["read-tree", tree], { cwd: repoRoot, encoding: "utf8" });

const gitOut = (repoRoot, args) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

/** Основание живой серии: часть её частей закоммичена, часть нет. Тогда
 * правленое считают от основания, а не от последнего коммита: свод запечатан
 * на всей пачке, и судить его по остатку значило бы судить другой предмет.
 * Серии нет, она не начата либо сдана целиком — `null`. */
export const livingBaseOf = (repoRoot) => {
  try {
    const marks = readMarks(repoRoot);
    if (!marks.base || !Array.isArray(marks.parts) || marks.parts.length < 2)
      return null;
    if (gitOut(repoRoot, ["rev-parse", "HEAD"]) === marks.base) return null;
    const headTree = gitOut(repoRoot, ["rev-parse", "HEAD^{tree}"]);
    const at = marks.parts.findIndex((p) => p.tree === headTree);
    return at >= 0 && at < marks.parts.length - 1 ? marks.base : null;
  } catch {
    return null;
  }
};

/** Почему индекс не годится в коммит серии: дерево индекса — часть, прошедшая
 * цепочку, и ложится на дерево предыдущей части, а первая — на основание.
 * Пустая строка — годится. */
export const seriesGateFault = (repoRoot) => {
  const marks = readMarks(repoRoot);
  const index = gitOut(repoRoot, ["write-tree"]);
  const at = (marks.parts ?? []).findIndex((p) => p.tree === index);
  if (at < 0 || marks.trees?.[index]?.code !== 0)
    return "дерево индекса цепочку не проходило: сперва `node .claude/tools/graph.mjs series`, затем `series --stage <часть>`";
  const head = gitOut(repoRoot, ["rev-parse", "HEAD"]);
  if (at === 0)
    return head === marks.base
      ? ""
      : "часть 1 ложится на основание серии " +
          marks.base.slice(0, 7) +
          ", а последний коммит — " +
          head.slice(0, 7);
  return gitOut(repoRoot, ["rev-parse", "HEAD^{tree}"]) ===
    marks.parts[at - 1].tree
    ? ""
    : "часть " +
        (at + 1) +
        " ложится на часть " +
        at +
        ", а последний коммит — не она: части коммитят по порядку";
};

/** Строка серии для сообщения коммита: печать протокола, часть из скольких и
 * дерево. По ней ревизия по истории узнаёт коммит серии. Индекс — не часть
 * серии, прошедшая цепочку, — `null`: коммит мимо ворот строки не получает. */
export const seriesLineOf = (repoRoot, seal) => {
  const marks = readMarks(repoRoot);
  const index = gitOut(repoRoot, ["write-tree"]);
  const at = (marks.parts ?? []).findIndex((p) => p.tree === index);
  if (at < 0 || marks.trees?.[index]?.code !== 0) return null;
  return (
    "Bar-series: " +
    seal +
    " " +
    (at + 1) +
    "/" +
    marks.parts.length +
    " " +
    index
  );
};

/** Следующая часть к коммиту: первая после той, чьё дерево лежит в последнем
 * коммите; ничего не закоммичено — первая. Сдана вся — `null`. */
export const nextPartOf = (repoRoot, trees, base) => {
  if (gitOut(repoRoot, ["rev-parse", "HEAD"]) === base) return 1;
  const headTree = gitOut(repoRoot, ["rev-parse", "HEAD^{tree}"]);
  const at = trees.findIndex((t) => t.tree === headTree);
  return at < 0 || at === trees.length - 1 ? null : at + 2;
};
