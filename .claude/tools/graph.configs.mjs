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
import { Module, createRequire } from "node:module";
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
  // Область — `files`, `include`, `exclude` — наследуется, как у компилятора,
  // и считается от папки того конфига, где записана: строгая копия поверх
  // файла-решения видит его `files: []`. Выведено восьмой посадкой.
  const area = {};
  for (const ext of [raw.extends ?? []].flat()) {
    if (!String(ext).startsWith(".")) continue;
    let to = path.resolve(path.dirname(at), ext);
    if (!existsSync(to) && existsSync(to + ".json")) to += ".json";
    const parent = tsconfigText(tsconfigAt(to), seen);
    options = { ...options, ...(parent?.options ?? {}) };
    for (const key of ["files", "include", "exclude"])
      if (Array.isArray(parent?.raw?.[key]))
        area[key] = parent.raw[key].map((one) =>
          path
            .relative(path.dirname(at), path.resolve(path.dirname(parent.at), one))
            .split(path.sep)
            .join("/"),
        );
  }
  for (const key of ["files", "include", "exclude"])
    if (raw[key] === undefined && area[key] !== undefined) raw[key] = area[key];
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

/** Текст без блока `key: { … }`: блок снимают по балансу скобок, и то,
 * что идёт после него, остаётся. */
const withoutBlock = (text, key) => {
  const m = new RegExp("\\b" + key + "\\s*:\\s*\\{").exec(text);
  if (m === null) return text;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
    if (depth === 0) return text.slice(0, m.index) + text.slice(i + 1);
  }
  return text.slice(0, m.index);
};

/** Запасной путь: секция тестов разбором текста. Область сбора — первый
 * непустой список строк вне блока покрытия: у покрытия своя. */
