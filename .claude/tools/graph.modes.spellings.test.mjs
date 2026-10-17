import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAT_PACKAGES, seatEmpty } from "./graph.modes.shared.mjs";

/**
 * Равносильные написания семян. Каждое семя конфига, переписанное так, как
 * его законно пишет живой проект, обязано давать ту же сверку базы: те же
 * находки и тот же код возврата. Прежде каждое новое написание давало новый
 * дефект — `tsc -p .`, `test:{`, `./src/**`, `extends` из пакета, — и
 * находили их посадками руками по одному. Найдено прогоном проб по холодной
 * оси: из десяти классов четыре — написание конфига.
 *
 * Два пути. С пакетами проекта конфиги читают его загрузчики — так в любом
 * настоящем проекте. Без пакетов — запасной разбор текста, и часть написаний
 * ему не по силам: они помечены `byLoaderOnly` и спрашиваются только у
 * загрузчиков — это объявленный предел запасного пути, а не пропуск.
 */

const edit = (file, fn) => (box) => {
  const at = path.join(box, file);
  fs.writeFileSync(at, fn(fs.readFileSync(at, "utf8"), box));
};
const json = (file, fn) =>
  edit(file, (text) => JSON.stringify(fn(JSON.parse(text))));
const script = (name, body) =>
  json("package.json", (pkg) => ({
    ...pkg,
    scripts: { ...pkg.scripts, [name]: body },
  }));

const SPELLINGS = [
  ["tsconfig.json одной строкой", json("tsconfig.json", (t) => t)],
  [
    "tsconfig.json с комментариями и висячей запятой",
    edit("tsconfig.json", (text) =>
      text
        .replace("{", "{\n  // project compiler settings")
        .replace('"strict": true,', '"strict": true, /* on */')
        .replace(/\]\s*\n\}\s*$/, "],\n}\n"),
    ),
  ],
  [
    "опции компилятора — в базовом конфиге по `extends`",
    (box) => {
      const at = path.join(box, "tsconfig.json");
      const t = JSON.parse(fs.readFileSync(at, "utf8"));
      fs.writeFileSync(
        path.join(box, "tsconfig.base.json"),
        JSON.stringify({ compilerOptions: t.compilerOptions }, null, 2) + "\n",
      );
      fs.writeFileSync(
        at,
        JSON.stringify(
          { extends: "./tsconfig.base.json", include: t.include },
          null,
          2,
        ) + "\n",
      );
    },
  ],
  ["звено типов с `-p .`", script("typecheck", "tsc --noEmit -p .")],
  [
    "звено типов с `-p tsconfig.json` впереди",
    script("typecheck", "tsc -p tsconfig.json --noEmit"),
  ],
  [
    "секция тестов без пробела",
    edit("vite.config.ts", (text) => text.replace("test: {", "test:{")),
  ],
  [
    "область сбора от точки",
    edit("vite.config.ts", (text) => text.replace(/"src\//g, '"./src/')),
  ],
  [
    "конфиг сборщика функцией",
    edit("vite.config.ts", (text) =>
      text
        .replace("defineConfig({", "defineConfig(() => ({")
        .replace(/\}\);\s*$/, "}));\n"),
    ),
    { byLoaderOnly: true },
  ],
  [
    "область мутаций от точки и одной строкой",
    json("stryker.config.json", (c) => ({
      ...c,
      mutate: c.mutate.map((g) => g.replace(/^(!?)src\//, "$1./src/")),
    })),
  ],
  ["раннер с `--run`", script("test", "vitest --run")],
  [
    "линт с порогом предупреждений",
    script("lint", "eslint . --max-warnings 0"),
  ],
  ["формат с путём впереди", script("format:check", "prettier . --check")],
  ["версия среды с `v`", edit(".nvmrc", (text) => "v" + text)],
];

const reds = (out) =>
  out
    .split("\n")
    .filter((line) => /^ {4}\S/.test(line))
    .sort();

for (const withPackages of [true, false]) {
  describe(
    "равносильное написание семени — та же сверка, " +
      (withPackages ? "загрузчиками проекта" : "разбором текста"),
    () => {
      let box;
      let baseline;
      const run = () =>
        spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "verify", "--full"],
          { cwd: box, encoding: "utf8" },
        );
      beforeAll(() => {
        box = seatEmpty("napisanie-");
        if (withPackages)
          fs.symlinkSync(SEAT_PACKAGES, path.join(box, "node_modules"), "dir");
        const got = run();
        baseline = { status: got.status, reds: reds(got.stdout) };
      }, 120000);
      afterAll(() => fs.rmSync(box, { recursive: true, force: true }));

      for (const [name, apply, opts] of SPELLINGS) {
        if (!withPackages && opts?.byLoaderOnly) continue;
        it(
          name,
          () => {
            const keep = new Map();
            for (const f of fs.readdirSync(box))
              if (fs.statSync(path.join(box, f)).isFile())
                keep.set(f, fs.readFileSync(path.join(box, f)));
            try {
              apply(box);
              const got = run();
              expect(got.stderr).toBe("");
              expect(reds(got.stdout)).toEqual(baseline.reds);
              expect(got.status).toBe(baseline.status);
            } finally {
              for (const f of fs.readdirSync(box)) {
                const at = path.join(box, f);
                if (fs.statSync(at).isFile() && !keep.has(f)) fs.rmSync(at);
              }
              for (const [f, bytes] of keep)
                fs.writeFileSync(path.join(box, f), bytes);
            }
          },
          60000,
        );
      }
    },
  );
}
