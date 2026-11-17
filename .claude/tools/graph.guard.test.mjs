import { describe, expect, it } from "vitest";
import {
  MODEL_TITLE,
  modelWindowOf,
  protocolReadFault,
  protocolShellFault,
  rulesFreshnessOf,
  rulesFreshnessText,
  codeReadOf,
  codeNamedIn,
  lastAnswerOf,
} from "./graph.guard.mjs";

/** Протокол, в котором модель занимает строки 6–10 (заголовок — строка 6). */
const protocol = [
  "# Протокол",
  "",
  "## Прочитано",
  "| 1 | стр | слово |",
  "",
  MODEL_TITLE,
  "",
  "П1",
  "П2",
  "",
  "## Исходы",
  "| A1 | чисто |",
  "",
].join("\n");

/** Модель — последний раздел файла. */
const modelLast = ["# P", MODEL_TITLE, "П1", ""].join("\n");

describe("страж протокола: окно модели предмета", () => {
  it("окно — от заголовка модели до следующего заголовка раздела, как их принимает Read", () => {
    expect(modelWindowOf(protocol)).toEqual({ offset: 6, limit: 5 });
  });

  it("модель — последний раздел: окно идёт до конца файла", () => {
    expect(modelWindowOf(modelLast)).toEqual({ offset: 2, limit: 3 });
  });

  it("раздела модели нет — окна нет", () => {
    expect(modelWindowOf("# P\n## Исходы\n")).toBeNull();
  });
});

describe("страж протокола: чтение инструментом Read", () => {
  const fault = (offset, limit) => protocolReadFault(protocol, offset, limit);

  it("целый файл и окно вне модели отказываются; отказ называет offset и limit модели", () => {
    for (const [offset, limit] of [
      [NaN, NaN],
      [1, 5],
      [5, 2],
      [0, 5],
      [NaN, 3],
      [6, 6],
      [6, NaN],
      [10, 3],
    ])
      expect(fault(offset, limit), offset + "+" + limit).toContain(
        "offset 6 и limit 5",
      );
  });

  it("окно внутри модели проходит: всё окно, его часть, один ряд", () => {
    for (const [offset, limit] of [
      [6, 5],
      [7, 3],
      [10, 1],
      [6, 1],
    ])
      expect(fault(offset, limit), offset + "+" + limit).toBe("");
  });

  it("без limit читается до конца файла: внутри последнего раздела проходит, иначе нет", () => {
    expect(protocolReadFault(modelLast, 2, NaN)).toBe("");
    expect(protocolReadFault(modelLast, 1, NaN)).not.toBe("");
    expect(protocolReadFault(protocol, 6, NaN)).not.toBe("");
  });

  it("без limit Read отдаёт столько строк, сколько обещает среда, — 2000", () => {
    const big = [
      "# P",
      MODEL_TITLE,
      ...Array.from({ length: 1999 }, (_, i) => "П" + (i + 1)),
      "## Исходы",
      "| A1 | чисто |",
    ].join("\n");
    expect(modelWindowOf(big)).toEqual({ offset: 2, limit: 2000 });
    expect(protocolReadFault(big, 2, NaN)).toBe("");
    expect(protocolReadFault(big, 3, NaN)).not.toBe("");
  });

  it("протокол без раздела модели стражу не предмет", () => {
    expect(protocolReadFault("# P\n## Исходы\n", NaN, NaN)).toBe("");
  });
});

describe("страж протокола: чтение оболочкой", () => {
  it("отказ называет команду и окно модели; нет текста протокола — без окна", () => {
    const said = protocolShellFault("cat", protocol);
    expect(said).toContain("(`cat`)");
    expect(said).toContain("offset 6 и limit 5");
    const blind = protocolShellFault("sed", null);
    expect(blind).toContain("(`sed`)");
    expect(blind).not.toContain("offset");
    expect(blind).toContain("graph.mjs bar");
  });
});

