// Конфиги проекта — их собственными загрузчиками.
//
// Инструмент читал конфиги проекта разбором текста, и каждое новое
// написание давало новый дефект: `tsc -p .` — папка вместо файла, `test:{`
// без пробела, `./src/**` от точки, `extends` из пакета. Проект читает их
// своим компилятором, своим сборщиком и своим сопоставителем путей, и
// инструмент спрашивает их же: тогда любое написание, которое понимает
// проект, понимает и он. Пакета нет — запасной путь разбором текста, и
// ответ называет, каким путём получен.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compilerAt } from "./graph.parse.mjs";

export const BY_LOADER = "загрузчиком проекта";
export const BY_TEXT = "разбором текста";

/** Пакет проекта по имени: разрешённый адрес либо `null`. */
const packageIn = (repoRoot, name) => {
  try {
    return createRequire(path.join(repoRoot, "package.json")).resolve(name);
  } catch {
    return null;
  }
};

/** Конфиг с комментариями: `tsconfig.json` их допускает, `JSON.parse` — нет.
 * `null` — разобрать не удалось. Запасной путь для конфига компилятора, когда
 * компилятора у проекта нет. */
export const parseJsonc = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    // Снимать комментарии образцом по всему тексту нельзя: маска вида `src`
    // со звёздами содержит последовательность, неотличимую от пустого
    // блочного комментария, и образец съедал её изнутри строки — короткий
    // адрес превращался в огрызок. Поэтому сканер, знающий про строки.
    let out = "";
    let inString = false;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (inString) {
        out += c;
        if (c === "\\") {
          out += raw[i + 1] ?? "";
          i += 1;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        out += c;
        continue;
      }
      if (c === "/" && raw[i + 1] === "/") {
        while (i < raw.length && raw[i] !== "\n") i += 1;
        out += "\n";
        continue;
      }
      if (c === "/" && raw[i + 1] === "*") {
        const end = raw.indexOf("*/", i + 2);
        i = end < 0 ? raw.length : end + 1;
        continue;
      }
      out += c;
    }
    try {
      return JSON.parse(out);
    } catch {
      return null;
    }
  }
};

/** Имя конфига, который компилятор читает в папке вызова без `-p`. */
export const COMPILER_CONFIG = "tsconfig.json";

/** Конфиг компилятора по адресу из вызова или ссылки: `-p` и ссылка называют
 * и файл, и папку. */
export const tsconfigAt = (named) =>
  existsSync(named) && statSync(named).isDirectory()
    ? path.join(named, COMPILER_CONFIG)
    : named;

/** Конфиг компилятора с тем, что он продолжает: `{ at, via, options, raw,
 * references }`; файла нет — `null`. Компилятор проекта разрешает
 * `extends` из пакета, цепочку и ссылки так же, как при проверке типов, и
 * называет файлы, которые видит, — `fileNames`; разбор текста их не знает,
 * там `null`. */
export const tsconfigRead = (named, repoRoot) => {
  const at = tsconfigAt(named);
  if (!existsSync(at)) return null;
  const ts = compilerAt(repoRoot);
  if (ts !== null) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      at,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );
    if (parsed !== undefined)
      return {
        at,
        via: BY_LOADER,
        options: parsed.options,
        raw: parsed.raw ?? {},
        references: (parsed.projectReferences ?? []).map((r) =>
          tsconfigAt(r.path),
        ),
        // Файлы, которые компилятор по этому конфигу действительно видит.
        fileNames: parsed.fileNames.map((f) => path.resolve(f)),
      };
  }
  return tsconfigText(at);
};

/** Запасной путь: опции разбором текста, `extends` — только по
 * относительному адресу. */
