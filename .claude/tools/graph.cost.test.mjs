import { describe, expect, it } from "vitest";
import {
  JUMP_TOKENS,
  callKind,
  costLines,
  costOf,
  journalOf,
  turnKind,
} from "./graph.cost.mjs";

/** Запись обращения: контекст — сумма трёх полей расхода, как в журнале. */
const said = (id, ctx, out, parts) => ({
  type: "assistant",
  message: {
    id,
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: ctx - 100,
      cache_creation_input_tokens: 0,
      output_tokens: out,
    },
    content: parts,
  },
});
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const got = (id, content, isError = false) => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, content, is_error: isError },
    ],
  },
});

const PROTOCOL = "/p/.context/bar-protocol.md";

/** Четыре обращения; сумма контекстов посчитана руками: 1000 + 21000 + 21500 +
 * 21600 = 65100. Первое обращение лежит двумя записями с одним `message.id`. */
const journal = [
  said("m1", 1000, 5, [use("t1", "Read", { file_path: PROTOCOL })]),
  said("m1", 1000, 20, [
    use("t2", "Bash", { command: "node .claude/tools/graph.mjs bar" }),
  ]),
  got("t1", "x".repeat(10)),
  got("t2", "abcd"),
  said("m2", 21000, 7, [
    use("t3", "Write", { file_path: "/tmp/s/answers.md", content: "-" }),
  ]),
  got("t3", "ok"),
  said("m3", 21500, 9, [
    use("t5", "Bash", { command: "sed -n 1,5p .context/bar-protocol.md" }),
    use("t6", "Read", { file_path: PROTOCOL }),
  ]),
  got("t5", "This command requires approval", true),
  got("t6", "PreToolUse:Read hook error: [x]: отказ", true),
  said("m4", 21600, 3, [{ type: "text", text: "готово" }]),
];

describe("расход свода: обращения и перечитывание", () => {
  it("обращение считается по message.id, а не по записям: дубль не удваивает контекст", () => {
    const cost = costOf(journal);
    expect(cost.turns).toBe(4);
    expect(cost.reread).toBe(65100);
    expect(cost.first).toBe(1000);
    expect(cost.base).toBe(4000);
    expect(cost.output).toBe(20 + 7 + 9 + 3);
  });

  it("пустой журнал даёт нули, а не исключение", () => {
    const cost = costOf([]);
    expect(cost.turns).toBe(0);
    expect(cost.reread).toBe(0);
    expect(cost.turnKinds).toEqual([]);
    expect(cost.jumps).toEqual([]);
  });

  it("строка журнала, что не разбирается, считается и отбрасывается", () => {
    const read = journalOf('{"type":"x"}\n{не json\n\n{"type":"y"}\n');
    expect(read.records).toEqual([{ type: "x" }, { type: "y" }]);
    expect(read.skipped).toBe(1);
  });
});

describe("расход свода: вызовы, скачки и отказы", () => {
  const cost = costOf(journal);
  const kind = (name) => cost.kinds.find((r) => r.kind === name);

  it("вызов относится к виду по пути и по режиму инструмента; вес — знаки на обращения после вызова", () => {
    expect(kind("Read:протокол")).toMatchObject({ n: 2, chars: 10 + 38 });
    expect(kind("Bash:bar")).toMatchObject({ n: 1, chars: 4, weighted: 4 * 3 });
    expect(kind("Write")).toMatchObject({ n: 1, chars: 2, weighted: 2 * 2 });
    expect(kind("Bash:срез протокола").n).toBe(1);
    expect(kind("Read:протокол").weighted).toBe(10 * 3 + 38 * 1);
  });

  it("чтений протокола — Read и срезы оболочкой вместе", () => {
    expect(cost.protocolReads).toBe(3);
  });

  it("скачок больше порога назван вместе с вызовами предыдущего обращения", () => {
    expect(JUMP_TOKENS).toBe(15000);
    expect(cost.jumps).toEqual([
      { at: 1, grow: 20000, after: ["Read:протокол", "Bash:bar"] },
    ]);
  });

  it("отказ разрешений и отказ хука считаются порознь", () => {
    expect(cost.refusals).toEqual({ permission: 1, hook: 1, error: 0 });
  });

  it("слова «permission» и «denied» в середине вывода команды отказом разрешений не являются", () => {
    const run = costOf([
      said("m1", 1000, 1, [use("t1", "Bash", { command: "npm test" })]),
      got("t1", "Exit code 1\nEACCES: permission denied, open 'x'", true),
      said("m2", 1100, 1, [{ type: "text", text: "-" }]),
    ]);
    expect(run.refusals).toEqual({ permission: 0, hook: 0, error: 1 });
  });

  it("обращения по видам: чтение протокола, запись вне базы, ответ без вызовов; доля — от перечитывания", () => {
    expect(cost.turnKinds.map((r) => [r.kind, r.n, r.ctx])).toEqual([
      ["чтение протокола", 2, 22500],
      ["ответ без вызовов", 1, 21600],
      ["файл вне базы (ответы, скрипты)", 1, 21000],
    ]);
    expect(cost.turnKinds[0].share).toBeCloseTo(22500 / 65100, 6);
  });
});

describe("расход свода: виды вызовов и обращений", () => {
  it("страница, протокол и база различаются по пути; режим инструмента — по команде", () => {
    expect(
      callKind("Read", {
        file_path: "/p/.context/bar-pages/bar-protocol-1.md",
      }),
    ).toBe("Read:страница");
    expect(callKind("Read", { file_path: PROTOCOL })).toBe("Read:протокол");
    expect(callKind("Read", { file_path: "/p/.context/00-map.md" })).toBe(
      "Read:база",
    );
    expect(callKind("Read", { file_path: "/p/src/a.ts" })).toBe("Read:прочее");
    expect(
      callKind("Bash", {
        command: "cd /p && node .claude/tools/graph.mjs bar-fill x",
      }),
    ).toBe("Bash:bar-fill");
    expect(callKind("Bash", { command: "git diff --stat" })).toBe(
      "Bash:git diff",
    );
    expect(callKind("Bash", { command: "ls" })).toBe("Bash:прочее");
    expect(callKind("Edit", { file_path: "/p/a" })).toBe("Edit");
  });

  it("запись внутри базы — «база», вне базы — файл ответов или скрипт", () => {
    const edit = (p) => ({ kind: "Edit", path: p });
    expect(turnKind([edit("/p/.context/13-questions.md")])).toBe("база");
    expect(turnKind([edit("/tmp/gen.mjs")])).toBe(
      "файл вне базы (ответы, скрипты)",
    );
  });
});

describe("расход свода: печать", () => {
  const text = costLines(costOf(journal)).join("\n");

  it("печатает числа таблиц методики", () => {
    expect(text).toContain("обращений: 4");
    expect(text).toContain("перечитывание: 65 100 токенов контекста");
    expect(text).toContain(
      "стартовый контекст: 1 000 × 4 = 4 000 (6 % перечитывания)",
    );
    expect(text).toContain("отказы: разрешений 1, хука 1, прочих ошибок 0");
    expect(text).toContain(
      "обращение 1: +20 000 после Read:протокол, Bash:bar",
    );
  });

  it("готовая строка для замеров держит числа в обратных кавычках", () => {
    expect(text).toContain(
      "`4` обращений, перечитывание `65 100` токенов, стартовый контекст `1 000` (`6 %`), чтений протокола `3`, отказов разрешений `1`",
    );
  });
});
