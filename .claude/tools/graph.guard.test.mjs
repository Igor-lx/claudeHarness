import { describe, expect, it } from "vitest";
import {
  MODEL_TITLE,
  modelWindowOf,
  protocolReadFault,
  protocolShellFault,
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
