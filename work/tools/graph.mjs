import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Словарь области — чистые функции от пути, вынесенные ради одного: решение
// «к какому файлу относится этот вопрос» должно быть записано ОДИН раз.
// Выводясь на месте, оно выводилось по-разному, и три дефекта подряд были
// забытым слагаемым такой комбинации.
import {
  inComment,
  isCodePath,
  isTestPath,
  selfCheck,
  touchesRuntime,
} from "./graph.predicates.mjs";

// Настройка проекта и якорь его базы. Инструмент от проекта не зависит: всё
// проектное живёт в этом файле и только в нём.
//
// Путь фиксирован раскладкой: обвязка лежит в `.claude/`, база — в `.context/`,
// обе соседями в корне проекта. Инструмент поэтому поднимается на три уровня и
// спускается в базу. Менять адрес — значит менять раскладку, а она объявлена в
// инструкции посадки.
import { BASE, CONFIG } from "../../../.context/graph.config.mjs";

/** Папка самого инструмента. Нужна ровно там, где речь о его собственных
 * соседях — справочнике режимов и словаре области. Всё остальное считается от
 * папки базы: у этих двух адресов разные хозяева, и пока они назывались одним
 * именем, перенос инструмента увёз бы за собой всю базу. */
const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));


const ROOT = path.join(BASE, CONFIG.src).split(path.sep).join("/");

/** Папки, которых в описи нет: порождённые инструментами копии дерева и
 * служебные каталоги. Список один на всех, кто обходит дерево, — опись голых
 * имён, опись имён из кода и состав полки; разойдясь, они дали бы разные
 * ответы на один и тот же вопрос «что лежит в репозитории».
 *
 * `.stryker-tmp` пропускается не для скорости: во время мутационного прогона
 * там лежит ПОЛНАЯ копия дерева, и каждое имя становится неоднозначным — то
 * есть сверка замолчала бы ровно тогда, когда рядом идёт долгий прогон. На
 * этом и попался замер, которым эта дыра меряли.
 *
 * `.git` в списке был с самого начала, а обход состава полки его не спрашивал:
 * список был объявлен внутри одной сверки и другим обходам недоступен. Полку
 * кладут под версионный контроль, и первый же `git init` добавил бы к её
 * составу сотни служебных файлов — каждый как «файл полки без объяснения».
 * Найдено до первого коммита. */
const OUT_OF_TREE = new Set([
  "node_modules",
  ".git",
  ".stryker-tmp",
  "dist",
  "coverage",
  "reports",
]);

// --- производные от одного переключателя `shelf` -----------------------------
// Всё, что зависит от своей полки, считается здесь и нигде больше. Раньше эти
// адреса стояли семью отдельными полями, и «полку с собой не берём» означало
// погасить каждое: инструкция называла одно, посадка ломалась на шести.
const SHELF = CONFIG.shelf == null ? null : path.join(BASE, CONFIG.shelf);
const shelfAt = (tail) => (SHELF === null ? null : path.join(SHELF, tail));
/** Справочник режимов — лежит рядом с инструментом и читается из работы.
 *
 * Побайтовых пар здесь больше нет, и это следствие раскладки: доктрина,
 * инструмент и скиллы существуют в ОДНОМ экземпляре — в папке обвязки.
 * Пары сверяли копию с оригиналом; копии не стало, сверять нечего. Вместе с
 * ними ушло правило «поправил — скопируй на полку», из-за которого полка
 * после каждой посадки увозила состояние предыдущего проекта. */
const TOOL_MANUAL = "graph.md";
/** Объявление применимости разделов политики: карта «раздел → живой ли и почему».
 *
 * Разбор один на оба места — на сверку и на вопрос закрытия работы. Две копии
 * разошлись бы при первой правке заголовка таблицы, и разошлись бы молча:
 * сверка продолжала бы читать, а напоминание печатать пустоту. */
const qualityScopeDeclared = () => {
  if (CONFIG.qualityScope == null) return null;
  const at = path.join(BASE, CONFIG.qualityScope.table);
  if (!existsSync(at)) return null;
  // Перевод строки берётся литералом: помощник объявлен выше по файлу, чем
  // общая константа, и обращение к ней здесь падало бы на загрузке модуля.
  const lines = readFileSync(at, "utf8").split(String.fromCharCode(10));
  const head = lines.findIndex(
    (l) => l.trim() === CONFIG.qualityScope.heading.trim(),
  );
  if (head < 0) return null;
  const out = new Map();
  for (let i = head + 2; i < lines.length; i += 1) {
    if (!lines[i].trimStart().startsWith("|")) break;
    const cell = lines[i].split("|");
    const id = /^([K-U])\./.exec(cell[1].trim().replace(/`/g, ""));
    if (id === null) continue;
    // Сравнение словом, а не образцом с `\b`: граница слова в JS опирается на
    // латиницу, поэтому «да» ею не заканчивается. Первая редакция читала
    // КАЖДЫЙ раздел как неприменимый и доложила восемь расхождений на пустом
    // месте — та же ловушка, что уже записана в ловушках окружения.
    out.set(id[1], {
      live: cell[2].trim().toLowerCase() === "да",
      why: cell[3].trim(),
    });
  }
  return out;
};
/** Живые разделы политики — с различением ТРЁХ состояний, а не двух.
 *
 * «Деления нет» и «деление есть, но прочитать не смог» — разные ответы, и
 * помощник обязан их различать. Первая редакция возвращала на оба `null`, и
 * напоминание в момент закрытия работы печатало «деления на применимые нет»
 * при переименованном заголовке таблицы: сессия прочла бы одно ядро и сочла
 * это правильным. `verify` такую таблицу ловит, но его гоняют ПОЗЖЕ — между
 * ними помощник врал уверенно. Найдено пробой. */
const liveQualityScopes = () => {
  if (CONFIG.qualityScope == null) return { state: "нет деления" };
  const declared = qualityScopeDeclared();
  if (declared === null || declared.size === 0)
    return { state: "не прочитано" };
  return {
    state: "прочитано",
    live: [...declared].filter(([, v]) => v.live).map(([k]) => k),
  };
};
const SETTINGS_SHELF = shelfAt("seat/templates/settings.json");
const SHELF_RULES = SHELF === null ? null : SHELF.split(path.sep).join("/");
/** Путь для сообщений: от папки базы, чтобы читалось как в `CONFIG`. Принимает
 * и относительный — тогда возвращает его как есть. */
const rel0 = (p) =>
  p == null
    ? "—"
    : path.isAbsolute(p)
      ? path.relative(BASE, p).split(path.sep).join("/")
      : p;

const norm = (f) => f.split(path.sep).join("/").replace(/[/]+$/, "");

const files = [];

/** Обвязка, лежащая внутри `src`: своды правил и полка целиком.
 *
 * Физически это файлы проекта, по смыслу — инструкция о том, КАК с проектом
 * работают, а не описание того, ЧТО он делает. Проверки, обращённые к коду,
 * обязаны их не видеть: якорь `// See` из кода на свод правил бессмысленен, а
 * полка везёт копии инструмента и правил, где маркеры и адреса перечислены как
 * данные.
 *
 * Предикат один на всё это намеренно. До него та же мысль жила тремя разными
 * заплатками в трёх местах — «не `/context/`», «не `shared/context/tools/`», «не
 * файл правил», — каждая заведена под свой случай, и следующий случай потребовал
 * бы четвёртой. Найдено пробой: лечится класс, а не пример. */
const RULE_FILES = new Set(
  CONFIG.rulesManifest.rules.map((r) => norm(path.join(BASE, r))),
);
const SHELF_DIR = SHELF === null ? "\u0000нет полки" : norm(SHELF) + "/";
const isMachinery = (full) =>
  RULE_FILES.has(full) || full.startsWith(SHELF_DIR);

// Документация лежит рядом с кодом и адресуется из него якорями `// See`,
// поэтому собирается тем же обходом.
const docFiles = [];
// Стили в граф импортов не входят — их подключает сборщик, а не разбор, —
// но адрес у них такой же, и досье обязано о них отвечать.
const styleFiles = [];
// Обход корня исходников переживает его отсутствие. Прежде первый же
// `readdirSync` падал стеком на верхнем уровне модуля — то есть без папки
// `src` не работал НИ ОДИН режим, включая сверку базы и досье. Пустая папка при
// этом законна и штатна: обвязку сажают до первой строчки кода. Подтверждено
// пробой на копии проекта с удалённой папкой.
const walkable = (dir) => existsSync(dir) && statSync(dir).isDirectory();
(function walk(dir) {
  if (!walkable(dir)) return;
  for (const e of readdirSync(dir)) {
    const full = norm(path.join(dir, e));
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e)) files.push(full);
    else if (/\.md$/.test(e) && !isMachinery(full)) docFiles.push(full);
    else if (/\.scss$/.test(e)) styleFiles.push(full);
  }
})(ROOT);

const isTest = isTestPath;

/** Графа «держится», означающая отсутствие машинной опоры. Один источник на два
 * режима: `open` этой формой СОБИРАЕТ обещания, `verify` — требует её от каждой
 * записи объявленного раздела. Разъехавшись, они дали бы худшее из возможного —
 * сводка молчит, а прогон зелёный. */
const HELD_BY_NOTHING =
  /Держится:\s*(ничем|ничто|вниманием|памятью)|held by nothing/i;

// Ссылка на документацию — любой путь `*.md`, названный в КОММЕНТАРИИ. Форма
// у неё разная и это нормально: и отдельная строка `// See docs/x.md`, и
// оговорка в середине фразы «(see docs/x.md)». Проверять надо ссылку, а не
// её оформление, иначе половина остаётся без присмотра.
// Голое имя без слэша — продолжение фразы, а не путь: одноимённых документов
// в проекте бывает несколько, и разрешать такое имя значило бы гадать.
// Проверяются пути; проза остаётся прозой.
// Ссылка на РЕШЕНИЕ — вторая законная форма, и она не путь: соглашение проекта
// требует называть решение номером и ничем больше. Инструмент знал одну форму и
// нагонял бы на код, написанный по правилам: файл, сославшийся номером, читался
// как файл без ссылки вовсе. Найдено пробой — после того, как шесть ссылок
// привели к соглашению, режим `open` объявил один из них документом без якоря.
const ADR_REF = /\bADR[-\s](\d+)/g;
// Номер → тот же относительный вид, каким решения адресуют якоря в коде.
// Разрешаются они подъёмом по папкам, поэтому достаточно хвоста пути: он
// однозначен, а полный путь пришлось бы вычислять от каждого файла заново.
const adrByNumber = new Map();
if (CONFIG.adr != null) {
  const adrDir = norm(path.join(BASE, CONFIG.adr.dir));
  if (existsSync(adrDir)) {
    const tail = adrDir.split("/").slice(-2).join("/");
    for (const name of readdirSync(adrDir)) {
      const number = /^(\d+)/.exec(name);
      if (number !== null && name.endsWith(".md"))
        adrByNumber.set(Number(number[1]), `${tail}/${name}`);
    }
  }
}

const docRefsIn = (body) => {
  const out = [];
  for (const line of body.split(String.fromCharCode(10))) {
    if (!/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const t of line.match(/[\w./-]+\.md/g) ?? [])
      if (t.includes("/")) out.push(t);
    ADR_REF.lastIndex = 0;
    let hit;
    while ((hit = ADR_REF.exec(line)) !== null) {
      const file = adrByNumber.get(Number(hit[1]));
      if (file !== undefined) out.push(file);
    }
  }
  return out;
};

const rel = (f) => f.replace(ROOT + "/", "");

// --- разрешение спецификатора импорта в файл ---------------------------------
const resolve = (fromFile, spec) => {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec).replace(/\\/g, "/");
  const cands = [
    base + ".ts",
    base + ".tsx",
    base + "/index.ts",
    base + "/index.tsx",
    base,
  ];
  for (const c of cands) if (files.includes(c)) return c;
  return null;
};

// --- разбор импортов и экспортов ---------------------------------------------
const importsOf = new Map(); // файл -> набор файлов, которые он импортирует
const importedNames = new Map(); // файл -> имена, которые из него утащили
const exportsOf = new Map(); // файл -> имена, которые он экспортирует
const specsOf = new Map(); // файл -> спецификаторы как написаны, включая пакеты
const namesPulledBy = new Map(); // файл -> имена, которые он сам тянет откуда угодно

const NAME_RE = /^[A-Za-z_$][\w$]*$/;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  importsOf.set(f, new Set());

  // разбираемые формы: import { a, b as c } from "x" | import x from "y" | export {...} from "z"
  // Клаузе запрещено содержать кавычку и точку с запятой. Это не косметика:
  // с `[\s\S]*?` разбор перешагивал через импорт-побочный-эффект и склеивал
  // его со СЛЕДУЮЩЕЙ строкой — имя оттуда терялось, и `dead` показывал живой
  // экспорт мёртвым. Ограничение было записано в базе как свойство инструмента;
  // на деле оно чинится сужением класса, потому что настоящая клауза
  // (`x`, `* as ns`, `{ a as b }`, `type { T }`) ни кавычек, ни точек с запятой
  // не содержит никогда.
  const re =
    /(?:^|\n)\s*(?:import|export)\s+([^;"']*?)\s*from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1];
    if (!specsOf.has(f)) specsOf.set(f, new Set());
    specsOf.get(f).add(m[2]);
    const target = resolve(f, m[2]);
    if (!target) continue;
    importsOf.get(f).add(target);
    if (!importedNames.has(target)) importedNames.set(target, new Set());
    const set = importedNames.get(target);
    if (!namesPulledBy.has(f)) namesPulledBy.set(f, new Set());
    const mine = namesPulledBy.get(f);
    if (clause.includes("*")) {
      (set.add("*"), mine.add("*"));
      continue;
    }
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (let part of braces[1].split(",")) {
        part = part.trim().replace(/^type\s+/, "");
        if (!part) continue;
        const name = part.split(/\s+as\s+/)[0].trim();
        if (NAME_RE.test(name)) (set.add(name), mine.add(name));
      }
    }
    const def = clause
      .replace(/\{[\s\S]*\}/, "")
      .replace(/^type\s+/, "")
      .split(",")[0]
      .trim();
    if (def && NAME_RE.test(def)) (set.add("default"), mine.add("default"));
  }

  // Импорт-побочный-эффект (`import "x";`) — ребро графа без имён: он ничего
  // не тянет наружу, но модуль исполняет и в бандл затаскивает. В графе его не
  // было вовсе, поэтому правила направления и изоляции на нём проходили
  // зелёными, а `blast` недосчитывал импортёров. Найдено пробой: импорт такой
  // формы из изолированного слоя в запрещённый прогон не уронил.
  for (const mm of src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    if (!specsOf.has(f)) specsOf.set(f, new Set());
    specsOf.get(f).add(mm[1]);
    const target = resolve(f, mm[1]);
    if (target) importsOf.get(f).add(target);
  }

  // экспорты, объявленные в самом файле
  const ex = new Set();
  for (const mm of src.matchAll(
    /export\s+(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  ))
    ex.add(mm[1]);
  if (/export\s+default\s/.test(src)) ex.add("default");
  // `export type { … }` — тоже экспорт, и раньше он не считался вовсе: разбор
  // требовал скобку сразу за словом `export`. Тип, ушедший наружу только так,
  // был для инструмента невидим — то есть `dead` его не показывал даже без
  // потребителей, а запись базы о нём нечем было проверить. Найдено пробой.
  for (const mm of src.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (let part of mm[1].split(",")) {
      part = part.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const name = (
        part.split(/\s+as\s+/)[1] ?? part.split(/\s+as\s+/)[0]
      ).trim();
      if (NAME_RE.test(name)) ex.add(name);
    }
  }
  exportsOf.set(f, ex);
}

// --- обратный граф: кто кого импортирует ------------------------------------
const importedBy = new Map();
for (const [f, deps] of importsOf) {
  for (const d of deps) {
    if (!importedBy.has(d)) importedBy.set(d, new Set());
    importedBy.get(d).add(f);
  }
}

// --- общие части досье ------------------------------------------------------
// Их спрашивают два режима: `brief` («что это такое») и `plan` («что придётся
// тронуть»). Второй экземпляр этой логики был бы ровно тем дефектом, который
// мы ловим у форков: сверка строк базы тут тонкая — уникальность голого имени,
// сосед по папке, строка про ДРУГОЙ файл, — и разойдясь, две копии начали бы
// отвечать по-разному на один вопрос.
const LF = String.fromCharCode(10);

// Парная копия — часть ответа на «что это такое», а не только на «что придётся
// тронуть». Форк ловит именно при рассуждении: одинаковая форма читается как
// одинаковый смысл, и близнец надо знать ДО того, как объяснять файл, а не
// только перед правкой. Найдено пробой: `brief` о близнеце молчал, и режим для
// объяснения узла был как раз тем местом, где ловушка срабатывает.
const twinsOf = (r) => {
  const twins = [];
  for (const { from, to } of CONFIG.forks) {
    if (r.startsWith(from + "/")) twins.push(to + r.slice(from.length));
    if (r.startsWith(to + "/")) twins.push(from + r.slice(to.length));
  }
  return twins.filter((t) => files.some((f) => rel(f) === t));
};
const BACKTICK = String.fromCharCode(96);

let LINES_CACHE = null;
const dossierLines = () => {
  if (LINES_CACHE !== null) return LINES_CACHE;
  const base = [];
  const docs = [];
  for (const d of docFiles)
    readFileSync(d, "utf8")
      .split(LF)
      .forEach((line, i) => docs.push([rel(d), i + 1, line]));
  for (const name of readdirSync(BASE).filter((n) => n.endsWith(".md")))
    readFileSync(path.join(BASE, name), "utf8")
      .split(LF)
      .forEach((line, i) => base.push([name, i + 1, line]));
  LINES_CACHE = { base, docs };
  return LINES_CACHE;
};

// Обратная достижимость: какой тест дотягивается до файла ПО ГРАФУ, а не по
// совпадению имён. Имена врут — `useTrackBinding` закрыт `trackBinding.test.tsx`.
let REACH_CACHE = null;
const testReach = () => {
  if (REACH_CACHE !== null) return REACH_CACHE;
  const reach = new Map();
  for (const t of files.filter(isTest)) {
    const seen = new Set();
    const stack = [t];
    while (stack.length > 0) {
      for (const d of importsOf.get(stack.pop()) ?? []) {
        if (seen.has(d)) continue;
        seen.add(d);
        stack.push(d);
      }
    }
    for (const d of seen) {
      if (!reach.has(d)) reach.set(d, []);
      reach.get(d).push(t);
    }
  }
  REACH_CACHE = reach;
  return reach;
};

// Три РАЗНЫХ ответа, и путать их нельзя. Напрямую — тест сам назвал файл. Через
// бочку — взял из `index.ts` имя, которое определяет этот файл: бочка реэкспорт,
// а не потребитель, так что тест его всё-таки гоняет. Транзитивно — дотянулся
// через обычные модули, и это почти всегда не про него.
const testsFor = (target) => {
  const all = testReach().get(target) ?? [];
  const exported = exportsOf.get(target) ?? new Set();
  const direct = all.filter((t) => (importsOf.get(t) ?? new Set()).has(target));
  const byName = all.filter(
    (t) =>
      !direct.includes(t) &&
      [...(namesPulledBy.get(t) ?? [])].some((n) => exported.has(n)),
  );
  return {
    direct,
    byName,
    transitive: all.length - direct.length - byName.length,
  };
};

// Стиль в графе импортов не участвует: его подключают побочным импортом
// `import "./x.scss";` без `from`, а тесты читают его ТЕКСТОМ. Спрашивать про
// него у `importedBy` значит получить ноль и прочитать это как «никому не
// нужен». Оба режима, `brief` и `plan`, обязаны отвечать про стиль одинаково —
// отсюда общий разбор.
const styleUsers = (target) => {
  const base = rel(target).slice(rel(target).lastIndexOf("/") + 1);
  const needle = "/" + base;
  const modules = files.filter(
    (f) => !isTest(f) && readFileSync(f, "utf8").includes(needle),
  );
  const tests = files.filter(
    (f) => isTest(f) && readFileSync(f, "utf8").includes(base),
  );
  return { modules, tests };
};

// Номер строки с адреса снимается ЗДЕСЬ, а не у каждого читателя. Якорь
// `путь:120-130` — самая точная форма ссылки в базе, и именно она проваливалась
// мимо строгого сравнения: `plan` печатает только точные попадания, а записи
// каталогов ограничений и решений адресуют файл исключительно якорем — то есть
// правку хука планировали, не видя ни одной его пометки. Два сканера одного и
// того же с разными правилами однажды расходятся; здесь они сведены в один.
// Хвост снимается только с адреса, у которого есть расширение, — по тому же
// признаку, по которому якорь разбирает `verify`. Относительный якорь, у
// которого перед двоеточием пусто, остаётся как есть: без имени файла он и не
// адрес. Образец такой формы здесь намеренно не приведён — сверка новых якорей
// прочла бы его как настоящий, и ровно это и случилось при первой записи.
const LINE_SUFFIX = /(\.(?:tsx?|scss|md|json|html)):\d+(?:-\d+)?$/;

const quotedIn = (line) =>
  line
    .split(BACKTICK)
    .filter((_, i) => i % 2 === 1)
    .flatMap((t) =>
      t.split(",").map((x) => x.trim().replace(LINE_SUFFIX, "$1")),
    );

// Записи базы про адрес: точные (назван путём) и нестрогие (упомянут по имени).
const baseHitsFor = (target) => {
  const r = rel(target);
  const base = r.slice(r.lastIndexOf("/") + 1);
  const bare = base.replace(/\.(tsx?|scss)$/, "");
  const dir = r.slice(0, r.lastIndexOf("/"));
  // Голое имя засчитывается, только если оно в проекте одно: `index.ts` носят
  // сорок один файл, `types.ts` — двадцать.
  const uniqueBase =
    [...files, ...styleFiles].filter((f) => rel(f).endsWith("/" + base))
      .length === 1;
  // …но если та же строка называет соседа по папке, речь именно об этой бочке:
  // контекст строки снимает неоднозначность имени.
  const namesSibling = (line) =>
    quotedIn(line).some(
      (t) =>
        t.includes("/") &&
        /[.](tsx?|scss)$/.test(t) &&
        dir.endsWith(t.slice(0, t.lastIndexOf("/"))),
    );
  const exact = dossierLines().base.filter(([, , line]) =>
    quotedIn(line).some(
      (t) =>
        t === r ||
        (t.includes("/") && r.endsWith("/" + t)) ||
        (t === base && (uniqueBase || namesSibling(line))),
    ),
  );
  // Строка, которая в кавычках называет ДРУГОЙ существующий файл, — про него, а
  // не про этот: иначе короткое имя собирает весь модуль и топит попадания.
  const namesOther = (line) =>
    quotedIn(line).some(
      (t) =>
        /[.](tsx?|scss)$/.test(t) &&
        t !== base &&
        !r.endsWith("/" + t) &&
        files.some((f) => rel(f) === t || rel(f).endsWith("/" + t)),
    );
  const loose = dossierLines().base.filter(
    ([, , line]) =>
      line.includes(bare) &&
      !exact.some((e) => e[2] === line) &&
      !namesOther(line),
  );
  return { exact, loose };
};

// Один шаг по импортам — это соседи, а не радиус. Разница видна на нижнем
// слое: у `domain/layout.ts` прямых импортёров двое, но один из них бочка
// папки, и через неё правка расходится по всему клиенту. Печатать «2» и
// называть это радиусом значит показывать дешёвую правку там, где она
// дорогая, — а правило проекта берёт масштаб именно отсюда. Спрашивают двое:
// `blast` и `plan`.
const transitiveUsers = (start) => {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    for (const u of importedBy.get(queue.pop()) ?? []) {
      if (isTest(u) || seen.has(u)) continue;
      seen.add(u);
      queue.push(u);
    }
  }
  return seen;
};

// Словарь проверяет сам себя прежде, чем инструмент ответит хоть на один
// вопрос. «Запустить тесты после правки» иначе держится памятью: набор
// гоняют, когда о нём вспомнили, а инструмент зовут постоянно — и сломанный
// словарь виден в тот же миг. Таблица случаев одна на оба слоя, поэтому
// разойтись им нечем.
/** Режимы инструмента — выводятся из его собственного исходника, один раз на
 * обоих потребителей: отказ на неизвестном режиме и сверка «Режимы описаны».
 * Двумя копиями это и стояло, пока отказ не завели вторым; копия — второй
 * источник истины, расходится он первым.
 *
 * Комментарии вырезаются словарём области: `mode === "…"`, написанное
 * комментарием, — проза о коде, а не ветка. Проверено подсадкой: без
 * вырезания призрак из комментария принимался за настоящий режим (молча,
 * с кодом `0`) и одновременно требовал себе раздела в справочнике, то есть
 * ошибался в обе стороны сразу.
 *
 * Считается один раз за процесс. `verify` спрашивает список дважды — сперва
 * отказом на входе, потом своей сверкой, — а исходник за время работы не
 * меняется, значит второй разбор возвращает ровно то же. Замерено: `286.8 кБ`
 * и `3.34 мс` на разбор; счёт проходов по исходнику 2 → 1. Считать дважды одно
 * и то же — та же лишняя работа, что лишний проход рендера, и мерится она
 * счётом, а не секундомером.
 *
 * Наружу уходит замороженным. Считанный один раз, список стал общим для обоих
 * потребителей, и любой `sort()` у одного менял бы ответ другому — молча и не
 * в том вызове, где написан. Пока не мутирует никто; держалось это тем, что
 * никто не написал, а теперь — тем, что написать нельзя. */
let modesCache = null;
const toolModes = () => {
  if (modesCache !== null) return modesCache;
  const own = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const found = [];
  for (const line of own.split(/\r?\n/))
    for (const hit of line.matchAll(/mode === "([a-z]+)"/g))
      if (!inComment(line, hit.index)) found.push(hit[1]);
  modesCache = Object.freeze([...new Set(found)]);
  return modesCache;
};
const predicateFailures = selfCheck();
if (predicateFailures.length > 0) {
  console.log("=== Словарь области сломан — инструмент не отвечает ===");
  for (const line of predicateFailures) console.log("    " + line);
  console.log(
    "  Правьте `graph.predicates.mjs` или его таблицу случаев: пока они",
    "не сходятся, ответы всех режимов недостоверны.",
  );
  process.exit(1);
}

const mode = process.argv[2];

// Неизвестный или пропущенный режим — отказ, а не молчание.
//
// До этого инструмент на `graph.mjs verfiy` печатал пусто и отдавал `0`. В
// цепочке проверок последним звеном стоит `node .claude/work/tools/graph.mjs verify`:
// опечатка там — или режим, переименованный в инструменте и не переименованный
// в манифесте — делали бы прогон зелёным, не проверив ничего. Сверка звеньев
// цепочки этого не видит: она смотрит имена npm-скриптов, а не режимы.
//
// Список режимов читается из собственного исходника — оттуда же, откуда его
// берёт сверка «Режимы инструмента описаны». Один источник: объявленный
// отдельно, он разошёлся бы с реализацией первым.
{
  const known = toolModes();
  if (mode === undefined || !known.includes(mode)) {
    console.log(
      mode === undefined
        ? "=== Режим не назван ==="
        : `=== Режим \`${mode}\` инструменту неизвестен ===`,
    );
    console.log("  есть: " + [...known].sort().join(", "));
    console.log(
      "  Молчать здесь нельзя: последним звеном цепочки проверок стоит вызов",
      "этого инструмента, и опечатка в имени режима сделала бы прогон зелёным",
      "при том, что не проверено ничего.",
    );
    process.exit(1);
  }
}

/** Путь-аргумент принимается в обеих ходовых формах: как его печатает база
 * (`components/…`) и как его печатает всё остальное — git, редактор, отчёт
 * (`src/components/…`). Вторая форма раньше отвечала «Ничего не нашлось», то
 * есть говорила «файла нет» про существующий файл; при этом соседний режим
 * (`mutated`) её принимал. Найдено пробой, и это тот же класс, что записан в
 * базе отдельно: отсутствие и «я не понял адрес» звучали одинаково. */
