// Разбор модуля: что он берёт и что отдаёт.
//
// Одна запись на текст модуля, и её читают все места инструмента, которым
// нужны импорты и экспорты: граф, имена взятого и отданного, поверхность,
// привязки модели свода, импорт листа стилей, переотдача целиком, константы
// настроек. Прежде каждое место держало свой образец, и расходились они без
// признака: разбор графа понимал форму, которой не понимал разбор имён.
//
// Реализаций две, запись у них одна: регулярными выражениями и компилятором
// TypeScript из пакетов проекта. Вход — текст как есть: снимать ли
// комментарии, решает зовущий, как решал и прежде.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const NAME = /^[A-Za-z_$][\w$]*$/;

/** Строка импорта и переотдачи: `import … from "x"`, `export … from "x"`.
 * Клаузе запрещено содержать кавычку и точку с запятой: с `[\s\S]*?` разбор
 * перешагивал через импорт-побочный-эффект и склеивал его со следующей
 * строкой. */
const FROM =
  /(?:^|\n)\s*(import|export)\s+([^;"']*?)\s*from\s*["']([^"']+)["']/g;
/** Импорт-побочный-эффект: ребро графа без имён. */
const BARE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
/** Имя, объявленное экспортом в самом файле. Одна форма на оба разбора —
 * экспортов и объявлений: прежний список слов не знал `async`, `let`, `var`,
 * `declare` и `function*`, и асинхронная функция не числилась экспортом
 * вовсе — ни мёртвым, ни взятым. */
const OWN =
  /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|abstract\s+class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
/** `export { … }` и `export type { … }` — с источником и без. */
const BRACED = /export\s*(?:type\s*)?\{([^}]*)\}/g;
/** `export { … }` без источника: отдаёт наружу своё либо взятое импортом. */
const LOCAL = /export\s*(?:type\s*)?\{([^}]*)\}(?!\s*from)/g;
/** Константа, отданная наружу с начала строки: таблица настроек. */
const CONSTANT = /^export const ([A-Z][A-Z0-9_]*)/gm;
/** Импорт во время работы: `import("x")` и `require("x")` с адресом
 * строкой. */
