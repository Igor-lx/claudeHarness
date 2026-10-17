// Шаги сверки базы по тексту самого инструмента.
//
// Сверка базы — один сценарий, разрезанный на шаги `checkStep`: упавший шаг
// не обрывает прогон. Но шаги делят данные: один считает, другой печатает
// секцию через десятки шагов. Какие секции читают данные упавшего шага, по
// выводу не узнать — только по коду. Здесь этот разбор: компилятор читает
// текст инструмента, и следом за данными находятся задетые шаги. Нужен
// только на пути падения и тесту обвязки, который требует, чтобы весь код
// сверки лежал в шагах.

const STEP_CALLS = new Set(["checkStep", "checkStepAsync"]);
/** Строка, с которой начинается хвост прогона: он идёт вне шагов, потому что
 * подводит их итог. */
export const VERIFY_TAIL = "Хвост прогона идёт вне шагов";

const verifyBlockOf = (ts, sf) => {
  for (const st of sf.statements)
    if (
      ts.isIfStatement(st) &&
      st.expression.getText(sf) === 'mode === "verify"'
    )
      return st.thenStatement;
  return null;
};

/** Вызов шага в выражении: `checkStep(…)`, `await checkStepAsync(…)`,
 * `checkStep(…) ?? []`. */
const stepCallIn = (ts, node) => {
  let n = node;
  if (n !== undefined && ts.isBinaryExpression(n)) n = n.left;
  if (n !== undefined && ts.isAwaitExpression(n)) n = n.expression;
  return n !== undefined &&
    ts.isCallExpression(n) &&
    STEP_CALLS.has(n.expression.getText())
    ? n
    : null;
};

/** Значение, вычисление которого упасть не может: литерал, пустой массив,
 * функция, пустой конструктор, имя либо цепочка свойств имени. */
const isPlainInit = (ts, e) => {
  if (e === undefined) return true;
  if (ts.isIdentifier(e)) return true;
  if (ts.isPropertyAccessExpression(e)) return isPlainInit(ts, e.expression);
  return (
    (ts.isArrayLiteralExpression(e) && e.elements.length === 0) ||
    ts.isNumericLiteral(e) ||
    ts.isStringLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.NullKeyword ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isArrowFunction(e) ||
    ts.isFunctionExpression(e) ||
    (ts.isNewExpression(e) && (e.arguments ?? []).length === 0)
  );
};

const bindingNames = (ts, name, out = []) => {
  if (ts.isIdentifier(name)) out.push(name.text);
  else
    for (const el of name.elements ?? [])
      if (el.name) bindingNames(ts, el.name, out);
  return out;
};

const tailIndex = (block, sf) =>
  block.statements.findIndex((st) =>
    sf.text.slice(st.getFullStart(), st.getStart()).includes(VERIFY_TAIL),
  );

/** Операторы сверки базы, лежащие вне шагов до хвоста прогона: каждый
 * такой — код, падение которого снова оборвёт прогон. Строка — номер строки
 * и начало текста. */
export const statementsOutsideSteps = (ts, source) => {
  const sf = ts.createSourceFile(
    "graph.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const block = verifyBlockOf(ts, sf);
  if (block === null) return ["сверки базы в тексте нет"];
  const tail = tailIndex(block, sf);
  if (tail < 0) return ["хвоста прогона нет: строки «" + VERIFY_TAIL + "»"];
  const out = [];
  const say = (st) =>
    sf.getLineAndCharacterOfPosition(st.getStart()).line +
    1 +
    ": " +
    st.getText(sf).split("\n")[0].slice(0, 70);
  for (const st of block.statements.slice(0, tail)) {
    if (ts.isFunctionDeclaration(st)) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations)
        if (
          !isPlainInit(ts, d.initializer) &&
          stepCallIn(ts, d.initializer) === null
        )
          out.push(say(st));
      continue;
    }
    if (ts.isExpressionStatement(st) && stepCallIn(ts, st.expression) !== null)
      continue;
    out.push(say(st));
  }
  return out;
};

/** Шаги в порядке исполнения — он же порядок в тексте: шаги стоят только на
 * верхнем уровне сверки, каждый исполняется раз. Шаг: имена верхнего уровня,
 * которые он читает, и имена, которые он может изменить. */