const tsconfigText = (at, seen = new Set()) => {
  if (seen.has(at) || !existsSync(at)) return null;
  seen.add(at);
  const raw = parseJsonc(readFileSync(at, "utf8"));
  if (raw === null) return null;
  let options = {};
  for (const ext of [raw.extends ?? []].flat()) {
    if (!String(ext).startsWith(".")) continue;
    let to = path.resolve(path.dirname(at), ext);
    if (!existsSync(to) && existsSync(to + ".json")) to += ".json";
    options = {
      ...options,
      ...(tsconfigText(tsconfigAt(to), seen)?.options ?? {}),
    };
  }
  const own = { ...(raw.compilerOptions ?? {}) };
  if (typeof own.baseUrl === "string")
    own.baseUrl = path.resolve(path.dirname(at), own.baseUrl);
  if (own.paths !== undefined) own.pathsBasePath = path.dirname(at);
  return {
    at,
    via: BY_TEXT,
    options: { ...options, ...own },
    raw,
    fileNames: null,
    references: (raw.references ?? []).map((r) =>
      tsconfigAt(path.resolve(path.dirname(at), r.path)),
    ),
  };
};

/** Секция тестов настройки раннера в тексте — от её начала до конца файла,
 * либо `null`. По форме, а не по написанию: `test:{` без пробела форматтер
 * проекта не обязан править. */
export const testSectionOf = (body) => {
  const m = /(?:^|[\s,{])["']?test["']?\s*:\s*\{/.exec(body);
  return m === null ? null : body.slice(m.index);
};

const stringsOf = (list) =>
  [...list.matchAll(/["']([^"']+)["']/g)].map((g) => g[1]);

/** Запасной путь: секция тестов разбором текста. Область сбора — первый
 * список строк до покрытия: у покрытия своя. */
const runnerConfigText = (at) => {
  const text = readFileSync(at, "utf8");
  const section = testSectionOf(text);
  if (section === null) return { at, via: BY_TEXT, text, test: null };
  const cut = section.search(/\bcoverage\s*:/);
  const head = cut < 0 ? section : section.slice(0, cut);
  const include = [...head.matchAll(/\binclude:\s*\[([^\]]*)\]/g)]
    .map((m) => stringsOf(m[1]))
    .find((list) => list.length > 0);
  const setup = /\bsetupFiles:\s*(\[[^\]]*\]|["'][^"']+["'])/.exec(section);
  return {
    at,
    via: BY_TEXT,
    text,
    test: {
      ...(include === undefined ? {} : { include }),
      ...(setup === null ? {} : { setupFiles: stringsOf(setup[1]) }),
      ...(/\bglobals:\s*true\b/.test(section) ? { globals: true } : {}),
    },
  };
};

/** Настройка раннера: `{ at, via, text, test, broke? }`; файла нет — `null`.
 * `test` — секция тестов, `null` — её нет. Вычисляет её сборщик проекта
 * тем же порядком, что и раннер: со слиянием, функцией конфига и любым
 * написанием. Сборщик не смог — запасной путь, и `broke` называет почему. */
export const runnerConfigLoad = async (at, repoRoot) => {
  if (!existsSync(at)) return null;
  const vite = packageIn(repoRoot, "vite");
  if (vite === null) return runnerConfigText(at);
  try {
    const { loadConfigFromFile } = await import(pathToFileURL(vite).href);
    const got = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      at,
      path.dirname(at),
      "silent",
    );
    return {
      at,
      via: BY_LOADER,
      text: readFileSync(at, "utf8"),
      test: got?.config?.test ?? null,
    };
  } catch (error) {
    return {
      ...runnerConfigText(at),
      broke: String(error?.message ?? error).split("\n")[0],
    };
  }
};

/** Действующий конфиг раннера среди загруженных `{ name, … }` либо
 * `undefined`. */
export const runnerEffective = (configs) =>
  [...configs].sort((a, b) => runnerRank(a.name) - runnerRank(b.name))[0];

/** Выключения правил, которые автор написал в конфиге линта сам: пары
 * `{ scope, rule }`, у блока без `files` область `**`. Текстом, а не
 * загрузчиком линта: загруженный конфиг несёт выключения пресетов, которых
 * автор не писал, и стоит `2` секунды на импорт плагинов. Блок — по балансу
 * скобок; правило — ключ в любых кавычках либо без них, значение `"off"`
 * либо массив с ним первым. Ноль не читается: `{ max: 0 }` в опциях правила
 * неотличим от выключения. */
