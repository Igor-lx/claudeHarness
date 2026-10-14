/** Расход сессии свода — чистая половина: разбор журнала `claude -p` в
 * обращения, перечитывание, вызовы и обращения по видам, скачки контекста и
 * отказы. Журнал читает и пути ищет `graph.mjs` (режим `bar-probe --cost`);
 * здесь — только текст журнала на входе и числа на выходе, чтобы разбор гонял
 * тест без `claude`. Методика и базовая линия — `.claude/state/todo.md`, раздел
 * «Срезать остаток расхода свода по журналу прогона — шаг Б». */

/** Прирост контекста между соседними обращениями, с которого его называют. */
export const JUMP_TOKENS = 15000;

const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? []).map((part) => part?.text ?? "").join("");

/** Записи журнала: строка — запись; строка, что не разобралась, считается и
 * отбрасывается, а не роняет разбор. */
export const journalOf = (text) => {
  const records = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
};

/** Вид вызова: что сессия делала, а не как называется её инструмент. */
export const callKind = (name, input) => {
  if (name === "Read") {
    const at = String(input?.file_path ?? "");
    if (/bar-pages/.test(at)) return "Read:страница";
    if (/bar-protocol/.test(at)) return "Read:протокол";
    if (/\.context\//.test(at)) return "Read:база";
    return "Read:прочее";
  }
  if (name === "Bash") {
    const command = String(input?.command ?? "");
    const mode = /graph\.mjs\s+([\w-]+)/.exec(command);
    if (mode !== null) return "Bash:" + mode[1];
    if (/bar-protocol/.test(command)) return "Bash:срез протокола";
    if (/git diff/.test(command)) return "Bash:git diff";
    if (/\bnpm\b/.test(command)) return "Bash:npm";
    return "Bash:прочее";
  }
  return name;
};

/** Вид обращения по видам его вызовов. Правила идут по порядку: первое
 * сошедшееся решает. Запись файла вне базы — ответы и скрипты сессии. */
export const turnKind = (calls) => {
  if (calls.length === 0) return "ответ без вызовов";
  const kinds = new Set(calls.map((c) => c.kind));
  const has = (re) => [...kinds].some((k) => re.test(k));
  if (has(/^Read:протокол$|^Bash:срез протокола$/)) return "чтение протокола";
  if (has(/^Read:страница$|^Bash:bar-read$/)) return "страницы";
  if (has(/^Bash:bar$|^Bash:bar-fill$/)) return "bar и bar-fill";
  const writes = calls.filter((c) => /^(Write|Edit)$/.test(c.kind));
  if (writes.some((c) => !/\.context\//.test(c.path)))
    return "файл вне базы (ответы, скрипты)";
  if (has(/^Bash:прочее$/)) return "прочая оболочка";
  if (writes.length > 0 || has(/^Read:база$/)) return "база";
  return [...kinds].join("+");
};

/** Отказ среды начинается с её фразы; слова «permission» и «denied» в
 * середине — вывод самой команды, и отказом разрешений он не является. */
const failureOf = (text) => {
  if (/^(?:(?:Pre|Post)ToolUse\b|Hook\b)/.test(text)) return "hook";
  if (
    /^(?:This (?:Bash )?command\b|Claude requested permissions|Permission to use\b|Parser skipped|Redirect target)/.test(
      text,
    )
  )
    return "permission";
  return "error";
};

/** Расход сессии из записей журнала. Обращение — запись `assistant` с одним
 * `message.id`: одно обращение лежит несколькими записями с одним расходом,
 * поэтому по записям не считают, а контекст и вывод берут наибольшие. */
export const costOf = (records) => {
  const turns = [];
  const byId = new Map();
  const calls = new Map();
  const results = new Map();
  for (const record of records) {
    if (record?.type === "assistant" && record.message?.id) {
      const usage = record.message.usage ?? {};
      const ctx =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      let turn = byId.get(record.message.id);
      if (turn === undefined) {
        turn = { ctx: 0, out: 0, calls: [] };
        byId.set(record.message.id, turn);
        turns.push(turn);
      }
      turn.ctx = Math.max(turn.ctx, ctx);
      turn.out = Math.max(turn.out, usage.output_tokens ?? 0);
      for (const part of record.message.content ?? []) {
        if (part?.type !== "tool_use" || calls.has(part.id)) continue;
        const call = {
          id: part.id,
          kind: callKind(part.name, part.input),
          path: String(part.input?.file_path ?? ""),
          turn: turns.length - 1,
        };
        calls.set(part.id, call);
        turn.calls.push(call);
      }
    }
    if (record?.type === "user" && Array.isArray(record.message?.content))
      for (const part of record.message.content) {
        if (part?.type !== "tool_result") continue;
        const text = textOf(part.content);
        results.set(part.tool_use_id, {
          size: text.length,
          failure: part.is_error === true ? failureOf(text) : null,
        });
      }
  }

  const count = turns.length;
  const reread = turns.reduce((sum, t) => sum + t.ctx, 0);
  const first = count === 0 ? 0 : turns[0].ctx;

  const byKind = new Map();
  const refusals = { permission: 0, hook: 0, error: 0 };
  for (const call of calls.values()) {
    const result = results.get(call.id);
    const size = result?.size ?? 0;
    const row = byKind.get(call.kind) ?? {
      kind: call.kind,
      n: 0,
      chars: 0,
      weighted: 0,
    };
    row.n += 1;
    row.chars += size;
    row.weighted += size * (count - 1 - call.turn);
    byKind.set(call.kind, row);
    if (result?.failure) refusals[result.failure] += 1;
  }

  const turnRows = new Map();
  for (const turn of turns) {
    const kind = turnKind(turn.calls);
    const row = turnRows.get(kind) ?? { kind, n: 0, ctx: 0 };
    row.n += 1;
    row.ctx += turn.ctx;
    turnRows.set(kind, row);
  }

  const jumps = [];
  for (let i = 1; i < count; i += 1) {
    const grow = turns[i].ctx - turns[i - 1].ctx;
    if (grow > JUMP_TOKENS)
      jumps.push({
        at: i,
        grow,
        after: [...new Set(turns[i - 1].calls.map((c) => c.kind))],
      });
  }

  const kindRows = [...byKind.values()].sort((a, b) => b.weighted - a.weighted);
  const protocolReads = kindRows
    .filter(
      (r) => r.kind === "Read:протокол" || r.kind === "Bash:срез протокола",
    )
    .reduce((sum, r) => sum + r.n, 0);
  return {
    turns: count,
    reread,
    first,
    base: first * count,
    output: turns.reduce((sum, t) => sum + t.out, 0),
    kinds: kindRows,
    turnKinds: [...turnRows.values()]
      .sort((a, b) => b.ctx - a.ctx)
      .map((r) => ({ ...r, share: reread === 0 ? 0 : r.ctx / reread })),
    jumps,
    protocolReads,
    refusals,
  };
};

const grouped = (n) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const percent = (part, whole) =>
  whole === 0 ? "0" : String(Math.round((100 * part) / whole));

/** Печать расхода: таблицы методики и готовая строка для замеров
 * `rationale/loop.md` — числа в ней в обратных кавычках, как требует база. */
export const costLines = (cost) => {
  const out = [];
  out.push("  обращений: " + cost.turns);
  out.push("  перечитывание: " + grouped(cost.reread) + " токенов контекста");
  out.push(
    "  стартовый контекст: " +
      grouped(cost.first) +
      " × " +
      cost.turns +
      " = " +
      grouped(cost.base) +
      " (" +
      percent(cost.base, cost.reread) +
      " % перечитывания)",
  );
  out.push("  вывод модели: " + grouped(cost.output) + " токенов");
  out.push(
    "  чтений протокола (Read и срезы оболочкой): " + cost.protocolReads,
  );
  out.push(
    "  отказы: разрешений " +
      cost.refusals.permission +
      ", хука " +
      cost.refusals.hook +
      ", прочих ошибок " +
      cost.refusals.error,
  );
  out.push("");
  out.push("  Вызовы по видам (знаки результатов × обращений после вызова):");
  for (const row of cost.kinds)
    out.push(
      "    " +
        row.kind.padEnd(26) +
        " вызовов " +
        String(row.n).padStart(3) +
        "  знаков " +
        String(row.chars).padStart(8) +
        "  вес " +
        (row.weighted / 1e6).toFixed(1) +
        " млн",
    );
  out.push("");
  out.push("  Обращения по видам (сумма контекстов, доля перечитывания):");
  for (const row of cost.turnKinds)
    out.push(
      "    " +
        row.kind.padEnd(34) +
        " обращений " +
        String(row.n).padStart(3) +
        "  " +
        (row.ctx / 1e6).toFixed(1) +
        " млн  " +
        percent(row.ctx, cost.reread) +
        " %",
    );
  out.push("");
  if (cost.jumps.length === 0)
    out.push("  Скачков контекста больше " + grouped(JUMP_TOKENS) + " нет.");
  else {
    out.push("  Скачки контекста больше " + grouped(JUMP_TOKENS) + " токенов:");
    for (const jump of cost.jumps)
      out.push(
        "    обращение " +
          jump.at +
          ": +" +
          grouped(jump.grow) +
          " после " +
          (jump.after.join(", ") || "ответа без вызовов"),
      );
  }
  out.push("");
  out.push("  Строка для замеров (`rationale/loop.md`):");
  out.push(
    "    `" +
      cost.turns +
      "` обращений, перечитывание `" +
      grouped(cost.reread) +
      "` токенов, стартовый контекст `" +
      grouped(cost.first) +
      "` (`" +
      percent(cost.base, cost.reread) +
      " %`), чтений протокола `" +
      cost.protocolReads +
      "`, отказов разрешений `" +
      cost.refusals.permission +
      "`",
  );
  return out;
};