const SRC_PREFIX = path.basename(CONFIG.src) + "/";
const argPath = (a) => {
  if (a === undefined) return a;
  const s = a.split("\\").join("/").replace(/^\.\//, "");
  return s.startsWith(SRC_PREFIX) ? s.slice(SRC_PREFIX.length) : s;
};

/** «Ничего не нашлось» про файл, который на диске ЕСТЬ, — это ответ не на тот
 * вопрос: читатель идёт искать опечатку в живом адресе. Разбор смотрит код и
 * стили внутри исходников, а обвязка — правила, полка, инструмент — лежит вне
 * его области, и сказать об этом надо прямо. Найдено пробой: досье на файл
 * полки правил отвечало ровно тем же, чем на выдуманный путь. */
const outOfScope = (arg) => {
  const tick = String.fromCharCode(96);
  const here = [path.join(BASE, "..", arg), path.join(ROOT, argPath(arg))];
  return here.some((one) => existsSync(one))
    ? `${tick}${arg}${tick} — файл есть, но он вне области разбора:` +
        ` инструмент смотрит код и стили внутри исходников, а своды правил,` +
        ` полка и он сам туда не входят.`
    : `Ничего не нашлось по ${tick}${arg}${tick}.`;
};

/** Явно названный путь, которого на диске нет, — это «я не понял адрес», а не
 * «показывать нечего». Три режима принимают списки путей, и все три отвечали на
 * выдуманный путь ровно тем же, чем на пустую правку: «тронуто 0». Найдено
 * пробой; тот же класс уже был закрыт у `brief` для другой формы аргумента, и
 * здесь он лечится одним помощником, а не тремя. Принимаются обе ходовые формы
 * адреса — от корня репозитория и от корня исходников. */
const unknownGiven = (given) => given.filter((one) => canonical(one) === null);

/** Один язык адресов на все режимы. Досье понимало сокращения базы
 * (`client/…`, `engines/…`), а три режима со списками путей — нет, и вели себя
 * при этом по-разному: `tested` отвечал «таких путей на диске нет» на живой
 * файл, а `twins` — хуже: «правка форков не касается» на файле, у которого
 * близнец есть. Второе не молчание, а содержательно неверный ответ уверенным
 * тоном. Найдено пробой; лечится одним помощником, а не тремя правками.
 *
 * Проектных префиксов здесь нет намеренно — они сделали бы инструмент
 * непереносимым. Адрес разрешается по единственному совпадению хвоста: путь,
 * который на диске один, и есть искомый; неоднозначный не разрешается вовсе,
 * и это правильный ответ, а не отказ. */
const canonical = (one) => {
  const s = one.split("\\").join("/").replace(/^\.\//, "");
  if (existsSync(path.join(BASE, "..", s))) return s;
  // Форма ответа — от корня репозитория: именно её отдаёт git, и именно с ней
  // режимы сравнивают. `rel()` здесь не годится, он срезает корень исходников.
  const fromRepo = (f) =>
    path.relative(path.join(BASE, ".."), f).split(path.sep).join("/");
  const tail = "/" + s;
  const hits = [...files, ...styleFiles]
    .map(fromRepo)
    .filter((r) => r === s || r.endsWith(tail));
  return hits.length === 1 ? hits[0] : null;
};

/** Список аргументов, приведённый к каноническому виду. Неразрешённое остаётся
 * как есть: о нём уже сказал `reportUnknown`, и подменять его молча нельзя. */
const canonicalList = (given) => given.map((one) => canonical(one) ?? one);

const reportUnknown = (given) => {
  const unknown = unknownGiven(given);
  if (unknown.length === 0) return false;
  console.log("  таких путей на диске нет — проверь адрес:");
  for (const one of unknown) console.log("    " + one);
  process.exitCode = 1;
  return true;
};

if (mode === "dead") {
  console.log(
    "=== Экспорты, которые нигде не импортируют (тесты включены) ===\n",
  );
  const rows = [];
  for (const f of files) {
    if (isTest(f)) continue;
    const pulled = importedNames.get(f) ?? new Set();
    if (pulled.has("*")) continue; // утащено через export * — разобрать нельзя
    const dead = [...exportsOf.get(f)].filter((n) => !pulled.has(n));
    if (dead.length) rows.push([rel(f), dead]);
  }
  for (const [f, dead] of rows.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${f}\n    ${dead.join(", ")}`);
  }
  console.log(
    `\nФайлов хотя бы с одним неимпортируемым экспортом: ${rows.length}.`,
  );
}

if (mode === "blast") {
  // С аргументом — радиус одного адреса: кто именно от него зависит. Без
  // аргумента — весь список по убыванию. Раньше аргумент молча игнорировался,
  // и документированная команда `blast <путь>` печатала общий список: ответ на
  // не тот вопрос, поданный как ответ на заданный.
  const arg = argPath(process.argv[3]);
  const rows = [];
  for (const f of files) {
    if (isTest(f)) continue;
    if (arg && !rel(f).includes(arg)) continue;
    const users = [...(importedBy.get(f) ?? [])].filter((u) => !isTest(u));
    rows.push([rel(f), users.length, users.map(rel).sort(), f]);
  }
  const isBarrel = (f) => /[\\/]index\.tsx?$/.test(f);
  rows.sort((a, b) => b[1] - a[1]);
  if (arg && rows.length === 0) {
    console.log(`Ничего не нашлось по ${arg}.`);
    process.exitCode = 1;
  } else if (arg) {
    console.log(`=== Радиус поражения: ${arg} ===\n`);
    for (const [f, n, users, abs] of rows) {
      const all = transitiveUsers(abs);
      const bridges = [...(importedBy.get(abs) ?? [])]
        .filter((u) => !isTest(u) && isBarrel(u))
        .map(rel)
        .sort();
      console.log(`${String(n).padStart(3)}  ${f}  (прямых)`);
      if (n > 0) console.log(`      ${users.join("\n      ")}`);
      console.log(`      всего транзитивно: ${all.size}`);
      if (bridges.length > 0)
        console.log(`      наружу ведёт бочка: ${bridges.join(", ")}`);
    }
  } else {
    console.log("=== Радиус поражения: не-тестовых импортёров на файл ===\n");
    for (const [f, n, users] of rows.slice(0, 30)) {
      console.log(`${String(n).padStart(3)}  ${f}`);
      if (n <= 6) console.log(`      ${users.join("\n      ")}`);
    }
    console.log("\n--- файлы, которые не импортирует никто (кроме тестов) ---");
    for (const [f, n] of rows) if (n === 0) console.log(`     ${f}`);
  }
}

if (mode === "plan") {
  // `brief` отвечает «что это такое», `blast` — «кто зависит», `tested` — «что
  // с тестами в уже сделанной правке». Перед правкой спрашивают другое, и
  // спрашивают первым: **что придётся тронуть**. Собрать этот ответ можно и
  // четырьмя вызовами, но каждый стоит контекста, а склеивать их приходится
  // руками и по памяти — то есть ровно там, где память и подводит.
  const arg = argPath(process.argv[3]);
  const matched = arg
    ? [...files, ...styleFiles].filter((f) => rel(f).includes(arg))
    : [];
  const hits = matched.filter((f) => !isTest(f));
  if (!arg) {
    console.log(
      "Укажи путь: node .claude/work/tools/graph.mjs plan <путь или его хвост>",
    );
    process.exitCode = 1;
  } else if (hits.length === 0 && matched.length > 0) {
    // «Ничего не нашлось» про существующий файл отправляет читателя искать
    // опечатку в пути, которой нет. У теста вопрос «что придётся тронуть»
    // стоит наоборот: тронут будет он сам, а его радиус — то, что он гоняет.
    console.log(
      `${BACKTICK}${arg}${BACKTICK} — это тест, у него «что придётся тронуть» не спрашивают:` +
        ` что он гоняет и что закрепляет — ${BACKTICK}graph.mjs brief${BACKTICK}.`,
    );
    process.exitCode = 1;
  } else if (hits.length === 0 && docFiles.some((d) => rel(d).includes(arg))) {
    // Документ — не узел: радиуса у него нет, и «ничего не нашлось» отправило бы
    // читателя искать опечатку в живом адресе. Найдено пробой; ответ тот же по
    // форме, что и для теста, — сказать, чем спрашивать про документ правильно.
    console.log(
      `${BACKTICK}${arg}${BACKTICK} — это документ, у него радиуса нет.` +
        ` Спрашивать надо про узел, который на него ссылается:` +
        ` ${BACKTICK}graph.mjs brief <путь узла>${BACKTICK} печатает документы` +
        ` в обе стороны — и те, что файл объявляет сам, и те, где он назван.`,
    );
    process.exitCode = 1;
  } else if (hits.length === 0) {
    console.log(outOfScope(arg));
    process.exitCode = 1;
  } else {
    for (const target of hits.slice(0, 6)) {
      const r = rel(target);
      console.log(`${LF}=== что придётся тронуть: ${r} ===`);

      // У стиля радиус считается по тексту, а не по графу: см. `styleUsers`.
      // Печатать ему «прямых 0» значило бы сказать «никому не нужен» про файл,
      // который подключён побочным импортом.
      const isStyle = r.endsWith(".scss");
      const direct = (
        isStyle
          ? styleUsers(target).modules
          : [...(importedBy.get(target) ?? [])].filter((u) => !isTest(u))
      )
        .map(rel)
        .sort();
      const all = isStyle ? null : transitiveUsers(target);
      console.log(
        isStyle
          ? `--- подключают (по тексту, стиль не в графе): ${direct.length} ---`
          : `--- радиус: прямых ${direct.length}, транзитивно ${all.size} ---`,
      );
      for (const d of direct) console.log("  " + d);

      // Близнец: расхождение копий законно, а вот баг, починенный в одной, —
      // нет. Поэтому пара называется ДО правки, а не после неё.
      const live = twinsOf(r);
      console.log("--- парная копия ---");
      console.log(
        live.length
          ? "  " + live.join(LF + "  ") + LF + "  правится в той же правке"
          : "  пары нет",
      );

      const {
        direct: td,
        byName,
        transitive,
      } = isStyle
        ? { direct: styleUsers(target).tests, byName: [], transitive: 0 }
        : testsFor(target);
      console.log("--- тесты, которые обязаны покраснеть на сломе ---");
      const runners = [...td, ...byName].map(rel).sort();
      console.log(
        runners.length
          ? "  " + runners.join(LF + "  ")
          : transitive === 0
            ? "  НЕТ НИ ОДНОГО — правку проверять руками, и это пункт отчёта"
            : "  напрямую никто; проверь тех, кто дотягивается транзитивно",
      );

      const { exact } = baseHitsFor(target);
      console.log("--- записи базы, которые придётся обновить ---");
      console.log(
        exact.length
          ? exact
              .map(
                ([name, n, line]) =>
                  `  ${name}:${n}  ${line.trim().slice(0, 96)}`,
              )
              .join(LF)
          : "  ни одной — значит и описывать правку негде: это само по себе находка",
      );

      // Один и тот же документ файл нередко называет дважды — в шапке и в теле;
      // печатать его дважды значит подсказывать, что это два разных адреса.
      const anchors = [...new Set(docRefsIn(readFileSync(target, "utf8")))];
      console.log("--- документация, объявленная самим файлом ---");
      console.log(
        anchors.length ? "  " + anchors.join(LF + "  ") : "  якоря нет",
      );
    }
    console.log(
      `${LF}Долг по мутациям спрашивают отдельно: он про всю правку, а не про один файл — ${BACKTICK}graph.mjs mutated${BACKTICK}.`,
    );
  }
}

if (mode === "cycles") {
  const color = new Map();
  const stack = [];
  const found = [];
  const visit = (f) => {
    color.set(f, 1);
    stack.push(f);
    for (const d of importsOf.get(f) ?? []) {
      if (color.get(d) === 1) found.push([...stack.slice(stack.indexOf(d)), d]);
      else if (!color.has(d)) visit(d);
    }
    stack.pop();
    color.set(f, 2);
  };
  for (const f of files) if (!color.has(f)) visit(f);
  console.log("=== Циклические импорты ===\n");
  const seen = new Set();
  for (const c of found) {
    const key = [...c].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(c.map(rel).join("\n  -> "));
    console.log("");
  }
  console.log(`Различных циклов: ${seen.size}.`);
}

// --- open: что в проекте открыто --------------------------------------------
// Три сводки, каждая считается заново. Написанные рукой, они бы устарели первыми
// — а нужны они именно тому, кто садится за рефактор с чистого листа.
if (mode === "open") {
  const NEWLINE = String.fromCharCode(10);
  const TICK = String.fromCharCode(96);

  const scan = (title, test) => {
    console.log(`=== ${title} ===`);
    let count = 0;
    // README базы описывает ФОРМЫ записи, а не находки. Сканер, читающий
    // собственную инструкцию, каждый прогон показывает фантом — и приучает не
    // читать секцию.
    const base = readdirSync(BASE).filter(
      (n) => n.endsWith(".md") && n !== "README.md",
    );
    for (const name of base) {
      const lines = readFileSync(path.join(BASE, name), "utf8").split(NEWLINE);
      lines.forEach((line, i) => {
        if (!test(line)) return;
        count++;
        console.log(`  ${name}:${i + 1}  ${line.trim().slice(0, 96)}`);
      });
    }
    console.log(`  всего: ${count}`);
  };

  // Гипотезы базы: помечаются `?` в начале пункта (README, «Формат записи»).
  scan("Гипотезы — проверить, прежде чем на них опираться", (line) =>
    new RegExp("^[ ]*[-*][ ]+" + TICK + "[?]" + TICK).test(line),
  );
  // Записанные дыры в тестовой сети.
  // На обоих языках, по той же причине, что и остальные сканеры маркеров.
  scan("Записано «не закреплено»", (line) =>
    /не закреплен|Чего в слое не|Чего не закреплено|not covered|no test for/i.test(
      line,
    ),
  );
  // Ограничение, у которого в графе «держится» стоит «ничем», — записанная дыра
  // сильнее любой другой: соглашение, живущее только в голове. Формулировка
  // взята из самого формата каталога, поэтому соврать сканеру нечем. Найдено
  // пробой: такая запись есть, и в сводку открытого она не попадала — фраза не
  // совпала ни с одним из прежних образцов.
  // `вниманием` и `памятью` добавлены к `ничем` намеренно: по надёжности это
  // одно и то же. Обещание, которое держится тем, что кто-то помнит, не
  // проявляется, пока помнят, и проявляется ровно тогда, когда забыли, — то
  // есть в худший момент. Раздел «Обещания обвязки, которые не держит машина»
  // заведён под эту форму: до него такие места были названы прозой в разных
  // файлах и в сводку открытого не попадали ни одно.
  scan("Держится ничем или вниманием — обещание без опоры", (line) =>
    HELD_BY_NOTHING.test(line),
  );

  // Файлы, до которых не дотягивается ни один тест — даже транзитивно. Это не
  // «нет своего теста»: `useTrackBinding` покрыт `trackBinding.test.tsx`, имена
  // не совпадают, и считать по именам было бы враньём.
  const reached = new Set();
  const stack = files.filter(isTest);
  while (stack.length > 0) {
    const f = stack.pop();
    for (const d of importsOf.get(f) ?? []) {
      if (reached.has(d)) continue;
      reached.add(d);
      stack.push(d);
    }
  }
  // Документация про файл есть, а сам файл на неё не ссылается: «почему»
  // существует, но при чтении кода его не видно. Это список работ, а не
  // приговор — поэтому здесь, а не в `verify`: совпадение по имени бывает
  // случайным, и превращать его в красный прогон значило бы завести
  // проверку, которая врёт.
  const surface = (f) => /\/index\.tsx?$/.test(f) || /types\.tsx?$/.test(f);
  // Отбор обвязки сделан один раз, при сборе `docFiles` (см. `isMachinery`),
  // поэтому здесь фильтра больше нет.
  const docBodies = docFiles.map((d) => [rel(d), readFileSync(d, "utf8")]);
  const unanchored = [];
  // Имя файла без папки — ещё не адрес. `defaults.ts` лежит в трёх местах, и
  // документация карусели про `config/defaults.ts` засчитывалась полке
  // `engines/kinetic/internal/defaults.ts`: пункт, который нельзя закрыть, —
  // якорь из полки на документы компонента как раз и есть та связь, которой в
  // полке быть не должно. Поэтому для неуникальных имён требуем два последних
  // сегмента пути; для уникальных прежнего имени достаточно.
  const baseCount = new Map();
  for (const f of files) {
    if (isTest(f) || surface(f)) continue;
    const b = f.slice(f.lastIndexOf("/") + 1);
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }
  for (const f of files) {
    if (isTest(f) || surface(f)) continue;
    if (docRefsIn(readFileSync(f, "utf8")).length) continue;
    const base = f.slice(f.lastIndexOf("/") + 1);
    // Документация называет файл и с расширением, и без него — README полок
    // Имя без расширения засчитывается, только если документация называет его
    // КАК КОД, в обратных кавычках: голое слово вроде resolve встречается в
    // прозе трёх десятков документов и топит сигнал.
    const bare = base.replace(/[.](tsx?|scss)$/, "");
    const asCode = "`" + bare + "`";
    const withParent = rel(f).split("/").slice(-2).join("/");
    const named = docBodies.filter(([, body]) =>
      (baseCount.get(base) ?? 0) > 1
        ? body.includes(withParent)
        : body.includes(base) || body.includes(asCode),
    );
    if (named.length) unanchored.push([rel(f), named.map(([d]) => d)]);
  }
  console.log("=== Документация есть, якоря `// See` в коде нет ===");
  for (const [f, docs] of unanchored)
    console.log(`  ${f}${NEWLINE}      → ${docs.join(", ")}`);
  console.log(`  всего: ${unanchored.length}`);

  const code = files.filter((f) => !isTest(f) && !f.endsWith(".d.ts"));
  const cold = code.filter((f) => !reached.has(f));
  console.log("=== Файлы, до которых не дотягивается ни один тест ===");
  for (const f of cold) console.log("  " + rel(f));
  console.log(`  всего: ${cold.length} из ${code.length}`);
}

// --- verify: сверка базы с кодом ---------------------------------------------
// Все проверки механические, и перечень их — не здесь: он живёт таблицей в
// `01-facts.md` и её двойником на полке, и пересказ здесь ровно это и сделал —
// разошёлся, оставшись на числе «восемь» при вдвое большем наборе. Ненулевой
// код возврата означает, что база отстала от кода.
// Правка в одной копии из пары — единственный настоящий риск форков, и он
// виден только в диффе, а не в дереве: файлы законно расходятся там, где
/** Пути, тронутые текущей правкой: изменённые И новые, ещё не добавленные.
 * `git diff` вторых не видит, а новый тест — обычный способ закрыть правку. */
const changedPaths = async (repoRoot) => {
  try {
    const { execSync } = await import("node:child_process");
    // `-uall`: без него новая ПАПКА печатается одной строкой, и файлы
    // внутри неё в правку не попадают — ровно новый тест целиком.
    return (
      execSync("git status --porcelain -uall", {
        cwd: repoRoot,
        encoding: "utf8",
        // stderr гасим: про недоступность git режим говорит сам.
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split(String.fromCharCode(10))
        .map((l) => l.slice(3).trim())
        .filter(Boolean)
        // Переименование печатается как "было -> стало": берут второе.
        .map((l) => (l.includes(" -> ") ? l.slice(l.indexOf(" -> ") + 4) : l))
        .map((l) => l.replace(/^"|"$/g, ""))
    );
  } catch {
    return null;
  }
};

// одиночной библиотеке и фасаду нужно по-разному. Поэтому не сверка
// содержимого, а вопрос в нужный момент: тронул одну копию — вот её близнец.
if (mode === "twins") {
  const NEWLINE = String.fromCharCode(10);
  let changed = process.argv.slice(3);
  if (changed.length) {
    reportUnknown(changed);
    changed = canonicalList(changed);
  }
  if (changed.length === 0) {
    changed = await changedPaths(path.join(BASE, ".."));
    if (changed === null) {
      console.log(
        "git недоступен — передай пути аргументами: graph.mjs twins <путь> …",
      );
      process.exitCode = 1;
    }
  }
  if (changed !== null) {
    const srcPrefix = norm(path.relative(path.join(BASE, ".."), ROOT)) + "/";
    const touched = new Set(
      changed
        .map(norm)
        .filter((f) => f.startsWith(srcPrefix))
        .map((f) => f.slice(srcPrefix.length)),
    );
    const lonely = [];
    let inPairs = 0;
    for (const f of touched) {
      for (const pair of CONFIG.forks) {
        const a = pair.from + "/";
        const b = pair.to + "/";
        const twin = f.startsWith(a)
          ? b + f.slice(a.length)
          : f.startsWith(b)
            ? a + f.slice(b.length)
            : null;
        if (twin === null) continue;
        // Близнец засчитывается, только если он есть на диске. Полки парные не
        // файл в файл: у библиотеки бывает своё (`useShortLandscape`), у сборки
        // своё (`canonicalMedia`), и без этой проверки режим требовал бы править
        // файл, которого не существует, — то есть врал бы. Сверка, способная
        // соврать, хуже отсутствующей: ей верят.
        if (!existsSync(path.join(ROOT, twin))) continue;
        inPairs++;
        if (!touched.has(twin)) lonely.push([f, twin]);
      }
    }
    console.log("=== Правки внутри парных форков ===");
    console.log(
      `  тронуто файлов в парах: ${inPairs}, без пары в этой же правке: ${lonely.length}`,
    );
    for (const [f, twin] of lonely)
      console.log(`    ${f}${NEWLINE}      → близнец не тронут: ${twin}`);
    if (lonely.length === 0 && inPairs > 0)
      console.log("  обе копии каждой пары в правке — ок");
    if (inPairs === 0) console.log("  правка форков не касается");
    console.log(
      NEWLINE +
        "  Расхождение само по себе не дефект: одиночной библиотеке и фасаду" +
        NEWLINE +
        "  местами нужно по-разному. Дефект — БАГ, починенный в одной копии.",
    );

    // Полка правил — такая же пара, только текстом. Сверять её содержимое
    // нельзя: полка пишет обобщённо, без имён файлов проекта. Поэтому тот же
    // вопрос в тот же момент — правило тронули здесь, а увозят его отсюда.
    const all = new Set(changed.map(norm));
    const shelf = norm(path.relative(path.join(BASE, ".."), SHELF_RULES));
    const rulesTouched = [...all].filter(
      (f) => /(^|\/)CLAUDE\.md$/.test(f) || f.startsWith(".context/"),
    );
    const shelfTouched = [...all].some((f) => f.startsWith(shelf));
    console.log(NEWLINE + "=== Правка правил против полки правил ===");
    if (rulesTouched.length === 0) console.log("  правила не тронуты");
    else if (shelfTouched) console.log("  полка правил в этой же правке — ок");
    else {
      console.log(
        `  тронуто в правилах проекта: ${rulesTouched.length}, полка не тронута:`,
      );
      for (const f of rulesTouched) console.log("    " + f);
      console.log(
        NEWLINE +
          "  Не всякая правка сюда относится: «текущий проект», числа базовой" +
          NEWLINE +
          "  линии, записи про этот код — местные. Метод, правило и инструмент —" +
          NEWLINE +
          `  общие, и уезжают в следующий проект из ${shelf}.`,
      );
    }
  }
}

// Код и его тесты — одна правка, а не две. Сверять содержимое бессмысленно:
// не всякая правка кода обязана менять тест (переименованный комментарий, снятая
// мёртвая ветка). Поэтому здесь не приговор, а вопрос в нужный момент: вот
// файлы, которые ты тронул, вот тесты, которые их гоняют, и вот те из них, что
// в эту правку не попали. Решение — за тобой; молча пройти мимо — нет.
if (mode === "tested") {
  const NEWLINE = String.fromCharCode(10);
  let changed = process.argv.slice(3);
  if (changed.length) {
    reportUnknown(changed);
    changed = canonicalList(changed);
  }
  if (changed.length === 0) {
    changed = await changedPaths(path.join(BASE, ".."));
    if (changed === null) {
      console.log(
        "git недоступен — передай пути аргументами: graph.mjs tested <путь> …",
      );
      process.exitCode = 1;
    }
  }
  if (changed !== null) {
    const repoRoot = path.join(BASE, "..");
    const abs = (f) => norm(path.join(repoRoot, f));
    const touched = new Set(changed.map(abs));
    const touchedCode = [...touched].filter(
      (f) => files.includes(f) && !isTest(f) && !f.endsWith(".d.ts"),
    );

    const naked = [];
    const stale = [];
    let covered = 0;
    for (const f of touchedCode) {
      const tests = files.filter(
        (t) => isTest(t) && (importsOf.get(t) ?? new Set()).has(f),
      );
      if (tests.length === 0) {
        naked.push(rel(f));
        continue;
      }
      if (tests.some((t) => touched.has(t))) covered++;
      else stale.push([rel(f), tests.map(rel).sort()]);
    }

    // Удалённый файл в граф не попадает: его больше нет на диске. А записи о
    // нём остались — и это худший случай, потому что запись про то, чего нет,
    // выглядит достоверной. Рецепт удаления узла отсылает сюда, значит здесь
    // и должно быть сказано, что именно осталось висеть.
    const deletedCode = changed
      .map(abs)
      .filter((f) => /\.(tsx?|scss)$/.test(f) && !isTest(f) && !existsSync(f));

    // Стиль в граф импортов не входит — его подключает сборщик, — поэтому в
    // `touchedCode` он не попадает, и раньше правка стилей получала ответ
    // «правка кода не касается». Между тем держат стили как раз тесты, читающие
    // их ТЕКСТОМ: соответствие переменных, слои, фолбэки. Найдено пробой:
    // тронутый `Carousel.module.scss` не назвал ни одного из пяти своих тестов.
    const touchedStyles = [...touched].filter(
      (f) => styleFiles.includes(f) && existsSync(f),
    );

    console.log("=== Код и тесты в одной правке ===");
    console.log(
      `  тронуто файлов кода: ${touchedCode.length}, из них с тестами в этой же правке: ${covered}`,
    );
    if (
      touchedCode.length === 0 &&
      deletedCode.length === 0 &&
      touchedStyles.length === 0
    )
      console.log("  правка кода не касается");

    if (touchedStyles.length) {
      console.log(
        NEWLINE +
          "  Тронуты стили. Их держат тесты, читающие файл текстом —" +
          NEWLINE +
          "  открыть и ответить, держат ли они его и после правки:",
      );
      for (const s of touchedStyles) {
        const { tests } = styleUsers(s);
        const inEdit = tests.filter((t) => touched.has(t)).length;
        console.log(
          `    ${rel(s)} — читают ${tests.length}, из них в этой же правке ${inEdit}`,
        );
        for (const t of tests.map(rel).sort()) console.log(`      ${t}`);
        if (tests.length === 0)
          console.log("      ни одного — правку проверять глазом и смоуком");
      }
    }

    if (stale.length) {
      console.log(NEWLINE + "  Тесты есть, но в правку не попали:");
      for (const [f, tests] of stale)
        console.log(
          `    ${f}${NEWLINE}      ${tests.join(NEWLINE + "      ")}`,
        );
      console.log(
        NEWLINE +
          "  Открой каждый и ответь: он всё ещё проверяет то, что называет," +
          NEWLINE +
          "  и он всё ещё умеет падать на новом коде? Нашёл слабый — чинится" +
          NEWLINE +
          "  здесь же, а не записывается.",
      );
    }
    if (naked.length) {
      console.log(
        NEWLINE + "  ВНИМАНИЕ: тронуто, и ни один тест на это не смотрит:",
      );
      for (const f of naked) console.log("    " + f);
      console.log(
        NEWLINE +
          "  Новая ветка логики закрывается тестом в том же заходе. Если" +
          NEWLINE +
          "  закрывать нечем — причина называется вслух, а не умалчивается.",
      );
    }
    if (touchedCode.length && !stale.length && !naked.length)
      console.log("  каждый тронутый файл правился вместе со своими тестами");

    // Сверка с планкой — шаг закрытия, у которого машинного напоминания не
    // было вовсе: у тестов есть этот же режим, у базы `verify`,
    // у смоука — область, у мутаций — реестр. Планка держалась тем, что сессия
    // вспомнит про раздел правил. Печатается только когда тронут код или стили:
    // на правках прозы ей нечего сказать, а канал, кричащий не по делу,
    // перестают читать.
    if (touchedCode.length || touchedStyles.length) {
      console.log(NEWLINE + "=== Сверка с планкой качества ===");
      console.log(
        "  До прогона прочитать свой дифф по разделам планки поимённо, а не по",
      );
      console.log(
        "  памяти. Сами разделы — в политике: пересказывать их здесь значило бы",
      );
      console.log(
        "  завести второй источник, который соврёт при первом переименовании.",
      );
      // Указание «сверься с планкой» без адреса бесполезно: у политики есть
      // ядро и разделы по применимости, и какие из них живые — знает таблица, а
      // не память. Инструмент, о котором надо вспомнить самому, не используют,
      // поэтому живой набор печатается здесь же.
      {
        const scope = liveQualityScopes();
        console.log(
          scope.state === "нет деления"
            ? "  Читается ядро политики целиком; деления на применимые нет."
            : scope.state === "не прочитано"
              ? "  ВНИМАНИЕ: деление на применимые заявлено, а таблицу" +
                " применимости прочитать не удалось — какие разделы живые," +
                " сейчас неизвестно. Чинится до сверки, а не после."
              : "  Читается ядро целиком плюс живые разделы: " +
                scope.live.join(", ") +
                ". Объявление и причины — таблица применимости в базе.",
        );
        // Зависимость — самый частый способ втащить в проект новый предмет и
        // самый незаметный: признак по коду его не увидит, потому что вызовов
        // ещё нет, а библиотека уже стоит. Поэтому вопрос задаётся по факту
        // правки манифеста, а не ждёт, пока предикат догадается.
        if (changed.some((c) => /(^|\/)package\.json$/.test(norm(c))))
          console.log(
            "  Манифест тронут: приехала зависимость — проверь таблицу" +
              " применимости, не появился ли предмет спящего раздела.",
          );
      }
      console.log(
        "  Не сошлось — переделать, а не описать. В отчёте об этом отдельная строка.",
      );
    }

    // Два оставшихся вопроса закрытия работы стоят под СВОИМ условием, и это
    // починка класса, а не перестановка. Раньше все три сидели под «тронут код
    // или стили», хотя обоснование в комментарии выше написано только для
    // планки: ей на прозе действительно нечего сказать. Двум другим — есть, и
    // именно на прозе они нужнее всего. Работа, состоящая из анализа и
    // находок, кода не трогает вовсе — и не получала ни одного напоминания,
    // ровно тогда, когда находок больше всего. Найдено на живом случае: отчёт
    // по смысловому проходу вышел без исхода по каждой находке.
    if (changed.length > 0) {
      // Первый из двух: БД отвечает «что и где» следующей сессии, документация
      // — «почему» человеку, и закрываются они порознь. Базу ведут по ходу
      // правки, от этого пара кажется закрытой — а документация остаётся
      // описывать код, которого больше нет.
      console.log(NEWLINE + "=== БД и документация — порознь ===");
      console.log(
        "  БД: описывает ли она новое состояние кода — включая тесты и стили?",
      );
      console.log(
        "  Документация: изменилось ли «почему», а не только «что»? Прибавилась",
      );
      console.log(
        "  возможность, видная снаружи, — строка в витрине, словами продукта.",
      );
      console.log("  Правила того и другого — docs/CONVENTIONS.md.");
      console.log("  В отчёте это две строки, а не одна.");

      // Второй: единственная форма откладывания, которую машина не видит
      // вовсе, — молчание. Находку, которую не записали, не поймает ни одна
      // сверка, поэтому вопрос задаётся здесь, в момент закрытия работы, а не
      // остаётся разделом правил, куда надо заглянуть.
      // Третий вопрос закрытия, и до него у прозы не было ни одного. Свод
      // правил записи объявлял про себя, что держится «чтением диффа и
      // вопросом в момент закрытия работы», а такого вопроса не существовало
      // нигде: ни в правилах закрытия, ни здесь. То есть файл называл
      // механизм, которого нет, — ровно тот класс, который петля запрещает
      // отдельным правилом. Спрашивается по факту правки прозы: тронут хоть
      // один документ — вопрос печатается.
      if (changed.some((c) => /.md$/.test(norm(c)))) {
        console.log(NEWLINE + "=== Проза: форма записи ===");
        console.log(
          "  Тронут текст. Сверена ли его форма по каталогу приёмов из свода",
        );
        console.log(
          "  правил записи: оценка без величины, метафора вместо механизма,",
        );
        console.log(
          "  правило без критерия выполнения, оценка в позиции требования?",
        );
        console.log(
          "  Разработчик задаёт смысл разговорным языком — в свод он попадает",
        );
        console.log("  в проверяемой форме, и перевод делает записывающий.");
      }

      console.log(NEWLINE + "=== Попутные находки ===");
      console.log(
        "  Что попалось по дороге — в коде, в тестах, в базе, в правилах, в",
      );
      console.log(
        "  самом инструменте? Оно чинится этим же заходом и называется в",
      );
      console.log(
        "  отчёте отдельно от плановой работы. Чинится КЛАСС, а не пример:",
      );
      console.log(
        "  заплатка под конкретный случай оставляет дыру там же, только тише.",
      );
      // Исход спрашивается отдельной строкой, потому что пропадает он отдельно
      // от находки: назвать проблему легко, а вот сказать, что с ней стало, —
      // ровно то, что теряется в длинном отчёте. Оборот «теперь иначе» читается
      // как починка и ею не является.
      console.log(
        "  У КАЖДОЙ находки в отчёте стоит исход прямым утверждением: исправлено",
      );
      console.log(
        "  / не исправлено, потому что… / отложено — и только после ответа.",
      );
      console.log(
        "  Находка без исхода читается как нерешённая, чем бы она ни кончилась.",
      );
    }

    // Публичная поверхность полки: тронут файл, который уезжает в другой
    // проект копированием. Спрашивается не «правишь ли ты контракт» — на такой
    // вопрос отвечают «нет» и идут дальше, — а РОД правки: форма или ответ.
    // Смена формы (имя, сигнатура, состав экспортов) правилами уже накрыта и
    // видна в диффе; смена ОТВЕТА на краевом входе не видна ничем и читается
    // как правка реализации. Заведено после случая, где ровно так и вышло:
    // три узла отвечали на не-число по-разному, четвёртый привели к
    // большинству, а записанное решение говорило обратное и лежало там, куда
    // переносимой полке ссылаться нельзя. Список берётся из объявленных пар
    // форков — других способов узнать «это уедет к чужому потребителю» у
    // инструмента нет, и выдумывать их он не станет.
    const shelfRoots = (CONFIG.forks ?? []).flatMap((p) => [p.from, p.to]);
    // Путь правки приходит от корня репозитория, а пара форка объявлена от
    // корня исходников: сравнение идёт по вхождению сегмента, а не по префиксу.
    // Вопрос про контракт — значит про то, у чего он есть: у исполняемого
    // модуля. README и тест сюда не входят, и это решает словарь, а не
    // условие на месте. Найдено пробой: первая редакция считала правку README
    // публичной поверхностью.
    const shelfHits = changed.filter(
      (c) =>
        isCodePath(norm(c)) &&
        shelfRoots.some((p) => norm(c).includes("/" + p + "/")),
    );
    if (shelfHits.length > 0) {
      console.log(NEWLINE + "=== Публичная поверхность полки ===");
      console.log(
        "  тронуто файлов, уезжающих копированием: " + shelfHits.length,
      );
      console.log("  Вопрос один, и он про РОД правки, а не про её размер:");
      console.log(
        "  меняется ФОРМА (имя, сигнатура, состав экспортов) или ОТВЕТ",
      );
      console.log(
        "  узла на краевом входе — NaN, ноль, пустоту, выход за диапазон?",
      );
      console.log(
        "  Второе — тоже контракт (планка, D5), и согласуется так же.",
      );
      console.log(
        "  Довод «привёл к единообразию с соседним узлом» основанием",
      );
      console.log("  не является: род входа у соседа может быть другой.");
    }
    // Смоук в браузере закрывает то, чего юнит-сеть не видит В ПРИНЦИПЕ. Он
    // «по требованию», а требование предъявляет не память: сравнение идёт по
    // сырым путям правки, поэтому в область попадают и стили, которых нет в
    // графе импортов.
    // Область задана путями, и по пути в неё попадает всё, что рядом лежит.
    // Спрашивается же только с того, чья правка меняет наблюдаемое поведение:
    // README движка его не меняет, тест — тоже, он и сам проверка. Стиль
    // меняет, хоть его и не видно в графе импортов. Всё это решает словарь.
    //
    // Найдено двумя пробами подряд, и вторая — про первую: сперва фильтр
    // завели по расширению и остановились, а тест `.test.tsx` расширению
    // подходит. Это и стало доводом вынести решение в одно место.
    const smokeHits = changed.filter(
      (f) =>
        touchesRuntime(norm(f)) &&
        CONFIG.smokeScope.some((p) => norm(f).startsWith(p)),
    );
    console.log(String.fromCharCode(10) + "=== Смоук в браузере ===");
    if (smokeHits.length === 0)
      console.log("  правка область смоука не задела — прогон не нужен");
    else {
      console.log("  задета область, чью поломку видно только в браузере:");
      for (const f of smokeHits) console.log("    " + f);
      console.log(
        `  прогнать ${CONFIG.smokeCommand} и назвать результат в отчёте`,
      );
    }

    if (deletedCode.length > 0) {
      console.log(
        NEWLINE + "=== Удалённые файлы: что о них осталось в базе ===",
      );
      for (const f of deletedCode) {
        const { exact } = baseHitsFor(f);
        console.log("  " + rel(f));
        console.log(
          exact.length
            ? "    " + exact.map(([name, line]) => `${name}:${line}`).join(", ")
            : "    записей нет",
        );
      }
      console.log(
        NEWLINE +
          "  Эти строки описывают файл, которого больше нет, и читаются как" +
          NEWLINE +
          "  достоверные. Снимаются здесь же — вместе с якорями на него и с" +
          NEWLINE +
          "  описаниями связи у тех, кто его импортировал.",
      );
    }

    // «Не забыть ВО ВСЕХ МЕСТАХ» — это не призыв к внимательности, а список,
    // который можно напечатать. База описывает файл в нескольких своих файлах
    // сразу (карта, состояние, потоки, тайминг, инварианты), и держать их в
    // голове нельзя. Плюс рябь: новый или изменившийся узел меняет то, что
    // делают его ПОТРЕБИТЕЛИ, и их записи устаревают молча — именно так
    // однажды и вышло с утверждением про кэш, поправленным в трёх записях из
    // четырёх.
    // Кодом здесь считается ВСЁ, что база описывает: модули, стили и тесты.
    // Раньше секция строилась только по `.ts/.tsx` без тестов — и правка стиля
    // или теста проходила молча, хотя стиль назван в карте наравне с модулем, а
    // тест — поимённо в реестре. Найдено пробой; лечится составом списка, а не
    // приписками про частные случаи.
    const touchedDescribed = [...touched].filter(
      (f) =>
        existsSync(f) &&
        (files.includes(f) || styleFiles.includes(f)) &&
        !f.endsWith(".d.ts"),
    );
    if (touchedDescribed.length) {
      const at = (hits) =>
        hits.length
          ? hits.map(([name, line]) => `${name}:${line}`).join(", ")
          : null;
      console.log(NEWLINE + "=== Записи базы про тронутые файлы ===");
      for (const f of touchedDescribed) {
        const hits = baseHitsFor(f);
        const exact = at(hits.exact);
        // Реестр тестов и разделы карты называют файл голым именем под
        // заголовком, который задаёт префикс. Показывать только точные значило
        // бы объявить «записей нет» про описанный файл — так и было с тестом,
        // чья строка лежит в реестре.
        const byName = at(hits.loose);
        console.log("  " + rel(f));
        if (exact !== null) console.log("    " + exact);
        else if (byName !== null)
          console.log("    по имени (проверить, тот ли файл): " + byName);
        else
          console.log(
            "    записей нет — узел базе неизвестен, запись обязательна",
          );
      }

      const neighbours = new Set();
      for (const f of touchedDescribed)
        for (const u of importedBy.get(f) ?? [])
          if (!isTest(u) && !touchedDescribed.includes(u)) neighbours.add(u);
      if (neighbours.size > 0) {
        const shown = [...neighbours].slice(0, 8);
        console.log(
          NEWLINE +
            "  Соседи, чьё описание могло измениться (кто импортирует):",
        );
        for (const n of shown)
          console.log(
            `    ${rel(n)} → ${at(baseHitsFor(n).exact) ?? "записей нет"}`,
          );
        if (neighbours.size > shown.length)
          console.log(`    …и ещё ${neighbours.size - shown.length}`);
      }
      console.log(
        NEWLINE +
          "  Открыть каждую и ответить: описывает ли она ещё то, что файл делает" +
          NEWLINE +
          "  сейчас? Какой факт в какой файл базы — таблица в base.md:" +
          NEWLINE +
          "  состояние в 04, порядок в 06, сценарий в 05, связи в 03, идиома в 10.",
      );
    }

    // Документация отвечает на другой вопрос, чем база, и закрывается ОТДЕЛЬНО
    // от неё. Названные в правилах одной строкой, они сливаются в одно дело:
    // базу ведут по ходу правки, пара кажется закрытой, а `docs/**` остаются
    // описывать код, которого больше нет. Ровно так и вышло однажды. Поэтому
    // список печатается здесь — это второй вопрос того же момента, и задавать
    // его надо машиной, а не памятью.
    if (touchedCode.length) {
      const TICK = String.fromCharCode(96);
      const DOC_LINES = [];
      for (const d of docFiles) {
        const body = readFileSync(d, "utf8").split(NEWLINE);
        body.forEach((line, i) => DOC_LINES.push([rel(d), i + 1, line]));
      }
      const quoted = (line) =>
        line
          .split(TICK)
          .filter((_, i) => i % 2 === 1)
          .flatMap((t) => t.split(",").map((x) => x.trim()));

      const described = [];
      for (const f of touchedCode) {
        const r = rel(f);
        const base = r.slice(r.lastIndexOf("/") + 1);
        const bare = base.replace(/\.(tsx?|scss)$/, "");
        const named = [
          ...new Set(
            DOC_LINES.filter(([, , line]) =>
              quoted(line).some(
                (t) =>
                  t === r || r.endsWith("/" + t) || t === base || t === bare,
              ),
            ).map(([n, i]) => n + ":" + i),
          ),
        ];
        const own = [...new Set(docRefsIn(readFileSync(f, "utf8")))];
        if (named.length || own.length) described.push([r, own, named]);
      }

      console.log(NEWLINE + "=== Документация тронутых файлов ===");
      if (!described.length)
        console.log("  ни один тронутый файл не описан документацией");
      for (const [r, own, named] of described) {
        console.log("  " + r);
        if (own.length) console.log("    ссылается сам: " + own.join(", "));
        if (named.length)
          console.log("    назван в: " + named.slice(0, 8).join(", "));
      }
      if (described.length)
        console.log(
          NEWLINE +
            "  Открыть и ответить: описывает ли это ещё тот код, что сейчас в" +
            NEWLINE +
            "  файле? Приговора здесь нет — не всякая правка меняет «почему»." +
            NEWLINE +
            "  Но пройти мимо молча нельзя.",
        );
    }

    // Якорь съезжает ровно от одного — вставки или удаления строк ВЫШЕ него,
    // то есть от правки того самого файла. Значит сверять его надо не всегда,
    // а именно сейчас. Якорь с цитатой чинит себя сам (`verify`), без цитаты —
    // только глазами, и вот их список. Приговора нет намеренно: правка ниже
    // якоря его не двигает, и падать на этом значило бы врать через раз.
    const ANCHOR = /`([\w./{}-]*):(\d+)(?:-\d+)?`(\s*`[^`]+`)?/g;
    const bySuffix = (q) => {
      const hits = files.filter((f) => f === q || f.endsWith("/" + q));
      return hits.length === 1 ? hits[0] : null;
    };
    const atRisk = [];
    for (const name of readdirSync(BASE).filter((n) => n.endsWith(".md"))) {
      let current = null;
      for (const line of readFileSync(path.join(BASE, name), "utf8").split(
        NEWLINE,
      )) {
        // Заголовок раздела карты задаёт файл для относительных якорей.
        const head = /^#{2,}\s+`([^`]+)`/.exec(line);
        if (head) current = bySuffix(head[1].replace(/^.*?([\w./-]+)$/, "$1"));
        ANCHOR.lastIndex = 0;
        let m;
        while ((m = ANCHOR.exec(line)) !== null) {
          if (m[3]) continue; // цитата есть — `verify` держит его сам
          const file = m[1] === "" ? current : bySuffix(m[1]);
          if (file === null || !touched.has(file)) continue;
          atRisk.push(`${name}: ${m[0]} → ${rel(file)}`);
        }
      }
    }
    if (atRisk.length) {
      console.log(
        NEWLINE +
          "  Якоря без цитаты в файлы этой правки — сверить номера глазами:",
      );
      for (const a of atRisk) console.log("    " + a);
      console.log(
        NEWLINE +
          "  Строки выше якоря сдвинулись — номер съехал молча. Сверил —" +
          NEWLINE +
          "  допиши цитату, чтобы дальше он чинился сам.",
      );
    }
  }
}

// Объём файлов — по запросу. В базе этих чисел нет намеренно: строка меняется
// от любой правки, и записанный объём превращает каждый коммит в правку базы.
// Досье на файл или папку: всё, что известно про этот адрес, собранное из
// графа и из базы разом. Существует потому, что база организована ПО ТЕМАМ, а
// задача всегда приходит ПО АДРЕСУ: без этой сборки знание об одном файле
// приходится обходить по девяти файлам базы вручную.
if (mode === "mutated") {
  const NEWLINE = String.fromCharCode(10);
  const repoRoot = path.join(BASE, "..");
  const ledgerPath = path.join(BASE, CONFIG.mutationLedger);

  // Содержимое, а не время: реестр переживает клон, где mtime у всех файлов
  // одинаковый и новее любой записи. Концы строк нормализуются — иначе одна
  // и та же строка в CRLF и LF даёт разные хеши.
  const stamp = (f) =>
    createHash("sha1")
      .update(readFileSync(f, "utf8").split("\r\n").join("\n"))
      .digest("hex")
      .slice(0, 12);

  const ledger = existsSync(ledgerPath)
    ? JSON.parse(readFileSync(ledgerPath, "utf8"))
    : {};

  // Область прогона берётся из конфига самого инструмента. Считать долг по
  // всему `src` значило бы врать: часть файлов исключена намеренно и с
  // записанной причиной, и они бы числились долгом навсегда.
  const mutateGlobs = (() => {
    const cfg = path.join(BASE, CONFIG.mutationConfig);
    if (!existsSync(cfg)) return null;
    return JSON.parse(readFileSync(cfg, "utf8")).mutate ?? [];
  })();
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
        } else if (".+^${}()|[]\\?".includes(ch)) out += "\\" + ch;
        else out += ch;
      }
      return new RegExp("^" + out + "$");
    };
    const yes = globs.filter((g) => !g.startsWith("!")).map(toRe);
    const no = globs
      .filter((g) => g.startsWith("!"))
      .map((g) => toRe(g.slice(1)));
    return (f) => yes.some((r) => r.test(f)) && !no.some((r) => r.test(f));
  };
  const inScope = mutateGlobs === null ? null : globsToTest(mutateGlobs);
  const key = (f) => norm(path.relative(repoRoot, f));

  // Отчёт последнего прогона. HTML-репортер Stryker держит внутри ТОТ ЖЕ
  // объект, что отдал бы JSON-репортер: `app.report = {…}` перед закрытием
  // тега. Разбираем его, а не заводим второй источник истины рядом.
  const reportPath = path.join(BASE, CONFIG.mutationReport);
  let merged = 0;
  if (existsSync(reportPath)) {
    const html = readFileSync(reportPath, "utf8");
    const head = "app.report = ";
    const from = html.indexOf(head);
    const to = from < 0 ? -1 : html.indexOf("</script>", from);
    if (to > from) {
      const body = html
        .slice(from + head.length, to)
        .trim()
        .replace(/;$/, "");
      const reportedAt = statSync(reportPath).mtimeMs;
      const parsed = new Function("return " + body)();
      // Отчёт несёт СВОЮ область (`config.mutate`). Совпала с конфигом —
      // прогон был полным, и тогда файл в области, которого в отчёте нет,
      // доказанно не дал ни одного мутанта: мутировать в нём нечего. Без этой
      // сверки такие файлы числились бы долгом вечно — а проверка, которую
      // нельзя удовлетворить, учит не читать её вывод.
      const fullScope =
        mutateGlobs !== null &&
        JSON.stringify(parsed.config?.mutate ?? null) ===
          JSON.stringify(mutateGlobs);
      for (const [key, d] of Object.entries(parsed.files ?? {})) {
        const file = norm(path.join(repoRoot, key));
        if (!files.includes(file)) continue;
        // Числа описывают тот код, что был на момент прогона. Если файл
        // тронут ПОСЛЕ него, приписать их нынешнему содержимому нельзя —
        // такую запись пропускаем, и файл остаётся непромеренным.
        if (statSync(file).mtimeMs > reportedAt) continue;
        let killed = 0;
        let alive = 0;
        for (const m of d.mutants ?? []) {
          // Исключённые мутаторы остаются в отчёте пометкой `Ignored` — они
          // не убиты и не выжили, в знаменатель счёта не входят.
          if (m.status === "Ignored") continue;
          if (m.status === "Killed" || m.status === "Timeout") killed += 1;
          else alive += 1;
        }
        const row = { killed, alive, hash: stamp(file) };
        if (JSON.stringify(ledger[key]) !== JSON.stringify(row)) merged += 1;
        ledger[key] = row;
      }
      if (fullScope) {
        for (const file of files) {
          if (isTest(file) || file.endsWith(".d.ts")) continue;
          const k = key(file);
          if (!inScope(k) || parsed.files[k] !== undefined) continue;
          if (statSync(file).mtimeMs > reportedAt) continue;
          const row = { killed: 0, alive: 0, hash: stamp(file) };
          if (JSON.stringify(ledger[k]) !== JSON.stringify(row)) merged += 1;
          ledger[k] = row;
        }
      }
    }
  }
  // Запись об удалённом файле не снимается слиянием: оно только добавляет и
  // обновляет ключи. Оставленная, она навсегда завышает размер реестра и
  // описывает долг по коду, которого нет, — а рецепт удаления узла обещает
  // обратное. Дешевле снимать её здесь, чем требовать это руками.
  let dropped = 0;
  for (const k of Object.keys(ledger))
    if (!existsSync(path.join(repoRoot, k))) {
      delete ledger[k];
      dropped += 1;
      merged += 1;
    }

  if (merged) {
    const ordered = {};
    for (const k of Object.keys(ledger).sort()) ordered[k] = ledger[k];
    writeFileSync(
      ledgerPath,
      JSON.stringify(ordered, null, 2) + String.fromCharCode(10),
      "utf8",
    );
  }

  const scoreOf = (row) =>
    row.killed + row.alive === 0
      ? "мутировать нечего"
      : ((100 * row.killed) / (row.killed + row.alive)).toFixed(2) +
        " %, живых " +
        row.alive;

  console.log("=== Мутационный прогон против правки ===");
  console.log(
    `  в реестре файлов: ${Object.keys(ledger).length}` +
      (merged ? `, обновлено этим прогоном: ${merged}` : "") +
      (dropped ? `, снято об удалённых файлах: ${dropped}` : ""),
  );

  let changed = process.argv.slice(3);
  if (changed.length) {
    reportUnknown(changed);
    changed = canonicalList(changed);
  }
  if (changed.length === 0) {
    changed = await changedPaths(repoRoot);
    if (changed === null) {
      console.log(
        "  git недоступен — передай пути аргументами: graph.mjs mutated <путь> …",
      );
      process.exitCode = 1;
    }
  }

  const needRun = [];
  if (changed !== null) {
    const touched = new Set(changed.map((f) => norm(path.join(repoRoot, f))));
    const touchedCode = [...touched].filter(
      (f) =>
        files.includes(f) &&
        !isTest(f) &&
        !f.endsWith(".d.ts") &&
        (inScope === null || inScope(key(f))),
    );

    const never = [];
    const stale = [];
    const fresh = [];
    for (const f of touchedCode) {
      const row = ledger[key(f)];
      if (row === undefined) {
        never.push(rel(f));
        needRun.push(key(f));
      } else if (row.hash !== stamp(f)) {
        stale.push(`${rel(f)} — было ${scoreOf(row)}`);
        needRun.push(key(f));
      } else {
        fresh.push(`${rel(f)} — ${scoreOf(row)}`);
      }
    }

    console.log(`  тронуто файлов в области прогона: ${touchedCode.length}`);
    if (touchedCode.length === 0)
      console.log("  правка файлов в области прогона не касается");
    for (const [title, rows] of [
      ["Под мутациями не были ни разу:", never],
      [
        "Содержимое изменилось после прогона — число уже не про этот код:",
        stale,
      ],
      ["Измерено на нынешнем содержимом:", fresh],
    ]) {
      if (!rows.length) continue;
      console.log(NEWLINE + "  " + title);
      for (const r of rows) console.log("    " + r);
    }
  }

  if (needRun.length) {
    console.log(
      NEWLINE +
        "  Прогнать по ним:" +
        NEWLINE +
        `    npx stryker run --mutate "${needRun.join(",")}"` +
        NEWLINE +
        NEWLINE +
        "  У каждого выжившего ровно три законных исхода, и каждый называется" +
        NEWLINE +
        "  вслух: добавлен тест; исправлен код; признан неубиваемым — с" +
        NEWLINE +
        "  причиной. Счёт здесь не ворота, а список для разбора.",
    );
  }

  // Долг по всей области, а не только по правке: файл, который уезжает
  // пользователю и ни разу не был под прогоном, — непромеренная поверхность.
  if (inScope !== null) {
    const surface = files.filter(
      (f) => !isTest(f) && !f.endsWith(".d.ts") && inScope(key(f)),
    );
    const unseen = surface.filter((f) => ledger[key(f)] === undefined);
    const drifted = surface.filter(
      (f) => ledger[key(f)] !== undefined && ledger[key(f)].hash !== stamp(f),
    );
    console.log(
      NEWLINE +
        "=== Непромеренная поверхность ===" +
        NEWLINE +
        `  в области прогона: ${surface.length}; ни разу не мерены: ${unseen.length}; ` +
        `изменились после замера: ${drifted.length}`,
    );
    for (const f of [...unseen, ...drifted].slice(0, 15))
      console.log("    " + rel(f));
    const rest = unseen.length + drifted.length - 15;
    if (rest > 0) console.log(`    …и ещё ${rest}`);
  }
}

if (mode === "brief") {
  const NEWLINE = String.fromCharCode(10);
  const arg = argPath(process.argv[3]);
  if (!arg) {
    console.log(
      "Укажи путь: node .claude/work/tools/graph.mjs brief <путь или его хвост>",
    );
    process.exitCode = 1;
  } else {
    // Не-тестовые впереди: спрашивают обычно про сам файл, а его тест
    // попадает в выборку по имени и оттесняет ответ вниз.
    const hits = [...files, ...styleFiles]
      .filter((f) => rel(f).includes(arg))
      .sort((x, y) => Number(isTest(x)) - Number(isTest(y)));
    if (hits.length === 0) {
      console.log(outOfScope(arg));
      process.exitCode = 1;
    } else {
      // Достижимость тестов, строки базы и разбор записей — общие с `plan`,
      // живут на уровне модуля. Документация отвечает на другой вопрос, чем
      // база: не «что и где», а «почему так». Для рефактора это половина, без
      // которой ломают концепцию, ничего не нарушив формально.
      const DOC_LINES = dossierLines().docs;

      for (const target of hits.slice(0, 12)) {
        const r = rel(target);
        const base = r.slice(r.lastIndexOf("/") + 1);
        const bare = base.replace(/\.(tsx?|scss)$/, "");
        console.log(`${NEWLINE}=== ${r} ===`);

        const down = [...(importsOf.get(target) ?? [])].map(rel).sort();
        // У теста спрашивать «что его накрывает» бессмысленно: он и есть
        // проверка. Тревога «его не гоняет ни один тест» на тестовом файле —
        // не предупреждение, а шум, который учит не читать эту строку.
        if (isTest(target)) {
          // Секция импортов печатается ниже только для НЕ-тестов, поэтому
          // отсылать к ней тест значило бы отправить читателя в пустоту —
          // ровно это тут и стояло. А вопрос «что он гоняет» у теста как раз
          // главный: это его импорты, и печатаются они здесь.
          console.log("--- гоняет (что берёт напрямую) ---");
          console.log(
            down.length ? "  " + down.join(NEWLINE + "  ") : "  ничего своего",
          );
          console.log(
            "  «что накрывает его» тут не спрашивают: тест и есть проверка; что он закрепляет — записи базы ниже",
          );
        } else if (r.endsWith(".scss")) {
          // Разбор по тексту общий с `plan`, см. `styleUsers`: стиль часто
          // подключают побочным импортом без `from`, и граф его не видит.
          const { modules: users, tests: named } = styleUsers(target);
          console.log("--- подключают (модули, называющие путь в импорте) ---");
          console.log(
            users.length
              ? "  " +
                  users
                    .map(rel)
                    .sort()
                    .join(NEWLINE + "  ")
              : "  никто — стиль не подключён ни из одного модуля",
          );
          console.log("--- тесты, называющие файл (читают его текстом) ---");
          console.log(
            named.length
              ? "  " +
                  named
                    .map(rel)
                    .sort()
                    .join(NEWLINE + "  ")
              : "  ВНИМАНИЕ: ни один тест на него не смотрит",
          );
        } else {
          console.log(
            "--- импортирует (что надо понять, чтобы понять его) ---",
          );
          console.log(
            down.length ? "  " + down.join(NEWLINE + "  ") : "  ничего своего",
          );

          const up = files.filter((f) =>
            (importsOf.get(f) ?? new Set()).has(target),
          );
          const upCode = up
            .filter((f) => !isTest(f))
            .map(rel)
            .sort();
          console.log("--- импортируют (радиус поражения) ---");
          console.log(
            upCode.length
              ? "  " + upCode.join(NEWLINE + "  ")
              : "  никто — ни один файл проекта его не импортирует",
          );

          // Близнец нужен и здесь, и раньше его тут не было: объясняя файл
          // форка, легко перенести на него смысл копии — одинаковая форма
          // читается как одинаковый смысл. Пара называется до объяснения.
          const twin = twinsOf(rel(target));
          if (twin.length) {
            console.log("--- парная копия ---");
            console.log(
              "  " +
                twin.join(NEWLINE + "  ") +
                NEWLINE +
                "  смысл берётся из ЭТОГО файла: одинаковая форма не значит одинакового смысла",
            );
          }

          // Средний уровень считается ПО ИМЕНАМ, а не по форме пути: тест,
          // взявший `useImageResourceStore` из бочки слоя, гоняет файл, который
          // это имя определяет; тест, взявший из той же бочки соседнее имя, —
          // нет. Разбор общий с `plan`, см. `testsFor`.
          const { direct, byName, transitive } = testsFor(target);
          console.log("--- тесты, называющие файл сами ---");
          console.log(
            direct.length
              ? "  " +
                  direct
                    .map(rel)
                    .sort()
                    .join(NEWLINE + "  ")
              : "  нет",
          );
          console.log(
            "--- тесты, тянущие его экспорты через бочку (тоже гоняют) ---",
          );
          console.log(
            byName.length
              ? "  " +
                  byName
                    .map(rel)
                    .sort()
                    .join(NEWLINE + "  ")
              : "  нет",
          );
          // Тревога поднимается, только когда пусты ВСЕ три уровня. Если файл
          // достают транзитивно, тест на него может существовать и гонять его
          // через композицию — так закрыт BrowserChromeSync через ThemeProvider.
          // Кричать «не гоняет никто» в этом случае значит врать.
          if (direct.length + byName.length === 0)
            console.log(
              transitive === 0
                ? "  ВНИМАНИЕ: файл не гоняет ни один тест — правку проверять руками"
                : "  напрямую никто; проверь, гоняют ли его те, кто дотягивается ниже",
            );
          console.log(
            `--- дотягиваются транзитивно, через обычные модули: ${transitive} ---`,
          );
        }

        // Разбор записей базы — общий с `plan`, см. `baseHitsFor`: там же
        // объяснено, почему голое имя засчитывается не всегда и что делает
        // строка, называющая соседа по папке.
        const { exact, loose } = baseHitsFor(target);
        console.log("--- записи базы: назван путём (точно) ---");
        for (const [n, i, line] of exact.slice(0, 40))
          console.log(`  ${n}:${i}  ${line.trim().slice(0, 110)}`);
        if (!exact.length) console.log("  нет");
        console.log(
          "--- записи базы: упомянут по имени (может промахнуться) ---",
        );
        for (const [n, i, line] of loose.slice(0, 20))
          console.log(`  ${n}:${i}  ${line.trim().slice(0, 110)}`);
        if (!loose.length) console.log("  нет");

        // Якорь в самом файле — точная ссылка, написанная его же автором.
        // Тем же помощником, что и проверка: два сканера одного и того же с
        // разными правилами — это гарантия однажды разойтись. Досье молчало про
        // документ у useOrientationSwapVeil, потому что тот пишет ссылку в
        // середине фразы, а не отдельной строкой.
        const anchors = [...new Set(docRefsIn(readFileSync(target, "utf8")))];
        console.log("--- документация: на что ссылается сам файл ---");
        console.log(
          anchors.length
            ? "  " + anchors.join(NEWLINE + "  ")
            : isTest(target)
              ? // Число тестов с якорем здесь когда-то стояло прописью и
                // устарело бы от любой правки; если оно нужно — оно считается.
                `  якоря нет, и не нужен: «почему» у теста — блок в его шапке (${
                  files.filter(
                    (f) =>
                      isTest(f) &&
                      docRefsIn(readFileSync(f, "utf8")).length > 0,
                  ).length
                } из ${files.filter(isTest).length} тестов ссылаются на доки)`
              : "  якоря нет — «почему» этого файла нигде не объявлено",
        );

        const docHits = DOC_LINES.filter(([, , line]) =>
          quotedIn(line).some(
            (t) => t === r || r.endsWith("/" + t) || t === base || t === bare,
          ),
        );
        console.log("--- документация: где он назван ---");
        for (const [n, i, line] of docHits.slice(0, 20))
          console.log(`  ${n}:${i}  ${line.trim().slice(0, 110)}`);
        if (!docHits.length) console.log("  нет");
      }
      if (hits.length > 12)
        console.log(
          `${NEWLINE}...и ещё ${hits.length - 12} файлов подходит под запрос.`,
        );
    }
  }
}

if (mode === "sizes") {
  const NEWLINE = String.fromCharCode(10);
  const size = (f) =>
    readFileSync(f, "utf8")
      .split(NEWLINE)
      .filter((l) => l.trim() !== "").length;
  const arg = process.argv[3];
  const rows = files
    .filter((f) => (arg ? rel(f).includes(arg) : true))
    .map((f) => [rel(f), size(f)])
    .sort((a, b) => b[1] - a[1]);
  console.log("=== Непустых строк на файл ===" + NEWLINE);
  for (const [f, n] of rows) console.log(String(n).padStart(5) + "  " + f);
  const total = rows.reduce((sum, r) => sum + r[1], 0);
  console.log(NEWLINE + `Файлов: ${rows.length}, непустых строк: ${total}.`);
}

if (mode === "verify") {
  const MAP = CONFIG.map;
  const TESTS = CONFIG.tests;
  const NEWLINE = String.fromCharCode(10);
  const CR_LF = String.fromCharCode(13) + NEWLINE;
  const REPO = path.join(BASE, "..");

  const bare = (q) => q.replace(/[*]+$/, "").replace(/[/]+$/, "");

  // Пути в базе сокращены и лежат на разной глубине: разрешаются по префиксу
  // раздела, затем по однозначному суффиксу.
  const expand = (q) => {
    if (q.startsWith("src/")) return path.join(REPO, q);
    if (
      q.startsWith("client/") ||
      q.startsWith("boundary/") ||
      q.startsWith("data-gen/")
    )
      return path.join(REPO, "src/components/Carousel", q);
    if (q.startsWith("docs/") || q.startsWith("modules/"))
      return path.join(REPO, "src/components/Carousel/client", q);
    if (q.startsWith("basic/") || q.startsWith("widget/"))
      return path.join(
        REPO,
        "src/components/Carousel/client/modules/Pagination",
        q,
      );
    if (q.startsWith("shared/") || q.startsWith("app/"))
      return path.join(REPO, "src", q);
    return null;
  };

  // Два списка, и смешивать их нельзя: размеры папок считаются по коду
  // (`everyFile`), а якоря указывают ещё и на доки (`everyPath`).
  const everyFile = [];
  const everyPath = [];
  (function walkAll(dir) {
    if (!walkable(dir)) return;
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walkAll(full);
      else if (/\.(tsx?|scss|md)$/.test(e)) {
        everyPath.push(full.split(path.sep).join("/"));
        if (!e.endsWith(".md")) everyFile.push(everyPath[everyPath.length - 1]);
      }
    }
  })(norm(path.join(REPO, "src")));

  // Файл ищется по сокращению, по префиксу раздела и, последним, по уникальному
  // хвосту пути: база пишет и `client/domain/track.ts`, и просто `track.ts`.
  const locate = (q, prefix) => {
    for (const candidate of prefix === null ? [q] : [q, prefix + q]) {
      const expanded = expand(candidate);
      if (expanded !== null && existsSync(expanded)) return norm(expanded);
      // Полки база пишет и без ведущего `shared/` — `engines/motion/tests/…`.
      // Только для путей с папкой: голое имя обязано разрешаться префиксом
      // раздела, иначе `index.ts` уедет в `shared/index.ts`.
      if (candidate.includes("/")) {
        const atShelf = path.join(REPO, "src/shared", candidate);
        if (existsSync(atShelf) && statSync(atShelf).isFile())
          return norm(atShelf);
      }
      const atRepo = path.join(REPO, candidate);
      if (existsSync(atRepo) && statSync(atRepo).isFile()) return norm(atRepo);
    }
    const hits = everyPath.filter((f) => f.endsWith("/" + q));
    return hits.length === 1 ? hits[0] : null;
  };

  // База пишет группы вида `{a,b}/tests`: раскрываем их в отдельные пути.
  const variants = (q) => {
    const group = /\{([^}]*)\}/.exec(q);
    if (group === null) return [q];
    const head = q.slice(0, group.index);
    const tail = q.slice(group.index + group[0].length);
    return group[1]
      .split(",")
      .flatMap((one) => variants(head + one.trim() + tail));
  };

  // Звёздочки — «сколько угодно сегментов, в том числе ноль»; путь без них
  // означает «всё, что лежит под ним».
  const BACKSLASH = String.fromCharCode(92);
  const MID = String.fromCharCode(1);
  const TAIL = String.fromCharCode(2);
  const esc = (s) =>
    [...s].map((c) => (/[\w-]/.test(c) ? c : BACKSLASH + c)).join("");
  const asRegExp = (full) => {
    const marked = (full.includes("*") ? full : full + "**")
      .split("/**/")
      .join(MID)
      .split("**")
      .join(TAIL);
    const body = esc(marked)
      .split(esc(MID))
      .join("/(?:[^]*/)?")
      .split(esc(TAIL))
      .join("(?:[^]*)?");
    return new RegExp("^" + body + "$");
  };

  // Всё, что лежит под путём, тесты включительно.
  const inside = (q, prefix) => {
    for (const raw of prefix === null ? [q] : [q, prefix + q]) {
      const shapes = [];
      for (const pattern of variants(raw)) {
        const head = pattern.split("*")[0];
        // Тот же сокращённый вид полки, что понимает `locate`.
        const shelf = path.join(REPO, "src/shared", head);
        const root =
          expand(head) ??
          (head.includes("/") && existsSync(shelf) ? shelf : null);
        if (root === null) continue;
        const slash = head.endsWith("/") ? "/" : "";
        shapes.push(asRegExp(norm(root) + slash + pattern.slice(head.length)));
      }
      if (!shapes.length) continue;
      const hits = everyFile.filter((f) => shapes.some((rx) => rx.test(f)));
      if (hits.length) return { hits, wantTests: raw.includes("tests") };
    }
    return null;
  };

  // Размер папки считается по коду, а пути со словом `tests` — по тестам.
  const under = (q, prefix) => {
    const found = inside(q, prefix);
    if (found === null) return null;
    const hits = found.hits.filter((f) => isTest(f) === found.wantTests);
    return hits.length ? hits : null;
  };

  // 3, 4 и 5. якоря, состав объявленных папок и радиус поражения слоя —
  // проходом по строкам: все три читают контекст заголовка, он задаёт и префикс
  // пути, и файл, к которому относятся якоря вида `:120`.
  // Заявляется СОСТАВ папки, а не её объём: число файлов меняется, только
  // когда файл появился или исчез, — и это ровно то событие, которое база
  // обязана заметить. Объём строк не заявляется нигде (см. режим `sizes`).
  const DIR_RE = /`([\w./*{},-]+\/(?:\*\*)?)`\s*\((\d+) файл[а-я]*\)/g;
  const DASH_RE = /`([\w./*{},-]+\/(?:\*\*)?)`[^`\n]*— (\d+) файл[а-я]*/g;
  // Радиус поражения слоя: «22 импортёра (+12 тестовых)». Считается по графу,
  // а не по папке, поэтому и живёт в проверке, а не в тексте.
  const IMPORTERS_RE =
    /`([\w./*{},-]+\/(?:\*\*)?)`[^`\n]*?(\d+) импортёр[а-я]*(?: \(\+(\d+) тест[а-я]*\))?/g;
  const PATH_RE = /`([\w./{},*-]+\.(?:tsx|ts|scss))`/g;
  const HEAD_RE = /^#{2,4}[^`]*`([^`]+)`/;
  const HEAD_FILES_RE = /`([\w./{},*-]+\.(?:tsx|ts|scss))`/g;
  const ANCHOR_TAIL = /\.(tsx?|scss|md|json|html)$/;
  // Якорь с цитатой: (`:31` `export const buildCarouselLayout`). Номер съедет
  // от любой вставки выше, цитата — нет, поэтому проверяется именно она.
  //
  // Цитата есть у единиц, а номер съезжает у всех. Поэтому у якоря без цитаты
  // проверяется то немногое, что проверить можно: строка, на которую он
  // указывает, обязана быть содержательной. Якорь ставят на объявление, а не
  // на закрывающую скобку и не на пустоту — если он туда попал, он съехал.
  // Только для кода: в прозе пустая строка внутри диапазона законна.
  // Хвост комментария — та же пустота, что и закрывающая скобка: строка `*/`,
  // одинокая `*` и голый `//` содержания не несут, и якорь, попавший туда,
  // съехал ровно так же. Найдено пробой: запись про стенд указывала на строку,
  // закрывающую блок комментария, а описывала конструкцию двумя строками ниже.
  const JUNK_ANCHOR = /^\s*(?:[)\]}]+[;,]?|\{|,|\*+\/|\*|\/\/|)\s*$/;
  // Цитата принадлежит якорю тем, что стоит сразу за ним; круглые скобки вокруг
  // — вёрстка, а не форма. Требование закрывающей скобки вплотную к цитате
  // выбрасывало из проверки всё, где дальше шла точка с запятой, продолжение
  // фразы или вторая ссылка, — тридцать пять записей против тридцати девяти
  // разобранных. Они выглядели проверяемыми и не проверялись; найдено пробой.
  // Цитатой не считается второй адрес подряд: перечисление из двух якорей — это
  // два якоря, а не якорь с цитатой. Образец такой пары в комментарии не
  // приводится: сверки читают собственные описания как настоящие записи, и это
  // уже срабатывало трижды.
  const CITED_RE = /`([^`]*):(\d+)(?:-(\d+))?` `([^`]+)`/g;

  let anchors = 0;
  let cited = 0;
  let dirs = 0;
  const broken = [];
  const wrong = [];
  const unresolved = [];
  const goneTests = [];
  const goneMapped = [];

  const claimDir = (name, q, prefix, filesClaim) => {
    const hits = under(q, prefix);
    if (hits === null) {
      unresolved.push(`${name}: ${q}`);
      return;
    }
    dirs++;
    // Заявленная папка описывает то, что в ней лежит; у тестов такого зачёта
    // нет — 08-tests.md обязан называть каждый файл поимённо.
    if (name === MAP) for (const hit of hits) mapMentions.add(hit);
    if (hits.length !== Number(filesClaim))
      wrong.push(
        `${name}: ${q} — записано ${filesClaim} файлов, на диске ${hits.length}`,
      );
  };

  let radii = 0;
  // Импортёр — файл **вне** слоя: собственные тесты слоя в радиус не входят,
  // иначе число росло бы от каждого нового теста внутри самой папки.
  const claimImporters = (name, q, prefix, codeClaim, testClaim) => {
    const found = inside(q, prefix);
    if (found === null) {
      unresolved.push(`${name}: ${q}`);
      return;
    }
    const target = found.hits;
    const users = files.filter(
      (f) =>
        !target.includes(f) &&
        [...(importsOf.get(f) ?? [])].some((d) => target.includes(d)),
    );
    radii++;
    const inCode = users.filter((f) => !isTest(f)).length;
    if (inCode !== Number(codeClaim))
      wrong.push(
        `${name}: ${q} — записано ${codeClaim} импортёров, на диске ${inCode}`,
      );
    if (testClaim === undefined) return;
    const inTests = users.length - inCode;
    if (inTests !== Number(testClaim))
      wrong.push(
        `${name}: ${q} — записано ${testClaim} тестовых импортёров, на диске ${inTests}`,
      );
  };

  // Куда указывают якоря каталога ограничений — по ним сверяются пометки
  // CONSTRAINT в коде.
  const invariantAnchors = [];
  // То же для реестра решений.
  const decisionAnchors = [];

  // Пути, разобранные из текста базы: покрытие считается по ним, а не по
  // совпадению имени файла — иначе одноимённые файлы засчитывают друг друга.
  const mapMentions = new Set();
  const testMentions = new Set();

  // Строки таблицы «Правила направления»: слой, запреты, разрешённые исключения.
  const RULES_HEAD = new RegExp("^#+.*" + CONFIG.rulesHeading);
  const ISOLATION_HEAD = new RegExp("^#+.*" + CONFIG.isolationHeading);
  const ROW_RE = /^\|(.+)\|(.+)\|(.*)\|\s*$/;
  const ISO_ROW_RE = /^\|([^|]+)\|([^|]+)\|\s*$/;
  const cellPaths = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const rules = [];
  const isolation = [];

  for (const name of readdirSync(BASE)) {
    // README базы описывает ФОРМЫ записи и приводит примеры: якорь с номером,
    // объём папки, радиус. Разбирать их как заявления значит ловить собственную
    // инструкцию — ровно это и случилось, когда пример `:120` в контракте
    // покраснел как битый якорь. Инструкция не факт о проекте.
    if (!name.endsWith(".md") || name === "README.md") continue;
    // Заголовок раздела задаёт префикс путей и, если называет ровно один файл,
    // адресата относительных якорей.
    let prefix = null;
    let current = null;
    let inRules = false;
    let inIsolation = false;
    const lines = readFileSync(path.join(BASE, name), "utf8").split(NEWLINE);
    // Единица каталога — АБЗАЦ, а не строка. Адрес стоит в одной строке
    // («**что нельзя** (`файл:строка`)»), а пометка названа словами в соседней
    // («Решено: комментарий «…»»), и так написаны почти все записи. Обратная
    // сверка, судящая по строке, спросила бы с двух записей из тридцати —
    // то есть выглядела бы работающей, ничего не проверяя.
    const record = [];
    for (let i = 0; i < lines.length;) {
      let j = i;
      while (j < lines.length && lines[j].trim() !== "") j++;
      const text = lines.slice(i, j).join("\n");
      for (let k = i; k < j; k++) record[k] = text;
      i = j + 1;
    }
    for (const [lineAt, line] of lines.entries()) {
      const head = HEAD_RE.exec(line);
      if (head !== null) {
        const token = head[1];
        prefix = !token.includes("/")
          ? null
          : /\.(tsx?|scss)$/.test(token)
            ? token.slice(0, token.lastIndexOf("/") + 1)
            : bare(token) + "/";
        const named = line.match(HEAD_FILES_RE) ?? [];
        current =
          named.length === 1
            ? locate(named[0].split(String.fromCharCode(96)).join(""), prefix)
            : null;
      }
      if (line.startsWith("#")) {
        inRules = RULES_HEAD.test(line);
        inIsolation = ISOLATION_HEAD.test(line);
      }

      const row = inRules ? ROW_RE.exec(line) : null;
      if (row !== null) {
        const layer = cellPaths(row[1]);
        if (layer.length === 1)
          rules.push({
            layer: layer[0],
            banned: cellPaths(row[2]),
            allowed: cellPaths(row[3]),
          });
      }

      // Изоляция — правило наоборот: не список запретов, а список разрешённого.
      // Запрет перечислением отстаёт от появления соседней папки, и отстаёт
      // молча: у `domain` в запретах стояло восемь папок из двадцати, и импорт
      // в любую из прочих проходил зелёным. Найдено пробой.
      const iso = inIsolation ? ISO_ROW_RE.exec(line) : null;
      if (iso !== null) {
        const layer = cellPaths(iso[1]);
        if (layer.length === 1)
          isolation.push({ layer: layer[0], only: cellPaths(iso[2]) });
      }

      for (const span of line
        .split(String.fromCharCode(96))
        .filter((_, i) => i % 2 === 1)) {
        const at = span.lastIndexOf(":");
        if (at < 0) continue;
        const numbers = span.slice(at + 1).split("-");
        if (!numbers.every((n) => /^[0-9]+$/.test(n))) continue;
        const where = span.slice(0, at);
        if (where !== "" && !ANCHOR_TAIL.test(where)) continue;
        const file = where === "" ? current : locate(where, prefix);
        if (file === null) {
          unresolved.push(`${name}: ${span}`);
          continue;
        }
        anchors++;
        const body = readFileSync(file, "utf8").split(NEWLINE);
        const lines = body.length;
        const last = Number(numbers[numbers.length - 1]);
        if (last > lines)
          broken.push(`${name}: ${span} — в файле ${lines} строк`);
        else if (
          !file.endsWith(".md") &&
          JUNK_ANCHOR.test(body[Number(numbers[0]) - 1] ?? "")
        )
          broken.push(`${name}: ${span} — там скобка или пусто, якорь съехал`);
        // Текст записи едет вместе с якорем: обратная сверка пометок судит по
        // тому, что запись САМА о себе говорит, а не по догадке о её замысле.
        const anchor = {
          file,
          from: Number(numbers[0]),
          to: last,
          text: record[lineAt] ?? line,
        };
        if (name === CONFIG.invariants) invariantAnchors.push(anchor);
        if (name === CONFIG.decisions) decisionAnchors.push(anchor);
      }

      let m;
      CITED_RE.lastIndex = 0;
      while ((m = CITED_RE.exec(line)) !== null) {
        const file = m[1] === "" ? current : locate(m[1], prefix);
        if (file === null) continue;
        // Второй адрес — не цитата, а следующий якорь.
        if (/^[^\s]*:\d+(-\d+)?$/.test(m[4])) continue;
        cited++;
        const body = readFileSync(file, "utf8").split(NEWLINE);
        const from = Number(m[2]);
        const to = Number(m[3] ?? m[2]);
        if (!body.slice(from - 1, to).some((l) => l.includes(m[4])))
          broken.push(
            `${name}: ${m[1]}:${m[2]} — цитаты «${m[4]}» на этих строках нет`,
          );
      }
      DIR_RE.lastIndex = 0;
      while ((m = DIR_RE.exec(line)) !== null)
        claimDir(name, m[1], prefix, m[2]);
      DASH_RE.lastIndex = 0;
      while ((m = DASH_RE.exec(line)) !== null)
        claimDir(name, m[1], prefix, m[2]);
      IMPORTERS_RE.lastIndex = 0;
      while ((m = IMPORTERS_RE.exec(line)) !== null)
        claimImporters(name, m[1], prefix, m[2], m[3]);
      PATH_RE.lastIndex = 0;
      while ((m = PATH_RE.exec(line)) !== null) {
        for (const one of variants(m[1])) {
          const hit = locate(one, prefix);
          // Реестр тестов сверялся в одну сторону: каждый тест с диска обязан
          // быть назван. Обратное молчало — удалённый тест оставлял строку,
          // описывающую проверку, которой нет, и это хуже отсутствующей: она
          // читается как действующая гарантия. Ловится только имя, похожее на
          // тест, — иначе в список посыпалась бы проза.
          if (hit === null) {
            // `locate` молчит и когда файла нет, и когда имя неоднозначно —
            // у парных форков одноимённых тестов по два. Неоднозначность
            // отсутствием не является, иначе список наполнится живыми файлами.
            const existsSomewhere = files.some(
              (f) => rel(f) === one || rel(f).endsWith("/" + one),
            );
            if (name === TESTS && /\.test\.tsx?$/.test(one) && !existsSomewhere)
              goneTests.push(`${name}: ${one}`);
            // Шаблоны со звёздочкой и перечисления расширений (`.ts/.tsx`)
            // адресами не являются: они описывают форму, а не файл. Замер на
            // здоровом дереве дал ровно три таких и ноль настоящих.
            if (
              name === MAP &&
              /\.(tsx?|scss)$/.test(one) &&
              !/\.test\.tsx?$/.test(one) &&
              !one.includes("*") &&
              one.split("/").every((s) => !s.startsWith(".")) &&
              !existsSomewhere
            )
              goneMapped.push(`${name}: ${one}`);
            continue;
          }
          if (name === MAP) mapMentions.add(hit);
          if (name === TESTS) testMentions.add(hit);
        }
      }
    }
  }

  // 6 и 8. пометки кода и записи каталогов сверяются В ОБЕ СТОРОНЫ
  //
  // Сверка была односторонней — «пометка → запись» — и на снятой пометке
  // молчала: каталог продолжал описывать ограничение, которого в коде уже нет,
  // и читался как действующее, то есть врал достовернее пустого места. Обе
  // стороны и оба каталога считаются одним кодом намеренно: половинчатая
  // починка тем и опасна, что выглядит целой.
  //
  // ПРЯМАЯ сторона: пометка обязана быть описана. Соответствие — по якорю,
  // указывающему в тот же файл рядом с пометкой: формулировка живёт в каталоге,
  // а не в комментарии.
  //
  // ОБРАТНАЯ сторона спрашивает не с каждого якоря, а только с того, чья запись
  // САМА называет пометку. Каталог адресует и код, который держит ограничение
  // без всякого комментария («держится: вот эта функция»), — сверка «любой
  // якорь → пометка» краснела бы на законном, то есть врала бы (F4). Запись,
  // назвавшая пометку, — это утверждение, и проверяется именно оно.
  const CONSTRAINT_SLACK = 8;
  const near = (at, a) =>
    at >= a.from - CONSTRAINT_SLACK && at <= a.to + CONSTRAINT_SLACK;

  // Корпус у обеих пометок один: код и стили, без тестов. Стили входят наравне
  // с модулями — правило проекта между ними разницы не делает, а раньше её
  // делал сканер: ограничения он в них не искал, решения искал.
  const marked = [
    ...files.filter((f) => !isTest(f)),
    ...everyFile.filter((f) => f.endsWith(".scss")),
  ];
  // Названной пометка считается тогда, когда запись её ПРОЦИТИРОВАЛА — в
  // обратных апострофах или в кавычках, как и написан весь каталог («Решено:
  // комментарий «flat by design»»). Голое слово в прозе именем пометки не
  // является: «это и есть намеренное поведение» — вывод о поведении, и сверка
  // по нему покраснела бы на законной записи, то есть соврала бы (F4).
  const quoted = (text) =>
    [...text.matchAll(/`([^`]+)`|«([^»]+)»/g)].map((m) => m[1] ?? m[2]);

  // Цитата сравнивается по словам, а не побайтно: в коде она переносится по
  // строкам и несёт на себе `//` и `*` продолжения комментария. Побайтная
  // сверка краснела бы на семи законных записях из восьми — то есть врала бы.
  const flat = (text) =>
    text
      .split(NEWLINE)
      .map((l) => l.replace(/^\s*(\/\/+|\/?\*+\/?)\s*/, " "))
      .join(" ")
      .replace(/\s+/g, " ")
      .toLowerCase();

  const markerCheck = ({ inCode, names, anchors }) => {
    const bodies = new Map();
    const marks = new Map();
    let total = 0;
    for (const f of marked) {
      const body = readFileSync(f, "utf8").split(NEWLINE);
      bodies.set(f, body);
      const found = [];
      body.forEach((line, index) => {
        if (inCode(line)) found.push(index + 1);
      });
      if (found.length !== 0) marks.set(f, found);
      total += found.length;
    }
    const unlisted = [];
    for (const [f, found] of marks)
      for (const at of found)
        if (!anchors.some((a) => a.file === f && near(at, a)))
          unlisted.push(`${rel(f)}:${at}`);
    // Ищется ИМЕННО ТА пометка, которую запись процитировала, а не любая
    // поблизости. Разница не теоретическая: в шапке одного файла два решения
    // стоят в семи строках друг от друга, и сверка «есть хоть какая-то пометка
    // в окне» на снятии одного из них промолчала — второе закрывало окно собой.
    const gone = new Set();
    for (const a of anchors) {
      const body = bodies.get(a.file);
      if (body === undefined) continue;
      const span = flat(
        body
          .slice(
            Math.max(0, a.from - 1 - CONSTRAINT_SLACK),
            a.to + CONSTRAINT_SLACK,
          )
          .join("\n"),
      );
      for (const q of quoted(a.text)) {
        if (!names.test(q)) continue;
        if (!span.includes(flat(q)))
          gone.add(`${rel(a.file)}:${a.from} «${q}»`);
      }
    }
    return { total, unlisted, gone: [...gone] };
  };

  // Слова решения ищутся только в комментарии: те же слова встречаются внутри
  // строк, которые диагностика печатает пользователю, и решением проекта не
  // являются.
  // Обе пометки узнаются НА ОБОИХ ЯЗЫКАХ. Проект сегодня двуязычен по
  // расположению (код английский, база русская), а завтра может переехать
  // целиком в одну сторону. Сканер, знающий одну сторону, в этот день замолчит
  // и пройдёт зелёным — то есть соврёт ровно там, где его читают как гарантию.
  const DECISION_RE =
    /do not remove|by design|deliberat|intentional|on purpose|не удалять|намеренно|осознанно|по замыслу|нарочно/i;

  const markerKinds = [
    {
      title: "Пометки CONSTRAINT",
      base: CONFIG.invariants,
      // В коде пометка пишется с тире: `CONSTRAINT — что нельзя`. Запись тире
      // не повторяет — она называет пометку одним словом.
      inCode: (line) => /(CONSTRAINT|ОГРАНИЧЕНИЕ)\s+—/.test(line),
      names: /CONSTRAINT|ОГРАНИЧЕНИЕ/,
      anchors: invariantAnchors,
    },
    {
      title: "Пометки решений",
      base: CONFIG.decisions,
      inCode: (line) => {
        const hit = DECISION_RE.exec(line);
        return hit !== null && inComment(line, hit.index);
      },
      // Своего слова у пометки решения нет: запись называет её цитатой самого
      // комментария.
      names: DECISION_RE,
      anchors: decisionAnchors,
    },
  ].map((kind) => ({ ...kind, ...markerCheck(kind) }));

  // 1. каждый файл кода и каждый стиль упомянуты в карте
  // Ambient-объявления описывать нечем: в них нет ни поведения, ни связей.
  const code = [
    ...files.filter((f) => !isTest(f) && !f.endsWith(".d.ts")),
    ...everyFile.filter((f) => f.endsWith(".scss")),
  ];
  const missing = code.filter((f) => !mapMentions.has(f));
  // Долг карты — храповик, и заведён он под посадку в ЖИВОЙ проект. Там
  // описать триста файлов в день посадки нельзя, а требовать этого значит
  // оставить проект красным навсегда — после чего красный прогон перестают
  // читать. Долг объявляется числом на день посадки, печатается каждым
  // прогоном и **расти не может**: новый файл обязан быть описан сразу, старый
  // долг ждёт команды разработчика. Пустое поле — долга нет, карта обязана быть
  // полной.
  const mapDebt = CONFIG.mapDebt ?? 0;
  const overDebt = Math.max(0, missing.length - mapDebt);
  console.log("=== Покрытие карты ===");
  console.log(
    `  файлов кода и стилей (без тестов): ${code.length}, не упомянуто: ${missing.length}` +
      (mapDebt > 0 ? `, из них долг посадки: ${mapDebt}` : "") +
      (goneMapped.length
        ? `, названо и не существует: ${goneMapped.length}`
        : ""),
  );
  if (mapDebt > 0 && overDebt === 0)
    console.log(
      "  Долг не вырос. Уменьшить его — работа по команде разработчика:" +
        " описать файлы и уменьшить поле долга в настройке.",
    );
  for (const f of missing) console.log("    " + rel(f));
  for (const m of goneMapped) console.log("    " + m);

  // 2. каждый тестовый файл назван в 08-tests.md — поимённо, папкой не зачесть
  const testFiles = files.filter(isTest);
  const unnamed = testFiles.filter((f) => !testMentions.has(f));
  console.log("=== Покрытие тестов ===");
  console.log(
    `  тестовых файлов: ${testFiles.length}, не названо: ${unnamed.length}` +
      (goneTests.length
        ? `, названо и не существует: ${goneTests.length}`
        : ""),
  );
  for (const f of unnamed) console.log("    " + rel(f));
  for (const t of goneTests) console.log("    " + t);

  // 7. правила направления импортов держатся
  // Слой описан путём, запрет — либо путём (сверяется по графу), либо именем
  // пакета (сверяется по спецификатору как написан). Исключения перечислены
  // рядом с правилом: дыра, о которой известно, — это не то же, что дыра.
  const broken7 = [];
  // Графа «исключение» — третий список того же рода, что исключения адресов и
  // ссылок: запись, которая ничего не разрешает, читается как объявленная дыра,
  // которой давно нет, и прикрывает собой ту, что появится завтра.
  const allowUsed = new Set();
  const deadRuleAllowances = [];
  for (const rule of rules) {
    const layer = (inside(rule.layer, null)?.hits ?? []).filter(
      (f) => !isTest(f),
    );
    const allowedBy = new Map();
    for (const q of rule.allowed)
      for (const hit of inside(q, null)?.hits ?? []) allowedBy.set(hit, q);
    for (const banned of rule.banned) {
      const target = banned.includes("/")
        ? new Set(inside(banned, null)?.hits ?? [])
        : null;
      for (const f of layer) {
        if (target === null) {
          if (specsOf.get(f)?.has(banned))
            broken7.push(`${rel(f)} → ${banned}`);
          continue;
        }
        for (const dep of importsOf.get(f) ?? []) {
          if (!target.has(dep)) continue;
          const by = allowedBy.get(dep);
          if (by === undefined) broken7.push(`${rel(f)} → ${rel(dep)}`);
          else allowUsed.add(`${rule.layer}|${by}`);
        }
      }
    }
  }
  for (const rule of rules)
    for (const q of rule.allowed)
      if (!allowUsed.has(`${rule.layer}|${q}`))
        deadRuleAllowances.push(
          `правила направления: ${rule.layer} → ${q} — ничего не разрешает`,
        );
  console.log("=== Правила направления ===");
  console.log(`  правил: ${rules.length}, нарушено: ${broken7.length}`);
  for (const b of broken7) console.log("    " + b);

  // 7a. изоляция слоя: импортировать можно только объявленное.
  const brokenIso = [];
  for (const rule of isolation) {
    const own = new Set(inside(rule.layer, null)?.hits ?? []);
    const allowed = new Set(
      rule.only.flatMap((q) => inside(q, null)?.hits ?? []),
    );
    for (const f of own) {
      if (isTest(f)) continue;
      for (const dep of importsOf.get(f) ?? [])
        if (!own.has(dep) && !allowed.has(dep))
          brokenIso.push(`${rel(f)} → ${rel(dep)}`);
    }
  }
  // 7b. звёздные бочки — только объявленные.
  const starDrift = [];
  if (CONFIG.starBarrels != null) {
    const declared = new Set(CONFIG.starBarrels);
    const onDisk = new Set(
      files
        .filter(
          (f) => !isTest(f) && /^\s*export\s+\*/m.test(readFileSync(f, "utf8")),
        )
        .map(rel),
    );
    for (const f of onDisk)
      if (!declared.has(f))
        starDrift.push(
          `звёздная бочка не объявлена: ${f} — здесь выключен анализ мёртвых экспортов`,
        );
    for (const f of declared)
      if (!onDisk.has(f)) starDrift.push(`объявлена, но звёздочки нет: ${f}`);
  }
  console.log("=== Звёздные бочки ===");
  console.log(
    CONFIG.starBarrels == null
      ? "  список не заявлен"
      : `  расхождений: ${starDrift.length}`,
  );
  for (const s of starDrift) console.log("    " + s);

  // 7c. состав бочки в записи карты. У бочки нет своей логики — она только
  // отдаёт наружу, поэтому каждое имя, названное её записью, есть утверждение
  // о публичной поверхности файла. Стареет оно молча: сверка имён в тексте
  // спрашивает лишь, есть ли имя в исходниках, а не эта ли бочка его отдаёт.
  // Найдено пробой — запись называла пять функций полки при трёх на диске, и
  // обе лишние в исходниках существовали, то есть та сверка была зелёной.
  // Обратной стороны нет намеренно: запись называет ВЫБОРКУ, а не полный
  // состав — перечислить его целиком запретило бы само правило о счётах, —
  // и сверка «каждый экспорт назван» краснела бы на законном.
  const barrelDrift = [];
  {
    const CAMEL = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z][A-Za-z0-9]*$/;
    const mapLines = readFileSync(path.join(BASE, CONFIG.map), "utf8").split(
      NEWLINE,
    );
    let barrel = null;
    const close = () => {
      if (barrel === null) return;
      const own = exportsOf.get(barrel.file) ?? new Set();
      for (const [name, line] of barrel.named)
        if (!own.has(name))
          barrelDrift.push(
            `${CONFIG.map}:${line} — ${rel(barrel.file)} не отдаёт ${name}`,
          );
      barrel = null;
    };
    for (const [i, line] of mapLines.entries()) {
      const head = /^###\s+`([^`]+)`\s+—\s+.*бочк/i.exec(line);
      if (head !== null || /^###\s/.test(line)) close();
      if (head === null) {
        if (barrel !== null)
          for (const m of line.matchAll(/`([^`]+)`/g))
            if (CAMEL.test(m[1])) barrel.named.push([m[1], i + 1]);
        continue;
      }
      const hits = files.filter(
        (f) => rel(f) === head[1] || rel(f).endsWith("/" + head[1]),
      );
      // Звёздная бочка пропускается: что именно она отдаёт, разобрать нельзя —
      // то же ограничение, из-за которого у неё выключен анализ мёртвых
      // экспортов. Спрашивать с записи о таком файле значило бы краснеть на
      // законном: имена, пришедшие через `export *`, инструменту не видны.
      barrel =
        hits.length === 1 &&
        !/^\s*export\s+\*/m.test(readFileSync(hits[0], "utf8"))
          ? { file: hits[0], named: [] }
          : null;
    }
    close();
  }
  console.log("=== Состав бочки в записи карты ===");
  console.log(`  имён названо неверно: ${barrelDrift.length}`);
  for (const b of barrelDrift) console.log("    " + b);

  console.log("=== Правила изоляции ===");
  console.log(`  слоёв: ${isolation.length}, нарушено: ${brokenIso.length}`);
  for (const b of brokenIso) console.log("    " + b);

  // 7c. правило про несуществующий предмет.
  // Обе таблицы слоёв судят «сверху вниз»: берут слой и смотрят его импорты.
  // Слой, которого на диске нет, даёт пустой список — и строка проходит
  // зелёной, продолжая читаться как действующее правило. Найдено пробой на
  // свежей таблице изоляции; у таблицы направлений дыра та же. Имена пакетов
  // (без косой черты) сюда не идут: они и не пути.
  const emptyRules = [];
  const resolves = (q) =>
    !q.includes("/") || (inside(q, null)?.hits ?? []).length > 0;
  for (const [what, rule] of [
    ...rules.map((r) => ["правила направления", r]),
    ...isolation.map((r) => ["правила изоляции", r]),
  ]) {
    if (!resolves(rule.layer))
      emptyRules.push(`${what}: слоя нет на диске — ${rule.layer}`);
    for (const q of [...(rule.banned ?? []), ...(rule.only ?? [])])
      if (!resolves(q))
        emptyRules.push(`${what}: ${rule.layer} → адреса нет на диске — ${q}`);
  }
  // 7d. заявленная таблица найдена и не пуста.
  // Инструмент ищет таблицы ПО ЗАГОЛОВКУ. Заголовок переименовали — разбор даёт
  // ноль строк, а ноль строк печатается как «нарушено: 0», то есть выключение
  // читается как здоровье. Проверено пробой: переименование заголовка разом
  // погасило все правила направления, и прогон остался зелёным. Для нового
  // проекта это главный способ получить базу, «верную по смыслу и немую для
  // инструмента»: заголовок написан своими словами — и сверки нет.
  // Таблицы нет вовсе — ставят `null` в `CONFIG`, как у решений и линта.
  const missingTables = [];
  if (CONFIG.rulesHeading != null && rules.length === 0)
    missingTables.push(
      `таблица не найдена или пуста: «${CONFIG.rulesHeading}» — сверка направлений выключена`,
    );
  if (CONFIG.isolationHeading != null && isolation.length === 0)
    missingTables.push(
      `таблица не найдена или пуста: «${CONFIG.isolationHeading}» — сверка изоляции выключена`,
    );

  console.log("=== Правила про существующее ===");
  console.log(
    `  правил ни о чём: ${emptyRules.length}, заявленных таблиц не найдено: ${missingTables.length}`,
  );
  for (const e of emptyRules) console.log("    " + e);
  for (const m of missingTables) console.log("    " + m);

  for (const kind of markerKinds) {
    console.log(`=== ${kind.title} ===`);
    console.log(
      `  в коде: ${kind.total}, без записи в ${kind.base}: ${kind.unlisted.length}` +
        `, названо записью и снято из кода: ${kind.gone.length}`,
    );
    for (const u of kind.unlisted) console.log("    " + u);
    for (const g of kind.gone) console.log(`    ${kind.base} → ${g}`);
  }

  console.log("=== Якоря ===");
  console.log(
    `  проверено: ${anchors}, из них с цитатой: ${cited}, битых: ${broken.length}`,
  );
  for (const b of broken) console.log("    " + b);
  // 9a. каждый режим инструмента описан в справочнике и назван в правилах.
  // Заведено после пробы: справочник объявляет себя полным («оговорки и ловушки
  // КАЖДОГО режима»), а держать это обещание было нечему — новый режим мог
  // остаться неописанным, и заметить это стало бы некому.
  const undocumented = [];
  {
    const modes = toolModes();
    // Справочник лежит рядом с ИНСТРУМЕНТОМ, а не с базой: это его собственный
    // сосед, и переезд инструмента уводит справочник с собой.
    const manualAt = path.join(TOOL_DIR, TOOL_MANUAL);
    const manual = existsSync(manualAt) ? readFileSync(manualAt, "utf8") : null;
    const implemented = new Set(modes);
    // Вторая половина сверки — «режим назван в файлах правил» — снята вместе с
    // перечнем режимов в правилах. Перечень был вторым списком тех же имён и
    // разошёлся бы со справочником при первом новом режиме. Правила называют
    // инструмент одним указателем, а режимы описаны там, где живут.
    for (const m of [...implemented].sort()) {
      if (
        manual !== null &&
        !new RegExp("^### `" + m + "\\b", "m").test(manual)
      )
        undocumented.push(`нет раздела в справочнике: ${m}`);
    }
    // Обратная сторона: раздел справочника про режим, которого нет. Справочник
    // объявляет себя полным, и такой раздел отправляет читателя вызывать
    // команду, которой не существует, — это хуже отсутствия раздела, потому что
    // ему верят. Найдено пробой: раздел про выдуманный режим прошёл зелёным.
    if (manual !== null)
      for (const hit of manual.matchAll(/^### `([a-z]+)\b/gm))
        if (!implemented.has(hit[1]))
          undocumented.push(`раздел есть, режима нет: ${hit[1]}`);
  }

  // Заголовок называет ПАРЫ, а не инструмент: список давно шире инструмента —
  // в нём справочник, словарь области, набор тестов на него и политика
  // качества. Пока он назывался «Копия инструмента», строка
  // «копия разошлась: …/quality.md» отправляла читателя искать инструмент —
  // ответ не на тот вопрос, тот же класс, что уже записан про «Ничего не
  // нашлось» на живом файле. Найдено пробой: пару завели, заголовок не тронули.

  // 9c. каждое точечное исключение линта объяснено, и каждое объяснение живо.
  const lintDrift = [];
  if (CONFIG.lintExceptions != null) {
    const DIRECTIVE = /^\s*(?:\/\/|\/\*)\s*eslint-disable/;
    const withDirective = new Set();
    for (const f of files) {
      const hit = readFileSync(f, "utf8")
        .split(NEWLINE)
        .some((line) => DIRECTIVE.test(line));
      if (hit) withDirective.add(rel(f));
    }
    const at = path.join(BASE, CONFIG.lintExceptions.table);
    const text = existsSync(at) ? readFileSync(at, "utf8").split(NEWLINE) : [];
    const start = text.findIndex((l) =>
      l.startsWith(CONFIG.lintExceptions.heading),
    );
    // Нет таблицы и нет ни одной директивы — нет и предмета: у нового проекта
    // так и будет, а таблица заводится вместе с первым исключением. Требовать
    // её раньше значит ронять посадку на пустом месте — поймано пересадкой,
    // сразу после того, как сверку завели.
    if (start < 0 && withDirective.size === 0) {
      // предмета нет — расхождений тоже
    } else if (start < 0)
      lintDrift.push(
        `исключения в коде есть (${withDirective.size} файлов), а таблицы, которая их объясняет, нет`,
      );
    else {
      const named = new Set();
      for (let i = start + 2; i < text.length && text[i].startsWith("|"); i++) {
        const cell = text[i].split("|")[1] ?? "";
        for (const tok of quotedIn(cell)) {
          const found = [...withDirective].find(
            (f) => f === tok || f.endsWith("/" + tok),
          );
          named.add(found ?? tok);
        }
      }
      for (const f of withDirective)
        if (!named.has(f)) lintDrift.push(`исключение без объяснения: ${f}`);
      for (const n of named)
        if (!withDirective.has(n))
          lintDrift.push(`объяснение без исключения: ${n}`);
    }
  }

  // 9d. решения и ссылки на них сверяются В ОБЕ СТОРОНЫ.
  // Прямая: решение, на которое не ссылается никто, читают только те, кто уже
  // знает о его существовании. Обратная (ниже по файлу, там, где собран корпус
  // текстов): ссылка на решение, которого нет, — указатель в пустоту, и она
  // достовернее пустого места, потому что обещает записанное решение. Сверка
  // была односторонней и на выдуманном номере молчала — найдено пробой.
  const orphanAdr = [];
  const danglingAdr = [];
  if (CONFIG.adr != null) {
    const dir = norm(path.join(BASE, CONFIG.adr.dir));
    // Нет папки — нет предмета: у нового проекта решений ещё не было, и
    // требовать её значило бы ронять посадку на пустом месте. Поймано
    // пересадкой, ровно как со сверкой исключений линта.
    if (!existsSync(dir)) {
      /* решений пока нет */
    } else {
      const decisions = readdirSync(dir).filter((n) => /\.md$/.test(n));
      // Ссылкой считается номер решения (`ADR-004`) или имя его файла. Сам
      // документ себя не адресует, поэтому из корпуса исключается он один.
      for (const file of decisions) {
        const number = /^(\d+)/.exec(file)?.[1] ?? null;
        const marks = [file.replace(/\.md$/, ""), file];
        if (number !== null) marks.push(`ADR-${number}`, `ADR ${number}`);
        const found = [...files, ...styleFiles, ...docFiles].some((f) => {
          if (norm(f) === norm(path.join(dir, file))) return false;
          const body = readFileSync(f, "utf8");
          return marks.some((m) => body.includes(m));
        });
        if (!found) orphanAdr.push(`на решение не ссылается никто: ${file}`);
      }
    }
  }

  // 9e. каждая константа таблицы настроек названа в её документе.
  const undocumentedConst = [];
  let constantsChecked = 0;
  if (CONFIG.configDocs != null) {
    const dir = norm(path.join(BASE, CONFIG.configDocs.dir));
    const docsDir = norm(path.join(BASE, CONFIG.configDocs.docs));
    // Как и у решений: нет предмета — нет сверки. Новый проект садится на
    // пустое место, и требовать с него таблиц значило бы ронять первый прогон.
    if (existsSync(dir) && existsSync(docsDir)) {
      // Сегменты имени разбирают обе стороны: сокращение в документе значит
      // «то же имя, кроме одного сегмента», и разворачивается только по
      // соседу из ТОЙ ЖЕ строки. Совпадение по одному лишь куску имени
      // засчитывало бы `…SHARE…` за любую константу с таким сегментом.
      const parts = (n) => n.split("_");
      const pairs = (line) => {
        const tokens = [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
        const full = tokens.filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
        const short = tokens
          .filter((t) => t.includes("…"))
          .map((t) => t.replace(/…/g, ""))
          .filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
        return { full, short };
      };
      for (const file of readdirSync(dir).filter((n) => /\.ts$/.test(n))) {
        const code = readFileSync(path.join(dir, file), "utf8");
        const names = [
          ...code.matchAll(/^export const ([A-Z][A-Z0-9_]*)/gm),
        ].map((m) => m[1]);
        if (names.length === 0) continue; // бочка и типы констант не объявляют
        const doc = path.join(docsDir, file.replace(/\.ts$/, ".md"));
        if (!existsSync(doc)) {
          undocumentedConst.push(`таблица без документа: ${file}`);
          continue;
        }
        const lines = readFileSync(doc, "utf8").split(NEWLINE);
        const forms = lines.map(pairs);
        for (const name of names) {
          constantsChecked++;
          if (lines.some((l) => l.includes(name))) continue;
          const own = parts(name);
          const spelled = forms.some(({ full, short }) =>
            short.some((s) =>
              full.some((f) => {
                const other = parts(f);
                if (other.length !== own.length) return false;
                const differ = own.filter((_, i) => own[i] !== other[i]);
                return differ.length === 1 && differ[0] === s;
              }),
            ),
          );
          if (!spelled) undocumentedConst.push(`${file} → ${name}`);
        }
      }
      // Обратная сторона: документ, чья таблица настроек исчезла. Он продолжает
      // описывать константы, которых нет, и читается как действующий — при
      // удалении файла сверка иначе просто замолкает, потому что перебирать
      // становится нечего. Найдено пробой.
      for (const doc of readdirSync(docsDir).filter((n) => /\.md$/.test(n))) {
        const table = path.join(dir, doc.replace(/\.md$/, ".ts"));
        if (!existsSync(table))
          undocumentedConst.push(`документ без таблицы: ${doc}`);
      }
      // Вторая обратная сторона, и она про имя, а не про файл: константа
      // перестала быть настройкой — сняли `export`, переименовали, убрали, — а
      // документ продолжает объяснять её как ручку, которую хост может крутить.
      // Общая сверка имён в тексте это пропускает: она спрашивает, есть ли имя
      // в исполняемом тексте, и `const` без `export` ей подходит. Найдено
      // пробой. Спрашивается принадлежность НАБОРУ настроек, а не своей паре:
      // документ законно ссылается на константу соседнего файла, и требование
      // «имя из своей пары» краснело бы на этом — замерено, такая ссылка есть.
      const settingNames = new Set();
      for (const file of readdirSync(dir).filter((n) => /\.ts$/.test(n)))
        for (const mm of readFileSync(path.join(dir, file), "utf8").matchAll(
          /^export const ([A-Z][A-Z0-9_]*)/gm,
        ))
          settingNames.add(mm[1]);
      for (const doc of readdirSync(docsDir).filter((n) => /\.md$/.test(n))) {
        const lines = readFileSync(path.join(docsDir, doc), "utf8").split(
          NEWLINE,
        );
        for (const [i, line] of lines.entries())
          for (const mm of line.matchAll(/`([^`\n]+)`/g)) {
            const tok = mm[1];
            // Одно слово заглавными — это не имя настройки, а слово в тексте
            // (`DEV`, `CSS`): у настроек имя составное.
            if (!/^[A-Z][A-Z0-9_]*$/.test(tok) || !tok.includes("_")) continue;
            constantsChecked++;
            if (!settingNames.has(tok))
              undocumentedConst.push(
                `${doc}:${i + 1} — ${tok}: документ описывает настройку, которой среди настроек нет`,
              );
          }
      }
    }
  }
  console.log("=== Константы настроек описаны ===");
  console.log(
    `  проверено: ${constantsChecked}, разошлось: ${undocumentedConst.length}`,
  );
  for (const c of undocumentedConst) console.log("    " + c);

  console.log("=== Точечные исключения линта ===");
  console.log(`  расхождений: ${lintDrift.length}`);
  for (const l of lintDrift) console.log("    " + l);

  // 9f. выключения правил в самом конфиге линта — против объявленного списка.
  const offDrift = [];
  if (CONFIG.lintConfigOff != null) {
    const at = path.join(BASE, CONFIG.lintConfigOff.file);
    if (!existsSync(at)) offDrift.push(`конфига линта нет: ${rel0(at)}`);
    else {
      // Конфиг разбирается ТЕКСТОМ, а не импортом: импорт потянул бы за собой
      // все плагины линта — секунды к прогону и падение там, где их ещё не
      // ставили. Блок узнаётся по балансу скобок, область — по строке `files`
      // внутри него; блок без `files` действует на весь репозиторий, и пустая
      // область здесь именно это и означает.
      const found = [];
      let depth = 0;
      let block = null;
      for (const line of readFileSync(at, "utf8").split(NEWLINE)) {
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        if (depth === 0 && opens > 0) block = { files: [], off: [] };
        if (block !== null) {
          const f = /files:\s*\[([^\]]*)\]/.exec(line);
          if (f !== null)
            block.files.push(
              ...[...f[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
            );
          for (const m of line.matchAll(/"([^"]+)"\s*:\s*"off"/g))
            block.off.push(m[1]);
        }
        depth += opens - closes;
        if (depth <= 0 && block !== null) {
          for (const rule of block.off)
            for (const scope of block.files.length ? block.files : ["**"])
              found.push(`${scope} → ${rule}`);
          block = null;
          depth = 0;
        }
      }
      const declared = new Set(
        CONFIG.lintConfigOff.allowed.map(
          ([scope, rule]) => `${scope} → ${rule}`,
        ),
      );
      for (const one of found)
        if (!declared.has(one))
          offDrift.push(`выключено, но не объявлено: ${one}`);
      for (const one of declared)
        if (!found.includes(one))
          offDrift.push(`объявлено, но не выключено: ${one}`);
    }
  }
  console.log("=== Выключения правил линта ===");
  console.log(
    CONFIG.lintConfigOff == null
      ? "  конфиг линта не заявлен"
      : `  расхождений: ${offDrift.length}`,
  );
  for (const o of offDrift) console.log("    " + o);

  console.log("=== Режимы инструмента описаны ===");
  console.log(`  без описания: ${undocumented.length}`);
  for (const u of undocumented) console.log("    " + u);

  // 9b. список разрешений среды не потерял того, что обещает полка
  const settingsDrift = [];
  if (SETTINGS_SHELF !== null) {
    const readListAbs = (at) => {
      if (!existsSync(at)) return null;
      const parsed = JSON.parse(readFileSync(at, "utf8"));
      return parsed?.permissions?.allow ?? [];
    };
    const readList = (relPath) => readListAbs(path.join(BASE, relPath));
    const mine = readList(CONFIG.settingsProject);
    const shelf = readListAbs(SETTINGS_SHELF);
    if (mine === null)
      settingsDrift.push(`нет файла: ${CONFIG.settingsProject}`);
    else if (shelf === null)
      settingsDrift.push(`нет файла: ${rel0(SETTINGS_SHELF)}`);
    else
      for (const entry of shelf)
        if (!mine.includes(entry)) settingsDrift.push(`потеряно: ${entry}`);
  }
  console.log("=== Разрешения среды ===");
  console.log(
    SETTINGS_SHELF === null
      ? "  пара не заявлена"
      : `  из шаблона полки потеряно: ${settingsDrift.length}`,
  );
  for (const s of settingsDrift) console.log("    " + s);

  // 10. якорь на документацию в коде указывает на существующий файл
  // Ссылки собирает общий помощник docRefsIn (см. его шапку).
  const deadAnchors = [];
  let anchorCount = 0;
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    const specs = docRefsIn(body);
    for (const spec of specs) {
      anchorCount++;
      // Якорь пишут относительно файла (`./README.md`), относительно корня
      // компонента (`docs/architecture/x.md`) или корня исходников
      // (`shared/engines/motion/README.md`). Поэтому пробуются все предки.
      let dir = norm(path.dirname(f));
      let found = false;
      while (dir.length >= ROOT.length) {
        if (docFiles.includes(norm(path.join(dir, spec)))) {
          found = true;
          break;
        }
        const up = norm(path.dirname(dir));
        if (up === dir) break;
        dir = up;
      }
      if (found) continue;
      deadAnchors.push(`${rel(f)} → ${spec}`);
    }
  }
  console.log("=== Якоря на документацию в коде ===");
  console.log(
    `  проверено: ${anchorCount}, ведут в никуда: ${deadAnchors.length}`,
  );
  for (const a of deadAnchors) console.log("    " + a);

  // 11. отложенное не превращается в историю
  // Правило написано дважды — в шапке самого файла и в CLAUDE.md — и всё равно
  // нарушается: пометить пункт дешевле, чем удалить. Ловится маркер статуса,
  // а не слово: капсом в любом месте заголовка, либо в его хвосте после тире
  // или в скобках. «Закрыть доступность» — законный открытый пункт, и он не
  // должен ловиться.
  const closedTodos = [];
  if (CONFIG.todo != null) {
    const todoPath = path.join(BASE, CONFIG.todo);
    if (!existsSync(todoPath)) closedTodos.push(`файла нет: ${CONFIG.todo}`);
    else {
      const shouting = /(ЗАКРЫТО|СДЕЛАНО|ГОТОВО|ВЫПОЛНЕНО|DONE|CLOSED)/;
      const trailing = /[—\-(]\s*(закрыт|сделан|готов|выполнен)\S*\s*\)?\s*$/i;
      const struck = /^~~.*~~$/;
      for (const line of readFileSync(todoPath, "utf8").split(NEWLINE)) {
        if (!/^#{2,}\s/.test(line)) continue;
        const title = line.replace(/^#{2,}\s+/, "").trim();
        if (shouting.test(title) || trailing.test(title) || struck.test(title))
          closedTodos.push(`${CONFIG.todo}: ${title}`);
      }
    }
  }
  // 11-тер. Вопросы без ответа: список открытых и форма каждой записи.
  //
  // Наличие вопроса дефектом НЕ является и прогон не роняет — вопрос ждёт
  // человека, а не работы. Роняет другое: пометка «закрыто» вместо удаления и
  // запись без обязательных граф. Вторая половина и есть вся ценность списка:
  // вопрос без последствия отсутствия ответа не даёт решить, срочно это или нет, и висит как
  // шум, пока список не перестают читать целиком.
  const openQuestions = [];
  const malformedQuestions = [];
  // Списков два, и читаются они одинаково: проектный — про этот репозиторий,
  // доктринальный — про саму обвязку, и он едет с ней дальше. Второй не
  // печатался никем, и единственная машинная опора требования «назвать каждый
  // вопрос в отчёте» для него была выключена: вопрос о доктрине жил ровно
  // столько, сколько его помнила сессия.
  const questionLists = [];
  if (CONFIG.questions != null)
    questionLists.push(["проект", path.join(BASE, CONFIG.questions), CONFIG.questions]);
  if (SHELF !== null) {
    const at = shelfAt("work/questions.md");
    if (at !== null && existsSync(at))
      questionLists.push(["доктрина", at, "work/questions.md"]);
  }
  for (const [origin, at, shown] of questionLists) {
    if (!existsSync(at)) {
      malformedQuestions.push(`файла нет: ${shown}`);
    } else {
      const text = readFileSync(at, "utf8");
      const lines = text.split(NEWLINE);
      const heads = [];
      lines.forEach((line, i) => {
        const h = /^##\s+Вопрос\s+(\d+)\.\s*(.+)$/.exec(line);
        if (h !== null) heads.push({ n: h[1], title: h[2].trim(), at: i });
      });
      // Та же сеть, что у отложенного: закрытое удаляют, а не отмечают.
      const shouting = /(ЗАКРЫТО|ОТВЕЧЕНО|CLOSED|ANSWERED)/;
      const trailing = /[—\-(]\s*(закрыт|отвечен)\S*\s*\)?\s*$/i;
      for (const [k, h] of heads.entries()) {
        if (shouting.test(h.title) || trailing.test(h.title)) {
          malformedQuestions.push(`помечен закрытым, а не удалён: ${h.title}`);
          continue;
        }
        const body = lines
          .slice(h.at, k + 1 < heads.length ? heads[k + 1].at : lines.length)
          .join(NEWLINE);
        const missing = [
          ["Задан", /\*\*Задан:\*\*/],
          ["Что решить", /\*\*Что решить\.?\*\*/],
          [
            "Последствие отсутствия ответа",
            /\*\*Последствие отсутствия ответа\.?\*\*/,
          ],
        ]
          .filter(([, re]) => !re.test(body))
          .map(([name]) => name);
        if (missing.length > 0)
          malformedQuestions.push(
            `«${h.title}» — нет граф: ${missing.join(", ")}`,
          );
        openQuestions.push(`[${origin}] Вопрос ${h.n}. ${h.title}`);
      }
    }
  }
  // 11-бис. ссылка на пункт отложенного ведёт в существующий пункт.
  // Закрытый пункт удаляется целиком, следующие сдвигаются — и «пункт 8»
  // остаётся висеть в пяти файлах сразу. Проверяется не нумерация: дыра в ней
  // безвредна, вредна ссылка в никуда. Считается только там, где рядом назван
  // сам файл отложенного или список отложенного по-английски, иначе проверка
  // ловила бы «пункт 3» любого другого перечня и врала бы.
  const danglingTodo = [];
  if (CONFIG.todo != null) {
    const todoPath = path.join(BASE, CONFIG.todo);
    if (existsSync(todoPath)) {
      const numbers = new Set();
      for (const line of readFileSync(todoPath, "utf8").split(NEWLINE)) {
        const head = /^#{2,}\s+(\d+)\./.exec(line);
        if (head !== null) numbers.add(head[1]);
      }
      // Падежи считаются все, а не три. «Сверься с пунктом 4», «закрыто
      // пунктом 3», «из пунктов 2 и 3» — самые естественные формы ссылки, и
      // именно творительный сверка не знала: найдено пробой, ссылка на
      // несуществующий пункт прошла зелёной. Замерено на всей базе и на
      // исходниках: новых попаданий ноль, то есть шума расширение не даёт.
      const REF = /(?:пункт[а-яё]{0,3}|item)\s+(\d+)/gi;
      const NAMES = new RegExp(
        CONFIG.todo.replace(".", "\\.") + "|deferred-work list",
      );
      const scan = [
        ...readdirSync(BASE)
          .filter((n) => n.endsWith(".md") && n !== CONFIG.todo)
          .map((n) => [n, path.join(BASE, n)]),
        ...files.map((f) => [rel(f), f]),
        ...docFiles.map((f) => [rel(f), f]),
      ];
      // Сам файл отложенного сканируется по тем же правилам, но без требования
      // назвать себя по имени: внутри списка «пункт 4» и так значит его
      // собственный пункт. Пропуск найден пробой — а именно здесь ссылки друг
      // на друга и живут, и именно здесь их ломает удаление закрытого пункта.
      scan.push([CONFIG.todo, todoPath]);
      for (const [name, full] of scan) {
        const selfRef = full === todoPath;
        readFileSync(full, "utf8")
          .split(NEWLINE)
          .forEach((line, i) => {
            if (!selfRef && !NAMES.test(line)) return;
            REF.lastIndex = 0;
            let m;
            while ((m = REF.exec(line)) !== null)
              if (!numbers.has(m[1]))
                danglingTodo.push(
                  name + ":" + (i + 1) + " — пункта " + m[1] + " там нет",
                );
          });
      }
    }
  }

  // 12. новый якорь пишется с цитатой
  // Старые не переписываем: их 185, и переписывание ради переписывания —
  // работа без адресата. Но каждый НОВЫЙ обязан нести цитату, иначе доля
  // проверяемых по существу не растёт никогда. Проверяется по строкам,
  // ДОБАВЛЕННЫМ этой правкой: старые записи под правило не попадают, а мимо
  // новой пройти нельзя. Без git сверка молчит и говорит об этом вслух.
  const uncitedNew = [];
  let newAnchorsChecked = true;
  {
    const NEW_ANCHOR = /`([\w./{}-]*):(\d+)(?:-\d+)?`/g;
    let diff = null;
    try {
      const { execSync } = await import("node:child_process");
      diff = execSync("git diff -U0 HEAD -- .context", {
        cwd: REPO,
        encoding: "utf8",
        // stderr гасим: про недоступность git мы говорим сами, а его
        // собственное сообщение — шум в отчёте инструмента.
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      newAnchorsChecked = false;
    }
    if (diff !== null) {
      let file = "";
      for (const line of diff.split(NEWLINE)) {
        if (line.startsWith("+++ b/")) {
          file = line.slice(6);
          continue;
        }
        if (!line.startsWith("+") || line.startsWith("+++")) continue;
        const body = line.slice(1);
        NEW_ANCHOR.lastIndex = 0;
        let m;
        while ((m = NEW_ANCHOR.exec(body)) !== null) {
          // Цитата — бэктик-фрагмент сразу за якорем, на той же строке.
          if (!/^\s*`[^`]+`/.test(body.slice(m.index + m[0].length)))
            uncitedNew.push(`${file}: ${m[0]} — якорь без цитаты`);
        }
      }
    }
  }
  console.log("=== Новые якоря — с цитатой ===");
  console.log(
    newAnchorsChecked
      ? `  добавлено якорей без цитаты: ${uncitedNew.length}`
      : "  git недоступен — не проверено",
  );
  for (const u of uncitedNew) console.log("    " + u);

  // 13. найденное чинится, а не записывается
  // Правило в CLAUDE.md, § «Найденное чинится сразу». Ловятся две формы
  // откладывания — обе объективные, без угадывания намерений:
  //
  //   а) маркер отложенной работы в самом коде (`TODO`, `FIXME`, `HACK`,
  //      `XXX`, `ВРЕМЕННО`, `ПОТОМ`, `ПОЧИНИТЬ`). В этом проекте их ноль, и
  //      это не случайность: находка либо исправлена, либо описана решением;
  //   б) абзац базы знаний, где рядом стоят слово о дефекте и слово об
  //      откладывании, но нет ссылки на файл решений. Два слова в одном
  //      абзаце — намного тише одного: «отложенный тик» и «вынесено в
  //      функцию» встречаются в описаниях сплошь и рядом, а вот «дыра ...
  //      отложена» без решения — ровно то, что правило запрещает.
  //
  // Что проверка НЕ ловит: молчание. Находку, которую просто не записали,
  // машина увидеть не может — это остаётся на ревью и на честности отчёта.
  const parked = [];
  {
    const CODE_MARK =
      /(^|[^A-Za-zА-Яа-я])(TODO|FIXME|HACK|XXX|ВРЕМЕННО|ПОТОМ|ПОЧИНИТЬ)([^A-Za-zА-Яа-я]|$)/;
    for (const f of files) {
      // Полка везёт копии инструмента и правил, где маркеры перечислены как
      // данные: сканер, читающий собственный список, докладывал бы о себе. Это
      // тот же случай, что и с документацией, поэтому и предикат тот же.
      if (isMachinery(f)) continue;
      const body = readFileSync(f, "utf8").split(NEWLINE);
      body.forEach((line, i) => {
        if (CODE_MARK.test(line))
          parked.push(`${rel(f)}:${i + 1} — маркер отложенной работы в коде`);
      });
    }

    const DEFECT =
      /(дыр[аеуы]|баг|ошибк|дефект|сломан|неверн|расходит|не соответств|мёртв|дубл|утечк|bug|defect|broken|wrong|leak)/i;
    // Список намеренно узкий — это обороты, которыми дефект паркуют, а не
    // слова, которыми описывают устройство. Широкий словарь пробовался и был
    // отвергнут замером: «отложенный тик», «не покрыто контрактным тестом»,
    // «расходится молча» — нормальная проза, и на ней сверка давала четыре
    // ложных срабатывания из четырёх. Естественную форму отказа («не делаем»,
    // «остался без теста») ловит не она, а правило про заголовки ниже.
    const DEFER =
      /(не исправл|не почин|не стал[аио]? прав|оставлен[оа]? как есть|выходит за рамки|в задачу не входил|не входит в объ[её]м|вынесен[оа]? разработчику|отложен[оа]? до|записан[оа]? и не|deferred|out of scope|left as is)/i;
    const DECIDED = /09-decisions\.md/;
    const baseDocs = readdirSync(BASE).filter(
      (n) => n.endsWith(".md") && n !== "README.md",
    );

    // Тот же маркер, но в прозе базы и правил. Сеть выше читает только код, и
    // `TODO`, вписанный в запись базы, проходил мимо неё молча — поймано
    // пробой. Описания самих маркеров всегда стоят в обратных кавычках,
    // поэтому код в кавычках вырезается перед поиском: иначе сверка доложила
    // бы о строке, которая её же и описывает.
    //
    // Файл отложенного из этой сети НЕ исключается, хотя из соседней —
    // исключается по существу. Разница в том, что там ловятся книжные обороты
    // («отложено до…»), и в списке согласованных отсрочек они законны, а здесь
    // ловится МАРКЕР — форма, которой помечают работу несделанную и
    // **неоформленную**. Файл отложенного как раз требует оформления: заголовок,
    // риск, статус. `TODO` внутри его пункта — это работа внутри работы, мимо
    // всей этой формы. Найдено пробой: исключение было написано по файлу, а его
    // причина относилась только к одной из двух сетей.
    for (const rp of [
      ...baseDocs.map((n) => path.join(BASE, n)),
      ...CONFIG.rulesManifest.rules.map((r) => path.join(BASE, r)),
    ]) {
      if (!existsSync(rp)) continue;
      const lines = readFileSync(rp, "utf8").split(NEWLINE);
      lines.forEach((line, i) => {
        const bare = line.replace(/`[^`]*`/g, " ");
        if (CODE_MARK.test(bare))
          parked.push(
            `${path.relative(BASE, rp).split(path.sep).join("/")}:${i + 1} — маркер отложенной работы в тексте`,
          );
      });
    }

    for (const name of baseDocs) {
      const p = path.join(BASE, name);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8").split(NEWLINE);
      let start = 0;
      const flush = (end) => {
        // Строки таблицы из абзаца выбрасываются. Таблица без пустых строк —
        // формально один абзац, и словарь ловит в нём слова из РАЗНЫХ строк:
        // «дефект» из одной, «отложено» из другой. Поймано пересадкой полки в
        // пустой проект: скопированная туда таблица сверок роняла прогон,
        // ничего при этом не откладывая. Парковка дефекта — это проза, а не
        // ячейка таблицы.
        const para = text
          .slice(start, end)
          .filter((l) => !l.trimStart().startsWith("|"))
          .join(" ");
        if (DEFECT.test(para) && DEFER.test(para) && !DECIDED.test(para))
          parked.push(
            `${name}:${start + 1} — дефект отложен без записи решения`,
          );
      };
      text.forEach((line, i) => {
        if (line.trim() !== "") return;
        flush(i);
        start = i + 1;
      });
      flush(text.length);

      // Раздел, чей заголовок сам объявляет «этого мы не сделали», — и есть
      // штатное место парковки. Здесь словарь не нужен: место названо, и
      // каждый его абзац обязан назвать решение, по которому работа не
      // делается. Заголовки и таблицы пропускаются — решение пишется прозой.
      // Заголовок про НЕСДЕЛАННУЮ РАБОТУ, а не про методику измерения:
      // «Что тестами не покрыто» — раздел о том, как считается покрытие, и
      // ссылки на решение там не место. Проверено замером: широкий вариант
      // ловил его пять раз подряд.
      // Два стема требуют оборота, а не корня, и это замер, а не вкус.
      // `отказ` в русском равно значит «отказались делать» и «отказ
      // устройства», `не дела` — «не делаем» и «не делает». Несделанную
      // работу объявляет только первое значение каждой пары, и несёт его
      // оборот: «отказ ОТ», «не делаЕМ». Проверено на шести законных
      // заголовках против семи объявляющих: широкие стемы давали пять ложных
      // из шести, узкие — ноль при тех же пойманных.
      const UNDONE =
        /^#{2,6}\s+.*(не сделан|не закрыт|не дела(ем|ли|ть|ла|ло|л)(?![а-я])|оставлен как есть|отказ[а-я]*\s+от|отказались|not done|left undone)/i;
      let inUndone = false;
      let level = 0;
      let block = [];
      let blockAt = 0;
      const flushBlock = () => {
        const body = block.join(" ").trim();
        block = [];
        if (!inUndone || body === "" || DECIDED.test(body)) return;
        parked.push(
          `${name}:${blockAt} — раздел «не сделано» без ссылки на решение`,
        );
      };
      text.forEach((line, i) => {
        const heading = /^(#{2,6})\s/.exec(line);
        if (heading) {
          flushBlock();
          const depth = heading[1].length;
          if (inUndone && depth <= level) inUndone = false;
          if (UNDONE.test(line)) {
            inUndone = true;
            level = depth;
          }
          return;
        }
        // Пустая строка, строка таблицы и разделитель абзацем не являются:
        // решение пишется прозой, а `---` сам по себе ничего не утверждает.
        if (
          line.trim() === "" ||
          line.trimStart().startsWith("|") ||
          /^\s*([-*_])\1{2,}\s*$/.test(line)
        ) {
          flushBlock();
          return;
        }
        if (block.length === 0) blockAt = i + 1;
        block.push(line);
      });
      flushBlock();
    }
  }
  console.log("=== Найденное — исправлено, а не отложено ===");
  console.log(`  отложенного без решения: ${parked.length}`);
  for (const p of parked) console.log("    " + p);


  // 13b. Каждый раздел правил проекта КЛАССИФИЦИРОВАН: либо назван его адрес
  // на полке, либо он помечен проектным. Сверять заголовки проекта с
  // заголовками шаблона напрямую нельзя — шаблон обобщённый, у проекта законно
  // есть свои разделы, и прямой диф шумел бы. А вот «раздел появился и никто
  // не решил, едет он на полку или нет» — ровно тот дрейф, из-за которого полка
  // однажды увезла в следующий проект не все правила.
  const unclassified = [];
  const unfilledTemplate = [];
  const danglingRefs = [];
  // Исключение существует, чтобы гасить конкретное ложное срабатывание. Если
  // оно не погасило НИЧЕГО, предмета больше нет, а запись осталась — и читается
  // как нужная, при этом молча гася то, что однажды сломается по-настоящему.
  // Найдено пробой: одно исключение сверки адресов было недостижимо в принципе,
  // и стояло оно с пометкой «удалять нельзя». Списков таких три — адреса,
  // ссылки на разделы и разрешённые связи в правилах направления, — и считаются
  // они одной секцией: заведи четвёртый, и вопрос «а он живой?» задастся сам.
  const deadExceptions = [...deadRuleAllowances];
  if (CONFIG.rulesManifest != null) {
    // Таблица классификации разделов необязательна, и это следствие
    // раскладки: в файле правил проекта лежит ТОЛЬКО проектное, доктрина —
    // отдельными файлами рядом. Классифицировать стало нечего, вопрос «этот
    // раздел едет на полку?» задаётся не здесь, а тем, куда человек кладёт
    // текст. Таблица объявлена — сверяется по-прежнему.
    const tableAt =
      CONFIG.rulesManifest.table == null
        ? null
        : path.join(BASE, CONFIG.rulesManifest.table);
    // Заголовки собираются со ВСЕХ заявленных файлов правил: разложенные по
    // папкам, они остаются одним корпусом, и сверять их надо как один.
    // Обратная сторона: файл правил, лежащий на диске и НЕ объявленный.
    // Прямая ловит «объявлен, а файла нет» — это значит правила потеряли.
    // Без обратной проходило противоположное и худшее: вложенный `CLAUDE.md`
    // действует в своей папке, грузится сам, а обвязка о нём не знает вовсе —
    // его разделы не классифицированы, на полку он не поедет, и заметить это
    // некому. Найдено пробой.
    //
    // Исключения для полки здесь НЕТ, и оно не нужно: её заготовка называется
    // иначе (`CLAUDE.template.md`), под имя не подпадает, а настоящий
    // `CLAUDE.md`, положенный в полку, был бы ошибкой — на нём краснеть верно.
    // Сказано прямо, потому что первая редакция комментария объявляла
    // исключение, которого в коде не было: запись про несуществующий механизм
    // опаснее её отсутствия, следующий заход на неё обопрётся.
    {
      const declared = new Set(
        CONFIG.rulesManifest.rules.map((r) => norm(path.join(BASE, r))),
      );
      const skipDirs = new Set([
        "node_modules",
        ".stryker-tmp",
        "dist",
        "coverage",
        ".git",
      ]);
      (function walkRules(dir) {
        for (const e of readdirSync(dir)) {
          if (skipDirs.has(e)) continue;
          const full = norm(path.join(dir, e));
          if (statSync(full).isDirectory()) walkRules(full);
          else if (e === "CLAUDE.md" && !declared.has(full))
            unclassified.push(
              `файл правил не объявлен в манифесте: ${rel(full)}`,
            );
        }
      })(norm(REPO));
    }
    const heads = [];
    for (const one of CONFIG.rulesManifest.rules) {
      const at = path.join(BASE, one);
      if (!existsSync(at)) {
        unclassified.push(`нет файла правил: ${one}`);
        continue;
      }
      for (const line of readFileSync(at, "utf8").split(NEWLINE))
        if (line.startsWith("## ")) heads.push(line.slice(3).trim());
    }
    if (tableAt === null) {
      // классификация не заявлена — сверять нечего
    } else if (!existsSync(tableAt))
      unclassified.push(`нет файла таблицы: ${CONFIG.rulesManifest.table}`);
    else {
      const lines = readFileSync(tableAt, "utf8").split(NEWLINE);
      const at = lines.findIndex(
        (l) => l.trim() === CONFIG.rulesManifest.heading.trim(),
      );
      const listed = [];
      if (at < 0) unclassified.push("таблицу разделов не нашли");
      else
        for (let i = at + 2; i < lines.length; i += 1) {
          if (!lines[i].trimStart().startsWith("|")) break;
          listed.push(lines[i].split("|")[1].trim().replace(/`/g, ""));
        }
      for (const h of heads)
        if (!listed.includes(h)) unclassified.push(`не классифицирован: ${h}`);
      for (const l of listed)
        if (!heads.includes(l)) unclassified.push(`раздела больше нет: ${l}`);
    }

    // 13b-1. Незаполненный шаблон правил. Правила приезжают заготовкой, где
    // проектное размечено местами под заполнение, и заполняет их человек. Не
    // заполнил — проект встаёт с доктриной без проектной половины: чем он
    // является, где его слои, что публичная поверхность, чем проверяется. Это
    // ровно то, ради чего правила и существуют в конкретном проекте, а прогон
    // при этом зелёный: сверка разделов спрашивает, есть ли у раздела строка в
    // таблице, а не написан ли он.
    //
    // Форма подстановки — угловые скобки с ЗАГЛАВНОЙ кириллицей либо многоточие.
    // Уже, чем «любые угловые скобки», и намеренно: замерено, что в живых
    // правилах законно стоят `<Carousel>`, `<Diagnostic />` и десяток `<путь>` —
    // на них сверка кричала бы. Латиница исключена по той же причине: в базе
    // законно стоит `<T>`, параметр обобщённого типа. Замер по всему
    // репозиторию дал попадания только в самой заготовке и в цитатах инструкции
    // посадки, то есть ложных срабатываний нет по построению.
    // Корпус шире файлов правил, и это починка класса. Сверка смотрела только
    // в них, а заготовки приезжают и в конфиги, и в файлы базы: после посадки в
    // пустой проект места под заполнение остались в конфиге линтера и в списке
    // исключений форматтера, и не увидел их никто. Список засеянного объявлен в
    // настройке — чего в нём нет, о том и не спросят.
    for (const one of [
      ...CONFIG.rulesManifest.rules,
      ...(CONFIG.seeded ?? []),
    ]) {
      const at = path.join(BASE, one);
      if (!existsSync(at)) continue;
      const body = readFileSync(at, "utf8");
      const left = body.match(/<(?:[А-ЯЁ][А-ЯЁ ]*|\.\.\.)>/g);
      if (left !== null)
        unfilledTemplate.push(`${one}: ${[...new Set(left)].join(", ")}`);
      // Вторая форма, и без неё первая была слепа на самом объёмном: подсказки
      // заготовки написаны прозой в угловых скобках на несколько строк
      // («<Слои и их назначение…>»), и предикат «целиком заглавные» их не берёт.
      // Признак — открывающая скобка в начале строки: замерено, что в живых
      // файлах правил таких строк ноль, а в заготовке их семь.
      const prose = body.split(NEWLINE).filter((l) => l.startsWith("<")).length;
      if (prose > 0)
        unfilledTemplate.push(`${one}: подсказок заготовки прозой: ${prose}`);
    }

    // 13b-2. Ссылка на раздел по названию обязана разрешаться.
    // Позиционная ссылка («правило выше») переезда файла не переживает и
    // проверке не поддаётся — поэтому при выносе раздела такие переписывают в
    // именные, а именные держит эта сверка. Заголовки берутся и из правил, и
    // из базы: база ссылается на разделы правил, правила — на разделы базы.
    // Корпус — это правила проекта, база И полка: правила ссылаются на разделы
    // базы, база на разделы правил, а шаблон полки — на разделы `quality.md`,
    // который в новом проекте станет соседом скопированного `CLAUDE.md`.
    const allHeads = new Set(heads);
    const shelfAt = SHELF;
    // База обходится ВГЛУБЬ: доктрина, скопированная из донора, живёт её
    // подпапкой, и на её разделы ссылается `CLAUDE.md`. Плоский обход находил
    // только верхний уровень — и живая ссылка на «Эталонный узел» читалась как
    // висячая у проекта, посаженного из донора. Найдено пробой.
    const mdUnder = (dir) => {
      if (!existsSync(dir)) return [];
      const out = [];
      for (const e of readdirSync(dir)) {
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) out.push(...mdUnder(full));
        else if (e.endsWith(".md")) out.push(full);
      }
      return out;
    };
    const headSources = [
      ...mdUnder(BASE),
      ...(shelfAt === null ? [] : mdUnder(shelfAt)),
    ];
    for (const at of headSources)
      for (const line of readFileSync(at, "utf8").split(NEWLINE))
        if (/^#{2,}\s/.test(line))
          allHeads.add(line.replace(/^#+\s*/, "").trim());
    // Скиллы — тот же корпус, что правила: их читают и по ним действуют, а
    // именная ссылка внутри скилла не проверялась ничем. Найдено пробой:
    // ссылка на несуществующий раздел прошла зелёной. Класс уже записан у
    // ссылок markdown — сверка сужена по ИСТОЧНИКУ, хотя причина её про ЦЕЛЬ.
    // Заголовки скиллов идут в тот же набор: скилл ссылается прежде всего на
    // собственный раздел, и без них сверка краснела бы на законном.
    const skillFiles =
      CONFIG.skills == null
        ? []
        : (() => {
            const dir = path.join(BASE, CONFIG.skills.dir);
            if (!existsSync(dir)) return [];
            return readdirSync(dir)
              .map((n) => path.join(dir, n, "SKILL.md"))
              .filter((at) => existsSync(at));
          })();
    for (const at of skillFiles)
      for (const line of readFileSync(at, "utf8").split(NEWLINE))
        if (/^#{2,}\s/.test(line))
          allHeads.add(line.replace(/^#+\s*/, "").trim());
    const skip = new Set(CONFIG.rulesManifest.refExceptions);
    const skipUsed = new Set();
    const REF_RE = /(?:раздел[ае]?|§)\s+«([^»]+)»/g;
    // Корпус ссылок — правила, вся база вглубь и **документация**. Последняя
    // сюда не входила, и ссылка на несуществующий раздел из документа проходила
    // молча: у документов таких ссылок как раз больше всего — они отсылают друг
    // к другу и к разделам правил. Найдено пробой; заголовки для сверки берутся
    // из того же корпуса, поэтому ссылка «документ → документ» тоже разрешается.
    const sources = [
      ...CONFIG.rulesManifest.rules
        .map((one) => [one, path.join(BASE, one)])
        .filter(([, at]) => existsSync(at)),
      ...mdUnder(BASE).map((at) => [path.basename(at), at]),
      ...docFiles.map((at) => [rel(at), at]),
      // Скилл лежит вне `src`, и общий `rel` его не укорачивает — адрес печатался
      // бы абсолютным, в отличие от соседей по списку. Считается от корня
      // репозитория, как в остальных режимах.
      ...skillFiles.map((at) => [
        norm(path.relative(path.join(BASE, ".."), at)),
        at,
      ]),
    ];
    for (const at of docFiles)
      for (const line of readFileSync(at, "utf8").split(NEWLINE))
        if (/^#{2,}\s/.test(line))
          allHeads.add(line.replace(/^#+\s*/, "").trim());
    for (const [name, at] of sources) {
      const body = readFileSync(at, "utf8");
      REF_RE.lastIndex = 0;
      let m;
      while ((m = REF_RE.exec(body)) !== null) {
        // Ссылка нередко разорвана переносом строки: сравнивать надо смысл, а
        // не вёрстку, иначе живой заголовок читается как висячий.
        const title = m[1].replace(/\s+/g, " ").trim();
        if (skip.has(title)) {
          skipUsed.add(title);
          continue;
        }
        // Ссылка на раздел ЧУЖОГО свода — глобальных правил, живущих вне
        // репозитория. Их инструмент не читает и потому не вправе утверждать,
        // что раздела нет. Признак берётся из той же фразы: она сама называет,
        // куда отсылает.
        const around = body.slice(Math.max(0, m.index - 120), m.index);
        // `\w` в JS — это латиница: на кириллице такой предикат молча не
        // срабатывает, и первая версия этой проверки именно так и промолчала.
        if (/глобальн[а-яё]*\s+правил/i.test(around)) continue;
        // Заголовок могли назвать началом: «раздел «Планка качества»» против
        // «## Планка качества — сверяется, а не подразумевается».
        const found = [...allHeads].some(
          (h) => h === title || h.startsWith(title),
        );
        if (!found) danglingRefs.push(`${name}: «${title}»`);
      }
    }
    for (const one of skip)
      if (!skipUsed.has(one))
        deadExceptions.push(`ссылки на разделы: «${one}» — ничего не гасит`);
  }
  console.log("=== Ссылки на разделы ===");
  console.log(
    CONFIG.rulesManifest == null
      ? "  реестр правил не заявлен"
      : `  именных ссылок ведут в никуда: ${danglingRefs.length}`,
  );
  for (const d of danglingRefs) console.log("    " + d);
  // 13c. Скиллы проекта: объявлены, лежат на месте, совпадают с полкой.
  const skillDrift = [];
  if (CONFIG.skills != null) {
    const dir = path.join(BASE, CONFIG.skills.dir);
    const onDisk = existsSync(dir)
      ? readdirSync(dir).filter((n) =>
          existsSync(path.join(dir, n, "SKILL.md")),
        )
      : [];
    const tableAt = path.join(BASE, CONFIG.skills.table);
    const listed = new Map();
    if (!existsSync(tableAt))
      skillDrift.push(`нет файла таблицы: ${CONFIG.skills.table}`);
    else {
      const lines = readFileSync(tableAt, "utf8").split(NEWLINE);
      const at = lines.findIndex(
        (l) => l.trim() === CONFIG.skills.heading.trim(),
      );
      if (at < 0) skillDrift.push("таблицу скиллов не нашли");
      else
        for (let i = at + 2; i < lines.length; i += 1) {
          if (!lines[i].trimStart().startsWith("|")) break;
          const cells = lines[i].split("|");
          listed.set(
            cells[1].trim().replace(/`/g, ""),
            cells[2].trim().replace(/`/g, ""),
          );
        }
    }
    for (const name of onDisk)
      if (!listed.has(name)) skillDrift.push(`не объявлен в таблице: ${name}`);
    // Шапка скилла — то, чем он объявляет себя окружению: имя, по которому его
    // зовут, и признак, делающий его вызываемым по `/`. Сверялись папка и
    // таблица, а шапка — нет: `name`, разошедшийся с папкой, проходил зелёным в
    // обеих копиях сразу, и объявление становилось ложным молча. Найдено пробой.
    for (const name of onDisk) {
      const head = readFileSync(path.join(dir, name, "SKILL.md"), "utf8")
        .split(NEWLINE)
        .slice(0, 12);
      const declared = head
        .map((l) => /^name:\s*(\S+)\s*$/.exec(l)?.[1])
        .find((one) => one !== undefined);
      if (declared === undefined) skillDrift.push(`в шапке нет имени: ${name}`);
      else if (declared !== name)
        skillDrift.push(
          `имя в шапке не совпадает с папкой: ${name} ≠ ${declared}`,
        );
      if (!head.some((l) => /^user-invocable:\s*true\s*$/.test(l)))
        skillDrift.push(`не вызываем по имени: ${name}`);
    }
    for (const [name, template] of listed) {
      if (!onDisk.includes(name)) {
        skillDrift.push(`объявлен, но файла нет: ${name}`);
        continue;
      }
      // Побайтовой пары у скилла больше нет: он существует в одном
      // экземпляре, в папке обвязки, и сверять его не с чем. Вторая графа
      // таблицы называет его адрес там же — она отвечает на вопрос «где
      // лежит оригинал», а не служит опорой сверки.
    }
    // Памятка по скиллам — против состава, в обе стороны. Спрашивается только
    // когда скиллы уже есть: на пустой папке памятке нечего описывать, и
    // требовать её значило бы ронять первый прогон после посадки.
    if (CONFIG.skills.memo != null && onDisk.length > 0) {
      const memoAt = path.join(dir, CONFIG.skills.memo);
      if (!existsSync(memoAt))
        skillDrift.push(`нет памятки по скиллам: ${CONFIG.skills.memo}`);
      else {
        const lines = readFileSync(memoAt, "utf8").split(NEWLINE);
        const at = lines.findIndex(
          (l) => l.trim() === CONFIG.skills.memoHeading.trim(),
        );
        if (at < 0) skillDrift.push("в памятке не нашли таблицу скиллов");
        else {
          const inMemo = new Set();
          for (let i = at + 2; i < lines.length; i += 1) {
            if (!lines[i].trimStart().startsWith("|")) break;
            inMemo.add(lines[i].split("|")[1].trim().replace(/`/g, ""));
          }
          for (const name of onDisk)
            if (!inMemo.has(name))
              skillDrift.push(`нет строки в памятке: ${name}`);
          for (const name of inMemo)
            if (!onDisk.includes(name))
              skillDrift.push(
                `памятка описывает несуществующий скилл: ${name}`,
              );
        }
      }
    }
  }
  // 13d. сверка выключена, а предмет уже есть.
  // Поля `CONFIG` необязательны намеренно: у нового проекта ещё нет ни решений,
  // ни таблиц настроек, ни исключений линта, и требовать их значило бы ронять
  // первый же прогон после посадки. Но включать их обратно было нечему: предмет
  // появлялся, а поле оставалось `null` — и сверка молчала ровно там, где стала
  // нужна. Проверено пробой: с полями «как после посадки» четыре сверки из пяти
  // проходят зелёными на живом проекте. Здесь предмет ищется на диске без
  // подсказки конфига, поэтому соврать нечем: он либо есть, либо нет.
  const disarmed = [];
  const dirsUnder = (root, name) => {
    const found = [];
    if (!existsSync(root)) return found;
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = norm(path.join(dir, entry));
        if (!statSync(full).isDirectory()) continue;
        if (entry === name) found.push(full);
        walk(full);
      }
    })(norm(root));
    return found;
  };
  if (CONFIG.adr == null) {
    const found = dirsUnder(ROOT, "adr").filter((d) =>
      readdirSync(d).some((n) => /^\d+.*\.md$/.test(n)),
    );
    if (found.length)
      disarmed.push(
        "решения уже есть (" + rel(found[0]) + "), а CONFIG.adr пуст",
      );
  }
  if (CONFIG.configDocs == null) {
    const found = dirsUnder(ROOT, "config").filter((d) =>
      readdirSync(d).some(
        (n) =>
          /\.md$/.test(n) ||
          (/\.ts$/.test(n) &&
            /^export const [A-Z][A-Z0-9_]*/m.test(
              readFileSync(path.join(d, n), "utf8"),
            )),
      ),
    );
    if (found.length)
      disarmed.push(
        "таблицы настроек уже есть (" +
          rel(found[0]) +
          "), а CONFIG.configDocs пуст",
      );
  }
  if (CONFIG.lintConfigOff == null) {
    const at = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"]
      .map((n) => path.join(BASE, "..", n))
      .find((f) => existsSync(f) && /:\s*"off"/.test(readFileSync(f, "utf8")));
    if (at !== undefined)
      disarmed.push(
        "правила линта уже выключаются в конфиге, а CONFIG.lintConfigOff пуст",
      );
  }
  if (CONFIG.skills == null) {
    const at = path.join(BASE, "../.claude/skills");
    if (existsSync(at) && readdirSync(at).length)
      disarmed.push("скиллы уже есть, а CONFIG.skills пуст");
  }
  // Два поля, добавленных вместе со своими сверками. Без этих двух строк они
  // ведут себя по-разному, и хуже то, которое молчит: незаявленная копия
  // доктрины краснеет сама, на первом же адресе внутри неё, а незаявленный
  // список вопросов и незаявленный порядок чтения печатают «не заявлено» и
  // проходят зелёными — то есть посадочное умолчание переживает появление
  // предмета ровно так, как здесь уже случалось с тремя полями выше.
  if (
    CONFIG.questions == null &&
    existsSync(path.join(BASE, "13-questions.md"))
  )
    disarmed.push("список вопросов уже есть, а CONFIG.questions пуст");
  if (CONFIG.doctrineReading == null && SHELF !== null)
    disarmed.push("полка есть, а CONFIG.doctrineReading пуст");
  // 13e. Сверка состава критериев снята намеренно, а не потеряна: её место
  // занял побайтовый двойник доктрины (`rules/quality.md` в парах выше).
  // Состав сличал перечень имён и молчал о формулировках — полка могла увезти
  // другой текст под теми же именами. Байты этого не позволяют, и заодно
  // отпадает нужда держать список критериев в двух редакциях.
  // 13e-бис. Применимость разделов политики качества: объявление против
  // предмета. Предикаты написаны для ЛЮБОГО проекта, а не под этот: замер на
  // одном репозитории заполняет таблицу, но не сужает признак — иначе в
  // следующем проекте предмет появится, а сверка промолчит.
  const scopeDrift = [];
  const liveScopes = [];
  if (CONFIG.qualityScope != null) {
    const policyAt = path.join(BASE, CONFIG.qualityScope.policy);
    const tableAt = path.join(BASE, CONFIG.qualityScope.table);
    if (!existsSync(policyAt)) scopeDrift.push("политики нет");
    else if (!existsSync(tableAt)) scopeDrift.push("файла таблицы нет");
    else {
      const sections = new Map();
      for (const line of readFileSync(policyAt, "utf8").split(NEWLINE)) {
        const h = /^## ([K-U])\.\s+(.+)$/.exec(line);
        if (h !== null) sections.set(h[1], h[2].trim());
      }
      // Предмет ищется в исполняемом тексте прод-кода: `fetch` в комментарии и
      // адрес пространства имён в разметке значка предметом не являются, и на
      // них сверка кричала бы — а крикливой проверке перестают верить (J4).
      const code = files.filter((f) => !isMachinery(f) && !isTestPath(f));
      const hasCode = (re) =>
        code.some((f) =>
          readFileSync(f, "utf8")
            .split(NEWLINE)
            .some((line) => {
              const m = re.exec(line);
              return m !== null && !inComment(line, m.index);
            }),
        );
      const manifest = path.join(BASE, "..", "package.json");
      const pkg = existsSync(manifest)
        ? JSON.parse(readFileSync(manifest, "utf8"))
        : {};
      const script = (n) => (pkg.scripts ?? {})[n] !== undefined;
      const deps = Object.keys({
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      });
      const dep = (re) => deps.some((d) => re.test(d));
      // Признак ищется двумя сетями: по коду и по зависимостям. Вторая нужна
      // потому, что предмет чаще всего приезжает библиотекой, а её имя известно
      // заранее там, где выбор невелик: клиент запросов, обёртка хранилища,
      // движок движения, набор локализации. Список закрытый и назван поимённо —
      // угадывать он не пытается, а известное закрывает.
      const hasMarkup = () => code.some((f) => /\.(tsx|jsx)$/.test(f));
      const probe = {
        K: () =>
          hasCode(
            /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|document\.cookie|URLSearchParams|useSearchParams|location\.(search|hash)|import\.meta\.env\.(?!DEV\b|PROD\b|MODE\b)|process\.env/,
          ) ||
          dep(
            /^(axios|ky|got|superagent|node-fetch|swr|@tanstack\/|idb|dexie|localforage|js-cookie|dotenv)/i,
          ),
        L: () =>
          hasCode(
            /\basync\s|\bawait\s|new Promise|setTimeout\(|setInterval\(|queueMicrotask\(|AbortController|requestAnimationFrame\(|requestIdleCallback\(/,
          ),
        M: hasMarkup,
        N: () =>
          hasCode(
            /requestAnimationFrame\(|\.animate\(|pointerdown|pointermove|touchstart|@keyframes|transition:/,
          ) ||
          dep(
            /^(framer-motion|motion|gsap|react-spring|@react-spring|popmotion|anime|lottie)/i,
          ),
        O: () =>
          styleFiles.length > 0 ||
          dep(
            /^(styled-components|@emotion|tailwindcss|stitches|vanilla-extract)/i,
          ),
        P: hasMarkup,
        // Адрес пространства имён — не внешний адрес: он не загружается и никуда
        // не ведёт. Исключение общее, а не про этот проект.
        Q: () =>
          hasCode(
            /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|\beval\(|new Function\(|document\.write|https?:\/\/(?!www\.w3\.org)/,
          ) || dep(/^(dompurify|sanitize-html|xss|marked|markdown-it|helmet)/i),
        R: () =>
          script("build") ||
          dep(/^(vite|webpack|rollup|esbuild|parcel|@rsbuild|turbopack)/i),
        S: () =>
          script("deploy") ||
          script("start") ||
          dep(
            /^(@sentry|@opentelemetry|pino|winston|loglevel|bugsnag|rollbar|web-vitals)/i,
          ),
        T: () =>
          hasCode(/\bIntl\.[A-Z]/) ||
          dep(/(i18n|intl|locale|globalize|lingui|polyglot)/i),
        U: () =>
          [
            ".github/workflows",
            ".gitlab-ci.yml",
            ".circleci",
            ".drone.yml",
            "azure-pipelines.yml",
            "Jenkinsfile",
            "bitbucket-pipelines.yml",
            ".woodpecker.yml",
          ].some((p) => existsSync(path.join(BASE, "..", p))),
      };
      const declared = qualityScopeDeclared();
      if (declared === null) scopeDrift.push("таблицу применимости не нашли");
      else {
        for (const [id, title] of sections)
          if (!declared.has(id))
            scopeDrift.push(`раздел не объявлен: ${id}. ${title}`);
        for (const id of declared.keys())
          if (!sections.has(id))
            scopeDrift.push(`объявлен раздел, которого нет в политике: ${id}`);
        for (const [id, d] of declared) {
          if (!sections.has(id)) continue;
          if (d.live) {
            liveScopes.push(id);
            continue;
          }
          if (d.why === "") scopeDrift.push(`неприменим без причины: ${id}`);
          if (probe[id] !== undefined && probe[id]())
            scopeDrift.push(
              `объявлен неприменимым, а предмет на диске есть: ${id}`,
            );
        }
      }
    }
  }
  // 13f. каждый документ назван в указателе.
  const indexDrift = [];
  if (CONFIG.docsIndex != null) {
    const dir = norm(path.join(BASE, CONFIG.docsIndex.dir));
    const table = path.join(BASE, CONFIG.docsIndex.table);
    if (existsSync(dir) && existsSync(table)) {
      const text = readFileSync(table, "utf8");
      if (!text.includes(CONFIG.docsIndex.heading))
        indexDrift.push(`таблицы указателя нет: «${CONFIG.docsIndex.heading}»`);
      else
        for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")))
          if (!text.includes(name))
            indexDrift.push(`документа нет в указателе: ${name}`);
    }
  }
  // 13g. версия среды против объявленного диапазона — ПРЕДУПРЕЖДЕНИЕ.
  //
  // Три свойства, и все три решены разработчиком:
  //
  // 1. Прогона не роняет. Запрет стоил бы дороже пользы (см. `CONFIG.manifest`),
  //    а поломка от неподходящей версии приходит громко — инструменты падают, а
  //    не выдают тихо другие числа.
  // 2. **Молчит, когда версия подходит.** Секция, печатающая «всё хорошо»
  //    каждый прогон, — это плата за то, чего в работающем проекте не
  //    происходит. Здесь молчание и означает «в диапазоне»; голос появляется
  //    ровно там, где он нужен: посадка в новый проект, переезд на другую
  //    машину, смена версии.
  // 3. Говорит громко, когда не подходит: разработчик обязан быть предупреждён,
  //    а решать дальше — ему.
  //
  // Разбирается ровно та форма диапазона, которая объявлена в манифесте:
  // нижняя граница `>=` и верхняя `<`. Форма, которой разбор не знает, честно
  // называется неразобранной — иначе предупреждение врало бы уверенным тоном.
  if (CONFIG.manifest != null) {
    const at = path.join(BASE, CONFIG.manifest);
    const want = existsSync(at)
      ? (JSON.parse(readFileSync(at, "utf8")).engines?.node ?? null)
      : null;
    const parts = (v) => v.replace(/^v/, "").split(".").map(Number);
    const cmp = (a, b) => {
      const x = parts(a);
      const y = parts(b);
      for (let i = 0; i < 3; i++)
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    };
    const low =
      want === null ? null : (/(?:^|\s)>=\s*([\d.]+)/.exec(want)?.[1] ?? null);
    const high =
      want === null ? null : (/(?:^|\s)<\s*([\d.]+)/.exec(want)?.[1] ?? null);
    const now = process.version;
    const say =
      want === null
        ? "  диапазон версии не объявлен — переносимость держится на памяти"
        : low === null && high === null
          ? `  диапазон «${want}» записан формой, которой разбор не знает`
          : low !== null && cmp(now, low) < 0
            ? `  версия НИЖЕ объявленной: ${now} при «${want}»`
            : high !== null && cmp(now, high) >= 0
              ? `  версия ВЫШЕ объявленной: ${now} при «${want}»`
              : null;
    if (say !== null) {
      console.log("=== Версия среды (предупреждение, прогон не роняет) ===");
      console.log(say);
      console.log(
        "  Числа базовой линии снимались на объявленной версии; решение, что",
      );
      console.log("  с этим делать, за вами — прогон остановлен не будет.");
    }
  }

  // Инструменты обязательной цепочки: есть ли они вообще.
  // Версия среды отвечает «та ли», а этот вопрос — «есть ли», и он первее:
  // проверять версию линтера, которого нет, бессмысленно. Как и версия,
  // предупреждает и не роняет — набор инструментов у проекта может быть
  // другим. Спрашивается только объявленное в `CONFIG.toolchain`.
  if (CONFIG.toolchain != null && CONFIG.manifest != null) {
    const at = path.join(BASE, CONFIG.manifest);
    const pkg = existsSync(at) ? JSON.parse(readFileSync(at, "utf8")) : null;
    const scripts = pkg?.scripts ?? {};
    const declared = new Set([
      ...Object.keys(pkg?.dependencies ?? {}),
      ...Object.keys(pkg?.devDependencies ?? {}),
    ]);
    const gaps = [];
    for (const link of CONFIG.toolchain) {
      const noScript = link.script != null && scripts[link.script] == null;
      const missing = (link.packages ?? []).filter((p) => !declared.has(p));
      if (!noScript && missing.length === 0) continue;
      const what = [
        noScript ? `команды \`${link.script}\` нет` : null,
        missing.length ? `не объявлены: ${missing.join(", ")}` : null,
      ]
        .filter((x) => x !== null)
        .join("; ");
      gaps.push(
        `  ${link.script ?? "звено"} — ${what}` +
          NEWLINE +
          `      зачем: ${link.why}` +
          NEWLINE +
          (link.template == null
            ? "      настраивается руками: шаблона на полке нет намеренно, конфиг" +
              NEWLINE +
              "      этого звена зависит от вида проекта"
            : `      шаблон настройки на полке: ${link.template}`),
      );
    }
    // Обратная сторона: звено, появившееся в самой цепочке, но не объявленное.
    // Прямая ловит «объявлено, а инструмента нет»; без этой половины список
    // молча отстаёт от цепочки, и на следующей посадке про новое звено просто
    // не спросят. Найдено пробой — сверка была односторонней с рождения.
    const chain = scripts.check ?? null;
    if (chain !== null) {
      const inChain = [
        ...[...chain.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]),
        ...(/(^|&&)\s*npm test\b/.test(chain) ? ["test"] : []),
      ];
      const known = new Set(
        CONFIG.toolchain.map((l) => l.script).filter((s) => s != null),
      );
      for (const link of inChain)
        if (!known.has(link))
          gaps.push(
            `  ${link} — цепочка проверок его зовёт, а в объявлении звеньев его нет` +
              NEWLINE +
              "      значит про его инструмент на посадке не спросят",
          );
    }

    if (gaps.length) {
      console.log(
        "=== Инструменты обвязки (предупреждение, прогон не роняет) ===",
      );
      console.log(
        `  звеньев цепочки без инструмента: ${gaps.length} из ${CONFIG.toolchain.length}`,
      );
      for (const g of gaps) console.log(g);
      console.log(
        "  Поставить и настроить — шаг «Инструменты цепочки» в инструкции посадки",
      );
      console.log(
        "  на полке. Инструмент ставится вместе со своей настройкой, одной правкой:",
      );
      console.log("  поставленный без неё проходит, не проверив ничего.");
    }
  }

  // Обещания без опоры: раздел объявлен — значит собираемо всё, что в нём.
  // Прямая сторона у этой формы уже есть (`open` собирает по слову); здесь
  // обратная: запись, написанная мимо словаря, из сводки выпадает молча.
  const mutePromises = [];
  if (CONFIG.promises != null) {
    const at = path.join(BASE, CONFIG.promises.file);
    if (!existsSync(at))
      mutePromises.push(`файла нет: ${CONFIG.promises.file}`);
    else {
      const lines = readFileSync(at, "utf8").split(NEWLINE);
      const from = lines.findIndex((l) => l.trim() === CONFIG.promises.heading);
      if (from < 0)
        mutePromises.push(
          `раздел объявлен и не найден: «${CONFIG.promises.heading}»`,
        );
      else {
        // Метка графы — вторая половина той же формы, и до пробы её не
        // спрашивал никто. Сверка ниже требовала узнаваемое СЛОВО в значении
        // («вниманием», «ничем»), а сводка собирает записи по самой метке
        // «Держится». Переименуй метку — и запись выпадает из сводки, ровно
        // как при неузнаваемом слове, но уже молча: графы «Держится» тут
        // больше нет, спрашивать не с чего. Замерено подсадкой: сводка дала
        // `10` записей вместо `11`, прогон остался зелёным.
        //
        // Опора — парность формы: у каждой записи раздела две строки,
        // «Держится» и «Сломается», и вторая без первой означает, что метку
        // переписали. Соврать нечем — на живом разделе замерено `11` пар, и
        // «Держится» везде стоит первым, так что ложных срабатываний нет по
        // построению.
        //
        // Ищется именно СИРОТА, а не расхождение списков по позициям. Первый
        // вариант сверял их поштучно и на одной переписанной метке докладывал
        // `11` расхождений вместо одного: сдвиг делал «сломанной» каждую
        // последующую пару. Шум тут дороже пропуска — он учит не читать вывод.
        let pendingHold = null;
        for (let i = from + 1; i < lines.length; i++) {
          if (/^## /.test(lines[i])) break;
          if (/^\s*(\*\*)?Сломается/.test(lines[i])) {
            if (pendingHold === null)
              mutePromises.push(
                `${CONFIG.promises.file}:${i + 1}  «Сломается» без «Держится»` +
                  ` — метку графы переписали, и запись выпала из сводки`,
              );
            pendingHold = null;
            continue;
          }
          if (!/^\s*(\*\*)?Держится/.test(lines[i])) continue;
          // Второй «Держится» подряд — предыдущая запись осталась без
          // «Сломается». Без этой ветки незакрытой замечалась бы только
          // последняя запись раздела: следующая метка молча затирала
          // незакрытую. Найдено пробой по этой же сверке, через ход после
          // того, как её завели.
          if (pendingHold !== null)
            mutePromises.push(
              `${CONFIG.promises.file}:${pendingHold}  «Держится» без` +
                ` «Сломается» — запись не дописана`,
            );
          pendingHold = i + 1;
          if (HELD_BY_NOTHING.test(lines[i])) continue;
          mutePromises.push(
            `${CONFIG.promises.file}:${i + 1}  ${lines[i].trim()}`,
          );
        }
        if (pendingHold !== null)
          mutePromises.push(
            `${CONFIG.promises.file}:${pendingHold}  «Держится» без` +
              ` «Сломается» — запись не дописана`,
          );
      }
    }
  }
  // Объявленные области — существуют ли они на диске.
  //
  // Область смоука и пары форков заданы путями, и путь переживает переезд
  // папки молча: список остаётся прежним, совпадать с ним перестаёт всё. Для
  // смоука это ровно то, чего его конфиг обещал избежать — «по требованию»
  // превращается в «никогда», и заметить это некому, потому что вопрос просто
  // не задаётся. Для форков так же: `twins` перестаёт спрашивать про пару.
  //
  // Соврать сверке нечем: объявленный путь либо есть, либо нет. Это тот же
  // приём, что у правил направления («правило про несуществующий предмет
  // проходит зелёным и читается как действующее»), только про другой список.
  const goneScope = [];
  let scopePaths = 0;
  for (const p of CONFIG.smokeScope ?? []) {
    scopePaths++;
    if (!existsSync(path.join(REPO, p))) goneScope.push(`область смоука: ${p}`);
  }
  for (const { from, to } of CONFIG.forks ?? []) {
    scopePaths += 2;
    if (!existsSync(path.join(ROOT, from)))
      goneScope.push(`пара форков: ${from}`);
    if (!existsSync(path.join(ROOT, to))) goneScope.push(`пара форков: ${to}`);
  }
  console.log("=== Объявленные области существуют ===");
  console.log(`  адресов: ${scopePaths}, ведут в никуда: ${goneScope.length}`);
  for (const g of goneScope) console.log("    " + g);

  console.log("=== Обещания без опоры собираются сводкой ===");
  console.log(`  записей мимо словаря: ${mutePromises.length}`);
  for (const m of mutePromises) console.log("    " + m);

  // 13h. имена связей через DOM и CSS существуют в коде.
  const domDrift = [];
  if (CONFIG.domTables != null) {
    const at = path.join(BASE, CONFIG.domTables.file);
    if (existsSync(at)) {
      const text = readFileSync(at, "utf8").split(NEWLINE);
      // Имя живо, только если стоит в ИСПОЛНЯЕМОМ тексте. Сверка искала его во
      // всём файле разом и потому держалась за собственное эхо: после
      // согласованного переименования достаточно было оставить старое имя в
      // комментарии или в шапке теста — и таблица связей, единственный способ
      // узнать радиус такой правки, продолжала описывать имя, которого в коде
      // нет. Найдено пробой. Тот же класс уже был починен у имён констант и у
      // camelCase-имён, поэтому здесь не заводится третий фильтр, а берётся
      // тот же предикат.
      const liveDomNames = new Set();
      for (const f of [...files, ...styleFiles])
        for (const line of readFileSync(f, "utf8").split(NEWLINE))
          for (const hit of line.matchAll(/--[a-z-]+|data-[a-z-]+/g))
            if (!inComment(line, hit.index)) liveDomNames.add(hit[0]);
      for (const heading of CONFIG.domTables.headings) {
        const from = text.indexOf(heading);
        if (from < 0) {
          domDrift.push(`таблицы нет: «${heading}»`);
          continue;
        }
        for (let i = from + 2; i < text.length && text[i].startsWith("|"); i++)
          for (const hit of text[i]
            .split("|")[1]
            .matchAll(/`(--[a-z-]+|data-[a-z-]+)`/g))
            if (!liveDomNames.has(hit[1]))
              domDrift.push(`названо в таблице, нет в коде: ${hit[1]}`);
      }
    }
  }
  console.log("=== Связи через DOM и CSS ===");
  console.log(
    CONFIG.domTables == null
      ? "  таблицы не заявлены"
      : `  названо и не найдено: ${domDrift.length}`,
  );
  for (const d of domDrift) console.log("    " + d);

  // Инструкция посадки называет каждый файл полки.
  //
  // Побайтовые пары держат НАЛИЧИЕ файла на полке, и только его. Объяснение
  // держалось вниманием — и не удержало: словарь области и его набор приехали
  // на полку парами, а инструкция про них молчала. Посадка по такой инструкции
  // даёт инструмент без файла, который он импортирует первой строкой, то есть
  // не стартующий вовсе; про набор — тише и хуже: он приезжает и не гоняется.
  //
  // Соврать нечем: файл полки либо назван текстом инструкции, либо нет. Ложных
  // срабатываний тоже нет по построению — полка и есть то, что инструкция
  // ставит, и файл, о котором она молчит, приезжает необъяснённым.
  // Пакет объявлен, а его конфиг не положен — цепочка зеленеет, не проверяя
  // ничего. Требование записано в инструкции посадки с критерием выполнения:
  // пакет в манифесте и конфиг на месте. Здесь его машинная половина.
  const toolchainDrift = [];
  if (CONFIG.toolchain != null) {
    const manifestAt = path.join(BASE, "..", "package.json");
    const pkg = existsSync(manifestAt)
      ? JSON.parse(readFileSync(manifestAt, "utf8"))
      : {};
    const deps = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    });
    for (const link of CONFIG.toolchain) {
      if (link.config == null) continue;
      const installed = link.packages.every((p) => deps.includes(p));
      if (!installed) continue;
      const at = path.join(BASE, "..", link.config);
      if (!existsSync(at))
        toolchainDrift.push(
          `${link.script}: пакеты стоят, а конфига нет — ${link.config}`,
        );
    }
  }

  const unexplained = [];
  {
    // Спрашивается только с СЕМЯН. Остальное — доктрина, инструмент, скиллы —
    // переносится папкой целиком, и перечислять его в инструкции незачем:
    // забыть при копировании папки нечего. У семени назначение своё: оно едет
    // в конкретное место проекта под конкретным именем, и это соответствие
    // существует только в тексте инструкции. Прежде сверка спрашивала со всей
    // полки — тогда файлы копировались по одному, и пропущенный оставался в
    // старом месте молча.
    const instructionAt = shelfAt("seat/seat.md");
    const seedsAt = shelfAt("seat/templates");
    if (
      SHELF !== null &&
      instructionAt !== null &&
      existsSync(instructionAt) &&
      seedsAt !== null &&
      existsSync(seedsAt)
    ) {
      const text = readFileSync(instructionAt, "utf8");
      (function walkShelf(dir) {
        for (const entry of readdirSync(dir)) {
          if (OUT_OF_TREE.has(entry)) continue;
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) {
            walkShelf(full);
            continue;
          }
          const rel = path.relative(SHELF, full).split(path.sep).join("/");
          // Сравнение по ПОЛНОМУ пути, а не по имени файла: имя совпадало с
          // чужим упоминанием, и семя считалось объяснённым строкой про
          // одноимённый файл базы. Замер при заведении семян: из тринадцати
          // новых файлов сверка увидела пять.
          if (text.includes(rel)) continue;
          unexplained.push(rel);
        }
      })(seedsAt);
    }
  }
  console.log("=== Инструкция посадки называет всё, что на полке ===");
  console.log(`  файлов полки без объяснения: ${unexplained.length}`);
  for (const u of unexplained) console.log("    " + u);

  // Вторая сторона предыдущей: файл доктрины назван не только в СОСТАВЕ полки,
  // но и в порядке чтения шаблона правил — в списке рядом и в разделе входа.
  //
  // Доктрина определяется по расположению, а не списком в конфиге: файл `.md` в
  // корне полки, кроме инструкции посадки и шаблонов. Список в конфиге был бы
  // третьей копией состава и отстал бы молча — ровно тот дефект, который эта
  // сверка и закрывает.
  //
  // Обе стороны сразу. Прямая: каждый файл доктрины назван в обоих разделах.
  // Обратная: имя вида `что-то.md`, названное этими разделами, на полке
  // существует. Без обратной переименованный файл оставляет в порядке чтения
  // строку про то, чего нет, и она читается как действующая; общая сверка
  // адресов сюда не дотягивается — файлы полки из неё исключены намеренно,
  // они называют то, что в новом проекте ещё предстоит завести.
  const doctrineDrift = [];
  if (CONFIG.doctrineReading != null && SHELF !== null) {
    const at = shelfAt(CONFIG.doctrineReading.template);
    if (at === null || !existsSync(at))
      doctrineDrift.push(
        `шаблона правил нет: ${CONFIG.doctrineReading.template}`,
      );
    else {
      const lines = readFileSync(at, "utf8").split(NEWLINE);
      // Раздел — от объявленного заголовка до следующего заголовка того же
      // уровня. Не найден — расхождение, а не пустой разбор: пустой печатался
      // бы нулём, и выключение читалось бы как здоровье.
      const section = (heading) => {
        const from = lines.findIndex((l) => l.trim() === heading);
        if (from < 0) return null;
        let to = lines.length;
        for (let i = from + 1; i < lines.length; i += 1)
          if (/^##\s/.test(lines[i])) {
            to = i;
            break;
          }
        return lines.slice(from, to).join(NEWLINE);
      };
      const list = section(CONFIG.doctrineReading.listHeading);
      const order = section(CONFIG.doctrineReading.orderHeading);
      if (list === null)
        doctrineDrift.push(
          `раздела нет: ${CONFIG.doctrineReading.listHeading}`,
        );
      if (order === null)
        doctrineDrift.push(
          `раздела нет: ${CONFIG.doctrineReading.orderHeading}`,
        );
      const doctrine = readdirSync(SHELF).filter(
        (n) =>
          n.endsWith(".md") &&
          n !== "README-claude.md" &&
          !n.includes(".template."),
      );
      for (const name of doctrine) {
        if (list !== null && !list.includes(name))
          doctrineDrift.push(`не назван в списке правил: ${name}`);
        if (order !== null && !order.includes(name))
          doctrineDrift.push(`не назван в порядке чтения: ${name}`);
      }
      // Опись обходит полку ВГЛУБЬ: справочник инструмента лежит подпапкой, и
      // плоская опись объявляла его отсутствующим — то есть сверка краснела на
      // живом файле. Найдено при выносе порядка чтения из шаблона правил.
      const known = new Set();
      (function walkKnown(dir) {
        for (const e of readdirSync(dir)) {
          if (OUT_OF_TREE.has(e)) continue;
          const full = path.join(dir, e);
          if (statSync(full).isDirectory()) walkKnown(full);
          else known.add(e);
        }
      })(SHELF);
      for (const [where, text] of [
        ["списке правил", list],
        ["порядке чтения", order],
      ]) {
        if (text === null) continue;
        for (const m of text.matchAll(/`[^`]*?([A-Za-z0-9._-]+\.md)`/g)) {
          // Файлы базы проекта эти разделы называют законно — вход велит
          // открыть карту и факты. Их имена узнаются по форме `NN-`, и
          // спрашивать с них полку значило бы краснеть на законном: на полке
          // их нет и быть не может, они заводятся в проекте при посадке.
          if (/^\d\d-/.test(m[1])) continue;
          // Файл правил проекта — тот же класс: он живёт в проекте, на полке
          // его нет и быть не может, а порядок чтения обязан его называть.
          if (m[1] === "CLAUDE.md") continue;
          if (!known.has(m[1]))
            doctrineDrift.push(`назван в ${where}, но на полке нет: ${m[1]}`);
        }
      }
    }
  }
  console.log("=== Доктрина названа в порядке чтения ===");
  console.log(
    CONFIG.doctrineReading == null || SHELF === null
      ? "  полка не заявлена"
      : `  расхождений: ${doctrineDrift.length}`,
  );
  for (const d of doctrineDrift) console.log("    " + d);

  console.log("=== Документы названы в указателе ===");
  console.log(
    CONFIG.docsIndex == null
      ? "  указатель не заявлен"
      : `  не названо: ${indexDrift.length}`,
  );
  for (const d of indexDrift) console.log("    " + d);

  console.log("=== Применимость разделов планки ===");
  console.log(
    CONFIG.qualityScope == null
      ? "  деление на ядро и применимые не заявлено"
      : `  расхождений: ${scopeDrift.length}` +
          (liveScopes.length
            ? `; живые разделы: ${liveScopes.join(", ")}`
            : ""),
  );
  for (const s of scopeDrift) console.log("    " + s);

  console.log("=== Сверки, выключенные при живом предмете ===");
  console.log(`  выключено зря: ${disarmed.length}`);
  for (const d of disarmed) console.log("    " + d);

  console.log("=== Скиллы проекта ===");
  console.log(
    CONFIG.skills == null
      ? "  скиллы не заявлены"
      : `  расхождений: ${skillDrift.length}`,
  );
  for (const s of skillDrift) console.log("    " + s);

  console.log("=== Разделы правил классифицированы ===");
  console.log(
    CONFIG.rulesManifest == null
      ? "  файлы правил не заявлены"
      : `  расхождений: ${unclassified.length}`,
  );
  for (const u of unclassified) console.log("    " + u);

  console.log("=== Шаблон правил заполнен ===");
  console.log(
    CONFIG.rulesManifest == null
      ? "  файлы правил не заявлены"
      : `  осталось незаполненных мест: ${unfilledTemplate.length}`,
  );
  for (const u of unfilledTemplate) console.log("    " + u);

  console.log("=== Отложенное без закрытых пунктов ===");
  console.log(
    CONFIG.todo == null
      ? "  файл отложенного не заявлен"
      : `  помечено закрытыми: ${closedTodos.length}`,
  );
  for (const t of closedTodos) console.log("    " + t);
  console.log(`  ссылок на несуществующий пункт: ${danglingTodo.length}`);
  for (const t of danglingTodo) console.log("    " + t);

  // 14-16. Три шва, которые до сих пор держались только вниманием.
  // Общий источник для всех трёх: файлы базы (по имени), документация рядом с
  // кодом (путём от `src`), файлы правил и скиллы.
  const skillDocs = () => {
    const root = norm(path.join(BASE, CONFIG.skills.dir));
    if (!existsSync(root)) return [];
    const found = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = norm(path.join(dir, entry));
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".md"))
          found.push([
            path.relative(REPO, full).split(path.sep).join("/"),
            full,
          ]);
      }
    })(root);
    return found;
  };
  // Полка из сверки адресов исключена, и это не послабление, а точность.
  // Её файлы описывают проект, которого ЕЩЁ НЕТ: инструкция посадки называет
  // `.claude/skills/task/SKILL.md`, который заводят на седьмом шаге, а шаблон
  // скилла — файлы базы, заводимые «когда появится содержимое». В этом проекте
  // такие адреса случайно живые, в новом — нет, и первый же `verify` после
  // посадки краснел бы на тексте, приехавшем вместе с правилами. Поймано
  // пересадкой в пустой проект. Полку держит другое: побайтовые копии
  // инструмента, справочника и скилла плюс равенство таблиц сверок.
  const SHELF_ROOT = SHELF === null ? "\u0000нет полки" : norm(SHELF);
  const docSources = [
    // База обходится ВГЛУБЬ. Плоский обход брал только верхний уровень, а база
    // уже вложена: доктрина лежит подпапкой, и политика качества — самый
    // читаемый документ проекта — из сверки выпадала целиком. Битый адрес
    // внутри неё проходил зелёным, при том что в соседнем файле того же
    // каталога ловился. Найдено пробой; тот же класс однажды уже чинили для
    // заголовков, и починили тогда только в одном месте из двух.
    ...(function walkBase(dir) {
      const out = [];
      for (const e of readdirSync(dir)) {
        const full = norm(path.join(dir, e));
        if (statSync(full).isDirectory()) out.push(...walkBase(full));
        else if (e.endsWith(".md"))
          out.push([norm(path.relative(BASE, full)), full]);
      }
      return out;
    })(norm(BASE)),
    ...docFiles.map((d) => [rel(d), d]),
    // Файлы правил сюда не входили, и это ловилось только вниманием: битая
    // ссылка на вложенный `CLAUDE.md` прошла пробу молча. Читают их чаще всего
    // остального, а проверяли — реже: адреса в них живут ровно так же и
    // устаревают ровно так же.
    ...CONFIG.rulesManifest.rules
      .map((r) => norm(path.join(BASE, r)))
      .filter((p) => existsSync(p))
      .map((p) => [path.relative(REPO, p).split(path.sep).join("/"), p]),
    // Скиллы — те же документы с адресами: скилл начала задачи целиком состоит
    // из «прочитай вот это». Умерший адрес в нём отправляет туда каждую сессию,
    // и молча — сверка его не читала.
    ...(CONFIG.skills == null ? [] : skillDocs()),
  ].filter(([, at]) => !at.startsWith(SHELF_ROOT));

  // Скрипты манифеста против прозы — в обе стороны.
  //
  // Правила обещают, что про КАЖДЫЙ скрипт решение принято: он либо в таблице
  // проверок, либо назван в списке тех, что не входят туда намеренно. Держалось
  // обещание счётом, записанным словом («ещё четыре скрипта»), а такой счёт не
  // ловит ничто — правило о числах прямо говорит, что словесный счёт остаётся на
  // внимании. Найдено пробой: скриптов этого рода пять, и `format` не был назван
  // нигде — ни в таблице, ни в исключениях, ни в разрешениях среды.
  //
  // Обратная сторона ловит другое: `npm run <имя>`, названное в прозе, когда
  // такого скрипта в манифесте нет. Форма с явным `run` взята намеренно —
  // `npm audit` и `npm test` это встроенные команды менеджера, и требовать для
  // них скрипта значило бы краснеть на законном (F4). Списка встроенных здесь
  // поэтому нет: он гнил бы от версии к версии.
  //
  // **Предупреждает, а не роняет** — та же идиома, что у двух соседних сверок,
  // читающих манифест. Причина не в мягкости: посадка в новый проект приходит с
  // готовым набором скриптов и с обобщённым шаблоном правил, и первый же прогон
  // краснел бы на состоянии, которое ещё никто не успел описать.
  if (CONFIG.manifest != null) {
    const at = path.join(BASE, CONFIG.manifest);
    const pkg = existsSync(at) ? JSON.parse(readFileSync(at, "utf8")) : null;
    const scripts = Object.keys(pkg?.scripts ?? {});
    if (scripts.length) {
      const spans = new Set();
      for (const [, src] of docSources)
        for (const hit of readFileSync(src, "utf8").matchAll(/`([^`\n]+)`/g))
          spans.add(hit[1].trim());
      const named = (s) =>
        spans.has(s) || spans.has(`npm ${s}`) || spans.has(`npm run ${s}`);
      const silent = scripts.filter((s) => !named(s));
      const declared = new Set(scripts);
      const phantom = new Set();
      for (const span of spans) {
        const m = /^npm run ([\w:.-]+)$/.exec(span);
        if (m !== null && !declared.has(m[1])) phantom.add(m[1]);
      }
      if (silent.length || phantom.size) {
        console.log(
          "=== Скрипты манифеста описаны (предупреждение, прогон не роняет) ===",
        );
        console.log(
          `  скриптов: ${scripts.length}, не названы нигде: ${silent.length}, названы и не существуют: ${phantom.size}`,
        );
        for (const s of silent)
          console.log(
            `    ${s} — есть в манифесте, но ни таблица проверок, ни список` +
              NEWLINE +
              "      исключённых его не называет: решение о нём не принято",
          );
        for (const s of phantom)
          console.log(`    npm run ${s} — названо в прозе, скрипта нет`);
      }
    }
  }

  // 9d, обратная сторона: номер решения, названный где угодно, разрешается в
  // файл. Корпус тот же, что у адресов, плюс код: на решение ссылаются как раз
  // из комментария. Номер сравнивается числом, а не строкой, — иначе `ADR-4` и
  // `ADR-004` считались бы разными решениями, хотя решение одно.
  if (CONFIG.adr != null) {
    const dir = norm(path.join(BASE, CONFIG.adr.dir));
    const known = new Set(
      (existsSync(dir) ? readdirSync(dir) : [])
        .filter((n) => /\.md$/.test(n))
        .map((n) => Number(/^(\d+)/.exec(n)?.[1] ?? NaN))
        .filter((n) => Number.isFinite(n)),
    );
    const gone = new Set();
    for (const [name, at] of [
      ...docSources,
      ...[...files, ...styleFiles].map((f) => [rel(f), f]),
    ])
      for (const hit of readFileSync(at, "utf8").matchAll(/ADR[-\s](\d+)/g))
        if (!known.has(Number(hit[1]))) gone.add(`${name}: ${hit[0]}`);
    for (const g of gone) danglingAdr.push(g);
  }

  console.log("=== Решения адресуемы ===");
  console.log(
    `  без единой ссылки: ${orphanAdr.length}, ссылок на несуществующее решение: ${danglingAdr.length}`,
  );
  for (const a of orphanAdr) console.log("    " + a);
  for (const a of danglingAdr) console.log("    " + a);

  // 14. путь в обратных кавычках указывает на существующий файл.
  // Якоря `файл:строка` закрыты пунктом 8; здесь — голые адреса без номера
  // строки, а их втрое больше. Адресом считается токен с косой чертой и
  // известным расширением: без косой это обычно имя из прозы («положите рядом
  // `config.json`»).
  //
  // Отбрасывается ровно одно — перечисление расширений (`.ts/.tsx/.scss`), у
  // которого КАЖДЫЙ сегмент имеет вид «точка и буквы». Прежнее правило
  // отбрасывало любой токен, где хоть один сегмент начинается с точки, и вместе
  // с перечислениями вырезало все адреса в скрытых папках — то есть всю
  // `.context/**`, самый называемый адрес проекта. Найдено пробой: `.context/
  // graph2.mjs` (файла нет) прошёл молча.
  const PATH_EXT = /\.(tsx?|scss|md|json|mjs)$/;
  // Составное расширение (`.test.ts`) — тоже расширение, а не адрес: прежний
  // образец требовал одного куска после точки и на нём спотыкался.
  const isExtensionList = (tok) =>
    tok.split("/").every((s) => /^\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/.test(s));
  const looksLikePath = (tok) =>
    tok.includes("/") && PATH_EXT.test(tok) && !isExtensionList(tok);
  // Голое имя без косой черты — тоже адрес, и чаще всего именно им база
  // называет саму себя: своих соседей она пишет `05-flows.md`, а не путём.
  // Из сверки они выпадали целиком, и это не мелочь: ЧЕТЫРЕ файла базы
  // адресуемы только так, — переименование одного из них проходило зелёным,
  // проверено пробой. Засчитывается только имя, которое на диске одно:
  // `README.md` носят полсотни файлов, и разрешать его значило бы гадать.
  // Опись для голых имён — весь репозиторий, а не `src`: база называет саму
  // себя, свои правила и свои скиллы, и все они лежат вне исходников.
  const bareCount = new Map();
  (function walkRepo(dir) {
    for (const e of readdirSync(dir)) {
      if (OUT_OF_TREE.has(e)) continue;
      const full = norm(path.join(dir, e));
      if (statSync(full).isDirectory()) walkRepo(full);
      else bareCount.set(e, (bareCount.get(e) ?? 0) + 1);
    }
  })(norm(REPO));
  // Только документы. У `.json` и `.ts` голое имя в этом проекте чаще всего
  // проза — «положите рядом `config.json`», «суффикс `.test.ts`», — и сверка по
  // ним краснела бы на законном тексте: замерено, пять таких на 1110 токенов.
  // У документа наоборот: голое имя это ссылка, и другой формы у неё обычно нет.
  const looksLikeBareName = (tok) =>
    !tok.includes("/") && /\.md$/.test(tok) && !isExtensionList(tok);
  // `everyPath` собран под подсчёт папок и намеренно держит только
  // `.ts/.tsx/.scss/.md`; расширять его нельзя — на его составе стоят числа
  // заявленных папок. Поэтому у сверки путей свой инвентарь: тот же список
  // плюс скрипты, на которые база ссылается по имени.
  const scriptFiles = [];
  (function walkScripts(dir) {
    if (!walkable(dir)) return;
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walkScripts(full);
      else if (e.endsWith(".mjs")) scriptFiles.push(norm(full));
    }
  })(norm(path.join(REPO, "src")));
  const inventory = [...everyPath, ...scriptFiles];
  // Ссылка markdown — ВТОРАЯ форма адреса, и её не читала ни одна сверка.
  // Разница с обратными кавычками принципиальная: там адрес может оказаться
  // прозой («положите рядом файл такой-то»), поэтому корпус там сужен, а полка
  // исключена целиком — её текст называет файлы проекта, которого ещё нет.
  // Здесь сужать нечего: `](./путь)` — это ссылка, а не упоминание.
  //
  // Найдено пробой, и дыра была ровно в полке: её таблица состава ссылается на
  // собственные шаблоны, шаблон унесли — прогон остался зелёным. Исключение
  // было написано ПО ИСТОЧНИКУ, а его причина — про ЦЕЛЬ ссылки.
  //
  // Корпус поэтому весь репозиторий, полка включительно; замер до заведения:
  // ссылок 253, битых 0, и ни одной не относительной — то есть шума сверка не
  // даёт по построению.
  const danglingLinks = [];
  {
    const skipDirs = new Set([
      "node_modules",
      ".stryker-tmp",
      "dist",
      "coverage",
      ".git",
    ]);
    const mdFiles = [];
    (function walkMd(dir) {
      for (const e of readdirSync(dir)) {
        if (skipDirs.has(e)) continue;
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) walkMd(full);
        else if (e.endsWith(".md")) mdFiles.push(norm(full));
      }
    })(norm(REPO));
    // Копия доктрины в проекте пропускается: её ссылки написаны про полку, там
    // же и проверяются, а копию держит побайтовая пара. Причина целиком — у
    // `CONFIG.doctrineCopies`.
    const copiesAt =
      CONFIG.doctrineCopies == null
        ? null
        : norm(path.join(BASE, CONFIG.doctrineCopies)) + "/";
    for (const f of mdFiles) {
      if (copiesAt !== null && f.startsWith(copiesAt)) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
        const spec = m[1];
        // Внешние адреса, якоря внутри страницы, плейсхолдеры и абсолютные
        // пути к делу не относятся: первое не наше, остальное не адрес файла.
        if (/^(https?:|#|<|mailto:|\/)/.test(spec)) continue;
        const target = path.resolve(path.dirname(f), spec.split("#")[0]);
        // Адрес печатается от корня репозитория, как во всех соседних
        // секциях. `rel()` тут не годится: он срезает корень ИСХОДНИКОВ, и
        // файл вне `src` оставался с абсолютным путём — читателю приходилось
        // вычитывать корень глазами. Найдено пробой.
        if (!existsSync(target))
          danglingLinks.push(
            `${path.relative(REPO, f).split(path.sep).join("/")} → ${spec}`,
          );
      }
    }
  }

  const knownDangling = new Set(CONFIG.docPathExceptions);
  const knownUsed = new Set();
  const danglingPaths = [];
  let pathTokens = 0;
  for (const [name, at] of docSources) {
    // Копия доктрины — по той же причине, что и у ссылок: её адреса написаны
    // про полку. См. `CONFIG.doctrineCopies`.
    if (
      CONFIG.doctrineCopies != null &&
      name.startsWith(CONFIG.doctrineCopies + "/")
    )
      continue;
    const dir = norm(path.dirname(at));
    for (const hit of readFileSync(at, "utf8").matchAll(/`([^`\n]+)`/g)) {
      let tok = hit[1].trim();
      if (/[\s(){}*[\]<>|,]/.test(tok)) continue;
      tok = tok.replace(/[:#].*$/, "");
      if (looksLikeBareName(tok)) {
        // Неоднозначное имя отсутствием не является — тот же принцип, что у
        // реестра тестов и у карты: список, наполненный живыми файлами,
        // перестают читать.
        const seen = bareCount.get(tok) ?? 0;
        if (seen === 0) {
          pathTokens++;
          if (knownDangling.has(`${name}|${tok}`))
            knownUsed.add(`${name}|${tok}`);
          else danglingPaths.push(`${name}: ${tok}`);
        } else if (seen === 1) pathTokens++;
        continue;
      }
      if (!looksLikePath(tok)) continue;
      pathTokens++;
      const asRelative =
        tok.startsWith("./") || tok.startsWith("../")
          ? norm(path.resolve(dir, tok))
          : null;
      // `locate` требует ОДНОЗНАЧНОГО разрешения и молчит, когда путь есть в
      // двух копиях, — а у парных форков так почти всё (`runtime/types.ts`
      // живёт и в движке, и в форке). Для вопроса «существует ли файл»
      // неоднозначность отсутствием не является, поэтому запасной шаг —
      // совпадение по хвосту пути.
      if (
        (asRelative !== null && existsSync(asRelative)) ||
        locate(tok, null) !== null ||
        inventory.some((f) => f.endsWith("/" + tok))
      )
        continue;
      // Исключение спрашивают ПОСЛЕ разрешения, а не до: спрошенное раньше, оно
      // считалось бы использованным и для адреса, который давно на месте, — то
      // есть переживало бы собственный повод.
      if (knownDangling.has(`${name}|${tok}`)) {
        knownUsed.add(`${name}|${tok}`);
        continue;
      }
      danglingPaths.push(`${name}: ${tok}`);
    }
  }
  for (const one of knownDangling)
    if (!knownUsed.has(one))
      deadExceptions.push(`пути в обратных кавычках: ${one} — ничего не гасит`);

  console.log("=== Пути в обратных кавычках ===");
  console.log(
    `  проверено: ${pathTokens}, ведут в никуда: ${danglingPaths.length}`,
  );
  for (const d of danglingPaths) console.log("    " + d);

  console.log("=== Ссылки markdown ===");
  console.log(`  ведут в никуда: ${danglingLinks.length}`);
  for (const d of danglingLinks) console.log("    " + d);

  console.log("=== Исключения сверок используются ===");
  console.log(`  мёртвых исключений: ${deadExceptions.length}`);
  for (const d of deadExceptions) console.log("    " + d);

  // 15. ALL_CAPS-имя в обратных кавычках существует в исходниках.
  // Константы база называет поимённо, и переименование оставляет в тексте имя,
  // которого больше нет. Маркеры отложенной работы исключены: их в коде нет
  // намеренно — про них как раз и написано, что их быть не должно.
  // Имя ищется в ИСПОЛНЯЕМОМ тексте, а не в любом. Сверка по всему файлу
  // держалась за собственное эхо: переименованная константа оставалась «живой»
  // из-за строки `// СТАРОЕ_ИМЯ` в комментарии теста — прогон зелёный,
  // а имени в коде уже нет. Найдено пробой. Комментарий узнаётся тем же
  // помощником, что и пометки решений: два способа отличать комментарий от кода
  // однажды разошлись бы.
  const WORK_MARKERS = new Set(["TODO", "FIXME", "HACK", "XXX"]);
  const liveNames = new Set();
  for (const f of [...files, ...styleFiles])
    for (const line of readFileSync(f, "utf8").split(NEWLINE))
      for (const hit of line.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g))
        if (!inComment(line, hit.index)) liveNames.add(hit[0]);

  // 15b. имя в camelCase, названное базой в кода-спане, существует.
  //
  // Сверка имён знала только ЗАГЛАВНЫЕ константы, а база называет в кавычках
  // прежде всего хуки, функции и пропы — то есть camelCase. Найдено пробой:
  // переименовал `slideLane` в домене, база продолжила его называть, прогон
  // остался зелёным. Переименование — самое частое событие рефактора, и это
  // ровно тот случай, когда запись переживает предмет.
  //
  // Обратные кавычки в базе означают «это существует в коде»: тем же правилом
  // живут пути. Поэтому имя, которого больше нет, из кавычек убирают — так
  // написаны обе исторические записи, где имя названо как прошлое.
  //
  // Корпус шире исходников намеренно: имя поля конфига инструмента живёт в
  // `.mjs`, опция компилятора — в `.json` и `.js`, имя теста — в имени файла.
  // Без них сверка кричала бы на законное, то есть врала бы (F4).
  // Имя живо, только если стоит в ИСПОЛНЯЕМОМ тексте. Иначе сверка держится за
  // собственное эхо — ровно как было у заглавных имён: объяснение этой самой
  // проверки, где имя названо в комментарии, удерживало его «живым», и полное
  // переименование по коду проходило зелёным. Поймано на первой же фальсификации.
  const CAMEL_NAME = /^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/;
  const CAMEL_TOKEN = /\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g;
  const liveCamel = new Set();
  const fileStems = new Set();
  (function walkNames(dir) {
    for (const entry of readdirSync(dir)) {
      if (OUT_OF_TREE.has(entry)) continue;
      const full = norm(path.join(dir, entry));
      if (statSync(full).isDirectory()) walkNames(full);
      else {
        fileStems.add(entry.replace(/\.[a-z.]+$/, ""));
        if (!/\.(tsx?|scss|mjs|js|json)$/.test(entry)) continue;
        for (const line of readFileSync(full, "utf8").split(NEWLINE))
          for (const hit of line.matchAll(CAMEL_TOKEN))
            if (!inComment(line, hit.index)) liveCamel.add(hit[0]);
      }
    }
  })(norm(path.join(BASE, "..")));
  const goneCamel = [];
  const foreignUsed = new Set();
  let camelTokens = 0;
  // Доктрина из подпапки базы в этот корпус не входит, и это не послабление, а
  // разница природы. Её текст побайтово общий с полкой и обязан быть годным для
  // любого проекта, поэтому имена в нём — **иллюстрации**, а не адреса: «россыпь
  // флагов» показывается на выдуманных `isAnimating` и `isSettling`. Требовать
  // от них существования значило бы краснеть на законном. Адреса файлов в той же
  // доктрине проверяются как раз наоборот — они обязаны разрешаться, и глубокий
  // обход туда заведён именно за этим. Найдено пробой: обход втянул доктрину
  // сразу в обе сверки, и во второй он был неправ.
  const nameSources = docSources.filter(([n]) => !/^rules[/]/.test(n));
  for (const [name, at] of nameSources)
    for (const [i, line] of readFileSync(at, "utf8").split(NEWLINE).entries())
      for (const span of line.split(BACKTICK).filter((_, k) => k % 2 === 1)) {
        const tok = span.trim();
        if (!CAMEL_NAME.test(tok) || fileStems.has(tok)) continue;
        if ((CONFIG.foreignNames ?? []).includes(tok)) {
          foreignUsed.add(tok);
          continue;
        }
        camelTokens++;
        if (!liveCamel.has(tok)) goneCamel.push(`${name}:${i + 1} — ${tok}`);
      }
  for (const one of CONFIG.foreignNames ?? [])
    if (!foreignUsed.has(one))
      deadExceptions.push(`имена из чужих API: ${one} — ничего не гасит`);

  console.log("=== Имена из кода в тексте ===");
  console.log(
    `  проверено: ${camelTokens}, нет в исходниках: ${goneCamel.length}`,
  );
  for (const g of goneCamel) console.log("    " + g);
  const goneNames = [];
  let capsTokens = 0;
  for (const [name, at] of nameSources) {
    // Имя ищется ВНУТРИ кода-спана, а не «в кавычках целиком»: база пишет и
    // `NAME`, и `NAME = 400`, и вторая форма при сверке по целому спану
    // молча не проверялась бы — на ней проверка и попалась при фальсификации.
    for (const span of readFileSync(at, "utf8").matchAll(/`([^`\n]+)`/g)) {
      // Только СОСТАВНОЕ имя, и не часть имени файла. Односложные заглавные
      // слова в тексте — это `CLAUDE.md`, `LOCALAPPDATA`, `PIPESTATUS`: имена
      // не из исходников, и проверять их здесь значило бы шуметь. Подчёркивание
      // отделяет константу проекта от такого слова надёжнее любого списка.
      for (const hit of span[1].matchAll(
        /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
      )) {
        if (WORK_MARKERS.has(hit[0])) continue;
        if (span[1][hit.index + hit[0].length] === ".") continue;
        capsTokens++;
        if (!liveNames.has(hit[0])) goneNames.push(`${name}: ${hit[0]}`);
      }
    }
  }
  // 15a. счёт сущностей, записанный голой прозой базы.
  //
  // Правило простое: число, которое едет от любой правки, в базе не пишут.
  // Держалось оно текстом — и текст протекал: за один заход нашлось восемь
  // застывших счётов в проекте, где правило уже было записано. Машина их не
  // отличала от законных, потому что законные писались так же — голой прозой.
  //
  // Поэтому у законных теперь есть ФОРМА: замер и факт о прошлом пишутся в
  // обратных кавычках. Всё, что вне формы, запрещено по построению — судить не
  // надо, соврать нечем. Проверено, что форма свободна: до этой правки чисел
  // внутри кода-спанов в базе не было ни одного, так что задним числом ничего
  // не легализовано.
  //
  // Не считаются числом: объявленные машинные формы (состав папки, радиус),
  // разделы базовой линии и НУМЕРАЦИЯ — номер пункта, заголовка или строки
  // таблицы. Последнее не поблажка: «11. Значение константы» — это адрес
  // раздела, а не счёт.
  // Единицы НАСТРОЙКИ — тот же класс, что счёт сущностей: `250 мс` в прозе это
  // копия значения из конфига, и она едет от каждой правки настройки. Найдено
  // пробой: значение стояло в двух файлах базы, а сверка ловила только счёт.
  //
  // Проценты сюда НЕ входят, и это не послабление: в этом проекте процент — это
  // всегда результат замера (доля убитых мутантов, покрытие), а не значение
  // константы. Включить их значило бы потребовать пометки у трёх десятков
  // записей о прошлых прогонах — то есть шуметь там, где формой уже сказано всё.
  // Список закрытый и потому **стареет вместе с проектом**: заводится новая
  // считаемая сущность — её стем сюда дописывают, иначе счёт этой сущности
  // проходит зелёным. Найдено пробой в тот же день, когда завелись обещания без
  // опоры, критерии планки и выведенные принципы: ни одного из трёх стемов тут
  // не было, и «42 обещания» в прозе базы прошли молча. Замер перед правкой —
  // ноль попаданий по всей базе, то есть шума расширение не добавляет.
  const NUM_NOUN =
    "файл|бочк|сверк|режим|провер|тест|правил|экспорт|строк|исключен|папк|модул|пункт|запис|констант|слайд|мутант|раздел|команд|хук|слоёв|секунд|минут|мс(?![а-яё])|px|обещан|критери|принцип";
  // Стем ищется и ВНУТРИ слова, а не только в начале: «14 реэкспортов» — тот же
  // счёт, что «14 экспортов», и привязка к началу слова пропускала его молча.
  // Найдено пробой. Расширение измерено на всей базе: новых попаданий ровно
  // одно, и оно настоящее — ложных ноль, поэтому шума сверка не даёт.
  const PROSE_NUM = new RegExp(
    `\\d[\\d.,]*\\s+(?:[а-яё]+\\s+)?[а-яё]*(?:${NUM_NOUN})[а-яё]*`,
    "gi",
  );
  const DECLARED_NUM = [
    /\(\d+\s+файл[аов]*\)/,
    /—\s+\d+\s+файл[аов]*/,
    /\d+\s+импортёр[а-я]*\s*\(\+\d+/,
  ];
  // Нумерация: в начале строки, после маркера списка, после решётки заголовка
  // или сразу за вертикальной чертой таблицы.
  const NUMBERING = /(^|[-*|#]\s*|\*\*)[A-ZА-Я]?\d+\.\s/g;
  const outsideTicks = (line) =>
    line
      .split(BACKTICK)
      .filter((_, i) => i % 2 === 0)
      .join(" ");
  const frozenNumbers = [];
  // Обход верхнего уровня базы — намеренный, а не оставшийся от плоской эпохи.
  // Доктрина лежит подпапкой и побайтово общая с полкой: числа в ней — не счёт
  // сущностей ЭТОГО проекта, а иллюстрации («шестьдесят или сто двадцать раз в
  // секунду»), и требовать от них формы значило бы краснеть на законном. Соседняя
  // сверка адресов, наоборот, в подпапку заходит: адрес обязан разрешаться, а
  // число — нет. Разница названа здесь, чтобы следующий заход не «починил»
  // обход, приняв его за недосмотр.
  for (const name of readdirSync(BASE)) {
    if (!name.endsWith(".md")) continue;
    let inBaseline = false;
    for (const [i, line] of readFileSync(path.join(BASE, name), "utf8")
      .split(NEWLINE)
      .entries()) {
      if (/^##\s/.test(line))
        inBaseline = (CONFIG.baselineSections ?? []).some((one) =>
          line.includes(one),
        );
      if (inBaseline) continue;
      if (DECLARED_NUM.some((rx) => rx.test(line))) continue;
      const bare = outsideTicks(line).replace(NUMBERING, " ");
      const hit = bare.match(PROSE_NUM);
      if (hit !== null)
        frozenNumbers.push(`${name}:${i + 1} — ${hit.join(" | ")}`);
    }
  }
  console.log("=== Числа в прозе базы ===");
  console.log(`  счётов вне формы: ${frozenNumbers.length}`);
  for (const f of frozenNumbers) console.log("    " + f);

  console.log("=== Имена констант в тексте ===");
  console.log(
    `  проверено: ${capsTokens}, нет в исходниках: ${goneNames.length}`,
  );
  for (const g of goneNames) console.log("    " + g);

  // 16. тест лежит в папке `tests/` своего слоя.
  // Соглашение несущее: база описывает каждый тест ПУТЁМ, а размер папки
  // считается по коду, отдельно от путей со словом `tests`. Перенос теста к
  // его файлу не уронил бы ни один прогон — `isTest` ловит и по суффиксу
  // имени, — зато обессмыслил бы записи базы молча.
  const strayTests = files.filter(
    (f) => /\.test\.tsx?$/.test(f) && !f.includes("/tests/"),
  );
  console.log("=== Тесты лежат в `tests/` ===");
  console.log(`  вне своей папки: ${strayTests.length}`);
  for (const s of strayTests) console.log("    " + rel(s));

  console.log("=== Объявленный состав папок и радиусы ===");
  console.log(
    `  папок: ${dirs}, радиусов: ${radii}, разошлось: ${wrong.length}`,
  );
  for (const w of wrong) console.log("    " + w);
  if (unresolved.length) {
    console.log("=== Не разобрано (проверкой не покрыто) ===");
    for (const u of unresolved) console.log("    " + u);
  }
  // Печатается заголовками, а не числом: число рядом с сорока другими числами
  // проглядывают, а вопрос, названный своими словами, — нет. Ради того же он
  // стоит последней секцией: последнее прочитанное и есть прочитанное.
  console.log("=== Конфиг звена цепочки на месте ===");
  console.log(`  расхождений: ${toolchainDrift.length}`);
  for (const d of toolchainDrift) console.log("    " + d);

  if (CONFIG.seating != null) {
    console.log("");
    console.log("=== ПОСАДКА НЕ ЗАВЕРШЕНА ===");
    console.log("  Фаза 1 пройдена, фаза 2 — нет. Пока флаг стоит, три сверки");
    console.log("  смягчены: незаполненные места заготовок, долг карты и");
    console.log("  несобранная цепочка проверок. Снять флаг — отдельное");
    console.log("  действие, и делает его фаза 2, а не прогон.");
  }

  console.log("=== Вопросы разработчику без ответа ===");
  console.log(
    CONFIG.questions == null
      ? "  список вопросов не заявлен"
      : `  открытых: ${openQuestions.length}` +
          (openQuestions.length
            ? " — назвать КАЖДЫЙ в отчёте, включая заданные не сегодня"
            : ""),
  );
  for (const q of openQuestions) console.log("    " + q);
  for (const q of malformedQuestions) console.log("    сломана форма: " + q);

  if (
    (CONFIG.seating == null ? missing.length : overDebt) ||
    unnamed.length ||
    goneTests.length ||
    goneMapped.length ||
    markerKinds.some((k) => k.unlisted.length || k.gone.length) ||
    broken7.length ||
    brokenIso.length ||
    emptyRules.length ||
    missingTables.length ||
    starDrift.length ||
    barrelDrift.length ||
    broken.length ||
    wrong.length ||
    orphanAdr.length ||
    danglingAdr.length ||
    undocumentedConst.length ||
    lintDrift.length ||
    offDrift.length ||
    undocumented.length ||
    deadAnchors.length ||
    closedTodos.length ||
    danglingTodo.length ||
    // Только сломанная форма записи. Сам открытый вопрос прогон не роняет: он
    // ждёт решения человека, а красный прогон на этом приучил бы гасить список.
    malformedQuestions.length ||
    doctrineDrift.length ||
    uncitedNew.length ||
    parked.length ||
    // Проверка, не влияющая на код возврата, печатает, но не держит. Здесь
    // такое уже случилось однажды: сверка разрешений среды была добавлена
    // мимо этого списка и молча не роняла прогон.
    settingsDrift.length ||
    skillDrift.length ||
    disarmed.length ||
    toolchainDrift.length ||
    indexDrift.length ||
    domDrift.length ||
    mutePromises.length ||
    unexplained.length ||
    goneScope.length ||
    unclassified.length ||
    (CONFIG.seating == null ? unfilledTemplate.length : 0) ||
    scopeDrift.length ||
    danglingRefs.length ||
    deadExceptions.length ||
    danglingPaths.length ||
    danglingLinks.length ||
    goneNames.length ||
    frozenNumbers.length ||
    goneCamel.length ||
    strayTests.length ||
    unresolved.length
  )
    process.exitCode = 1;
}
