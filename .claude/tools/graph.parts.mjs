/** Части правки — чистая половина: таблица в протоколе свода, компоненты
 * связности, записи файла базы и наложение выбранных частей на прежний вид
 * файла. Всё, что спрашивает репозиторий и граф, — в `graph.mjs`.
 *
 * Несколько независимых правок проходят планку одним сводом, а в историю
 * уходят отдельными коммитами — коммит на часть. Раскладку правки по частям
 * держит машина: каждый изменённый файл и каждая изменённая запись — ровно в
 * одной части, и сумма частей, наложенных на последний коммит, равна рабочему
 * дереву. Решение разработчика `2026-10-10`. */

export const PARTS_TITLE = "Части правки";
export const PARTS_HEAD = "| часть | файлы | что |";

const cellsOf = (line) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim());
const tickedIn = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** Таблица частей из текста протокола: строки по порядку. Раздела нет —
 * `null`: одна часть на весь предмет, обычная работа тем же путём. */
export const partsTableOf = (body) => {
  const lines = body.split(/\r?\n/);
  const at = lines.indexOf("## " + PARTS_TITLE);
  if (at < 0) return null;
  const rows = [];
  for (
    let i = at + 1;
    i < lines.length && !lines[i].startsWith("## ");
    i += 1
  ) {
    const line = lines[i];
    if (!line.startsWith("| ") || line === PARTS_HEAD) continue;
    const cells = cellsOf(line);
    if (/^-+$/.test(cells[0] ?? "")) continue;
    rows.push({
      n: cells[0] ?? "",
      files: tickedIn(cells[1] ?? ""),
      what: cells[2] ?? "",
      line: i + 1,
    });
  }
  return rows;
};

/** Раздел протокола с таблицей частей; строка — файлы и слова «что». */
export const partsSectionOf = (rows) => [
  "## " + PARTS_TITLE,
  "",
  "Правка уходит в историю частями — коммит на часть. Части предложила",
  "машина: компоненты связности правленых файлов. Сливать части можно —",
  "перенести файлы одной строки в другую и удалить опустевшую; разрезать",
  "компоненту нельзя, отказ называет связь. Графа «что» — сообщение коммита",
  "части. Тесты и прочие файлы в папке единицы переноса идут с её частью,",
  "записи базы и документации — с частью, чьи файлы называют; другие",
  "файлы — конфиги, манифест — называют в графе «файлы».",
  "",
  PARTS_HEAD,
  "| --- | --- | --- |",
  ...rows.map(
    (r, k) =>
      "| " +
      (k + 1) +
      " | " +
      r.files.map((f) => "`" + f + "`").join(", ") +
      " | " +
      (r.what ?? "") +
      " |",
  ),
  "",
];

/** Компоненты связности списка по связи `link(a, b)` — причина словами либо
 * `null`. Компонента — файлы по порядку списка; компоненты — по первому
 * файлу. */
export const componentsOf = (list, link) => {
  const parent = list.map((_, i) => i);
  const top = (i) => (parent[i] === i ? i : (parent[i] = top(parent[i])));
  for (let i = 0; i < list.length; i += 1)
    for (let j = i + 1; j < list.length; j += 1)
      if (top(i) !== top(j) && link(list[i], list[j]) !== null)
        parent[top(j)] = top(i);
  const groups = new Map();
  list.forEach((f, i) => {
    const t = top(i);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(f);
  });
  return [...groups.values()];
};

/** Строки текста вместе с концом строки: файл без перевода строки в конце
 * отличается от файла с ним, и наложение частей обязано это сохранить. */
export const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Записи файла базы и документации: на каждую строку — `[начало, конец]` её
 * записи, с нуля. Строка таблицы, называющая путь, — сама себе запись;
 * прочее — раздел от заголовка до заголовка, заголовок — в своём разделе. */
export const recordsOf = (lines) => {
  const out = new Array(lines.length);
  const heads = [];
  lines.forEach((l, i) => {
    if (l.startsWith("#")) heads.push(i);
  });
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("|") && lines[i].includes("`")) {
      out[i] = [i, i];
      continue;
    }
    let start = 0;
    let end = lines.length - 1;
    for (const h of heads) {
      if (h <= i) start = h;
      else {
        end = h - 1;
        break;
      }
    }
    out[i] = [start, end];
  }
  return out;
};

/** Ханки вывода `git diff -U0`: прежнее начало и число строк, новое начало и
 * число, с единицы, как пишет git. */
export const hunksOf = (diff) =>
  [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(
    (m) => ({
      a: Number(m[1]),
      b: m[2] === undefined ? 1 : Number(m[2]),
      c: Number(m[3]),
      d: m[4] === undefined ? 1 : Number(m[4]),
    }),
  );

/** Изменённые строки ханков: снятые — номером в прежнем виде, добавленные —
 * в новом, с нуля. */
export const changedLinesOf = (hunks) => {
  const removed = [];
  const added = [];
  for (const h of hunks) {
    for (let k = 0; k < h.b; k += 1) removed.push(h.a - 1 + k);
    for (let k = 0; k < h.d; k += 1) added.push(h.c - 1 + k);
  }
  return { removed, added };
};

/** Текст после наложения выбранных частей на прежний вид. Снятая строка
 * снимается, если её часть выбрана; добавленная добавляется так же. Внутри
 * ханка сохранённые прежние строки идут раньше добавленных. */
export const applyParts = (oldLines, newLines, hunks, partOf, chosen) => {
  const out = [];
  let i = 0;
  for (const h of hunks) {
    const from = h.b === 0 ? h.a : h.a - 1;
    while (i < from) out.push(oldLines[i++]);
    for (let k = 0; k < h.b; k += 1, i += 1)
      if (!chosen.has(partOf.removed.get(i))) out.push(oldLines[i]);
    const at = h.d === 0 ? h.c : h.c - 1;
    for (let k = 0; k < h.d; k += 1)
      if (chosen.has(partOf.added.get(at + k))) out.push(newLines[at + k]);
  }
  while (i < oldLines.length) out.push(oldLines[i++]);
  return out.join("");
};
