import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BAR_CUTS, BAR_SIGNALS } from "./graph.predicates.mjs";
import {
  TOOL_DIR,
  TOOL,
  seatEmpty,
  withTransitionDebt,
  verifyIn,
  sectionOf,
  fillBar,
  barRowsCited,
  fakeCheck,
  seriesStaged,
} from "./graph.modes.shared.mjs";

// Тесты режимов, часть 3 из 3: файлы делят набор, чтобы он шёл параллельно.

describe("чем держится каждый критерий планки", () => {
  it("каждый вопрос модели встаёт: журнал строк свода и замер --fired", () => {
    const box = seatEmpty("fired-");
    try {
      const run = (args, env = {}) => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
              {
                cwd: box,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, ...env },
              },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      const logAt = path.join(box, "rows.log");
      // Журнала нет — замерять нечего, и это красное, а не ноль.
      const none = run(["bar-hold", "--fired", logAt]);
      expect(none.code).toBe(1);
      expect(none.out).toContain("Журнала строк нет");

      // Свод пишет в журнал каждую вставшую строку.
      fs.writeFileSync(
        path.join(box, "src", "app", "zzNote.ts"),
        "// the note keeps the reply of the server for the next screen\nexport const zzNote = (text: string): string => text.trim();\n",
      );
      run(["bar", "app/zzNote.ts"], { BAR_ROWS_LOG: logAt });
      expect(fs.readFileSync(logAt, "utf8").split("\n")).toContain("комментарий|");

      // Полный журнал — каждая пара встала.
      const all = [...BAR_SIGNALS, ...BAR_CUTS].flatMap((one) =>
        (one.mark === undefined ? [""] : [one.mark].flat()).map((m) => one.sort + "|" + m),
      );
      fs.writeFileSync(logAt, all.join("\n") + "\n");
      const full = run(["bar-hold", "--fired", logAt]);
      expect(full.code).toBe(0);
      expect(full.out).toContain("не встали ни разу: 0");

      // Без строк близнеца — его вопрос не встал; пометку «нет» у ресурса
      // ставит ответ сессии, и её засчитывает вставшая строка ресурса.
      fs.writeFileSync(
        logAt,
        all.filter((one) => !one.startsWith("близнец|") && one !== "ресурс|нет").join("\n") +
          "\nресурс|\n",
      );
      const holed = run(["bar-hold", "--fired", logAt]);
      expect(holed.code).toBe(1);
      expect(holed.out).toContain("    A5-бис: близнец|");
      expect(holed.out).not.toContain("ресурс|нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("матрица сходится и краснеет на каждой из десяти поломок", () => {
    const box = seatEmpty("hold-");
    try {
      const vocab = path.join(box, ".claude", "tools", "graph.predicates.mjs");
      const clean = fs.readFileSync(vocab, "utf8");
      const run = () => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), "bar-hold"],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      const ok = run();
      expect(ok.code).toBe(0);
      expect(ok.out).toContain("у каждого критерия есть решение, чем он держится");
      expect(ok.out).toMatch(
        /^\| B4 \| единица \| вопрос модели: кортеж \| вопрос модели \| объект с полями «на всякий случай»; [^|]+ \| (?:—|\d+(?:, поймано)?) \|$/m,
      );
      expect(ok.out).toMatch(/^\| H3 \| единица \| [^|]+ \| сверка \| закрыто \| /m);
      // Общая форма о тестовом файле: у числа без имени она есть, у
      // доступности — раздела о продукте — нет.
      expect(ok.out).toMatch(/^\| H7 \| [^\n]*нарушение внутри тестового файла/m);
      expect(ok.out).not.toMatch(/^\| P4 \| [^\n]*нарушение внутри тестового файла/m);
      // Свидетель — ступень, где сессия отвечает, а машина проверяет форму.
      expect(ok.out).toMatch(/^\| B5 \| единица \| свидетель \| свидетель \| /m);
      // Итог по ступеням сходится с графой опоры строка в строку.
      const grips = [...ok.out.matchAll(/^\| [A-U][0-9][^|]* \| [^|]+ \| [^|]+ \| ([^|]+) \| /gm)].map(
        (m) => m[1].trim(),
      );
      const count = (...kinds) => grips.filter((g) => kinds.includes(g)).length;
      expect(ok.out).toContain(
        "  по самой сильной опоре: машина решает — " +
          count("сверка", "линт") +
          "; машина находит, сессия судит — " +
          count("вопрос модели") +
          "; сессия отвечает, машина проверяет форму — " +
          count("свидетель", "ядро") +
          "; одно внимание — " +
          count("вниманием") +
          "; лозунгов — " +
          count("лозунг"),
      );
      expect(count("сверка", "линт", "вопрос модели", "свидетель", "ядро", "вниманием", "лозунг")).toBe(
        Number(/осмотрено критериев планки: (\d+)/.exec(ok.out)?.[1]),
      );
      // Держатель «линт» — ступень «машина решает», и форма о точечном
      // исключении у его критерия вычисляется.
      expect(ok.out).toMatch(/^\| H7 \| единица \| [^|]*линт: @typescript-eslint\/no-magic-numbers \| линт \| [^\n]*нарушение под точечным исключением линта/m);
      expect(ok.out).toMatch(/^  формы вне держателя: \d+ у \d+ критериев; закрытых наборов: 1 из \d+/m);
      const broken = (from, to) => {
        expect(clean.split(from).length, from).toBe(2);
        fs.writeFileSync(vocab, clean.replace(from, to));
        const got = run();
        fs.writeFileSync(vocab, clean);
        expect(got.code).toBe(1);
        return got.out;
      };
      // Критерий без держателя и без записанной причины.
      expect(
        broken('  S1: "способ узнать об отказе в бою живёт вне предмета, у проекта он один",\n', ""),
      ).toContain("S1: нет решения, чем держится");
      // Данные называют критерий, которого в политике нет.
      expect(
        broken('  J2: "правило о правилах', '  Z8: "нет такого",\n  J2: "правило о правилах'),
      ).toContain("Z8: данные называют критерий, которого в политике нет");
      // Внимание записано при машинном держателе.
      expect(
        broken('  J2: "правило о правилах', '  B4: "лишняя запись",\n  J2: "правило о правилах'),
      ).toContain("B4: записано вниманием, а держатель есть");
      // Названной сверки нет.
      expect(
        broken('  U3: ["Точечные исключения линта", "Выключения правил линта"],', '  U3: ["Исключения, которых нет"],'),
      ).toContain("«Исключения, которых нет»: сверки с таким названием нет");
      // Машинный держатель без решения, каких форм он не видит.
      expect(broken("  F1: [UNSEEN.resource],\n", "")).toContain(
        "F1: нет решения, каких форм нарушения держатель не видит",
      );
      // Формы записаны у критерия, которого держит одно внимание.
      expect(
        broken("  F1: [UNSEEN.resource],", '  F1: [UNSEEN.resource],\n  "R1-тер": ["лишняя форма — лишняя причина"],'),
      ).toContain("R1-тер: формы вне держателя записаны у критерия, которого держит одно внимание");
      // Набор закрыт, а строки критерия о тестовом файле не встают; у
      // критерия держателя «линт» закрытого набора не бывает вовсе.
      const closed = broken(
        '  H7: [\n    "число, присвоенное имени без смысла',
        '  H7: "закрыто: проба",\n  "zz-H7": [\n    "число, присвоенное имени без смысла',
      );
      expect(closed).toContain("H7: набор закрыт, а строки критерия о тестовом файле не встают");
      expect(closed).toContain("H7: набор закрыт, а держатель «линт» не видит строку под точечным исключением");
      // Словарь линта называет критерий, которого в политике нет.
      expect(
        broken('  A4: ["sonarjs/no-selector-parameter"],', '  A4: ["sonarjs/no-selector-parameter"],\n  Z7: ["no-empty"],'),
      ).toContain("Z7: данные называют критерий, которого в политике нет");
      // Решение записано не по форме: форма без причины.
      expect(broken("  F1: [UNSEEN.resource],", '  F1: ["форма без причины"],')).toContain(
        "F1: решение о формах записано не по форме: форма без причины",
      );
      // Пятно словаря, которого не называет ни один критерий.
      expect(
        broken(
          "  releaseLinted:\n",
          '  zzSpot: "пятно без критерия — проба",\n  releaseLinted:\n',
        ),
      ).toContain(
        "UNSEEN.zzSpot: пятно словаря, которого не называет ни один критерий",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Строки критериев, которые держит линт, свод заполняет сам: нарушение —
 * «нашлось» с адресом и правилом. Молчание всех держателей критерия — «чисто»,
 * только если держатель видит все формы нарушения; иначе молчание ложится в
 * графу «что» опорой, а исход ставит сессия. Исход сессии, спорящий с линтом,
 * печати не даёт.
 *
 * Линт коробка берёт из пакетов посадки, где идут тесты обвязки, — через путь
 * поиска пакетов, а не ссылкой на их папку: удаление коробки дороги в пакеты
 * хозяина не имеет. Конфиг коробки — два правила ядра, без плагинов.
 */
describe("свод: строки держателя «линт» ставит машина", () => {
  it("нарушение — «нашлось» без сессии, спор с линтом — дыра, починили — «чисто»", () => {
    const box = seatEmpty("lint-row-");
    try {
      // Диапазон среды — по машине прогона: `R6` спрашивает и версию среды, а
      // семя требует проверенную, которой у машины прогона может не быть.
      const pkgAt0 = path.join(box, "package.json");
      const pkg0 = JSON.parse(fs.readFileSync(pkgAt0, "utf8"));
      pkg0.engines.node = ">=" + process.versions.node;
      fs.writeFileSync(pkgAt0, JSON.stringify(pkg0, null, 2) + "\n");
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const withLint = { ...process.env, NODE_PATH: path.join(process.cwd(), "node_modules") };
      const bar = (env) =>
        spawnSync(process.execPath, [graph, "bar", "src/app/zzLint.js"], {
          cwd: box,
          encoding: "utf8",
          env,
        }).stdout;
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const rowOf = (id) =>
        new RegExp("^\\| " + id + " \\| [^|]+ \\| [^|]+ \\| ([^|]*) \\| ([^|]*) \\| ([^|]*) \\|", "m").exec(
          fs.readFileSync(protoAt, "utf8"),
        );
      fs.writeFileSync(
        path.join(box, "eslint.config.mjs"),
        'export default [{ files: ["**/*.js"], rules: { "no-empty": "error", "use-isnan": "error" } }];\n',
      );
      const code = path.join(box, "src", "app", "zzLint.js");
      fs.writeFileSync(
        code,
        "export function zz(x) {\n  try {\n    JSON.parse(x);\n  } catch {}\n  return x === NaN ? 0 : 1;\n}\n",
      );
      // Нарушение — исход ставит машина, с адресом и правилом.
      expect(bar(withLint)).toMatch(
        /машина поставила исход строкам — \d+ \(линтом — 2, сверкой — \d+, срезом — 0\), из них «нашлось» — 2; линт прогнан по файлам кода предмета — 1; сверки прогнаны/,
      );
      const found = rowOf("E1");
      expect(found?.[1].trim()).toBe("нашлось");
      expect(found?.[2].trim()).toBe("app/zzLint.js:4");
      expect(found?.[3]).toContain("линт: no-empty");
      expect(rowOf("E2")?.[2].trim()).toBe("app/zzLint.js:5");
      // Сессия закрывает нарушение «чистым» — дыра.
      fs.writeFileSync(
        protoAt,
        fs.readFileSync(protoAt, "utf8").replace(found[0], found[0].replace("| нашлось |", "| чисто |")),
      );
      expect(bar(withLint)).toContain("E1: линт видит нарушение (линт: no-empty");
      // Починили — свод заново. Правила критерия молчат и все включены
      // ошибкой, но набор форм вне держателя открыт — молчание стоит опорой,
      // исход ставит сессия; у критерия, чьих правил конфиг включает не все,
      // строка остаётся сессии пустой.
      fs.writeFileSync(code, "export function zz(x) {\n  return Number.isNaN(x) ? 0 : 1;\n}\n");
      fs.rmSync(protoAt);
      bar(withLint);
      expect(rowOf("E2")?.[1].trim()).toBe("");
      expect(rowOf("E2")?.[3]).toContain("линт: use-isnan — нарушений нет");
      expect(rowOf("E2")?.[3]).toContain("исход ставит чтение по странице критерия");
      expect(rowOf("E1")?.[1].trim()).toBe("");
      expect(rowOf("E1")?.[3].trim()).toBe("");
      // Сверка, осмотревшая предмет и не нашедшая ничего, — опора, а не
      // исход, пока набор форм открыт; при закрытом — «чисто» от машины.
      // Срез, который правило линта не видит, — «нашлось».
      expect(rowOf("R6")?.[1].trim()).toBe("");
      expect(rowOf("R6")?.[3]).toContain("сверка «Диапазон среды объявлен»");
      // Набор форм вне держателя объявлен закрытым — та же тишина сверки
      // ставит «чисто» сама.
      const predicatesAt = path.join(box, ".claude", "tools", "graph.predicates.mjs");
      const predicates0 = fs.readFileSync(predicatesAt, "utf8");
      const openR6 = /^ {2}R6: \[\n(?: {4}".*",\n)+ {2}\],\n/m;
      expect(predicates0).toMatch(openR6);
      fs.writeFileSync(
        predicatesAt,
        predicates0.replace(openR6, "  R6: \"закрыто: проба — держатель видит каждую форму\",\n"),
      );
      fs.rmSync(protoAt);
      bar(withLint);
      expect(rowOf("R6")?.[1].trim()).toBe("чисто");
      expect(rowOf("R6")?.[3]).toContain("сверка «Диапазон среды объявлен»");
      fs.writeFileSync(predicatesAt, predicates0);
      // Сверка, не осмотревшая ничего, опорой не служит: гарантий в коробке
      // нет, и строка о новой возможности остаётся сессии.
      expect(rowOf("J12")?.[1].trim()).toBe("");
      fs.writeFileSync(code, "export function zz(p) {\n  return p.catch(() => {});\n}\n");
      fs.rmSync(protoAt);
      expect(bar(withLint)).toMatch(/машина поставила исход строкам — \d+ \(линтом — \d+, сверкой — \d+, срезом — 1\)/);
      expect(rowOf("E1")?.[1].trim()).toBe("нашлось");
      expect(rowOf("E1")?.[2].trim()).toBe("app/zzLint.js:2");
      expect(rowOf("E1")?.[3]).toContain("срез: пустой перехват");
      // Линт объявлен, но не поставлен — его строки остаются сессии, и печать
      // называет настоящую причину; сверки отвечают и без него.
      const noPath = { ...process.env, NODE_PATH: "" };
      fs.rmSync(protoAt);
      expect(bar(noPath)).toContain(
        "линт недоступен: пакет `eslint` объявлен манифестом, но не разрешается",
      );
      expect(rowOf("E2")?.[1].trim()).toBe("");
      expect(rowOf("E2")?.[3].trim()).toBe("");
      expect(rowOf("R6")?.[1].trim()).toBe("");
      // Не объявлен вовсе — причина другая.
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      delete pkg.devDependencies.eslint;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      fs.rmSync(protoAt);
      const absent = "линт недоступен: пакета `eslint` у проекта нет";
      expect(bar(noPath)).toContain(absent);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);

  // Строка на работу одна, а мест нарушения бывает несколько, и сообщение
  // правила бывает в несколько строк. Найдено стендом проб: правила
  // компилятора React рвали строку протокола переводом строки, а вторая
  // посадка того же правила пропадала за первой.
  it("сообщение линта — одной строкой; строка линта и среза перечисляет все места", () => {
    const box = seatEmpty("lint-many-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.engines.node = ">=" + process.versions.node;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      const bar = (env) =>
        spawnSync(process.execPath, [graph, "bar", "src/app/zzMany"], { cwd: box, encoding: "utf8", env }).stdout;
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const rowOf = (id) =>
        new RegExp("^\\| " + id + " \\| [^|]+ \\| [^|]+ \\| ([^|]*) \\| ([^|]*) \\| ([^|]*) \\| ([^|]*) \\|$", "m").exec(
          fs.readFileSync(protoAt, "utf8"),
        );
      // Правило с сообщением в две строки — под именем правила, которое
      // держит C11: так оно попадает в строку протокола.
      fs.writeFileSync(
        path.join(box, "eslint.config.mjs"),
        "const twoLines = { create: (context) => ({ Program: (node) => context.report({ node, message: \"first line\\nsecond line\" }) }) };\n" +
          'export default [{ files: ["**/*.js"], plugins: { "react-hooks": { rules: { purity: twoLines } } }, rules: { "no-empty": "error", "react-hooks/purity": "error" } }];\n',
      );
      const dir = path.join(box, "src", "app", "zzMany");
      fs.mkdirSync(dir, { recursive: true });
      for (const name of ["zzOne", "zzTwo"])
        fs.writeFileSync(
          path.join(dir, name + ".js"),
          "export function " + name + "(x) {\n  try {\n    JSON.parse(x);\n  } catch {}\n  return x;\n}\n",
        );
      const withLint = { ...process.env, NODE_PATH: path.join(process.cwd(), "node_modules") };
      bar(withLint);
      const purity = rowOf("C11");
      expect(purity, "строка C11 разорвана либо пуста").not.toBeNull();
      expect(purity?.[3]).toContain("first line second line");
      const empty = rowOf("E1");
      expect(empty?.[1].trim()).toBe("нашлось");
      expect(empty?.[2].trim()).toBe("app/zzMany/zzOne.js:4");
      expect(empty?.[3]).toContain("ещё нарушений `1`: app/zzMany/zzTwo.js:4");
      // Без линта строку ставит срез — и тоже называет оба места.
      fs.rmSync(protoAt);
      bar({ ...process.env, NODE_PATH: "" });
      const cut = rowOf("E1");
      expect(cut?.[3]).toContain("срез: пустой перехват");
      expect(cut?.[3]).toMatch(/ещё мест `1`: app\/zzMany\/zz(?:One|Two)\.js:4/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

/**
 * Гарантия поведения — то, что продукт обещает пользователю, с тестом,
 * который это держит. Тест закрепляет то, что написал его автор; обещанное
 * не было записано нигде, и снятый тест обещания не ронял ничего.
 */
describe("гарантия поведения держится тестом", () => {
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  const HEAD =
    "| Гарантия | Род | Что наблюдают | Источник | Узлы | Тест |\n| --- | --- | --- | --- | --- | --- |\n";
  const promise = (box, rows) => {
    const at = path.join(box, ".context", "05-flows.md");
    fs.writeFileSync(
      at,
      fs.readFileSync(at, "utf8").replace(HEAD, HEAD + rows.map((r) => r + "\n").join("")),
    );
  };
  const badge = (put) => {
    put(
      "src/components/ZzBadge/ZzBadge.tsx",
      'export function ZzBadge({ label }: { label: string }) {\n  return <span>{label}</span>;\n}\n',
    );
    put(
      "src/components/ZzBadge/tests/ZzBadge.test.tsx",
      'import { it } from "vitest";\nimport { ZzBadge } from "../ZzBadge";\n\nit("zz badge shows its label", () => {\n  ZzBadge({ label: "x" });\n});\n',
    );
  };
  const ROW =
    "| REQ-1 | должно | на значке видна подпись | разработчик, 2026-10-04 | `components/ZzBadge/ZzBadge.tsx` | `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label» |";
  // Та же строка с другим источником: остальные графы верны, и красное — о нём.
  const sourced = (source) => ROW.replace("разработчик, 2026-10-04", source);

  it("тест, снятый с гарантии, висящий номер и витрина без гарантии краснеют; верная строка — нет", () => {
    const box = seatEmpty("garant-");
    try {
      const put = putIn(box);
      badge(put);
      promise(box, [ROW]);
      expect(verifyIn(box).get("Гарантия держится тестом")).toBeUndefined();

      // Источник: не назван, путь, которого нет, решение, которого нет, и
      // не дата — краснеют; документ, который есть, и задача трекера — нет.
      const flows = path.join(box, ".context", "05-flows.md");
      const table = fs.readFileSync(flows, "utf8");
      const sourceSays = (source) => {
        fs.writeFileSync(flows, table.replace(ROW, sourced(source)));
        return (verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n");
      };
      expect(sourceSays("")).toContain("REQ-1: источник не назван");
      expect(sourceSays("так задумано")).toContain("REQ-1: источник не назван");
      expect(sourceSays("`docs/zz-spec.md`")).toContain(
        "REQ-1: источника `docs/zz-spec.md` нет на диске",
      );
      expect(sourceSays("ADR-7")).toContain("REQ-1: решения ADR-7 нет");
      expect(sourceSays("разработчик, 2026-02-30")).toContain(
        "REQ-1: «2026-02-30» — не дата",
      );
      // Месяц, которого нет, — не дата, а не обвал сверки.
      expect(sourceSays("разработчик, 2026-13-45")).toContain(
        "REQ-1: «2026-13-45» — не дата",
      );
      put("docs/zz-spec.md", "# Spec\n\nThe badge shows its label.\n");
      expect(sourceSays("`docs/zz-spec.md`")).toBe("");
      expect(sourceSays("#12, `docs/zz-spec.md`")).toBe("");
      fs.writeFileSync(flows, table);

      // Шапка, объявленная без графы источника, не читается вовсе.
      const configAt = path.join(box, ".context", "graph.config.mjs");
      const configWas = fs.readFileSync(configAt, "utf8");
      fs.writeFileSync(
        configAt,
        configWas.replace(
          "| Гарантия | Род | Что наблюдают | Источник | Узлы | Тест |",
          "| Гарантия | Род | Что наблюдают | Узлы | Тест |",
        ),
      );
      expect((verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n")).toContain(
        "таблица гарантий: в объявленной шапке нет граф «Источник»",
      );
      fs.writeFileSync(configAt, configWas);

      // Тест переименован — гарантию не держит ничто.
      put(
        "src/components/ZzBadge/tests/ZzBadge.test.tsx",
        'import { it } from "vitest";\nimport { ZzBadge } from "../ZzBadge";\n\nit("zz badge renders", () => {\n  ZzBadge({ label: "x" });\n});\n',
      );
      expect((verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n")).toContain(
        "REQ-1: в `components/ZzBadge/tests/ZzBadge.test.tsx` нет теста «zz badge shows its label»",
      );
      badge(put);

      // Витрина: строка без номера — находка; номер, которого нет в таблице, — тоже.
      const features = path.join(box, "docs", "FEATURES.md");
      const was = fs.readFileSync(features, "utf8");
      fs.writeFileSync(
        features,
        was + "\n## Behaviour\n\n- Shows a label on a badge (REQ-1)\n- Glows on hover\n- Blinks twice (REQ-9)\n",
      );
      const red = (verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n");
      expect(red).toContain("строка витрины не называет гарантию REQ-n");
      expect(red).toContain("REQ-9: в таблице такой нет");
      expect(red.match(/строка витрины не называет гарантию/g)).toHaveLength(1);

      // Долг гасит строки витрины без номера, а висящий номер — нет: это
      // запись о том, чего нет, а не неописанное.
      const config = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        config,
        fs.readFileSync(config, "utf8").replace("    guarantees: null,", "    guarantees: 1,"),
      );
      const owed = (verifyIn(box).get("Гарантия держится тестом") ?? []).join("\n");
      expect(owed).not.toContain("строка витрины не называет гарантию");
      expect(owed).toContain("REQ-9: в таблице такой нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("оракул теста: ожидание из кода, правленое ожидание и правленый тест гарантии — вопросами J13", () => {
    const box = seatEmpty("oracle-");
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
      const put = putIn(box);
      const badgeAt = "src/components/ZzBadge/ZzBadge.tsx";
      const testAt = "src/components/ZzBadge/tests/ZzBadge.test.tsx";
      put(
        badgeAt,
        'export const ZZ_LABEL = "x";\nexport function ZzBadge({ label }: { label: string }) {\n  return <span>{label}</span>;\n}\n',
      );
      const testText = [
        'import { expect, it } from "vitest";',
        'import { ZzBadge, ZZ_LABEL } from "../ZzBadge";',
        "",
        'it("zz badge shows its label", () => {',
        // Черта в утверждении: образец строки модели её не несёт.
        '  expect(ZzBadge({ label: "x" }).props.children || "").toBe("x");',
        "});",
        "",
        'it("zz badge default", () => {',
        "  expect(ZzBadge({ label: ZZ_LABEL }).props.children).toBe(ZZ_LABEL);",
        "});",
        "",
      ].join("\n");
      put(testAt, testText);
      promise(box, [ROW]);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const rowsOf = () =>
        [
          ...fs
            .readFileSync(protoAt, "utf8")
            .matchAll(
              /^\| (П\d+) \| ([^|]+?) \| `([^`]*)` \| ([^|]*?) \| ([^|]*?) \| ([^|]*?) \| [^|]*? \| [^|]*? \|$/gm,
            ),
        ].map((m) => ({ id: m[1], sort: m[2], where: m[3], what: m[4], delta: m[5], mark: m[6] }));

      // Чтение: ожидаемое из константы проверяемого модуля — строка модели,
      // и «чисто» по J13, не назвавшее её, — вопрос без ответа.
      tool("bar", "components/ZzBadge");
      const fromCode = rowsOf().find((r) => r.sort === "тест" && r.mark === "ожидание из кода");
      expect(fromCode?.where).toBe("components/ZzBadge/tests/ZzBadge.test.tsx:9");
      expect(fromCode?.what).toContain("ZZ_LABEL");
      // Литерал на строке 5 признака не даёт.
      expect(fromCode?.what).not.toContain("строка 5");
      fillBar(protoAt, { release: "не нужно: проба", pick: { J13: "чисто |  | тесты в порядке | " } });
      expect(tool("bar", "components/ZzBadge")).toMatch(
        /J13: чисто, а ожидаемое в тесте взято из проверяемого кода, и в основании не сказано, откуда оно известно независимо от него: П\d+/,
      );
      fs.rmSync(protoAt);

      // Правка: код и ожидание его гарантированного теста сдвинуты вместе.
      put(
        badgeAt,
        'export const ZZ_LABEL = "x";\nexport function ZzBadge({ label }: { label: string }) {\n  return <span>{label.toUpperCase()}</span>;\n}\n',
      );
      put(testAt, testText.replace('.toBe("x");', '.toBe("X");'));
      tool("bar");
      const rows = rowsOf();
      const edited = rows.find((r) => r.sort === "тест" && r.mark === "ожидание правлено");
      expect(edited?.where).toBe("components/ZzBadge/tests/ZzBadge.test.tsx:4");
      expect(edited?.delta).toBe("изменено");
      expect(edited?.what).toContain("строка 5 последнего коммита, тест «zz badge shows its label»");
      const guarded = rows.find((r) => r.sort === "гарантия" && r.mark === "тест правлен");
      expect(guarded?.what).toContain(
        "REQ-1 (должно): утверждения теста components/ZzBadge/tests/ZzBadge.test.tsx «zz badge shows its label» изменены этой работой, а строка гарантии — нет",
      );
      fillBar(protoAt, { release: "не нужно: проба", pick: { J13: "чисто |  | тесты в порядке | " } });
      expect(tool("bar")).toMatch(
        /J13: чисто, а работа изменила утверждения теста гарантии, и в основании не сказано, держит ли он прежнее обещание или строка гарантии изменена той же правкой: П\d+/,
      );
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain(
        "    тест правлен: REQ-1 (должно) на значке видна подпись; источник: разработчик, 2026-10-04; тест `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label»",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("гарантия «никогда» с тестом без перебора входов — строка модели с вопросом J11", () => {
    const box = seatEmpty("garant-never-");
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
      const put = putIn(box);
      badge(put);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const rowsOf = () => {
        if (fs.existsSync(protoAt)) fs.rmSync(protoAt);
        tool("bar", "components/ZzBadge/ZzBadge.tsx");
        return fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .filter((l) => l.includes("| никогда без перебора |"));
      };
      promise(box, [ROW.replace("| должно |", "| никогда |")]);
      const rows = rowsOf();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(
        "REQ-1 (никогда): на значке видна подпись — тест components/ZzBadge/tests/ZzBadge.test.tsx «zz badge shows its label» входов не перебирает",
      );
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        /^\| J11 \|[^\n]*спрашивают: [^\n]*П\d+/m,
      );
      // Тест перебирает входы — вопроса нет.
      put(
        "src/components/ZzBadge/tests/ZzBadge.test.tsx",
        'import { it } from "vitest";\nimport { ZzBadge } from "../ZzBadge";\n\nit("zz badge shows its label", () => {\n  for (const label of ["x", ""]) ZzBadge({ label });\n});\n',
      );
      expect(rowsOf()).toHaveLength(0);
      // Род «должно» вопроса не задаёт.
      badge(put);
      const flows = path.join(box, ".context", "05-flows.md");
      fs.writeFileSync(
        flows,
        fs.readFileSync(flows, "utf8").replace("| никогда |", "| должно |"),
      );
      expect(rowsOf()).toHaveLength(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("гарантия области и новая возможность — строками модели и вопросами J11 и J12", () => {
    const box = seatEmpty("garant-bar-");
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
      const put = putIn(box);
      badge(put);
      promise(box, [ROW]);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Правка узла гарантии и новый компонент рядом.
      put(
        "src/components/ZzBadge/ZzBadge.tsx",
        'export function ZzBadge({ label }: { label: string }) {\n  return <b>{label}</b>;\n}\n',
      );
      put(
        "src/components/ZzChip/ZzChip.tsx",
        'export function ZzChip({ text }: { text: string }) {\n  return <i>{text}</i>;\n}\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const first = fs.readFileSync(protoAt, "utf8");
      expect(first).toMatch(
        /\| гарантия \| `05-flows\.md:\d+` \| REQ-1 \(должно\): на значке видна подпись — источник: разработчик, 2026-10-04; узлы в работе: components\/ZzBadge\/ZzBadge\.tsx; тест: components\/ZzBadge\/tests\/ZzBadge\.test\.tsx «zz badge shows its label» \|  \| затронута \|/,
      );
      expect(first).toContain(
        "| гарантия | `components/ZzChip/ZzChip.tsx` | новый файл в слое компонентов — гарантии, называющие узел: нет | новое | новая возможность |",
      );
      // Ни «чисто» мимо строк, ни «нет предмета» при них.
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { J11: "чисто |  | тест прогнан | ", J12: "нет предмета |  | ничего нового | " },
      });
      const said = tool("bar");
      expect(said).toMatch(/J11: чисто, а гарантия поведения называет узел этой работы[^:]*: П\d+/);
      expect(said).toMatch(/J12: нет предмета, а в модели он есть: П\d+/);
      fs.rmSync(protoAt);
      tool("bar");
      const ids = [...fs.readFileSync(protoAt, "utf8").matchAll(/\| (П\d+) \| гарантия \|/g)].map((m) => m[1]);
      expect(ids).toHaveLength(2);
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          J11: "чисто |  | " + ids[0] + ": тест значка проверяет подпись, и подпись та же | ",
          J12: "чисто |  | " + ids[1] + ": значок-заготовка, наружу не виден | ",
        },
      });
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain("гарантии против последнего коммита: без изменений");
      // Адрес строки гарантии в протоколе — от папки базы, и сверка базы его
      // разбирает: печать не роняет цепочку проверок проекта.
      expect(verifyIn(box).get("Не разобрано (проверкой не покрыто)")).toBeUndefined();

      // Сдвиг таблицы печатается под печатью дословно — для отчёта.
      promise(box, [
        "| REQ-2 | никогда | у фишки нет пустого текста | #41 | `components/ZzChip/ZzChip.tsx` | `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label» |",
      ]);
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(tool("bar")).toContain(
        "    новая: REQ-2 (никогда) у фишки нет пустого текста; источник: #41; тест `components/ZzBadge/tests/ZzBadge.test.tsx` «zz badge shows its label»",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("правка листа в единице узла гарантии затрагивает гарантию, хотя лист она не называет", () => {
    const box = seatEmpty("garant-unit-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const put = putIn(box);
      badge(put);
      put("src/components/ZzChip/ZzChip.module.scss", ".chip {\n  color: red;\n}\n");
      promise(box, [ROW]);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      put("src/components/ZzBadge/ZzBadge.module.scss", ".badge {\n  animation: spin 1s infinite;\n}\n");
      put("src/components/ZzChip/ZzChip.module.scss", ".chip {\n  color: blue;\n}\n");
      spawnSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "bar"], {
        cwd: box,
        encoding: "utf8",
      });
      const rows = fs
        .readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8")
        .split("\n")
        .filter((l) => /^\| П\d+ \| гарантия \|/.test(l));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(
        "REQ-1 (должно): на значке видна подпись — источник: разработчик, 2026-10-04; узлы в работе: components/ZzBadge/ZzBadge.tsx — правлена его единица переноса",
      );
      expect(rows[0]).toContain("| затронута |");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Запись о ключе хранилища — не только то, что она есть, но и то, что она
 * говорит: каждый файл, где код пишет или снимает ключ, назван в ней, и конец
 * записи назван графой времени жизни. Ключ, который пишет узел области,
 * встаёт строкой модели с тем, что его снимает, — вопрос о конце жизни (`K6`).
 */
describe("конец жизни сохранённого и запись о состоянии", () => {
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  const STATE_HEAD =
    "# Состояние\n\n| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n";
  const store = (put) =>
    put(
      "src/shared/zzStore/zzStore.ts",
      'export const zzSave = (n: number): void => {\n  localStorage.setItem("zz-count", String(n));\n};\n',
    );

  it("писатель ключа, которого запись не называет, и пустое время жизни краснеют", () => {
    const box = seatEmpty("state-rec-");
    try {
      const put = putIn(box);
      store(put);
      put(
        "src/app/zzClear.ts",
        'export const zzClear = (): void => {\n  localStorage.removeItem("zz-count");\n};\n',
      );
      const state = (rows) => put(".context/04-state.md", STATE_HEAD + rows.join("\n") + "\n");
      // Однофамилец — состояние экрана с тем же именем — запись ключа не
      // подменяет: файл, названный им, писателем ключа не засчитан.
      state([
        "| `zz-count` на экране | `src/app/zzClear.ts` | обработчик | подпись | пока смонтирован |",
        "| ключ `zz-count` в `localStorage` | `src/shared/zzStore/zzStore.ts` | `zzSave` | никто | до вызова очистки |",
      ]);
      expect((verifyIn(box).get("Запись о состоянии не спорит с кодом") ?? []).join("\n")).toContain(
        "ключ `zz-count`: код пишет его в `app/zzClear.ts`, а запись этот файл не называет ни владельцем, ни писателем",
      );
      state([
        "| ключ `zz-count` в `localStorage` | `src/shared/zzStore/zzStore.ts` | `zzSave`; `zzClear` в `src/app/zzClear.ts` | никто | до вызова очистки |",
      ]);
      expect(verifyIn(box).get("Запись о состоянии не спорит с кодом")).toBeUndefined();
      state([
        "| ключ `zz-count` в `localStorage` | `src/shared/zzStore/zzStore.ts` | `zzSave`; `zzClear` в `src/app/zzClear.ts` | никто |  |",
      ]);
      const red = (verifyIn(box).get("Запись о состоянии не спорит с кодом") ?? []).join("\n");
      expect(red).not.toContain("не называет");
      expect(red).toContain("графа «Время жизни» пуста — конец записи не назван");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("ключ, который пишет узел области, — строкой хранения и вопросом K6", () => {
    const box = seatEmpty("store-bar-");
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
      const put = putIn(box);
      const facts = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        facts,
        fs.readFileSync(facts, "utf8").replace("| K. Внешние данные | нет |", "| K. Внешние данные | да |"),
      );
      put("src/shared/zzStore/zzStore.ts", "export const zzSave = (n: number): void => {\n  void n;\n};\n");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Правка заводит ключ, который не снимает никто.
      store(put);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain(
        "| хранение | `shared/zzStore/zzStore.ts:2` | хранилище «zz-count»: пишут shared/zzStore/zzStore.ts; снимает никто | новое | без снятия |",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { K6: "чисто |  | ключ живёт вечно | " },
      });
      expect(tool("bar")).toMatch(
        /K6: чисто, а в области пишут ключ хранилища, и в основании не сказано, где кончается жизнь записи[^:]*: П\d+/,
      );

      // Снятие по ключу появилось — пометки нет, а строка называет снимающего.
      put(
        "src/shared/zzStore/zzDrop.ts",
        'export const zzDrop = (): void => {\n  localStorage.removeItem("zz-count");\n};\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        /\| хранение \| `shared\/zzStore\/zz(?:Store|Drop)\.ts:2` \| хранилище «zz-count»: пишут shared\/zzStore\/zzDrop\.ts, shared\/zzStore\/zzStore\.ts; снимает по ключу — shared\/zzStore\/zzDrop\.ts \| новое \|  \|/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Рост стоимости с объёмом данных: узел с подпиской, нарисованный в обходе
 * списка, берёт её на каждый элемент.
 */
describe("рост стоимости с объёмом данных", () => {
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  const toolIn = (box) => (...args) => {
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

  it("узел с подпиской, нарисованный в обходе списка, — строкой роста и вопросом G9", () => {
    const box = seatEmpty("per-item-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = toolIn(box);
      const put = putIn(box);
      put(
        "src/components/ZzRow/ZzRow.tsx",
        [
          'import { useEffect } from "react";',
          "",
          "export function ZzRow({ id }: { id: string }) {",
          "  useEffect(() => {",
          "    const on = () => undefined;",
          '    window.addEventListener("resize", on);',
          '    return () => window.removeEventListener("resize", on);',
          "  }, []);",
          "  return <li>{id}</li>;",
          "}",
          "",
        ].join("\n"),
      );
      const list = (cls) =>
        put(
          "src/app/zzList.tsx",
          'import { ZzRow } from "../components/ZzRow/ZzRow";\n\nexport function ZzList({ ids }: { ids: string[] }) {\n  return <ul className="' +
            cls +
            '">{ids.map((id) => <ZzRow key={id} id={id} />)}</ul>;\n}\n',
        );
      list("a");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      list("b");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain(
        "| рост | `app/zzList.tsx:4` | ZzRow из components/ZzRow/ZzRow.tsx — подписка на каждый элемент списка: слушатель события |  | на элемент |  | код |",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { G9: "чисто |  | список короткий | " },
      });
      expect(tool("bar")).toMatch(
        /G9: чисто, а работа растёт с объёмом данных, и в основании не назван её рост[^:]*: П\d+/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Строка модели называет, откуда она: из кода, из записи базы либо дописана
 * сессией. Печать называет, сколько «чисто» стоит только на записях базы, и
 * каталоги, с которыми сверено «чисто» о целом, вместе с их незаписанным.
 */
describe("происхождение строк модели и каталоги под печатью", () => {
  it("строка модели называет, откуда она, а печать — сколько «чисто» стоит на одной базе и каков каталог", () => {
    const box = seatEmpty("origin-");
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
        path.join(box, "src", "app", "zzTick.tsx"),
        'import { useState } from "react";\n\nexport function ZzTick() {\n  const [n, setN] = useState(0);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}\n',
      );
      const mapAt = path.join(box, ".context", "00-map.md");
      const MAP_HEAD = "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |";
      fs.writeFileSync(
        mapAt,
        fs
          .readFileSync(mapAt, "utf8")
          .replace(MAP_HEAD, MAP_HEAD + "\n| `app/zzTick.tsx` | счётчик нажатий | `n` | нет |"),
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzTick.tsx");
      const printed = fs.readFileSync(protoAt, "utf8");
      const resp = /^\| (П\d+) \| ответственность \|[^\n]*\| база \|$/m.exec(printed);
      expect(resp).not.toBeNull();
      expect(printed).toMatch(/^\| П\d+ \| состояние \|[^\n]*\| код \|$/m);
      expect(printed).toContain(
        "записей о состоянии `0`, файлов с состоянием `1`, из них без записи `1`",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { G8: "чисто |  | " + resp[1] + ": по карте узел ничего не оптимизирует | " },
      });
      const sealed = tool("bar", "app/zzTick.tsx");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toMatch(/«чисто» с опорой только на записи базы: 1 —/);
      // Каждое «чисто» стоит на самой сильной опоре своего критерия, и
      // опоры делят все «чисто» без остатка.
      const total = Number(/«чисто»: (\d+);/.exec(sealed)?.[1]);
      const grip =
        /«чисто» по самой сильной опоре критерия: сверкой, срезом или фактом — (\d+); правилом линта — (\d+); вопросом модели — (\d+) \(строка встала у (\d+), признак не встал у (\d+)\); свидетелем — (\d+); основанием ядра — (\d+); одним вниманием — (\d+)/.exec(
          sealed,
        );
      expect(grip).not.toBeNull();
      expect(total).toBeGreaterThan(0);
      const [check, linted, asked, rose, quiet, witness, core, attention] = grip.slice(1).map(Number);
      expect(check + linted + asked + witness + core + attention).toBe(total);
      expect(linted).toBeGreaterThan(0);
      // У счётчика с состоянием строка встаёт у критериев о состоянии, а у
      // прочих вопросов модели признак не встаёт: обе доли не пусты.
      expect(rose + quiet).toBe(asked);
      expect(rose).toBeGreaterThan(0);
      expect(quiet).toBeGreaterThan(0);
      expect(sealed).toMatch(/«чисто» о целом по каталогам: [1-9]\d*; каталоги — записей о состоянии 0, файлов с состоянием 1, из них без записи 1/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Права и секреты — предмет раздела безопасности: проверка права в коде
 * делает раздел живым, право из данных клиента и секрет в поставке встают
 * строками модели, о которых спрашивают `Q8` и `Q9`; запись наружу —
 * вопрос об исчерпании (`S7`).
 */
describe("права, секреты и исчерпание в своде", () => {
  it("проверка права делает раздел Q живым по замеру", () => {
    const box = seatEmpty("rights-scope-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzGate.ts"),
        'export const zzAllowed = (role: string): boolean => role === "admin";\n',
      );
      expect((verifyIn(box).get("Применимость разделов планки") ?? []).join("\n")).toContain(
        "объявлен неприменимым, а предмет на диске есть: Q",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("право из данных клиента, секрет в поставке и запись наружу — вопросы Q8, Q9 и S7", () => {
    const box = seatEmpty("rights-bar-");
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
      const facts = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        facts,
        fs
          .readFileSync(facts, "utf8")
          .replace("| K. Внешние данные | нет |", "| K. Внешние данные | да |")
          .replace("| Q. Безопасность | нет |", "| Q. Безопасность | да |")
          .replace("| S. Наблюдаемость и эксплуатация | нет |", "| S. Наблюдаемость и эксплуатация | да |"),
      );
      fs.writeFileSync(
        path.join(box, "src", "app", "zzGate.ts"),
        [
          "export const zzKey = import.meta.env.VITE_ZZ_SECRET;",
          'export const zzRole = (): string | null => localStorage.getItem("userRole");',
          'export const zzMark = (): void => localStorage.setItem("zz-seen", "1");',
          "",
        ].join("\n"),
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzGate.ts");
      const printed = fs.readFileSync(protoAt, "utf8");
      expect(printed).toMatch(/^\| П\d+ \| права \| `app\/zzGate\.ts:2` \|[^\n]*\| из клиента \|/m);
      expect(printed).toMatch(/^\| П\d+ \| секрет \| `app\/zzGate\.ts:1` \|[^\n]*\| в поставку \|/m);
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          Q8: "чисто |  | права проверяет сервер | ",
          Q9: "чисто |  | ключ публичный | ",
          S7: "чисто |  | квоты хватит | ",
        },
      });
      const said = tool("bar", "app/zzGate.ts");
      expect(said).toMatch(/Q8: чисто, а право берётся из данных, которые клиент пишет сам[^:]*: П\d+/);
      expect(said).toMatch(/Q9: чисто, а в предмете секрет, который уезжает в поставку[^:]*: П\d+/);
      expect(said).toMatch(/S7: чисто, а предмет пишет наружу, и в основании не сказано, что при исчерпании: полная квота, отказ, переполнение: П\d+/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("окно свежести и залежавшееся не молчат", () => {
  it("без пометки своей оси окно отказывает, чужая пометка его не сдвигает, неверная область названа", () => {
    // Блоки берутся из самого скилла: проверяется то, что сессия исполнит.
    const skill = fs.readFileSync(
      path.join(TOOL_DIR, "..", "skills", "probe", "SKILL.md"),
      "utf8",
    );
    const blockAfter = (heading) => {
      const from = skill.indexOf(heading);
      expect(from).toBeGreaterThan(-1);
      return /```\n([\s\S]*?)```/.exec(skill.slice(from))?.[1] ?? "";
    };
    const window = blockAfter("### Окно свежести считается, а не вспоминается");
    const stale = blockAfter("**«Залежавшееся» — не холодный контур, и путать нельзя.**");
    expect(stale).toContain("<область>");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "okno-"));
    try {
      const git = (...args) =>
        execFileSync("git", ["-c", "user.name=okno", "-c", "user.email=okno@local", ...args], {
          cwd: repo,
          stdio: "ignore",
        });
      const shell = (script) => {
        // Промах git называет по-английски только в локали C.
        const r = spawnSync("sh", ["-c", script], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, LC_ALL: "C" },
        });
        return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
      };
      git("init", "-q");
      fs.writeFileSync(path.join(repo, "early.txt"), "1\n");
      git("add", "-A");
      git("commit", "-qm", "early");
      fs.writeFileSync(path.join(repo, "early.txt"), "2\n");
      // Пометки нет: окно не сжимается до одной незакоммиченной правки.
      const none = shell(window);
      expect(none.out).toContain("пометка: нет");
      expect(none.code).not.toBe(0);
      expect(none.out).not.toContain("early.txt");
      git(
        "commit",
        "-qam",
        "fix: zz\n\nProbe-run: hot; классов: 1, сведено: 1, не сведено: 0; не поместилось: ничего",
      );
      fs.writeFileSync(path.join(repo, "later.txt"), "1\n");
      git("add", "-A");
      git("commit", "-qm", "later");
      fs.writeFileSync(path.join(repo, "cold.txt"), "1\n");
      git("add", "-A");
      git(
        "commit",
        "-qm",
        "fix: zz\n\nProbe-run: cold; классов: 1, сведено: 1, не сведено: 0; не поместилось: ничего",
      );
      fs.writeFileSync(path.join(repo, "later.txt"), "2\n");
      // Окно — от пометки своей оси: чужая его не сдвигает, правка после
      // пометки и незакоммиченная — в нём, правка до пометки — нет.
      const some = shell(window);
      expect(some.code).toBe(0);
      expect(some.out).toContain("later.txt");
      expect(some.out).toContain("cold.txt");
      expect(some.out).not.toContain("early.txt");
      expect(shell(stale.split("<область>").join("nowhere")).out).toContain("did not match");
      expect(shell(stale.split("<область>").join(".")).out).toMatch(/^\d{4}-\d{2}-\d{2} \S+$/m);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("сдвиг у комментария — по сырым строкам", () => {
  it("неизменённый блочный комментарий правленого файла — не новое, дописанный — новое", () => {
    const box = seatEmpty("sdvig-");
    try {
      const git = (...args) =>
        execFileSync("git", ["-c", "user.name=sdvig", "-c", "user.email=sdvig@local", "-c", "core.hooksPath=", ...args], {
          cwd: box,
          stdio: "ignore",
        });
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
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      const appAt = path.join(box, "src", "app", "App.tsx");
      const was = fs.readFileSync(appAt, "utf8");
      expect(was.startsWith("/**")).toBe(true);
      fs.writeFileSync(appAt, was.replace("It works", "It still works"));
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const row = () =>
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .find((l) => /^\| П\d+ \| комментарий \| `app\/App\.tsx:1` \|/.test(l)) ?? "";
      tool("bar");
      expect(row()).toContain("комментарий");
      expect(row()).not.toContain("| новое |");
      fs.rmSync(protoAt);
      fs.writeFileSync(appAt, "/** Root of the zz probe. */\n" + fs.readFileSync(appAt, "utf8"));
      tool("bar");
      expect(row()).toContain("| новое |");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("проба планки: посадка по вместимости", () => {
  it("выбор идёт из посадок, которые проект вмещает; не вмещает ни одной — так и сказано", () => {
    const box = seatEmpty("probafit-");
    const boxes = [];
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      // Посадки свои, а не из книги: тест, пересказывающий книгу, выдаёт
      // посаженное каждому, кто его читал.
      const wide = {
        criterion: "A1",
        why: "проба вместимости",
        into: [0, 1, 2, 3, 4, 5].map((k) => ({ role: "r" + k, text: "export const zzWide" + k + " = () => " + k + ";" })),
      };
      const narrow = { criterion: "H7", why: "проба вместимости", into: [{ text: "export const zzNarrow = () => 1;" }] };
      const cover = { text: "export const zzShield = () => 1;" };
      const run = (...args) => {
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
      fs.writeFileSync(probes, JSON.stringify({ plants: [wide, narrow], covers: [cover] }));
      for (const seed of [1, 2, 3, 4]) {
        const out = run("bar-probe", "--existing", "--seed=" + seed);
        const sandbox = /песочница: (.+)/.exec(out)?.[1]?.trim();
        const id = /bar-probe (\d+)/.exec(out)?.[1];
        expect(sandbox, out).toBeDefined();
        boxes.push(sandbox, path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json"));
        expect(out).toContain("проект не вместил посадок: 1 из 2");
        expect(JSON.parse(fs.readFileSync(boxes[boxes.length - 1], "utf8")).criterion).toBe("H7");
      }
      fs.writeFileSync(probes, JSON.stringify({ plants: [wide], covers: [cover] }));
      const refused = run("bar-probe", "--existing", "--seed=1");
      expect(refused).toContain("=== Проба не посажена ===");
      const [, need, have] = /не меньше (\d+), а файлов кода в проекте (\d+)/.exec(refused) ?? [];
      expect(Number(need)).toBe(7);
      expect(Number(have)).toBeLessThan(7);
      expect(refused).not.toContain("песочница:");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      for (const one of boxes) fs.rmSync(one, { recursive: true, force: true });
    }
  }, 240000);
});

describe("импорт с адресом-выражением в графе", () => {
  it("файл под постоянным путём шаблона не мёртв и не ничей, адрес без пути назван оговоркой", () => {
    const box = seatEmpty("shablon-");
    try {
      const app = path.join(box, "src", "app");
      fs.mkdirSync(path.join(app, "zzPages"), { recursive: true });
      fs.writeFileSync(path.join(app, "zzPages", "ZzHome.tsx"), "export const ZzHome = () => null;\n");
      fs.writeFileSync(
        path.join(app, "zzRoutes.ts"),
        "export const zzLoad = (name: string) => import(`./zzPages/${name}.tsx`);\n",
      );
      const run = (...args) =>
        execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), ...args], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      const users = () => sectionOf(run("brief", "app/zzPages/ZzHome.tsx"), "пользуются им");
      expect(run("dead")).not.toContain("app/zzPages/ZzHome.tsx");
      expect(users()).toContain("app/zzRoutes.ts");
      expect(run("dead")).not.toContain("адресом-выражением");
      // Адрес-значение: цели не установить, и «никто» идёт с оговоркой.
      fs.writeFileSync(path.join(app, "zzLazy.ts"), "export const zzLazy = (at: string) =>\n  import(at);\n");
      expect(run("dead")).toContain("цели которого граф не знает: app/zzLazy.ts:2");
      expect(run("blast")).toContain("цели которого граф не знает: app/zzLazy.ts:2");
      expect(users()).toContain("адресом-выражением: app/zzLazy.ts:2");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("ворота в проекте, вложенном в чужой репозиторий", () => {
  it("путь хуков — от корня репозитория, хук исполняется и видит правку проекта", () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "vlozh-"));
    const box = path.join(outer, "proj");
    fs.renameSync(seatEmpty("vlozh-proj-"), box);
    try {
      const env = { ...process.env };
      delete env.CI;
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const sh = (script) => {
        const r = spawnSync("sh", ["-c", script], { cwd: box, encoding: "utf8", env });
        return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
      };
      const gates = () => {
        let out;
        try {
          out = execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "verify"], {
            cwd: box,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env,
          });
        } catch (e) {
          out = String(e.stdout ?? "");
        }
        return out.split("=== Ворота перед коммитом установлены ===")[1]?.split("\n===")[0] ?? "";
      };
      const who = "-c user.name=vlozh -c user.email=vlozh@local";
      expect(sh("cd .. && git init -q && git add -A && git " + who + " -c core.hooksPath= commit -qm base").code).toBe(0);
      // Путь от папки проекта: строка та же, что у проекта-репозитория, а git
      // ищет хук от корня и ворот не находит.
      sh("git config core.hooksPath .claude/hooks/git");
      expect(gates()).toContain("git ищет хук в ../.claude/hooks/git");
      // Команда посадки: путь от корня репозитория.
      sh('git config core.hooksPath "$(git rev-parse --show-prefix).claude/hooks/git"');
      const set = gates();
      expect(set).toContain("осмотрено");
      expect(set).not.toMatch(/^ {4}\S/m);
      fs.writeFileSync(path.join(box, "src", "app", "zzNested.ts"), "export const zzNested = 1;\n");
      // Правку видят и режимы рабочего дерева: путь git — от корня проекта.
      const tested = sh("node .claude/tools/graph.mjs tested").out;
      expect(tested).toContain("тронуто файлов кода: 1");
      expect(tested).toMatch(/^ {4}app\/zzNested\.ts$/m);
      sh("git add -A");
      const commit = sh("git " + who + " commit -qm nested");
      expect(commit.code).not.toBe(0);
      expect(commit.out).toContain("Коммит не проходит");
      expect(commit.out).toContain("app/zzNested.ts");
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  }, 180000);
});

describe("синоним термина словаря во всей прозе полки", () => {
  it("отвергнутое слово в обосновании, справочнике, state/ и памятке полки находится", () => {
    const box = seatEmpty("sinonim-");
    try {
      const said = () => verifyIn(box).get("Синоним термина словаря не заведён") ?? [];
      expect(said()).toEqual([]);
      for (const rel of ["rationale/loop.md", "tools/graph.md", "state/todo.md", "README.md"]) {
        const at = path.join(box, ".claude", rel);
        const was = fs.readFileSync(at, "utf8");
        // Показанное в ограде кода слово не употреблено.
        fs.writeFileSync(
          at,
          was + "\n```\nПравило без ловца не держится.\n```\n",
        );
        expect(said()).toEqual([]);
        fs.writeFileSync(at, was + "\nПравило без ловца не держится.\n");
        expect(said().join("\n")).toContain(".claude/" + rel);
        fs.writeFileSync(at, was);
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("в коде полки спрашивается комментарий, а строка кода — нет", () => {
    const box = seatEmpty("sinonim-kod-");
    try {
      const said = () => verifyIn(box).get("Синоним термина словаря не заведён") ?? [];
      const plant = (rel, tail) => {
        const at = path.join(box, ".claude", rel);
        const was = fs.readFileSync(at, "utf8");
        fs.writeFileSync(at, was + tail);
        const out = said().join("\n");
        fs.writeFileSync(at, was);
        return out;
      };
      expect(plant("tools/hook.mjs", "\n// Правило без ловца не держится.\n")).toContain(
        ".claude/tools/hook.mjs",
      );
      expect(plant("hooks/git/pre-commit", "\n# Правило без ловца не держится.\n")).toContain(
        ".claude/hooks/git/pre-commit",
      );
      expect(
        plant("tools/hook.mjs", '\nexport const zzPlant = "Правило без ловца не держится.";\n'),
      ).toBe("");
      // Счёт — запрещённых слов, а не ключей файла: их два, и третье слово
      // счёт ключей не сдвигал.
      const bookAt = path.join(box, ".claude", "rules", "glossary.banned.json");
      const book = JSON.parse(fs.readFileSync(bookAt, "utf8"));
      book.banned.push({ forms: ["зззслово"], instead: "проба", found: "проба" });
      fs.writeFileSync(bookAt, JSON.stringify(book));
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
      expect(out).toContain("осмотрено терминов словаря под запретом: " + book.banned.length);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("скиллы цитируют то, что печатают режимы", () => {
  it("ярлыки ответов в скилле handoff и заглавные цитаты всех скиллов есть в инструменте", () => {
    const skills = path.join(TOOL_DIR, "..", "skills");
    const tool = ["graph.mjs", "hook.mjs"].map((f) => fs.readFileSync(path.join(TOOL_DIR, f), "utf8")).join("\n");
    const missing = [];
    const handoff = fs.readFileSync(path.join(skills, "handoff", "SKILL.md"), "utf8");
    const labels = [...handoff.matchAll(/^- \*\*«([^»]+)»\*\*/gm)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(3);
    for (const one of labels) if (!tool.includes(one)) missing.push("handoff: «" + one + "»");
    for (const name of fs.readdirSync(skills)) {
      const at = path.join(skills, name, "SKILL.md");
      if (!fs.existsSync(at)) continue;
      for (const m of fs.readFileSync(at, "utf8").matchAll(/«([^«»\n]+)»/g))
        if (/^[А-ЯЁA-Z0-9 :,.=!—-]+$/.test(m[1]) && /[А-ЯЁ]{3}/.test(m[1]) && !tool.includes(m[1]))
          missing.push(name + ": «" + m[1] + "»");
    }
    expect(missing).toEqual([]);
  });
});

describe("семена версии среды — по проверенной связке", () => {
  it("`.nvmrc` называет проверенную версию среды, `engines` начинается с проверенных", () => {
    const seeds = path.join(TOOL_DIR, "..", "seat", "templates");
    const config = fs.readFileSync(path.join(seeds, "graph.config.mjs"), "utf8");
    const verified = /verifiedVersions:\s*\{([\s\S]*?)\}/.exec(config)?.[1] ?? "";
    const pin = (name) => new RegExp("(?:^|\\s)" + name + ':\\s*"([^"]+)"', "m").exec(verified)?.[1];
    expect(pin("node")).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fs.readFileSync(path.join(seeds, ".nvmrc"), "utf8").trim()).toBe(pin("node"));
    const engines = JSON.parse(fs.readFileSync(path.join(seeds, "package.json"), "utf8")).engines;
    expect(engines).toEqual({ node: ">=" + pin("node"), npm: ">=" + pin("npm") });
  });
});

describe("ссылка на раздел разрешается в названном файле", () => {
  it("переименованный раздел не находится ни в обосновании, ни в длинном заголовке с тем же началом", () => {
    const box = seatEmpty("razdel-");
    try {
      const said = () => (verifyIn(box).get("Ссылки на разделы") ?? []).join("\n");
      const closeAt = path.join(box, ".claude", "rules", "close.md");
      const loopAt = path.join(box, ".claude", "rules", "loop.md");
      const close = fs.readFileSync(closeAt, "utf8");
      const loop = fs.readFileSync(loopAt, "utf8");
      expect(close).toMatch(/^## Отчёт$/m);
      expect(said()).toBe("");
      // Начало заголовка до двоеточия называет раздел: это законно.
      fs.writeFileSync(loopAt, loop + "\nСм. `loop.md`, раздел «Петля».\n");
      expect(said()).toBe("");
      fs.writeFileSync(loopAt, loop);
      fs.writeFileSync(closeAt, close.replace(/^## Отчёт$/m, "## Отчётность"));
      expect(said()).toContain("rules/safety.md: «Отчёт» — в close.md такого раздела нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("модуль .mjs под корнем исходников — в графе", () => {
  it("экспорт модуля .mjs без потребителей назван мёртвым, импорт его — ребром", () => {
    const box = seatEmpty("mjs-");
    try {
      const lib = path.join(box, "src", "shared", "zzMod");
      fs.mkdirSync(lib, { recursive: true });
      fs.writeFileSync(path.join(lib, "util.mjs"), "export const zzUtil = 1;\nexport const zzSpare = 2;\n");
      fs.writeFileSync(
        path.join(box, "src", "app", "zzUse.ts"),
        'import { zzUtil } from "../shared/zzMod/util.mjs";\nexport const zzUse = zzUtil;\n',
      );
      const run = (...args) =>
        execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), ...args], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      expect(run("dead")).toMatch(/shared\/zzMod\/util\.mjs\n\s+zzSpare\n/);
      expect(sectionOf(run("brief", "shared/zzMod/util.mjs"), "пользуются им")).toContain("app/zzUse.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("вид поля настройки — у чисел, строк и списков тоже", () => {
  it("окно следа строкой и поле без объявленного вида роняют запуск с именем поля", () => {
    const box = seatEmpty("vid-");
    try {
      const at = path.join(box, ".context", "graph.config.mjs");
      const seed = fs.readFileSync(at, "utf8");
      const run = () => {
        try {
          return {
            code: 0,
            out: execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "verify"], {
              cwd: box,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            }),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      expect(seed).toMatch(/^ {2}guardTraceAgeS: \d+,$/m);
      fs.writeFileSync(at, seed.replace(/^( {2}guardTraceAgeS: )(\d+),$/m, '$1"$2",'));
      const string = run();
      expect(string.code).toBe(2);
      expect(string.out).toContain("поле:    guardTraceAgeS");
      expect(string.out).toContain("ожидали: число");
      fs.writeFileSync(at, seed.replace(/^( {2}guardTraceAgeS: \d+,)$/m, "$1\n  zzUnknown: 3,"));
      const unknown = run();
      expect(unknown.code).toBe(2);
      expect(unknown.out).toContain("=== ВИД ПОЛЯ НАСТРОЙКИ НЕ ОБЪЯВЛЕН ===");
      expect(unknown.out).toContain("поле:  zzUnknown");
      // Поле, которое инструмент читает в двух видах, принимает оба: деревьев
      // исходников несколько — список, и прогон доходит до сверки деревьев.
      expect(seed).toMatch(/^ {2}src: "\.\.\/src",$/m);
      for (const rel of ["zzLib/zzLib.ts", "zzSide/zzSide.ts"]) {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), "export const zz = 1;\n");
      }
      fs.writeFileSync(at, seed.replace(/^( {2}src: )"\.\.\/src",$/m, '$1["../src", "../zzLib"],'));
      const trees = run();
      expect(trees.out).not.toContain("НАСТРОЙКА ЗАДАНА НЕВЕРНО");
      expect(trees.out).toContain("zzSide/zzSide.ts — код вне объявленных деревьев");
      fs.writeFileSync(at, seed.replace(/^( {2}src: )"\.\.\/src",$/m, '$1["../src", 3],'));
      const mixed = run();
      expect(mixed.code).toBe(2);
      expect(mixed.out).toContain("поле:    src");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("основание печати свода", () => {
  it("сосед, политика и инструмент гасят печать, не теряя ответов; протокол без основания читается как прежде", () => {
    const box = seatEmpty("bar-ground-");
    try {
      const tool = (...args) =>
        String(
          spawnSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8" },
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
          { cwd: box, encoding: "utf8" },
        );
      const zone = path.join(box, "src", "shared", "zone");
      fs.mkdirSync(zone, { recursive: true });
      fs.writeFileSync(
        path.join(zone, "a.ts"),
        'import { bee } from "./b";\nexport const aye = bee + 1;\n',
      );
      fs.writeFileSync(path.join(zone, "b.ts"), "export const bee = 1;\n");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      fs.appendFileSync(
        path.join(zone, "a.ts"),
        "export const aye2 = aye + 1;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const read = () => fs.readFileSync(protoAt, "utf8");
      const count = (word) =>
        (read().match(new RegExp("\\| " + word + " \\|", "g")) ?? []).length;
      // Страницы читают заново: слова снимаются со страниц, не с протокола.
      const reread = () =>
        fs.writeFileSync(
          protoAt,
          read()
            .split("\n")
            .map((line) => {
              const c = line.split("|");
              return c.length === 5 && /^ \d+ $/.test(c[1])
                ? "|" + c[1] + "|" + c[2] + "| |"
                : line;
            })
            .join("\n"),
        );
      const resealed = () => {
        fillBar(protoAt, { release: "не нужно: проба" });
        const out = tool("bar");
        expect(out, out).toContain("печать поставлена");
      };

      // Основание записано в шапку при печати.
      tool("bar");
      resealed();
      expect(read()).toMatch(/^- политика: `[0-9a-f]{12}`$/m);
      expect(read()).toMatch(/^- инструмент: `[0-9a-f]{12}`$/m);
      expect(read()).toMatch(
        /^- сосед: `shared\/zone\/b\.ts` `[0-9a-f]{12}`$/m,
      );
      expect(tool("bar")).toContain("печать уже стоит");

      // Сосед правлен чужим коммитом: предмет тот же, печати нет, ответы на месте.
      const clean = count("чисто");
      const absent = count("нет предмета");
      expect(clean).toBeGreaterThan(0);
      fs.writeFileSync(path.join(zone, "b.ts"), "export const bee = 2;\n");
      git("add", path.join(zone, "b.ts"));
      git("commit", "-qm", "сосед", "--no-verify");
      const moved = tool("bar");
      expect(moved, moved).toContain("протокол напечатан");
      expect(moved).toContain(
        "основание свода изменилось: соседи области: shared/zone/b.ts",
      );
      expect(moved).toContain("исходы перенесены");
      expect(moved).not.toContain("печать уже стоит");
      expect(read()).toContain("- печать: `нет`");
      expect(count("нет предмета")).toBeGreaterThanOrEqual(absent);
      expect(count("чисто")).toBeLessThan(clean);
      // Страница изменившегося соседа несёт прежнее слово — она не прочитана заново.
      fillBar(protoAt, { release: "не нужно: проба" });
      const stale = tool("bar");
      expect(stale, stale).toContain("страница");
      expect(stale).toContain("сосед `shared/zone/b.ts`");
      expect(stale).toContain("слово не сходится");
      reread();
      resealed();
      expect(tool("bar")).toContain("печать уже стоит");

      // Правка протокола при том же основании — по-прежнему «правлен».
      const sealedText = read();
      fs.appendFileSync(protoAt, "\nправка после печати\n");
      expect(tool("bar")).toContain("правлен после этого");
      fs.writeFileSync(protoAt, sealedText);

      // Политика другая: печати нет, ответы перенесены, «чисто» сброшено целиком.
      fs.appendFileSync(path.join(box, ".claude", "rules", "quality.md"), "\n");
      const policy = tool("bar");
      expect(policy, policy).toContain(
        "основание свода изменилось: политика качества",
      );
      expect(policy).toContain("политика другая");
      expect(policy).toContain("исходы перенесены");
      expect(count("чисто")).toBe(0);
      expect(count("нет предмета")).toBeGreaterThan(0);
      resealed();

      // Инструмент другой: печати нет, «чисто» не сбрасывается.
      fs.appendFileSync(path.join(box, ".claude", "tools", "graph.mjs"), "\n");
      const answered = count("чисто") + count("нет предмета");
      const changed = tool("bar");
      expect(changed, changed).toContain(
        "основание свода изменилось: инструмент",
      );
      expect(changed).not.toContain("сброшено");
      expect(count("чисто") + count("нет предмета")).toBe(answered);
      resealed();

      // Протокол без основания, начатый до него, читается как прежде.
      const stripped = read().replace(
        /^- (политика|инструмент|сосед): .*\n/gm,
        "",
      );
      const sealOf = (text) =>
        createHash("sha1")
          .update(text.replace(/^- печать: `.*`$/m, "- печать: `нет`"))
          .digest("hex")
          .slice(0, 12);
      fs.writeFileSync(
        protoAt,
        stripped.replace(
          /^- печать: `.*`$/m,
          "- печать: `" + sealOf(stripped) + "`",
        ),
      );
      expect(tool("bar")).toContain("печать уже стоит");
      fs.appendFileSync(path.join(box, ".claude", "rules", "quality.md"), "\n");
      expect(tool("bar")).toContain("печать уже стоит");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 600000);

  it("ворота перед коммитом не признают печать, поставленную при другом основании", () => {
    const box = seatEmpty("bar-ground-gate-");
    try {
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
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
      fs.writeFileSync(
        path.join(box, "src", "app", "zzGround.ts"),
        "export const zzGround = (n: number): number => n + 1;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      run("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(run("bar").stdout).toContain("печать поставлена");
      seriesStaged(box);
      expect(run("gate").status).toBe(0);
      fs.appendFileSync(path.join(box, ".claude", "rules", "quality.md"), "\n");
      const gate = run("gate");
      expect(gate.status, gate.stdout).toBe(1);
      expect(gate.stdout).toContain(
        "основание свода другое: политика качества",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("страницы чтения — файлами", () => {
  it("страница лежит файлом со словом в конце, папка сама себя игнорирует, лишние файлы снимаются, шапки правил её называют", () => {
    const box = seatEmpty("bar-pages-");
    try {
      const tool = (...args) =>
        String(
          spawnSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
            { cwd: box, encoding: "utf8" },
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
          { cwd: box, encoding: "utf8" },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "основание", "--no-verify");
      const note = path.join(box, "src", "shared", "zzNote");
      fs.mkdirSync(note, { recursive: true });
      fs.writeFileSync(
        path.join(note, "zzNote.ts"),
        "export const zzNote = 1;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "shared/zzNote");
      const dir = path.join(box, ".context", "bar-pages");
      const listed = tool("bar-read");
      expect(listed, listed).toContain("Читать инструментом Read");
      const pages = [
        ...fs
          .readFileSync(protoAt, "utf8")
          .matchAll(/^\| (\d+) \| ([^|]+) \|  \|$/gm),
      ].map((m) => m[1]);
      expect(pages.length).toBeGreaterThan(1);
      // Папка — раз, страницы — именами: абсолютный адрес у каждой был
      // повтором одной и той же папки.
      expect(listed).toContain("папка: " + dir);
      expect(listed.split(dir).length - 1).toBe(1);
      for (const n of pages) {
        const file = path.join(dir, "bar-protocol-" + n + ".md");
        expect(listed).toMatch(
          new RegExp("^  bar-protocol-" + n + "\\.md — ", "m"),
        );
        // Файл — тот же текст, что даёт `--print`, и слово в конце.
        const printed = tool("bar-read", n, "--print");
        const body = fs.readFileSync(file, "utf8");
        expect(printed).toContain(body);
        expect(body).toMatch(
          /\n--- слово страницы \d+: [а-яё]+-[а-яё]+ ---\n$/,
        );
      }
      expect(
        fs.readFileSync(path.join(dir, "bar-protocol-1.md"), "utf8"),
      ).toContain("приходят с этой страницей по шапке политики");
      // Папка выводима: git её не видит и не берёт.
      expect(
        git("status", "--porcelain", "--", ".context/bar-pages").stdout,
      ).toBe("");
      expect(
        git("check-ignore", "-q", ".context/bar-pages/bar-protocol-1.md")
          .status,
      ).toBe(0);
      // Файл страницы, которой в протоколе больше нет, снимается.
      const stale = path.join(
        dir,
        "bar-protocol-" + (pages.length + 5) + ".md",
      );
      fs.writeFileSync(stale, "старая страница\n");
      tool("bar-read", "1");
      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(path.join(dir, "bar-protocol-1.md"))).toBe(true);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("слова страниц перед сжатием контекста", () => {
  const setup = () => {
    const box = seatEmpty("bar-stale-");
    const tool = (...args) =>
      String(
        spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8" },
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
        { cwd: box, encoding: "utf8" },
      );
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "основание", "--no-verify");
    const note = path.join(box, "src", "shared", "zzWords");
    fs.mkdirSync(note, { recursive: true });
    fs.writeFileSync(
      path.join(note, "zzWords.ts"),
      "export const zzWords = 1;\n",
    );
    const protoAt = path.join(box, ".context", "bar-protocol.md");
    const words = () =>
      [
        ...fs
          .readFileSync(protoAt, "utf8")
          .matchAll(/^\| \d+ \| [^|]+ \| ([^|\s][^|]*?) \|$/gm),
      ].length;
    return { box, tool, protoAt, words };
  };

  it("слова незапечатанного протокола гасятся, исходы на месте, свод просит перечитать; запечатанный не трогается", () => {
    const { box, tool, protoAt, words } = setup();
    try {
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const before = fs.readFileSync(protoAt, "utf8");
      const filled = words();
      expect(filled).toBeGreaterThan(1);
      const clean = (before.match(/\| чисто \|/g) ?? []).length;
      expect(clean).toBeGreaterThan(0);

      const stale = tool("bar-read", "--stale");
      expect(stale, stale).toContain("погашено слов: " + filled);
      expect(words()).toBe(0);
      const after = fs.readFileSync(protoAt, "utf8");
      expect((after.match(/\| чисто \|/g) ?? []).length).toBe(clean);
      const asked = tool("bar");
      expect(asked, asked).toContain("слово не вписано — graph.mjs bar-read");
      expect(asked).not.toContain("печать поставлена");

      // Перечитали страницы — свод запечатывается; сжатие после печати её не рвёт.
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(tool("bar")).toContain("печать поставлена");
      const sealed = fs.readFileSync(protoAt, "utf8");
      const again = tool("bar-read", "--stale");
      expect(again, again).toContain("погашено слов: 0");
      expect(fs.readFileSync(protoAt, "utf8")).toBe(sealed);
      expect(tool("bar")).toContain("печать уже стоит");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("слова протоколов перехода гасятся тоже", () => {
    const { box, tool } = setup();
    try {
      withTransitionDebt(box, []);
      const dir = path.join(box, ".context", "15-transition-bar");
      fs.mkdirSync(dir, { recursive: true });
      const one = path.join(dir, "node--zzWords.md");
      const table = (seal) =>
        [
          "## Предмет",
          "",
          "- род: `на переход`",
          "- печать: `" + seal + "`",
          "",
          "## Прочитано",
          "",
          "| страница | что | слово |",
          "| --- | --- | --- |",
          "| 1 | политика: `A1`–`A5` | берег-ветер |",
          "| 2 | код `shared/zzWords/zzWords.ts`, строки 1–1 | гроза-дождь |",
          "",
          "## Исходы",
          "",
          "| A1 | x | чисто |",
          "",
        ].join("\n");
      fs.writeFileSync(one, table("нет"));
      const done = path.join(dir, "node--zzDone.md");
      fs.writeFileSync(done, table("0123456789ab"));
      const out = tool("bar-read", "--stale");
      expect(out, out).toContain("погашено слов: 2");
      const text = fs.readFileSync(one, "utf8");
      expect(text).toContain("| 1 | политика: `A1`–`A5` |  |");
      expect(text).toContain(
        "| 2 | код `shared/zzWords/zzWords.ts`, строки 1–1 |  |",
      );
      expect(text).toContain("| A1 | x | чисто |");
      expect(fs.readFileSync(done, "utf8")).toBe(table("0123456789ab"));
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);

  it("обёртка при сбое режима молчит в вывод и не держит сжатие", () => {
    const { box } = setup();
    try {
      const hook = path.join(box, ".claude", "tools", "hook.mjs");
      const event = JSON.stringify({
        hook_event_name: "PreCompact",
        trigger: "auto",
      });
      const run = () =>
        spawnSync(process.execPath, [hook, "bar-read", "--stale"], {
          cwd: box,
          encoding: "utf8",
          input: event,
        });
      expect(run().status).toBe(0);
      fs.writeFileSync(
        path.join(box, ".claude", "tools", "graph.mjs"),
        'throw new Error("сломан");\n',
      );
      const broken = run();
      expect(broken.status).toBe(0);
      expect(broken.stdout).toBe("");
      expect(broken.stderr).toContain(
        "слова страниц перед сжатием не погашены",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

describe("починки по пробе планки 2026-10-13", () => {
  const toolIn =
    (box) =>
    (...args) => {
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

  it("изменяемое модуля спрашивают `M1` и `M2`, как `C10` и `C6`", () => {
    const box = seatEmpty("modflag-");
    try {
      const tool = toolIn(box);
      fs.mkdirSync(path.join(box, "src", "app", "zzFlag"), { recursive: true });
      fs.writeFileSync(
        path.join(box, "src", "app", "zzFlag", "zzFlag.ts"),
        "let zzStarted = false;\nexport const zzStart = (run: () => void): void => {\n  if (zzStarted) return;\n  zzStarted = true;\n  run();\n};\n",
      );
      tool("bar", "app/zzFlag");
      const read = fs.readFileSync(
        path.join(box, ".context", "bar-protocol.md"),
        "utf8",
      );
      const row = /^\| (П\d+) \| модульное \|/m.exec(read)?.[1];
      expect(row).toBeDefined();
      for (const id of ["C10", "C6", "M1", "M2"])
        expect(read).toMatch(
          new RegExp(
            "^\\| " +
              id +
              " \\|[^\\n]*спрашивают: (?:[^|]*[ ,])?" +
              row +
              "(?![0-9])",
            "m",
          ),
        );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("ключи называют чтение модели одним вызовом, а дыра сверки — находку и кандидатов, которых не надо искать в протоколе", () => {
    const box = seatEmpty("keys2-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(
        path.join(box, "src", "app", "zzWide.ts"),
        "export const zzWide = (width: number, strict: boolean): boolean => (strict ? width > 1 : width > 0);\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const first = tool("bar", "app/zzWide.ts");
      const [, from, to, offset, limit] =
        /модель предмета — строки ([0-9]+)–([0-9]+) протокола: один вызов Read с offset ([0-9]+) и limit ([0-9]+)/.exec(
          first,
        ) ?? [];
      expect(offset).toBe(from);
      // Окно чтения — ровно часть «Модель предмета»: начинается с заголовка и
      // кончается перед заголовком следующей части.
      const lines = fs.readFileSync(protoAt, "utf8").split("\n");
      expect(lines[Number(offset) - 1]).toBe("## Модель предмета");
      expect(Number(offset) - 1 + Number(limit)).toBe(Number(to));
      expect(lines[Number(offset) - 1 + Number(limit)].startsWith("## ")).toBe(
        true,
      );

      fillBar(protoAt, { release: "не нужно: проба" });
      // Находка, вписанная в обход помощника, получает свою строку
      // сверки без ответа: режим спрашивает его и печатает ключ с кандидатами.
      tool("bar", "app/zzWide.ts");
      const sealed = fs
        .readFileSync(protoAt, "utf8")
        .replace(/^- печать: .*$/m, "- печать: `нет`");
      fs.writeFileSync(
        protoAt,
        sealed
          .split("\n")
          .map((line) => {
            const c = line.split("|");
            if (c.length !== 9 || c[1].trim() !== "A4") return line;
            c[4] = " нашлось ";
            c[5] = " src/app/zzWide.ts:1 ";
            c[6] = " второй довод делит функцию надвое ";
            c[7] = " вопрос ";
            return c.join("|");
          })
          .join("\n"),
      );
      // Тот же проход дописывает недостающую строку и сразу спрашивает её
      // ответ: прежде для этого был нужен второй вызов.
      const open = tool("bar", "app/zzWide.ts");
      expect(open).not.toContain("режим `bar` переписывает её сам");
      expect(open).toContain(
        "; ключ — «также » и находка дословно: A4 — `src/app/zzWide.ts:1` — кандидаты B1",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("находка называет файл каждого свидетеля с ответом «нет»", () => {
    const box = seatEmpty("witfile-");
    try {
      const tool = toolIn(box);
      const dir = path.join(box, "src", "app", "zzUni");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "zzA.ts"),
        "export const zzA = (width: number): number => width + 1;\n",
      );
      fs.writeFileSync(
        path.join(dir, "zzB.ts"),
        "export const zzB = (width: number): number => width * 2;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzUni");
      // Свидетель объявления в втором файле единицы: «служит фразе» — нет.
      const proto = fs.readFileSync(protoAt, "utf8");
      const second = /^\| (Св\d+) \| `app\/zzUni\/zzB\.ts:1` \|/m.exec(
        proto,
      )?.[1];
      expect(second).toBeDefined();
      fs.writeFileSync(
        protoAt,
        proto
          .split("\n")
          .map((line) => {
            if (!line.startsWith("| " + second + " |")) return line;
            const c = line.split("|");
            c[5] = " нет ";
            return c.join("|");
          })
          .join("\n"),
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/app/zzUni/zzA.ts` и `src/app/zzUni/zzB.ts`.\n",
      );
      const found = (what) => ({
        release: "не нужно: проба",
        pick: {
          "A1@app/zzUni":
            "нашлось | src/app/zzUni/zzA.ts:1 | " + what + " | вопрос",
        },
      });
      fillBar(protoAt, found("zzB не служит фразе"));
      const lost = tool("bar", "app/zzUni");
      expect(lost).toContain(
        "A1 для `app/zzUni`: находка не называет файл свидетеля с ответом «плохо»: " +
          second +
          " app/zzUni/zzB.ts — вписать в «ещё мест:»",
      );
      fillBar(
        protoAt,
        found("zzB не служит фразе; ещё мест: `src/app/zzUni/zzB.ts:1`"),
      );
      expect(tool("bar", "app/zzUni")).not.toContain(
        "находка не называет файл свидетеля",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("копия перед сортировкой несёт названия тестов, а «чисто» по `J9-бис` называет одно из них", () => {
    const box = seatEmpty("copytests-");
    try {
      const tool = toolIn(box);
      const dir = path.join(box, "src", "app", "zzCopy");
      fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "zzCopy.ts"),
        "export const zzOrdered = (items: number[]): number[] => [...items].sort((a, b) => a - b);\n",
      );
      fs.writeFileSync(
        path.join(dir, "tests", "zzCopy.test.ts"),
        'import { describe, expect, it } from "vitest";\n\nimport { zzOrdered } from "../zzCopy";\n\ndescribe("zzOrdered", () => {\n  it("puts the smallest first", () => {\n    expect(zzOrdered([2, 1])).toEqual([1, 2]);\n  });\n});\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzCopy");
      const row = /^\| (П\d+) \| копия \|[^\n]*$/m.exec(
        fs.readFileSync(protoAt, "utf8"),
      );
      expect(row?.[0]).toContain("; тесты файла: «puts the smallest first»");
      const answer = (what) =>
        fillBar(protoAt, {
          release: "не нужно: проба",
          pick: { "J9-бис": "чисто |  | " + what + " | " },
        });
      // Файл тестов вместо теста — не опора.
      answer(row[1] + " — инвариант держат тесты файла zzCopy.test.ts");
      expect(tool("bar", "app/zzCopy")).toContain(
        "J9-бис: чисто, а основание не называет тест, который заметит снос копии, — название из строки модели, в «ёлочках»: " +
          row[1],
      );
      // Название теста из строки — опора.
      answer(row[1] + " — тест «puts the smallest first» закрепляет порядок");
      expect(tool("bar", "app/zzCopy")).not.toContain(
        "J9-бис: чисто, а основание не называет тест",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("копия перед сортировкой в файле без тестов закрыть словом «чисто» нельзя", () => {
    const box = seatEmpty("copynotests-");
    try {
      const tool = toolIn(box);
      const dir = path.join(box, "src", "app", "zzBare");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "zzBare.ts"),
        "export const zzOrdered = (items: number[]): number[] => [...items].sort((a, b) => a - b);\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzBare");
      const row = /^\| (П\d+) \| копия \|[^\n]*$/m.exec(
        fs.readFileSync(protoAt, "utf8"),
      );
      expect(row?.[0]).toContain("; тестов, называющих файл, нет");
      // Строка «тестов нет» названа тоже: без неё режим спросил бы о ней.
      const bare = /^\| (П\d+) \| тесты \|/m.exec(
        fs.readFileSync(protoAt, "utf8"),
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "J9-бис":
            "чисто |  | " +
            row[1] +
            " — копия на месте, " +
            bare[1] +
            " — тестов нет | ",
        },
      });
      expect(tool("bar", "app/zzBare")).toContain(
        "J9-бис: чисто, а тестов, называющих файл, нет — копия ничем не закреплена: " +
          row[1],
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("вывод `bar` называет форму файла ответов, и разбор читает ту же таблицу", () => {
    const box = seatEmpty("fillforms-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(
        path.join(box, "src", "app", "zzWide.ts"),
        "export const zzWide = (width: number, strict: boolean): boolean => (strict ? width > 1 : width > 0);\n",
      );
      const printed = tool("bar", "app/zzWide.ts");
      // Форма лежит в файле ключей: вывод длиннее предела среды режется.
      const first = fs.readFileSync(
        /ключи к заполнению — файлом, открыть Read: (.+)$/m.exec(printed)[1],
        "utf8",
      );
      for (const line of [
        "стр N | слово",
        "ПN | снятие",
        "СвN | фраза | вопрос один | граница по смыслу | сочетания   (свидетель единицы)",
        "СвN | что делает | служит фразе | имя говорит | упрощает | решение по входам   (свидетель объявления)",
        "критерий@предмет | исход | адрес | что | судьба",
        "также <находка дословно> | также",
        "уровень@предмет | что на уровне | держится | опора",
        "путь файла | база | документация | чем это объяснено",
        "часть N | файлы | что",
      ])
        expect(first).toContain("  " + line);
      // Строка исхода в названной форме принимается разбором.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const copyAt = path.join(box, "copy.md");
      fs.copyFileSync(protoAt, copyAt);
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(answersAt, "B1 | нет предмета |  | проба |  \n");
      const filled = execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "bar-fill",
          answersAt,
          copyAt,
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(filled).not.toContain("отказ");
      expect(fs.readFileSync(copyAt, "utf8")).toMatch(
        /^\| B1 \| [^|]*\| [^|]*\| нет предмета \|/m,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("кандидат перекрёстной сверки берётся и из тела политики: `A6-бис` называет `A9-тер`", () => {
    const box = seatEmpty("kin-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(
        path.join(box, "src", "app", "zzWide.ts"),
        "export const zzWide = (width: number): boolean => width > 0;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzWide.ts");
      fillBar(protoAt, { release: "не нужно: проба" });
      tool("bar", "app/zzWide.ts");
      const sealed = fs
        .readFileSync(protoAt, "utf8")
        .replace(/^- печать: .*$/m, "- печать: `нет`");
      fs.writeFileSync(
        protoAt,
        sealed
          .split("\n")
          .map((line) => {
            const c = line.split("|");
            if (c.length !== 9 || c[1].trim() !== "A6-бис") return line;
            c[4] = " нашлось ";
            c[5] = " src/app/zzWide.ts:1 ";
            c[6] = " правило повторено другими словами ";
            c[7] = " вопрос ";
            return c.join("|");
          })
          .join("\n"),
      );
      tool("bar", "app/zzWide.ts");
      expect(tool("bar", "app/zzWide.ts")).toContain(
        "ключ — «также » и находка дословно: A6-бис — `src/app/zzWide.ts:1` — кандидаты A9-тер",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("`bar-fill` принимает ключ с предметом в обратных кавычках, как он стоит в таблице", () => {
    const box = seatEmpty("fillticks-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(
        path.join(box, "src", "app", "zzWide.ts"),
        "export const zzWide = (width: number): boolean => width > 0;\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzWide.ts");
      const copyAt = path.join(box, "copy.md");
      fs.copyFileSync(protoAt, copyAt);
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(
        answersAt,
        "A1@`app/zzWide.ts` | нет предмета |  | проба |  \nA10@app/zzWide.ts | нет предмета |  | проба |  \n",
      );
      const out = execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "bar-fill",
          answersAt,
          copyAt,
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(out).toContain("вписано строк: 2");
      const text = fs.readFileSync(copyAt, "utf8");
      expect(text).toMatch(
        /^\| A1 \| `app\/zzWide\.ts` \|[^|]*\| нет предмета \|/m,
      );
      expect(text).toMatch(
        /^\| A10 \| `app\/zzWide\.ts` \|[^|]*\| нет предмета \|/m,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("файл, названный дважды в одной части правки, не конфликт частей", () => {
    const box = seatEmpty("partdup-");
    try {
      const tool = toolIn(box);
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      // Две несвязанные правки — две части; с одной частью раздела нет.
      const ats = ["zzMath", "zzOther"].map((name) =>
        path.join(box, "src", "shared", name, name + ".ts"),
      );
      for (const at of ats) {
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(
          at,
          "export const zzAdd = (a: number, b: number): number => a + b;\n",
        );
      }
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      for (const at of ats)
        fs.writeFileSync(
          at,
          "export const zzAdd = (a: number, b: number): number => b + a;\n",
        );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const lines = fs.readFileSync(protoAt, "utf8").split("\n");
      const from = lines.findIndex((l) => l.startsWith("## Части правки"));
      expect(from).toBeGreaterThan(0);
      const row = lines.findIndex((l, i) => i > from && /^\| 1 \|/.test(l));
      expect(row).toBeGreaterThan(from);
      const c = lines[row].split("|");
      const first = /`[^`]+`/.exec(c[2])?.[0];
      expect(first).toBeDefined();
      c[2] = " " + c[2].trim() + ", " + first + " ";
      lines[row] = c.join("|");
      fs.writeFileSync(protoAt, lines.join("\n"));
      expect(tool("bar")).not.toContain("назван частями 1 и 1");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("после пересборки режим называет ключи снятых исходов", () => {
    const box = seatEmpty("gonekeys-");
    try {
      const tool = toolIn(box);
      const at = path.join(box, "src", "app", "zzGone.ts");
      fs.writeFileSync(
        at,
        "export const zzGone = (width: number, strict: boolean): boolean => (strict ? width > 1 : width > 0);\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzGone.ts");
      const flagRow = /^\| (П\d+) \| флаг \|/m.exec(
        fs.readFileSync(protoAt, "utf8"),
      )?.[1];
      expect(flagRow).toBeDefined();
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          B1: "чисто |  | " + flagRow + " — довод читается из вызова | ",
        },
      });
      // Строка модели, на которую ссылается ответ, исчезает вместе с флагом.
      fs.writeFileSync(
        at,
        "export const zzGone = (width: number): boolean => width > 0;\n",
      );
      const out = tool("bar", "app/zzGone.ts");
      expect(out).toMatch(
        /исходов со ссылкой на строку модели, которой больше нет, снято: \d+ — ответить заново: [^\n]*\bB1\b/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("экономия свода по журналу пробы 2026-10-13", () => {
  const toolIn =
    (box) =>
    (...args) => {
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
  const gitIn =
    (box) =>
    (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "-c",
          "core.hooksPath=",
          ...args,
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
  const wide =
    "export const zzWide = (width: number, strict: boolean): boolean => (strict ? width > 1 : width > 0);\n";

  it("дыры одного вида печатаются группой: строка вида с числом и переменные слова", () => {
    const box = seatEmpty("holegroup-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(path.join(box, "src", "app", "zzWide.ts"), wide);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzWide.ts");
      const core = [
        "A1-бис",
        "A1-тер",
        "A7-бис",
        "A10",
        "A15",
        "B2",
        "C4",
        "I2",
        "I4",
      ];
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: Object.fromEntries(core.map((id) => [id, "чисто |  | проба | "])),
      });
      const out = tool("bar", "app/zzWide.ts");
      const head =
        /чисто без опоры на модель своего уровня: назвать строку уровня … — годятся … — ([0-9]+):$/m.exec(
          out,
        );
      expect(head, out).not.toBeNull();
      expect(Number(head[1])).toBeGreaterThanOrEqual(6);
      // Каждая дыра вида — своими переменными словами, без повтора текста.
      expect(out).not.toMatch(
        /^ {4}A10 для `app\/zzWide\.ts`: чисто без опоры на модель своего уровня/m,
      );
      expect(out).toMatch(/^ {6}.*(?<![\p{L}\p{N}-])A10(?![\p{L}\p{N}-])/mu);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("легенда называет словарь клеток, а `bar-fill` считает недостающие клетки в конце строки за `=`", () => {
    const box = seatEmpty("filltail-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(path.join(box, "src", "app", "zzWide.ts"), wide);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const printed = tool("bar", "app/zzWide.ts");
      const first = fs.readFileSync(
        /ключи к заполнению — файлом, открыть Read: (.+)$/m.exec(printed)[1],
        "utf8",
      );
      for (const rule of [
        "недостающие клетки в конце строки — тоже `=`",
        "`чисто` — адрес `—`; в «что» — почему чисто, со всем, что ключ называет в скобках",
        "без пояснений после адреса",
        "строки «также» пишут тем же файлом, что исходы",
        "часть без файлов и без «что» режим снимает сам",
      ])
        expect(first).toContain(rule);
      fillBar(protoAt, { release: "не нужно: проба" });
      const answersAt = path.join(box, "answers.txt");
      const rowOf = () =>
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .find((line) => /^\| A3 \|/.test(line))
          .split("|")
          .map((c) => c.trim());
      fs.writeFileSync(answersAt, "A3 | нет предмета | — | проба-1 | =\n");
      tool("bar-fill", answersAt);
      fs.writeFileSync(answersAt, "A3 | чисто\n");
      expect(tool("bar-fill", answersAt)).toContain("=== Ответы вписаны ===");
      const row = rowOf();
      expect(row[4]).toBe("чисто");
      expect(row[5]).toBe("—");
      expect(row[6]).toBe("проба-1");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("пачечная строка ядра раскрывается на пустые исходы ядра предмета, частная строка и прежний ответ важнее, находку пачкой не ставят", () => {
    const box = seatEmpty("corebatch-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(path.join(box, "src", "app", "zzWide.ts"), wide);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzWide.ts");
      const all = barRowsCited(fs.readFileSync(protoAt, "utf8"));
      const answersAt = path.join(box, "answers.txt");
      const rowOf = (id, subject) =>
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .find((l) => l.startsWith("| " + id + " | `" + subject + "` |"))
          .split("|")
          .map((c) => c.trim());
      // Находку пачкой не ставят: отказ, протокол прежний.
      const blank = fs.readFileSync(protoAt, "utf8");
      fs.writeFileSync(answersAt, "ядро@app/zzWide.ts | нашлось | проба\n");
      expect(tool("bar-fill", answersAt)).toContain(
        "находку ставят строкой критерия",
      );
      expect(fs.readFileSync(protoAt, "utf8")).toBe(blank);
      // Прежний ответ пачка не трогает.
      fs.writeFileSync(
        answersAt,
        "A2@app/zzWide.ts | чисто | — | " + all + " прежний\n",
      );
      tool("bar-fill", answersAt);
      fs.writeFileSync(
        answersAt,
        [
          "ядро@`app/zzWide.ts` | чисто | " + all + " пачкой",
          "A10@app/zzWide.ts | чисто | — | " + all + " частная",
          "ядро@app | чисто | " + all + " пачкой слоя",
          "",
        ].join("\n"),
      );
      expect(tool("bar-fill", answersAt)).toMatch(
        /раскрыто пачечными строками ядра: [0-9]+ исходов/,
      );
      expect(rowOf("A1-бис", "app/zzWide.ts").slice(4, 7)).toEqual([
        "чисто",
        "—",
        all + " пачкой",
      ]);
      expect(rowOf("A10", "app/zzWide.ts")[6]).toBe(all + " частная");
      expect(rowOf("A2", "app/zzWide.ts")[6]).toBe(all + " прежний");
      expect(rowOf("A5", "app")[6]).toBe(all + " пачкой слоя");
      fillBar(protoAt, { release: "не нужно: проба" });
      const out = tool("bar", "app/zzWide.ts");
      expect(out).toContain("печать поставлена");
      const same =
        /из них одним основанием на несколько критериев предмета: ([0-9]+)/.exec(
          out,
        );
      expect(same, out).not.toBeNull();
      expect(Number(same[1])).toBeGreaterThan(1);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("пачечная строка ядра без строки модели своего уровня получает тот же отказ, что ручная", () => {
    const box = seatEmpty("corebatchbare-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(path.join(box, "src", "app", "zzWide.ts"), wide);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzWide.ts");
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(
        answersAt,
        "ядро@app/zzWide.ts | чисто | проба без опоры\n",
      );
      tool("bar-fill", answersAt);
      fillBar(protoAt, { release: "не нужно: проба" });
      const out = tool("bar", "app/zzWide.ts");
      expect(out).not.toContain("печать поставлена");
      expect(out).toContain("чисто без опоры на модель своего уровня");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("ключи называют все требования приёма: пачечная строка, назвавшая всё из скобок, принята с первого круга", () => {
    const box = seatEmpty("corebatchkeys-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(path.join(box, "src", "app", "zzWide.ts"), wide);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const printed = tool("bar", "app/zzWide.ts");
      const first = fs.readFileSync(
        /ключи к заполнению — файлом, открыть Read: (.+)$/m.exec(printed)[1],
        "utf8",
      );
      const keys = /^- исходы `app\/zzWide\.ts`(.*)$/m.exec(first);
      expect(keys, first).not.toBeNull();
      // Свидетель единицы и строка своего уровня — сразу, а не следующим
      // отказом; строка уровня, общая для критериев, — раз на предмет.
      expect(keys[1]).toMatch(/A1 \([^)]*Св[0-9]+/);
      expect(keys[1]).toMatch(
        /^ \(где не сказано иначе — строка уровня, одна из: П[0-9]+/,
      );
      const named = [
        ...new Set(keys[1].match(/(?:П|Св)[0-9]+(?:–Св[0-9]+)?/g)),
      ];
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(
        answersAt,
        "ядро@app/zzWide.ts | чисто | по ключам: " + named.join(", ") + "\n",
      );
      tool("bar-fill", answersAt);
      fillBar(protoAt, { release: "не нужно: проба" });
      const out = tool("bar", "app/zzWide.ts");
      expect(out).not.toMatch(/для `app\/zzWide\.ts`: чисто без опоры/);
      expect(out).not.toMatch(/для `app\/zzWide\.ts`: чисто, а /);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("строки «также» вписываются тем же файлом, что исходы; ответ о находке, которой нет, снимается и называется", () => {
    const box = seatEmpty("crossfill-");
    try {
      const tool = toolIn(box);
      fs.writeFileSync(path.join(box, "src", "app", "zzWide.ts"), wide);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "app/zzWide.ts");
      fillBar(protoAt, { release: "не нужно: проба" });
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(
        answersAt,
        [
          "A4 | нашлось | src/app/zzWide.ts:1 | второй довод делит функцию надвое | вопрос",
          "также A4 — `src/app/zzWide.ts:1` | не B1",
          "также A4 — `src/app/zzWide.ts:9` | не B1",
          "",
        ].join("\n"),
      );
      expect(tool("bar-fill", answersAt)).toContain(
        "из них «также» о находках, которых в таблице ещё нет: 2",
      );
      const out = tool("bar", "app/zzWide.ts");
      expect(out).not.toContain("таблица не сходится");
      expect(out).not.toContain("находок с пустой графой «также»");
      expect(out).not.toContain("кандидаты без ответа");
      expect(out).toContain(
        "ответ «также» о находке, которой нет, снят: «также A4 — `src/app/zzWide.ts:9`»",
      );
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        /^\| A4 — `src\/app\/zzWide\.ts:1` \| [^|]*надвое[^|]* \| B1 \| не B1 \|$/m,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("часть без файлов и без «что» снимается сама, оставшиеся нумеруются заново", () => {
    const box = seatEmpty("partprune-");
    try {
      const tool = toolIn(box);
      const git = gitIn(box);
      const ats = ["zzMath", "zzOther"].map((name) =>
        path.join(box, "src", "shared", name, name + ".ts"),
      );
      for (const at of ats) {
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(
          at,
          "export const zzAdd = (a: number, b: number): number => a + b;\n",
        );
      }
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      for (const at of ats)
        fs.writeFileSync(
          at,
          "export const zzAdd = (a: number, b: number): number => b + a;\n",
        );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const ticked = (n) =>
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .find((l) => new RegExp("^\\| " + n + " \\| `").test(l))
          .split("|")[2]
          .trim();
      const all = ticked(1) + ", " + ticked(2);
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(
        answersAt,
        "часть 1 | " + all + " | обе правки\nчасть 2 | — | —\n",
      );
      tool("bar-fill", answersAt);
      const out = tool("bar");
      expect(out).not.toContain("часть 2 пуста");
      const lines = fs.readFileSync(protoAt, "utf8").split("\n");
      const from = lines.indexOf("## Части правки");
      const rows = lines.slice(from + 1).filter((l) => /^\| [0-9]+ \|/.test(l));
      expect(rows.length).toBe(1);
      expect(rows[0]).toContain("обе правки");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("страница кода называет правленые и снятые строки над текстом, и слово страницы от них не зависит", () => {
    const box = seatEmpty("pagediff-");
    try {
      const tool = toolIn(box);
      const git = gitIn(box);
      const at = path.join(box, "src", "shared", "zzLine", "zzLine.ts");
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(
        at,
        "export const zzA = 1;\nexport const zzB = 2;\nexport const zzC = 3;\n",
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      fs.writeFileSync(at, "export const zzA = 1;\nexport const zzB = 20;\n");
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const n = /^\| ([0-9]+) \| код `[^`]*zzLine\.ts`/m.exec(
        fs.readFileSync(protoAt, "utf8"),
      )?.[1];
      expect(n).toBeDefined();
      const before = tool("bar-read", n, "--print");
      expect(before).toContain("правлено этой работой: строки 2");
      expect(before).toContain(
        "снято после строки 1:\n  - export const zzB = 2;\n  - export const zzC = 3;",
      );
      const wordOf = (text) =>
        /--- слово страницы [0-9]+: (\S+) ---/.exec(text)?.[1];
      git("add", "-A");
      git("commit", "-qm", "правка", "--no-verify");
      const after = tool("bar-read", n, "--print");
      expect(after).not.toContain("правлено этой работой");
      expect(wordOf(after)).toBe(wordOf(before));
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("страница печатает раздел `code.md`, на который ссылается тело критерия, а шапка `code.md` страниц не называет", () => {
    const box = seatEmpty("codesec-");
    try {
      const tool = toolIn(box);
      const head = (name) =>
        fs
          .readFileSync(path.join(box, ".claude", "rules", name), "utf8")
          .split("\n---")[0];
      expect(head("code.md")).not.toContain("bar-pages");
      expect(head("quality.md")).toContain("**/bar-pages/*.md");
      fs.writeFileSync(path.join(box, "src", "app", "zzWide.ts"), wide);
      tool("bar", "app/zzWide.ts");
      const pages = tool("bar-read", "--print");
      for (const piece of [
        "Раздел `code.md` «Раскладка проекта» — на него ссылается тело критерия",
        "### Куда кладут новый узел",
        "Раздел `code.md` «Комментарии: минимум, и по делу» — на него ссылается тело критерия",
        "### Вход: четыре вопроса, и нужен да на все",
      ])
        expect(pages).toContain(piece);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("расход сессии свода: режим `bar-probe --cost`", () => {
  const record = (id, ctx, parts) =>
    JSON.stringify({
      type: "assistant",
      message: {
        id,
        usage: {
          input_tokens: ctx,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 1,
        },
        content: parts,
      },
    });
  const journal = [
    record("m1", 1000, [
      {
        type: "tool_use",
        id: "t1",
        name: "Read",
        input: { file_path: "/p/.context/bar-protocol.md" },
      },
    ]),
    record("m2", 1500, [{ type: "text", text: "готово" }]),
  ].join("\n");
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [TOOL, "bar-probe", "--cost", ...args], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      env: { ...process.env, ...env },
    });

  it("журнал по пути: печатает обращения, перечитывание и строку для замеров, код ноль", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "cost-"));
    try {
      const at = path.join(box, "j.jsonl");
      fs.writeFileSync(at, journal);
      const said = run([at]);
      expect(said.status).toBe(0);
      expect(said.stdout).toContain("осмотрено обращений журнала: 2");
      expect(said.stdout).toContain("перечитывание: 2 500 токенов контекста");
      expect(said.stdout).toContain(
        "чтений протокола (Read и срезы оболочкой): 1",
      );
      expect(said.stdout).toContain(
        "`2` обращений, перечитывание `2 500` токенов",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });

  it("журнал по номеру сессии ищется в папке журналов; нет журнала или нет обращений — код один", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "cost-"));
    try {
      const dir = path.join(box, "projects", "-some-sandbox");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "abc-123.jsonl"), journal);
      fs.writeFileSync(path.join(dir, "empty.jsonl"), '{"type":"user"}\n');
      const env = { CLAUDE_CONFIG_DIR: box };
      const found = run(["--session=abc-123"], env);
      expect(found.status).toBe(0);
      expect(found.stdout).toContain("осмотрено обращений журнала: 2");
      const missing = run(["--session=zzz"], env);
      expect(missing.status).toBe(1);
      expect(missing.stdout).toContain("Журнал не найден");
      const empty = run(["--session=empty"], env);
      expect(empty.status).toBe(1);
      expect(empty.stdout).toContain("нет ни одного обращения модели");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

describe("git без репозитория не шумит в отчёте режима", () => {
  it("отметки серии в папке без git читаются как пустые, и stderr чист", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "nogit-"));
    try {
      const series = path.join(TOOL_DIR, "graph.series.mjs");
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { readMarks } from ${JSON.stringify(series)};` +
            "console.log(JSON.stringify(readMarks(process.argv[1])));",
          box,
        ],
        {
          encoding: "utf8",
          cwd: box,
          env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(box) },
        },
      );
      expect(run.status).toBe(0);
      expect(run.stdout.trim()).toBe('{"base":null,"trees":{}}');
      expect(run.stderr).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

/**
 * Матрица читателей прозы: свойства, которыми обязана обладать каждая сверка,
 * читающая прозу базы, правил и полки. Прежде каждое свойство чинилось у одного
 * читателя, до которого доходила проба, и класс возвращался с соседним: восемь
 * находок «образец в ограде — не запись» за четыре прогона проб. Здесь свойство
 * спрашивается сразу у всех сверок и во всех видах прозы, и новая сверка
 * попадает под него сама.
 */
describe("матрица читателей прозы", () => {
  const reds = (box) =>
    new Set(
      [...verifyIn(box)].flatMap(([section, lines]) =>
        lines.map((line) => section + " | " + line),
      ),
    );
  const added = (before, after) => [...after].filter((r) => !before.has(r));
  // Имя собрано из частей: целиком в тексте теста оно считалось бы живым.
  const ghost = ["zzAbsent", "Nowhere"].join("");
  // Образец форм, каждая из которых вне ограды краснит свою сверку.
  const SAMPLE = [
    "ПОТОМ разобрать.",
    "В проекте 42 файла.",
    "Это анкер окна.",
    "См. раздел «Нет такого раздела».",
    "Держит это сверка «Такой сверки нет».",
    "Гарантия REQ-9 обещана.",
    "Имя `" + ghost + "` и константа `NO_SUCH_CONSTANT`.",
    "Файл `src/ghost/none.ts` и [документ](docs/ghost-none.md).",
    "Узел `src/app/App.tsx:3` без цитаты.",
    "## Вопрос 5: образец",
    "- `?` гипотеза без проверки",
    "Держится: ничем",
    "| `src/ghost/none.ts` | призрак | нет | нет |",
  ].join("\n");
  // Сверки, для которых ограда — предмет, а не образец: бюджет доктрины
  // считает знаки файла целиком, и любая добавленная строка его двигает.
  const RAW = ["Доктрина в бюджете"];
  const KINDS = [
    ".context/10-idioms.md",
    ".context/05-flows.md",
    ".context/07-invariants.md",
    ".context/00-map.md",
    "CLAUDE.md",
    ".claude/rules/code.md",
    ".claude/rules/entry.md",
    ".claude/rationale/loop.md",
    ".claude/seat/seat.md",
    ".claude/tools/graph.md",
    ".claude/README.md",
    ".claude/skills/audit/SKILL.md",
  ];
  const boxWithGit = (prefix) => {
    const box = seatEmpty(prefix);
    const git = (...args) =>
      spawnSync(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@l",
          "-c",
          "core.hooksPath=",
          ...args,
        ],
        { cwd: box, encoding: "utf8" },
      );
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "посадка", "--no-verify");
    return box;
  };

  // Формы ограды по CommonMark. Закрывает ограду строка того же знака, не
  // короче открывающей и без текста после: каждая форма ниже ломала чтение,
  // которое считало любую строку из трёх знаков переключателем.
  const FENCES = {
    "три кавычки": (s) => "```\n" + s + "\n```",
    "три тильды": (s) => "~~~\n" + s + "\n~~~",
    "ограда в пункте списка": (s) =>
      "- пункт\n\n  ```\n" +
      s
        .split("\n")
        .map((l) => "  " + l)
        .join("\n") +
      "\n  ```",
    "четыре кавычки с тремя внутри": (s) => "````md\n```\n" + s + "\n```\n````",
    "тильды внутри кавычек": (s) => "```\n~~~\n" + s + "\n~~~\n```",
    "строка с языком внутри ограды": (s) => "```\n```md\n" + s + "\n```",
  };

  it("образец в ограде кода не краснит ни одной сверки ни в одном виде прозы и ни в одной форме ограды, а вне ограды краснит", () => {
    const box = boxWithGit("matrix-fence-");
    try {
      const before = reds(box);
      // Все формы ограды — одним прогоном на вид прозы, а за ними часовой без
      // ограды: его красное обязано стоять. Форма, которая по ошибке длится до
      // конца файла, прячет часового, и пропажа видна; утечка — лишняя строка.
      // Шестьдесят шесть прогонов сверки стоили `158` с, одиннадцать — шестую часть.
      const sentinel = "Часовой: сверка «Часового нет»";
      const fenced = Object.values(FENCES)
        .map((fence) => fence(SAMPLE))
        .join("\n\n");
      const unexpected = [];
      for (const rel of KINDS) {
        const at = path.join(box, rel);
        const clean = fs.readFileSync(at, "utf8");
        fs.writeFileSync(at, clean + "\n" + fenced + "\n\n" + sentinel + "\n");
        const now = added(before, reds(box)).filter(
          (red) => !RAW.some((name) => red.startsWith(name + " | ")),
        );
        const watch = now.filter((red) => red.includes("«Часового нет»"));
        if (watch.length !== 1)
          unexpected.push(rel + ": часовой краснеет " + watch.length + " раз");
        for (const red of now)
          if (!red.includes("«Часового нет»"))
            unexpected.push(rel + " → " + red);
        fs.writeFileSync(at, clean);
      }
      expect(unexpected).toEqual([]);
      // Образец настоящий: вне ограды он краснит, и не одну сверку.
      const at = path.join(box, ".context", "10-idioms.md");
      fs.appendFileSync(at, "\n" + SAMPLE + "\n");
      const sections = new Set(
        added(before, reds(box)).map((red) => red.split(" | ")[0]),
      );
      expect(sections.size).toBeGreaterThanOrEqual(8);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 900000);

  it("проза в CRLF называется сверкой концов строк, а другие читатели её не роняют", () => {
    const box = boxWithGit("matrix-crlf-");
    try {
      const before = reds(box);
      const prose = (dir) =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const full = path.join(dir, e.name);
          if (e.isDirectory())
            return e.name === ".git" || e.name === "node_modules"
              ? []
              : prose(full);
          return e.name.endsWith(".md") ? [full] : [];
        });
      for (const at of prose(box))
        fs.writeFileSync(
          at,
          fs.readFileSync(at, "utf8").replace(/\r?\n/g, "\r\n"),
        );
      const sections = new Set(
        added(before, reds(box)).map((red) => red.split(" | ")[0]),
      );
      // Рецепты краснеют по делу: якорь рецепта записан с LF, и в семени
      // с CRLF его не найти.
      expect([...sections].sort()).toEqual(
        [
          "Концы строк рабочего дерева сходятся с объявленными",
          "Рецепт находит место в свежей посадке",
        ].sort(),
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("незакрытая ограда называется своей сверкой, и образец под ней не краснит других", () => {
    const box = seatEmpty("matrix-open-");
    try {
      const before = reds(box);
      const at = path.join(box, ".context", "10-idioms.md");
      const clean = fs.readFileSync(at, "utf8");
      // Вторая форма закрыта короче, чем открыта: по CommonMark это не
      // закрытие, и ограда длится до конца файла.
      for (const open of ["```\n" + SAMPLE, "````\n" + SAMPLE + "\n```"]) {
        fs.writeFileSync(at, clean + "\n" + open + "\n");
        const sections = new Set(
          added(before, reds(box)).map((red) => red.split(" | ")[0]),
        );
        expect([...sections], open.slice(0, 4)).toEqual([
          "Ограда кода в прозе закрыта",
        ]);
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("имя в «ёлочках», перенесённое на следующую строку, читается ссылками на разделы и на сверки", () => {
    const box = seatEmpty("matrix-wrap-");
    try {
      const at = path.join(box, ".context", "10-idioms.md");
      const clean = fs.readFileSync(at, "utf8");
      for (const [said, section] of [
        ["См. раздел\n«Нет такого раздела».", "Ссылки на разделы"],
        ["См. раздел «Нет такого\nраздела».", "Ссылки на разделы"],
        [
          "Держит сверка\n«Такой сверки нет».",
          "Имя сверки в тексте есть среди сверок",
        ],
        [
          "Держит сверка «Такой\nсверки нет».",
          "Имя сверки в тексте есть среди сверок",
        ],
      ]) {
        fs.writeFileSync(at, clean + "\n" + said + "\n");
        expect(verifyIn(box).get(section), said).toEqual([
          expect.stringMatching(/Нет такого раздела|Такой сверки нет/),
        ]);
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("объявленная таблица, которой не нашли под её шапкой, называется, а не печатает ноль", () => {
    const box = seatEmpty("matrix-tables-");
    try {
      const cfg = fs.readFileSync(
        path.join(box, ".context", "graph.config.mjs"),
        "utf8",
      );
      // Объявленные шапки берутся из настройки, а не списком в тесте:
      // новая таблица попадает сюда сама. Файл шапки ищется среди прозы,
      // которую сверки читают; шапки, которой в свежей посадке нет, не спрашивают.
      const headings = [
        ...cfg.matchAll(
          /^\s+(?:heading|memoHeading|listHeading|orderHeading):\s*\n?\s*"([^"]+)",/gm,
        ),
      ].map((m) => m[1]);
      const files = [
        ".context/01-facts.md",
        ".context/05-flows.md",
        ".context/07-invariants.md",
        ".context/16-findings.md",
        ".claude/tools/checks.md",
        ".claude/rules/entry.md",
        ".claude/rules/base.md",
        ".claude/skills/README.md",
      ];
      const before = reds(box);
      const blind = [];
      let asked = 0;
      for (const heading of [...headings, "## Файлы"])
        for (const rel of files) {
          const at = path.join(box, rel);
          const clean = fs.readFileSync(at, "utf8");
          const line = clean
            .split("\n")
            .find((l) => l.trim() === heading.trim());
          if (line === undefined) continue;
          asked += 1;
          const renamed = line.startsWith("|")
            ? line.replace("| ", "| Иное ")
            : line + " иначе";
          fs.writeFileSync(at, clean.replace(line, renamed));
          if (added(before, reds(box)).length === 0)
            blind.push(rel + ": " + heading);
          fs.writeFileSync(at, clean);
        }
      expect(blind).toEqual([]);
      expect(asked).toBeGreaterThanOrEqual(8);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 900000);
});

describe("посадка не снимает строк проекта из его настроек среды", () => {
  it("пока стоит флаг посадки, снятые запрет, разрешение и свой крючок проекта названы; после — снимать законно", () => {
    const box = seatEmpty("seat-keeps-settings-");
    const git = (...args) =>
      spawnSync(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@l",
          "-c",
          "core.hooksPath=",
          ...args,
        ],
        { cwd: box, encoding: "utf8" },
      );
    try {
      const at = path.join(box, ".claude", "settings.json");
      const seed = fs.readFileSync(at, "utf8");
      const own = JSON.parse(seed);
      own.permissions.deny.push("Bash(terraform destroy *)");
      own.permissions.allow.push("Bash(make preview *)");
      own.hooks.Notification = [
        {
          hooks: [{ type: "command", command: "notify-send", args: ["done"] }],
        },
      ];
      fs.writeFileSync(at, JSON.stringify(own, null, 2) + "\n");
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "проект со своими настройками", "--no-verify");
      const lost = () => verifyIn(box).get("Разрешения среды") ?? [];
      expect(lost()).toEqual([]);
      // Слияние, которое положило семя поверх файла проекта.
      fs.writeFileSync(at, seed);
      expect(lost()).toEqual([
        expect.stringMatching(/^deny: Bash\(terraform destroy \*\) — было/),
        expect.stringMatching(/^allow: Bash\(make preview \*\) — было/),
        expect.stringMatching(
          /^крючок Notification: notify-send done — был в файле/,
        ),
      ]);
      // Посадка закончена — строку снимает разработчик, и это законно.
      const cfg = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfg,
        fs.readFileSync(cfg, "utf8").replace("seating: 1,", "seating: 0,"),
      );
      expect(lost()).toEqual([]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("испорченный реестр мутаций", () => {
  it("называется сверкой, режим замеров встаёт на нём и не переписывает его", () => {
    const box = seatEmpty("spoiled-ledger-");
    try {
      const at = path.join(box, ".context", "mutation-ledger.json");
      // Обрубленная запись: так выглядит прерванный прогон.
      const torn =
        '{\n  "src/app/App.tsx": { "killed": 4, "alive": 1, "hash": "ab';
      fs.writeFileSync(at, torn);
      expect(verifyIn(box).get("Файл, написанный обвязкой, читается")).toEqual([
        expect.stringMatching(
          /^mutation-ledger\.json — не разбирается как JSON: .*Вернуть из истории git/,
        ),
      ]);
      const run = spawnSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "mutated"],
        { cwd: box, encoding: "utf8" },
      );
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("Реестр мутационных замеров не читается");
      expect(fs.readFileSync(at, "utf8")).toBe(torn);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("сверка версий в чистом клоне", () => {
  it("называет неустановленные пакеты и не числит их осмотренными", () => {
    const box = seatEmpty("no-packages-");
    try {
      const run = spawnSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "verify", "--full"],
        { cwd: box, encoding: "utf8" },
      );
      const head = run.stdout.split(
        "=== Версии установленного (предупреждение, прогон не роняет) ===",
      )[1];
      const looked =
        /осмотрено установленных из объявленных версий: (\d+)/.exec(head);
      const missing = /не установлено, не сравнивалось: (\d+) — /.exec(head);
      expect(missing).not.toBeNull();
      // Объявленные версии — строки блока `verifiedVersions` настройки.
      const declared = fs
        .readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8")
        .match(/verifiedVersions: \{([^}]*)\}/)[1]
        .split("\n")
        .filter((line) => /^\s*["'\w@/.-]+["']?:/.test(line)).length;
      expect(Number(looked[1]) + Number(missing[1])).toBe(declared);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("снимок внутри репозитория", () => {
  it("собирается: проверочная посадка не видит чужой истории git", () => {
    const box = seatEmpty("handoff-inside-");
    const git = (...args) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@l", ...args], {
        cwd: box,
        encoding: "utf8",
      });
    try {
      git("init", "-q");
      git("config", "core.hooksPath", ".claude/hooks/git");
      git("add", "-A");
      git("commit", "-qm", "посадка", "--no-verify");
      const run = spawnSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "handoff",
          path.join(box, "snap"),
        ],
        { cwd: box, encoding: "utf8" },
      );
      expect(run.stdout).not.toContain("СНИМОК НЕ СОБРАН");
      expect(run.status).toBe(0);
      expect(fs.existsSync(path.join(box, "snap", ".claude"))).toBe(true);
      expect(fs.existsSync(path.join(box, "snap", ".проба-посадки"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("снимок без временной папки", () => {
  it("не собран, назван причиной и удалён, а не оставлен непроверенным", () => {
    const box = seatEmpty("handoff-no-tmp-");
    try {
      const snap = path.join(box, "snap");
      const run = spawnSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "handoff", snap],
        {
          cwd: box,
          encoding: "utf8",
          env: { ...process.env, TMPDIR: path.join(box, "нет-такой-папки") },
        },
      );
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("СНИМОК НЕ СОБРАН");
      expect(run.stdout).toContain("временная папка системы недоступна");
      expect(fs.existsSync(snap)).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("форматтер проекта в форме CommonJS", () => {
  it("сверка семян берёт его целиком и называет неряшливое семя, а не ошибку загрузки", () => {
    const box = seatEmpty("prettier-cjs-");
    try {
      // Заглушка повторяет форму `prettier` 2: загрузчик распознаёт из неё
      // одно имя `format`, а `resolveConfig` есть только у `default`.
      const pkg = path.join(box, "node_modules", "prettier");
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({
          name: "prettier",
          version: "2.8.8",
          main: "index.js",
        }),
      );
      fs.writeFileSync(
        path.join(pkg, "index.js"),
        [
          "const api = {",
          "  resolveConfig: async () => null,",
          '  check: (source) => !source.includes("   ="),',
          "  format: (source) => source,",
          "};",
          "module.exports = api;",
          "module.exports.format = api.format;",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(box, ".claude", "seat", "templates", "zzRough.ts.seed"),
        "export const zzRough   =    1",
      );
      expect(verifyIn(box).get("Семена приезжают отформатированными")).toEqual([
        expect.stringMatching(
          /^\.claude\/seat\/templates\/zzRough\.ts\.seed — в проекте/,
        ),
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("временную папку системы берут через один помощник", () => {
  it("код инструмента зовёт tmpdir() только в systemTemp, а негодную папку помощник называет", async () => {
    // Обёртка хуков — исключение: она пишет файл, а не заводит песочницу, и
    // запись у неё уже под перехватом с названной причиной.
    const own = new Set(["graph.seat.mjs", "hook.mjs"]);
    const strays = fs
      .readdirSync(TOOL_DIR)
      .filter(
        (n) =>
          n.endsWith(".mjs") &&
          !n.includes(".test.") &&
          !n.startsWith("graph.modes.") &&
          !own.has(n),
      )
      .flatMap((n) =>
        fs
          .readFileSync(path.join(TOOL_DIR, n), "utf8")
          .split("\n")
          .map((line, i) => [n + ":" + (i + 1), line])
          .filter(([, line]) => /\btmpdir\(\)/.test(line))
          .map(([at]) => at),
      );
    expect(strays).toEqual([]);
    const { systemTemp } = await import("./graph.seat.mjs");
    const was = process.env.TMPDIR;
    const notDir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "tmp-")),
      "file",
    );
    fs.writeFileSync(notDir, "");
    try {
      process.env.TMPDIR = notDir;
      expect(() => systemTemp()).toThrow(
        new RegExp(
          "временная папка системы недоступна: " +
            notDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            ".*TMPDIR",
        ),
      );
    } finally {
      if (was === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = was;
      fs.rmSync(path.dirname(notDir), { recursive: true, force: true });
    }
    expect(systemTemp()).toBe(os.tmpdir());
  });
});

describe("песочница пробы планки занимается, а не стирается", () => {
  it("занятый номер обходится, чужая песочница с тем же номером цела", () => {
    const box = seatEmpty("probaclaim-");
    // Номера — время в миллисекундах: сторожа занимают ближайшие секунды,
    // как их занял бы параллельный запуск.
    const from = Number(String(Date.now()).slice(-8));
    const guards = [];
    const made = [];
    try {
      for (let k = 0; k < 20000; k += 1) {
        const at = path.join(os.tmpdir(), "bar-probe-" + (from + k));
        if (fs.existsSync(at)) continue;
        fs.mkdirSync(at);
        fs.writeFileSync(path.join(at, "чужое"), "");
        guards.push(at);
      }
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      fs.writeFileSync(
        probes,
        JSON.stringify({
          plants: [
            {
              criterion: "H7",
              why: "проба номера",
              into: [{ text: "export const zzNarrow = () => 1;" }],
            },
          ],
          covers: [{ text: "export const zzShield = () => 1;" }],
        }),
      );
      let out = "";
      try {
        out = execFileSync(
          process.execPath,
          [
            path.join(box, ".claude", "tools", "graph.mjs"),
            "bar-probe",
            "--existing",
            "--seed=1",
          ],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (e) {
        out = String(e.stdout ?? "");
      }
      const sandbox = /песочница: (.+)/.exec(out)?.[1]?.trim();
      const id = /bar-probe (\d+)/.exec(out)?.[1];
      expect(sandbox, out).toBeDefined();
      made.push(
        sandbox,
        path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json"),
      );
      expect(guards).not.toContain(sandbox);
      expect(
        guards.filter((at) => !fs.existsSync(path.join(at, "чужое"))),
      ).toEqual([]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      for (const one of [...guards, ...made])
        fs.rmSync(one, { recursive: true, force: true });
    }
  }, 300000);
});

/**
 * Песочницу прогона занимают, а не стирают: falsify, bar-probe и серия брали
 * её под одним и тем же либо угадываемым именем, и два запуска стирали друг
 * другу папку посреди работы. Механизм один — его и бьём всеми случаями.
 */
describe("песочницу прогона занимают одним помощником", () => {
  it("занятое обходит, чужое не стирает, снятого родителя заводит заново", async () => {
    const { claimSandbox } = await import("./graph.seat.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claim-"));
    try {
      const parent = path.join(root, "sandboxes");
      const from = 1000;
      fs.mkdirSync(parent);
      for (let k = 0; k < 50; k += 1) {
        fs.mkdirSync(path.join(parent, "p-" + (from + k)));
        fs.writeFileSync(path.join(parent, "p-" + (from + k), "чужое"), "1");
      }
      const first = claimSandbox(parent, "p-", from);
      const second = claimSandbox(parent, "p-", from);
      expect(first.at).not.toBe(second.at);
      expect(Number(first.id)).toBe(from + 50);
      expect(Number(second.id)).toBe(from + 51);
      expect(fs.readdirSync(first.at)).toEqual([]);
      for (let k = 0; k < 50; k += 1)
        expect(
          fs.existsSync(path.join(parent, "p-" + (from + k), "чужое")),
        ).toBe(true);
      const gone = path.join(root, "removed");
      const third = claimSandbox(gone, "");
      expect(path.dirname(third.at)).toBe(gone);
      expect(fs.statSync(third.at).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * Сравнение версий записано один раз: копий было четыре, и направление не
 * держала ни одна проверка — перевёрнутое, оно пропускало старую машину с
 * «годится». Бьём помощник таблицей случаев и режим среды — обеими сторонами.
 */
describe("версии сравнивает один помощник, и направление закреплено", () => {
  it("ниже, равно, выше, короткая форма, приставка, хвост; связка — внутри блока", async () => {
    const { versionCmp, verifiedOf } = await import("./graph.seat.mjs");
    const sign = (a, b, depth) => Math.sign(versionCmp(a, b, depth));
    expect(sign("22.22.2", "22.23.2")).toBe(-1);
    expect(sign("22.23.2", "22.23.2")).toBe(0);
    expect(sign("23.0.0", "22.23.2")).toBe(1);
    expect(sign("10.9.7", "11.0.0")).toBe(-1);
    expect(sign("v22", "22.0.0")).toBe(0);
    expect(sign("11.0.0-pre", "11.0.0")).toBe(0);
    expect(sign("11.0.1-pre", "11.0.0")).toBe(1);
    expect(sign("22", "22.23.2", 1)).toBe(0);
    expect(sign("21", "22.23.2", 1)).toBe(-1);
    expect(
      verifiedOf(
        'x\n  verifiedVersions: {\n    npm: "11.0.0",\n    "react-dom": "19.3.0",\n  },\n  other: {\n    node: "1.0.0",\n  },\n',
      ),
    ).toEqual({ npm: "11.0.0", "react-dom": "19.3.0" });
  });

  it("режим среды: связка выше машины — остановка, ниже — годится", () => {
    const box = seatEmpty("env-dir-");
    try {
      const seed = path.join(
        box,
        ".claude",
        "seat",
        "templates",
        "graph.config.mjs",
      );
      const text = fs.readFileSync(seed, "utf8");
      const envWith = (node, npm) => {
        fs.writeFileSync(
          seed,
          text
            .replace(/(\n {4}node: ")[^"]+"/, `$1${node}"`)
            .replace(/(\n {4}npm: ")[^"]+"/, `$1${npm}"`),
        );
        return spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "env"],
          { cwd: box, encoding: "utf8" },
        );
      };
      const above = envWith(
        Number(process.versions.node.split(".")[0]) + 1 + ".0.0",
        "999.0.0",
      );
      expect(above.status, above.stdout).toBe(1);
      expect(above.stdout).toContain("Посадка не начата");
      const below = envWith("1.0.0", "1.0.0");
      expect(below.status, below.stdout).toBe(0);
      expect(below.stdout).toContain("годится: сажать можно");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

/**
 * Внешняя команда запускается одним помощником: места без поправки на
 * Windows не находили `npm.cmd` и бинарники пакетов, а не запустившаяся
 * команда печатала «код 1» с пустым журналом либо падала на сложении
 * `undefined`. Бьём помощник и держим, что мимо него запусков нет.
 */
describe("внешнюю команду запускает один помощник", () => {
  it("мимо него зовут только git и сам node", () => {
    const strays = [];
    for (const name of fs.readdirSync(TOOL_DIR)) {
      if (!name.endsWith(".mjs") || name.includes(".test.")) continue;
      if (name.startsWith("graph.modes.")) continue;
      const text = fs.readFileSync(path.join(TOOL_DIR, name), "utf8");
      for (const m of text.matchAll(
        /\b(spawnSync|execFileSync|execSync)\(\s*([^,)]+)/g,
      )) {
        const first = m[2].trim();
        if (first === '"git"' || first === "process.execPath") continue;
        if (m[1] === "execSync" && first.startsWith('"git ')) continue;
        // сам помощник
        if (name === "graph.seat.mjs" && first === "command") continue;
        strays.push(name + ": " + m[1] + "(" + first + ")");
      }
    }
    expect(strays).toEqual([]);
  });

  it("на win32 идёт через оболочку, не запустившаяся называет причину", async () => {
    const { runTool } = await import("./graph.seat.mjs");
    // Через оболочку `$HOME` раскрывается, без неё приходит как есть.
    const home = { env: { ...process.env, HOME: "/zz-home" } };
    expect(runTool("echo", ["$HOME"], home, "win32").stdout.trim()).toBe(
      "/zz-home",
    );
    expect(runTool("echo", ["$HOME"], home, "linux").stdout.trim()).toBe(
      "$HOME",
    );
    const none = runTool("zz-no-such-tool", ["x"]);
    expect(none.status).toBe(null);
    expect(none.error).toContain("zz-no-such-tool");
    expect(none.error).toContain("ENOENT");
    expect(none.out).toBe("");
  });
});