export const lintOffWritten = (text) => {
  const found = [];
  let depth = 0;
  let block = null;
  for (const line of text.split("\n")) {
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (depth === 0 && opens > 0) block = { files: [], off: [] };
    if (block !== null) {
      const f = /files:\s*\[([^\]]*)\]/.exec(line);
      if (f !== null) block.files.push(...stringsOf(f[1]));
      for (const m of line.matchAll(
        /(["']?)([\w@/-]+)\1\s*:\s*\[?\s*(["'])off\3/g,
      ))
        block.off.push(m[2]);
    }
    depth += opens - closes;
    if (depth <= 0 && block !== null) {
      for (const rule of block.off)
        for (const scope of block.files.length ? block.files : ["**"])
          found.push({ scope, rule });
      block = null;
      depth = 0;
    }
  }
  return found;
};

/** Старшинство имён конфига раннера — порядок, в котором его ищет `vitest`:
 * сначала `vitest.config`, затем `vite.config`, внутри — по расширению.
 * Действующий конфиг — первый лежащий; затенённый раннер не читает. */
const RUNNER_NAMES = ["vitest.config", "vite.config"];
const RUNNER_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
export const runnerRank = (name) => {
  const base = path.basename(name);
  const ext = path.extname(base);
  const head = RUNNER_NAMES.indexOf(base.slice(0, -ext.length));
  const tail = RUNNER_EXTENSIONS.indexOf(ext);
  return head < 0 || tail < 0
    ? Number.MAX_SAFE_INTEGER
    : head * RUNNER_EXTENSIONS.length + tail;
};

/** Образцы раннера по умолчанию — те, что берёт `vitest`, когда область
 * сбора не названа. */
export const RUNNER_DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];

/** Запасной сопоставитель: звёзды и перечень в фигурных скобках. */
const globsToTest = (globs) => {
  const toRe = (glob) => {
    let out = "";
    for (let i = 0; i < glob.length; i += 1) {
      const ch = glob[i];
      if (ch === "*") {
        if (glob[i + 1] === "*") {
          if (glob[i + 2] === "/") {
            out += "(?:[^/]*/)*";
            i += 2;
          } else {
            out += ".*";
            i += 1;
          }
        } else out += "[^/]*";
      } else if (ch === "{" && glob.indexOf("}", i) > i) {
        const end = glob.indexOf("}", i);
        out +=
          "(?:" +
          glob
            .slice(i + 1, end)
            .split(",")
            .map((part) => toRe(part).source.slice(1, -1))
            .join("|") +
          ")";
        i = end;
      } else if (".+^${}()|[]\\?".includes(ch)) out += "\\" + ch;
      else out += ch;
    }
    return new RegExp("^" + out + "$");
  };
  return (positive) => {
    const res = positive.map(toRe);
    return (f) => res.some((r) => r.test(f));
  };
};

/** Принадлежит ли путь, записанный от корня проекта, образцам `globs`;
 * образец с `!` исключает. Сопоставляет `picomatch` проекта — им пользуются
 * раннер и обход файлов, — иначе запасной разбор. `via` — каким путём. */
export const globMatcher = (globs, repoRoot) => {
  // `./src/**` и `src/**` — один образец, а путь файла приходит без точки.
  const bare = (g) => g.replace(/^(?:\.\/)+/, "");
  const yes = globs.filter((g) => !g.startsWith("!")).map(bare);
  const no = globs
    .filter((g) => g.startsWith("!"))
    .map((g) => bare(g.slice(1)));
  const at = packageIn(repoRoot, "picomatch");
  let make = null;
  let via = BY_TEXT;
  if (at !== null)
    try {
      const picomatch = createRequire(at)(at);
      make = (list) => (list.length ? picomatch(list) : () => false);
      via = BY_LOADER;
    } catch {
      make = null;
    }
  if (make === null) {
    const fallback = globsToTest();
    make = (list) => fallback(list);
  }
  const inside = make(yes);
  const outside = make(no);
  const match = (f) => inside(f) && !outside(f);
  match.via = via;
  return match;
};
