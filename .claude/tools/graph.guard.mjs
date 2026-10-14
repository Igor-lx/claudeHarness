/** Страж чтения протокола свода — чистая половина: окно модели предмета и
 * вердикт чтению по его границам. Файлы читает и хук разбирает `graph.mjs`
 * (режим `guard`); здесь — текст протокола и числа на входе, вердикт на выходе.
 *
 * Протокол свода — запись для машины: ключи к заполнению, формы клеток и дыры
 * печатает `bar`, и из протокола сессии нужна одна модель предмета. Каждое
 * обращение заново проходит весь накопленный контекст, поэтому прочитанный
 * протокол платится на каждом обращении после чтения (`.claude/state/todo.md`,
 * раздел «Срезать остаток расхода свода по журналу прогона — шаг Б»). */

/** Заголовок раздела, который читают из протокола. */
export const MODEL_TITLE = "## Модель предмета";
/** Столько строк `Read` отдаёт без `limit`. */
const READ_DEFAULT_LINES = 2000;

/** Окно модели предмета: номер первой строки и число строк, как их принимает
 * `Read`. Раздела нет — `null`. Его же печатает `bar` строкой ключей. */
export const modelWindowOf = (text) => {
  const lines = text.split(/\r?\n/);
  const from = lines.indexOf(MODEL_TITLE);
  if (from < 0) return null;
  const next = lines.findIndex((l, i) => i > from && l.startsWith("## "));
  const last = next < 0 ? lines.length : next;
  return { offset: from + 1, limit: last - from };
};

const exit = (win) =>
  (win === null
    ? ""
    : "Модель предмета читается одним вызовом Read с offset " +
      win.offset +
      " и limit " +
      win.limit +
      ".\n") +
  "Ключи к заполнению, формы клеток и дыры печатает `node .claude/tools/graph.mjs bar`; страницы чтения — `bar-read`. Остальной протокол читать незачем: он дорожает на каждом обращении после чтения.\n";

/** Отказ чтению протокола инструментом `Read`; пустая строка — читать можно.
 * Окно чтения — от `offset` (без него с первой строки) на `limit` строк (без
 * него — сколько отдаёт `Read`); оно обязано лежать внутри окна модели.
 * Протокол без раздела модели читать нечем отвести — страж его пропускает. */
export const protocolReadFault = (text, offset, limit) => {
  const win = modelWindowOf(text);
  if (win === null) return "";
  const total = text.split(/\r?\n/).length;
  const start = Math.max(1, Number.isFinite(offset) ? offset : 1);
  const end = Math.min(
    total,
    Number.isFinite(limit) ? start + limit - 1 : start + READ_DEFAULT_LINES - 1,
  );
  if (start >= win.offset && end <= win.offset + win.limit - 1) return "";
  return (
    "Обвязка: протокол свода читается окном модели предмета, а не целиком и не вне окна.\n" +
    exit(win)
  );
};

/** Отказ чтению протокола командой оболочки; `text` — протокол, если его
 * удалось прочитать, иначе `null`. Оболочкой протокол не читают вовсе: окно
 * модели берут `Read` с границами из вывода `bar`. */
export const protocolShellFault = (reader, text) =>
  "Обвязка: протокол свода оболочкой не читается (`" +
  reader +
  "`).\n" +
  exit(text === null ? null : modelWindowOf(text));