const stepsOf = (ts, sf, block) => {
  const top = new Set();
  for (const st of block.statements) {
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        for (const one of bindingNames(ts, d.name)) top.add(one);
    if (ts.isFunctionDeclaration(st) && st.name) top.add(st.name.text);
  }
  const namesIn = (node) => {
    const seen = new Set();
    const walk = (n) => {
      if (ts.isIdentifier(n) && top.has(n.text)) {
        const p = n.parent;
        const isKey =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n);
        if (!isKey) seen.add(n.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return seen;
  };
  // Шаг секции начинается её заголовком; имя секции — его первый довод.
  const headOf = (call) => {
    const first = call.arguments[0]?.body?.statements?.[0];
    const head =
      first !== undefined &&
      ts.isExpressionStatement(first) &&
      ts.isCallExpression(first.expression) &&
      first.expression.expression.getText() === "checkHead"
        ? first.expression.arguments[0]
        : undefined;
    return head !== undefined && ts.isStringLiteral(head) ? head.text : null;
  };
  const steps = [];
  for (const st of block.statements) {
    if (ts.isExpressionStatement(st)) {
      const call = stepCallIn(ts, st.expression);
      if (call !== null) {
        const reads = namesIn(call.arguments[0]);
        steps.push({ head: headOf(call), reads, writes: new Set(reads) });
      }
    }
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) {
        const call = stepCallIn(ts, d.initializer);
        if (call === null) continue;
        const reads = namesIn(call.arguments[0]);
        steps.push({
          head: null,
          reads,
          writes: new Set([...reads, ...bindingNames(ts, d.name)]),
        });
      }
  }
  return steps;
};

/** Шаги, которые читают данные упавших: номер шага (с единицы) → номер
 * упавшего, от которого идёт след. Данные текут дальше: шаг, прочитавший
 * задетое, задевает всё, что может изменить. Изменение берётся с запасом —
 * всё прочитанное, — и задетым след помечает больше, чем есть, но не
 * меньше. `null` — разобрать текст нечем. */
export const stepsTouchedBy = (ts, source, crashed) => {
  if (ts === null) return null;
  const sf = ts.createSourceFile(
    "graph.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const block = verifyBlockOf(ts, sf);
  if (block === null) return null;
  const steps = stepsOf(ts, sf, block);
  const origin = new Map();
  const tainted = new Map();
  const first = Math.min(...crashed);
  for (let k = first; k <= steps.length; k += 1) {
    const step = steps[k - 1];
    // Задетый упавшим раньше — его следствие, даже если упал и сам.
    let from = null;
    for (const name of step.reads)
      if (from === null && tainted.has(name)) from = tainted.get(name);
    if (from === null && crashed.includes(k)) from = k;
    if (from === null) continue;
    if (k !== from) origin.set(k, from);
    for (const name of step.writes)
      if (!tainted.has(name)) tainted.set(name, from);
  }
  return origin;
};

/** Шаги сверки в порядке исполнения: имя секции, которую шаг открывает
 * заголовком, либо `null`, и имена, которые он читает и может изменить. */
export const stepsOutline = (ts, source) => {
  const sf = ts.createSourceFile(
    "graph.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const block = verifyBlockOf(ts, sf);
  return block === null ? [] : stepsOf(ts, sf, block);
};

/** Заголовки секций под угрозой пропасть из вывода. На уровне шага —
 * заголовок не первым в шаге либо со счётом корпуса до заголовка: шаг,
 * падающий раньше заголовка, уносит секцию, а счёт, вычисленный до вызова,
 * падает раньше печати. Глубже — в условии, блоке, цикле — заголовок обязан
 * стоять в области `checkRegion` и быть назван её перечнем: тогда пропуск и
 * падение печатают секцию сами. Строка — номер строки, имя, причина. */
export const headsAtRisk = (ts, source) => {
  const sf = ts.createSourceFile(
    "graph.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const block = verifyBlockOf(ts, sf);
  if (block === null) return [];
  const out = [];
  const say = (call, why) =>
    sf.getLineAndCharacterOfPosition(call.getStart()).line +
    1 +
    ": " +
    call.arguments[0].getText(sf) +
    " — " +
    why;
  const isCall = (n, name) =>
    ts.isCallExpression(n) && n.expression.getText(sf) === name;
  const stepLevel = new Set();
  for (const st of block.statements) {
    if (!ts.isExpressionStatement(st)) continue;
    const call = stepCallIn(ts, st.expression);
    const body = call?.arguments[0]?.body?.statements ?? [];
    body.forEach((one, i) => {
      if (
        !ts.isExpressionStatement(one) ||
        !isCall(one.expression, "checkHead")
      )
        return;
      const head = one.expression;
      stepLevel.add(head);
      if (i > 0) out.push(say(head, "заголовок не первым в шаге"));
      const looked = head.arguments[1];
      if (looked !== undefined && !ts.isArrowFunction(looked))
        out.push(say(head, "счёт корпуса до заголовка"));
    });
  }
  const walk = (n) => {
    // Имя, которое вычисляется, падает раньше печати заголовка — на любом
    // уровне.
    if (
      isCall(n, "checkHead") &&
      stepLevel.has(n) &&
      !ts.isStringLiteral(n.arguments[0])
    )
      out.push(say(n, "имя секции вычисляется — перечень с ним не сверить"));
    if (isCall(n, "checkHead") && !stepLevel.has(n)) {
      let region = n.parent;
      while (region !== undefined && !isCall(region, "checkRegion"))
        region = region.parent;
      const title = n.arguments[0];
      if (!ts.isStringLiteral(title))
        out.push(say(n, "имя секции вычисляется — перечень с ним не сверить"));
      else if (region === undefined)
        out.push(say(n, "заголовок вглубь шага, вне области с перечнем"));
      else {
        const list = region.arguments[0];
        const named =
          ts.isArrayLiteralExpression(list) &&
          list.elements.some(
            (e) => ts.isStringLiteral(e) && e.text === title.text,
          );
        if (!named) out.push(say(n, "секция не названа перечнем области"));
      }
    }
    ts.forEachChild(n, walk);
  };
  // Хвост прогона идёт вне шагов намеренно: он подводит их итог.
  const tail = tailIndex(block, sf);
  for (const st of block.statements.slice(0, tail < 0 ? undefined : tail))
    walk(st);
  return out;
};