describe("правила, изменённые после начала сессии", () => {
  const call = (tool = "Bash", file = null, session = "s1") => ({ session, tool, file });
  const first = rulesFreshnessOf(null, { a: "1", b: "2" }, call());

  it("первый вызов сессии делает снимок и молчит, новая сессия — новый снимок", () => {
    expect(first.stale).toEqual([]);
    expect(first.state.seen).toEqual({ a: "1", b: "2" });
    const next = rulesFreshnessOf(first.state, { a: "9", b: "2" }, call("Bash", null, "s2"));
    expect(next.stale).toEqual([]);
    expect(next.state.seen).toEqual({ a: "9", b: "2" });
  });

  it("изменённый, новый и снятый названы; изменённый повторяется, пока его не прочли Read", () => {
    const now = { a: "9", c: "3" };
    const one = rulesFreshnessOf(first.state, now, call());
    expect(one.stale).toEqual([
      { rel: "a", how: "изменён" },
      { rel: "b", how: "снят" },
      { rel: "c", how: "новый" },
    ]);
    const two = rulesFreshnessOf(one.state, now, call());
    expect(two.stale).toEqual([
      { rel: "a", how: "изменён" },
      { rel: "c", how: "новый" },
    ]);
    const read = rulesFreshnessOf(two.state, now, call("Read", "a"));
    expect(read.stale).toEqual([{ rel: "c", how: "новый" }]);
    // Чтение чужого файла ничего не снимает.
    expect(rulesFreshnessOf(read.state, now, call("Read", "z")).stale).toEqual([
      { rel: "c", how: "новый" },
    ]);
  });

  it("своя правка принимается следующим вызовом, а не напоминается", () => {
    const edit = rulesFreshnessOf(first.state, { a: "1", b: "2" }, call("Edit", "a"));
    expect(edit.stale).toEqual([]);
    const after = rulesFreshnessOf(edit.state, { a: "5", b: "2" }, call());
    expect(after.stale).toEqual([]);
    // Правка, пришедшая после, — снова чужая.
    expect(rulesFreshnessOf(after.state, { a: "6", b: "2" }, call()).stale).toEqual([
      { rel: "a", how: "изменён" },
    ]);
  });

  it.each(["Edit", "Write", "MultiEdit", "NotebookEdit"])(
    "%s нового файла правил и снятие своего не напоминаются",
    (tool) => {
      const made = rulesFreshnessOf(first.state, { a: "1", b: "2" }, call(tool, "0"));
      expect(made.stale).toEqual([]);
      const after = rulesFreshnessOf(made.state, { 0: "7", a: "1", b: "2" }, call());
      expect(after.stale).toEqual([]);
      const gone = rulesFreshnessOf(after.state, { a: "1", b: "2" }, call(tool, "0"));
      expect(rulesFreshnessOf(gone.state, { a: "1", b: "2" }, call()).stale).toEqual([]);
    },
  );

  it("своя правка не прячет чужое изменение другого файла и чтение снятого его не снимает", () => {
    const edit = rulesFreshnessOf(first.state, { a: "9", b: "3" }, call("Edit", "a"));
    expect(edit.stale).toEqual([{ rel: "b", how: "изменён" }]);
    const read = rulesFreshnessOf(first.state, { a: "1" }, call("Read", "b"));
    expect(read.stale).toEqual([{ rel: "b", how: "снят" }]);
  });

  it("устаревшие идут по пути, а не по порядку снимка", () => {
    const out = rulesFreshnessOf(first.state, { a: "1", b: "4", "CLAUDE.md": "5" }, call());
    expect(out.stale).toEqual([
      { rel: "CLAUDE.md", how: "новый" },
      { rel: "b", how: "изменён" },
    ]);
  });

  it("напоминание называет каждый файл и как его вернуть", () => {
    expect(rulesFreshnessText([])).toBe("");
    const text = rulesFreshnessText([
      { rel: ".claude/rules/loop.md", how: "изменён" },
      { rel: "CLAUDE.md", how: "новый" },
    ]);
    expect(text).toContain("правила изменились после начала сессии");
    expect(text).toContain("`.claude/rules/loop.md` (изменён), `CLAUDE.md` (новый)");
    expect(text).toContain("перечитать инструментом Read");
  });
});

describe("прочитанный код сессии и ответ, который его называет", () => {
  it("список копится в сессии, новая сессия и коммит начинают заново", () => {
    const one = codeReadOf(null, { session: "s1", file: "src/a.ts" });
    expect(one).toEqual({ session: "s1", files: ["src/a.ts"] });
    expect(codeReadOf(one, { session: "s1", file: "src/a.ts" }).files).toEqual(["src/a.ts"]);
    expect(codeReadOf(one, { session: "s1", file: "src/b.ts" }).files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(codeReadOf(one, { session: "s2", file: "src/b.ts" }).files).toEqual(["src/b.ts"]);
    expect(codeReadOf(null, { session: "s1", file: null }).files).toEqual([]);
  });
  it("файл назван путём либо именем отдельным словом, а не частью другого имени", () => {
    const files = ["src/app/App.tsx", "src/shared/x/thirst.ts"];
    expect(codeNamedIn(files, "см. `src/app/App.tsx:3`")).toEqual(["src/app/App.tsx"]);
    expect(codeNamedIn(files, "в App.tsx заголовок")).toEqual(["src/app/App.tsx"]);
    expect(codeNamedIn(files, "MyApp.tsx и App.tsx.bak")).toEqual([]);
    expect(codeNamedIn(files, "правило в thirst.ts, а тест — в thirst.test.ts")).toEqual(["src/shared/x/thirst.ts"]);
    expect(codeNamedIn(files, "ничего")).toEqual([]);
  });
  it("последний ответ — последняя запись ассистента с текстом; порченый журнал — пусто", () => {
    const line = (o) => JSON.stringify(o);
    const jsonl = [
      line({ type: "assistant", message: { content: [{ type: "text", text: "первый" }] } }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "второй" }, { type: "text", text: "хвост" }] } }),
      line({ type: "user", message: { content: "ок" } }),
      "не json",
    ].join("\n");
    expect(lastAnswerOf(jsonl)).toBe("второй\nхвост");
    expect(lastAnswerOf("мусор")).toBe("");
  });
  // Шаг 6.1 прогона `2026-11-14`: мутанты чтения формы записи выживали.
  it("запись без сообщения, null, пустой текст и содержимое не списком — не ответ и не падение", () => {
    const line = (o) => JSON.stringify(o);
    const said = (text) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
    expect(lastAnswerOf(said("единственный"))).toBe("единственный");
    const mixed = line({ type: "assistant", message: { content: [null, { type: "tool_use" }, { type: "text" }, { type: "text", text: "поздний" }] } });
    expect(lastAnswerOf([said("ранний"), mixed, "null", line({ type: "assistant" })].join("\n"))).toBe("\nпоздний");
    expect(lastAnswerOf(line({ type: "assistant", message: { content: "строкой" } }))).toBe("строкой");
    const tail = [line({ type: "assistant", message: { content: 3 } }), said("  \n")];
    expect(lastAnswerOf([said("раньше"), ...tail].join("\n"))).toBe("раньше");
  });
});
