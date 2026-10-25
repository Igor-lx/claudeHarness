/** Страж чтения протокола свода — чистая половина: окно модели предмета и
 * вердикт чтению по его границам. Файлы читает и хук разбирает `graph.mjs`
 * (режим `guard`); здесь — текст протокола и числа на входе, вердикт на выходе.
 *
 * Протокол свода — запись для машины: дыры печатает `bar`, ключи к заполнению
 * и формы клеток он кладёт файлом ключей, и из протокола сессии нужна одна
 * модель предмета. Каждое
 * обращение заново проходит весь накопленный контекст, поэтому прочитанный
 * протокол платится на каждом обращении после чтения
 * (`.claude/rationale/loop.md`, раздел «Соразмерность: что читать под задачу»). */

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
  "Дыры и путь к файлу ключей к заполнению и форм клеток печатает `node .claude/tools/graph.mjs bar`; страницы чтения — `bar-read`. Остальной протокол читать незачем: он дорожает на каждом обращении после чтения.\n";

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

/** Правила на входе — `CLAUDE.md` корня и файлы правил без шапки `paths:` —
 * среда кладёт в контекст при старте сессии и больше не обновляет: правка их
 * на диске посреди сессии — `git pull`, переключение ветки — оставляет в
 * контексте прежний текст без признака. Здесь — шаг состояния: снимок
 * отпечатков на старте, сверка на каждом вызове, напоминание о расхождении.
 *
 * `state` — прежнее состояние либо `null`; `now` — путь от корня → отпечаток;
 * `call` — вызов: сессия, инструмент, путь файла от корня либо `null`.
 * Первый вызов сессии делает снимок. Чтение файла инструментом `Read` снимает
 * его из устаревших. Своя правка (`Edit`, `Write`) принимается следующим
 * вызовом: сессия видела её сама. Найдено прогоном проб `2026-10-23`. */
export const rulesFreshnessOf = (state, now, call) => {
  if (state === null || state.session !== call.session)
    return { state: { session: call.session, seen: { ...now }, own: [] }, stale: [] };
  const seen = { ...state.seen };
  for (const rel of state.own ?? [])
    if (rel in now) seen[rel] = now[rel];
    else delete seen[rel];
  // Путь несут только `Read` и правки; правленый, новый тоже, принимается и следующим вызовом.
  if (call.file in now) seen[call.file] = now[call.file];
  const own = ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(call.tool) ? [call.file] : [];
  const stale = [];
  for (const rel of Object.keys({ ...seen, ...now }).sort()) {
    if (!(rel in seen)) stale.push({ rel, how: "новый" });
    else if (!(rel in now)) stale.push({ rel, how: "снят" });
    else if (seen[rel] !== now[rel]) stale.push({ rel, how: "изменён" });
  }
  // Снятый называется раз: перечитывать нечего.
  for (const one of stale) if (one.how === "снят") delete seen[one.rel];
  return { state: { session: call.session, seen, own }, stale };
};

/** Напоминание об устаревших правилах — одной строкой для контекста;
 * пусто — напоминать не о чем. */
export const rulesFreshnessText = (stale) =>
  stale.length === 0
    ? ""
    : "Обвязка: правила изменились после начала сессии, и в контексте их прежний текст — " +
      stale.map((s) => "`" + s.rel + "` (" + s.how + ")").join(", ") +
      ". Изменённый и новый перечитать инструментом Read: пока не перечитан, напоминание повторяется; снятый больше не действует.";
