import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { bareCodeOf } from "./graph.predicates.mjs";
import { stepsOutline } from "./graph.steps.mjs";
import {
  TOOL_DIR,
  seatEmpty,
  withTransitionDebt,
  verifyIn,
  sectionOf,
  fillBar,
  mutationMeasured,
  crossFilled,
} from "./graph.modes.shared.mjs";

// Тесты режимов, часть 2 из 3: файлы делят набор, чтобы он шёл параллельно.

// Своя заготовка «нет предмета» переносилась из прежнего протокола и тогда,
// когда следующая правка принесла предмет: строка оставалась закрытой
// причиной, которая больше не верна. Найдено ревьюером пачки проб.
describe("заготовка «нет предмета» не переживает правку, принёсшую предмет", () => {
  it("лист без кода, затем код к нему: строки о коде открыты заново", () => {
    const box = seatEmpty("net-predmeta-");
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
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const bar = () => {
        try {
          execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), "bar"],
            {
              cwd: box,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
        } catch {
          // Отказ печати — законный ответ: скелет протокола уже лежит.
        }
        return fs.readFileSync(
          path.join(box, ".context", "bar-protocol.md"),
          "utf8",
        );
      };
      const unitRows = (proto) =>
        proto
          .split("\n")
          .filter(
            (l) =>
              l.startsWith("| B1 | — |") &&
              l.includes("файла кода в предмете правки нет"),
          );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      const dir = path.join(box, "src", "components", "ZzBox");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "ZzBox.module.css"),
        ".box {\n  color: red;\n}\n",
      );
      expect(unitRows(bar()).length).toBeGreaterThan(0);
      fs.writeFileSync(
        path.join(dir, "ZzBox.tsx"),
        'import own from "./ZzBox.module.css";\n\nexport function ZzBox() {\n  return <div className={own.box} />;\n}\n',
      );
      expect(unitRows(bar())).toEqual([]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("свод на правке — по той же области, что разбор; новое — с каталогом проекта", () => {
  it("соседи по графу и по имени, их факты и записи; новый файл и новое состояние сверяют с каталогом", () => {
    const box = seatEmpty("oblast-");
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
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      // Лежащее до правки: общий слой берёт из приложения — против правила;
      // ключ хранилища — общая константа, её берёт и индикатор.
      put("src/app/zzTitle.ts", 'export const ZZ_TITLE = "t";\n');
      put("src/shared/zzKeys/zzKeys.ts", 'export const ZZ_COUNT_KEY = "zz.count";\n');
      put(
        "src/shared/zzStore/zzStore.ts",
        'import { ZZ_TITLE } from "../../app/zzTitle";\nimport { ZZ_COUNT_KEY } from "../zzKeys/zzKeys";\n\nexport const zzSave = (v: number): void => {\n  window.localStorage.setItem(ZZ_COUNT_KEY, ZZ_TITLE + v);\n};\n',
      );
      put(
        "src/components/ZzMeter/ZzMeter.tsx",
        'import { ZZ_COUNT_KEY } from "../../shared/zzKeys/zzKeys";\n\nexport function ZzMeter() {\n  return <span>{ZZ_COUNT_KEY}</span>;\n}\n',
      );
      const stateAt = path.join(box, ".context", "04-state.md");
      fs.copyFileSync(path.join(box, ".claude", "seat", "templates", "04-state.md"), stateAt);
      fs.writeFileSync(
        stateAt,
        fs
          .readFileSync(stateAt, "utf8")
          .replace(
            "| --- | --- | --- | --- | --- |\n",
            "| --- | --- | --- | --- | --- |\n" +
              "| счёт в хранилище | `src/shared/zzStore/zzStore.ts` | `src/shared/zzStore/zzStore.ts` | `src/components/ZzMeter/ZzMeter.tsx` | сеанс |\n" +
              "| заголовок окна | `src/app/zzTitle.ts` | `src/app/zzTitle.ts` | — | сеанс |\n",
          ),
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      // Правка: новый счётчик со своим состоянием берёт хранилище и ключ.
      put(
        "src/components/ZzCounter/ZzCounter.tsx",
        'import { useState } from "react";\nimport { ZZ_COUNT_KEY } from "../../shared/zzKeys/zzKeys";\nimport { zzSave } from "../../shared/zzStore/zzStore";\n\nexport function ZzCounter() {\n  const [n, setN] = useState(0);\n  const add = () => {\n    setN(n + 1);\n    zzSave(n + 1);\n  };\n  return (\n    <button title={ZZ_COUNT_KEY} onClick={add}>\n      {n}\n    </button>\n  );\n}\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      expect(tool("bar")).toContain("соседей в области: 3");
      const proto = fs.readFileSync(protoAt, "utf8");
      // Отпечатки — одно правленое: их сверяют ворота перед коммитом.
      const head = proto.split("## Прочитано")[0].split("## Модель предмета")[0];
      const marksTable = head.slice(head.indexOf("| файл | отпечаток |"));
      expect(marksTable).toContain("| `components/ZzCounter/ZzCounter.tsx` |");
      expect(marksTable).not.toContain("zzStore.ts");
      // Соседи стоят в основании, не в отпечатках предмета.
      expect(head).toMatch(
        /^- сосед: `shared\/zzStore\/zzStore\.ts` `[0-9a-f]{12}`$/m,
      );
      // Соседи — своим предметом ядра узла и слоя.
      expect(proto).toContain("| A1 | `соседи` |");
      expect(proto).toContain("| A5 | `соседи` |");
      // Партнёр по имени-константе — сосед, хоть импорта между ними нет.
      expect(proto).toMatch(
        /\| сосед \| `components\/ZzMeter\/ZzMeter\.tsx` \| делит с components\/ZzCounter\/ZzCounter\.tsx имя ZZ_COUNT_KEY/,
      );
      // Факт соседа, который машина видит сама: ребро против правила.
      expect(proto).toMatch(
        /\| П\d+ \| направление \| `shared\/zzStore\/zzStore\.ts` \|[^\n]*\|  \| против правила \|/,
      );
      // База и документация — строка на каждый файл области.
      for (const f of [
        "components/ZzCounter/ZzCounter.tsx",
        "components/ZzMeter/ZzMeter.tsx",
        "shared/zzKeys/zzKeys.ts",
        "shared/zzStore/zzStore.ts",
      ])
        expect(proto).toMatch(
          new RegExp("^\\| `" + f.replace(/[/.]/g, "\\$&") + "` \\|  \\|  \\|  \\|$", "m"),
        );
      // Каталог: новый файл — единицы его слоя; новое состояние — источники
      // проекта, которых модель ещё не показала.
      expect(proto).toMatch(/\| каталог \| `components\/ZzMeter` \|[^\n]*\| слой \|/);
      expect(proto).toMatch(
        /\| каталог \| `\.context\/04-state\.md` \| «заголовок окна»[^\n]*\| источники \|/,
      );
      expect(proto).not.toMatch(/\| каталог \|[^\n]*«счёт в хранилище»/);

      // Прилежное «чисто» по всем строкам: ребро соседа против правила
      // печати не даёт — область читают целиком.
      fillBar(protoAt, { release: "не нужно: проба" });
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(
        /A5 для `соседи`: чисто, а ребро идёт против правила направления: П\d+/,
      );

      // Сверено с соседями по графу, а каталог не назван — мало.
      fs.rmSync(protoAt);
      tool("bar");
      const fresh = fs.readFileSync(protoAt, "utf8");
      const idsOf = (...sorts) =>
        fresh
          .split("\n")
          .filter((l) => /^\| П\d+ \|/.test(l) && sorts.includes(l.split("|")[2].trim()))
          .map((l) => l.split("|")[1].trim())
          .join(", ");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "A6-бис": "чисто |  | сверено с соседями " + idsOf("сосед") + " | ",
          A6: "чисто |  | сверено с источниками " + idsOf("источник", "состояние") + " | ",
        },
      });
      const narrow = tool("bar");
      expect(narrow).toMatch(
        /A6-бис: чисто, а правка завела новый файл, а единицы его слоя в основании не названы[^:]*: П\d+/,
      );
      expect(narrow).toMatch(
        /A6: чисто, а правка завела новое, а каталог источников проекта в основании не назван[^:]*: П\d+/,
      );

      // Честный свод: каталог назван, факт соседа вынесен вопросом, новое
      // состояние записано — без записи сверка его владельца красна, и
      // «чисто» о владельце печати не получает. У теста «база не требуется»
      // законно, когда его называет реестр тестов: в карте своей строки у
      // теста нет и быть не может.
      fs.writeFileSync(
        stateAt,
        fs
          .readFileSync(stateAt, "utf8")
          .replace(
            "| --- | --- | --- | --- | --- |\n",
            "| --- | --- | --- | --- | --- |\n" +
              "| счёт кнопки | `src/components/ZzCounter/ZzCounter.tsx` | `src/components/ZzCounter/ZzCounter.tsx` | — | экран |\n",
          ),
      );
      put(
        "src/components/ZzCounter/tests/ZzCounter.test.tsx",
        'import { ZzCounter } from "../ZzCounter";\n\nexport const zzProbe = ZzCounter;\n',
      );
      mutationMeasured(box);
      fs.rmSync(protoAt);
      tool("bar");
      const testRow = "| `components/ZzCounter/tests/ZzCounter.test.tsx` |  |  |  |";
      expect(fs.readFileSync(protoAt, "utf8")).toContain(testRow);
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .replace(
            testRow,
            "| `components/ZzCounter/tests/ZzCounter.test.tsx` | не требуется | не требуется | тест описан реестром |",
          ),
      );
      fs.appendFileSync(
        path.join(box, ".context", "13-questions.md"),
        "\nВопрос о `src/shared/zzStore/zzStore.ts`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { "слой@соседи": "нет" },
        pick: {
          "A5@соседи": "нашлось | src/shared/zzStore/zzStore.ts:1 | общее берёт из приложения | вопрос",
        },
      });
      expect(tool("bar")).toContain(
        "ZzCounter.test.tsx, база: `не требуется` у теста без своей записи в реестре тестов",
      );
      fs.appendFileSync(
        path.join(box, ".context", "08-tests.md"),
        "\n| `src/components/ZzCounter/tests/ZzCounter.test.tsx` | проба |\n",
      );
      const sealed = tool("bar");
      expect(sealed).toContain("печать поставлена");
      expect(sealed).toContain("слой `соседи` — не держится");
      // Сверка прогона ждёт те же строки, что и режим: протокол без строк о
      // соседях, запечатанный в обход режима, она не принимает.
      const barSection = () =>
        tool("verify").split("=== Планка пройдена покритериально ===")[1].split("\n===")[0];
      expect(barSection()).toContain("свод закрыт печатью");
      const blank = fs
        .readFileSync(protoAt, "utf8")
        .split("\n")
        .filter((l) => !/^\| [^|]+ \| `соседи` \| /.test(l) || /^\| (узел|слой) \|/.test(l))
        .join("\n")
        .replace(/^- печать: `.*`$/m, "- печать: `нет`");
      const forged = createHash("sha1").update(blank).digest("hex").slice(0, 12);
      fs.writeFileSync(protoAt, blank.replace("- печать: `нет`", "- печать: `" + forged + "`"));
      expect(barSection()).toMatch(
        /протокол не принят: [^\n]*строки исходов не те: недостаёт [1-9][0-9]* из [0-9]+, лишних 0 — [^\n]*для `соседи`/,
      );

      // Разбор берёт ту же область: партнёр по имени в ней есть.
      tool("bar", "components/ZzMeter");
      const read = fs.readFileSync(protoAt, "utf8").split("## Модель предмета")[0];
      expect(read).toContain("| `components/ZzCounter/ZzCounter.tsx` |");
      expect(read).toContain("| `shared/zzStore/zzStore.ts` |");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("потребитель за областью — строкой радиуса и вопросом о совместимости", () => {
    const box = seatEmpty("radius-");
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
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      // Цепочка: помощник ← показ ← экран. Тест есть у показа, у экрана нет.
      put("src/shared/zzFmt/zzFmt.ts", "export const zzFmt = (n: number): string => String(n);\n");
      put(
        "src/components/ZzShow/ZzShow.tsx",
        'import { zzFmt } from "../../shared/zzFmt/zzFmt";\n\nexport function ZzShow({ n }: { n: number }) {\n  return <span>{zzFmt(n)}</span>;\n}\n',
      );
      put(
        "src/components/ZzShow/tests/ZzShow.test.tsx",
        'import { ZzShow } from "../ZzShow";\n\nexport const zzProbe = ZzShow;\n',
      );
      put(
        "src/app/zzScreen.tsx",
        'import { ZzShow } from "../components/ZzShow/ZzShow";\n\nexport function ZzScreen() {\n  return <ZzShow n={1} />;\n}\n',
      );
      // Второй потребитель за областью — с тестом через него: строка обязана
      // их различать, а не говорить «теста нет» обо всех.
      put(
        "src/app/zzOther.tsx",
        'import { ZzShow } from "../components/ZzShow/ZzShow";\n\nexport function ZzOther() {\n  return <ZzShow n={2} />;\n}\n',
      );
      put(
        "src/app/tests/zzOther.test.tsx",
        'import { ZzOther } from "../zzOther";\n\nexport const zzOtherProbe = ZzOther;\n',
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Правка глубокого помощника: оба экрана за областью, тест есть через один.
      // Новый файл, который помощник берёт, своей строки не несёт: каждый его
      // потребитель — правленый либо новый, и их радиус уже назван.
      put("src/shared/zzFmt/zzPad.ts", 'export const zzPad = (s: string): string => s.padStart(4, " ");\n');
      put(
        "src/shared/zzFmt/zzFmt.ts",
        'import { zzPad } from "./zzPad";\n\nexport const zzFmt = (n: number): string => zzPad(n.toFixed(1));\n',
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const first = fs.readFileSync(protoAt, "utf8");
      expect(first).toContain(
        "| радиус | `shared/zzFmt/zzFmt.ts` | за областью потребителей `2`, без теста через них `1`: app/zzOther.tsx — тест app/tests/zzOther.test.tsx; app/zzScreen.tsx — теста через него нет |  | без теста |",
      );
      expect(first.match(/\| радиус \|/g)).toHaveLength(1);
      // О совместимости молчать нельзя: ни «чисто» мимо радиуса, ни «нет предмета».
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "J9-тер": "чисто |  | поведение то же | " },
      });
      expect(tool("bar")).toMatch(
        /J9-тер: чисто, а за областью есть потребители правленого узла[^:]*: П\d+/,
      );
      fs.rmSync(protoAt);
      tool("bar");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "J9-тер": "нет предмета |  | тестов не трогали | " },
      });
      expect(tool("bar")).toMatch(/J9-тер: нет предмета, а в модели он есть: П\d+/);
      mutationMeasured(box);
      fs.rmSync(protoAt);
      tool("bar");
      const radiusId = /\| (П\d+) \| радиус \|/.exec(fs.readFileSync(protoAt, "utf8"))[1];
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          "J9-тер": "чисто |  | " + radiusId + ": экран показывает ту же строку показа, её держит тест показа | ",
        },
      });
      expect(tool("bar")).toContain("печать поставлена");

      // Тест есть через каждого потребителя за областью — пометки нет.
      put(
        "src/app/tests/zzScreen.test.tsx",
        'import { ZzScreen } from "../zzScreen";\n\nexport const zzScreenProbe = ZzScreen;\n',
      );
      git("add", "-A");
      git("commit", "-qm", "тест экрана", "--no-verify");
      put(
        "src/shared/zzFmt/zzFmt.ts",
        'import { zzPad } from "./zzPad";\n\nexport const zzFmt = (n: number): string => zzPad(n.toFixed(2));\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      expect(fs.readFileSync(protoAt, "utf8")).toContain(
        "| радиус | `shared/zzFmt/zzFmt.ts` | за областью потребителей `2`, без теста через них `0`: app/zzOther.tsx — тест app/tests/zzOther.test.tsx; app/zzScreen.tsx — тест app/tests/zzScreen.test.tsx |  |  |",
      );

      // Потребителей больше, чем строка называет поимённо: голова — по имени,
      // прочие числом.
      for (let i = 1; i <= 8; i += 1)
        put(
          "src/app/zzS" + i + ".tsx",
          'import { ZzShow } from "../components/ZzShow/ZzShow";\n\nexport function ZzS' + i + "() {\n  return <ZzShow n={" + i + "} />;\n}\n",
        );
      git("add", "-A");
      git("commit", "-qm", "экраны", "--no-verify");
      put(
        "src/shared/zzFmt/zzFmt.ts",
        'import { zzPad } from "./zzPad";\n\nexport const zzFmt = (n: number): string => zzPad(n.toFixed(3));\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      const wide = /\| радиус \| `shared\/zzFmt\/zzFmt\.ts` \| ([^|]*) \|/.exec(fs.readFileSync(protoAt, "utf8"))[1];
      expect(wide).toMatch(/^за областью потребителей `10`, без теста через них `8`: /);
      expect(wide.split("; ")).toHaveLength(9);
      expect(wide).toMatch(/; и ещё `2`$/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("партнёр по строке таблицы связей — в области, в модели и в досье", () => {
    const box = seatEmpty("links-");
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
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      // Атрибут и переменную ставит показ, читает панель — ни импорта, ни
      // общей константы между ними нет. Адрес строки берётся от корня
      // репозитория либо от корня исходников — здесь обе формы.
      put(
        "src/components/ZzShow/ZzShow.tsx",
        'export function ZzShow({ n }: { n: number }) {\n  return (\n    <span data-zz-open="1" style={{ "--zz-tone": "red" }}>\n      {n}\n    </span>\n  );\n}\n',
      );
      put(
        "src/components/ZzPanel/ZzPanel.tsx",
        'export function ZzPanel() {\n  return <div>{document.querySelector("[data-zz-open]") ? "open" : "closed"}</div>;\n}\n',
      );
      put("src/components/ZzPanel/ZzPanel.module.css", ".zzPanel {\n  color: var(--zz-tone);\n}\n");
      const graphAt = path.join(box, ".context", "03-graph.md");
      fs.writeFileSync(
        graphAt,
        fs
          .readFileSync(graphAt, "utf8")
          .replace(
            "| Атрибут | Кто ставит | Кто читает |\n| --- | --- | --- |\n",
            "| Атрибут | Кто ставит | Кто читает |\n| --- | --- | --- |\n| `data-zz-open` | `src/components/ZzShow/ZzShow.tsx` | `src/components/ZzPanel/ZzPanel.tsx` |\n",
          )
          .replace(
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n",
            "| Переменная | Кто ставит | Кто читает |\n| --- | --- | --- |\n| `--zz-tone` | `components/ZzShow/ZzShow.tsx` | `components/ZzPanel/ZzPanel.module.css` |\n",
          ),
      );
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs
          .readFileSync(cfgAt, "utf8")
          .replace(
            "  domTables: null,",
            '  domTables: { file: "03-graph.md", headings: ["| Атрибут | Кто ставит | Кто читает |", "| Переменная | Кто ставит | Кто читает |"] },',
          ),
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");

      // Разбор показа: партнёры по записанной связи — в области и в модели.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzShow");
      const read = fs.readFileSync(protoAt, "utf8");
      const head = read.split("## Модель предмета")[0];
      expect(head).toContain("| `components/ZzPanel/ZzPanel.tsx` |");
      expect(head).toContain("| `components/ZzPanel/ZzPanel.module.css` |");
      expect(read).toMatch(
        /\| сосед \| `components\/ZzPanel\/ZzPanel\.tsx` \| связан с components\/ZzShow\/ZzShow\.tsx строкой таблицы связей/,
      );
      // Правку сверяют по той же области: оба конца — строками таблицы «база
      // и документация»; шапка предмета на правке — одно правленое.
      put(
        "src/components/ZzShow/ZzShow.tsx",
        'export function ZzShow({ n }: { n: number }) {\n  return (\n    <span data-zz-open="1" style={{ "--zz-tone": "blue" }}>\n      {n}\n    </span>\n  );\n}\n',
      );
      fs.rmSync(protoAt);
      tool("bar");
      const change = fs.readFileSync(protoAt, "utf8");
      for (const f of ["components/ZzPanel/ZzPanel.tsx", "components/ZzPanel/ZzPanel.module.css"])
        expect(change).toMatch(
          new RegExp("^\\| `" + f.replace(/[/.]/g, "\\$&") + "` \\|  \\|  \\|  \\|$", "m"),
        );
      // Досье называет их с обеих сторон: у кода и у листа стилей.
      expect(tool("brief", "components/ZzShow/ZzShow.tsx")).toMatch(
        /--- связаны записью таблицы связей[^\n]*\n {2}components\/ZzPanel\/ZzPanel\.module\.css\n {2}components\/ZzPanel\/ZzPanel\.tsx/,
      );
      expect(tool("brief", "components/ZzPanel/ZzPanel.module.css")).toMatch(
        /--- связаны записью таблицы связей ---\n {2}components\/ZzShow\/ZzShow\.tsx/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("признаки, видимые текстом, в модели свода", () => {
  it("строка на признак, вопрос по номеру, пустой перехват режет сам", () => {
    const box = seatEmpty("symptom-");
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
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      put(
        "src/shared/zzStore/zzStore.ts",
        "export const zzItems: string[] = [];\nexport const zzConfig = { size: 0 };\nlet zzHits = 0;\nexport const zzBump = () => {\n  zzHits += 1;\n  return zzHits;\n};\nconst zzWatchers: (() => void)[] = [];\nexport const zzWatch = (f: () => void): void => {\n  zzWatchers.push(f);\n};\n",
      );
      put(
        "src/shared/zzFormat/zzFormat.ts",
        'export const zzDate = (d: Date) => d.toISOString();\nexport const zzMoney = (n: number) => n.toFixed(2) + " $";\n',
      );
      put("src/shared/zzOnly/zzOnly.ts", "export const zzOnly = () => 'one';\n");
      // Сеттер значения флагом не является: булево там — само значение.
      put(
        "src/shared/zzMode/zzMode.ts",
        "export function setZzMode(on: boolean) {\n  return on;\n}\nexport const zzUse = () => setZzMode(true);\n",
      );
      put(
        "src/components/ZzClock/ZzClock.tsx",
        [
          'import { useState } from "react";',
          'import { zzItems, zzConfig } from "../../shared/zzStore/zzStore";',
          'import { zzDate } from "../../shared/zzFormat/zzFormat";',
          'import { zzOnly } from "../../shared/zzOnly/zzOnly";',
          "",
          "export function zzRender(fast: boolean, label = false) {",
          '  return fast ? "f" : label ? "l" : "s";',
          "}",
          "",
          "export function useZzClock() {",
          "  const [open, setOpen] = useState(false);",
          "  const [busy, setBusy] = useState(false);",
          '  zzItems.push("x");',
          "  zzConfig.size = 5;",
          "  const delayMs = 300;",
          "  setTimeout(() => setBusy(!busy), delayMs * 4);",
          "  try {",
          "    zzOnly();",
          "  } catch {",
          "    // nothing to do",
          "  }",
          '  fetch("/x").catch(() => {});',
          "  zzRender(true);",
          "  zzDate(new Date(0));",
          '  const text = "42 items";',
          "  return [open, busy, setOpen, text];",
          "}",
          "",
        ].join("\n"),
      );
      put(
        "src/components/ZzClock/types.ts",
        "export type ZzClockProps = {\n  a: boolean;\n  b?: boolean;\n  c: boolean;\n};\n",
      );
      // Параметр на своей строке: место признака — его строка, а не строка
      // выше, где кончился предыдущий.
      put(
        "src/components/ZzClock/zzWide.ts",
        "export const zzWide = (\n  width: number,\n  strict: boolean,\n): boolean => (strict ? width > 1 : width > 0);\n",
      );
      put(
        "src/components/ZzPrice/ZzPrice.tsx",
        'import { zzMoney } from "../../shared/zzFormat/zzFormat";\nexport const zzPrice = () => zzMoney(3);\nexport const ZzTag = () => <i tabIndex={7} />;\n',
      );

      // Разбор папки часов: строка на признак, места по номерам строк.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzClock");
      const read = fs.readFileSync(protoAt, "utf8");
      const row = (sort, what, mark = "") =>
        new RegExp(
          "^\\| П\\d+ \\| " +
            sort +
            " \\| `[^`]+` \\| " +
            what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            " \\| [^|]* \\| " +
            mark +
            " \\|",
          "m",
        );
      expect(read).toContain("### Единица");
      // Число под именем, в строке и ноль-единица-двойка вопросом не являются:
      // из всех чисел файла осталось одно — множитель без имени.
      expect(read).toMatch(row("число", "числа без имени: строка 16 `4`"));
      expect(read).toMatch(
        row("флаг", "булев параметр либо довод: строка 6 `fast`, строка 6 `label`, строка 23 `zzRender(…)`"),
      );
      expect(read).toMatch(
        row("флаг", "булев параметр либо довод: строка 3 `strict`"),
      );
      expect(read).toMatch(
        row(
          "перехват",
          "пустой перехват: строка 19 `catch`, строка 22 `.catch`",
          "пустой",
        ),
      );
      expect(read).toMatch(row("кортеж", "ответ кортежем: строка 26 `4`"));
      expect(read).toMatch(
        row("мутация", "меняет взятое импортом: строка 13 `zzItems.push(`, строка 14 `zzConfig.size=`"),
      );
      expect(read).toMatch(row("флаги", "булевых полей состояния `2`: строка 11, строка 12", "состояние"));
      expect(read).toMatch(row("флаги", "булевых полей в типах `3`: строка 2, строка 3, строка 4", "вход"));

      // Признаки места и состояние модуля — у своих адресов.
      expect(tool("levels", "shared/zzFormat/zzFormat.ts")).toContain(
        "порознь: потребители берут непересекающиеся части: components/ZzClock — zzDate; components/ZzPrice — zzMoney",
      );
      expect(tool("levels", "shared/zzOnly/zzOnly.ts")).toContain(
        "место: общий узел, а берёт его одна единица переноса: components/ZzClock",
      );
      // Атрибут разметки называет число так же, как ключ объекта.
      expect(tool("levels", "components/ZzPrice/ZzPrice.tsx")).toContain(
        "число: числа без имени: строка 2 3 — components/ZzPrice/ZzPrice.tsx:2",
      );
      const mode = tool("levels", "shared/zzMode/zzMode.ts");
      expect(mode).toContain("флаг: булев параметр либо довод: строка 1 on");
      expect(mode).not.toContain("setZzMode(…)");
      const store = tool("levels", "shared/zzStore/zzStore.ts");
      expect(store).toContain("модульное: изменяемое на уровне модуля: строка 3 zzHits");
      // Тип со стрелкой не прячет контейнер модуля.
      expect(store).toMatch(/модульное: изменяемое на уровне модуля: [^\n]*строка 8 zzWatchers/);

      // Беспредметность по признаку ложна.
      const asked = ["H7", "B1", "A4", "E1", "B4", "C8", "B8"];
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: Object.fromEntries(asked.map((id) => [id, "нет предмета |  | проба | "])),
      });
      const holes = tool("bar", "components/ZzClock");
      // Дыра — своей строкой либо в группе вида: строка вида и под ней
      // критерий с номерами строк модели.
      for (const id of asked)
        expect(holes).toMatch(
          new RegExp(
            "^ {4}" +
              id +
              ": нет предмета, а в модели он есть: П\\d+|^ {6}(?:.*; )?" +
              id +
              " П\\d+",
            "m",
          ),
        );
      if (!/^ {4}H7: нет предмета/m.test(holes))
        expect(holes).toMatch(/^ {4}…: нет предмета, а в модели он есть: … — \d+:$/m);
      const ids = (sort) =>
        [...read.matchAll(new RegExp("^\\| (П\\d+) \\| " + sort + " \\|", "gm"))].map((m) => m[1]);
      const say = (sort, why) => ids(sort).join(", ") + " — " + why;
      const pick = {
        H7: "чисто |  | " + say("число", "множитель задержки, проба") + " | ",
        B1: "чисто |  | " + say("флаг", "проба") + " | ",
        A4: "чисто |  | " + say("флаг", "проба") + " | ",
        E1: "чисто |  | " + say("перехват", "проба") + " | ",
        B4: "чисто |  | " + say("кортеж", "проба") + " | ",
        C8: "чисто |  | " + say("флаги", "проба") + " | ",
        B8: "чисто |  | " + say("флаги", "проба") + " | ",
      };
      fs.writeFileSync(
        protoAt,
        fs
          .readFileSync(protoAt, "utf8")
          .split("\n")
          .map((line) => {
            const c = line.split("|");
            const id = (c[1] ?? "").trim();
            return c.length === 9 && pick[id] !== undefined
              ? "| " + id + " | " + c[2].trim() + " | x | " + pick[id] + " |"
              : line;
          })
          .join("\n"),
      );
      // Пустой перехват — приговор: основание его не отменяет.
      expect(tool("bar", "components/ZzClock")).toMatch(/^ {4}E1: чисто, а перехват пустой: П\d+$/m);
      const spot = "`src/components/ZzClock/ZzClock.tsx:19`";
      fs.writeFileSync(
        protoAt,
        crossFilled(
          fs
            .readFileSync(protoAt, "utf8")
            .split("\n")
            .map((line) =>
              line.startsWith("| E1 |")
                ? "| E1 | — | x | нашлось | " + spot + " | ошибка проглочена | предложено |"
                : line,
            )
            .join("\n"),
          box,
        ),
      );
      const sealed = tool("bar", "components/ZzClock");
      expect(sealed).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("ссылки на строки модели при пересборке", () => {
  it("перенесённый ответ ссылается на ту же строку по её новому номеру", () => {
    const box = seatEmpty("renum-");
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
      const dir = path.join(box, "src", "app", "zzRen");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "zzB.ts"),
        "export const zzB = (w: number, strict: boolean): number => (strict ? w : 0);\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const first = tool("bar", "app/zzRen");
      // Ключи к заполнению — файлом рядом со страницами, сжато: протокол
      // целиком ради них не читают, а длинный вывод среда режет посередине.
      // В выводе — окно модели и путь к файлу; номера строк модели ведут на
      // её заголовок.
      const keysAt = /ключи к заполнению — файлом, открыть Read: (.+)$/m.exec(
        first,
      )?.[1];
      expect(keysAt, first).toBeDefined();
      const keys = fs.readFileSync(keysAt, "utf8");
      expect(keys).toMatch(/^- исходы без предмета[^\n]*\bB1 \(П[0-9]+\)/m);
      // Строка единицы ждёт ответа, хотя часть клеток машина поставила.
      expect(keys).toMatch(
        /^- свидетели: Св[0-9]+ `app\/zzRen`;[^\n]*Св[0-9]+ `app\/zzRen\/zzB\.ts:1` `zzB`/m,
      );
      expect(keys).toMatch(/^- база и документация: app\/zzRen\/zzB\.ts$/m);
      expect(keys).not.toContain("Булев аргумент");
      expect(first).not.toContain("исходы без предмета");
      const [, modelFrom] =
        /модель предмета — строки ([0-9]+)–/.exec(first) ?? [];
      expect(
        fs.readFileSync(protoAt, "utf8").split("\n")[Number(modelFrom) - 1],
      ).toBe("## Модель предмета");
      // Ключи из блока принимает `bar-fill` как есть — на копии протокола.
      const copyAt = path.join(box, "copy.md");
      fs.copyFileSync(protoAt, copyAt);
      const answersAt = path.join(box, "answers.txt");
      fs.writeFileSync(
        answersAt,
        "B1 | нет предмета |  | проба |  \n" +
          "app/zzRen/zzB.ts | не требуется | не требуется | проба\n",
      );
      execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "bar-fill",
          answersAt,
          copyAt,
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(fs.readFileSync(copyAt, "utf8")).toMatch(
        /^\| `app\/zzRen\/zzB\.ts` \| не требуется \| не требуется \| проба \|$/m,
      );
      const idOf = (text) =>
        /^\| (П[0-9]+) \| флаг \| `app\/zzRen\/zzB\.ts:1` \|/m.exec(text)?.[1];
      const before = idOf(fs.readFileSync(protoAt, "utf8"));
      expect(before).toBeDefined();
      // Строка исхода называет строки модели, которые спрашивают её
      // критерий: «чисто» без них печать не примет.
      const asks = (text, id) =>
        new RegExp(
          "^\\| B1 \\| [^|]*\\| [^|]*спрашивают: (?:[^|]*[ ,])?" +
            id +
            "(?![0-9])",
          "m",
        ).test(text);
      expect(asks(fs.readFileSync(protoAt, "utf8"), before)).toBe(true);
      // Строк модели у B5 нет, а свидетель, которого «чисто» обязано назвать,
      // есть: подсказка называет и его.
      expect(fs.readFileSync(protoAt, "utf8")).not.toMatch(
        /^\| B5 \| [^|]*\| [^|]*спрашивают: [^|]*П[0-9]/m,
      );
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        /^\| B5 \| [^|]*\| [^|]*спрашивают: Св[0-9]+/m,
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: {
          B5:
            "нашлось | src/app/zzRen/zzB.ts:1 | имя не говорит, что считают (" +
            before +
            ") | вопрос",
        },
      });
      // Файл раньше по порядку: его строка флага встаёт перед прежней.
      fs.writeFileSync(
        path.join(dir, "zzA.ts"),
        "export const zzA = (n: number, loose: boolean): number => (loose ? n : 0);\n",
      );
      tool("bar", "app/zzRen");
      const text = fs.readFileSync(protoAt, "utf8");
      const after = idOf(text);
      expect(after).toBeDefined();
      expect(after).not.toBe(before);
      expect(asks(text, after)).toBe(true);
      expect(text).toMatch(
        new RegExp(
          "^\\| B5 \\|.*имя не говорит, что считают \\(" + after + "\\)",
          "m",
        ),
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

describe("свидетели в своде по планке", () => {
  // Обобщённая стрелка — функция со входами, а объект из булевых полей даёт
  // сочетания: автоответа у них нет.
  it("обобщённая стрелка и булевы поля объекта спрашиваются, а не отвечаются инструментом", () => {
    const box = seatEmpty("witness-generic-");
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
      const at = path.join(box, "src", "shared", "zzReq", "zzReq.ts");
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(
        at,
        [
          "export const zzOldest = <T extends { at: number }>(items: T[], limit: number): T[] =>",
          "  [...items].sort((a, b) => a.at - b.at).slice(0, limit);",
          "export const zzRequest = () => ({",
          "  isIdle: true,",
          "  isLoading: false,",
          "  isError: false,",
          "  isDone: false,",
          "});",
          "",
        ].join("\n"),
      );
      tool("bar", "shared/zzReq");
      const read = fs.readFileSync(
        path.join(box, ".context", "bar-protocol.md"),
        "utf8",
      );
      expect(read).toMatch(
        /^\| Св1 \| `shared\/zzReq` \| [^|]+ \|  \|  \|  \|  \|$/m,
      );
      expect(read).toContain(
        "| Св2 | `shared/zzReq/zzReq.ts:1` | `zzOldest` |  |  |  |  |  |",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("фраза единицы, ответ по объявлению, вердикт по ответу", () => {
    const box = seatEmpty("witness-");
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
      const at = path.join(box, "src", "components", "ZzCard", "ZzCard.tsx");
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(
        at,
        [
          "export function zzActive(isVisible: boolean, isDisabled: boolean) {",
          "  return isVisible && !isDisabled;",
          "}",
          "export const ZZ_LIMIT = 10;",
          "export function ZzCard({ title, count }: { title: string; count: number }) {",
          "  return title + count;",
          "}",
          "",
        ].join("\n"),
      );
      // Карта называет ответственность: фразу, списанную с неё, свод не примет.
      const mapAt = path.join(box, ".context", "00-map.md");
      fs.appendFileSync(
        mapAt,
        "\n| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n" +
          "| `src/components/ZzCard/ZzCard.tsx` | показывает карточку товара | нет | нет |\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzCard");
      const read = fs.readFileSync(protoAt, "utf8");
      // Строка на единицу и на каждое объявление; ответ, которого не спросить,
      // ставит инструмент.
      expect(read).toContain(
        "| Св1 | `components/ZzCard` | строк кода `7`; файлов `1`; полей состояния `0` |  |  |  | полей меньше двух |",
      );
      expect(read).toContain("| Св2 | `components/ZzCard/ZzCard.tsx:1` | `zzActive` |  |  |  |  |  |");
      expect(read).toContain(
        "| Св3 | `components/ZzCard/ZzCard.tsx:4` | `ZZ_LIMIT` |  |  |  | не абстракция | входов меньше двух |",
      );
      expect(read).toContain("| Св4 | `components/ZzCard/ZzCard.tsx:5` | `ZzCard` |  |  |  |  |  |");

      const setRow = (id, cells) =>
        fs.writeFileSync(
          protoAt,
          fs
            .readFileSync(protoAt, "utf8")
            .split("\n")
            .map((line) => {
              if (!line.startsWith("| " + id + " |")) return line;
              const c = line.split("|");
              cells.forEach((v, k) => {
                if (v !== null) c[4 + k] = " " + v + " ";
              });
              return c.join("|");
            })
            .join("\n"),
        );
      const setOutcome = (id, rest) =>
        fs.writeFileSync(
          protoAt,
          fs
            .readFileSync(protoAt, "utf8")
            .split("\n")
            .map((line) => {
              const c = line.split("|");
              return c.length === 9 && c[1].trim() === id
                ? "| " + id + " | " + c[2].trim() + " | x | " + rest + " |"
                : line;
            })
            .join("\n"),
        );
      fillBar(protoAt, { release: "не нужно: проба" });
      // Фраза, списанная с карты, и фраза с союзом без объяснения — не ответ.
      setRow("Св1", ["Показывает карточку товара.", null, null, null]);
      expect(tool("bar", "components/ZzCard")).toMatch(
        /^ {4}Св1 \(components\/ZzCard\): фраза списана с карты: её пишут по коду$/m,
      );
      setRow("Св1", ["считает активность и рисует карточку", "да", null, null]);
      expect(tool("bar", "components/ZzCard")).toMatch(
        /^ {4}Св1 \(components\/ZzCard\): во фразе союз: сказать, почему вопрос один \(«да: …»\), либо «нет»$/m,
      );
      // «Нет» в вопросе об одной ответственности делает «чисто» ложным.
      setRow("Св1", [null, "нет", null, null]);
      expect(tool("bar", "components/ZzCard")).toMatch(
        /^ {4}A1 для `components\/ZzCard`: чисто, а свидетель говорит иначе: Св1$/m,
      );
      // Объявление, не служащее фразе, — вторая ответственность.
      setRow("Св1", ["показывает карточку и её ценник", "да: ценник — часть карточки", null, null]);
      setRow("Св2", [null, "нет", null, null, "да: собирает активность из двух флагов"]);
      const twice = tool("bar", "components/ZzCard");
      expect(twice).toMatch(/^ {4}A1 для `components\/ZzCard`: чисто, а свидетель говорит иначе: Св2$/m);
      expect(twice).toMatch(/^ {4}A2 для `components\/ZzCard`: чисто, а свидетель говорит иначе: Св2$/m);
      // «Чисто» стоит на фразе единицы, «нет предмета» при живом свидетеле ложно.
      setRow("Св2", [null, "да", null, null, "нет"]);
      setOutcome("A1", "чисто |  | Св2 — служит |");
      setOutcome("B5", "нет предмета |  | имён нет |");
      const loose = tool("bar", "components/ZzCard");
      expect(loose).toMatch(/^ {4}A1 для `components\/ZzCard`: чисто без опоры на фразу единицы: назвать Св1$/m);
      expect(loose).toMatch(/^ {4}B5: нет предмета, а свидетели есть: Св2, Св3, Св4$/m);
      // Свидетель не отменяет опоры на модель: ответственность из карты —
      // строка её уровня.
      const duty = /^\| (П\d+) \| ответственность \|/m.exec(read)[1];
      setOutcome("A1", "чисто |  | Св1 — один вопрос, " + duty + " — карта о том же, Св2–Св4 служат ему |");
      setOutcome("B5", "чисто |  | Св2–Св4 — имена говорят |");
      expect(tool("bar", "components/ZzCard")).toContain("печать поставлена");

      // Правленый файл гасит свидетелей о нём: они описывают прежний код.
      fs.appendFileSync(at, "export const zzMore = () => ZZ_LIMIT;\n");
      tool("bar", "components/ZzCard");
      const again = fs.readFileSync(protoAt, "utf8");
      expect(again).toContain("| Св1 | `components/ZzCard` | строк кода `8`; файлов `1`; полей состояния `0` |  |  |  | полей меньше двух |");
      expect(again).toContain("| Св2 | `components/ZzCard/ZzCard.tsx:1` | `zzActive` |  |  |  |  |  |");
      expect(again).toContain("| Св5 | `components/ZzCard/ZzCard.tsx:8` | `zzMore` |  |  |  |  | входов меньше двух |");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("на правке объявление получает свидетеля, только если правка его коснулась", () => {
    const box = seatEmpty("witness3-");
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
      const at = path.join(box, "src", "shared", "zzMath", "zzMath.ts");
      fs.mkdirSync(path.dirname(at), { recursive: true });
      const body = (third) =>
        [
          "export const zzAdd = (a: number, b: number): number => a + b;",
          "",
          "export const zzSub = (a: number, b: number): number => {",
          "  return a - b;",
          "};",
          "",
          "export const zzMul = (a: number, b: number): number => " + third + ";",
          "",
        ].join("\n");
      fs.writeFileSync(at, body("a * b"));
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      // Правка тела одной функции — свидетель у неё одной; фраза единицы есть.
      fs.writeFileSync(at, body("b * a"));
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      const one = fs.readFileSync(protoAt, "utf8");
      expect(one).toContain("| Св1 | `shared/zzMath` |");
      expect(one).toContain("| Св2 | `shared/zzMath/zzMath.ts:7` | `zzMul` |");
      expect(one).not.toContain("`zzAdd`");
      expect(one).not.toContain("`zzSub`");
      // Правка внутри тела, а не в строке объявления, — тоже касание.
      fs.writeFileSync(at, body("a * b").replace("  return a - b;", "  return a - b - 0;"));
      fs.rmSync(protoAt);
      tool("bar");
      const two = fs.readFileSync(protoAt, "utf8");
      expect(two).toContain("| Св2 | `shared/zzMath/zzMath.ts:3` | `zzSub` |");
      expect(two).not.toContain("`zzMul`");
      // Новый файл тронут целиком: свидетель у каждого его объявления.
      fs.writeFileSync(at, body("a * b"));
      fs.writeFileSync(
        path.join(path.dirname(at), "zzPow.ts"),
        "export const zzSquare = (a: number): number => a * a;\nexport const zzCube = (a: number): number => a * a * a;\n",
      );
      fs.rmSync(protoAt);
      tool("bar");
      const fresh = fs.readFileSync(protoAt, "utf8");
      expect(fresh).toContain("`zzSquare`");
      expect(fresh).toContain("`zzCube`");
      fs.rmSync(path.join(path.dirname(at), "zzPow.ts"));
      // Задача чтения — свидетели всех объявлений.
      fs.rmSync(protoAt);
      tool("bar", "shared/zzMath");
      const read = fs.readFileSync(protoAt, "utf8");
      for (const name of ["zzAdd", "zzSub", "zzMul"]) expect(read).toContain("`" + name + "`");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("свидетель отвечает за свою единицу, а не за соседку по правке", () => {
    const box = seatEmpty("witness2-");
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
      for (const [name, body] of [
        ["ZzCard", "export function ZzCard() {\n  return 'card';\n}\nexport const zzAudit = () => 'log';\n"],
        ["ZzTag", "export function ZzTag() {\n  return 'tag';\n}\n"],
      ]) {
        const at = path.join(box, "src", "components", name, name + ".tsx");
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, body);
      }
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components");
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { "узел@components/ZzCard": "нет" },
      });
      const text = fs.readFileSync(protoAt, "utf8");
      const idOf = (name) =>
        new RegExp("^\\| (Св\\d+) \\| `[^`]+` \\| `" + name + "` \\|", "m").exec(text)[1];
      // Объявление карточки не служит её фразе — находка карточки; ответ
      // «чисто» о метке стоит на её свидетелях и принимается.
      const audit = idOf("zzAudit");
      fs.writeFileSync(
        protoAt,
        crossFilled(
          text
            .split("\n")
            .map((line) => {
              if (line.startsWith("| " + audit + " |")) {
                const c = line.split("|");
                c[5] = " нет ";
                return c.join("|");
              }
              const c = line.split("|");
              return c.length === 9 && c[1].trim() === "A1" && c[2].includes("components/ZzCard")
                ? "| A1 | " + c[2].trim() + " | x | нашлось | `src/components/ZzCard/ZzCard.tsx:4` | журнал аудита — вторая ответственность | предложено |"
                : line;
            })
            .join("\n"),
          box,
        ),
      );
      const sealed = tool("bar", "components");
      expect(sealed).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("страницы чтения в своде по планке", () => {
  it("слово каждой страницы, правка гасит слова своих страниц, новый протокол — новая соль", () => {
    const box = seatEmpty("pages-");
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
      const put = (rel, text) => {
        const at = path.join(box, ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      put(
        "src/components/ZzNote/ZzNote.tsx",
        'import { zzTrim } from "../../shared/zzText/zzText";\nexport function ZzNote({ text }: { text: string }) {\n  return zzTrim(text);\n}\n',
      );
      // Сосед, у которого предмет берёт: в срезе — объявление взятого.
      put(
        "src/shared/zzText/zzText.ts",
        'export const zzPad = (s: string) => " " + s;\nexport const zzOther = "other";\n\n\nexport const zzTrim = (s: string) => s.trim();\n',
      );
      // Сосед длиннее среза: строки 1–88 и 94–95 предмета не касаются.
      put(
        "src/app/zzPage.ts",
        [
          ...Array.from({ length: 88 }, (_, k) => "const zzFill" + k + ' = "fill";'),
          "",
          'import { ZzNote } from "../components/ZzNote/ZzNote";',
          "",
          "export const zzPage = () => ZzNote({ text: zzFill0 });",
          "",
          'export const zzTail = "tail";',
          'export const zzGap = "gap";',
        ].join("\n") + "\n",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      tool("bar", "components/ZzNote");
      const text = fs.readFileSync(protoAt, "utf8");
      const rows = [...text.matchAll(/^\| (\d+) \| ([^|]+) \|  \|$/gm)].map((m) => [m[1], m[2].trim()]);
      // Тела критериев, весь предмет, соседи: короткий целиком, длинный —
      // строками, где он берёт предмет, с соседними.
      // Тела только тех критериев, на которые отвечает сессия: лозунг (A8) и
      // замеренная беспредметность (A5-бис — парных копий нет) разрывают
      // диапазон, и страница их тел не печатает.
      expect(rows[0][1]).toMatch(/^политика: `A1`–`A5`, `A5-тер`–`A7`, `A9`–/);
      const first = tool("bar-read", "1", "--print");
      expect(first).not.toContain("**A8.");
      expect(first).not.toContain("**A5-бис.");
      // Диапазон — все тела между концами, а не одни концы.
      for (const id of ["A1", "A2", "A4", "A5", "A5-тер", "A7"]) expect(first).toContain("**" + id + ". ");
      const code = rows.find(([, spec]) => spec.startsWith("код "));
      expect(code[1]).toBe("код `components/ZzNote/ZzNote.tsx`, строки 1–4");
      const near = rows.filter(([, spec]) => spec.startsWith("сосед ")).map(([, spec]) => spec);
      // Строки 90 и 92 длинного соседа берут предмет; с соседними — с 89-й
      // по 93-ю. Короткий сосед умещается в срез и идёт целиком: область
      // читают целиком, а страница не длиннее среза.
      expect(near).toEqual([
        "сосед `app/zzPage.ts`, строки 89–93",
        "сосед `shared/zzText/zzText.ts`, строки 1–5",
      ]);
      // Конец страницы длинного соседа называет строки за срезом.
      const pageOf = (spec) => tool("bar-read", rows.find(([, s]) => s === spec)[0], "--print");
      expect(pageOf(near[0])).toContain(
        "за срезом — строки 1–88, 94–95 из 95: область читают целиком, их открывают файлом",
      );
      expect(pageOf(near[1])).not.toContain("за срезом");
      expect(tool("bar-read", "1", "--print")).toContain(
        "**A1. Узел отвечает на один вопрос.** (узел)",
      );
      const page = tool("bar-read", code[0], "--print");
      expect(page).toContain("   3 |   return zzTrim(text);");
      const word = /^--- слово страницы \d+: (\S+) ---$/m.exec(page)[1];
      expect(word).toMatch(/^[а-яё]+-[а-яё]+$/);

      // Пустое слово и чужое слово — дыры с номером страницы; верное слово в
      // сообщение не идёт.
      fillBar(protoAt, { release: "не нужно: проба" });
      const wrong = word === "берег-берег" ? "ветер-ветер" : "берег-берег";
      const swap = (from, to) =>
        fs.writeFileSync(
          protoAt,
          fs
            .readFileSync(protoAt, "utf8")
            .replace("| " + code[0] + " | " + code[1] + " | " + from + " |", "| " + code[0] + " | " + code[1] + " | " + to + " |"),
        );
      swap(word, wrong);
      const off = tool("bar", "components/ZzNote");
      expect(off).toContain(
        "страница " + code[0] + " (" + code[1] + "): слово не сходится — страница изменилась либо не прочитана: graph.mjs bar-read " + code[0],
      );
      expect(off).not.toContain(word);
      swap(wrong, "");
      expect(tool("bar", "components/ZzNote")).toContain(
        "страница " + code[0] + " (" + code[1] + "): слово не вписано — graph.mjs bar-read " + code[0],
      );
      swap("", word);
      expect(tool("bar", "components/ZzNote")).toContain("печать поставлена");

      // Правка меняет слово своей страницы и только его: соль та же.
      put(
        "src/components/ZzNote/ZzNote.tsx",
        'import { zzTrim } from "../../shared/zzText/zzText";\nexport function ZzNote({ text }: { text: string }) {\n  return zzTrim(text).toUpperCase();\n}\n',
      );
      tool("bar", "components/ZzNote");
      const after = tool("bar", "components/ZzNote");
      expect(after).toContain("страница " + code[0] + " (" + code[1] + "): слово не сходится");
      expect(after).not.toMatch(/страница 1 \(политика/);

      // Новый протокол — новая соль: вчерашнее слово страницу не открывает.
      const salt = /^- соль чтения: `([0-9a-f]+)`$/m.exec(fs.readFileSync(protoAt, "utf8"))[1];
      fs.rmSync(protoAt);
      tool("bar", "components/ZzNote");
      expect(/^- соль чтения: `([0-9a-f]+)`$/m.exec(fs.readFileSync(protoAt, "utf8"))[1]).not.toBe(salt);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("вывод инструмента в канал доходит целиком", () => {
  // Читающий берёт вывод из канала не сразу: оболочка ждёт две секунды, и за
  // это время инструмент успевает всё напечатать и выйти. Без блокирующего
  // потока `process.exit()` обрывал недописанное, и до читающего доходил
  // один буфер канала — последние страницы со своими словами терялись. На
  // Windows канал устроен иначе, и оболочки с паузой там нет.
  it.skipIf(process.platform === "win32")(
    "все страницы чтения доходят до медленного читающего",
    () => {
      const box = seatEmpty("pipe-");
      try {
        const graph = path.join(box, ".claude", "tools", "graph.mjs");
        const at = path.join(box, "src", "components", "ZzNote", "ZzNote.tsx");
        fs.mkdirSync(path.dirname(at), { recursive: true });
        // Предмет длинный: его страницы кода вместе с телами критериев
        // больше буфера канала с запасом.
        const rows = Array.from({ length: 1200 }, (_, k) => "export const zzLine" + k + ' = "строка ' + k + '";');
        fs.writeFileSync(at, rows.join("\n") + "\n");
        try {
          execFileSync(process.execPath, [graph, "bar", "components/ZzNote"], {
            cwd: box,
            stdio: "ignore",
          });
        } catch {
          // Протокол напечатан, печати нет — так и ждут: читать его страницы.
        }
        const out = execFileSync("sh", ["-c", '"$0" "$1" bar-read --print | (sleep 2; cat)', process.execPath, graph], {
          cwd: box,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        });
        expect(Buffer.byteLength(out)).toBeGreaterThan(64 * 1024);
        expect(out).toContain("Слово снимают, прочитав страницу, а не программой.");
      } finally {
        fs.rmSync(box, { recursive: true, force: true });
      }
    },
    300000,
  );
});

describe("таблица, переехавшая из объявленного файла, — не копия", () => {
  it("прежний адрес таблицы сверок в настройке называется переездом, а не копией", () => {
    const box = seatEmpty("twin-");
    try {
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const clean = fs.readFileSync(cfg, "utf8");
      const from = 'file: "../.claude/tools/checks.md",';
      expect(clean.split(from).length).toBe(2);
      // Настройка проекта, не обновлённая после переезда таблицы.
      fs.writeFileSync(cfg, clean.replace(from, 'file: "../.claude/rules/base-format.md",'));
      let out = "";
      try {
        out = execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "verify"], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        out = String(e.stdout ?? "");
      }
      expect(out).toMatch(
        /\.claude\/tools\/checks\.md:\d+ — таблица, объявленная в (?:\.\.\/)?\.claude\/rules\/base-format\.md, лежит здесь, а там её нет\. Поправить поле настройки, а не снимать таблицу/,
      );
      expect(out).not.toContain("копия таблицы, объявленной в");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("файл читается один раз, а не на каждое имя или якорь", () => {
  // Счёт работы, а не время: время зависит от машины, а число чтений файла
  // предмета — нет. Модуль, подгруженный перед инструментом, считает чтения
  // файла предмета. Прежде постоянство доводов перечитывало и разбирало файл
  // на каждое его имя, а сверка якорей — на каждый якорь: работа росла как
  // квадрат длины файла.
  const withCounter = (box) => {
    const counter = path.join(box, "zz-count-reads.mjs");
    fs.writeFileSync(
      counter,
      [
        'import fs from "node:fs";',
        'import { syncBuiltinESMExports } from "node:module";',
        "let reads = 0;",
        "const real = fs.readFileSync;",
        "fs.readFileSync = function (file, ...rest) {",
        '  if (typeof file === "string" && file.endsWith("ZzWide.ts")) reads += 1;',
        "  return real.call(this, file, ...rest);",
        "};",
        "syncBuiltinESMExports();",
        'process.on("exit", () => process.stderr.write("ZZ_READS=" + reads + "\\n"));',
        "",
      ].join("\n"),
    );
    const at = path.join(box, "src", "shared", "zzWide", "ZzWide.ts");
    fs.mkdirSync(path.dirname(at), { recursive: true });
    // Файл в `count` имён, свод по нему, затем `mode` со счётчиком чтений.
    return (count, mode) => {
      const rows = Array.from({ length: count }, (_, k) => "export const zzLine" + k + " = " + k + ";");
      fs.writeFileSync(at, rows.join("\n") + "\n");
      fs.rmSync(path.join(box, ".context", "bar-protocol.md"), { force: true });
      const graph = path.join(box, ".claude", "tools", "graph.mjs");
      if (mode !== "bar") spawnSync(process.execPath, [graph, "bar", "shared/zzWide"], { cwd: box, encoding: "utf8" });
      const got = spawnSync(
        process.execPath,
        // Модуль берут адресом, а не путём: путь с буквой диска Windows
        // адресом модуля не является (W-8).
        ["--import", pathToFileURL(counter).href, graph, ...(mode === "bar" ? ["bar", "shared/zzWide"] : [mode])],
        { cwd: box, encoding: "utf8" },
      );
      return Number(/ZZ_READS=(\d+)/.exec(got.stderr ?? "")?.[1] ?? "-1");
    };
  };

  it("свод: число чтений файла предмета не растёт с числом его имён", () => {
    const box = seatEmpty("reads-");
    try {
      const readsFor = withCounter(box);
      const few = readsFor(50, "bar");
      const many = readsFor(600, "bar");
      // Свод дошёл до модели: иначе чтений мало в обоих прогонах, и тест
      // проходил бы на упавшем инструменте.
      const protocol = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8");
      expect(protocol).toMatch(/^\| П1 \| /m);
      expect(protocol).toContain("zzLine599");
      expect(few).toBeGreaterThan(0);
      expect(many - few).toBeLessThan(10);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("сверка базы: число чтений файла не растёт с числом якорей на него", () => {
    const box = seatEmpty("anchors-");
    try {
      const readsFor = withCounter(box);
      // Протокол свода называет строку каждого объявления: на файл в `600`
      // имён — `600` якорей.
      const few = readsFor(50, "verify");
      const many = readsFor(600, "verify");
      const protocol = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8");
      expect(protocol).toContain("`shared/zzWide/ZzWide.ts:600`");
      expect(few).toBeGreaterThan(0);
      expect(many - few).toBeLessThan(10);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("проба планки из нескольких файлов", () => {
  it("посаженное против направления слоёв свод называет, суд засчитывает", () => {
    const box = seatEmpty("probaur-");
    let sandbox = null;
    try {
      // Посадка своя, а не из книги: тест, пересказывающий книгу, выдал бы
      // посаженное каждому, кто его читал.
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const one = {
        criterion: "A5",
        why: "общий слой берёт из приложения",
        create: [
          { path: "app/zzTitle.ts", text: 'export const zzTitle = "title";\n' },
          {
            path: "shared/zzBadge/zzBadge.ts",
            text:
              'import { zzTitle } from "../../app/zzTitle";\n\n' +
              "export const zzBadge = (): string => zzTitle;\n",
          },
        ],
        culprits: ["shared/zzBadge/zzBadge.ts"],
      };
      fs.writeFileSync(probes, JSON.stringify({ plants: [one], covers: [] }));
      const run = (cwd, ...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args],
            { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const planted = run(box, "bar-probe");
      sandbox = /песочница: (.+)/.exec(planted)?.[1]?.trim() ?? null;
      const id = /bar-probe (\d+)/.exec(planted)?.[1] ?? null;
      expect(sandbox).not.toBeNull();
      expect(id).not.toBeNull();
      // Все файлы посадки лежат в песочнице.
      for (const c of one.create)
        expect(fs.existsSync(path.join(sandbox, "src", c.path))).toBe(true);
      run(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      // Модель показывает ребро против правила — «чисто» по направлению
      // невозможно без суждения.
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(/\| направление \|[^\n]*\| против правила \|/);
      fs.appendFileSync(
        path.join(sandbox, ".context", "13-questions.md"),
        "\nВопрос о `src/shared/zzBadge/zzBadge.ts`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { "слой@shared": "нет" },
        pick: {
          "A5@shared": "нашлось | src/shared/zzBadge/zzBadge.ts:1 | общий слой берёт из приложения | вопрос",
        },
      });
      expect(run(sandbox, "bar")).toContain("печать поставлена");
      expect(run(box, "bar-probe", id)).toContain("исход: поймано");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }, 240000);
});

describe("посадка не ложится в модуль своей темы", () => {
  it("роль с полем away обходит модуль, в пути которого стоит слово темы", () => {
    const box = seatEmpty("probaway-");
    const left = [];
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const one = {
        criterion: "A1",
        why: "в узел дописан журнал аудита",
        into: [
          {
            role: "виновник",
            file: "модуль",
            away: ["zzaudit"],
            text: 'export const zzTrail = (a) => {\n  console.info("[audit]", a);\n};',
            ts: 'export const zzTrail = (a: string): void => {\n  console.info("[audit]", a);\n};',
          },
        ],
      };
      const cover = {
        file: "разметка",
        text: "export const zzCover = () => 1;",
        ts: "export const zzCover = (): number => 1;",
      };
      fs.writeFileSync(
        probes,
        JSON.stringify({ plants: [one], covers: [cover] }),
      );
      const codeUnder = (dir) =>
        fs
          .readdirSync(path.join(box, dir), { withFileTypes: true })
          .flatMap((e) =>
            e.isDirectory()
              ? e.name === "tests"
                ? []
                : codeUnder(dir + "/" + e.name)
              : /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")
                ? [dir + "/" + e.name]
                : [],
          );
      // Имя посадки уже стоит во всех модулях проекта: свободен один модуль
      // темы — его посадка обязана обойти.
      for (const rel of codeUnder("src"))
        fs.appendFileSync(path.join(box, rel), "\nexport const zzTrail = 0;\n");
      const put = (rel) => {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(
          path.join(box, rel),
          "export const zzKeep = (n: number): number => n;\n",
        );
      };
      put("src/shared/zzaudit/zzaudit.ts");
      const run = (...args) => {
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
      const plantedTo = (out) => {
        const sandbox = /песочница: (.+)/.exec(out)?.[1]?.trim() ?? null;
        const id = /bar-probe (\d+)/.exec(out)?.[1] ?? null;
        if (sandbox === null || id === null) return null;
        const markAt = path.join(
          os.tmpdir(),
          "bar-probe-" + id + ".plant.json",
        );
        left.push(sandbox, markAt);
        return JSON.parse(fs.readFileSync(markAt, "utf8")).files[0];
      };
      const alone = run("bar-probe", "--existing", "--seed=1");
      expect(plantedTo(alone), alone).toBeNull();
      expect(alone).toContain("не вмещает");
      put("src/shared/zzFree/zzFree.ts");
      const culprit = plantedTo(run("bar-probe", "--existing", "--seed=1"));
      expect(culprit).not.toBeNull();
      expect(path.basename(culprit)).toBe("zzFree.ts");
    } finally {
      for (const one of left) fs.rmSync(one, { recursive: true, force: true });
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("проба планки в существующем коде", () => {
  it("нарушение дописано в живые файлы среди обычной правки, свод его называет, суд засчитывает", () => {
    const box = seatEmpty("probaex-");
    let sandbox = null;
    let markAt = null;
    try {
      // Посадка и прикрытие свои, а не из книги: тест, пересказывающий книгу,
      // выдал бы посаженное каждому, кто его читал.
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const one = {
        criterion: "C4",
        why: "меняет чужой реестр, взятый импортом",
        into: [
          {
            role: "владелец",
            text: "export const tally = { hits: 0, keys: [] };",
            ts: "export const tally = { hits: 0, keys: [] as string[] };",
          },
          {
            role: "виновник",
            text:
              'import { tally } from "{{from:владелец}}";\n\n' +
              "export const noteKey = (key) => {\n  tally.keys.push(key);\n};",
            ts:
              'import { tally } from "{{from:владелец}}";\n\n' +
              "export const noteKey = (key: string): void => {\n  tally.keys.push(key);\n};",
          },
        ],
        culprits: ["виновник"],
      };
      const cover = {
        text: "export const zzCover = () => 1;",
        ts: "export const zzCover = (): number => 1;",
      };
      // Без прикрытий посаженное стояло бы одно в правленом: посадки нет.
      fs.writeFileSync(probes, JSON.stringify({ plants: [one], covers: [] }));
      // Два файла без имён посадки — с импортом наверху; прочие файлы кода
      // эти имена уже несут, и посадка обязана их обойти.
      for (const [rel, text] of [
        ["src/shared/zzA/zzA.ts", 'import { useMemo } from "react";\n\nexport const zzA = (n: number): number => n + 1;\n'],
        ["src/shared/zzB/zzB.ts", 'import { useMemo } from "react";\n\nexport const zzB = (n: number): number => n - 1;\n'],
        ["src/components/ZzC/ZzC.tsx", "export function ZzC() {\n  return 'c';\n}\n"],
        ["src/components/ZzD/ZzD.tsx", "export function ZzD() {\n  return 'd';\n}\n"],
        ["src/components/ZzE/ZzE.tsx", "export function ZzE() {\n  return 'e';\n}\n"],
      ]) {
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), text);
      }
      const codeUnder = (dir) =>
        fs.readdirSync(path.join(box, dir), { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? e.name === "tests"
              ? []
              : codeUnder(dir + "/" + e.name)
            : /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")
              ? [dir + "/" + e.name]
              : [],
        );
      const busy = codeUnder("src").filter((rel) => !/\/zz[AB]\.ts$/.test(rel));
      expect(busy.length).toBeGreaterThanOrEqual(3);
      for (const rel of busy)
        fs.appendFileSync(
          path.join(box, rel),
          '\nexport const tally = 0;\nexport const noteKey = (): string => "busy";\n',
        );
      const run = (cwd, ...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args],
            { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      // Род «новым файлом» флагом отсекается: сажать нечего.
      expect(run(box, "bar-probe", "--new")).toContain("=== Сажать нечего ===");
      expect(run(box, "bar-probe", "--existing")).toContain("нет прикрытий");
      const withCover = { plants: [one], covers: [cover] };
      fs.writeFileSync(probes, JSON.stringify(withCover));
      const planted = run(box, "bar-probe", "--existing", "--seed=11");
      sandbox = /песочница: (.+)/.exec(planted)?.[1]?.trim() ?? null;
      const id = /bar-probe (\d+)/.exec(planted)?.[1] ?? null;
      expect(sandbox).not.toBeNull();
      markAt = path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json");
      const mark = JSON.parse(fs.readFileSync(markAt, "utf8"));
      expect(mark.kind).toBe("в существующем коде");
      // Виновник берёт у владельца путём, который посадка вычислила сама, и
      // ещё один файл получил обычную правку.
      const culprit = mark.files[0];
      const text = fs.readFileSync(culprit, "utf8");
      // Импорт — к импортам файла, наверх; тело — с типами, как пишут вокруг.
      expect(text.split("\n")[1]).toMatch(/^import \{ tally \} from "[^"]+";$/);
      expect(text).toContain("export const noteKey = (key: string): void => {");
      expect(text).not.toMatch(/zzProbe/);
      const spec = /import \{ tally \} from "([^"]+)";/.exec(text)[1];
      const owner = ["", ".ts", ".tsx"]
        .map((ext) => path.resolve(path.dirname(culprit), spec) + ext)
        .find((f) => fs.existsSync(f));
      expect(fs.readFileSync(owner, "utf8")).toContain("export const tally = { hits: 0, keys: [] as string[] };");
      // Файлы, где имя посадки уже было, она обошла.
      expect([culprit, owner].map((f) => path.basename(f)).sort()).toEqual(["zzA.ts", "zzB.ts"]);
      for (const rel of busy)
        expect(fs.readFileSync(path.join(sandbox, rel), "utf8").match(/tally/g)?.length).toBe(1);
      const changed = execFileSync("git", ["status", "--porcelain"], { cwd: sandbox, encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
      expect(changed.length).toBe(3);
      mutationMeasured(sandbox);
      run(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      const relCulprit = path.relative(path.join(sandbox, "src"), culprit).split(path.sep).join("/");
      // Признак, видимый текстом, называет правку взятого импортом.
      expect(fs.readFileSync(protoAt, "utf8")).toMatch(
        new RegExp("\\| мутация \\| `" + relCulprit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + ":\\d+` \\|"),
      );
      const parts = relCulprit.split("/");
      const unit = parts.length >= 3 ? parts.slice(0, 2).join("/") : relCulprit;
      const line = text.split("\n").findIndex((l) => l.includes("tally.keys.push")) + 1;
      fs.appendFileSync(
        path.join(sandbox, ".context", "13-questions.md"),
        "\nВопрос о `src/" + relCulprit + "`.\n",
      );
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { ["узел@" + unit]: "нет" },
        pick: {
          ["C4@" + unit]: "нашлось | src/" + relCulprit + ":" + line + " | меняет чужой реестр, взятый импортом | вопрос",
        },
      });
      expect(run(sandbox, "bar")).toContain("печать поставлена");
      // Суд сличает виновника ПУТЁМ: тот же протокол против одноимённого
      // файла в другой папке — адрес другой, а не «поймано».
      const twin = sandbox + "-двойник";
      // На Windows копия с пакетами-ссылками выходила без папки базы и без
      // ошибки. Суду пакеты не нужны.
      const noPackages = { recursive: true, filter: (src) => path.basename(src) !== "node_modules" };
      fs.cpSync(sandbox, twin, noPackages);
      const twinMark = path.join(os.tmpdir(), "bar-probe-" + id + "9.plant.json");
      const elsewhere = path.join(twin, "src", "zzElsewhere", path.basename(culprit));
      fs.writeFileSync(
        twinMark,
        JSON.stringify({ ...mark, box: twin, file: elsewhere, files: [elsewhere] }),
      );
      const missed = run(box, "bar-probe", id + "9");
      const twinBase = path.join(twin, ".context");
      expect(
        missed,
        fs.existsSync(twinBase) ? fs.readdirSync(twinBase).join(", ") : "нет папки " + twinBase,
      ).toContain("исход: критерий назван, адрес другой");
      expect(missed).not.toContain("протокол искали");
      // Промах разбирают по протоколу: песочница остаётся.
      expect(missed).toContain("песочница оставлена для разбора промаха");
      expect(fs.existsSync(path.join(twin, ".context", "bar-protocol.md"))).toBe(true);
      // Протокола нет — суд называет, где его искал. Суд одной машины книгу
      // проб не пишет, и счёт проб ниже он не сдвигает.
      fs.rmSync(path.join(twinBase, "bar-protocol.md"));
      const none = run(box, "bar-probe", id + "9", "--machine");
      expect(none).toContain("исход: свода нет");
      expect(none).toContain(
        "протокол искали: " + path.join(twinBase, "bar-protocol.md").split(path.sep).join("/"),
      );
      fs.rmSync(twin, { recursive: true, force: true });
      fs.rmSync(twinMark, { force: true });
      // Место, названное в графе «что» после «ещё мест:», суд засчитывает:
      // строка на работу одна, а нарушений одного критерия бывает несколько.
      const twinMore = sandbox + "-ещё";
      fs.cpSync(sandbox, twinMore, noPackages);
      const moreAt = path.join(twinMore, ".context", "bar-protocol.md");
      const moreWhere = path.join(twinMore, "src", "zzElsewhere", path.basename(culprit));
      fs.writeFileSync(
        moreAt,
        fs
          .readFileSync(moreAt, "utf8")
          .replace(
            "меняет чужой реестр, взятый импортом |",
            "меняет чужой реестр, взятый импортом; ещё мест: `src/zzElsewhere/" + path.basename(culprit) + ":1` |",
          ),
      );
      const moreMark = path.join(os.tmpdir(), "bar-probe-" + id + "8.plant.json");
      fs.writeFileSync(moreMark, JSON.stringify({ ...mark, box: twinMore, file: moreWhere, files: [moreWhere] }));
      expect(run(box, "bar-probe", id + "8", "--machine")).toContain("исход: поймано");
      fs.rmSync(twinMore, { recursive: true, force: true });
      fs.rmSync(moreMark, { force: true });
      const judged = run(box, "bar-probe", id);
      expect(judged).toContain("исход: поймано");
      expect(fs.existsSync(sandbox)).toBe(false);
      expect(judged).toContain("в существующем коде: проб 2, поймано 1");
      // Суд мерит и точность: сколько критериев свод назвал по адресу посадки.
      expect(judged).toContain("критериев по адресу посадки: 1");
      const ledgerAt = path.join(box, ".context", "bar-probe-ledger.json");
      const last = JSON.parse(fs.readFileSync(ledgerAt, "utf8")).runs.at(-1);
      expect(last).toMatchObject({ verdict: "поймано", atPlant: 1 });
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
      if (markAt !== null) fs.rmSync(markAt, { force: true });
    }
  }, 240000);
});

/**
 * Опора посадки — поле `held`: опора, которая видит её форму, когда та
 * слабее самой сильной опоры критерия. По ней ворота стенда и тест машинных
 * посадок решают, суждение это или машина. Опора, которой у критерия нет,
 * либо машинная — книга неверна, и режим не сажает.
 */
describe("опора посадки", () => {
  it("held не своего критерия либо машинный — книга неверна; своя опора слабее — посадка встаёт", () => {
    const box = seatEmpty("probaheld-");
    const left = [];
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const one = {
        criterion: "H4",
        why: "имя без потребителя",
        create: { path: "shared/zzHeld/zzHeld.ts", text: "export const zzHeld = (n: number): number => n;\n" },
      };
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
      for (const held of ["свидетель", "сверка", "линт"]) {
        fs.writeFileSync(probes, JSON.stringify({ plants: [{ ...one, held }], covers: [] }));
        const out = run("bar-probe");
        expect(out).toContain("=== Книга посадок неверна ===");
        expect(out).toContain("#1 H4: поле `held` «" + held + "»");
      }
      fs.writeFileSync(probes, JSON.stringify({ plants: [{ ...one, held: "вопрос модели" }], covers: [] }));
      const planted = run("bar-probe");
      expect(planted).toContain("=== Проба планки посажена ===");
      const sandbox = /песочница: (.+)/.exec(planted)?.[1]?.trim();
      const id = /bar-probe (\d+)/.exec(planted)?.[1];
      left.push(sandbox, path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json"));
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      for (const one of left) fs.rmSync(one, { recursive: true, force: true });
    }
  }, 120000);
});

/**
 * Посадка удалением и в соседе вписана в последний коммит песочницы, а
 * правка идёт поверх неё: удаление потребителя либо прикрытие в соседе.
 * Нарушение стоит там, где правка его не трогала, — в владельце имени,
 * оставшегося без потребителя, и в соседе правленого (находки Н-9 и Н-18).
 */
describe("проба планки удалением и в соседе", () => {
  // Два модуля, соседние по графу, и третий без соседей; прочие файлы кода
  // несут имена посадки и прикрытия, и посадка их обходит.
  const project = (prefix) => {
    const box = seatEmpty(prefix);
    for (const [rel, text] of [
      ["src/shared/zzA/zzA.ts", "export const zzA = (n: number): number => n + 1;\n"],
      ["src/shared/zzB/zzB.ts", 'import { zzA } from "../zzA/zzA";\n\nexport const zzB = (n: number): number => zzA(n) - 1;\n'],
      // Свободный модуль без соседей: прикрытие в него — не в соседе.
      ["src/shared/zzC/zzC.ts", "export const zzC = (n: number): number => n * 3;\n"],
    ]) {
      fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
      fs.writeFileSync(path.join(box, rel), text);
    }
    const codeUnder = (dir) =>
      fs.readdirSync(path.join(box, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? e.name === "tests"
            ? []
            : codeUnder(dir + "/" + e.name)
          : /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")
            ? [dir + "/" + e.name]
            : [],
      );
    for (const rel of codeUnder("src").filter((r) => !/\/zz[ABC]\.ts$/.test(r)))
      fs.appendFileSync(
        path.join(box, rel),
        "\nexport const zzGone = 0;\nexport const zzEmptiness = 0;\nexport const zzCover = 0;\n",
      );
    return box;
  };
  const cover = {
    file: "модуль",
    text: "export const zzCover = () => 1;",
    ts: "export const zzCover = (): number => 1;",
  };
  const removal = {
    criterion: "H4",
    why: "удалённый узел оставил имя без потребителя",
    change: "удаление",
    into: [
      {
        role: "владелец",
        file: "модуль",
        text: "export const zzGone = (n) => n * 2;",
        ts: "export const zzGone = (n: number): number => n * 2;",
      },
    ],
    create: {
      path: "app/zzUser.ts",
      text: 'import { zzGone } from "{{from:владелец}}";\n\nexport const zzUser = (n: number): number => zzGone(n);\n',
    },
    culprits: ["владелец"],
    held: "вопрос модели",
  };
  const neighbour = {
    criterion: "H6-бис",
    why: "булева функция названа существительным",
    change: "сосед",
    into: [
      {
        role: "виновник",
        file: "модуль",
        text: 'export const zzEmptiness = (text) => text.trim() === "";',
        ts: 'export const zzEmptiness = (text: string): boolean => text.trim() === "";',
      },
    ],
  };
  const run = (cwd, ...args) => {
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
  const statusOf = (box) =>
    execFileSync("git", ["status", "--porcelain"], { cwd: box, encoding: "utf8" }).split("\n").filter(Boolean);
  const planted = (box, ...args) => {
    const out = run(box, "bar-probe", ...args);
    const sandbox = /песочница: (.+)/.exec(out)?.[1]?.trim() ?? null;
    const id = /bar-probe (\d+)/.exec(out)?.[1] ?? null;
    expect(sandbox, out).not.toBeNull();
    const markAt = path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json");
    return { sandbox, id, markAt, mark: JSON.parse(fs.readFileSync(markAt, "utf8")) };
  };
  const relOf = (sandbox, f) => path.relative(path.join(sandbox, "src"), f).split(path.sep).join("/");

  it("книга с полем change не своего вида неверна, и род отсекается флагом", () => {
    const box = project("probarod-");
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      fs.writeFileSync(probes, JSON.stringify({ plants: [{ ...neighbour, change: "соседи" }], covers: [cover] }));
      expect(run(box, "bar-probe")).toContain("=== Книга посадок неверна ===");
      // Виновник удаления — созданный и снятый файл: судить было бы не о чем.
      fs.writeFileSync(probes, JSON.stringify({ plants: [{ ...removal, culprits: ["app/zzUser.ts"] }], covers: [cover] }));
      expect(run(box, "bar-probe")).toContain("#1 H4: виновник удаления среди снятого");
      fs.writeFileSync(probes, JSON.stringify({ plants: [removal, neighbour], covers: [cover] }));
      expect(run(box, "bar-probe", "--existing")).toContain("=== Сажать нечего ===");
      expect(run(box, "bar-probe", "--new")).toContain("=== Сажать нечего ===");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);

  it("удаление: потребитель снят, владелец вписан в коммит, свод называет имя без потребителя, суд засчитывает", () => {
    const box = project("probaudal-");
    let sandbox = null;
    let markAt = null;
    try {
      fs.writeFileSync(
        path.join(box, ".claude", "tools", "bar-probes.json"),
        JSON.stringify({ plants: [removal, neighbour], covers: [cover] }),
      );
      const one = planted(box, "--removal", "--seed=3");
      ({ sandbox, markAt } = one);
      expect(one.mark.kind).toBe("удалением");
      const owner = one.mark.files[0];
      expect(fs.readFileSync(owner, "utf8")).toContain("export const zzGone = (n: number): number => n * 2;");
      // Правка — одно удаление; потребитель и его папка сняты, а в
      // последнем коммите он берёт имя у владельца путём, вычисленным
      // посадкой.
      expect(statusOf(sandbox)).toEqual([" D src/app/zzUser.ts"]);
      expect(fs.existsSync(path.join(sandbox, "src", "app", "zzUser.ts"))).toBe(false);
      const spec = "../" + relOf(sandbox, owner).replace(/\.ts$/, "");
      expect(execFileSync("git", ["show", "HEAD:src/app/zzUser.ts"], { cwd: sandbox, encoding: "utf8" })).toContain(
        'import { zzGone } from "' + spec + '";',
      );
      run(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      const proto = fs.readFileSync(protoAt, "utf8");
      const surface = proto
        .split("\n")
        .find((l) => l.includes("| поверхность | `" + relOf(sandbox, owner) + "` |"));
      expect(surface).toContain("после удаления app/zzUser.ts снаружи не берут: zzGone");
      const row = /^\| (П\d+) \|/.exec(surface)[1];
      fs.appendFileSync(path.join(sandbox, ".context", "13-questions.md"), "\nВопрос о `src/" + relOf(sandbox, owner) + "`.\n");
      const found = "нашлось | src/" + relOf(sandbox, owner) + ":1 | zzGone без потребителя | вопрос";
      fillBar(protoAt, {
        release: "не нужно: проба",
        holds: { узел: "нет" },
        pick: { H4: found, B7: found, B9: "чисто |  | " + row + " проба |  |" },
      });
      expect(run(sandbox, "bar")).toContain("печать поставлена");
      expect(run(box, "bar-probe", one.id)).toContain("исход: поймано");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
      if (markAt !== null) fs.rmSync(markAt, { force: true });
    }
  }, 240000);

  // Перенос: файл с нарушением вписан в коммит, правка переносит его в
  // другую папку под другим именем и правит импорт потребителя.
  const moving = {
    criterion: "H7",
    why: "число без имени в перенесённом файле",
    change: "перенос",
    create: [
      {
        path: "shared/zzDates/zzStamp.ts",
        text: 'import { zzA } from "../zzA/zzA";\n\nexport const zzStamp = (ms: number): number => zzA(Math.round(ms / 86400000));\n',
      },
      {
        path: "app/zzUse.ts",
        text: 'import { zzStamp } from "../shared/zzDates/zzStamp";\n\nexport const zzUse = (ms: number): number => zzStamp(ms);\n',
      },
    ],
    move: [{ from: "shared/zzDates/zzStamp.ts", to: "shared/zzTime/zzDays.ts" }],
  };

  it("перенос: файл уехал с правкой импортов, виновник — на новом месте, книга без move неверна", () => {
    const box = project("probaperenos-");
    let sandbox = null;
    let markAt = null;
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      fs.writeFileSync(probes, JSON.stringify({ plants: [{ ...moving, move: undefined }], covers: [cover] }));
      expect(run(box, "bar-probe")).toContain("#1 H7: перенос без поля `move`");
      fs.writeFileSync(
        probes,
        JSON.stringify({ plants: [{ ...moving, move: [{ from: "app/zzOther.ts", to: "app/zzElse.ts" }] }], covers: [cover] }),
      );
      expect(run(box, "bar-probe")).toContain("#1 H7: `move` переносит не созданный посадкой файл");
      fs.writeFileSync(probes, JSON.stringify({ plants: [removal, neighbour, moving], covers: [cover] }));
      const one = planted(box, "--move", "--seed=2");
      ({ sandbox, markAt } = one);
      expect(one.mark.kind).toBe("переносом");
      expect(relOf(sandbox, one.mark.files[0])).toBe("shared/zzTime/zzDays.ts");
      expect(statusOf(sandbox).sort()).toEqual([
        " D src/shared/zzDates/zzStamp.ts",
        " M src/app/zzUse.ts",
        "?? src/shared/zzTime/",
      ]);
      expect(fs.readFileSync(path.join(sandbox, "src", "app", "zzUse.ts"), "utf8")).toContain(
        'import { zzStamp } from "../shared/zzTime/zzDays";',
      );
      expect(fs.readFileSync(path.join(sandbox, "src", "shared", "zzTime", "zzDays.ts"), "utf8")).toContain(
        'import { zzA } from "../zzA/zzA";',
      );
      expect(fs.existsSync(path.join(sandbox, "src", "shared", "zzDates"))).toBe(false);
      run(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      fs.appendFileSync(path.join(sandbox, ".context", "13-questions.md"), "\nВопрос о `src/shared/zzTime/zzDays.ts`.\n");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { H7: "нашлось | src/shared/zzTime/zzDays.ts:3 | 86400000 без имени | вопрос" },
      });
      expect(run(sandbox, "bar")).toContain("печать поставлена");
      expect(run(box, "bar-probe", one.id)).toContain("исход: поймано");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
      if (markAt !== null) fs.rmSync(markAt, { force: true });
    }
  }, 240000);

  it("в соседе: нарушение вписано в коммит, правка легла в соседа по графу, суд требует адрес соседа", () => {
    const box = project("probasosed-");
    let sandbox = null;
    let markAt = null;
    try {
      fs.writeFileSync(
        path.join(box, ".claude", "tools", "bar-probes.json"),
        JSON.stringify({ plants: [removal, neighbour], covers: [cover] }),
      );
      const one = planted(box, "--neighbour", "--seed=5");
      ({ sandbox, markAt } = one);
      expect(one.mark.kind).toBe("в соседе");
      const culprit = one.mark.files[0];
      expect(["zzA.ts", "zzB.ts"]).toContain(path.basename(culprit));
      expect(fs.readFileSync(culprit, "utf8")).toContain("export const zzEmptiness = (text: string): boolean =>");
      // Виновник в коммите, правлен один сосед — второй модуль пары.
      const near = path.basename(culprit) === "zzA.ts" ? "src/shared/zzB/zzB.ts" : "src/shared/zzA/zzA.ts";
      expect(statusOf(sandbox)).toEqual([" M " + near]);
      expect(fs.readFileSync(path.join(sandbox, near), "utf8")).toContain("export const zzCover = (): number => 1;");
      run(sandbox, "bar");
      const protoAt = path.join(sandbox, ".context", "bar-protocol.md");
      const line = fs.readFileSync(culprit, "utf8").split("\n").findIndex((l) => l.includes("zzEmptiness")) + 1;
      fs.appendFileSync(path.join(sandbox, ".context", "13-questions.md"), "\nВопрос о `src/" + relOf(sandbox, culprit) + "`.\n");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { "H6-бис": "нашлось | src/" + relOf(sandbox, culprit) + ":" + line + " | булева функция названа существительным | вопрос" },
      });
      const sealed = run(sandbox, "bar");
      expect(sealed).toContain("печать поставлена");
      expect(run(box, "bar-probe", one.id)).toContain("исход: поймано");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox !== null) fs.rmSync(sandbox, { recursive: true, force: true });
      if (markAt !== null) fs.rmSync(markAt, { force: true });
    }
  }, 240000);
});

/**
 * Песочница пробы берёт пакеты проекта ссылкой: с одними манифестами линт в
 * ней не разрешался, и правила линта как держатели в пробе молчали. Папки
 * кэшей не связываются. Найдено пробой планки.
 */
describe("песочница пробы: пакеты проекта", () => {
  it("пакет разрешается из песочницы, кэш не связан, причина без линта верна", () => {
    const box = seatEmpty("probapkg-");
    let sandbox = null;
    let markAt = null;
    try {
      const modules = path.join(box, "node_modules");
      const pkgDir = path.join(modules, "zz-probe-pkg");
      const manifest = { name: "zz-probe-pkg", main: "index.js" };
      fs.mkdirSync(pkgDir, { recursive: true });
      const manifestAt = path.join(pkgDir, "package.json");
      fs.writeFileSync(manifestAt, JSON.stringify(manifest));
      fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = 1;\n");
      fs.mkdirSync(path.join(modules, ".vite"), { recursive: true });
      // Путь поиска пакетов пуст: иначе линт находился бы в пакетах хозяина,
      // и ответ зависел бы от машины, на которой идут тесты.
      const env = { ...process.env, NODE_PATH: "" };
      const run = (cwd, ...args) => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(cwd, ".claude", "tools", "graph.mjs"), ...args],
            { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const planted = run(box, "bar-probe", "--new");
      sandbox = /песочница: (.+)/.exec(planted)?.[1]?.trim() ?? null;
      const id = /bar-probe (\d+)/.exec(planted)?.[1] ?? null;
      expect(sandbox).not.toBeNull();
      markAt = path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json");
      const fromSandbox = createRequire(path.join(sandbox, "package.json"));
      expect(fs.realpathSync(fromSandbox.resolve("zz-probe-pkg"))).toBe(
        fs.realpathSync(path.join(pkgDir, "index.js")),
      );
      const cache = path.join(sandbox, "node_modules", ".vite");
      expect(fs.existsSync(cache)).toBe(false);
      // Линта у проекта нет на диске, а манифест его объявляет: причина —
      // неустановленные зависимости, а не отсутствие пакета. Первый вызов
      // кладёт скелет протокола, второй его сверяет и называет состояние линта.
      run(sandbox, "bar");
      expect(run(sandbox, "bar")).toContain(
        "пакет `eslint` объявлен манифестом, но не разрешается",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
      if (markAt) fs.rmSync(markAt, { force: true });
    }
  }, 240000);
});

/**
 * Книга посадок не пересказана инструментом и его тестами. Прикрытие, записанное
 * в коде инструмента, и посадка, которую тест сажал из книги и сверял по
 * тексту, выдавали посаженное каждому, кто их читал. Найдено пробой планки.
 * Имя законно там, где файл объявляет его сам, в коде, а не в строке.
 */
describe("книга посадок не пересказана инструментом", () => {
  it("составное имя посадки и прикрытия стоит только своим объявлением файла", () => {
    const book = JSON.parse(
      fs.readFileSync(path.join(TOOL_DIR, "bar-probes.json"), "utf8"),
    );
    const named = new Map();
    const grab = (text, whose) => {
      const declared =
        /\b(?:const|let|var|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/g;
      for (const m of String(text ?? "").matchAll(declared))
        if (/^[a-zA-Z][a-z0-9]+[A-Z]/.test(m[1]) && m[1].length >= 6)
          named.set(m[1], whose);
    };
    for (const p of book.plants) {
      const whose = "посадка " + p.criterion;
      for (const one of [].concat(p.create ?? [])) grab(one.text, whose);
      for (const one of p.into ?? []) grab(one.text + "\n" + one.ts, whose);
    }
    for (const one of book.covers ?? []) grab(one.text + "\n" + one.ts, "прикрытие");
    expect(named.size).toBeGreaterThan(0);
    const leaks = [];
    for (const name of fs.readdirSync(TOOL_DIR)) {
      if (!/\.(?:mjs|md|json)$/.test(name) || name === "bar-probes.json") continue;
      const text = fs.readFileSync(path.join(TOOL_DIR, name), "utf8");
      const bare = bareCodeOf(text);
      for (const [word, whose] of named) {
        const esc = word.replace(/\$/g, "\\$");
        if (!new RegExp("(?<![\\w$])" + esc + "(?![\\w$])").test(text)) continue;
        const own = new RegExp("\\b(?:const|let|var|function|class)\\s+" + esc + "\\b");
        if (!own.test(bare)) leaks.push(name + ": " + whose);
      }
    }
    // Имя не печатается: упавший тест не выдаёт посаженного.
    expect(leaks).toEqual([]);
  });
});

describe("проба планки: зерно", () => {
  it("одно зерно — одна и та же посадка", () => {
    const box = seatEmpty("probaseed-");
    const boxes = [];
    try {
      const probes = path.join(box, ".claude", "tools", "bar-probes.json");
      const all = JSON.parse(fs.readFileSync(probes, "utf8"));
      for (let k = 0; k < 6; k += 1) {
        const rel = "src/components/ZzS" + k + "/ZzS" + k + ".tsx";
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.writeFileSync(path.join(box, rel), "export function ZzS" + k + "() {\n  return " + k + ";\n}\n");
      }
      const run = (...args) => {
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
      const plantOnce = () => {
        const out = run("bar-probe", "--existing", "--seed=5");
        const sandbox = /песочница: (.+)/.exec(out)[1].trim();
        const id = /bar-probe (\d+)/.exec(out)[1];
        boxes.push(sandbox, path.join(os.tmpdir(), "bar-probe-" + id + ".plant.json"));
        const mark = JSON.parse(fs.readFileSync(boxes[boxes.length - 1], "utf8"));
        const changed = execFileSync("git", ["status", "--porcelain"], { cwd: sandbox, encoding: "utf8" })
          .split("\n")
          .filter(Boolean)
          .sort()
          .join(";");
        return mark.criterion + "|" + path.relative(sandbox, mark.files[0]) + "|" + changed;
      };
      const first = plantOnce();
      for (let k = 0; k < 3; k += 1) expect(plantOnce()).toBe(first);
      expect(all.plants.length).toBeGreaterThan(1);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
      for (const one of boxes) fs.rmSync(one, { recursive: true, force: true });
    }
  }, 240000);
});

describe("факты по уровням без протокола", () => {
  it("по адресу печатает уровни, по проекту — требует назвать каждый факт", () => {
    const box = seatEmpty("levels-");
    try {
      const tool = (...args) => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      fs.writeFileSync(
        path.join(box, "src", "app", "zzA.ts"),
        'import { zzB } from "./zzB";\nexport const zzA = (): number => zzB() + 1;\n',
      );
      fs.writeFileSync(
        path.join(box, "src", "app", "zzB.ts"),
        'import { zzA } from "./zzA";\nexport const zzB = (): number => (zzA.length > 0 ? 1 : 0);\n',
      );
      const one = tool("levels", "app/zzA.ts");
      expect(one.code).toBe(0);
      expect(one.out).toContain("--- узел ---");
      expect(one.out).toContain("--- слой ---");
      expect(one.out).toContain("--- приложение ---");
      expect(one.out).toMatch(/цикл: app\/zzA\.ts → app\/zzB\.ts → app\/zzA\.ts/);
      const all = tool("levels");
      expect(all.code).toBe(1);
      expect(all.out).toMatch(/цикл: [^\n]*— не назван/);
      // Запись, назвавшая один файл цикла, факта не называет: прежде её
      // хватало, и строка про что угодно в одном из концов держала цикл.
      const regAt = path.join(box, ".context", "16-findings.md");
      const head =
        "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n";
      const reg0 = fs.readFileSync(regAt, "utf8");
      fs.writeFileSync(
        regAt,
        reg0.replace(
          head,
          head + "| 1 | линт в `src/app/zzA.ts` | проба | — | нечем | открыта |\n",
        ),
      );
      const half = tool("levels");
      expect(half.out).toMatch(/цикл: [^\n]*— не назван/);
      expect(half.code).toBe(1);
      // Названы оба файла одной строкой — факт принят, код ноль.
      fs.writeFileSync(
        regAt,
        reg0.replace(
          head,
          head +
            "| 1 | цикл `src/app/zzA.ts` и `src/app/zzB.ts` | проба | — | нечем | открыта |\n",
        ),
      );
      const named = tool("levels");
      expect(named.out).toMatch(/цикл: [^\n]*— назван: /);
      expect(named.code).toBe(0);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("факт без записи роняет сверку базы; папку без входа называют одной записью", () => {
    const box = seatEmpty("fakt-");
    try {
      const tool = (...args) => {
        try {
          return {
            code: 0,
            out: execFileSync(
              process.execPath,
              [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
              { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ),
          };
        } catch (e) {
          return { code: e.status, out: String(e.stdout ?? "") };
        }
      };
      const put = (rel, text) => {
        const at = path.join(box, "src", ...rel.split("/"));
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, text);
      };
      const loose = () =>
        (verifyIn(box).get("Архитектурный факт назван записью") ?? []).join("\n");
      // Два компонента пишут один ключ хранилища сами: второй писатель. У
      // второго ключ на строке ниже вызова — так его переносит форматтер.
      put(
        "components/ZzA/ZzA.tsx",
        'export function ZzA() {\n  return <button onClick={() => window.localStorage.setItem("zz.count", "1")}>x</button>;\n}\n',
      );
      put(
        "components/ZzB/ZzB.tsx",
        'export function ZzB() {\n  return (\n    <button\n      onClick={() =>\n        window.localStorage.setItem(\n          "zz.count",\n          "1",\n        )\n      }\n    >\n      x\n    </button>\n  );\n}\n',
      );
      const two = tool("levels");
      expect(two.code).toBe(1);
      expect(two.out).toMatch(/писатель: хранилище «zz\.count»: пишут components\/ZzA\/ZzA\.tsx, components\/ZzB\/ZzB\.tsx — не назван/);
      // Запись о том же ключе и тех же писателях — тот же факт, а не второй.
      const stateAt = path.join(box, ".context", "04-state.md");
      const hadState = fs.existsSync(stateAt);
      fs.copyFileSync(
        path.join(box, ".claude", "seat", "templates", "04-state.md"),
        stateAt,
      );
      fs.writeFileSync(
        stateAt,
        fs
          .readFileSync(stateAt, "utf8")
          .replace(
            "| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n",
            "| Что | Владелец | Кто пишет | Кто читает | Время жизни |\n| --- | --- | --- | --- | --- |\n| ключ `zz.count` | `src/components/ZzA/ZzA.tsx` | `src/components/ZzA/ZzA.tsx`, `src/components/ZzB/ZzB.tsx` | никто | пока не перепишут |\n",
          ),
      );
      expect(tool("levels").out.match(/^ {2}писатель: /gm)).toHaveLength(1);
      // Запись вправе назвать ключ именем его константы — тот же факт.
      put(
        "components/ZzA/ZzA.tsx",
        'const ZZ_KEY = "zz.count";\n\nexport function ZzA() {\n  return <button onClick={() => window.localStorage.setItem(ZZ_KEY, "1")}>x</button>;\n}\n',
      );
      fs.writeFileSync(
        stateAt,
        fs.readFileSync(stateAt, "utf8").replace("| ключ `zz.count` |", "| ключ `ZZ_KEY` |"),
      );
      expect(tool("levels").out.match(/^ {2}писатель: /gm)).toHaveLength(1);
      // Ключ членом объекта-константы, а второй узел снимает ту же запись
      // строкой: снятие — тоже запись, и ключ один.
      put(
        "components/ZzA/ZzA.tsx",
        'const ZZ_KEYS = { count: "zz.count" };\n\nexport function ZzA() {\n  return <button onClick={() => window.localStorage.setItem(ZZ_KEYS.count, "1")}>x</button>;\n}\n',
      );
      put(
        "components/ZzB/ZzB.tsx",
        'export function ZzB() {\n  return <button onClick={() => window.localStorage.removeItem("zz.count")}>x</button>;\n}\n',
      );
      fs.writeFileSync(
        stateAt,
        fs.readFileSync(stateAt, "utf8").replace("| ключ `ZZ_KEY` |", "| ключ `ZZ_KEYS.count` |"),
      );
      const member = tool("levels").out;
      expect(member.match(/^ {2}писатель: /gm)).toHaveLength(1);
      expect(member).toMatch(/писатель: хранилище «zz\.count»: пишут components\/ZzA\/ZzA\.tsx, components\/ZzB\/ZzB\.tsx/);
      if (!hadState) fs.rmSync(stateAt);
      // Перехода нет — факт без записи роняет и прогон сверки базы.
      expect(loose()).toMatch(/писатель: хранилище «zz\.count»/);
      // Вопрос — запись от заголовка до заголовка: файлы факта, названные в
      // разных его графах, называют факт.
      const questionsAt = path.join(box, ".context", "13-questions.md");
      const questions0 = fs.readFileSync(questionsAt, "utf8");
      fs.appendFileSync(
        questionsAt,
        "\n## Вопрос 1. Второй писатель в `src/components/ZzA/ZzA.tsx`\n\n**Задан:** проба.\n\n**Что решить.** Ключ пишет и `src/components/ZzB/ZzB.tsx`.\n\n**Последствие отсутствия ответа.** проба.\n",
      );
      expect(loose()).not.toMatch(/«zz\.count»/);
      fs.writeFileSync(questionsAt, questions0);
      // Решение, назвавшее все файлы факта, его держит.
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nПроба: `src/components/ZzA/ZzA.tsx` и `src/components/ZzB/ZzB.tsx` пишут один ключ — порядок записи объявлен.\n",
      );
      expect(tool("levels").out).toMatch(/«zz\.count»[^\n]*— назван: /);
      expect(loose()).not.toMatch(/«zz\.count»/);
      // Внутренность папки без входа называют одной записью о папке, а не по
      // записи на каждого, кто в неё ходит.
      put("components/ZzC/zzInner.ts", "export const zzInner = 1;\n");
      put("components/ZzD/ZzD.tsx", 'import { zzInner } from "../ZzC/zzInner";\n\nexport const ZzD = () => zzInner;\n');
      put("components/ZzE/ZzE.tsx", 'import { zzInner } from "../ZzC/zzInner";\n\nexport const ZzE = () => zzInner;\n');
      expect(loose()).toMatch(/ZzD\.tsx → components\/ZzC\/zzInner\.ts — внутренность единицы переноса components\/ZzC, у которой входа нет/);
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nПроба: у папки `src/components/ZzC/` входа нет — берут внутренность.\n",
      );
      expect(loose()).not.toMatch(/ZzC/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("свод отказывает политике, у критерия которой не назван уровень", () => {
    const box = seatEmpty("bezurovnya-");
    try {
      const policy = path.join(box, ".claude", "rules", "quality.md");
      fs.writeFileSync(
        policy,
        fs
          .readFileSync(policy, "utf8")
          .replace("**H7. Магических чисел нет.** (единица)", "**H7. Магических чисел нет.**"),
      );
      fs.writeFileSync(path.join(box, "src", "app", "zzN.ts"), "export const zzN = 1;\n");
      let out = "";
      try {
        execFileSync(process.execPath, [path.join(box, ".claude", "tools", "graph.mjs"), "bar", "app/zzN.ts"], {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        out = String(e.stdout ?? "");
      }
      expect(out).toContain("у критерия не назван уровень: H7");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

describe("предложенное сводом держит строка о критерии и файле", () => {
  it("строка реестра о том же критерии в другом файле находку не закрывает", () => {
    const box = seatEmpty("predlozheno-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzA.ts"),
        "export const zzA = 1;\n",
      );
      fs.writeFileSync(
        path.join(box, ".context", "bar-protocol.md"),
        "# Свод\n\n| критерий | о чём | исход | адрес | что | судьба |\n| --- | --- | --- | --- | --- | --- |\n| E1 | проба | нашлось | src/app/zzA.ts:1 | проба | предложено |\n",
      );
      const regAt = path.join(box, ".context", "16-findings.md");
      const reg = fs.readFileSync(regAt, "utf8");
      const withRow = (where) =>
        fs.writeFileSync(
          regAt,
          reg.replace(
            "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n",
            "| № | Что найдено | Где нашли | Чем закрыто | Чем держится | Состояние |\n| --- | --- | --- | --- | --- | --- |\n| 1 | «E1» в `" +
              where +
              "` | проба | — | нечем | открыта |\n",
          ),
        );
      const loose = () =>
        (verifyIn(box).get("Предложенное сводом названо находкой") ?? []).join("\n");
      withRow("src/app/zzB.ts");
      expect(loose()).toContain("E1 — предложено сводом и не названо");
      withRow("src/app/zzA.ts");
      expect(loose()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("мутационный отчёт без исполненных тестов — не замер", () => {
  it("выживший под покрытием при нуле исполненных тестов в реестр не пишется", () => {
    const box = seatEmpty("mutslep-");
    try {
      const at = path.join(box, "src", "app", "zzMut.ts");
      fs.writeFileSync(at, "export const zzMut = (n: number) => n + 1;\n");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      const cfg = fs.readFileSync(cfgAt, "utf8");
      const reportAt = cfg.match(/mutationReport: "([^"]+)"/)[1];
      const stryAt = cfg.match(/mutationConfig: "([^"]+)"/)[1];
      fs.writeFileSync(
        path.join(box, ".context", stryAt),
        JSON.stringify({ mutate: ["src/app/zzMut.ts"] }),
      );
      const report = (testsCompleted) => ({
        config: { mutate: ["src/app/zzMut.ts"] },
        files: {
          "src/app/zzMut.ts": {
            mutants: [
              { status: "Survived", coveredBy: ["t1"], testsCompleted },
            ],
          },
        },
      });
      const write = (r) => {
        const out = path.join(box, ".context", reportAt);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(
          out,
          "<script>app.report = " + JSON.stringify(r) + ";</script>",
        );
      };
      const tool = () => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), "mutated"],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const ledgerAt = path.join(
        box,
        ".context",
        cfg.match(/mutationLedger: "([^"]+)"/)[1],
      );
      write(report(0));
      expect(tool()).toContain("Отчёт мутационного прогона — не замер");
      expect(fs.existsSync(ledgerAt) ? fs.readFileSync(ledgerAt, "utf8") : "").not.toContain("zzMut");
      write(report(3));
      expect(tool()).not.toContain("не замер");
      expect(fs.readFileSync(ledgerAt, "utf8")).toContain("zzMut");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("ворота перед коммитом в конвейере", () => {
  it("свежий клон без `core.hooksPath` красен у разработчика и зелен в конвейере, где коммитов не делают", () => {
    const box = seatEmpty("konveier-");
    try {
      execFileSync("git", ["init", "-q"], { cwd: box, stdio: "ignore" });
      const gate = (env) => {
        let out;
        try {
          out = execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env },
          );
        } catch (e) {
          out = String(e.stdout ?? "");
        }
        return out.split("=== Ворота перед коммитом установлены ===")[1]?.split("===")[0] ?? "";
      };
      const { CI: _ci, ...local } = process.env;
      expect(gate(local)).toContain("`core.hooksPath` не задан");
      // Свой менеджер хуков: git идёт в его папку, и ворота зовут оба его
      // хука — перед коммитом и сообщения: без второго коммит части не
      // несёт строки серии.
      fs.mkdirSync(path.join(box, ".husky", "_"), { recursive: true });
      fs.writeFileSync(
        path.join(box, ".husky", "pre-commit"),
        "node .claude/tools/graph.mjs gate\n",
      );
      execFileSync("git", ["config", "core.hooksPath", ".husky/_"], {
        cwd: box,
      });
      expect(gate(local)).toContain("хуки там ворот не зовут");
      fs.writeFileSync(
        path.join(box, ".husky", "prepare-commit-msg"),
        'node .claude/tools/graph.mjs gate --message "$1"\n',
      );
      expect(gate(local)).not.toMatch(/^ {4}\S/m);
      execFileSync("git", ["config", "--unset", "core.hooksPath"], {
        cwd: box,
      });
      const piped = gate({ ...local, CI: "true" });
      expect(piped).not.toMatch(/^ {4}\S/m);
      expect(piped).toContain("конвейер");
      // Хук, который git пропустит, красен и в конвейере: это содержимое
      // репозитория, а не настройка машины. Бита исполнения у файла на
      // Windows нет, и там сверка о нём не спрашивает.
      const hook = path.join(box, ".claude", "hooks", "git", "pre-commit");
      fs.chmodSync(hook, 0o644);
      const bit = gate({ ...local, CI: "true" });
      if (process.platform === "win32") expect(bit).not.toContain("не исполняемый");
      else expect(bit).toContain("не исполняемый");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

// Флаг перед пакетом читался именем пакета, а версия — его частью: проза,
// звавшая законный пакет через `npx -y`, роняла сверку.
describe("названное доктриной исполнимо: пакет за флагами и без версии", () => {
  it("`npx -y пакет@версия` спрашивает пакет, а не флаг", () => {
    const box = seatEmpty("npx-flag-");
    try {
      fs.appendFileSync(
        path.join(box, ".claude", "rules", "close.md"),
        "\nЛинт — `npx -y eslint@10`, формат — `npx --yes prettier`, проба — `npx -y zznone@1`.\n",
      );
      const said = (
        verifyIn(box).get("Названное доктриной исполнимо") ?? []
      ).join("\n");
      expect(said).toContain("npx zznone —");
      expect(said).not.toMatch(/npx (-y|--yes|eslint|prettier)/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("скрипт манифеста назван и командой с доводами", () => {
  it("`npm run имя -- …` называет скрипт; не названный нигде — предупреждение", () => {
    const box = seatEmpty("skripty-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts["zz-probe"] = "node -e 0";
      pkg.scripts["zz-silent"] = "node -e 0";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      fs.appendFileSync(
        path.join(box, "CLAUDE.md"),
        "\n| Проба по файлам | `npm run zz-probe -- --only <файлы>` |\n",
      );
      const said = (
        verifyIn(box).get("Скрипты манифеста описаны (предупреждение, прогон не роняет)") ?? []
      ).join("\n");
      expect(said).not.toContain("zz-probe —");
      expect(said).toContain("zz-silent —");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("реестр мутаций считает так же, как отчёт, который читает", () => {
  it("мутант с ошибкой раннера не живой; файл, заказанный прогоном и не давший мутантов, промерен", () => {
    const box = seatEmpty("mutschet-");
    try {
      const app = path.join(box, "src", "app");
      fs.writeFileSync(
        path.join(app, "zzMut.ts"),
        "export const zzMut = (n: number) => n + 1;\n",
      );
      fs.writeFileSync(path.join(app, "zzQuiet.ts"), "export const ZZ_QUIET = 1;\n");
      fs.writeFileSync(path.join(app, "zzOther.ts"), "export const ZZ_OTHER = 2;\n");
      const cfg = fs.readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8");
      fs.writeFileSync(
        path.join(box, ".context", cfg.match(/mutationConfig: "([^"]+)"/)[1]),
        JSON.stringify({ mutate: ["src/app/**/*.ts", "!src/**/tests/**"] }),
      );
      // Прогон по файлам правки: своя область отчёта уже области конфига.
      const out = path.join(box, ".context", cfg.match(/mutationReport: "([^"]+)"/)[1]);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const mutant = (status) => ({ status, coveredBy: ["t1"], testsCompleted: 1 });
      fs.writeFileSync(
        out,
        "<script>app.report = " +
          JSON.stringify({
            config: { mutate: ["src/app/zzMut.ts", "src/app/zzQuiet.ts"] },
            files: {
              "src/app/zzMut.ts": {
                mutants: ["Killed", "Survived", "RuntimeError", "CompileError", "Ignored"].map(mutant),
              },
            },
          }) +
          ";</script>",
      );
      const said = execFileSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "mutated",
          "src/app/zzMut.ts",
          "src/app/zzQuiet.ts",
          "src/app/zzOther.ts",
        ],
        { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(said).toContain("zzMut.ts — 50.00 %, живых 1");
      expect(said).toContain("zzQuiet.ts — мутировать нечего");
      // Не заказанный прогоном файл промеренным не становится.
      const never = said.split("Под мутациями не были ни разу:")[1] ?? "";
      expect(never.split("Измерено")[0]).toContain("zzOther.ts");
      expect(never.split("Измерено")[0]).not.toContain("zzQuiet.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("граф по именам: сквозь бочку до объявления", () => {
  it("радиус, зависимости и тесты считаются по взятым именам, а не по строке импорта", () => {
    const box = seatEmpty("imena-");
    try {
      const kit = path.join(box, "src", "shared", "zzKit");
      const app = path.join(box, "src", "app");
      fs.mkdirSync(kit, { recursive: true });
      fs.mkdirSync(path.join(app, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(kit, "core.ts"),
        "export async function zzCore() {\n  return 1;\n}\n",
      );
      fs.writeFileSync(
        path.join(kit, "other.ts"),
        "export const zzOther = () => 2;\n",
      );
      // Бочка отдаёт оба имени: одно звёздочкой, второе поимённо.
      fs.writeFileSync(
        path.join(kit, "index.ts"),
        'export * from "./core.js";\nexport { zzOther } from "./other.js";\n',
      );
      fs.writeFileSync(
        path.join(app, "zzUse.ts"),
        'import { zzCore } from "../shared/zzKit/index.js";\nexport const zzUse = () => zzCore();\n',
      );
      // Берёт из той же бочки СОСЕДНЕЕ имя — от `core.ts` не зависит.
      fs.writeFileSync(
        path.join(app, "zzSide.ts"),
        'import { zzOther } from "../shared/zzKit/index.js";\nexport const zzSide = () => zzOther();\n',
      );
      fs.writeFileSync(
        path.join(app, "tests", "zzUse.test.ts"),
        'import { expect, it } from "vitest";\nimport { zzUse } from "../zzUse.js";\nit("zz", async () => expect(await zzUse()).toBe(1));\n',
      );
      const run = (...args) =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );

      const core = run("brief", "shared/zzKit/core.ts");
      const users = sectionOf(core, "пользуются им");
      expect(users).toContain("app/zzUse.ts");
      expect(users).not.toContain("app/zzSide.ts");
      expect(users).toContain("наружу отдают бочки: shared/zzKit/index.ts");
      expect(sectionOf(core, "гоняют через узлы")).toContain(
        "app/tests/zzUse.test.ts  → app/zzUse.ts",
      );

      const use = run("brief", "app/zzUse.ts");
      expect(sectionOf(use, "импортирует")).toContain(
        "shared/zzKit/core.ts  (через shared/zzKit/index.ts)",
      );

      expect(run("plan", "shared/zzKit/core.ts")).toContain(
        "--- радиус: прямых 1, транзитивно 1 ---",
      );
      const tested = run("tested", "src/shared/zzKit/core.ts");
      expect(tested).not.toContain("ни один тест на это не смотрит");
      expect(tested).toContain("app/tests/zzUse.test.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Один вопрос — один ответ, и для файлов, и для пакетов. Свой конфиг раннера
 * затеняет конфиг сборщика: семя, легшее рядом нетронутым, не действует. Пакет
 * платформы рядом со своей заменой — два компилятора на один вопрос. Замерено
 * посадкой в библиотеку на `sass` со своим `vitest.config.ts`.
 */
describe("семя рядом с затеняющим конфигом и пакет платформы рядом с заменой", () => {
  it("нетронутое семя и вторая замена красны, законная пара — нет", () => {
    const box = seatEmpty("zatenen-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      fs.writeFileSync(
        path.join(box, "vitest.config.ts"),
        'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: {} });\n',
      );
      pkg.devDependencies.sass = "^1.89.2";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const red = verifyIn(box);
      expect(
        (red.get("Один предмет — один файл настройки") ?? []).join("\n"),
      ).toContain("vite.config.ts лежит семенем, а читают vitest.config.ts");
      expect(
        (red.get("Пакет платформы не второй ответ") ?? []).join("\n"),
      ).toContain("sass-embedded рядом с sass");

      const vite = path.join(box, "vite.config.ts");
      fs.writeFileSync(vite, fs.readFileSync(vite, "utf8") + "// build\n");
      delete pkg.devDependencies["sass-embedded"];
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const green = verifyIn(box);
      expect(green.get("Один предмет — один файл настройки")).toBeUndefined();
      expect(green.get("Пакет платформы не второй ответ")).toBeUndefined();

      // Другое имя — любое, которое читает сам форматтер, и поле манифеста.
      fs.writeFileSync(path.join(box, ".prettierrc.yaml"), "semi: false\n");
      pkg.prettier = { semi: false };
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2));
      const twins = (
        verifyIn(box).get("Один предмет — один файл настройки") ?? []
      ).join("\n");
      expect(twins).toContain(".prettierrc.json и .prettierrc.yaml");
      expect(twins).toContain(
        ".prettierrc.json и поле `prettier` в package.json",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Что git игнорирует, проекту не принадлежит: сгенерированный сборкой лист
 * стилей в корпусе давал ложные «мёртвые классы». Замерено на библиотеке,
 * чья сборка пишет листы рядом с исходниками: `44` ложных находки.
 */
describe("игнорируемое git в корпус сверок не входит", () => {
  it("однострочное правило читается, а игнорируемый git лист в корпус не входит", () => {
    const box = seatEmpty("ignored-");
    try {
      execFileSync("git", ["init", "-q"], { cwd: box });
      fs.mkdirSync(path.join(box, "src", "gen"), { recursive: true });
      fs.writeFileSync(
        path.join(box, "src", "gen", "zzGen.css"),
        ".zzGenerated { color: red; }\n",
      );
      const seen = verifyIn(box);
      expect(
        (seen.get("Класс из листа стилей спрошен кодом") ?? []).join("\n"),
      ).toContain("zzGenerated");
      fs.appendFileSync(path.join(box, ".gitignore"), "\nsrc/gen/\n");
      const hidden = verifyIn(box);
      expect(
        (hidden.get("Класс из листа стилей спрошен кодом") ?? []).join("\n"),
      ).not.toContain("zzGenerated");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Документ находится от указателя: его называет указатель либо на него ведёт
 * ссылка из документа, до которого указатель доводит, — в том числе маршрутом
 * сайта документации. Прежде смотрелся один верхний уровень папки, и вложенные
 * документы не проверялись ничем: замерено на библиотеке, где так лежали `16`
 * документов из `23`, и один из них не находился ниоткуда.
 */
describe("указатель документации доводит и до вложенных документов", () => {
  it("вложенный документ без пути к нему назван, с маршрутом из названного — нет", () => {
    const box = seatEmpty("ukazatel-");
    try {
      fs.mkdirSync(path.join(box, "docs", "guide"), { recursive: true });
      fs.writeFileSync(path.join(box, "docs", "guide", "deep.md"), "# Deep\n");
      const lost = verifyIn(box);
      expect(
        (lost.get("Документы названы в указателе") ?? []).join("\n"),
      ).toContain("guide/deep.md");
      fs.writeFileSync(
        path.join(box, "docs", "guide.md"),
        "# Guide\n\n- [Deep](/guide/deep) - one level down\n",
      );
      const facts = path.join(box, ".context", "01-facts.md");
      const row = "| что продукт умеет — списком возможностей | `FEATURES.md` |";
      fs.writeFileSync(
        facts,
        fs
          .readFileSync(facts, "utf8")
          .replace(row, row + "\n| как пройти по шагам | `guide.md` |"),
      );
      const found = verifyIn(box);
      expect(found.get("Документы названы в указателе")).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Воротами служит описание, которое собирает проект, то есть зовёт его
 * менеджер пакетов. Публикация документации запросом и запирание обсуждений
 * чужим действием проекта не касаются, и проверок с них не спрашивают.
 * Замерено на библиотеке: из пяти описаний два проекта не собирали.
 */
describe("конвейер спрашивается только с описаний, собирающих проект", () => {
  it("описание без менеджера пакетов в стороне, сборка без проверок красна", () => {
    const box = seatEmpty("konveier-");
    try {
      const wf = path.join(box, ".github", "workflows");
      fs.mkdirSync(wf, { recursive: true });
      fs.writeFileSync(
        path.join(wf, "lock.yml"),
        "on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  lock:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: dessant/lock-threads@v6\n",
      );
      fs.writeFileSync(
        path.join(wf, "build.yml"),
        "on: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          cache: npm\n      - run: npm ci\n      - run: npm run build\n",
      );
      const found = (
        verifyIn(box).get("Конвейер зовёт проверки") ?? []
      ).join("\n");
      expect(found).toContain("build.yml");
      expect(found).not.toContain("lock.yml");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Сверки перехода спрашивали НАЛИЧИЕ записи, а не её правду. Правды машине не
 * узнать, кроме той, что она видит сама: строка карты, сказавшая «нет» в графе
 * состояния или эффектов у файла, где они есть, неверна без суждения.
 * Замерено на карте библиотеки, собранной переходом: `3` отрицания из `104`.
 */
describe("запись карты не спорит с кодом", () => {
  it("отрицание состояния у файла с состоянием красно, описание — нет", () => {
    const box = seatEmpty("karta-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzCounter.ts"),
        'import { useState } from "react";\nexport const useZz = () => useState(0);\n',
      );
      const map = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |";
      const had = fs.readFileSync(map, "utf8");
      expect(had).toContain(head);
      fs.writeFileSync(
        map,
        had.replace(
          head,
          head + "\n| `src/app/zzCounter.ts` | счётчик | нет | нет |",
        ),
      );
      expect(
        (verifyIn(box).get("Запись карты не спорит с кодом") ?? []).join("\n"),
      ).toContain("zzCounter.ts: карта говорит «нет» в графе состояния");
      fs.writeFileSync(
        map,
        had.replace(
          head,
          head + "\n| `src/app/zzCounter.ts` | счётчик | число нажатий | нет |",
        ),
      );
      expect(verifyIn(box).get("Запись карты не спорит с кодом")).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  // Таблица «База и документация» принимала «не требуется» у файла, чью
  // запись карты опровергает код. Найдено ревьюером пачки проб.
  it("свод не принимает «не требуется» в базе у файла, чью запись опровергает сверка", () => {
    const box = seatEmpty("karta-svod-");
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
      const code = path.join(box, "src", "app", "zzCounter.ts");
      fs.writeFileSync(
        code,
        'import { useState } from "react";\nexport const useZz = () => useState(0);\n',
      );
      const map = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |";
      fs.writeFileSync(
        map,
        fs
          .readFileSync(map, "utf8")
          .replace(
            head,
            head + "\n| `src/app/zzCounter.ts` | счётчик | нет | нет |",
          ),
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      fs.appendFileSync(code, "export const zzStep = 1;\n");
      // Спор записи с кодом назван сразу, до ответов: правка карты потом
      // сняла бы ответы, стоящие на модели.
      expect(bar()).toContain(
        "Сначала база: запись карты спорит с кодом — `app/zzCounter.ts`.",
      );
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const proto = fs.readFileSync(protoAt, "utf8");
      const row = /^\| `app\/zzCounter\.ts` \| {2}\| {2}\| {2}\|$/m;
      expect(proto).toMatch(row);
      fs.writeFileSync(
        protoAt,
        proto.replace(
          row,
          "| `app/zzCounter.ts` | не требуется | не требуется | запись верна |",
        ),
      );
      expect(bar()).toMatch(
        /app\/zzCounter\.ts, база: .не требуется., а сверка «Запись карты не спорит с кодом» опровергает его запись/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("«не требуется» у файла, на который в базе съехал якорь, не принимается", () => {
    const box = seatEmpty("base-anchor-");
    try {
      const git = (...args) =>
        execFileSync("git", args, {
          cwd: box,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
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
      const code = path.join(box, "src", "app", "zzKeep.ts");
      fs.writeFileSync(
        code,
        "export const zzKeep = 1;\nexport const zzStep = 2;\n",
      );
      const map = path.join(box, ".context", "00-map.md");
      const head =
        "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |";
      fs.writeFileSync(
        map,
        fs
          .readFileSync(map, "utf8")
          .replace(head, head + "\n| `src/app/zzKeep.ts` | шаг | нет | нет |"),
      );
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nШаг держится здесь: `src/app/zzKeep.ts:2` `zzStep = 2`.\n",
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      fs.writeFileSync(
        code,
        "export const zzLead = 0;\nexport const zzKeep = 1;\nexport const zzStep = 2;\n",
      );
      bar();
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const proto = fs.readFileSync(protoAt, "utf8");
      const row = /^\| `app\/zzKeep\.ts` \| {2}\| {2}\| {2}\|$/m;
      expect(proto).toMatch(row);
      // Правила приёма — в прозе протокола, а не только в коде инструмента.
      for (const rule of [
        "у файла без своей записи в карте",
        "опровергает сверка «Запись карты не спорит с кодом»",
        "который съехал якорь по сверке «Якоря»",
      ])
        expect(proto).toContain(rule);
      fs.writeFileSync(
        protoAt,
        proto.replace(
          row,
          "| `app/zzKeep.ts` | не требуется | не требуется | запись верна |",
        ),
      );
      expect(bar()).toMatch(
        /app\/zzKeep\.ts, база: .не требуется., а сверка «Якоря» называет съехавший якорь на него/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Переход читает весь код и сразу собирает знание, а расхождения проекта с
 * правилами обвязки записывает долгом перехода с планом. Долг печатается
 * списком для каждого отчёта, у каждого пункта есть держатель, и отступление
 * от умолчания пункт объявляет наравне с решением.
 */
describe("долг перехода: список, держатель, отступление долгом", () => {
  it("режим печатает список, пункт без держателя красен, раскладка долгом объявлена", () => {
    const box = seatEmpty("dolgperehoda-");
    try {
      fs.mkdirSync(path.join(box, "src", "zzOwn"), { recursive: true });
      fs.writeFileSync(
        path.join(box, "src", "zzOwn", "zzThing.ts"),
        "export const zzThing = 1;\n",
      );
      const stray = () =>
        (verifyIn(box).get("Новый узел лежит по раскладке") ?? []).join("\n");
      expect(stray()).toContain("zzThing.ts");
      withTransitionDebt(box, [
        "| 1 | Раскладка проекта своя: код в `src/zzOwn/` | `1` | «Новый узел лежит по раскладке» | перенести `src/zzOwn/zzThing.ts` в `src/shared/own/` | `1` файл |",
        "| 2 | Проба без держателя | `1` | когда-нибудь | ничего | `0` |",
      ]);
      const found = verifyIn(box);
      expect(found.get("Новый узел лежит по раскладке")).toBeUndefined();
      expect(
        (found.get("Шаги перехода закрывают измерение") ?? []).join("\n"),
      ).toContain("пункт долга 2 не называет, что его держит");
      const said = execFileSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "transition"],
        { cwd: box, encoding: "utf8" },
      );
      expect(said).toContain("ДОЛГ ПЕРЕХОДА");
      expect(said).toContain("1 — Раскладка проекта своя — сейчас: 1");
      // Своя раскладка без слоя компонентов: четыре сверки слоя смотрят в
      // ноль, и это находка, а не строка к сведению.
      const blind = (found.get("У компонента есть README") ?? []).join("\n");
      expect(blind).toContain("`componentsAt`");
      expect(blind).toContain("«В файле узла только сам узел»");
      const cfg = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfg,
        fs
          .readFileSync(cfg, "utf8")
          .replace("componentsAt: null,", 'componentsAt: ["zzOwn"],'),
      );
      expect(
        (verifyIn(box).get("У компонента есть README") ?? []).join("\n"),
      ).not.toContain("`componentsAt`");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("открытый шаг записей о живом коде держит сверки пустоты, закрытый — нет", () => {
    const box = seatEmpty("shag-derzhit-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzThing.ts"),
        "export const zzThing = 1;\n",
      );
      withTransitionDebt(box, []);
      // Счёт смягчённых печатает короткий вывод, а набор зовёт полный.
      const env = { ...process.env };
      delete env.GRAPH_VERIFY_FULL;
      const brief = () => {
        try {
          return execFileSync(
            process.execPath,
            [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
            { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env },
          );
        } catch (e) {
          return String(e.stdout ?? "");
        }
      };
      const heldOf = (out) =>
        Number(/держит посадка либо шаг перехода: (\d+)/.exec(out)?.[1] ?? 0);
      const open = brief();
      expect(open).toContain("Пока шаг открыт, прогон не роняют");
      expect(open).toContain("«Запись о пустоте не пережила появление кода»");
      expect(open).toContain("=== Файл базы о живом коде назвал его адрес ===");
      // Шаг закрыт, а пометки остались — обе сверки снова красные.
      const plan = path.join(box, ".context", "15-transition.md");
      fs.writeFileSync(
        plan,
        fs
          .readFileSync(plan, "utf8")
          .split("\n")
          .filter((l) => !l.startsWith("| 2 | Записи о живом коде"))
          .join("\n"),
      );
      const closed = brief();
      expect(closed).not.toContain("Пока шаг открыт, прогон не роняют");
      expect(heldOf(open) - heldOf(closed)).toBe(2);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("непромеренное при плане перехода держит пункт, называющий режим mutated", () => {
    const box = seatEmpty("nepromer-");
    try {
      const said = () =>
        (verifyIn(box).get("Непромеренное названо долгом перехода") ?? []).join("\n");
      // Без плана перехода проект меряет по правке.
      expect(said()).toBe("");
      withTransitionDebt(box, []);
      expect(said()).toContain("`graph.mjs mutated`");
      withTransitionDebt(box, [
        "| 1 | непромеренное мутациями | `3` | `graph.mjs mutated` | мерить по правке | `3` файла |",
      ]);
      expect(said()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("без плана перехода: пока стоит флаг посадки, проект не назван родившимся под обвязкой", () => {
    const box = seatEmpty("bezplana-");
    try {
      const said = () =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "transition"],
          { cwd: box, encoding: "utf8" },
        );
      expect(said()).toContain("посадка не завершена");
      expect(said()).not.toContain("родился под обвязкой");
      const cfg = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfg,
        fs.readFileSync(cfg, "utf8").replace("seating: 1,", "seating: 0,"),
      );
      expect(said()).toContain("родился под обвязкой");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

/**
 * Цена ярусов входа считается по КАЖДОМУ классу таблицы ярусов доктрины.
 * Список классов в режиме был зашит, и ярус удаления, дописанный в доктрину,
 * остался без цены и в режиме, и в семени фактов — замерено замером цены на
 * стенде-библиотеке.
 */
describe("цена ярусов: классы берутся из таблицы доктрины", () => {
  it("каждый класс посчитан; неизвестный класс роняет режим", () => {
    const box = seatEmpty("yarusy-");
    try {
      const tool = path.join(box, ".claude", "tools", "graph.mjs");
      const run = () => {
        try {
          return {
            status: 0,
            out: execFileSync(process.execPath, [tool, "tiers"], {
              cwd: box,
              encoding: "utf8",
            }),
          };
        } catch (e) {
          return { status: e.status, out: String(e.stdout ?? "") };
        }
      };
      const loopAt = path.join(box, ".claude", "rules", "loop.md");
      const loop = fs.readFileSync(loopAt, "utf8");
      const lines = loop.split("\n");
      const head = lines.findIndex((l) => l.startsWith("| Класс задачи |"));
      const classes = [];
      for (let i = head + 2; lines[i].startsWith("|"); i += 1)
        classes.push(lines[i].split("|")[1].trim());
      expect(classes.length).toBeGreaterThan(5);
      const clean = run();
      expect(clean.status).toBe(0);
      for (const one of classes) expect(clean.out).toContain(one + " — ");
      expect(clean.out).not.toContain("В таблице фактов нет строки");
      const at = head + 2 + classes.length;
      lines.splice(at, 0, "| Проба нового класса | что-то | то же |");
      fs.writeFileSync(loopAt, lines.join("\n"));
      const extra = run();
      expect(extra.status).toBe(1);
      expect(extra.out).toContain("Состав яруса инструменту не известен: Проба нового класса");
      expect(extra.out).toContain("В таблице фактов нет строки: Проба нового класса");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Файл узла держит модульным объявлением только сам узел. Правило стояло в
 * доктрине без крючка, и переход живого проекта не мог записать такой долг:
 * держать пункт было нечем — замерено переходом библиотеки.
 */
describe("файл узла держит только сам узел", () => {
  it("объявление рядом с узлом названо, обёрнутая функция и типы — нет, долг держит числом", () => {
    const box = seatEmpty("uzelfayl-");
    try {
      const dir = path.join(box, "src", "components", "ZzLone");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "ZzLone.tsx"),
        [
          'import { memo } from "react";',
          "type ZzProps = { size: number };",
          "const zzExtra = 1;",
          "function ZzLoneInner(props: ZzProps) {",
          "  return props.size + zzExtra;",
          "}",
          "export const ZzLone = memo(ZzLoneInner);",
          "",
        ].join("\n"),
      );
      const said = () =>
        (verifyIn(box).get("В файле узла только сам узел") ?? []).join("\n");
      const found = said();
      expect(found).toContain("`zzExtra`");
      expect(found).not.toContain("ZzLoneInner");
      expect(found).not.toContain("ZzProps");
      // Папка возможности зовётся предметом, компонент в ней — своим именем:
      // файлом узла считается компонент корня папки.
      const feature = path.join(box, "src", "components", "zzMenu");
      fs.mkdirSync(feature, { recursive: true });
      fs.writeFileSync(
        path.join(feature, "ZzMenuList.tsx"),
        'const zzPrefix = "Add";\nexport function ZzMenuList() {\n  return zzPrefix;\n}\n',
      );
      fs.writeFileSync(path.join(feature, "zzPrice.ts"), "export const zzPrice = 1;\n");
      expect(said()).toContain("zzMenu/ZzMenuList.tsx: `zzPrefix`");
      expect(said()).not.toContain("ZzMenuList`");
      fs.rmSync(feature, { recursive: true });
      // Компонент во входе папки, рядом лист её имени: файл узла — вход, а
      // лист — главный лист узла, не свалка.
      const head = path.join(box, "src", "components", "ZzHead");
      fs.mkdirSync(head, { recursive: true });
      fs.writeFileSync(
        path.join(head, "index.tsx"),
        'const zzLinks = ["a"];\nexport function ZzHead() {\n  return zzLinks.length;\n}\n',
      );
      fs.writeFileSync(path.join(head, "ZzHead.module.css"), ".zzHead {\n  margin: 0;\n}\n");
      fs.writeFileSync(path.join(head, "zzCount.ts"), "export const zzCount = 1;\n");
      fs.writeFileSync(path.join(head, "zzToggle.ts"), "export const zzToggle = 1;\n");
      expect(said()).toContain("ZzHead/index.tsx: `zzLinks`");
      const litter = (verifyIn(box).get("В корне узла только сам узел") ?? []).join("\n");
      expect(litter).toContain("zzCount.ts, zzToggle.ts");
      expect(litter).not.toContain("ZzHead.module.css");
      fs.rmSync(head, { recursive: true });
      withTransitionDebt(box, [
        "| 1 | Объявления рядом с узлом | `1` | «В файле узла только сам узел» | перенести `zzExtra` в `src/components/ZzLone/constants/` | `1` объявление |",
      ]);
      expect(said()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Конфиг звена у живого проекта лежит под своим именем, а линт обёрнут
 * храповиком долга. Сверка опоры звена искала конфиг только семенным именем,
 * а сверка заготовок брала область у обёртки, а не у линтера, — обе молчали
 * на поломке. Замерено прогоном рецептов на стенде-библиотеке.
 */
describe("конфиг звена под своим именем и линт под храповиком", () => {
  it("опора звена и исключение заготовок спрашиваются и тогда", () => {
    const box = seatEmpty("svoeimya-");
    try {
      fs.renameSync(
        path.join(box, "eslint.config.mjs"),
        path.join(box, "eslint.config.js"),
      );
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts.lint = "node .claude/tools/graph.mjs lint -- " + pkg.scripts.lint;
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const clean = verifyIn(box);
      for (const s of [
        "Звену цепочки есть на чём работать",
        "Заготовки обвязки не разбираются линтом проекта",
      ])
        expect([s, clean.get(s) ?? []]).toEqual([s, []]);
      const cfgAt = path.join(box, "eslint.config.js");
      fs.writeFileSync(
        cfgAt,
        fs.readFileSync(cfgAt, "utf8").replace('      ".claude",\n', ""),
      );
      expect(
        (verifyIn(box).get("Заготовки обвязки не разбираются линтом проекта") ?? []).join("\n"),
      ).toContain("eslint.config.js");
      pkg.scripts.lint = "npm run lint --workspaces --if-present";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      expect(
        (verifyIn(box).get("Звену цепочки есть на чём работать") ?? []).join("\n"),
      ).toContain("eslint.config.js — конфиг звена «lint»");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Номер записи в заголовке — «### Пункт 10. …», «## Вопрос 12. …» — нумерация,
 * а не счёт, и ссылка на такой раздел ёлочками тоже. Двузначный номер со
 * словом из списка счёта за ним краснел — замерено планом перехода стенда.
 * Обозначение критерия — цифра за буквой — тоже имя: «G7 строкой выше»
 * краснело в базе ревьюера пробы.
 */
/**
 * Протокол свода — не запись базы: строка его модели «мутационный замер: не
 * мерено» требовала пункта долга под себя. Найдено ревьюером пробы.
 */
describe("незамеренное в протоколе свода записью не считается", () => {
  it("протокол молчит, та же строка в фактах без записи краснеет", () => {
    const box = seatEmpty("nemereno-");
    try {
      const said = () =>
        (verifyIn(box).get("Незамеренное названо находкой") ?? []).join("\n");
      fs.writeFileSync(
        path.join(box, ".context", "bar-protocol.md"),
        "# Свод\n\n| П1 | тесты | `app/zz.ts` | мутационный замер: не мерено |  |  |  | код |\n",
      );
      expect(said()).toBe("");
      fs.appendFileSync(path.join(box, ".context", "01-facts.md"), "\nЦена прогона: не мерено.\n");
      expect(said()).toContain("замер отложен");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("таблица связей при пустом поле настройки", () => {
  // Сверка связей читает таблицу только по полю `domTables`; строка,
  // вписанная при пустом поле, не сверялась ничем.
  it("строка таблицы при пустом поле названа, пустая таблица молчит", () => {
    const box = seatEmpty("domtables-");
    try {
      const disarmedOf = () =>
        (verifyIn(box).get("Сверки, выключенные при живом предмете") ?? []).join("\n");
      expect(disarmedOf()).not.toContain("domTables");
      const at = path.join(box, ".context", "03-graph.md");
      fs.writeFileSync(
        at,
        fs
          .readFileSync(at, "utf8")
          .replace(
            "| Имя в коде | Кто пишет | Кто читает |\n| --- | --- | --- |\n",
            "| Имя в коде | Кто пишет | Кто читает |\n| --- | --- | --- |\n| `zz-topic` | `src/app/App.tsx` | `src/app/main.tsx` |\n",
          ),
      );
      expect(disarmedOf()).toContain("03-graph.md, строк 1), а CONFIG.domTables пуст");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("смоук заведён при пустой области", () => {
  // Пустая область смоука при заведённом смоуке превращала «по требованию»
  // в «никогда»: `tested` на каждой правке отвечал, что прогон не нужен.
  it("скрипт смоука либо конфиг Playwright при пустой области названы", () => {
    const box = seatEmpty("smoke-");
    try {
      const disarmedOf = () =>
        (verifyIn(box).get("Сверки, выключенные при живом предмете") ?? []).join("\n");
      expect(disarmedOf()).not.toContain("smokeScope");
      const manifestAt = path.join(box, "package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestAt, "utf8"));
      manifest.scripts["test:e2e"] = "playwright test";
      fs.writeFileSync(manifestAt, JSON.stringify(manifest, null, 2) + "\n");
      expect(disarmedOf()).toContain("смоук в браузере заведён (скрипт test:e2e в манифесте), а CONFIG.smokeScope пуст");
      delete manifest.scripts["test:e2e"];
      fs.writeFileSync(manifestAt, JSON.stringify(manifest, null, 2) + "\n");
      fs.writeFileSync(path.join(box, "playwright.config.ts"), "export default {};\n");
      expect(disarmedOf()).toContain("смоук в браузере заведён (playwright.config.ts), а CONFIG.smokeScope пуст");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  // Семя несёт `npm run test:e2e`; у живого проекта со смоуком под другим
  // именем `tested` велел прогнать несуществующий скрипт.
  it("команда смоука без своего скрипта в манифесте названа", () => {
    const box = seatEmpty("smokecmd-");
    try {
      const goneOf = () =>
        (verifyIn(box).get("Объявленные области существуют") ?? []).join("\n");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs.readFileSync(cfgAt, "utf8").replace("  smokeScope: [],", '  smokeScope: ["src/app/App.tsx"],'),
      );
      expect(goneOf()).toContain("команда смоука: npm run test:e2e — скрипта test:e2e в манифесте нет");
      const manifestAt = path.join(box, "package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestAt, "utf8"));
      manifest.scripts["test:e2e"] = "playwright test";
      fs.writeFileSync(manifestAt, JSON.stringify(manifest, null, 2) + "\n");
      expect(goneOf()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("номер записи в заголовке не счёт", () => {
  it("заголовок и ссылка на него молчат, счёт в прозе краснеет", () => {
    const box = seatEmpty("nomer-");
    try {
      const todo = path.join(box, ".context", "02-todo.md");
      fs.appendFileSync(
        todo,
        "\n### Пункт 10. Файл узла\n\nПлан — раздел «Пункт 10. Файл узла».\n\nНаходка G7 строкой выше.\n",
      );
      const said = () =>
        (verifyIn(box).get("Числа в прозе базы") ?? []).join("\n");
      expect(said()).toBe("");
      fs.appendFileSync(todo, "\n```\nОсталось 11 файлов.\n```\n");
      expect(said()).toBe("");
      fs.appendFileSync(todo, "\nОсталось 10 файлов.\n");
      expect(said()).toContain("02-todo.md");
      // Узел и компонент — счёт того же рода, что файлы.
      fs.appendFileSync(todo, "\nВ области семь узлов и два компонента.\n");
      expect(said()).toContain("семь узлов");
      expect(said()).toContain("два компонента");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("номер из нескольких уровней и название раздела в ёлочках молчат, ёлочки без раздела краснеют", () => {
    const box = seatEmpty("nomer-levels-");
    try {
      const todo = path.join(box, ".context", "02-todo.md");
      fs.appendFileSync(
        todo,
        "\n### 2.2. Тексты правил\n\n2.3. Сверка файлов.\n\n- 1.4. Замер модулей\n\n" +
          "| 2.5. Правка строк | да |\n\nПодшаг — раздел «2.2. Тексты правил»; он же раздел «Тексты правил».\n\n" +
          "Опора — `permissions.md`, раздел «Два файла разрешений, и границу между ними проводит среда».\n",
      );
      const said = () =>
        (verifyIn(box).get("Числа в прозе базы") ?? []).join("\n");
      const first = verifyIn(box);
      expect((first.get("Числа в прозе базы") ?? []).join("\n")).toBe("");
      expect((first.get("Ссылки на разделы") ?? []).join("\n")).not.toContain(
        "Тексты правил",
      );
      fs.appendFileSync(todo, "\nОпора — «Два файла правил».\n");
      expect(said()).toContain("— Два файла");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("засеянный файл, которого нет, назван", () => {
  it("свежая посадка молчит, конфиг линта под другим именем назван строкой seeded", () => {
    const box = seatEmpty("seeded-gone-");
    try {
      const said = () =>
        (verifyIn(box).get("Шаблон правил заполнен") ?? []).join("\n");
      expect(said()).not.toContain("засеянного файла нет");
      fs.renameSync(
        path.join(box, "eslint.config.mjs"),
        path.join(box, "eslint.config.js"),
      );
      expect(said()).toContain("../eslint.config.mjs: засеянного файла нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("сводка открытого собирает записи, а не образцы в ограде", () => {
  it("«не закреплено» и «Держится: ничем» в ограде кода в сводку не попадают, те же строки вне ограды — попадают", () => {
    const box = seatEmpty("open-fence-");
    try {
      const idioms = path.join(box, ".context", "10-idioms.md");
      const open = () =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "open"],
          { cwd: box, encoding: "utf8" },
        );
      const sample = "Поломка: не закреплено тестом.\nДержится: ничем\n";
      fs.appendFileSync(idioms, "\n```\n" + sample + "```\n");
      expect(open()).not.toContain("10-idioms.md");
      fs.appendFileSync(idioms, "\n" + sample);
      const said = open();
      expect(said).toContain("не закреплено тестом");
      expect(said).toContain("Держится: ничем");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Комментарий разметки между строками таблицы обрывает её: отрисовка по GFM
 * показывает строки ниже прозой, а читатель таблиц инструмента берёт первую
 * из них за шапку. Так стояли пометки каркаса в семенах карты и реестра
 * тестов — найдено пробой планки.
 */
describe("таблица базы не разорвана комментарием", () => {
  it("свежая посадка чиста, комментарий между строками назван, за таблицей законен", () => {
    const box = seatEmpty("torn-");
    try {
      const tests = path.join(box, ".context", "08-tests.md");
      const seeded = fs.readFileSync(tests, "utf8");
      const torn = "Таблица базы не разорвана комментарием";
      const said = () => (verifyIn(box).get(torn) ?? []).join("\n");
      expect(said()).toBe("");
      const head = "| --- | --- |\n";
      fs.writeFileSync(tests, seeded.replace(head, head + "<!-- КАРКАС -->\n"));
      expect(said()).toContain(".context/08-tests.md:8");
      const tail = "входы не меняются |\n";
      fs.writeFileSync(tests, seeded.replace(tail, tail + "<!-- конец -->\n"));
      expect(said()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Находки прогона обвязки на мини-стенде: посадка, переход и две работы
 * по слову пользователя. Каждая — поломка, которую прежде не ловило ничто,
 * а ловил человек, проходивший процесс руками.
 */
describe("находки мини-стенда: факты, долг, отложенное, перенос", () => {
  const toolAt = (box) => (...args) => {
    try {
      return {
        code: 0,
        out: execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (e) {
      return { code: e.status, out: String(e.stdout ?? "") };
    }
  };
  const write = (box, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
    fs.writeFileSync(path.join(box, rel), text);
  };
  const edit = (box, rel, from, to) => {
    const at = path.join(box, rel);
    const had = fs.readFileSync(at, "utf8");
    expect(had).toContain(from);
    fs.writeFileSync(at, had.replace(from, to));
  };
  // Общий слой берёт компонент, корень композиции — файл узла без бочки.
  const layered = (box) => {
    write(
      box,
      "src/components/zzA/zzA.tsx",
      "export const ZZ_STEP = 1;\n\nexport function ZzA() {\n  return <b>{ZZ_STEP}</b>;\n}\n",
    );
    write(
      box,
      "src/shared/zzs/zzs.ts",
      'import { ZZ_STEP } from "../../components/zzA/zzA";\n\nexport const zzs = (): number => ZZ_STEP;\n',
    );
    write(
      box,
      "src/app/zzApp.tsx",
      'import { ZzA } from "../components/zzA/zzA";\n\nexport const ZzApp = () => <ZzA />;\n',
    );
    edit(
      box,
      ".context/00-map.md",
      "| `shared` | `app` |  |",
      "| `shared` | `app`, `components` |  |",
    );
  };

  it("вход узла без бочки — файл узла; ребро держит запись, назвавшая оба конца", () => {
    const box = seatEmpty("ministend-");
    try {
      layered(box);
      const tool = toolAt(box);
      // Файл узла, названный как папка, при отсутствии бочки — вход.
      expect(tool("levels").out).not.toMatch(/граница: app\/zzApp\.tsx/);
      write(box, "src/components/zzA/index.ts", 'export { ZzA } from "./zzA";\n');
      expect(tool("levels").out).toMatch(/граница: app\/zzApp\.tsx → components\/zzA\/zzA\.tsx/);
      fs.rmSync(path.join(box, "src/components/zzA/index.ts"));
      // Ребро против правила красно, пока его не назовёт запись с ОБОИМИ концами.
      expect(verifyIn(box).get("Правила направления")).toEqual([
        "shared/zzs/zzs.ts → components/zzA/zzA.tsx",
      ]);
      withTransitionDebt(box, [
        "| 1 | Линт в `src/shared/zzs/zzs.ts` | `1` | «lint» | снять | `1` место |",
      ]);
      expect(verifyIn(box).get("Правила направления")).toEqual([
        "shared/zzs/zzs.ts → components/zzA/zzA.tsx",
      ]);
      expect(tool("levels").out).toMatch(/направление: [^\n]*— не назван/);
      withTransitionDebt(box, [
        "| 2 | Ребро `src/shared/zzs/zzs.ts` → `src/components/zzA/zzA.tsx` | `1` | «Правила направления» | шаг — параметром | `1` импорт |",
      ]);
      expect(verifyIn(box).get("Правила направления")).toBeUndefined();
      expect(tool("levels").out).toMatch(/направление: [^\n]*— назван: 15-transition\.md/);
      // Ребро к запрещённому ПАКЕТУ: второй конец — имя пакета, и запись
      // без него ребра не держит.
      edit(
        box,
        ".context/00-map.md",
        "| `shared` | `app`, `components` |  |",
        "| `shared` | `app`, `components`, `react` |  |",
      );
      write(box, "src/shared/zzs/zzr.ts", 'import { useId } from "react";\n\nexport const zzr = useId;\n');
      withTransitionDebt(box, [
        "| 3 | Линт в `src/shared/zzs/zzr.ts` | `1` | «lint» | снять | `1` место |",
      ]);
      expect(tool("levels").out).toMatch(/направление: shared\/zzs\/zzr\.ts → react[^\n]*— не назван/);
      expect(verifyIn(box).get("Правила направления")).toEqual(["shared/zzs/zzr.ts → react"]);
      withTransitionDebt(box, [
        "| 4 | Общий слой зовёт `react`: `src/shared/zzs/zzr.ts` | `1` | «Правила направления» | убрать | `1` импорт |",
      ]);
      expect(tool("levels").out).toMatch(/направление: shared\/zzs\/zzr\.ts → react[^\n]*— назван/);
      expect(verifyIn(box).get("Правила направления")).toBeUndefined();
      // Новое ребро такой записи не имеет и краснеет.
      write(
        box,
        "src/shared/zzs/zzt.ts",
        'import { ZzA } from "../../components/zzA/zzA";\n\nexport const zzt = ZzA;\n',
      );
      expect(verifyIn(box).get("Правила направления")).toEqual([
        "shared/zzs/zzt.ts → components/zzA/zzA.tsx",
      ]);
      // Тест едет со своей единицей: ребро из него вверх рвёт перенос так же.
      fs.rmSync(path.join(box, "src/shared/zzs/zzt.ts"));
      write(
        box,
        "src/shared/zzs/tests/zzs.test.ts",
        'import { ZzA } from "../../../components/zzA/zzA";\n\nexport const zzu = ZzA;\n',
      );
      expect(verifyIn(box).get("Правила направления")).toEqual([
        "shared/zzs/tests/zzs.test.ts → components/zzA/zzA.tsx",
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  // Изоляция — то же правило о границе слоя: тест едет со своей единицей.
  it("изоляция слоя судит и тест", () => {
    const box = seatEmpty("izolyaciya-");
    try {
      edit(
        box,
        ".context/graph.config.mjs",
        "  isolationHeading: null,",
        '  isolationHeading: "Изоляция слоёв",',
      );
      fs.appendFileSync(
        path.join(box, ".context", "00-map.md"),
        "\n## Изоляция слоёв\n\n| Слой | Можно брать |\n| --- | --- |\n| `shared/zzi` | `shared/zzi` |\n",
      );
      write(box, "src/shared/zzi/zzi.ts", "export const zzi = 1;\n");
      write(box, "src/shared/zzo/zzo.ts", "export const zzo = 2;\n");
      expect(verifyIn(box).get("Правила изоляции")).toBeUndefined();
      write(
        box,
        "src/shared/zzi/tests/zzi.test.ts",
        'import { zzo } from "../../zzo/zzo";\n\nexport const zzu = zzo;\n',
      );
      expect(verifyIn(box).get("Правила изоляции")).toEqual([
        "shared/zzi/tests/zzi.test.ts → shared/zzo/zzo.ts",
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("пункт про одно описание конвейера другого не держит; номер чужого перечня в отложенном законен", () => {
    const box = seatEmpty("ministend-ci-");
    try {
      const flow = (name) =>
        write(
          box,
          ".github/workflows/" + name,
          "name: b\non: [push]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm run build\n",
        );
      flow("a.yml");
      expect(verifyIn(box).get("Конвейер зовёт проверки")?.length).toBe(1);
      withTransitionDebt(box, [
        "| 1 | Конвейер не зовёт проверок | `1` | «Конвейер зовёт проверки» | `.github/workflows/a.yml` — звать `npm run check` | `1` файл |",
      ]);
      expect(verifyIn(box).get("Конвейер зовёт проверки")).toBeUndefined();
      flow("b.yml");
      const red = verifyIn(box).get("Конвейер зовёт проверки") ?? [];
      expect(red).toHaveLength(1);
      expect(red[0]).toMatch(/^\.github\/workflows\/b\.yml/);
      // Отложенное ссылается на пункт долга перехода — это не его пункт.
      edit(
        box,
        ".context/02-todo.md",
        "Пункты пишут ниже этой черты; пустой файл законен.",
        "Пункты пишут ниже этой черты; пустой файл законен.\n\n## 1. Проба\n\nГде: `src/app/App.tsx`. Почему отложено: это пункт 10 долга перехода. Чем закроется: пункт 7.",
      );
      expect(verifyIn(box).get("Отложенное без закрытых пунктов")).toEqual([
        expect.stringMatching(/^02-todo\.md:\d+ — пункта 7 там нет$/),
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it(".nvmrc обязан сходиться с engines манифеста: ниже нижней границы красит «Диапазон среды объявлен», частичная версия подходит", () => {
    const box = seatEmpty("nvmrc-");
    try {
      const range = () => verifyIn(box).get("Диапазон среды объявлен");
      const pin = (text) => write(box, ".nvmrc", text);
      pin("22.23.2\n");
      expect(range()).toBeUndefined();
      // Часть версии сравнивается по названным частям: «22» подходит.
      for (const fine of [
        "22",
        "v22.23.2",
        "22.30.1",
        "lts/*",
        "# заметка\n22.23.2",
      ]) {
        pin(fine + "\n");
        expect(range(), fine).toBeUndefined();
      }
      for (const low of ["18", "22.20.0", "22.23.1", "v22.22"]) {
        pin(low + "\n");
        expect(range(), low).toEqual([
          expect.stringMatching(/^\.nvmrc называет /),
        ]);
      }
      // Та же версия под другим именем семени: `.node-version` и
      // `.tool-versions` проекта читаются так же.
      fs.rmSync(path.join(box, ".nvmrc"));
      write(box, ".node-version", "18\n");
      expect(range()).toEqual([expect.stringMatching(/^\.node-version называет 18,/)]);
      write(box, ".node-version", "22.23.2\n");
      expect(range()).toBeUndefined();
      fs.rmSync(path.join(box, ".node-version"));
      write(box, ".tool-versions", "python 3.12.1\nnodejs 18.0.0\n");
      expect(range()).toEqual([expect.stringMatching(/^\.tool-versions называет 18\.0\.0,/)]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("заявленный вложенный файл правил обязан нести путь до корневого от своей папки", () => {
    const box = seatEmpty("vlozhennye-pravila-");
    try {
      const section = () =>
        verifyIn(box).get("Разделы правил классифицированы");
      edit(
        box,
        ".context/graph.config.mjs",
        '    rules: ["../CLAUDE.md"],',
        '    rules: ["../CLAUDE.md", "../src/app/CLAUDE.md"],',
      );
      write(
        box,
        "src/app/CLAUDE.md",
        "# Правила папки\n\nЧитают как весь свод.\n",
      );
      expect(section()).toEqual([
        "вложенный файл правил не указывает на корневой: ../src/app/CLAUDE.md — нет пути ../../CLAUDE.md",
      ]);
      // Путь от другой папки — не указатель: сверка ждёт путь от папки файла.
      write(
        box,
        "src/app/CLAUDE.md",
        "# Правила папки\n\nКорень: ../CLAUDE.md\n",
      );
      expect(section()).toHaveLength(1);
      // Путь глубже нужного содержит верный как подстроку, но ведёт выше корня.
      write(
        box,
        "src/app/CLAUDE.md",
        "# Правила папки\n\nКорень: ../../../CLAUDE.md\n",
      );
      expect(section()).toHaveLength(1);
      write(
        box,
        "src/app/CLAUDE.md",
        "# Правила папки\n\nКорень: [CLAUDE.md](../../CLAUDE.md)\n",
      );
      expect(section()).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("маркер отложенной работы в прозе доктрины красит сверку так же, как в правилах проекта; описание маркера в кавычках — нет", () => {
    const box = seatEmpty("marker-doctrine-");
    try {
      const parked = () =>
        verifyIn(box).get("Найденное — исправлено, а не отложено");
      const at = path.join(box, ".claude", "rules", "code.md");
      const clean = fs.readFileSync(at, "utf8");
      expect(parked()).toBeUndefined();
      fs.appendFileSync(at, "\nМаркер `ПОТОМ` описан в кавычках.\n");
      expect(parked()).toBeUndefined();
      fs.appendFileSync(at, "\n```\nПОТОМ: пример разметки\n```\n");
      expect(parked()).toBeUndefined();
      fs.appendFileSync(at, "\nПОТОМ разобрать.\n");
      expect(parked()).toEqual([
        expect.stringMatching(
          /\.claude\/rules\/code\.md:\d+ — маркер отложенной работы в тексте$/,
        ),
      ]);
      fs.writeFileSync(at, clean);
      expect(parked()).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("форма вопроса разработчику судится своей сверкой: вопрос без граф и вопрос, помеченный закрытым, красят её, а не сверку про корпус", () => {
    const box = seatEmpty("voprosy-forma-");
    try {
      const questionsAt = path.join(box, ".context", "13-questions.md");
      const form = () => verifyIn(box).get("Вопросы записаны по форме");
      const corpus = () =>
        verifyIn(box).get("Каждая сверка называет свой корпус");
      const clean = fs.readFileSync(questionsAt, "utf8");
      expect(form()).toBeUndefined();
      fs.appendFileSync(
        questionsAt,
        "\n## Вопрос 1. Проба\n\n**Задан:** проба.\n",
      );
      expect(form()).toEqual([
        "«Проба» — нет граф: Что решить, Последствие отсутствия ответа",
      ]);
      expect(corpus()).toBeUndefined();
      fs.writeFileSync(
        questionsAt,
        clean +
          "\n## Вопрос 2. Проба (закрыто)\n\n**Задан:** проба.\n\n**Что решить.** проба.\n\n**Последствие отсутствия ответа.** проба.\n",
      );
      expect(form()).toEqual([
        "помечен закрытым, а не удалён: Проба (закрыто)",
      ]);
      // Близкая по виду форма списком не читается: вопрос выпал бы молча.
      for (const head of [
        "## Вопрос 4: Проба",
        "### Вопрос 4. Проба",
        "## Вопрос 4.",
      ]) {
        fs.writeFileSync(
          questionsAt,
          clean + "\n" + head + "\n\n**Задан:** проба.\n",
        );
        expect(form(), head).toEqual([
          "заголовок не по форме «## Вопрос N. …»: " + head,
        ]);
      }
      // Пример формы в ограде кода — не вопрос и не нарушение формы.
      fs.writeFileSync(
        questionsAt,
        clean + "\n```\n## Вопрос 5: пример формы\n```\n",
      );
      expect(form()).toBeUndefined();
      fs.writeFileSync(
        questionsAt,
        clean +
          "\n## Вопрос 3. Проба\n\n**Задан:** проба.\n\n**Что решить.** проба.\n\n**Последствие отсутствия ответа.** проба.\n",
      );
      expect(form()).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("шапка скилла судится целиком: без имени, с чужим именем, без признака вызова и без описания сверка «Скиллы проекта» краснеет, а описание на следующих строках — законно", () => {
    const box = seatEmpty("skill-head-");
    try {
      const at = path.join(box, ".claude", "skills", "task", "SKILL.md");
      const clean = fs.readFileSync(at, "utf8");
      const drift = () => verifyIn(box).get("Скиллы проекта");
      const rewrite = (change) => {
        const next = change(clean);
        expect(next).not.toBe(clean);
        fs.writeFileSync(at, next);
      };
      expect(drift()).toBeUndefined();
      rewrite((t) => t.replace(/^name:.*\n/m, ""));
      expect(drift()).toEqual(["в шапке нет имени: task"]);
      rewrite((t) => t.replace(/^name:.*$/m, "name: other"));
      expect(drift()).toEqual([
        "имя в шапке не совпадает с папкой: task ≠ other",
      ]);
      rewrite((t) => t.replace(/^user-invocable:.*\n/m, ""));
      expect(drift()).toEqual(["не вызываем по имени: task"]);
      rewrite((t) => t.replace(/^description:.*\n/m, ""));
      expect(drift()).toEqual(["в шапке нет описания: task"]);
      rewrite((t) => t.replace(/^description:.*$/m, "description:"));
      expect(drift()).toEqual(["в шапке нет описания: task"]);
      rewrite((t) => t.replace(/^description:.*$/m, 'description: ""'));
      expect(drift()).toEqual(["в шапке нет описания: task"]);
      rewrite((t) =>
        t.replace(/^description:.*$/m, "description: >\n  Начать задачу."),
      );
      expect(drift()).toBeUndefined();
      fs.writeFileSync(at, clean);
      expect(drift()).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("имя сверки в прозе полки должно быть среди сверок: переименованное краснит, начало имени до скобки и образец в ограде — нет", () => {
    const box = seatEmpty("check-name-");
    try {
      const at = path.join(box, ".claude", "rules", "code.md");
      const clean = fs.readFileSync(at, "utf8");
      const gone = () =>
        verifyIn(box).get("Имя сверки в тексте есть среди сверок");
      expect(gone()).toBeUndefined();
      fs.appendFileSync(at, "\nСверка «Версия среды» названа началом имени.\n");
      expect(gone()).toBeUndefined();
      fs.appendFileSync(
        at,
        "\n```\nСверка «Такой сверки нет» показана.\n```\n",
      );
      expect(gone()).toBeUndefined();
      fs.appendFileSync(at, "\nСверка «Такой сверки нет» названа.\n");
      expect(gone()).toEqual([
        expect.stringMatching(/rules\/code\.md:\d+ — «Такой сверки нет»$/),
      ]);
      fs.writeFileSync(at, clean);
      expect(gone()).toBeUndefined();
      // Проза перенесена по ширине: слово и имя на разных строках, имя
      // перенесено внутри, два имени после одного слова.
      for (const [said, shown] of [
        ["Сверка\n«Такой сверки нет» держит.", "Такой сверки нет"],
        ["Сверка «Такой\nсверки нет» держит.", "Такой сверки нет"],
        [
          "Сверки «Покрытие карты» и «Такой сверки нет» держат.",
          "Такой сверки нет",
        ],
      ]) {
        fs.writeFileSync(at, clean + "\n" + said + "\n");
        expect(gone(), said).toEqual([
          expect.stringMatching(new RegExp(" — «" + shown + "»$")),
        ]);
      }
      // Запись без буквы в кавычках — образец формы, а не имя.
      fs.writeFileSync(at, clean + "\nСверка «…» названа образцом.\n");
      expect(gone()).toBeUndefined();
      fs.writeFileSync(at, clean);
      expect(gone()).toBeUndefined();
      // Запись базы называет сверку тем же словом, и её имя стареет так же.
      const record = path.join(box, ".context", "10-idioms.md");
      const recordClean = fs.readFileSync(record, "utf8");
      fs.appendFileSync(record, "\nДержит это сверка «Такой сверки нет».\n");
      expect(gone()).toEqual([
        expect.stringMatching(/10-idioms\.md:\d+ — «Такой сверки нет»$/),
      ]);
      fs.writeFileSync(record, recordClean);
      expect(gone()).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("ограда кода без пары называется, потому что прячет всё ниже себя от сверок прозы; закрытая и тильдовая — нет", () => {
    const box = seatEmpty("fence-open-");
    try {
      const at = path.join(box, ".context", "10-idioms.md");
      const clean = fs.readFileSync(at, "utf8");
      const open = () => verifyIn(box).get("Ограда кода в прозе закрыта");
      const parked = () =>
        verifyIn(box).get("Найденное — исправлено, а не отложено");
      expect(open()).toBeUndefined();
      fs.appendFileSync(at, "\n```\nобразец\n```\n\n~~~\nобразец\n~~~\n");
      expect(open()).toBeUndefined();
      fs.appendFileSync(
        at,
        "\n```\nобразец без закрытия\n\nПОТОМ разобрать.\n",
      );
      expect(open()).toEqual([
        expect.stringMatching(
          /10-idioms\.md:\d+ — ограда открыта и не закрыта$/,
        ),
      ]);
      // Пока ограда не закрыта, маркер под ней сверка маркеров не видит.
      expect(parked()).toBeUndefined();
      fs.writeFileSync(at, clean + "\n~~~\nобразец без закрытия\n");
      expect(open()).toEqual([
        expect.stringMatching(
          /10-idioms\.md:\d+ — ограда открыта и не закрыта$/,
        ),
      ]);
      fs.writeFileSync(at, clean);
      expect(open()).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("таблица файлов базы сверяется с семенами в обе стороны: строка без семени, семя без строки и файл созданный работой без строки краснят её", () => {
    const box = seatEmpty("base-table-");
    try {
      const doc = path.join(box, ".claude", "rules", "base-format.md");
      const map = path.join(box, ".claude", "seat", "map.json");
      const clean = fs.readFileSync(doc, "utf8");
      const mapClean = fs.readFileSync(map, "utf8");
      const drift = () =>
        verifyIn(box).get("Таблица файлов базы сходится с семенами");
      expect(drift()).toBeUndefined();
      fs.writeFileSync(
        doc,
        clean.replace("| `02-todo.md` |", "| `02-todo-нет.md` |"),
      );
      expect(drift()).toEqual(
        expect.arrayContaining([
          expect.stringContaining("семя 02-todo.md"),
          expect.stringContaining("строка 02-todo-нет.md"),
        ]),
      );
      fs.writeFileSync(doc, clean);
      fs.writeFileSync(map, mapClean.replace('"falsify.json", ', ""));
      expect(drift()).toEqual([expect.stringContaining("строка falsify.json")]);
      fs.writeFileSync(
        map,
        mapClean.replace('"mutation-ledger.json"', '"zz-нет.json"'),
      );
      expect(drift()).toEqual(
        expect.arrayContaining([
          expect.stringContaining("строка mutation-ledger.json"),
          expect.stringContaining("zz-нет.json назван"),
        ]),
      );
      fs.writeFileSync(map, mapClean);
      // Раздел переименован: таблицы не нашли, а не «расхождений нет».
      fs.writeFileSync(doc, clean.replace("\n## Файлы\n", "\n## Состав\n"));
      expect(drift()).toEqual([
        expect.stringContaining("не найден раздел «Файлы»"),
      ]);
      // Строка повторена.
      fs.writeFileSync(
        doc,
        clean.replace(/^(\| `02-todo\.md` \|.*)$/m, "$1\n$1"),
      );
      expect(drift()).toEqual([
        expect.stringContaining(
          "строка 02-todo.md в таблице `base-format.md` повторена",
        ),
      ]);
      fs.writeFileSync(doc, clean);
      expect(drift()).toBeUndefined();
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("образец в ограде кода не запись для сверок ссылок на разделы, парности обещаний и новых якорей", () => {
    const box = seatEmpty("fence-readers-");
    try {
      const get = (name) => verifyIn(box).get(name);
      // Сверка новых якорей читает дифф против последнего коммита.
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
      const idioms = path.join(box, ".context", "10-idioms.md");
      const sample = "См. раздел «Нет такого раздела» и `src/app/App.tsx:3`.\n";
      fs.appendFileSync(idioms, "\n```\n" + sample + "```\n");
      expect(get("Ссылки на разделы")).toBeUndefined();
      expect(get("Новые якоря — с цитатой")).toBeUndefined();
      fs.appendFileSync(idioms, "\n" + sample);
      expect(get("Ссылки на разделы")).toEqual([
        expect.stringContaining("«Нет такого раздела»"),
      ]);
      expect(get("Новые якоря — с цитатой")).toEqual([
        expect.stringContaining("App.tsx:3` — якорь без цитаты"),
      ]);
      fs.writeFileSync(
        idioms,
        fs.readFileSync(idioms, "utf8").split("\n```\n")[0] + "\n",
      );
      const inv = path.join(box, ".context", "07-invariants.md");
      const invClean = fs.readFileSync(inv, "utf8");
      const heading = "## Обещания обвязки, которые не держит машина\n";
      expect(invClean).toContain(heading);
      fs.writeFileSync(
        inv,
        invClean.replace(heading, heading + "\n```\nДержится: ничем\n```\n"),
      );
      expect(get("Обещания без опоры собираются сводкой")).toBeUndefined();
      fs.writeFileSync(
        inv,
        invClean.replace(heading, heading + "\nДержится: ничем\n"),
      );
      expect(get("Обещания без опоры собираются сводкой")).toEqual([
        expect.stringContaining("«Держится» без «Сломается»"),
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("образец в ограде кода не запись для сверок номера гарантии, имени из кода и имени константы", () => {
    const box = seatEmpty("fence-names-");
    try {
      const get = (name) => verifyIn(box).get(name);
      const notes = path.join(box, ".context", "08-tests.md");
      // Имя собрано из частей: целиком в тексте теста оно считалось бы живым,
      // ведь тест лежит в тех же исходниках, что проверяет сверка.
      const ghost = ["zzAbsent", "Nowhere"].join("");
      const sample =
        "Гарантия REQ-9, имя `" + ghost + "`, константа `NO_SUCH_CONSTANT`.\n";
      fs.appendFileSync(notes, "\n```\n" + sample + "```\n");
      for (const name of [
        "Гарантия держится тестом",
        "Имена из кода в тексте",
        "Имена констант в тексте",
      ])
        expect(get(name), name).toBeUndefined();
      fs.appendFileSync(notes, "\n" + sample);
      expect(get("Гарантия держится тестом")).toEqual([
        expect.stringContaining("REQ-9: в таблице такой нет"),
      ]);
      expect(get("Имена из кода в тексте")).toEqual([
        expect.stringContaining(ghost),
      ]);
      expect(get("Имена констант в тексте")).toEqual([
        expect.stringContaining("NO_SUCH_CONSTANT"),
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("ворота стенда вне собранного стенда отказывают одной строкой, а не претензией к каждой посадке", () => {
    const box = seatEmpty("stand-not-");
    try {
      const env = { ...process.env };
      delete env.CLAUDE_CODE_CHILD_SESSION;
      const run = spawnSync(
        process.execPath,
        [
          path.join(box, ".claude", "tools", "graph.mjs"),
          "bar-probe",
          "--stand-check",
        ],
        { cwd: box, encoding: "utf8", env },
      );
      expect(run.status, run.stdout).toBe(1);
      expect(run.stdout).toContain("Это не собранный стенд");
      expect(run.stdout).toContain("--stand-build");
      expect(run.stdout).not.toContain("не прошли ворота");
      expect(run.stdout.split("\n").length).toBeLessThan(12);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);

  it("протокол прошлой работы в новую не переносится; ушедшая строка модели пересобирает протокол", () => {
    const box = seatEmpty("ministend-perenos-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=m", "-c", "user.email=m@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = toolAt(box);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "seat");
      // Ворота стоят, история есть — основание ревизии обязано быть объявлено.
      execFileSync("git", ["config", "core.hooksPath", ".claude/hooks/git"], { cwd: box });
      const disarmedOf = () => verifyIn(box).get("Сверки, выключенные при живом предмете") ?? [];
      expect(disarmedOf()).toEqual(
        expect.arrayContaining([expect.stringMatching(/CONFIG\.barSince пуст/)]),
      );
      edit(box, ".context/graph.config.mjs", "  barSince: null,", '  barSince: "' + git("rev-parse", "HEAD").trim() + '",');
      // Основание серии объявляют вместе с ним: без него ревизия судит всю
      // историю прежним правилом, и коммит мимо серии не краснеет.
      const withBar = disarmedOf();
      expect(
        withBar.some(
          (one) => one.includes("barSince") && !one.includes("seriesSince"),
        ),
      ).toBe(false);
      expect(withBar).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/CONFIG\.seriesSince пуст/),
        ]),
      );
      edit(
        box,
        ".context/graph.config.mjs",
        "  seriesSince: null,",
        '  seriesSince: "' + git("rev-parse", "HEAD").trim() + '",',
      );
      expect(disarmedOf().some((one) => one.includes("seriesSince"))).toBe(
        false,
      );
      // Состояние даёт модели строку с якорем на строку файла — ту, что
      // досье правки прежде советовало дописать цитатой.
      write(
        box,
        "src/components/zzP/zzP.tsx",
        'import { useState } from "react";\n\nexport function ZzP() {\n  const [on, setOn] = useState(false);\n  return <i onClick={() => setOn(!on)}>p</i>;\n}\n',
      );
      const proto = path.join(box, ".context", "bar-protocol.md");
      tool("bar");
      expect(fs.readFileSync(proto, "utf8")).toMatch(/^- строк модели от инструмента: `\d+`$/m);
      fillBar(proto, { release: "нет" });
      expect(tool("bar").out).toContain("печать поставлена");
      // Якоря протокола правят не руками: досье правки их не называет.
      expect(fs.readFileSync(proto, "utf8")).toMatch(/`components\/zzP\/zzP\.tsx:4`/);
      expect(tool("tested").out).not.toMatch(/bar-protocol\.md: `/);
      git("add", "-A");
      git("commit", "-qm", "p");
      write(box, "src/components/zzQ/zzQ.tsx", "export function ZzQ() {\n  return <i>q</i>;\n}\n");
      const next = tool("bar").out;
      expect(next).toContain("протокол напечатан");
      expect(next).not.toContain("исходы перенесены");
      // Переход: строка «граница» ушла из конца модели узла — протокол пересобран.
      layered(box);
      write(box, "src/components/zzA/index.ts", 'export { ZzA } from "./zzA";\n');
      withTransitionDebt(box, []);
      tool("bar", "--transition");
      const appProto = path.join(box, ".context", "15-transition-bar", "node--app--zzApp.tsx.md");
      expect(fs.readFileSync(appProto, "utf8")).toMatch(/\| граница \|/);
      fillBar(appProto, { release: "нет" });
      tool("bar", "--transition");
      fs.rmSync(path.join(box, "src/components/zzA/index.ts"));
      const again = tool("bar", "--transition").out;
      expect(again).toContain("пересобран: 15-transition-bar/node--app--zzApp.tsx.md");
      expect(fs.readFileSync(appProto, "utf8")).not.toMatch(/\| граница \|/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("пункт долга, задетый правкой, чинится: ни «чисто», ни «отложено», пункт правится; чтение без второй записи", () => {
    const box = seatEmpty("ministend-dolg-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=m", "-c", "user.email=m@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tool = toolAt(box);
      layered(box);
      // Цикл: компонент зовёт общий модуль, а тот берёт у компонента шаг.
      write(
        box,
        "src/components/zzA/zzA.tsx",
        'import { zzs } from "../../shared/zzs/zzs";\n\nexport const ZZ_STEP = 1;\n\nexport function ZzA() {\n  return <b>{ZZ_STEP + zzs()}</b>;\n}\n',
      );
      withTransitionDebt(box, [
        "| 1 | Цикл и ребро против слоёв: `src/shared/zzs/zzs.ts` и `src/components/zzA/zzA.tsx` | `1` | «Правила направления» | развести | `1` импорт |",
        "| 2 | Экспорт без потребителя в `src/components/zzA/zzA.tsx` — H4 «Мёртвого кода нет» | `1` | `graph.mjs bar --transition` | снять | `1` имя |",
      ]);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "seat");
      const proto = path.join(box, ".context", "bar-protocol.md");
      const holes = () => tool("bar").out;

      // Правка задела файл цикла: модель помечает цикл известным дефектом.
      edit(box, "src/components/zzA/zzA.tsx", "<b>", "<i>");
      edit(box, "src/components/zzA/zzA.tsx", "</b>", "</i>");
      tool("bar");
      expect(fs.readFileSync(proto, "utf8")).toMatch(/\| цикл \|[^\n]*\| долг перехода \|/);
      // «Чисто» при нём ложно: пункт долга называет и цикл, и H4 в файле правки.
      fillBar(proto, { release: "нет" });
      let said = holes();
      expect(said).toMatch(/A9-бис[^\n]*чисто, а П\d+ — известный дефект \(долг перехода\): правка его задела/);
      expect(said).toMatch(/H4[^\n]*«нет предмета», а пункт 2 долга перехода называет H4 в `components\/zzA\/zzA\.tsx`/);
      // «Отложено» заводит вторую запись — не принимается ни у факта, ни у пункта.
      fillBar(proto, {
        release: "нет",
        pick: {
          "A9-бис": "нашлось | `src/components/zzA/zzA.tsx:1` | цикл | отложено",
          H4: "нашлось | `src/components/zzA/zzA.tsx:3` | мёртвое имя | отложено",
        },
      });
      said = holes();
      expect(said).toMatch(/A9-бис[^\n]*отложено, а П\d+ — известный дефект \(долг перехода\)/);
      expect(said).toMatch(/H4[^\n]*«отложено», а находка — пункт 2 долга перехода/);
      // «Починено» при неправленом пункте — неправда; правленый пункт — законно.
      fillBar(proto, {
        release: "нет",
        pick: { H4: "нашлось | `src/components/zzA/zzA.tsx:3` | мёртвое имя | починено" },
      });
      expect(holes()).toMatch(/H4[^\n]*«починено», а пункт 2 долга перехода не правлен/);
      edit(box, ".context/15-transition.md", "| `1` | `graph.mjs bar --transition` | снять | `1` имя |", "| `0` | `graph.mjs bar --transition` | снять | `1` имя |");
      expect(holes()).not.toMatch(/пункт 2 долга перехода не правлен/);

      // Чтение: предложенное держит сам пункт долга — второй записи не нужно.
      git("checkout", "-q", "--", ".");
      fs.rmSync(proto, { force: true });
      tool("bar", "src/components/zzA");
      fillBar(proto, {
        release: "нет",
        pick: {
          "A9-бис": "нашлось | `src/components/zzA/zzA.tsx:1` | цикл | предложено",
          H4: "нашлось | `src/components/zzA/zzA.tsx:3` | мёртвое имя | предложено",
          "H6-тер": "нашлось | `src/components/zzA/zzA.tsx:5` | сокращение | предложено",
        },
      });
      const loose = verifyIn(box).get("Предложенное сводом названо находкой") ?? [];
      expect(loose).toHaveLength(1);
      expect(loose[0]).toMatch(/^H6-тер/);

      // Правила направления нет — факт остаётся циклом, и пункт, назвавший
      // его файлы, держит его: сверка не падает на факте без имён пакетов.
      edit(box, ".context/00-map.md", "| `shared` | `app`, `components` |  |", "| `shared` | `app` |  |");
      const whole = tool("verify").out;
      expect(whole).toContain("=== Шаги перехода закрывают измерение ===");
      expect(whole).not.toContain("пункт долга 1 держит факт");
      edit(box, ".context/00-map.md", "| `shared` | `app` |  |", "| `shared` | `app`, `components` |  |");

      // Цикл и ребро починены — пункт, державший их, закрыт и не удалён.
      fs.rmSync(proto, { force: true });
      write(box, "src/shared/zzs/zzs.ts", "export const zzs = (): number => 1;\n");
      const steps = () => verifyIn(box).get("Шаги перехода закрывают измерение") ?? [];
      expect(steps().some((one) => one.includes("пункт долга 1 держит факт, которого в коде нет"))).toBe(true);
      edit(
        box,
        ".context/15-transition.md",
        "| 1 | Цикл и ребро против слоёв: `src/shared/zzs/zzs.ts` и `src/components/zzA/zzA.tsx` | `1` | «Правила направления» | развести | `1` импорт |\n",
        "",
      );
      expect(steps().some((one) => one.includes("пункт долга 1"))).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 300000);
});

describe("тесты обвязки — своей командой, вне прогона проекта", () => {
  it("правка обвязки печатает в досье правки команду её тестов", () => {
    const box = seatEmpty("harness-tests-");
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=m", "-c", "user.email=m@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const tested = () =>
        execFileSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "tested"],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "seat");
      expect(tested()).not.toContain("=== Тронута обвязка ===");
      fs.appendFileSync(path.join(box, ".claude", "tools", "graph.md"), "\n");
      expect(tested()).toMatch(
        /=== Тронута обвязка ===\n  файлов инструмента в правке: 1\n[^\n]*\n    npx vitest run --config \.claude\/tools\/vitest\.config\.mjs/,
      );
      // Семя конфига сборщика в прогон проекта обвязку не зовёт.
      const seed = fs.readFileSync(path.join(box, "vite.config.ts"), "utf8");
      expect(seed).toMatch(/include: \["src\/\*\*\/\*\.test\.\{ts,tsx\}"\]/);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

describe("признаки по всей планке в модели свода", () => {
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
  const putIn = (box) => (rel, text) => {
    const at = path.join(box, ...rel.split("/"));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
  };
  /** Строки модели протокола: вид, где, сдвиг, пометка. */
  const modelOf = (box) =>
    [
      ...fs
        .readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8")
        .matchAll(
          /^\| П\d+ \| ([^|]+) \| `([^`]*)` \|[^\n]*?\| ([^|\n]*) \| ([^|\n]*) \| [^|\n]* \| [^|\n]* \|$/gm,
        ),
    ].map((m) => ({
      sort: m[1].trim(),
      where: m[2],
      delta: m[3].trim(),
      mark: m[4].trim(),
    }));
  const has = (rows, sort, mark, where) =>
    rows.some(
      (r) =>
        r.sort === sort &&
        r.mark === mark &&
        (where === undefined || r.where.startsWith(where)),
    );

  it("код, лист стилей и тест дают строки; мёртвый раздел — нет", () => {
    const box = seatEmpty("whole-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      put(
        "src/components/ZzPanel/ZzPanel.tsx",
        [
          'import { useState } from "react";',
          "",
          "// workaround for the double render",
          "export function ZzPanel({ items }: { items: string[] }) {",
          "  const [open, setOpen] = useState(false);",
          "  const load = async () => {",
          '    const res = await fetch("/zz");',
          "    setOpen(res.ok);",
          "  };",
          "  return (",
          "    <div onClick={load}>",
          "      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>",
          "      {open && <p>{items.length}</p>}",
          "    </div>",
          "  );",
          "}",
          "",
        ].join("\n"),
      );
      put("src/components/ZzPanel/ZzPanel.css", ".zzPanel { color: red !important; }\n");
      put(
        "src/components/ZzPanel/tests/ZzPanel.test.tsx",
        [
          'import { it, vi } from "vitest";',
          'import { ZzPanel } from "../ZzPanel";',
          "// the panel is mocked so the list stays empty",
          'vi.mock("../ZzPanel");',
          'it("renders", () => {',
          "  ZzPanel({ items: [] });",
          "});",
          "",
        ].join("\n"),
      );
      tool("bar", "components/ZzPanel");
      const rows = modelOf(box);
      for (const [sort, mark] of [
        ["комментарий", "предупреждение"],
        ["имя", "булево"],
        ["имя", "сокращение"],
        ["внешнее", "сеть"],
        ["разметка", ""],
        ["гонка", "без отмены"],
        ["список", "ключ по позиции"],
        ["доступность", "не кнопка"],
        ["тест", "подмена"],
        ["тест", "без утверждения"],
        ["тесты", ""],
      ])
        expect(has(rows, sort, mark), sort + "/" + mark).toBe(true);
      // Тест — тоже код: его комментарий встаёт строкой, как комментарий модуля.
      expect(
        has(rows, "комментарий", "", "components/ZzPanel/tests/ZzPanel.test.tsx:3"),
      ).toBe(true);
      // Раздел стилей объявлен неприменимым: о листе не спросит ни один
      // живой критерий, и строки о нём в модели нет.
      expect(rows.some((r) => r.sort === "стиль")).toBe(false);
      const facts = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        facts,
        fs
          .readFileSync(facts, "utf8")
          .replace("| O. Стили и адаптивность | нет |", "| O. Стили и адаптивность | да |"),
      );
      tool("bar", "components/ZzPanel");
      expect(
        has(modelOf(box), "стиль", "важнее всех", "components/ZzPanel/ZzPanel.css"),
      ).toBe(true);
      // «Чисто» без номера строки признака — вопрос без ответа.
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      fillBar(protoAt, {
        release: "не нужно: проба",
        pick: { H3: "чисто |  | комментарии в порядке | " },
      });
      expect(tool("bar", "components/ZzPanel")).toMatch(
        /H3: чисто, а в предмете есть комментарии, и в основании не сказано, что каждый прошёл четыре вопроса: П\d+/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("парная копия и повторённое условие — строками модели", () => {
    const box = seatEmpty("twin-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      const rule = [
        "export const zzAllowed = (account: { isAdmin: boolean; isActive: boolean }): boolean => {",
        "  if (account.isAdmin && account.isActive) return true;",
        "  return false;",
        "};",
        "",
      ].join("\n");
      put("src/shared/zzLeft/zzRule.ts", rule);
      put("src/shared/zzRight/zzRule.ts", rule);
      const cfg = path.join(box, ".context", "graph.config.mjs");
      const was = fs.readFileSync(cfg, "utf8");
      expect(was.split("  forks: [],").length).toBe(2);
      fs.writeFileSync(
        cfg,
        was.replace("  forks: [],", '  forks: [{ from: "shared/zzLeft", to: "shared/zzRight" }],'),
      );
      tool("bar", "shared/zzLeft/zzRule.ts");
      const rows = modelOf(box);
      expect(has(rows, "близнец", "", "shared/zzLeft/zzRule.ts")).toBe(true);
      expect(has(rows, "повтор", "условие", "shared/zzLeft/zzRule.ts:2")).toBe(true);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("мутационный замер файла: не мерен, устарел, оставил выживших", () => {
    const box = seatEmpty("mutrow-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      put("src/shared/zzMut/zzMut.ts", "export const zzMut = (n: number) => n + 1;\n");
      put(
        "src/shared/zzMut/tests/zzMut.test.ts",
        'import { expect, it } from "vitest";\nimport { zzMut } from "../zzMut";\nit("adds", () => {\n  expect(zzMut(1)).toBe(2);\n});\n',
      );
      const cfg = fs.readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8");
      fs.writeFileSync(
        path.join(box, ".context", cfg.match(/mutationConfig: "([^"]+)"/)[1]),
        JSON.stringify({ mutate: ["src/shared/zzMut/zzMut.ts"] }),
      );
      const ledgerAt = path.join(box, ".context", cfg.match(/mutationLedger: "([^"]+)"/)[1]);
      const markOf = () =>
        modelOf(box).find((r) => r.sort === "мутации")?.mark ?? "строки нет";
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("не мерено");
      fs.writeFileSync(
        ledgerAt,
        JSON.stringify({ "src/shared/zzMut/zzMut.ts": { killed: 3, alive: 0, hash: "000000000000" } }),
      );
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("устарело");
      const stamp = createHash("sha1")
        .update(fs.readFileSync(path.join(box, "src", "shared", "zzMut", "zzMut.ts"), "utf8"))
        .digest("hex")
        .slice(0, 12);
      fs.writeFileSync(
        ledgerAt,
        JSON.stringify({ "src/shared/zzMut/zzMut.ts": { killed: 3, alive: 2, hash: stamp } }),
      );
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("выжили");
      // Чистый замер на нынешнем содержимом — вопроса нет, и строки нет.
      fs.writeFileSync(
        ledgerAt,
        JSON.stringify({ "src/shared/zzMut/zzMut.ts": { killed: 5, alive: 0, hash: stamp } }),
      );
      tool("bar", "shared/zzMut/zzMut.ts");
      expect(markOf()).toBe("строки нет");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);

  it("на правке узла с тестами «чисто» по J10 без свежего замера печать не ставит, на чтении не режет", () => {
    const box = seatEmpty("mutcut-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=m", "-c", "user.email=m@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, stdio: ["ignore", "pipe", "pipe"] },
        );
      put("src/shared/zzMut/zzMut.ts", "export const zzMut = (n: number) => n + 1;\n");
      put(
        "src/shared/zzMut/tests/zzMut.test.ts",
        'import { expect, it } from "vitest";\nimport { zzMut } from "../zzMut";\nit("adds", () => {\n  expect(zzMut(1)).toBe(2);\n});\n',
      );
      const cfg = fs.readFileSync(path.join(box, ".context", "graph.config.mjs"), "utf8");
      const mutateAt = path.join(box, ".context", cfg.match(/mutationConfig: "([^"]+)"/)[1]);
      fs.writeFileSync(
        mutateAt,
        JSON.stringify({
          ...JSON.parse(fs.readFileSync(mutateAt, "utf8")),
          mutate: ["src/shared/zzMut/zzMut.ts"],
        }),
      );
      const ledgerAt = path.join(box, ".context", cfg.match(/mutationLedger: "([^"]+)"/)[1]);
      const protoAt = path.join(box, ".context", "bar-protocol.md");
      const cut = /J10: чисто, а замер по правленому файлу не мерен либо устарел[^\n]*П\d+/;
      tool("bar", "shared/zzMut/zzMut.ts");
      fillBar(protoAt, { release: "не нужно: проба" });
      expect(tool("bar", "shared/zzMut/zzMut.ts")).not.toMatch(cut);
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "база", "--no-verify");
      const code = "export const zzMut = (n: number) => n + 2;\n";
      put("src/shared/zzMut/zzMut.ts", code);
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const refused = tool("bar");
      expect(refused).not.toContain("печать поставлена");
      expect(refused).toMatch(cut);
      const stamp = createHash("sha1").update(code).digest("hex").slice(0, 12);
      fs.writeFileSync(
        ledgerAt,
        JSON.stringify({ "src/shared/zzMut/zzMut.ts": { killed: 3, alive: 0, hash: stamp } }),
      );
      tool("bar");
      fillBar(protoAt, { release: "не нужно: проба" });
      const sealed = tool("bar");
      expect(sealed).not.toMatch(cut);
      expect(sealed).toContain("печать поставлена");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("граф: повтор, постоянный довод, тесты, союз, приглушение, зависимость", () => {
    const box = seatEmpty("graph-");
    try {
      const tool = toolIn(box);
      const put = putIn(box);
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=u", "-c", "user.email=u@local", "-c", "core.hooksPath=", ...args],
          { cwd: box, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      const block = [
        "  const total = values.reduce((sum, one) => sum + one.weight, 0);",
        "  const ready = values.filter((one) => one.weight > limit && one.enabled);",
        "  const names = ready.map((one) => one.name.trim().toLowerCase());",
        "  const unique = names.filter((name, at) => names.indexOf(name) === at);",
        "  const share = unique.length / Math.max(total, 1);",
        "  return { total, unique, share };",
      ];
      const shape = "values: { weight: number; enabled: boolean; name: string }[], limit: number";
      put(
        "src/shared/zzMath/zzMath.ts",
        [
          "export const zzScale = (value: number, factor: number) => value * factor;",
          "export const zzSum = (" + shape + ") => {",
          ...block,
          "};",
          "export const zzFrame = (step: FrameRequestCallback) => requestAnimationFrame(step);",
          "export const zzPick = (xs: readonly number[]) => xs.filter((x) => x > 0 && x < 10);",
          "export const zzLen = (xs: readonly number[]) => xs.length;",
          'export const zzWide = (kind: string) => (kind === "plain" ? 1 : 2);',
          'export const zzTall = (kind: string) => kind !== "list";',
          "",
        ].join("\n"),
      );
      put(
        "src/shared/zzMath/zzCopy.ts",
        [
          "export const zzOther = (" + shape + ") => {",
          ...block,
          "};",
          'export const zzFlat = (kind: string) => kind === "list";',
          "",
        ].join("\n"),
      );
      put(
        "src/app/zzUse.ts",
        [
          'import { zzScale } from "../shared/zzMath/zzMath";',
          "export const zzA = (a: number) => zzScale(a, 2);",
          "export const zzB = (b: number) => zzScale(b, 2);",
          "export const zzKeep = (xs: readonly number[]) =>",
          "  xs.filter((x) => x > 0 && x < 10);",
          "export const zzSize = (xs: readonly number[]) => xs.length;",
          'export const zzMark = (kind: string): string => (kind === "plain" ? "p" : "q");',
          "",
        ].join("\n"),
      );
      fs.appendFileSync(
        path.join(box, ".context", "00-map.md"),
        [
          "",
          "## Проба союза",
          "",
          "| Файл | Отвечает за | Состояние | Эффекты |",
          "| --- | --- | --- | --- |",
          "| `src/shared/zzMath/zzMath.ts` | масштабирует значения и считает сводку | нет | нет |",
          "",
        ].join("\n"),
      );
      tool("bar", "shared/zzMath/zzMath.ts");
      const text = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8");
      const rows = modelOf(box);
      expect(has(rows, "повтор", "", "shared/zzMath/zzMath.ts")).toBe(true);
      expect(text).toMatch(/повторены в `shared\/zzMath\/zzCopy\.ts:\d+`/);
      // Короткое тело окно строк не видит; повтор тела — строкой, а тело
      // короче порога повтором не считается.
      expect(text).toMatch(/тело `zzPick` повторено в `app\/zzUse\.ts:5`/);
      expect(text).not.toMatch(/тело `zzLen`/);
      expect(text).toMatch(/zzScale\(…\): довод 2 всегда `2`, мест вызова `2`/);
      expect(has(rows, "тесты", "нет")).toBe(true);
      expect(has(rows, "ответственность", "союз")).toBe(true);
      // Метка, которую сравнивают и в другой единице переноса, — вопрос о
      // цене нового варианта; в той же единице — нет.
      expect(has(rows, "метка", "", "shared/zzMath/zzMath.ts:13")).toBe(true);
      expect(text).toContain("`kind === plain` — та же метка в `app/zzUse.ts:7`");
      expect(text).not.toContain("kind === list");
      // Кадры есть, а приглушённого движения нет нигде в проекте.
      expect(has(rows, "приглушение", "нет", "проект")).toBe(true);

      // Пакет, впервые взятый в код поставки, спрашивает о зависимости, хотя
      // манифест не тронут. Пакет, который код уже брал, и импорт одного
      // типа строки не дают; тест кодом поставки не считается.
      put("src/app/tests/zzPkg.test.ts", 'import { zzNew } from "zz-new";\nzzNew();\n');
      fs.writeFileSync(
        path.join(box, "src", "shared", "zzMath", "zzCopy.ts"),
        'import { zzOld } from "zz-old/sub";\n' +
          fs.readFileSync(path.join(box, "src", "shared", "zzMath", "zzCopy.ts"), "utf8"),
      );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "своё", "--no-verify");
      const usePlain = fs.readFileSync(path.join(box, "src", "app", "zzUse.ts"), "utf8");
      fs.writeFileSync(
        path.join(box, "src", "app", "zzUse.ts"),
        'import { zzNew } from "zz-new";\nimport { zzOld } from "zz-old";\n' +
          'import type { ZzT } from "@zz/types";\n' + usePlain,
      );
      tool("bar");
      const first = fs.readFileSync(path.join(box, ".context", "bar-protocol.md"), "utf8");
      expect(has(modelOf(box), "зависимость", "впервые в коде", "app/zzUse.ts:1")).toBe(true);
      expect(first).toContain("zz-new — до правки код поставки его не брал");
      expect(first).not.toMatch(/zz-old — до правки|@zz\/types — до правки/);
      expect(first).not.toContain("манифест этой правкой не тронут");
      fs.writeFileSync(path.join(box, "src", "app", "zzUse.ts"), usePlain);

      // Правка, добавившая зависимость диапазоном, спрашивает о ней.
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.dependencies = { ...(pkg.dependencies ?? {}), "zz-lib": "^1.0.0" };
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      fs.appendFileSync(path.join(box, "src", "app", "zzUse.ts"), "export const zzC = 3;\n");
      tool("bar");
      expect(has(modelOf(box), "зависимость", "диапазон")).toBe(true);

      // Правки вне кода — конвейер, политика источников, запись о бюджете —
      // спрашивают свои критерии; слово «поставка» в карте о бюджете не говорит.
      put(".github/workflows/zz.yml", "jobs:\n  check:\n    steps:\n      - run: npm run build\n");
      put("zzpolicy.html", '<meta http-equiv="Content-Security-Policy" content="default-src *">\n');
      const factsAt = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        factsAt,
        fs
          .readFileSync(factsAt, "utf8")
          .replace("| Q. Безопасность | нет |", "| Q. Безопасность | да |")
          .replace("| U. Конвейер проверок | нет |", "| U. Конвейер проверок | да |") +
          "\n| бюджет поставки | снят |\n",
      );
      fs.appendFileSync(path.join(box, ".context", "00-map.md"), "\nпоставка собирается сборщиком\n");
      tool("bar");
      const setup = modelOf(box);
      expect(has(setup, "настройка", "конвейер", ".github/workflows/zz.yml")).toBe(true);
      expect(has(setup, "настройка", "политика источников", "zzpolicy.html")).toBe(true);
      expect(has(setup, "настройка", "бюджет", ".context/01-facts.md")).toBe(true);
      expect(has(setup, "настройка", "бюджет", ".context/00-map.md")).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Запись карты о бочке — строка таблицы, путь первой графой: так карта пишется
 * сейчас. Сверка читала один заголовок `### …бочка`, и у карты таблицей её
 * корпус был нулём: переименованный экспорт входа области оставался в карте.
 * Найдено пробой рефактора. Бочку узнаёт код, а не слово в записи.
 */
describe("состав бочки в строке карты", () => {
  it("строка таблицы о бочке: живое имя проходит, имя, которого бочка не отдаёт, названо", () => {
    const box = seatEmpty("bochka-stroka-");
    try {
      const dir = path.join(box, "src", "shared", "zzArea");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "zzPart.ts"),
        "export const zzLive = (n: number): number => n + 1;\n",
      );
      fs.writeFileSync(
        path.join(dir, "index.ts"),
        'export { zzLive } from "./zzPart";\n',
      );
      const mapAt = path.join(box, ".context", "00-map.md");
      fs.appendFileSync(
        mapAt,
        "\n| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n" +
          "| `src/shared/zzArea/index.ts` | вход области: `zzLive`, `zzGhost` | нет | нет |\n",
      );
      const said = verifyIn(box).get("Состав бочки в записи карты") ?? [];
      expect(said).toEqual([
        expect.stringMatching(
          /^00-map\.md:\d+ — shared\/zzArea\/index\.ts не отдаёт zzGhost$/,
        ),
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Карта называет удалённый файл дважды — сводкой и своей строкой. Находка
 * печаталась без номера строки, и две одинаковые строки не говорили, где
 * второе упоминание. Найдено пробой удаления узла.
 */
describe("призрак в базе назван с номером строки", () => {
  it("два упоминания удалённого файла — две строки находки с разными номерами", () => {
    const box = seatEmpty("prizrak-stroka-");
    try {
      const mapAt = path.join(box, ".context", "00-map.md");
      fs.appendFileSync(
        mapAt,
        "\nСводка: `src/app/zzGone.ts` держит пробу.\n\n" +
          "| Файл | Отвечает за | Состояние | Эффекты |\n| --- | --- | --- | --- |\n" +
          "| `src/app/zzGone.ts` | проба | нет | нет |\n",
      );
      const found = verifyIn(box);
      for (const section of ["Покрытие карты", "Пути в обратных кавычках"]) {
        const lines = (found.get(section) ?? []).filter((l) =>
          l.includes("zzGone"),
        );
        expect(lines, section).toHaveLength(2);
        for (const l of lines)
          expect(l, section).toMatch(/^00-map\.md:\d+: src\/app\/zzGone\.ts/);
        expect(new Set(lines).size, section).toBe(2);
      }
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * `tsc -p .` называет папку, а не файл, — самая частая форма скрипта сборки.
 * Папка читалась как файл, и сверка базы падала стеком на трети пути: сверки
 * после неё не исполнялись. Найдено посадкой по инструкции в живой проект.
 */
describe("конфиг компилятора, названный папкой", () => {
  it("скрипт `tsc -p .` не роняет сверку, а строгость его конфига названа по файлу", () => {
    const box = seatEmpty("tsc-papka-");
    try {
      const pkgAt = path.join(box, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgAt, "utf8"));
      pkg.scripts.typecheck = "tsc -p .";
      fs.writeFileSync(pkgAt, JSON.stringify(pkg, null, 2) + "\n");
      const tsAt = path.join(box, "tsconfig.json");
      fs.writeFileSync(
        tsAt,
        fs
          .readFileSync(tsAt, "utf8")
          .replace('"strict": true', '"strict": false'),
      );
      const run = spawnSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
        { cwd: box, encoding: "utf8" },
      );
      expect(run.stderr).not.toContain("EISDIR");
      expect(run.stdout).toMatch(/сверок: \d+/);
      expect(
        verifyIn(box).get("Строгость компилятора там, где проверяются типы"),
      ).toEqual([
        expect.stringMatching(
          /^tsconfig\.json — звено типов проверяет по нему/,
        ),
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Область сбора тестов называет тесты проекта. Семя пишет её от корня `src`,
 * и в проекте с другим корнем оно ложилось целиком: раннер не находил ни
 * одного теста, а сверка отвечала «расхождений: 0». Найдено посадкой по инструкции
 * в живой проект с корнем `lib`.
 */
describe("тест проекта вне области сбора раннера", () => {
  it("тест вне `include` назван, тест под перечнем `{ts,tsx}` и подготовка прогона — нет", () => {
    const box = seatEmpty("oblast-sbora-");
    try {
      const SECTION = "Настройка сборки знает про тесты";
      const tests = path.join(box, "src", "app", "tests");
      fs.mkdirSync(tests, { recursive: true });
      fs.writeFileSync(
        path.join(tests, "zzIn.test.tsx"),
        'import { it } from "vitest";\nit("in", () => {});\n',
      );
      expect(verifyIn(box).get(SECTION)).toBeUndefined();
      fs.writeFileSync(
        path.join(tests, "zzOut.spec.ts"),
        'import { it } from "vitest";\nit("out", () => {});\n',
      );
      expect(verifyIn(box).get(SECTION)).toEqual([
        "vite.config.ts — тест проекта src/app/tests/zzOut.spec.ts вне области сбора `include`: раннер его не соберёт",
      ]);
      // Секция, записанная без пробела, — та же секция.
      const conf = path.join(box, "vite.config.ts");
      fs.writeFileSync(
        conf,
        fs.readFileSync(conf, "utf8").replace("test: {", "test:{"),
      );
      expect(verifyIn(box).get(SECTION)).toEqual([
        "vite.config.ts — тест проекта src/app/tests/zzOut.spec.ts вне области сбора `include`: раннер его не соберёт",
      ]);
      // Образец от точки — тот же образец.
      fs.writeFileSync(
        conf,
        fs
          .readFileSync(conf, "utf8")
          .replace('include: ["src/', 'include: ["./src/'),
      );
      expect(fs.readFileSync(conf, "utf8")).toContain('include: ["./src/');
      expect(verifyIn(box).get(SECTION)).toEqual([
        "vite.config.ts — тест проекта src/app/tests/zzOut.spec.ts вне области сбора `include`: раннер его не соберёт",
      ]);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Сверка базы — один сценарий, и исключение одного места прежде обрывало его:
 * `tsc -p .`, прочитанный как файл, оставил неисполненными `113` сверок из
 * `142`. Найдено посадкой по инструкции в живой проект. Падение шага — находка, а
 * прогон идёт до конца: заголовок секции не теряется, секции, читающие данные
 * упавшего шага, названы по данным.
 */
describe("шаг сверки, упавший исключением", () => {
  it("секции на месте, своя секция красная, задетые по данным названы", () => {
    const box = seatEmpty("shag-upal-");
    try {
      const tool = path.join(box, ".claude", "tools", "graph.mjs");
      const ts = createRequire(import.meta.url)("typescript");
      const outline = stepsOutline(ts, fs.readFileSync(tool, "utf8"));
      const run = (fault) =>
        spawnSync(process.execPath, [tool, "verify", "--full"], {
          cwd: box,
          encoding: "utf8",
          env: { ...process.env, GRAPH_VERIFY_FAULT: fault },
        });
      const heads = (out) =>
        out.split("\n").filter((l) => l.startsWith("=== "));
      const sectionOf = (out, title) => {
        const from = out.indexOf("=== " + title + " ===");
        const to = out.indexOf("\n=== ", from + 1);
        return out.slice(from, to);
      };
      const clean = run("");
      expect(clean.stdout).toContain(
        "  осмотрено шагов сверки: " + outline.length,
      );
      expect(clean.stdout).toContain("  упало исключением: 0");
      // Шаг вычисления, чьи данные читает позже чужая секция.
      const calc = outline.findIndex(
        (s, i) =>
          i > 5 &&
          s.head === null &&
          outline
            .slice(i + 1)
            .some(
              (t) =>
                t.head !== null && [...s.writes].some((n) => t.reads.has(n)),
            ),
      );
      // Шаг секции.
      const own = outline.findIndex((s, i) => i > 5 && s.head !== null);
      expect(calc).toBeGreaterThan(0);
      expect(own).toBeGreaterThan(0);
      for (const k of [calc + 1, own + 1]) {
        const broken = run(String(k));
        expect(broken.status).toBe(1);
        expect(broken.stderr).not.toContain("посаженное падение");
        expect(heads(broken.stdout)).toEqual(heads(clean.stdout));
        expect(broken.stdout).toContain(
          "    шаг " + k + " сверки упал исключением: ",
        );
      }
      const ownHead = outline[own].head;
      expect(sectionOf(run(String(own + 1)).stdout, ownHead)).toContain(
        "    шаг " + (own + 1) + " сверки упал исключением: ",
      );
      expect(run(String(calc + 1)).stdout).toMatch(
        new RegExp(
          "^ {4}секция «[^»]+» под вопросом: её шаг \\d+ читает данные упавшего шага " +
            (calc + 1) +
            " ",
          "m",
        ),
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);

  it("секция в условии печатается и без предмета — с причиной, не пропадает", () => {
    const box = seatEmpty("bez-manifesta-");
    try {
      const cfg = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfg,
        fs
          .readFileSync(cfg, "utf8")
          .replace(/^ {2}manifest: [^\n]*/m, "  manifest: null,"),
      );
      const out = spawnSync(
        process.execPath,
        [path.join(box, ".claude", "tools", "graph.mjs"), "verify", "--full"],
        { cwd: box, encoding: "utf8" },
      ).stdout;
      expect(out).not.toContain("не напечатана");
      expect(out).toMatch(
        /=== Связка проверок зовёт живые звенья ===\n {2}осмотрено предметов: 0\n {2}предмета нет: манифест не объявлен/,
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 120000);
});

describe("сверка каркаса в живом проекте", () => {
  it("план перехода, назвавший адрес каркаса целью, находкой не становится", () => {
    const box = seatEmpty("karkas-plan-");
    try {
      fs.writeFileSync(path.join(box, "src", "zzOwn.tsx"), "export const zzOwn = 1;\n");
      // Каркас не положен: адрес теста каркаса в карте посадки другой.
      const mapAt = path.join(box, ".claude", "seat", "map.json");
      fs.writeFileSync(
        mapAt,
        fs
          .readFileSync(mapAt, "utf8")
          .replace(
            '"to": "src/app/tests/App.test.tsx"',
            '"to": "src/app/tests/zzLater.test.tsx"',
          ),
      );
      const frame = () =>
        verifyIn(box).get("Каркас обвязки не лежит в живом проекте") ?? [];
      const before = frame().length;
      withTransitionDebt(box, [
        "| 1 | Тест не в `tests/` | `1` | «Тесты лежат в `tests/`» | перенести в `src/app/tests/zzLater.test.tsx` | `1` файл |",
      ]);
      expect(frame().length).toBe(before);
      expect(frame().join("\n")).not.toContain("15-transition.md");
      // Та же запись в реестре решений — запись о каркасе, которого нет.
      fs.appendFileSync(
        path.join(box, ".context", "09-decisions.md"),
        "\nЯкорь: `src/app/tests/zzLater.test.tsx`.\n",
      );
      expect(frame().join("\n")).toContain(
        "09-decisions.md:",
      );
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

describe("витрина называет код номером гарантии", () => {
  it("номер REQ-n, чья строка называет файл проекта, засчитан адресом; чужой номер — нет", () => {
    const box = seatEmpty("vitrina-req-");
    try {
      fs.writeFileSync(
        path.join(box, "src", "app", "zzCounter.tsx"),
        "export const zzCounter = (n: number): number => n + 1;\n",
      );
      const flowsAt = path.join(box, ".context", "05-flows.md");
      fs.writeFileSync(
        flowsAt,
        fs
          .readFileSync(flowsAt, "utf8")
          .replace(
            "| Гарантия | Род | Что наблюдают | Источник | Узлы | Тест |\n| --- | --- | --- | --- | --- | --- |\n",
            "| Гарантия | Род | Что наблюдают | Источник | Узлы | Тест |\n| --- | --- | --- | --- | --- | --- |\n| REQ-1 | должно | счёт растёт на единицу | разработчик, 2026-10-19 | `src/app/zzCounter.tsx` | `src/app/tests/App.test.tsx` «renders» |\n",
          ),
      );
      const showcase = path.join(box, "docs", "FEATURES.md");
      const mute = () =>
        (verifyIn(box).get("Файл базы о живом коде назвал его адрес") ?? []).filter(
          (line) => line.startsWith("docs/FEATURES.md"),
        );
      fs.writeFileSync(showcase, "# Features\n\n- A press adds one. (REQ-1)\n");
      expect(mute()).toEqual([]);
      fs.writeFileSync(showcase, "# Features\n\n- A press adds one. (REQ-9)\n");
      expect(mute().length).toBe(1);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Третья посадка в живой проект: своя папка `.claude/` проекта, тесты вне
 * корня исходников, висячее имя класса и свой файл правил проекта. Каждое
 * из четырёх держало прогон красным либо молчало там, где обязано говорить.
 */
describe("живой проект: своё в обвязке, тест вне корня, имя класса, правила под семенем", () => {
  it("команда проекта не проза полки; тест вне корня назван; имя класса держит долг; правила под семенем смягчены", () => {
    const box = seatEmpty("tretya-");
    try {
      // Своё проекта внутри `.claude/` — не проза полки. Имя собрано из
      // частей: этот файл лежит в полке, и целиком оно назвало бы команду.
      const command = ["zz", "Release.md"].join("");
      const own = path.join(box, ".claude", "commands");
      fs.mkdirSync(own, { recursive: true });
      fs.writeFileSync(path.join(own, command), "Bump the version.\n");
      expect((verifyIn(box).get("Проза полки названа") ?? []).join("\n")).not.toContain(
        command,
      );
      // Тест вне корня исходников, папка которого не объявлена.
      const outside = path.join(box, "zzOutside");
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, "zz.test.ts"), "export const zz = 1;\n");
      expect((verifyIn(box).get("Покрытие тестов") ?? []).join("\n")).toContain(
        "zzOutside/zz.test.ts — тест, которого обвязка не видит",
      );
      fs.rmSync(outside, { recursive: true });
      // Висячее имя класса держит пункт долга, назвавший сверку.
      const card = path.join(box, "src", "components", "ZzCard");
      fs.mkdirSync(card, { recursive: true });
      fs.writeFileSync(
        path.join(card, "ZzCard.tsx"),
        'import styles from "./ZzCard.module.css";\nexport function ZzCard() {\n  return <i className={styles.zzMissing} />;\n}\n',
      );
      fs.writeFileSync(path.join(card, "ZzCard.module.css"), ".zzCard {\n  margin: 0;\n}\n");
      const drift = () =>
        (verifyIn(box).get("Имена классов из кода есть в листе стилей") ?? []).join("\n");
      expect(drift()).toContain("`styles.zzMissing`");
      withTransitionDebt(box, [
        "| 1 | имя класса без объявления в листе | `1` | «Имена классов из кода есть в листе стилей» | объявить класс в `src/components/ZzCard/ZzCard.module.css` | `1` место |",
      ]);
      expect(drift()).toBe("");
      // Свой файл правил ждёт слияния с семенем: сверки о его содержимом
      // смягчены, пока стоит флаг посадки.
      const banner = () => {
        const r = spawnSync(
          process.execPath,
          [path.join(box, ".claude", "tools", "graph.mjs"), "verify"],
          { cwd: box, encoding: "utf8" },
        );
        return r.stdout.split("ПЕРЕХОД")[0];
      };
      expect(banner()).not.toContain("«Названное доктриной исполнимо»");
      fs.copyFileSync(path.join(box, "CLAUDE.md"), path.join(box, "CLAUDE.md.seat"));
      expect(banner()).toContain("«Названное доктриной исполнимо»");
      expect(banner()).toContain("«Правила проекта не спорят с реестром решений»");
      // Та же форма у витрины: своя витрина проекта ждёт слияния с семенем.
      expect(banner()).not.toContain("«Гарантия держится тестом»");
      fs.copyFileSync(
        path.join(box, "docs", "FEATURES.md"),
        path.join(box, "docs", "FEATURES.md.seat"),
      );
      expect(banner()).toContain("«Гарантия держится тестом»");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Свой скилл проекта лежит в папке обвязки, но обвязкой не является: строка
 * о нём в памятке уехала бы с обвязкой в чужой проект. Выведено: четвёртая
 * посадка в живой проект — скилл `deploy` требовал строки в памятке обвязки.
 */
describe("свой скилл проекта объявляется полем настройки", () => {
  it("необъявленный требует строки памятки, объявленный — нет, объявленный без папки назван", () => {
    const box = seatEmpty("own-skill-");
    try {
      const skillDir = path.join(box, ".claude", "skills", "zzown");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        // Без признака вызова: шапку своего скилла решает проект.
        "---\nname: zzown\ndescription: Выкатить сборку проекта.\n---\n\n# Выкатка\n",
      );
      const factsAt = path.join(box, ".context", "01-facts.md");
      fs.writeFileSync(
        factsAt,
        fs
          .readFileSync(factsAt, "utf8")
          .replace(
            "| `task` | `.claude/skills/task/SKILL.md` |\n",
            "| `task` | `.claude/skills/task/SKILL.md` |\n| `zzown` | `.claude/skills/zzown/SKILL.md` |\n",
          ),
      );
      const drift = () => (verifyIn(box).get("Скиллы проекта") ?? []).join("\n");
      expect(drift()).toContain("нет строки в памятке: zzown — свой скилл проекта объявляют полем `skills.own` настройки");
      expect(drift()).toContain("не вызываем по имени: zzown");
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      const own = (list) =>
        fs.writeFileSync(
          cfgAt,
          fs.readFileSync(cfgAt, "utf8").replace(/\n {4}own: \[[^\]]*\],/, "\n    own: " + JSON.stringify(list) + ","),
        );
      own(["zzown"]);
      expect(drift()).toBe("");
      own(["zzown", "zzgone"]);
      expect(drift()).toBe("объявлен своим, а папки нет: zzgone");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});

/**
 * Пункт долга, назвавший сверку, держит её находки — только у сверок, которые
 * это умеют. README в корне папки узла держал живой проект красным до правки
 * кода, а пункт, назвавший сверку без такой формы, не держал ничего и не
 * говорил об этом. Выведено: четвёртая посадка в живой проект.
 */
describe("пункт долга и названная им сверка", () => {
  it("документ мимо `docs/` держится пунктом, пункт о сверке без формы долга назван", () => {
    const box = seatEmpty("held-row-");
    try {
      const node = path.join(box, "src", "components", "ZzCard");
      fs.mkdirSync(node, { recursive: true });
      fs.writeFileSync(
        path.join(node, "ZzCard.tsx"),
        "export function ZzCard() {\n  return null;\n}\n",
      );
      fs.writeFileSync(path.join(node, "README.md"), "# ZzCard\n\nCard.\n");
      const docs = () =>
        (verifyIn(box).get("Документы компонента лежат в его `docs/`") ?? []).join("\n");
      expect(docs()).toContain("ZzCard/README.md");
      withTransitionDebt(box, [
        "| 1 | README в корне папки узла | `1` | «Документы компонента лежат в его `docs/`» | перенести в `docs/` | `1` файл |",
      ]);
      const held = verifyIn(box);
      expect(held.get("Документы компонента лежат в его `docs/`") ?? []).toEqual([]);
      expect(held.get("Пункт долга держит названную сверку") ?? []).toEqual([]);
      // Адрес в плане перехода — намеченный, и сверка путей его не судит;
      // мёртвый адрес кладётся в карту.
      fs.appendFileSync(path.join(box, ".context", "00-map.md"), "\nАдрес `src/zzNowhere.ts`.\n");
      fs.appendFileSync(
        path.join(box, ".context", "15-transition.md"),
        "| 2 | Мёртвый адрес | `1` | «Пути в обратных кавычках» | снять адрес из карты | `1` место |\n",
      );
      expect(
        (verifyIn(box).get("Пункт долга держит названную сверку") ?? []).join("\n"),
      ).toContain("пункт 2 называет «Пути в обратных кавычках», а её находки он не держит");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Сквозные проверки собирает свой раннер, и область сбора раннера обвязки о
 * них не спрашивают. Выведено: четвёртая посадка в живой проект — `e2e/` под
 * Playwright сверка требовала собрать раннером тестов.
 */
describe("тесты другого раннера вне области сбора", () => {
  it("тест в `e2e/` назван, пока Playwright не объявил папку своей", () => {
    const box = seatEmpty("other-runner-");
    try {
      const cfgAt = path.join(box, ".context", "graph.config.mjs");
      fs.writeFileSync(
        cfgAt,
        fs.readFileSync(cfgAt, "utf8").replace(/\n {2}testDirs: null,/, '\n  testDirs: ["../e2e"],'),
      );
      fs.mkdirSync(path.join(box, "e2e"));
      fs.writeFileSync(
        path.join(box, "e2e", "zz.spec.ts"),
        "import { test } from '@playwright/test';\ntest('zz', () => {});\n",
      );
      const lost = () =>
        (verifyIn(box).get("Настройка сборки знает про тесты") ?? []).join("\n");
      expect(lost()).toContain("e2e/zz.spec.ts вне области сбора");
      fs.writeFileSync(
        path.join(box, "playwright.config.ts"),
        'export default { testDir: "./e2e" };\n',
      );
      expect(lost()).not.toContain("e2e/zz.spec.ts");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Держимая сверка — своим пунктом: одно число на две прощало каждой полное
 * число и не говорило, у какой выросло. Выведено: четвёртая посадка в живой
 * проект — пункт «свои идиомы узла» называл две сверки папки узла.
 */
describe("пункт долга о нескольких держимых сверках", () => {
  it("пункт держит одну держимую сверку: две под одним числом названы, по пункту на каждую — нет", () => {
    const box = seatEmpty("held-sum-");
    try {
      const node = path.join(box, "src", "components", "ZzCard");
      fs.mkdirSync(node, { recursive: true });
      fs.writeFileSync(
        path.join(node, "ZzCard.tsx"),
        "export function ZzCard() {\n  return null;\n}\n",
      );
      fs.writeFileSync(path.join(node, "README.md"), "# ZzCard\n\nCard.\n");
      // Один помощник в корне законен, свалка — со второго.
      fs.writeFileSync(path.join(node, "zzHelper.ts"), "export const zzHelper = () => 1;\n");
      fs.writeFileSync(path.join(node, "zzOther.ts"), "export const zzOther = () => 2;\n");
      const found = verifyIn(box);
      expect((found.get("Документы компонента лежат в его `docs/`") ?? []).length).toBe(1);
      expect((found.get("В корне узла только сам узел") ?? []).length).toBe(1);
      const planAt = path.join(box, ".context", "15-transition.md");
      withTransitionDebt(box, [
        "| 1 | своё в папке узла | `1` | «Документы компонента лежат в его `docs/`» и «В корне узла только сам узел» | разнести по папкам | `2` места |",
      ]);
      const said = () =>
        (verifyIn(box).get("Пункт долга держит названную сверку") ?? []).join("\n");
      expect(said()).toContain(
        "пункт 1 держит одним числом несколько сверок: «Документы компонента лежат в его `docs/`», «В корне узла только сам узел»",
      );
      fs.writeFileSync(
        planAt,
        fs
          .readFileSync(planAt, "utf8")
          .replace(
            "| 1 | своё в папке узла | `1` | «Документы компонента лежат в его `docs/`» и «В корне узла только сам узел» | разнести по папкам | `2` места |",
            "| 1 | документ мимо `docs/` | `1` | «Документы компонента лежат в его `docs/`» | перенести | `1` файл |\n| 2 | свалка в корне узла | `1` | «В корне узла только сам узел» | разнести по папкам | `1` узел |",
          ),
      );
      expect(said()).toBe("");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 240000);
});

/**
 * Таблица команд правил проекта — то, что сессия запускает. Сверка читала
 * прозу обвязки и базы, а правила проекта — нет. Выведено: четвёртая посадка
 * в живой проект — семя правил называло `npm run preview`, которого у проекта
 * нет.
 */
describe("команды правил проекта исполнимы", () => {
  it("скрипт таблицы команд без скрипта в манифесте проекта назван", () => {
    const box = seatEmpty("rules-cmd-");
    try {
      const said = () =>
        (verifyIn(box).get("Названное доктриной исполнимо") ?? []).join("\n");
      expect(said()).toBe("");
      fs.appendFileSync(path.join(box, "CLAUDE.md"), "\n| Проба | `npm run zznope` |\n");
      expect(said()).toContain("npm run zznope — звена нет в манифесте проекта (../CLAUDE.md)");
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  }, 180000);
});