const DYNAMIC =
  /(?<![\w$.])(import|require)\s*\(\s*(["'`])([^"'`$\n]+)\2\s*\)/g;
/** Импорт во время работы с адресом-шаблоном: постоянное начало до первой
 * подстановки и хвост после последней. */
const TEMPLATED =
  /(?<![\w$.])(import|require)\s*\(\s*`([^`$]*)\$\{([^`]*)`\s*\)/g;
/** Импорт во время работы с адресом-значением: переменной, вызовом,
 * сложением строк. */
const VALUED = /(?<![\w$.])(import|require)\s*\(\s*(?=[A-Za-z_$(])/g;
/** Строчный комментарий: снимается перед поиском импорта во время работы.
 * Перед двумя косыми — начало строки, пробел либо скобка: двоеточие адреса
 * `https://` комментарием не считается. */
const LINE_COMMENT = /(^|[\s;{}()])\/\/[^\n]*/g;

/** Импорты во время работы в тексте, найденные образцом. Тип
 * `import("x").T` и `typeof import("x")` — не ребро исполнения: сборка его
 * стирает. */
const commentlessOf = (src) =>
  src.replace(
    LINE_COMMENT,
    (m, lead) => lead + " ".repeat(m.length - lead.length),
  );
const dynamicOf = (src) => {
  const text = commentlessOf(src);
  const out = [];
  for (const m of text.matchAll(DYNAMIC)) {
    const call = m[1];
    const after = text.slice(m.index + m[0].length);
    if (
      call === "import" &&
      (/typeof\s*$/.test(text.slice(Math.max(0, m.index - 16), m.index)) ||
        /^\s*\.\s*[A-Za-z_$][\w$]*(?!\s*[(\w$])/.test(after))
    )
      continue;
    out.push({
      spec: m[3],
      end: m.index + m[0].lastIndexOf(m[2]) + 1,
      call,
    });
  }
  return out;
};

/** Импорты во время работы, чей адрес собран выражением: `call`,
 * постоянное начало `prefix`, постоянный хвост `suffix` и смещение довода
 * `at`. У адреса-значения начало и хвост пусты. */
const computedOf = (src) => {
  const text = commentlessOf(src);
  const out = [];
  for (const m of text.matchAll(TEMPLATED))
    out.push({
      call: m[1],
      prefix: m[2],
      suffix: m[3].slice(m[3].lastIndexOf("}") + 1),
      at: m.index + m[0].indexOf("`"),
    });
  for (const m of text.matchAll(VALUED))
    out.push({ call: m[1], prefix: "", suffix: "", at: m.index + m[0].length });
  return out.sort((x, y) => x.at - y.at);
};

/** Скобки клаузы — части по запятой, с пометкой «только тип». */
const specifiersOf = (clause) => {
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (braces === null) return [];
  const out = [];
  for (const raw of braces[1].split(",")) {
    const part = raw.trim();
    if (part === "") continue;
    const typeOnly = /^type\s+/.test(part);
    const [there, here] = part
      .replace(/^type\s+/, "")
      .split(/\s+as\s+/)
      .map((x) => x.trim());
    out.push({ there, here: here ?? there, typeOnly });
  }
  return out;
};

/** Клауза вне скобок и вне `* as` — местное имя взятого по умолчанию;
 * не имя — пустая строка. */
const defaultLocalOf = (clause) => {
  const name = clause
    .replace(/\{[\s\S]*\}/, "")
    .replace(/\*\s+as\s+[\w$]+/, "")
    .replace(/^type\s+/, "")
    .split(",")[0]
    .trim();
  return NAME.test(name) ? name : "";
};

/** Разбор текста модуля регулярными выражениями.
 *
 * `froms` — строки `import`/`export … from` по порядку: ключевое слово,
 * адрес как написан, `typeOnly` — вся строка о типах, `star` — звёздочка в
 * клаузе, `namespace` — имя после `* as`, `specifiers` — скобки: имя там,
 * имя здесь, пометка «только тип», `defaultLocal` — местное имя взятого по
 * умолчанию либо пустая строка, `end` — смещение за кавычкой адреса.
 * `bare` — импорты-побочные-эффекты: адрес и `end`. `own` — имена,
 * объявленные экспортом; `hasDefault` — есть `export default`;
 * `defaultBinding` — имя в `export default X;`; `local` — `export { … }` без
 * источника: имя здесь и имя наружу; `surface` — всё, что модуль отдаёт по
 * имени; `constants` — константы, отданные с начала строки; `dynamic` —
 * импорты во время работы: адрес, `end` и вызов — `import` либо `require`;
 * `computed` — импорты во время работы с адресом, собранным выражением. */
export const parseModuleRegex = (src) => {
  const froms = [];
  for (const m of src.matchAll(FROM)) {
    const clause = m[2];
    froms.push({
      keyword: m[1],
      spec: m[3],
      typeOnly: /^type\b/.test(clause),
      star: clause.includes("*"),
      namespace: /\*\s+as\s+([\w$]+)/.exec(clause)?.[1] ?? null,
      specifiers: specifiersOf(clause),
      defaultLocal: defaultLocalOf(clause),
      end: m.index + m[0].length,
    });
  }
  const bare = [...src.matchAll(BARE)].map((m) => ({
    spec: m[1],
    end: m.index + m[0].length,
  }));
  const own = new Set([...src.matchAll(OWN)].map((m) => m[1]));
  const hasDefault = /export\s+default\s/.test(src);
  const defaultBinding =
    /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(src)?.[1] ?? null;
  const local = [];
  for (const m of src.matchAll(LOCAL))
    for (const raw of m[1].split(",")) {
      const part = raw.trim().replace(/^type\s+/, "");
      if (part === "") continue;
      const [here, out] = part.split(/\s+as\s+/).map((x) => x.trim());
      local.push({ here, out: out ?? here });
    }
  // `export type { … }` — тоже экспорт: разбор, требовавший скобку сразу за
  // словом `export`, такого типа не видел вовсе.
  const surface = new Set(own);
  if (hasDefault) surface.add("default");
  for (const m of src.matchAll(BRACED))
    for (const raw of m[1].split(",")) {
      const part = raw.trim().replace(/^type\s+/, "");
      if (part === "") continue;
      const name = (
        part.split(/\s+as\s+/)[1] ?? part.split(/\s+as\s+/)[0]
      ).trim();
      if (NAME.test(name)) surface.add(name);
    }
  const constants = [...src.matchAll(CONSTANT)].map((m) => m[1]);
  return {
    froms,
    bare,
    own,
    hasDefault,
    defaultBinding,
    local,
    surface,
    constants,
    dynamic: dynamicOf(src),
    computed: computedOf(src),
  };
};

/** Вид исходника по расширению: `.ts`, разобранный как TSX, читает
 * обобщение стрелочной функции разметкой, и разбор теряет строки за ним. */
const scriptKindOf = (ts, file) =>
  /\.tsx$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.[cm]?ts$/.test(file)
      ? ts.ScriptKind.TS
      : /\.jsx$/.test(file)
        ? ts.ScriptKind.JSX
        : /\.[cm]?js$/.test(file)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TSX;

/** Тот же разбор компилятором TypeScript: запись той же формы.
 *
 * Видит только строки верхнего уровня, а импорт и экспорт внутри строки,
 * шаблона и комментария — нет. `ts` — модуль компилятора, его даёт
 * `compilerAt`; `file` — имя файла, по расширению которого выбран вид. */
export const parseModuleTs = (src, ts, file = "module.tsx") => {
  const source = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    false,
    scriptKindOf(ts, file),
  );
  const froms = [];
  const bare = [];
  const own = new Set();
  let hasDefault = false;
  let defaultBinding = null;
  const local = [];
  const braced = [];
  const constants = [];
  const modifies = (node, kind) =>
    (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some(
      (m) => m.kind === kind,
    );
  const specifiersOfNode = (elements) =>
    elements.map((e) => ({
      there: (e.propertyName ?? e.name).text,
      here: e.name.text,
      typeOnly: e.isTypeOnly,
    }));
  for (const st of source.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = st.moduleSpecifier.text;
      const end = st.moduleSpecifier.end;
      const clause = st.importClause;
      if (clause === undefined) {
        bare.push({ spec, end });
        continue;
      }
      const bindings = clause.namedBindings;
      const namespace =
        bindings !== undefined && ts.isNamespaceImport(bindings)
          ? bindings.name.text
          : null;
      froms.push({
        keyword: "import",
        spec,
        typeOnly: clause.isTypeOnly,
        star: namespace !== null,
        namespace,
        specifiers:
          bindings !== undefined && ts.isNamedImports(bindings)
            ? specifiersOfNode(bindings.elements)
            : [],
        defaultLocal: clause.name?.text ?? "",
        end,
      });
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      const exported = st.exportClause;
      const named =
        exported !== undefined && ts.isNamedExports(exported)
          ? exported.elements
          : [];
      for (const e of named) braced.push(e.name.text);
      if (st.moduleSpecifier === undefined) {
        for (const e of named)
          local.push({ here: (e.propertyName ?? e.name).text, out: e.name.text });
        continue;
      }
      froms.push({
        keyword: "export",
        spec: st.moduleSpecifier.text,
        typeOnly: st.isTypeOnly,
        star: exported === undefined || ts.isNamespaceExport(exported),
        namespace:
          exported !== undefined && ts.isNamespaceExport(exported)
            ? exported.name.text
            : null,
        specifiers: specifiersOfNode(named),
        defaultLocal: "",
        end: st.moduleSpecifier.end,
      });
      continue;
    }
    if (ts.isExportAssignment(st)) {
      if (st.isExportEquals) continue;
      hasDefault = true;
      if (ts.isIdentifier(st.expression)) defaultBinding = st.expression.text;
      continue;
    }
    if (!modifies(st, ts.SyntaxKind.ExportKeyword)) continue;
    if (modifies(st, ts.SyntaxKind.DefaultKeyword)) {
      hasDefault = true;
      continue;
    }
    if (ts.isVariableStatement(st)) {
      const constant =
        (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        own.add(d.name.text);
        if (constant && /^[A-Z][A-Z0-9_]*$/.test(d.name.text))
          constants.push(d.name.text);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      st.name !== undefined
    )
      own.add(st.name.text);
  }
  const surface = new Set(own);
  if (hasDefault) surface.add("default");
  for (const name of braced) surface.add(name);
  // Импорт во время работы — вызов на любой глубине, а не строка верхнего
  // уровня. Тип `import("x").T` — узел типа, а не вызов, и сюда не попадает.
  const dynamic = [];
  const computed = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const arg = node.arguments[0];
      const call =
        node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? "import"
          : ts.isIdentifier(node.expression) &&
              node.expression.text === "require"
            ? "require"
            : null;
      if (call !== null && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        if (!arg.text.includes("\n")) dynamic.push({ spec: arg.text, end: arg.end, call });
      } else if (call !== null)
        computed.push({
          call,
          prefix: ts.isTemplateExpression(arg) ? arg.head.text : "",
          suffix: ts.isTemplateExpression(arg) ? arg.templateSpans[arg.templateSpans.length - 1].literal.text : "",
          at: arg.getStart(source),
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return {
    froms,
    bare,
    own,
    hasDefault,
    defaultBinding,
    local,
    surface,
    constants,
    dynamic,
    computed,
  };
};

/** Компилятор TypeScript из пакетов проекта, корень которого `repoRoot`;
 * пакета нет — `null`. Пакет проекта лежит в `node_modules` его папки либо
 * выше по дереву; найденный по `NODE_PATH` — глобальная установка, которой
 * проект не объявлял, и она не в счёт. */
export const compilerAt = (repoRoot) => {
  // Пакет ищется по пути, а не по разрешённому адресу: пакет, поставленный
  // ссылкой, разрешается в чужую папку, и песочница пробы, связывающая
  // пакеты проекта, молча разбирала код регулярными выражениями. Найдено
  // прогоном проб.
  for (let dir = path.resolve(repoRoot); ; dir = path.dirname(dir)) {
    const at = path.join(dir, "node_modules", "typescript", "package.json");
    if (existsSync(at)) return createRequire(at)("typescript");
    if (path.dirname(dir) === dir) return null;
  }
};

/** Разбор регулярными выражениями — запасной и для тех, кому графа не надо. */
export const regexParser = {
  name: "регулярные выражения",
  parse: (src) => parseModuleRegex(src),
};

/** Разбор для проекта с корнем `repoRoot`: компилятором, когда он есть
 * среди пакетов проекта, иначе регулярными выражениями. `name` — какой
 * выбран, `parse(src, file)` — сам разбор. */
export const parserFor = (repoRoot) => {
  const ts = compilerAt(repoRoot);
  return ts === null
    ? regexParser
    : {
        name: "компилятор TypeScript " + ts.version,
        parse: (src, file) => parseModuleTs(src, ts, file),
      };
};