const runnerConfigText = (at) => {
  const text = readFileSync(at, "utf8");
  const section = testSectionOf(text);
  if (section === null) return { at, via: BY_TEXT, text, test: null };
  const head = withoutBlock(section, "coverage");
  const include = [...head.matchAll(/\binclude:\s*\[([^\]]*)\]/g)]
    .map((m) => stringsOf(m[1]))
    .find((list) => list.length > 0);
  const setup = /\bsetupFiles:\s*(\[[^\]]*\]|["'][^"']+["'])/.exec(head);
  return {
    at,
    via: BY_TEXT,
    text,
    test: {
      ...(include === undefined ? {} : { include }),
      ...(setup === null ? {} : { setupFiles: stringsOf(setup[1]) }),
      ...(/\bglobals:\s*true\b/.test(head) ? { globals: true } : {}),
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
    if (depth === 0 && opens > 0) block = { text: "", off: [] };
    if (block !== null) {
      // Область — по всему тексту блока: форматтер переносит длинный массив
      // `files` на строки, и построчный разбор такой блок читал блоком `**`.
      block.text += line + "\n";
      for (const m of line.matchAll(
        /(["']?)([\w@/-]+)\1\s*:\s*\[?\s*(["'])off\3/g,
      ))
        block.off.push(m[2]);
    }
    depth += opens - closes;
    if (depth <= 0 && block !== null) {
      const f = /files:\s*\[([^\]]*)\]/.exec(block.text);
      const files = f === null ? [] : stringsOf(f[1]);
      for (const rule of block.off)
        for (const scope of files.length ? files : ["**"])
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

/** Файлы настройки раннера jest в порядке, в каком их ищет сам раннер. */
const JEST_FILES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
  "jest.config.cts",
  "jest.config.mts",
  "jest.config.json",
];
/** Модуль настройки на TypeScript: переводит компилятор проекта. */
const tsModuleOf = (at, repoRoot) => {
  const ts = createRequire(path.join(repoRoot, "package.json"))("typescript");
  const out = ts.transpileModule(readFileSync(at, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const m = new Module(at);
  m.filename = at;
  m.paths = Module._nodeModulePaths(path.dirname(at));
  m._compile(out, at);
  return m.exports;
};
/** Настройка раннера jest: `{ name, at, config, broke? }` либо `null` — нет
 * ни файла `jest.config.*`, ни поля `jest` манифеста. Функция вместо
 * объекта и сбой загрузки — `config: null`, `broke` называет почему. */
export const jestConfigLoad = (repoRoot, manifest) => {
  for (const name of JEST_FILES) {
    const at = path.join(repoRoot, name);
    if (!existsSync(at)) continue;
    try {
      const got = name.endsWith(".json")
        ? parseJsonc(readFileSync(at, "utf8"))
        : /\.[cm]?ts$/.test(name)
          ? tsModuleOf(at, repoRoot)
          : createRequire(at)(at);
      const config = got?.default ?? got;
      if (typeof config === "function")
        return { name, at, config: null, broke: "настройка — функция, область не вычислить без запуска" };
      return { name, at, config };
    } catch (error) {
      return { name, at, config: null, broke: String(error?.message ?? error).split("\n")[0] };
    }
  }
  if (manifest?.jest != null && typeof manifest.jest === "object")
    return { name: "package.json → jest", at: path.join(repoRoot, "package.json"), config: manifest.jest };
  return null;
};

/** Умолчание `testMatch` раннера jest. */
const JEST_DEFAULT_MATCH = ["**/__tests__/**/*.?([mc])[jt]s?(x)", "**/?(*.)+(spec|test).?([mc])[jt]s?(x)"];
/** Соберёт ли jest файл по абсолютному адресу: корни `roots`, образцы
 * `testMatch` либо выражение `testRegex`, исключения
 * `testPathIgnorePatterns` — с подстановкой `<rootDir>`, как у раннера. */
export const jestCollects = (config, configDir, repoRoot) => {
  const rootDir = path.resolve(configDir, config.rootDir ?? ".");
  const posix = (p) => p.split(path.sep).join("/");
  const sub = (s) => s.replaceAll("<rootDir>", posix(rootDir));
  const roots = (config.roots ?? ["<rootDir>"]).map((r) => path.resolve(sub(r)));
  const ignore = (config.testPathIgnorePatterns ?? ["/node_modules/"]).map((r) => new RegExp(sub(r)));
  const regex = config.testRegex == null ? null : [config.testRegex].flat().map((r) => new RegExp(r));
  const globs = (config.testMatch ?? JEST_DEFAULT_MATCH).map((g) => {
    const full = sub(g);
    return full.startsWith(posix(rootDir) + "/") ? full.slice(posix(rootDir).length + 1) : full;
  });
  const match = globMatcher(globs, repoRoot);
  return (abs) => {
    const at = posix(abs);
    if (!roots.some((r) => at.startsWith(posix(r) + "/"))) return false;
    if (ignore.some((r) => r.test(at))) return false;
    if (regex !== null) return regex.some((r) => r.test(at));
    return match(posix(path.relative(rootDir, abs)));
  };
};

/** Строгость семени конфига компилятора — опции, которые звено типов
 * приносит живому проекту. */
const STRICT_KEYS = /^(?:strict|no[A-Z]\w*|exactOptional\w*)$/;

/** Имя, под которым конфиг проекта ложится рядом с конфигом обвязки:
 * `eslint.config.js` → `eslint.project.config.js`. Конфигом корня его
 * узнаёт тот же образец `*.config.*`, что и прочие: линт с типами их не
 * разбирает. */
export const projectConfigName = (own) => own.replace(/\.(config|conf)\./, (m, word) => ".project." + word + ".");

/** Конфиг линта обвязки для живого проекта: конфиг проекта подключён
 * первым, правила обвязки — поверх; линт с типами читает строгие конфиги
 * звена типов. */
export const eslintLiveText = (seed, own, strictConfigs) => {
  const lines = seed.split("\n");
  const lastImport = lines.reduce((at, line, i) => (line.startsWith("import ") ? i : at), -1);
  if (own !== null)
    lines.splice(lastImport + 1, 0, 'import project from "./' + own + '";');
  let text = lines.join("\n");
  if (own !== null) {
    const head = "export default tseslint.config(\n";
    if (!text.includes(head)) throw new Error("в семени конфига линта нет `" + head.trim() + "`");
    text =
      text.replace(head, "const harness = tseslint.config(\n") +
      [
        "",
        "// The project's config first, the harness on top; a plugin both load is the harness's.",
        "const shared = Object.assign({}, ...harness.map((block) => block.plugins ?? {}));",
        "export default [",
        "  ...[project].flat().map((block) =>",
        "    block.plugins === undefined",
        "      ? block",
        "      : {",
        "          ...block,",
        "          plugins: Object.fromEntries(",
        "            Object.entries(block.plugins).map(([name, plugin]) => [name, shared[name] ?? plugin]),",
        "          ),",
        "        },",
        "  ),",
        "  ...harness,",
        "];",
        "",
      ].join("\n");
  }
  if (!text.includes("projectService: true,")) throw new Error("в семени конфига линта нет `projectService: true`");
  return text.replace(
    "projectService: true,",
    "project: [" + strictConfigs.map((one) => '"./' + one + '"').join(", ") + "],",
  );
};

/** Конфиг раннера тестов: конфиг проекта под ним, сверху — исключения
 * обвязки. */
export const vitestLiveText = (base) =>
  [
    "// The project's config with the harness exclusions on top.",
    'import { configDefaults, defineConfig, mergeConfig } from "vitest/config";',
    ...(base === null ? [] : ['import project from "./' + base + '";']),
    "",
    "export default defineConfig(async (env) =>",
    "  mergeConfig(" + (base === null ? "{}" : 'typeof project === "function" ? await project(env) : project') + ", {",
    "    test: {",
    '      exclude: [...configDefaults.exclude, ".claude/**", ".stryker-tmp/**"],',
    "      passWithNoTests: true,",
    "    },",
    "  }),",
    ");",
    "",
  ].join("\n");

/** Строгие копии конфигов компилятора: на конфиг — копия, продолжающая его
 * и несущая строгость семени; на решение со ссылками — копия каждой ссылки
 * и решение из копий (`seat/seat.md`, раздел о строгости). Отдаёт файлы и
 * вызов звена типов. */
export const strictConfigsOf = (read, seedTsconfig) => {
  const seed = parseJsonc(seedTsconfig) ?? {};
  const strict = Object.fromEntries(
    Object.entries(seed.compilerOptions ?? {}).filter(([k]) => STRICT_KEYS.test(k)),
  );
  // Конфиг есть, а не разбирается — причина отказа, а не пустой объект:
  // прежде строгая копия ложилась поверх сломанного, и отказ винил звено.
  const parsed = (name) => {
    const raw = read(name);
    if (raw === null) return {};
    const one = parseJsonc(raw);
    if (one === null) throw new Error(name + " проекта не разбирается как JSON с комментариями");
    return one;
  };
  const root = parsed("tsconfig.json");
  const files = {};
  const copyOf = (name) => {
    const own = parsed(name);
    const options = { ...strict, noEmit: true };
    if (own.compilerOptions?.tsBuildInfoFile !== undefined)
      options.tsBuildInfoFile = "./node_modules/.tmp/" + name.replace(/\.json$/, ".strict.tsbuildinfo");
    return { extends: "./" + name, compilerOptions: options };
  };
  if (Array.isArray(root.references) && root.references.length > 0 && root.compilerOptions === undefined) {
    const refs = root.references.map((r) => String(r.path).replace(/^\.\//, ""));
    const names = refs.map((r) => (r.endsWith(".json") ? r : r + "/tsconfig.json"));
    const copies = names.map((one) => one.replace(/\.json$/, ".strict.json"));
    names.forEach((one, i) => (files[copies[i]] = copyOf(one)));
    files["tsconfig.strict.json"] = { files: [], references: copies.map((one) => ({ path: "./" + one })) };
    return { files, call: "tsc -b tsconfig.strict.json", lint: copies };
  }
  files["tsconfig.strict.json"] = copyOf("tsconfig.json");
  return { files, call: "tsc -p tsconfig.strict.json", lint: ["tsconfig.strict.json"] };
};

/** Композиция конфигов знакомого проекта: конфиг проекта того же
 * инструмента ложится рядом `*.project.config.*` и подключается из конфига
 * обвязки; строгость — копиями конфигов компилятора; старый формат линта —
 * рядом. Имена конфигов — карта посадки: семя и его другие имена. Отдаёт
 * файлы к записи, переносы, строки отчёта и строгость звена типов
 * (`seat/seat.md`, шаг 1-бис). */
export const composeLive = ({ exists, read, seed, map, roots, prettierInManifest }) => {
  const entry = (pick) => (map.copy ?? []).find(pick);
  const namesOf = (e) => (e === undefined ? [] : [e.to, ...(e.alsoKnownAs ?? [])]);
  const lying = (names) => names.find((one) => exists(one)) ?? null;
  const lint = entry((e) => e.neededBy === "lint" && !e.to.includes("/"));
  const runner = entry((e) => e.neededBy === "test" && !e.to.includes("/"));
  const mutate = entry((e) => e.neededBy === "mutate" && !e.to.includes("/"));
  const format = entry((e) => e.inManifest === "prettier");
  const node = entry((e) => e.inManifest === "volta");
  const compiler = entry((e) => e.to === COMPILER_CONFIG);
  const files = {};
  const moves = [];
  const report = [];
  const strict = strictConfigsOf(read, seed(compiler.to));
  for (const [name, json] of Object.entries(strict.files)) files[name] = JSON.stringify(json, null, 2) + "\n";
  const isLegacy = (one) => /^\.eslintrc/.test(one);
  const ownLint = lying(namesOf(lint).filter((one) => !isLegacy(one)));
  if (ownLint !== null) moves.push([ownLint, projectConfigName(ownLint)]);
  files[lint.to] = eslintLiveText(seed(lint.to), ownLint === null ? null : projectConfigName(ownLint), strict.lint);
  const ownRunner = lying(runner.shadowedBy ?? []);
  if (ownRunner !== null) moves.push([ownRunner, projectConfigName(ownRunner)]);
  const base = ownRunner !== null ? projectConfigName(ownRunner) : lying(namesOf(runner));
  files[(runner.shadowedBy ?? [])[0]] = vitestLiveText(base);
  // Старый формат конфига линта ESLint 9 и новее не читает, а подключить
  // его из плоского нечем: он ложится рядом, правила переносит переход.
  const legacy = (lint.alsoKnownAs ?? []).filter((one) => isLegacy(one) && exists(one));
  for (const one of legacy) moves.push([one, one.replace(/^\.eslintrc/, ".eslintrc.project")]);
  if (legacy.length > 0)
    report.push(
      "Старый конфиг линта лежит как " +
        legacy.map((one) => one.replace(/^\.eslintrc/, ".eslintrc.project")).join(", ") +
        ": ESLint 9 и новее его не читает, и его правила не действуют, пока их не перенесут в конфиг проекта нового формата.",
    );
  if (lying(namesOf(format)) === null && !prettierInManifest) files[format.to] = seed(format.to);
  const ownMutate = lying(namesOf(mutate));
  if (ownMutate !== null) moves.push([ownMutate, projectConfigName(ownMutate)]);
  const stryker = JSON.parse(seed(mutate.to));
  stryker.mutate = roots.flatMap((r) => [
    r + "/**/*.ts",
    r + "/**/*.tsx",
    "!" + r + "/**/*.d.ts",
    "!" + r + "/**/*.test.*",
    "!" + r + "/**/*.spec.*",
    "!" + r + "/**/tests/**",
    "!" + r + "/**/__tests__/**",
  ]);
  files[mutate.to] = JSON.stringify(stryker, null, 2) + "\n";
  if (lying(namesOf(node)) === null) files[node.to] = seed(node.to);
  return { files, moves, report, strict };
};
