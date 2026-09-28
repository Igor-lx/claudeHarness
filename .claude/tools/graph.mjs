import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Словарь области — чистые функции от пути, вынесенные ради одного: решение
// «к какому файлу относится этот вопрос» должно быть записано ОДИН раз.
// Выводясь на месте, оно выводилось по-разному, и три дефекта подряд были
// забытым слагаемым такой комбинации.
import {
  classifyRun,
  barRowFault,
  barNoSubject,
  barCoreCriterion,
  codeOf,
  inComment,
  isCodePath,
  isDocPath,
  CODE_OR_STYLE,
  CODE_STYLE_ALT,
  isStylePath,
  isTestPath,
  commentRunsOf,
  namesAddress,
  printedIsRed,
  sectionsOf,
  selfCheck,
  touchesRuntime,
} from "./graph.predicates.mjs";

// Настройка проекта и якорь его базы. Инструмент от проекта не зависит: всё
// проектное живёт в этом файле и только в нём.
//
// Путь фиксирован раскладкой: обвязка лежит в `.claude/`, база — в `.context/`,
// обе соседями в корне проекта. Инструмент поэтому поднимается на два уровня и
// спускается в базу. Менять адрес — значит менять раскладку, а она объявлена в
// инструкции посадки.
// Режим среды идёт ДО настройки проекта и потому объявлен здесь, а не среди
// прочих: он отвечает на вопрос «годится ли машина», который задают в папке
// снимка, когда проекта ещё нет. Адреса он считает от самого себя.
/** Заголовок сверки. Единственный способ его напечатать.
 *
 * Второй довод — `looked`: СКОЛЬКО эта сверка осмотрела. Без него ноль
 * находок неотличим от «не смотрела никуда», и это не рассуждение, а
 * дважды замеренный дефект: сверка про README и сверка про документы
 * компонента сужали корпус зашитым путём раскладки, в проекте с иной
 * раскладкой не смотрели никуда и печатали ноль. Держит это мета-сверка
 * «Каждая сверка называет свой корпус».
 *
 * Форма: `{ n, unit }` — число и то, что считали, в родительном падеже
 * множественного числа («файлов», «листов», «папок»). Сверка, у которой
 * предмет один, называет единицу честно: осмотрено `1` настройка. */
/** Единственная форма, которой инструмент называет размер осмотренного —
 * и у сверки, и у режима. Одна на всех потому, что требовать её можно только
 * с того, что узнаётся машиной: у каждого режима были свои слова, и спросить
 * с них было нечем.
 *
 * `unit` — родительный падеж множественного числа: «файлов», «листов»,
 * «папок». Предмет один — называют честно: осмотрено `1` настройка. */
/** Файлы, которые обвязка пишет сама и потом читает: след прогона, отчёт
 * мутаций, реестры. Порча такого файла — не выдумка: запись оборвана,
 * слияние оставило маркеры, редактор сохранил половину. Читается это
 * защищённо, а порча копится списком и НАЗЫВАЕТСЯ в конце прогона — иначе
 * сырой стек обрывает прогон на середине, и треть сверок не выполняется. */
/** Сколько ОТКРЫТЫХ строк реестра находок называют эту сверку.
 *
 * Находка на коде не бывает долгом: долгом объявляют неописанное, а код не
 * по правилам — это находка. Закрыть её нельзя, не правя код, а правка кода
 * переходом не является. Держится она открытой строкой реестра, которая
 * мозолит глаза каждым прогоном; закрыли — удалили строку. */
let OPEN_CACHE = null;
const openFindings = () => {
  if (OPEN_CACHE !== null) return OPEN_CACHE;
  const out = new Map();
  if (CONFIG.findings == null) return out;
  const at = path.join(BASE, CONFIG.findings.file);
  if (!existsSync(at)) return out;
  for (const line of readFileSync(at, "utf8").split(String.fromCharCode(10))) {
    const cell = line.split("|").map((c) => c.trim());
    if (cell.length < 7) continue;
    if (cell[6] !== "открыта") continue;
    for (const m of (cell[2] + cell[5]).matchAll(/«([^»]+)»/g))
      out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  }
  OPEN_CACHE = out;
  return out;
};
/** Имена, названные ЛЮБОЙ строкой реестра — открытой либо закрытой.
 *
 * Нужно там, где спрашивается запись ПРОШЛОГО: базовая линия — замер на
 * день посадки, и переписывать её нельзя, иначе движение не от чего
 * считать. Пока сверка красного звена требовала строку ОТКРЫТОЙ, починка
 * звена загоняла проект в тупик: закрыл строку — прогон покраснел, потому
 * что в базовой линии по-прежнему стоит «красное». Оставить открытой
 * навсегда значило бы держать на виду работу, которой больше нет.
 *
 * Закрытая строка отвечает на запись не хуже открытой: она называет коммит
 * и опору, то есть доказывает, что красное разобрано. Замерено ревизией
 * после посадки в пустой проект: формат чинился, строка закрывалась, и
 * прогон краснел на том же месте. */
const namedFindings = () => {
  const out = new Map();
  if (CONFIG.findings == null) return out;
  const at = path.join(BASE, CONFIG.findings.file);
  if (!existsSync(at)) return out;
  for (const line of readFileSync(at, "utf8").split(String.fromCharCode(10))) {
    const cell = line.split("|").map((c) => c.trim());
    if (cell.length < 7) continue;
    if (cell[6] !== "открыта" && cell[6] !== "закрыта") continue;
    for (const m of (cell[2] + cell[5]).matchAll(/«([^»]+)»/g))
      out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  }
  return out;
};
/** Находок этой сверки, не покрытых открытой строкой реестра. */
const overOpen = (name, n) => Math.max(0, n - (openFindings().get(name) ?? 0));

const SPOILED = [];
/** Диапазон среды не объявлен вовсе: опоры нет, и это роняет прогон. */
let envUndeclared = false;
const readJson = (at, fallback) => {
  if (!existsSync(at)) return fallback;
  try {
    return JSON.parse(readFileSync(at, "utf8"));
  } catch (e) {
    SPOILED.push(
      at +
        " — не разбирается как JSON: " +
        String(e.message).split(String.fromCharCode(10))[0],
    );
    return fallback;
  }
};

const sayLooked = (unit, n) => {
  console.log("  осмотрено " + unit + ": " + n);
};

const mode = process.argv[2];

if (mode === "env") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const seed = path.join(here, "..", "seat", "templates", "graph.config.mjs");
  if (!existsSync(seed)) {
    console.log("=== Среда: связка не объявлена ===");
    console.log("  Семя настройки не найдено, сверять не с чем.");
    sayLooked("объявленных версий", 0);
    process.exit(0);
  }
  const block = readFileSync(seed, "utf8");
  const declared = block.slice(block.indexOf("verifiedVersions: {"));
  // Корпус — сами объявленные версии: их считает тот же разбор семени,
  // которым сверяются орудия. Настройки проекта здесь нет — режим среды идёт
  // до неё.
  sayLooked(
    "объявленных версий",
    [...declared.slice(0, declared.indexOf("},")).matchAll(/: "/g)].length,
  );
  const pick = (name) => {
    const hit = new RegExp(name + ':\\s*"([^"]+)"').exec(declared);
    return hit === null ? null : hit[1];
  };
  const older = (have, need) => {
    const a = String(have)
      .replace(/^[^0-9]*/, "")
      .split(".")
      .map(Number);
    const b = String(need).split(".").map(Number);
    for (let i = 0; i < 3; i += 1) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x !== y) return x < y;
    }
    return false;
  };
  const ask = (name) => {
    if (name === "node") return process.versions.node;
    try {
      return execFileSync(name, ["--version"], {
        encoding: "utf8",
        shell: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
  const low = [];
  const seen = [];
  for (const name of ["node", "npm"]) {
    const need = pick(name);
    if (need === null) continue;
    const have = ask(name);
    if (have === null) {
      low.push({ name, have: "не отвечает", need, how: "поставить" });
      continue;
    }
    seen.push(name + " " + have + " (нужно " + need + ")");
    if (older(have, need))
      low.push({
        name,
        have,
        need,
        // Команда подъёма печатается ГОТОВОЙ: «поднимите менеджер» заставляет
        // получателя гадать, а гадание кончается установкой не той версии.
        how:
          name === "npm"
            ? "npm i -g npm@" + need.split(".")[0]
            : "поставить отдельно: менеджером версий среды либо установщиком",
      });
  }
  console.log("=== Среда посадки ===");
  for (const one of seen) console.log("  " + one);
  if (low.length === 0) {
    console.log("  годится: сажать можно");
    process.exit(0);
  }
  console.log("");
  console.log("ПОСАДКА НЕ НАЧАТА: среда ниже проверенной связки.");
  for (const one of low)
    console.log("  " + one.name + " " + one.have + " — нужно " + one.need);
  console.log("");
  console.log("  Чем поднять:");
  for (const one of low) console.log("    " + one.how);
  console.log("");
  console.log("  СПРОСИТЬ РАЗРАБОТЧИКА: поднимать? Ответ «да» — поднять и");
  console.log("  продолжить с шага 1; заново начинать не с чего, проект ещё");
  console.log("  не тронут. Ответ «нет» — посадка не начата, и это законно:");
  console.log("  обвязка на этой связке не мерена и за неё не отвечает.");
  console.log("");
  console.log("  Почему остановка, а не предупреждение: ниже объявленного");
  console.log("  установка пакетов падает СОБСТВЕННОЙ ошибкой менеджера, где");
  console.log("  про версию нет ни слова, — и падает на шестом шаге, когда");
  console.log("  проект уже тронут: обвязка скопирована, семена разложены,");
  console.log("  настройки слиты.");
  process.exit(1);
}

// Настройка проекта грузится ДИНАМИЧЕСКИ — ради режима выше, который обязан
// работать там, где проекта ещё нет. Её отсутствие при этом перестало быть
// стеком: сообщение говорит, где инструмент искал и почему не нашёл.
let BASE;
let CONFIG;
try {
  ({ BASE, CONFIG } = await import("../../.context/graph.config.mjs"));
} catch {
  console.log("=== Настройки проекта нет ===");
  console.log(
    "  Ожидался файл: .context/graph.config.mjs рядом с папкой обвязки.",
  );
  console.log(
    "  Так выглядит папка снимка либо проект до посадки: инструменту",
  );
  console.log("  нечего сверять. Годность машины спрашивают режимом env — он");
  console.log("  работает и здесь.");
  process.exit(1);
}

/** Папка самого инструмента. Нужна ровно там, где речь о его собственных
 * соседях — справочнике режимов и словаре области. Всё остальное считается от
 * папки базы: у этих двух адресов разные хозяева, и пока они назывались одним
 * именем, перенос инструмента увёз бы за собой всю базу. */
/** Расширение кода или стиля в конце имени: снимается с голого имени файла. */
const BARE_EXT = new RegExp("[.](" + CODE_STYLE_ALT + ")$");

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Вид полей настройки сверяется ДО работы, и неверный называется строкой.
 *
 * Поля настройки бывают трёх видов: строка-адрес, число и объект из нескольких
 * частей. Какой именно вид у поля, описано прозой рядом с ним, а примера в
 * файле нет — там стоит `null`. Догадка «раз адрес, значит строка» естественна
 * и неверна, и до этой проверки она стоила падения стеком из `node:path`:
 * сообщение говорило про аргумент функции пути и ни слова про то, какое поле
 * задано не так.
 *
 * Найдено посадкой в живой проект на поле плана перехода — первом же случае,
 * когда живой проект это поле вообще заполнял. Роняем здесь и сразу: настройка
 * читается раньше любого режима, и работать с ней вслепую нельзя ни одному.
 *
 * Список закрытый: сюда вписывают поле, когда оно заводится объектом. */
const SHAPED = {
  transition: ["file", "heading"],
  // `since` необязателен: у свежей посадки коммита-основания нет, и реестр
  // при пустом поле просто копит находки, не сверяя починок с историей.
  findings: ["file", "heading"],
  checksTable: ["file", "heading"],
  docsIndex: ["dir", "table", "heading"],
  rulesManifest: ["rules"],
  lintConfigOff: ["file", "allowed"],
  domTables: ["file", "headings"],
  lintExceptions: ["table", "heading"],
  adr: ["dir"],
  configDocs: ["dir", "docs"],
  doctrineReading: ["template", "listHeading", "orderHeading"],
  qualityScope: ["policy", "table", "heading"],
  skills: ["dir", "table", "heading"],
  promises: ["file", "heading"],
};

/** Поля, которые объектом БЫВАЮТ, но вид их держит не этот список.
 *
 * Список рядом с закрытым намеренно: без него «объявлен ли вид» пришлось бы
 * решать на глаз, а глаз этот класс уже пропустил четыре раза подряд.
 */
const SHAPE_FREE = new Set(["toolchain", "verifiedVersions", "debt"]);

/** Виды долга описания — закрытый список, и он же единственный.
 *
 * Проверяется отдельно от `SHAPED` по двум причинам. Первая: части долга
 * пустыми БЫВАЮТ, и пусты они у всякого нового проекта — `SHAPED` требует
 * непустых. Вторая важнее: здесь неверно не только «части нет», но и
 * «часть названа не так». Опечатка в имени вида дала бы молчаливый ноль —
 * сверка осталась бы красной, а настройка выглядела бы заполненной, и
 * искать причину пришлось бы глазами.
 */
const DEBT_KINDS = [
  "map",
  "tests",
  "decisions",
  "invariants",
  "constants",
  "subjects",
  "readme",
  "comments",
  "tongue",
];
const DEBT = CONFIG.debt ?? {};
const debtOf = (kind) => DEBT[kind] ?? 0;
const overDebtOf = (kind, undescribed) =>
  Math.max(0, undescribed - debtOf(kind));
/** Хвост счётной строки: сколько из неописанного объявлено долгом. */
const debtTail = (kind) =>
  debtOf(kind) > 0 ? ", из них долг посадки: " + debtOf(kind) : "";
/** Строка под счётом: долг не вырос, и это не находка. Печатается в ДВА
 * пробела — формой счёта, а не формой находки: всё, что читает вывод
 * механически, иначе сочло бы её красной. */
const debtNote = (kind, undescribed) => {
  if (debtOf(kind) > 0 && overDebtOf(kind, undescribed) === 0)
    console.log(
      "  Долг не вырос. Уменьшить его — работа по команде разработчика:" +
        " описать записи и уменьшить поле долга в настройке.",
    );
};
/** Что из неописанного ПЕЧАТАЕТСЯ находкой.
 *
 * Долг решает, красный ли прогон; какие именно записи не заведены — не его
 * дело, поэтому список либо печатается целиком, либо не печатается вовсе.
 * Срезом по числу пользоваться нельзя: он отсекает с начала и потому
 * поглощает НОВОЕ, показывая вместо него старое, известное.
 *
 * Прежде этого помощника не было, и долг был ДЕКОРАТИВНЫМ: счётная строка
 * говорила «долг не вырос», а следом печатался полный список находок — и
 * прогон оставался красным. Из семи видов долга работал ровно один, заведённый
 * последним. Живой проект не мог пройти рубеж посадки ни при каком долге.
 * Замерено посадкой семи стендов подряд. */
const debtList = (kind, items) => {
  DEBT_REAL.set(kind, Math.max(DEBT_REAL.get(kind) ?? 0, items.length));
  return overDebtOf(kind, items.length) > 0 ? items : [];
};
/** Сколько НЕОПИСАННОГО насчитала каждая сверка на самом деле. Заполняется
 * по ходу прогона теми же сверками, что читают долг. */
const DEBT_REAL = new Map();

if (CONFIG.debt != null) {
  const wrong = [];
  for (const [kind, value] of Object.entries(CONFIG.debt)) {
    if (!DEBT_KINDS.includes(kind))
      wrong.push("вида долга `" + kind + "` не существует");
    else if (value != null && (!Number.isInteger(value) || value < 0))
      wrong.push(
        "долг `" +
          kind +
          "` — не целое неотрицательное: " +
          JSON.stringify(value),
      );
  }
  if (wrong.length) {
    console.log("=== НАСТРОЙКА ЗАДАНА НЕВЕРНО ===");
    console.log("  поле:    debt");
    for (const w of wrong) console.log("  " + w);
    console.log("  виды:    " + DEBT_KINDS.join(", "));
    console.log("  Править: .context/graph.config.mjs");
    process.exit(2);
  }
}
for (const [field, parts] of Object.entries(SHAPED)) {
  const v = CONFIG[field];
  if (v == null) continue;
  const bad =
    typeof v !== "object" ||
    Array.isArray(v) ||
    parts.some((p) => v[p] == null);
  if (!bad) continue;
  console.log("=== НАСТРОЙКА ЗАДАНА НЕВЕРНО ===");
  console.log("  поле:    " + field);
  console.log("  ожидали: объект с частями " + parts.join(", "));
  console.log("  стоит:   " + JSON.stringify(v));
  console.log("  Править: .context/graph.config.mjs");
  process.exit(2);
}

// Объектное поле, вид которого нигде не объявлен, — сама по себе поломка.
//
// Прежде список видов пополняли по случаю: падало на поле — вписывали поле. За
// четыре захода это повторилось четырежды, и каждый раз изнутри выглядело
// единичной оплошностью. Признак у класса один и механический: поле держит
// объект, а частей его никто не назвал, — значит первое же обращение к части
// уйдёт в `undefined` и кончится стеком из `node:path` вместо имени поля.
//
// Список `SHAPE_FREE` называет те объектные поля, чей вид проверяют иначе:
// объявление звеньев цепочки, минимумы версий, таблицы настроек. Он закрытый,
// и держать его дешевле, чем ловить пятый случай.
for (const [field, v] of Object.entries(CONFIG)) {
  if (v == null || typeof v !== "object" || Array.isArray(v)) continue;
  if (SHAPED[field] !== undefined || SHAPE_FREE.has(field)) continue;
  console.log("=== ВИД ПОЛЯ НАСТРОЙКИ НЕ ОБЪЯВЛЕН ===");
  console.log("  поле:  " + field);
  console.log("  стоит: " + JSON.stringify(v));
  console.log(
    "  Поле держит объект, а частей его никто не назвал: первое обращение",
  );
  console.log("  к части уйдёт в undefined и кончится стеком вместо имени.");
  console.log("  Править: список видов в .claude/tools/graph.mjs.");
  process.exit(2);
}

/** Менеджер пакетов ЭТОГО проекта — тот, что объявлен его манифестом.
 *
 * Умолчание свода — npm, и команды в правилах пишут им. Но свод прямо
 * разрешает другой менеджер и велит переписать под него таблицу проверок:
 * «менеджер другой — правятся эти строки». Сверка скриптов при этом знала одно
 * имя и после такой правки переставала видеть таблицу вовсе.
 *
 * Замерено на проекте, объявившем pnpm полем манифеста: таблица проверок
 * назвала все звенья, а сверка доложила ЧЕТЫРЕ скрипта, о которых «решение не
 * принято». Ложное срабатывание ровно на том действии, которого свод сам и
 * требует.
 *
 * Имя берётся из поля манифеста и обрезается по собачке: там пишут версию.
 * Поля нет — значит умолчание, npm.
 */
const PACKAGE_MANAGER = (() => {
  if (CONFIG.manifest == null) return "npm";
  const at = path.join(BASE, CONFIG.manifest);
  if (!existsSync(at)) return "npm";
  try {
    const declared = JSON.parse(readFileSync(at, "utf8")).packageManager;
    if (typeof declared !== "string" || declared === "") return "npm";
    return declared.split("@")[0];
  } catch {
    return "npm";
  }
})();

/** Имена скриптов, которые зовёт командная строка, — именем объявленного
 * менеджера. Один разбор на все сверки: каждая писала свой, и разошлись они
 * молча — связка читалась литералом `npm`, и на проекте с yarn сверка
 * «Связка проверок зовёт живые звенья» видела ноль вызовов и докладывала
 * живые звенья выпавшими. Кроме npm, менеджеры зовут скрипт и без `run`
 * (`yarn lint`), и эта форма у них основная. */
function scriptCallsIn(body) {
  const pm = PACKAGE_MANAGER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const calls = [];
  for (const piece of String(body ?? "").split("&&")) {
    const one = piece.trim();
    const run = new RegExp("^" + pm + "\\s+run\\s+([\\w:-]+)").exec(one);
    if (run !== null) calls.push(run[1]);
    else if (new RegExp("^" + pm + "\\s+test(?![\\w:-])").test(one))
      calls.push("test");
    else if (PACKAGE_MANAGER !== "npm") {
      const bare = new RegExp("^" + pm + "\\s+([\\w:-]+)").exec(one);
      if (bare !== null) calls.push(bare[1]);
    }
  }
  return calls;
}

/** Корни исходников, объявленные настройкой, и их ОБЩИЙ РОДИТЕЛЬ.
 *
 * Поле `src` держит либо один адрес, либо список: деревьев у проекта бывает
 * несколько — браузерное и серверное, — и общей папки у них может не быть
 * вовсе. Прежде поле было одним адресом, и такой проект описывал себя
 * корнем репозитория: работало это ценой того, что в корпус кода попадало
 * ВСЁ, что лежит рядом с деревьями, — папка сборочных сценариев, чужие
 * копии, служебные каталоги, — и отличить своё от соседского было нечем.
 *
 * Разделение такое. По ДЕРЕВЬЯМ ходят обходы: опись кода, опись прозы рядом
 * с кодом, поиск пустых папок и папок настроек. От ОБЩЕГО РОДИТЕЛЯ пишутся
 * и разрешаются адреса: база пишет `client/App.tsx`, и только так два
 * дерева с одинаковыми именами файлов внутри остаются различимы.
 *
 * У проекта с одним деревом общий родитель и есть это дерево, и всё
 * поведение остаётся прежним до буквы. */
const SRC_ROOTS = (Array.isArray(CONFIG.src) ? CONFIG.src : [CONFIG.src]).map(
  (one) => path.join(BASE, one).split(path.sep).join("/"),
);
const ROOT = (() => {
  if (SRC_ROOTS.length === 1) return SRC_ROOTS[0];
  const parts = SRC_ROOTS.map((one) => one.split("/"));
  const head = [];
  for (let i = 0; i < parts[0].length; i += 1) {
    const piece = parts[0][i];
    if (!parts.every((one) => one[i] === piece)) break;
    head.push(piece);
  }
  return head.join("/");
})();
/** Подстановки в рецептах фальсификации: пути, которые у каждого проекта свои.
 *
 * Рецепты пишутся один раз на все проекты, а раскладка у проектов разная.
 * Рецепт про папку узла, написанный путём `src/components/`, у библиотеки со
 * слоем `lib/`, у монорепозитория и у проекта без корня `src/` клал пробный
 * узел мимо слоя — его принимала сверка раскладки, а сверка README молчала,
 * и режим докладывал «поломка ушла не туда». Замерено фальсификацией на
 * посаженных стендах: на четырёх нестандартных раскладках — от `105` до `111`
 * пойманных из `127`.
 *
 * `{узлы}` — первый объявленный слой узлов, `{исходники}` — первое дерево
 * исходников; оба адресом от корня репозитория. `{файл кода}` — живой файл
 * кода в форме записи карты, однозначный по хвосту: рецепт про запись о
 * файле не может называть файл раскладки умолчания — у проекта без
 * `main.tsx` запись о нём принимала сверка покрытия карты, а не своя.
 * `{конфиг типов}` — первый конфиг, по которому звено типов реально
 * проверяет код: в монорепозитории и в раскладке со ссылками это не конфиг
 * корня.
 * `fresh` — ответ свежей посадки, по которой рецепт сверяется статически. */
const recipeVars = (fresh) => {
  if (fresh)
    return {
      "{узлы}": "src/components",
      "{исходники}": "src",
      "{файл кода}": "app/main.tsx",
      "{конфиг типов}": "tsconfig.json",
    };
  const repo = norm(path.join(BASE, ".."));
  const layer = (CONFIG.componentsAt ?? ["components"])[0];
  const fromRepo = (at) => path.relative(repo, at).split(path.sep).join("/");
  // Звёздную бочку сверка состава не разбирает — рецепт на ней промолчал бы.
  const mapForm = files
    .filter((f) => !isTest(f))
    .filter((f) => !/^\s*export\s+\*/m.test(readFileSync(f, "utf8")))
    .map((f) => rel(f));
  const single = mapForm
    .filter(
      (one) =>
        mapForm.filter((o) => o === one || o.endsWith("/" + one)).length === 1,
    )
    .sort();
  return {
    "{узлы}": fromRepo(path.join(ROOT, layer)),
    "{исходники}": fromRepo(SRC_ROOTS[0]),
    "{файл кода}": single[0] ?? "app/main.tsx",
    "{конфиг типов}": (() => {
      const first = typeCheckOptions()[0];
      return first === undefined ? "tsconfig.json" : fromRepo(first[0]);
    })(),
  };
};
/** Имя корневого скрипта, раздающего работу пакетам, чьи одноимённые
 * скрипты узнаются образцом звена; `null` — такого нет. */
const delegatedLink = (re, scripts) => {
  const rootAt = path.join(BASE, CONFIG.manifest ?? "../package.json");
  const globs = readJson(rootAt, {}).workspaces ?? [];
  const list = Array.isArray(globs) ? globs : (globs.packages ?? []);
  const packs = [];
  for (const g of list) {
    const dir = path.join(path.dirname(rootAt), String(g).replace(/\/\*$/, ""));
    if (!existsSync(dir)) continue;
    const one = path.join(dir, "package.json");
    if (!String(g).endsWith("/*")) {
      if (existsSync(one)) packs.push(readJson(one, {}));
      continue;
    }
    for (const e of readdirSync(dir)) {
      const at = path.join(dir, e, "package.json");
      if (existsSync(at)) packs.push(readJson(at, {}));
    }
  }
  for (const [name, body] of Object.entries(scripts)) {
    const m = /\bnpm run ([\w:-]+)\s+(?:--workspaces|-ws)\b/.exec(body);
    if (m === null) continue;
    if (packs.some((p) => re.test(p.scripts?.[m[1]] ?? ""))) return name;
  }
  return null;
};
/** Звено зовётся в манифесте — прямо либо делегированием пакетам. */
const linkCalled = (re, scripts) =>
  Object.values(scripts).some((body) => re.test(body)) ||
  delegatedLink(re, scripts) !== null;

/** Рецепт с подставленными путями — глубокой заменой по всем строкам. */
const recipeSubst = (recipe, vars) =>
  JSON.parse(
    JSON.stringify(recipe, (_, v) =>
      typeof v === "string"
        ? Object.entries(vars).reduce((s, [k, to]) => s.split(k).join(to), v)
        : v,
    ),
  );

/** Лежит ли файл В ОБЪЯВЛЕННОМ дереве. Спрашивается там, где корпус кода
 * собирается не обходом, а фильтром по уже собранному списку. */
const insideRoots = (f) =>
  SRC_ROOTS.some((one) => f === one || norm(f).startsWith(one + "/"));

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
// Песочница фальсификации — тоже вне дерева, и не только для копии. Она
// лежит ВНУТРИ репозитория минуты подряд, и любой прогон в это время —
// вторая консоль, крючок среды перед правкой, ворота коммита — видел полную
// копию проекта своим содержимым: незаявленные файлы правил, прозу мимо
// корпуса, код вне деревьев. Замерено: сверка базы, пущенная рядом с идущей
// фальсификацией, покраснела на десятках строк про песочницу. Прежде папка
// исключалась одной лишь копией, а обходы держали каждый свой список.
const OUT_OF_TREE = new Set([
  ".проба-сверок",
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

/** Корень проекта: папка над базой.
 *
 * Одна на модуль намеренно. Считалась она трижды — двумя локальными копиями
 * внутри режимов и третьей, которая понадобилась общему помощнику, — и
 * ровно на таком расхождении досье узла искало файл базы по пути
 * `.context/.context/…`. Величина, посчитанная в двух местах, однажды
 * расходится; посчитанная в трёх — расходится быстрее.
 */
const REPO_AT = path.join(BASE, "..");
const shelfAt = (tail) => (SHELF === null ? null : path.join(SHELF, tail));
/** Это МАСТЕРСКАЯ — репозиторий, где полку пишут и откуда её раздают.
 *
 * Узнаётся по списку публикации `.gitexclude-self`: он лежит в корне
 * репозитория раздачи и в проект не уезжает — посадка копирует одну папку
 * обвязки. Нужен сверкам, чей предмет — описание полки её же словами: в
 * посаженном проекте в `.claude` законно лежат и свои папки проекта, и
 * сверять с ними описание обвязки значило бы краснеть на чужом. */
const IN_WORKSHOP = existsSync(path.join(REPO_AT, ".gitexclude-self"));
/** Справочник режимов — лежит рядом с инструментом и читается из работы.
 *
 * Побайтовых пар здесь больше нет, и это следствие раскладки: доктрина,
 * инструмент и скиллы существуют в ОДНОМ экземпляре — в папке обвязки.
 * Пары сверяли копию с оригиналом; копии не стало, сверять нечего. Вместе с
 * ними ушло правило «поправил — скопируй на полку», из-за которого полка
 * после каждой посадки увозила состояние предыдущего проекта. */
const TOOL_MANUAL = "graph.md";
/** Строки ДАННЫХ таблицы, шапка которой стоит на строке `at`.
 *
 * Поле настройки, называющее шапку, естественно заполняют заголовком РАЗДЕЛА:
 * над таблицей стоит именно он, и слово «шапка» на него ложится само. Прежде
 * разбор просто отсчитывал две строки от найденной, и такое поле давало
 * правдоподобно неверный ответ без единого признака: сама шапка и разделитель
 * под ней шли в счёт как строки данных.
 *
 * Замерено на плане перехода: в таблице два шага, баннер печатал четыре — и
 * печатал бы столько же на любом плане, потому что ошибались всегда ровно на
 * две строки. Число правдоподобное, и потому непроверяемое на глаз.
 *
 * Форма требуется ОДНА и проверяется: строка шапки начинается с черты, под ней
 * разделитель. Принять оба написания было бы хуже — двух интерфейсов у одного
 * предмета не бывает, и следующее такое поле заполнили бы третьим способом.
 *
 * Тот же отсчёт стоял ещё в трёх местах — разделы планки, таблицы связей,
 * таблица сверок, — и все три ловили бы ту же ошибку молча. Помощник один на
 * всех: поправить его наполовину нельзя.
 */
const tableAfter = (lines, at) => {
  const head = lines[at] ?? "";
  const sep = lines[at + 1] ?? "";
  if (!head.trimStart().startsWith("|"))
    return {
      rows: [],
      problem:
        "шапкой таблицы объявлена не строка таблицы: «" + head.trim() + "»",
    };
  if (!/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(sep))
    return {
      rows: [],
      problem: "под шапкой таблицы нет разделителя: «" + sep.trim() + "»",
    };
  const rows = [];
  for (let i = at + 2; i < lines.length; i += 1) {
    if (!lines[i].trimStart().startsWith("|")) break;
    rows.push(lines[i]);
  }
  return { rows, problem: null };
};

/** Звенья цепочки, объявленные картой посадки. Корпус сразу нескольких
 * сверок: все они про этот список и ни про что другое. */
/** Семена, объявленные картой посадки, и отдельно — ОТЛОЖЕННЫЕ: те, что
 * посадка не кладёт, а кладёт первая правка, заведшая им предмет. Корпус
 * сразу нескольких сверок про семена. */
/** Предметы, за которыми карта посадки закрепляет свой файл базы: состояние,
 * порядок и прочие. Корпус сверок про то, что предмет из кода назван там,
 * где ему положено. */
const subjectsDeclared = (() => {
  const mapAt = shelfAt("seat/map.json");
  if (mapAt === null || !existsSync(mapAt)) return [];
  return JSON.parse(readFileSync(mapAt, "utf8")).onSubject ?? [];
})();

const seedsDeclared = (() => {
  const mapAt = shelfAt("seat/map.json");
  if (mapAt === null || !existsSync(mapAt)) return [];
  const m = JSON.parse(readFileSync(mapAt, "utf8"));
  return [...(m.copy ?? []), ...(m.onTransition ?? [])];
})();
const seedsDeferred = seedsDeclared.filter((c) => c.notAtSeating != null);

/** Имена файлов базы, под которые у полки есть семя И запись в карте. Одного
 * из двух мало: запись без семени кладёт пустоту, семя без записи не едет. */
const seededBase = () => {
  const out = new Set();
  const mapAt = shelfAt("seat/map.json");
  if (mapAt === null || !existsSync(mapAt)) return out;
  const m = readJson(mapAt, {});
  for (const one of [
    ...(m.copy ?? []),
    ...(m.onSubject ?? []),
    ...(m.onTransition ?? []),
  ]) {
    const name = path.basename(one.to ?? "");
    const seed = shelfAt(one.from ?? "");
    if (seed !== null && existsSync(seed)) out.add(name);
  }
  return out;
};

/** Вся проза ПОЛКИ парами «короткий адрес — полный путь»: доктрина,
 * инструкция посадки, справочник инструмента, памятки. Читают её чаще
 * всего остального, а в корпус текстовых сверок она входила не везде. */
const shelfProse = () => {
  if (SHELF === null) return [];
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const full = norm(path.join(dir, e));
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.endsWith(".md")) continue;
      out.push([
        path.relative(path.join(BASE, ".."), full).split(path.sep).join("/"),
        full,
      ]);
    }
  })(SHELF);
  return out;
};

const chainDeclared = (() => {
  const mapAt = shelfAt("seat/map.json");
  if (mapAt === null || !existsSync(mapAt)) return [];
  return JSON.parse(readFileSync(mapAt, "utf8")).chainScripts ?? [];
})();

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
  const { rows: scopeRows, problem: scopeProblem } = tableAfter(lines, head);
  if (scopeProblem !== null) return null;
  for (const row of scopeRows) {
    const cell = row.split("|");
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
/** Критерии планки поимённо: раздел, обозначение, название. Читаются из
 * самих файлов политики, а не объявляются рядом: объявленный список стал
 * бы вторым источником и соврал бы при первом переименовании раздела.
 *
 * Раздел и число критериев в нём давали проход по списку из десяти строк, а
 * критериев в этих строках сто восемьдесят. По числу проход не перечислить:
 * пропуск отдельного критерия не виден ни сессии, ни читателю отчёта, и
 * держался он тем, что сессия вспомнит про каждый. Найдено разработчиком.
 *
 * Название нужно затем, чтобы исход ставился против слов, а не против голого
 * обозначения. Полный текст критерия сюда не едет намеренно: это была бы
 * вторая редакция политики, и разошлась бы она с первой же правкой.
 */
const barCriteria = (file) => {
  if (file === null || !existsSync(file)) return [];
  const rows = readFileSync(file, "utf8").split(/\r?\n/);
  const out = [];
  let section = null;
  for (let i = 0; i < rows.length; i += 1) {
    const head = /^## ([A-ZА-Я])[.]\s+(.+)$/.exec(rows[i]);
    if (head !== null) {
      section = head[1];
      continue;
    }
    const one = /^[*][*]([A-ZА-Я][0-9]+(?:-[а-яё]+)?)[.]\s*(.*)$/.exec(rows[i]);
    if (one === null || section === null) continue;
    // Название критерия бывает в две строки: жирное открывается здесь, а
    // закрывается ниже. Обрыв по строке резал бы название посередине.
    let title = one[2];
    let j = i;
    while (!title.includes("**") && j + 1 < rows.length) {
      j += 1;
      title += " " + rows[j];
    }
    const end = title.indexOf("**");
    // Пометка стоит ПОСЛЕ закрытия жирного, то есть в хвосте, который
    // название уже не включает. Оттуда её и берут.
    const slogan = (end < 0 ? "" : title.slice(end)).includes("(лозунг)");
    out.push({
      section,
      id: one[1],
      slogan,
      title: (end < 0 ? title : title.slice(0, end))
        .split(/\s+/)
        .join(" ")
        .trim()
        .replace(/[.]$/, ""),
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
/** Живой набор критериев: ядро целиком плюс разделы по применимости,
 * объявленные живыми таблицей применимости.
 *
 * Слепота таблицы возвращается отдельным полем, а не молча суженным набором:
 * свод по одному ядру выглядел бы как полный проход и был бы им объявлен.
 */
const liveBarCriteria = () => {
  if (CONFIG.qualityScope == null) return null;
  const policy = path.join(BASE, CONFIG.qualityScope.policy);
  const core = barCriteria(policy.replace(/quality-scoped.md$/, "quality.md"));
  const scope = liveQualityScopes();
  const blind = scope.state !== "прочитано";
  const live = new Set(blind ? [] : scope.live);
  const scoped = barCriteria(policy).filter((c) => live.has(c.section));
  return { core, scoped, all: [...core, ...scoped], blind };
};

/** Формат протокола свода по планке — в одном месте.
 *
 * Пишет протокол режим `bar`, читает его сверка цепочки, и формат у них обязан
 * быть один. Объявленный дважды, он разошёлся бы первой же правкой: режим
 * ставил бы печать, которую сверка не признаёт, либо наоборот — и второе хуже,
 * потому что выглядит зелёным.
 */
const BAR_TICK = String.fromCharCode(96);
const BAR_NOSEAL = "- печать: " + BAR_TICK + "нет" + BAR_TICK;
/** Строка печати гасится с ЛЮБЫМ содержимым: иначе отпечаток включал бы сам
 * себя и сойтись не мог бы никогда. */
const BAR_NOSEAL_RE = new RegExp(
  "^- печать: " + BAR_TICK + ".*" + BAR_TICK + "$",
  "m",
);
const barQuoted = (x) => BAR_TICK + x + BAR_TICK;
const barDigest = (text) =>
  createHash("sha1")
    .update(
      text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)),
    )
    .digest("hex")
    .slice(0, 12);
/** Печать — отпечаток ВСЕГО протокола при погашенной строке печати.
 *
 * Не одного предмета: отпечаток предмета гасился правкой кода, но не правкой
 * самого протокола, и исход «нашлось» переписывался в «чисто» уже под печатью.
 * Правка одного файла из пяти обязана гасить свод целиком, и правка одной
 * строки исхода — тоже. */
const barSealOf = (text) =>
  barDigest(text.split(BAR_NOSEAL_RE).join(BAR_NOSEAL));
/** Отпечатки предмета. Путь держится АБСОЛЮТНЫМ: короткая форма считается от
 * корня исходников, и обратная склейка от корня репозитория била мимо — все
 * отпечатки выходили меткой «нет файла». */
const barMarks = (abs) =>
  abs.map((f) => ({
    file: rel(f),
    mark: existsSync(f) ? barDigest(readFileSync(f, "utf8")) : "нет файла",
  }));
/** Предмет свода на задаче ИЗМЕНЕНИЯ: правленый код и стили.
 *
 * Возвращает `null`, когда состояние репозитория прочитать не удалось. Это не
 * «правленого нет»: сверке нечего смотреть, и молчать об этом нельзя — зелёное
 * от слепоты неотличимо от зелёного от здоровья. */
const barChangedSubject = async (repoRoot) => {
  const changed = await changedPaths(repoRoot);
  if (changed === null) return null;
  const all = changed.map((f) => norm(path.join(repoRoot, f)));
  // Семя, лежащее нетронутым, — работа обвязки, а не проекта, и свода на него
  // не спрашивают. Признак тот же, что у ворот и у ревизии, и применяется он
  // ЗДЕСЬ ТОЖЕ: сперва я поставил его в двух местах из трёх, и предмет свода
  // разошёлся с предметом ворот — протокол называл файл, который ворота уже
  // пропускали. Замерено на стенде, тем же заходом, что и завёл правило.
  const seeds = seedOfPath();
  const untouched = (at) => untouchedSeed(at, repoRoot, seeds);
  return (
    await withoutFormatOnly(
      all.filter(
        (f) =>
          (files.includes(f) || styleFiles.includes(f)) &&
          !f.endsWith(".d.ts") &&
          !untouched(f),
      ),
      repoRoot,
    )
  ).sort((x, y) => (rel(x) < rel(y) ? -1 : 1));
};
/** Шапка протокола, разобранная: род, отпечатки предмета, печать. */
/** Путь против списка образцов Stryker: включающие и исключающие.
 *
 * Общий намеренно. Режим долга спрашивает им, что лежит в области прогона, а
 * сверка исполнимости — совпала ли область хоть с чем-нибудь. Свой матчер у
 * каждого разошёлся бы при первом же образце нового вида.
 */
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

/** Файлы проекта, попавшие в область мутационного прогона.
 *
 * Область берётся из конфига самого Stryker, а не из настройки обвязки:
 * считать по всему корню исходников значило бы врать — часть файлов исключена
 * намеренно и с записанной причиной.
 */
const mutationArea = () => {
  if (CONFIG.mutationConfig == null) return [];
  const at = path.join(BASE, CONFIG.mutationConfig);
  if (!existsSync(at)) return [];
  const globs = readJson(at, {}).mutate ?? [];
  if (!globs.length) return [];
  const inside = globsToTest(globs);
  // Путь считается от КОРНЯ РЕПОЗИТОРИЯ: образцы в конфиге Stryker написаны
  // от него же. Форма та же, какой пользуется режим долга.
  const key = (f) => norm(path.relative(REPO_AT, f));
  return [...files, ...styleFiles].filter((f) => inside(key(f)));
};
/** Шапка протокола из ТЕКСТА. Ревизия читает протокол из истории — файла с
 * таким содержимым на диске нет, и путь ей передать нечего. */
const barHeaderOf = (body) => {
  const kind = new RegExp(
    "^- род: " + BAR_TICK + "(.+)" + BAR_TICK + "$",
    "m",
  ).exec(body);
  const seal = new RegExp(
    "^- печать: " + BAR_TICK + "(.+)" + BAR_TICK + "$",
    "m",
  ).exec(body);
  const rowOf = new RegExp(
    "^\\| " +
      BAR_TICK +
      "([^" +
      BAR_TICK +
      "]+)" +
      BAR_TICK +
      " \\| " +
      BAR_TICK +
      "([^" +
      BAR_TICK +
      "]+)" +
      BAR_TICK +
      " \\|$",
    "gm",
  );
  return {
    body,
    kind: kind === null ? null : kind[1],
    seal: seal === null ? null : seal[1],
    marks: [...body.matchAll(rowOf)].map((h) => ({ file: h[1], mark: h[2] })),
  };
};
const barHeader = (at) =>
  at === null || !existsSync(at) ? null : barHeaderOf(readFileSync(at, "utf8"));

/** Путь проекта → путь его семени на полке. Пусто, если карты рядом нет. */
const seedOfPath = () => {
  const mapAt = shelfAt("seat/map.json");
  const out = new Map();
  if (mapAt === null || !existsSync(mapAt)) return out;
  for (const e of readJson(mapAt, {}).copy ?? []) out.set(e.to, e.from);
  return out;
};

/** Лежит ли файл ТЕМ ЖЕ, каким его положило семя.
 *
 * Признак не новый: им же сверка «Каркас не отстал от семени» решает, живёт
 * ли проект каркасом, и сверка «Каркас обвязки не лежит в живом проекте» —
 * мусор ли он. Здесь он отвечает на третий вопрос того же рода: чья это
 * работа. Код, приехавший с полки и не тронутый, написан обвязкой, и свода по
 * планке на него не спрашивают — иначе ворота не пропускали бы саму посадку.
 *
 * Концы строк приводятся к одному виду: снимок едет между машинами, и
 * побайтовое сравнение расходилось бы на каждой строке, ничего не говоря о
 * содержимом.
 *
 * Тело семени подаёт зовущий: ворота читают его с диска, ревизия — из того
 * коммита, который судит. Сравнение при этом одно.
 */
const sameAsSeed = (body, seedBody) => {
  if (seedBody === null) return false;
  const eol = String.fromCharCode(13) + String.fromCharCode(10);
  const flat = (t) => t.split(eol).join(String.fromCharCode(10));
  return flat(body) === flat(seedBody);
};
/** Prettier ЭТОГО проекта, загруженный один раз; `null` — его нет. */
let PRETTIER_HERE;
const prettierHere = async () => {
  if (PRETTIER_HERE !== undefined) return PRETTIER_HERE;
  PRETTIER_HERE = null;
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const at = createRequire(path.join(REPO_AT, "package.json")).resolve(
      "prettier",
    );
    const mod = await import(pathToFileURL(at).href);
    PRETTIER_HERE = typeof mod.format === "function" ? mod : mod.default;
  } catch {
    PRETTIER_HERE = null;
  }
  return PRETTIER_HERE;
};
/** Правка — ОДНО ЛИШЬ приведение формата: прежнее содержимое, пропущенное
 * через форматтер проекта с его настройками, даёт ровно новое.
 *
 * Такая правка механическая, и планка к ней не относится — это сказано в
 * инструкции посадки прямо. А ворота спрашивали свод с любого кода в индексе,
 * и отдельный коммит формата, которого фаза 2 требует, не проходил в любом
 * проекте, чей код форматтер переписывает. На стендах это не проявилось
 * только потому, что их код был написан уже в формате. Замерено на копии
 * стенда: старый код без формата, приведение, коммит — «свода нет вовсе».
 *
 * Спрашивают его те же четыре места, что и признак нетронутого семени, —
 * ворота, ревизия по истории, предмет свода и след вопроса о планке, — и
 * разойтись им нечем: ответ даёт эта функция. Правка, смешавшая формат со
 * смыслом, приведением не является: форматтер её не воспроизводит. */
const formatOnly = async (before, after, abs) => {
  if (before === null || after === null) return false;
  const eol = String.fromCharCode(13) + String.fromCharCode(10);
  const flat = (t) => t.split(eol).join(String.fromCharCode(10));
  if (flat(before) === flat(after)) return false;
  const p = await prettierHere();
  if (p === null) return false;
  try {
    const options = (await p.resolveConfig(abs)) ?? {};
    const pretty = await p.format(flat(before), { ...options, filepath: abs });
    return pretty === flat(after);
  } catch {
    return false;
  }
};
/** Правленые файлы без тех, чья правка — одно приведение формата. Прежнее
 * содержимое берётся из последнего коммита. */
const withoutFormatOnly = async (abs, repoRoot) => {
  const out = [];
  for (const f of abs) {
    const one = path.relative(repoRoot, f).split(path.sep).join("/");
    let head = null;
    try {
      head = execFileSync("git", ["show", "HEAD:" + one], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      head = null;
    }
    const now = existsSync(f) ? readFileSync(f, "utf8") : null;
    if (await formatOnly(head, now, f)) continue;
    out.push(f);
  }
  return out;
};
/** ЛЕЖИТ ЛИ файл нетронутым семенем: работа обвязки, а не проекта.
 *
 * Помощник общий потому, что признак этот спрашивают в ЧЕТЫРЁХ местах —
 * ворота, ревизия, предмет свода и след прогона, — и разойтись им нельзя.
 * Пока он стоял местной функцией внутри предмета свода, четвёртое место
 * его не получило: свод отвечал «правленого нет», а сверка следа требовала
 * по тому же файлу вопроса, которого свод задать не мог. Выхода из красного
 * прогона не было. Замерено посадкой живого стенда — на общем помощнике
 * слияния карт классов, приехавшем семенем и никем не тронутом. */
const untouchedSeed = (at, repoRoot, seeds) => {
  const to = norm(path.relative(repoRoot, at));
  const from = seeds.has(to) ? shelfAt(seeds.get(to)) : null;
  if (from === null || !existsSync(from) || !existsSync(at)) return false;
  return (
    SEEDS_REFORMATTED.has(to) ||
    sameAsSeed(readFileSync(at, "utf8"), readFileSync(from, "utf8"))
  );
};
/** ПОКРЫТ ЛИ набор файлов кода запечатанным сводом. Пустая строка — покрыт,
 * иначе причина словами.
 *
 * Помощник общий намеренно, и это не та же ошибка, что чинилась здесь
 * трижды. Сторон у требования две, и они разного рода: ворота — хук перед
 * коммитом, который правку без свода не пропускает, — и ревизия, сверка по
 * истории, которая обход ворот делает вечно красным. Ворота нельзя сделать
 * абсолютными: хук лежит в `.git`, с клоном не едет и снимается флагом
 * `--no-verify`. Ревизия обход не предотвращает, но и не забывает.
 *
 * Разойтись им нечем: обе спрашивают ЭТУ функцию.
 *
 * @param want [{file, mark}] — файлы предмета с отпечатками их содержимого
 * @param body текст протокола, либо null — протокола нет
 */
const barCoverFault = (want, body) => {
  if (!want.length) return "";
  if (body === null) return "свода нет вовсе";
  const was = barHeaderOf(body);
  if (was.kind !== "на изменение")
    return "свод сделан на задаче чтения, а правленый код есть";
  if (was.seal === null || was.seal === "нет")
    return "печати нет: свод начат и не закончен";
  if (was.seal !== barSealOf(body))
    return "печать не сходится: протокол правлен после того, как закрыт";
  const had = new Map(was.marks.map((m) => [m.file, m.mark]));
  const loose = [];
  for (const one of want) {
    const mark = had.get(one.file);
    if (mark === undefined) loose.push(one.file + " — в своде не назван");
    else if (mark !== one.mark)
      loose.push(one.file + " — свод сделан на другом его виде");
    had.delete(one.file);
  }
  for (const file of had.keys())
    loose.push(file + " — назван сводом, а в правке его нет");
  return loose.join("; ");
};
const barSameMarks = (was, now) =>
  was.length === now.length &&
  now.every((m, i) => was[i].file === m.file && was[i].mark === m.mark);

/** Песочная копия дерева проекта: снимок, на котором можно ломать.
 *
 * Жила внутри фальсификации. Вторая копия стала бы вторым источником и
 * разошлась бы с первой ровно тогда, когда в исключения добавят папку, —
 * то есть в тот единственный момент, когда расхождение опасно.
 *
 * Папки самих песочниц исключены общим списком того, что вне дерева: копия
 * копии смысла не имеет, а весит столько же. */
const sandboxTree = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) {
    if (OUT_OF_TREE.has(e)) continue;
    const src = path.join(from, e);
    if (statSync(src).isDirectory()) sandboxTree(src, path.join(to, e));
    else {
      writeFileSync(path.join(to, e), readFileSync(src));
      // Режим — часть файла: хук без бита исполнения git пропускает молча.
      chmodSync(path.join(to, e), statSync(src).mode & 0o777);
    }
  }
};

/** Манифесты установленных пакетов — и только они.
 *
 * Папка зависимостей в песочницу не копируется: она весит сотни мегабайт и
 * к содержимому сверок отношения не имеет. Но сверка версий читает именно
 * её — номер версии лежит в манифесте каждого пакета, — и в песочнице ей
 * нечего было читать: она не краснела НИКОГДА, то есть рецепта под неё не
 * существовало в принципе. Манифесты весят килобайты, и этого довольно.
 *
 * Найдено при выплате долга рецептов: поломка, работающая на самом проекте,
 * в песочнице молчала. */
const sandboxManifests = (from, to) => {
  if (!existsSync(from)) return;
  for (const e of readdirSync(from)) {
    const dir = path.join(from, e);
    if (!statSync(dir).isDirectory()) continue;
    if (e.startsWith("@")) {
      sandboxManifests(dir, path.join(to, e));
      continue;
    }
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    mkdirSync(path.join(to, e), { recursive: true });
    writeFileSync(path.join(to, e, "package.json"), readFileSync(manifest));
  }
};
/** ЧУЖИЕ связи через разметку и стили: имена, у которых один конец внутри
 * репозитория есть, а второго нет.
 *
 * Таблица связей объявлена веткой чужого, и только его (`quality.md`,
 * критерий `C7-бис`): связь, оба конца которой твои, не объявляется, а
 * сводится к одному источнику конструкцией. Прежде предмет искался ровно
 * наоборот — по совпадению обоих концов внутри репозитория, — и посадка в
 * проект с модулями стилей требовала объявить то, что доктрина запрещает.
 *
 * Сигналов два, и оба перечислимы честно:
 *   переменная стиля читается нашими листами и не объявлена ни одним;
 *   атрибут разметки есть в наших стилях и не встречается в нашем коде.
 *
 * Третий сигнал — имена классов — снят намеренно. Он находил СВОЁ
 * дублирование, а обратить его нечем: «имя, названное кодом и не
 * объявленное листом» — это любая строка и любое обращение к полю. Своё
 * держит свод по планке тем же критерием.
 */
/** Чем база должна ОДНОМУ файлу кода: предметы, которые в нём есть, а в
 * своём файле базы не названы.
 *
 * Помощник общий намеренно. Досье и сверка спрашивали одно и то же двумя
 * кусками кода, и они разошлись: сверка строила путь файла базы от КОРНЯ
 * проекта, досье — от папки базы, то есть искало `.context/.context/…`.
 * Такого пути нет никогда, и досье докладывало «файла базы нет вовсе» на
 * файл, который тем же выводом цитировало строкой выше. Раздел долга в нём
 * не работал ни разу с заведения.
 *
 * Комментарий соседнего раздела предупреждал ровно об этом — «два сканера
 * одного и того же с разными правилами — это гарантия однажды разойтись», —
 * и предупреждал о ДРУГОЙ паре. Поэтому чинится не корень пути, а пара.
 */
const owedFor = (file) => {
  const out = [];
  const mapAt = shelfAt("seat/map.json");
  if (mapAt === null || !existsSync(mapAt)) return out;
  const body = readFileSync(file, "utf8");
  for (const one of readJson(mapAt, {}).onSubject ?? []) {
    const re = BRIEF_SUBJECTS[one.subject];
    if (re === undefined) continue;
    if (!re.test(body)) continue;
    const at = path.join(REPO_AT, one.to);
    if (!existsSync(at)) {
      out.push({ to: one.to, subject: one.subject, why: "нет файла" });
      continue;
    }
    if (readFileSync(at, "utf8").includes(rel(file))) continue;
    out.push({ to: one.to, subject: one.subject, why: "не назван" });
  }
  return out;
};
const foreignLinks = () => {
  const declared = new Set();
  const used = new Map();
  for (const f of styleFiles) {
    const body = codeOf(readFileSync(f, "utf8"));
    for (const m of body.matchAll(CSS_VAR_DECL)) declared.add(m[1]);
    for (const m of body.matchAll(CSS_VAR_USE))
      if (!used.has(m[1])) used.set(m[1], f);
  }
  // Переменную ставит не только лист стилей: код задаёт её объектом стилей,
  // и тогда оба конца связи СВОИ.
  //
  // Прежде объявления собирались только из листов, и переменная, которую
  // ставит `.tsx`, а читает лист рядом, объявлялась ЧУЖОЙ — то есть сверка
  // требовала записать её в таблицу связей с хостом, а сама таблица тем же
  // правилом требует чужую связь и только её. Замерено ревизией стенда:
  // база несла строку «`--unit-width` ставит вызывающий снаружи проекта»,
  // хотя ставит её соседний файл того же узла. Снять строку было нельзя —
  // сверка возвращала её обратно.
  const STYLE_PROP = /["'](--[a-zA-Z0-9_-]+)["']\s*:/g;
  for (const f of files) {
    if (isTest(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(STYLE_PROP))
      declared.add(m[1]);
  }
  const namesIn = (list) => {
    const found = new Map();
    for (const f of list)
      for (const m of codeOf(readFileSync(f, "utf8")).matchAll(DATA_ATTR))
        if (!found.has(m[0])) found.set(m[0], f);
    return found;
  };
  const inStyles = namesIn(styleFiles);
  const inCode = namesIn(files.filter((f) => !isTest(f)));
  return {
    vars: [...used]
      .filter(([name]) => !declared.has(name))
      .map(([name, where]) => ({ name, where: rel(where) })),
    attrs: [...inStyles]
      .filter(([name]) => !inCode.has(name))
      .map(([name, where]) => ({ name, where: rel(where) })),
  };
};
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

/** Папка обвязки — НИКОГДА не код проекта, куда бы ни указывал корень исходников.
 *
 * Обычно корень исходников лежит глубже полки, и вопрос не встаёт. Но проект с
 * ДВУМЯ корнями — скажем, браузерным и серверным — описать одним полем нельзя
 * иначе, чем указав на их общего родителя, а общий родитель у них — корень
 * репозитория. И тогда обход забирает полку целиком.
 *
 * Замерено на таком проекте: в «код проекта» попали три СЕМЕНИ обвязки — её
 * конфиг линта, её точка входа, её конфиг сборщика, — и покрытие карты
 * потребовало описать их наравне с кодом. Проект не может закрыть это в
 * принципе: файлы не его, править их он не вправе.
 *
 * Исключение здесь, а не в списке имён папок: имя полки задаёт проект, и
 * списком голых имён его не выразить.
 */
const insideShelf = (full) =>
  SHELF !== null &&
  (full === norm(SHELF) || full.startsWith(norm(SHELF) + "/"));

/** Текст без огороженных блоков: строки примера заменяются пустыми.
 *
 * Огороженный блок — ПРИМЕР, а не заявление о проекте. Сканеров прозы у
 * инструмента четыре — адреса в обратных кавычках, ссылки markdown, номера
 * пунктов отложенного и разбор таблиц базы, — и ни один из них про блоки не
 * знал. Пока примеров в базе не было, это молчало; появились — и каждый стал
 * заявлением: путь из примера потребовали найти на диске, номер из примера стал
 * живым пунктом.
 *
 * Замерено на собственном семени: показать форму записи примером стало нельзя —
 * снимок переставал собираться на СВОЁМ ЖЕ образце. А показывать надо: две
 * находки подряд были ровно о том, что форму записи описали словами и её
 * поняли не так.
 *
 * Строки заменяются пустыми, а не удаляются: номера строк называются в выводе,
 * и сдвиг их сделал бы находку неадресуемой.
 */
const unfenced = (text) => {
  // Перевод строки литералом: помощник объявлен выше общей константы, и
  // обращение к ней здесь падало бы на загрузке модуля.
  const EOL = String.fromCharCode(10);
  let fenced = false;
  return text
    .split(EOL)
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join(EOL);
};

/** Строковые литералы исходника — разбором, а не парами кавычек по тексту.
 *
 * Апостроф в комментарии — «Prettier's job», «React's act» — для образца,
 * ищущего пары кавычек, это ОТКРЫВАЮЩАЯ кавычка. Дальше пары сдвигаются, и
 * настоящие литералы файла в разбор не попадают вовсе.
 *
 * Замерено на копии настоящего проекта: конфиг линта исключал папку обвязки
 * первой же строкой списка, а сверка этого исключения не видела и требовала
 * добавить его снова. Ложное срабатывание на здоровом устройстве — и ровно
 * того рода, который учит не читать вывод.
 *
 * Тот же класс уже ловили на конфиге компилятора: там образец блочного
 * комментария съедал маску путей изнутри строки. Поэтому здесь сканер, а не
 * образец: он знает, где строка, а где комментарий, и отвечает на один
 * вопрос — какие литералы в файле есть.
 */
const literalsOf = (text) => {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let out1 = "";
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          out1 += text[i + 1] ?? "";
          i += 2;
          continue;
        }
        out1 += text[i];
        i += 1;
      }
      i += 1;
      out.push(out1);
      continue;
    }
    i += 1;
  }
  return out;
};
/** Вне описи ли эта запись — ОДИН вопрос и один ответ на весь инструмент.
 *
 * Обходов дерева три, и каждый спрашивал это по-своему: один смотрел список
 * служебных имён, другой не смотрел ничего. Пока корень исходников лежал глубже
 * полки и глубже папки зависимостей, разницы не было видно. Корень, равный
 * корню репозитория, показал её сразу: покрытие карты потребовало описать пять
 * файлов стилей ИЗ ПАПКИ ЗАВИСИМОСТЕЙ, а замер объёма чтения тех же файлов не
 * видел — два числа об одном предмете разошлись молча.
 *
 * Тот же класс ловили уже дважды: зашитый корень в двух обходах и язык стилей в
 * четырёх местах порознь. Поэтому вопрос теперь один, и поправить его наполовину
 * нельзя.
 */
/** Настройка, приехавшая семенем и лежащая В КОРНЕ репозитория, — файл
 * ОБВЯЗКИ, а не код проекта, куда бы ни указывал корень исходников.
 *
 * Рядом уже стоит исключение для папки полки, и повод у него тот же: проект
 * с двумя деревьями описывает корень исходников их общим родителем, а общий
 * родитель — корень репозитория. Полку обход после того исключения не
 * забирает, а конфиги линтера, сборщика и компилятора — забирал.
 *
 * Замерено посадкой такого стенда: прогон выдал `восемь` находок про длину
 * комментария в привезённом конфиге линта, пометку решения в нём же и
 * русский комментарий в нём же. Обвязка судила СВОЙ текст правилами
 * проекта, и закрыть это проект не может: файлы не его.
 *
 * Адреса берутся из карты посадки, а не списком имён: состав семян растёт,
 * а список отставал бы молча. */
const ROOT_SEEDS = (() => {
  const out = new Set();
  const mapAt = shelfAt("seat/map.json");
  if (mapAt === null || !existsSync(mapAt)) return out;
  let map = null;
  try {
    map = JSON.parse(readFileSync(mapAt, "utf8"));
  } catch {
    return out;
  }
  for (const e of map.copy ?? [])
    if (!e.to.includes("/")) out.add(norm(path.join(REPO_AT, e.to)));
  return out;
})();

const outOfTree = (name, full) =>
  OUT_OF_TREE.has(name) ||
  insideShelf(norm(full)) ||
  ROOT_SEEDS.has(norm(full));

const collect = (dir) => {
  if (!walkable(dir)) return;
  for (const e of readdirSync(dir)) {
    if (outOfTree(e, path.join(dir, e))) continue;
    const full = norm(path.join(dir, e));
    if (statSync(full).isDirectory()) collect(full);
    else if (/\.[jt]sx?$/.test(e)) {
      if (!files.includes(full)) files.push(full);
    } else if (/\.md$/.test(e) && !isMachinery(full)) docFiles.push(full);
    else if (isStylePath(full) && !styleFiles.includes(full))
      styleFiles.push(full);
  }
};
for (const one of SRC_ROOTS) collect(one);

// Папки с тестами, лежащие ВНЕ корня исходников.
//
// Обход выше идёт по корню исходников, и живой проект вправе держать тесты
// рядом с ним, а не внутри: `__tests__/` соседом с `lib/` — раскладка не реже
// объявленной. Пока эти папки не обходились, инструмент отвечал «тестовых
// файлов: ноль» на проекте, где раннер собирал тридцать шесть зелёных тестов, а
// сверка покрытия тестов была ЗЕЛЕНОЙ, потому что ей нечего было проверять.
//
// Раскладка от этого не становится объявленной: сверка «Тесты лежат в `tests/`»
// продолжает их называть, и цена отступления платится списком исключений. Но
// НЕВИДИМОСТЬ и НЕСОГЛАСИЕ — разные вещи, и вторая лучше первой: несогласие
// печатается, невидимость молчит.
for (const one of CONFIG.testDirs ?? []) collect(norm(path.join(BASE, one)));

// Семена, которые переписал ОДИН форматтер проекта: пути от корня репозитория.
//
// Проект со своим форматом приводит к нему и привезённое — и семя переставало
// быть семенем: ворота требовали свода по всей планке на самой посадке, а
// корпус своего кода получал файлы обвязки. Признак тот же, что у приведения
// формата: форматтер проекта по семени даёт ровно лежащее. Считается один
// раз и только по расходящимся семенам кода: у проекта, где их нет,
// форматтер не грузится вовсе.
const SEEDS_REFORMATTED = await (async () => {
  const out = new Set();
  for (const [to, from] of seedOfPath()) {
    const abs = norm(path.join(REPO_AT, to));
    if (!files.includes(abs) && !styleFiles.includes(abs)) continue;
    const at = shelfAt(from);
    if (at === null || !existsSync(at) || !existsSync(abs)) continue;
    const seed = readFileSync(at, "utf8");
    const now = readFileSync(abs, "utf8");
    if (!sameAsSeed(now, seed) && (await formatOnly(seed, now, abs)))
      out.add(to);
  }
  return out;
})();

/** Словарь условий `onlyWith` из карты посадки: условие → выполнено ли оно у
 * проекта. Семя с условием кладётся только при его предмете; объяснение
 * словаря — в самой карте, полем `_onlyWith`. */
const SEED_CONDITIONS = new Map([
  [
    "cssModules",
    () => {
      const seeds = seedOfPath();
      const own = [...files, ...styleFiles].filter(
        (f) => !untouchedSeed(f, REPO_AT, seeds),
      );
      // Проект, который стилизует ИНАЧЕ, узнаётся по листам без модулей.
      // Листов нет вовсе — стилизации ещё нет, и умолчание в силе.
      return (
        own.length === 0 ||
        styleFiles.length === 0 ||
        styleFiles.some((f) => /\.module\.[a-z]+$/.test(f))
      );
    },
  ],
  [
    "runnerWithoutGlobals",
    () =>
      ![
        "vitest.config.ts",
        "vitest.config.js",
        "vitest.config.mts",
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mts",
      ].some((n) => {
        const at = path.join(REPO_AT, n);
        return (
          existsSync(at) && /\bglobals:\s*true\b/.test(readFileSync(at, "utf8"))
        );
      }),
  ],
]);
/** Выполнено ли у проекта условие семени. Семя без условия кладётся всегда;
 * условие не из словаря называет сверка «Семя с условием не лежит без
 * условия», а здесь оно читается выполненным — отказать молча нельзя. */
const seedConditionHolds = (e) =>
  e.onlyWith == null || (SEED_CONDITIONS.get(e.onlyWith)?.() ?? true);

// Документы, лежащие ВНЕ исходников. Обход выше идёт по корню исходников, и
// папка документации в корне репозитория не попадала в корпус ни одной
// текстовой сверки: её адреса, имена из кода и ссылки не проверялись вовсе.
// Найдено первым же прогоном сверки «Проза целиком попадает в корпус сверок» —
// то есть сверка, заведённая под этот класс, нашла его экземпляр сразу.
if (CONFIG.docsIndex != null) {
  (function walkDocs(dir) {
    if (!walkable(dir)) return;
    for (const e of readdirSync(dir)) {
      const full = norm(path.join(dir, e));
      if (statSync(full).isDirectory()) walkDocs(full);
      else if (/.md$/.test(e) && !docFiles.includes(full)) docFiles.push(full);
    }
  })(norm(path.join(BASE, CONFIG.docsIndex.dir)));
}

// Документы, лежащие РЯДОМ С КОДОМ, — тот же корпус.
//
// Свод описывает пять видов документов, и три из них живут у компонента:
// README папки, устройство слоя, решение. Корпус же собирался по одной
// папке, названной настройкой, и покомпонентный документ не проверялся
// ничем — ни якоря в нём, ни имена из кода, ни ссылки. Это ровно тот класс,
// которым когда-то нашлась и сама папка документации.
// Деревьев исходников бывает несколько, и обход зовётся по каждому.
const walkNear = (dir) => {
  if (!walkable(dir)) return;
  for (const e of readdirSync(dir)) {
    const full = norm(path.join(dir, e));
    // Общее исключение спрашивается и здесь. Пока корень исходников лежал
    // глубже зависимостей, вопрос не вставал; проект с двумя деревьями
    // объявляет корнем корень репозитория — и в корпус прозы поехали
    // `CHANGELOG` и `README` чужих пакетов. Замерено посадкой такого стенда.
    if (outOfTree(e, full)) continue;
    if (statSync(full).isDirectory()) walkNear(full);
    else if (/\.md$/.test(e) && !docFiles.includes(full)) docFiles.push(full);
  }
};
for (const one of SRC_ROOTS) walkNear(one);

const isTest = isTestPath;

/** Образцы ПРЕДМЕТА файлов базы, кладущихся по находке: состояние и порядок.
 *
 * Один набор на весь инструмент. Спрашивают его двое — сверка, требующая
 * завести файл и назвать в нём адрес, и очерченная область, называющая долг
 * про тот файл, который очерчивает. Два набора разошлись бы молча: оба
 * зелёные, а считают разное.
 */
const BRIEF_SUBJECTS = {
  // Имён СТОЛЬКО ЖЕ, сколько их в определении состояния из файла базы:
  // «всё, что переживает отрисовку». Идентификатор, значение контекста и
  // подписка на внешнее хранилище переживают её наравне с хуком состояния и
  // ссылкой. Замерено чтением стенда кнопки: всё её состояние — один `useId`,
  // файла базы под предмет не завелось, и сверка промолчала — предмета для
  // неё не было вовсе.
  // Имя, за которым идёт круглая ИЛИ угловая скобка: `useState<Set<string>>(`
  // это тот же предмет, а выражение с одной круглой его не видело. Поймано
  // полигоном: компонент с двумя состояниями и тремя ссылками прошёл как
  // «предмета нет».
  // Хранилище браузера — тоже состояние, и доктрина называет его прямо:
  // предмет файла базы есть «хук состояния, ссылка между отрисовками,
  // ХРАНИЛИЩЕ». Инструмент знал одни хуки, и проект, держащий тему в
  // localStorage, файла состояния не получал вовсе — при том что состояние у
  // него переживает не отрисовку, а весь сеанс. Требование стояло, ловца не
  // было: тот же класс, что у мутационной настройки и у таблицы связей.
  state: new RegExp(
    "\\buseState\\s*[\\(<]|\\buseRef\\s*[\\(<]|\\buseReducer\\s*[\\(<]|\\buseId\\s*[\\(<]|\\buseContext\\s*[\\(<]|\\buseSyncExternalStore\\s*[\\(<]|\\blocalStorage\\b|\\bsessionStorage\\b|\\bindexedDB\\b",
  ),
  timing: new RegExp(
    "\\buseEffect\\s*[\\(<]|\\buseLayoutEffect\\s*[\\(<]|\\bsetTimeout\\s*[\\(<]|\\bsetInterval\\s*[\\(<]|\\brequestAnimationFrame\\s*[\\(<]",
  ),
};

/** Идёт ли посадка. ЕДИНСТВЕННОЕ чтение флага на весь инструмент.
 *
 * Флаг принимает `null`, `0` и `1`, и прежде его читали двумя разными
 * способами: баннер — «не null», сверки — «не ноль». Посадка, снявшая его в
 * ноль, получала вечный баннер «посадка не завершена» при зелёном прогоне.
 */
const seatingIsUp = () => CONFIG.seating != null && CONFIG.seating !== 0;

/** Потолок слитного ряда двух косых, В СЛОВАХ.
 *
 * Число не выдумано. Свод документации приводит собственный образец
 * хорошего комментария — «счётчик читает цикл повтора, поэтому он обязан
 * пережить ранний выход», — и слов в нём ровно столько. Потолок равен
 * образцу, который свод уже объявил правильным.
 *
 * Мера — слово, а не строка: строка это формат, и порог по строкам зависел
 * бы от ширины поля форматтера.
 */
const COMMENT_RUN_WORDS = 15;

/** Потолок блока в звёздочках, В СЛОВАХ.
 *
 * Вдвое больше ряда: назначение другое — блок держит контракт узла, что он
 * обещает, чего требует, чего не делает. Один порог на оба рода означал бы,
 * что строгий запрещает контракт, а мягкий разрешает поэму.
 *
 * Строки с тегом в счёт не идут — их снимает сам предикат.
 */
const COMMENT_BLOCK_WORDS = 30;

/** Потолок доли строк комментария в файле и наименьший меримый файл.
 *
 * Пословный потолок ловит поэму в одном месте и не ловит полсотни коротких
 * комментариев подряд. Доля ловит второе.
 *
 * Замерено: у эталонного проекта доля 13,4 %, у приложения, написанного с
 * нуля под этой обвязкой, — 29 %.
 *
 * Файл короче порога не меряется вовсе: в коротком файле доля скачет от
 * одного комментария и не значит ничего.
 *
 * Порог длины замерен, а не назначен. При тридцати строках сверка краснела на
 * компоненте в тридцать шесть строк с ЧЕТЫРЬМЯ короткими комментариями, каждый
 * из которых прошёл пословный потолок и каждый по делу. Это не поэма, а её
 * противоположность — и сверка, красная на законном, перестаёт читаться.
 * Шестьдесят строк означают, что для срабатывания нужно семь строк
 * комментария, то есть та самая россыпь, ради которой доля и заведена.
 */
const COMMENT_SHARE = 0.1;
const COMMENT_SHARE_FLOOR = 60;

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

/** Короткий адрес файла: от корня исходников, а для лежащих вне его — от корня
 * репозитория.
 *
 * Вторая половина заведена по случаю: тесты живого проекта умеют лежать рядом с
 * корнем исходников, а не внутри, и для них замена префикса не срабатывала
 * вовсе — в реестр и в вывод шёл полный путь с буквой диска. Записанный в базу,
 * он сделал бы её непереносимой между машинами. */
const rel = (f) =>
  f.startsWith(ROOT + "/")
    ? f.slice(ROOT.length + 1)
    : norm(path.relative(path.join(BASE, ".."), f));

/** Конфиг с комментариями: `tsconfig.json` их допускает, `JSON.parse` — нет.
 * `null` — разобрать не удалось. Один разбор на всех, кто читает конфиг
 * компилятора: короткие адреса и строгость. */
const parseJsonc = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    // Конфиг компилятора допускает комментарии, а разбор JSON — нет. Снимать
    // их образцом по всему тексту нельзя: маска вида `src` со звёздами
    // содержит последовательность, неотличимую от пустого блочного
    // комментария, и образец съедает её ИЗНУТРИ СТРОКИ. Поймано сразу:
    // короткий адрес превращался в огрызок, таблица выходила пустой, и
    // разрешение коротких адресов не работало бы молча.
    //
    // Поэтому сканер, знающий про строки, и зовётся он только тогда, когда
    // простой разбор уже не удался.
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

// --- разрешение спецификатора импорта в файл ---------------------------------
/** Короткие адреса импорта — те, что объявлены конфигом компилятора.
 *
 * Разбор импортов считал внутренним только то, что начинается с точки.
 * Импорт через короткий адрес — `~/app/store`, `@/shared` — от точки не
 * начинается, и в граф он не попадал ВОВСЕ.
 *
 * Цена измеряется только там, где есть и короткие адреса, и слои. Замерено на
 * первом таком проекте: связь между слоями через короткий адрес не видел
 * никто — правила направления и изоляции проходили зелёными, радиус поражения
 * не считал импортёра, а объявленное исключение легло в «мёртвые», потому что
 * запрет, который оно снимает, не срабатывал ни разу.
 *
 * Источник истины — конфиг компилятора: короткие адреса объявляют ему, а
 * сборщик и раннер повторяют объявленное. Читается он вместе с тем, что
 * продолжает: раскладка со ссылками держит общие опции в отдельном файле.
 */
/** Конфиги компилятора, по которым звено типов РЕАЛЬНО проверяет код, — с
 * опциями, прочитанными вместе с тем, что конфиг продолжает. Пары
 * `[адрес, опции]`.
 *
 * Берутся по тому, что звено зовёт: `-p` и `--project` — названный файл,
 * иначе конфиг корня вызова; конфиг-решение со ссылками — его ссылки;
 * делегирование пакетам — те же вызовы в каждом пакете. Спрашивают его
 * сверка строгости и рецепт её фальсификации: рецепт, ломавший конфиг
 * корня, в монорепозитории не доходил ни до одной сверки — проверку типов
 * там ведут конфиги пакетов. Замерено фальсификацией стенда-монорепозитория. */
const typeCheckOptions = () => {
  const mapAt = shelfAt("seat/map.json");
  const link = (
    mapAt !== null && existsSync(mapAt)
      ? (readJson(mapAt, {}).chainScripts ?? [])
      : []
  ).find((e) => e.name === "typecheck");
  const manifestAt = path.join(BASE, CONFIG.manifest ?? "../package.json");
  const rootScripts = readJson(manifestAt, {}).scripts ?? {};
  const calls = [];
  if (link?.recognise != null) {
    const re = new RegExp(link.recognise);
    for (const body of Object.values(rootScripts))
      if (re.test(body)) calls.push([path.dirname(manifestAt), body]);
    // Делегирование: корневой скрипт раздаёт одноимённые скрипты пакетам.
    const handed = delegatedLink(re, rootScripts);
    if (handed !== null) {
      const m = /\bnpm run ([\w:-]+)/.exec(rootScripts[handed]);
      const globs = readJson(manifestAt, {}).workspaces ?? [];
      const list = Array.isArray(globs) ? globs : (globs.packages ?? []);
      for (const g of list) {
        const dir = path.join(
          path.dirname(manifestAt),
          String(g).replace(/\/\*$/, ""),
        );
        if (!existsSync(dir)) continue;
        const dirs = String(g).endsWith("/*")
          ? readdirSync(dir).map((e) => path.join(dir, e))
          : [dir];
        for (const d of dirs) {
          const body = readJson(path.join(d, "package.json"), {}).scripts?.[
            m?.[1] ?? ""
          ];
          if (body !== undefined && re.test(body)) calls.push([d, body]);
        }
      }
    }
  }
  const optionsOf = (at, seen = new Set()) => {
    if (seen.has(at) || !existsSync(at)) return null;
    seen.add(at);
    const parsed = parseJsonc(readFileSync(at, "utf8"));
    if (parsed === null) return null;
    let out = {};
    for (const ext of [parsed.extends ?? []].flat()) {
      if (!String(ext).startsWith(".")) continue;
      let to = path.resolve(path.dirname(at), ext);
      if (!existsSync(to) && existsSync(to + ".json")) to += ".json";
      out = { ...out, ...(optionsOf(to, seen)?.options ?? {}) };
    }
    return { options: { ...out, ...(parsed.compilerOptions ?? {}) }, parsed };
  };
  const configs = new Set();
  for (const [dir, body] of calls) {
    const p = /(?:^|\s)(?:-p|--project)\s+(\S+)/.exec(body);
    configs.add(path.resolve(dir, p === null ? "tsconfig.json" : p[1]));
  }
  const out = [];
  for (const at of configs) {
    const got = optionsOf(at);
    if (got === null) continue;
    const refs = got.parsed.references ?? [];
    if (got.parsed.compilerOptions == null && refs.length)
      for (const r of refs) {
        let to = path.resolve(path.dirname(at), r.path);
        if (existsSync(to) && statSync(to).isDirectory())
          to = path.join(to, "tsconfig.json");
        const opts = optionsOf(to)?.options;
        if (opts != null) out.push([to, opts]);
      }
    else out.push([at, got.options]);
  }
  return out;
};
const ALIASES = (() => {
  const named = (CONFIG.toolchain ?? []).find((l) => l.script === "typecheck");
  const start = named?.config ?? "tsconfig.json";
  const out = [];
  const seen = new Set();
  const read = (at) => {
    if (seen.has(at) || !existsSync(at)) return;
    seen.add(at);
    const parsed = parseJsonc(readFileSync(at, "utf8"));
    if (parsed === null) return;
    const here = path.dirname(at);
    const paths = parsed.compilerOptions?.paths;
    if (paths !== undefined)
      for (const [pattern, targets] of Object.entries(paths))
        for (const target of targets)
          out.push({
            head: pattern.replace(/\*$/, ""),
            star: pattern.endsWith("*"),
            to: norm(
              path.resolve(
                here,
                parsed.compilerOptions?.baseUrl ?? ".",
                target.replace(/\*$/, ""),
              ),
            ),
          });
    if (typeof parsed.extends === "string")
      read(path.resolve(here, parsed.extends));
  };
  read(path.join(BASE, "..", start));
  return out;
})();
const resolve = (fromFile, spec) => {
  let base;
  if (spec.startsWith(".")) {
    base = norm(path.resolve(path.dirname(fromFile), spec));
  } else {
    // Самый длинный подходящий короткий адрес: объявить можно и `~/`, и
    // `~/shared/`, и тогда второй точнее первого.
    const hit = ALIASES.filter((a) => spec.startsWith(a.head)).sort(
      (x, y) => y.head.length - x.head.length,
    )[0];
    if (hit === undefined) return null;
    base = norm(path.join(hit.to, spec.slice(hit.head.length)));
  }
  // Расширения перечислены ВСЕ, а не только пара машинописных: проект на
  // обычном JavaScript пишет импорт без расширения так же, и его связи
  // терялись бы тем же молчанием.
  const cands = [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".jsx",
    base + ".mjs",
    base + ".cjs",
    base + "/index.ts",
    base + "/index.tsx",
    base + "/index.js",
    base + "/index.jsx",
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

/** Переменная листа стилей: объявление и чтение. Связь через них не видна
 * графу импортов — её пишет один файл, а читает другой. */
const CSS_VAR_DECL = /(--[A-Za-z][\w-]*)\s*:/g;
const CSS_VAR_USE = /var\(\s*(--[A-Za-z][\w-]*)/g;
/** Атрибут данных: та же связь, но между кодом и стилем. */
const DATA_ATTR = /data-[a-z][a-z0-9-]*/g;
/** Класс, ОБЪЯВЛЕННЫЙ листом стилей: с начала строки, чтобы не собрать
 * вложенные состояния и сочетания вроде `.button:hover` вторым именем. */
/** Импорт листа модуля стилей: привязка и адрес. Нужен двум сверкам —
 * именам классов и отступлению от схемы стилизации, — поэтому объявлен
 * здесь, а не внутри одной из них. */
const STYLE_IMPORT =
  /import\s+(\w+)\s+from\s+["']([^"']*\.module\.(?:s?css|less))["']/g;

/** Классы, ОБЪЯВЛЕННЫЕ листом стилей.
 *
 * Ищутся в строках-селекторах, а не в начале строки. Прежний образец был
 * привязан к первому символу строки и в листе, завёрнутом в слой каскада,
 * видел НОЛЬ классов: там каждый класс с отступом. Замерено на эталонном
 * проекте — все пять его листов читались как пустые.
 *
 * Строка свойства кончается точкой с запятой, строка селектора — фигурной
 * скобкой или запятой. Этого различения довольно, чтобы в набор не попали
 * значения свойств, и оно не требует разбора CSS.
 *
 * Составной селектор отдаёт ВСЕ свои классы: `.a .b` — это объявление
 * обоих, и прежний образец брал только первый. */
const cssClasses = (text) => {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const body = line.split("//")[0];
    if (!/[{,]\s*$/.test(body)) continue;
    for (const m of body.matchAll(/[.&]([A-Za-z][\w-]*)/g)) out.add(m[1]);
  }
  return out;
};
/** Имя, НАЗВАННОЕ кодом: строкой в кавычках либо обращением к полю. Модуль
 * стилей часто передают целиком, как данные, и обращения к нему в коде нет
 * вовсе — тогда имя живёт строкой в контракте. */
const CODE_NAME = /"([A-Za-z][\w-]*)"|'([A-Za-z][\w-]*)'|\.([A-Za-z][\w-]*)\b/g;

for (const f of files) {
  // Комментарии снимаются ДО разбора: ребро графа из комментария — не
  // косметика. Закомментированный импорт числился живым потребителем, и
  // мёртвый экспорт выглядел используемым.
  const src = codeOf(readFileSync(f, "utf8"));
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
      set.add("*");
      mine.add("*");
      continue;
    }
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (let part of braces[1].split(",")) {
        part = part.trim().replace(/^type\s+/, "");
        if (!part) continue;
        const name = part.split(/\s+as\s+/)[0].trim();
        if (NAME_RE.test(name)) {
          set.add(name);
          mine.add(name);
        }
      }
    }
    const def = clause
      .replace(/\{[\s\S]*\}/, "")
      .replace(/^type\s+/, "")
      .split(",")[0]
      .trim();
    if (def && NAME_RE.test(def)) {
      set.add("default");
      mine.add("default");
    }
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
/** Листы стилей, связанные с УЗЛОМ. Обратная сторона `styleUsers`.
 *
 * Графу импортов такая связь не видна ни в одном из двух видов: узел
 * подключает лист сам, либо лист подключает тот, кто зовёт узел, и передаёт
 * его пропом — так устроен модуль стилей, отдаваемый компоненту как данные.
 *
 * Без этого очерченная область исключала стиль, и критерий про границу языков
 * (C7-бис планки) оказывался неисполнимым: дублирование срока перехода между
 * кодом и стилем проходило мимо разбора. Найдено на вопросе о функции.
 */
const stylesNear = (target) => {
  // Читается КОД, а не текст: закомментированный хвост файла нёс подключение
  // листа, и досье объявляло его подключённым самим узлом. Тот же предикат,
  // что у графа импортов, — иначе два разбора одного и того же разойдутся.
  const mentions = (f, style) =>
    codeOf(readFileSync(f, "utf8")).includes(
      "/" + rel(style).slice(rel(style).lastIndexOf("/") + 1),
    );
  const own = styleFiles.filter((one) => mentions(target, one));
  const users = [...(importedBy.get(target) ?? [])].filter((u) => !isTest(u));
  const viaUsers = styleFiles.filter(
    (one) => !own.includes(one) && users.some((u) => mentions(u, one)),
  );
  return { own, viaUsers };
};

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
const LINE_SUFFIX = new RegExp(
  "(\\.(?:" + CODE_STYLE_ALT + "|md|json|html)):\\d+(?:-\\d+)?$",
);

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
  const bare = base.replace(BARE_EXT, "");
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
        CODE_OR_STYLE.test(t) &&
        dir.endsWith(t.slice(0, t.lastIndexOf("/"))),
    );
  // Протокол свода называет файлы как предмет прохода, а не описывает их:
  // его строки записями о файле не считаются.
  const records = dossierLines().base.filter(
    ([name]) => name !== CONFIG.barProtocol,
  );
  const exact = records.filter(([, , line]) =>
    quotedIn(line).some(
      (t) =>
        t === r ||
        // Адрес записан КОРОЧЕ внутреннего: от папки слоя, без корня исходников.
        (t.includes("/") && r.endsWith("/" + t)) ||
        // …и ДЛИННЕЕ: от корня репозитория, вместе с корнем исходников. Именно
        // так пишет база и так написано её семя, и без этой стороны запись
        // карты о файле не считалась точной вовсе.
        (t.includes("/") && t.endsWith("/" + r)) ||
        (t === base && (uniqueBase || namesSibling(line))),
    ),
  );
  // Строка, которая в кавычках называет ДРУГОЙ существующий файл, — про него, а
  // не про этот: иначе короткое имя собирает весь модуль и топит попадания.
  const namesOther = (line) =>
    quotedIn(line).some(
      (t) =>
        CODE_OR_STYLE.test(t) &&
        t !== base &&
        !r.endsWith("/" + t) &&
        // Адрес принимается в ОБЕИХ формах — от корня слоя и от корня
        // репозитория. Вторая здесь не бралась, и строка, называющая соседний
        // файл полным путём, не признавалась строкой про него: двадцать строк
        // таблицы связей о листе стилей уехали в догадки об узле и утопили
        // там настоящие попадания. Тот же промах уже чинился у точного
        // разбора — здесь он остался.
        !t.endsWith("/" + r) &&
        // Сосед ищется среди кода И СТИЛЕЙ: списки разные, а строка базы
        // называет и то и другое. Пока смотрели только код, строка о соседнем
        // ЛИСТЕ СТИЛЕЙ соседом не признавалась.
        [...files, ...styleFiles].some(
          (f) =>
            rel(f) === t ||
            rel(f).endsWith("/" + t) ||
            t.endsWith("/" + rel(f)),
        ),
    );
  const loose = records.filter(
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
    for (const hit of line.matchAll(/mode === "([a-z-]+)"/g))
      if (!inComment(line, hit.index)) found.push(hit[1]);
  modesCache = Object.freeze([...new Set(found)]);
  return modesCache;
};
/** Открытые шаги перехода: номер и короткое имя каждого.
 *
 * Читается из файла плана, а не из памяти сессии: контекст не переживает ни
 * очистки, ни нового дня, а переход измеряется днями.
 *
 * Возвращает `null`, когда перехода нет: проект родился под обвязкой либо
 * переход закончен.
 */
const transitionOpen = () => {
  if (CONFIG.transition == null) return null;
  const at = path.join(BASE, CONFIG.transition.file);
  if (!existsSync(at)) return null;
  const rows = readFileSync(at, "utf8").split(/\r?\n/);
  const head = rows.findIndex((l) => l.startsWith(CONFIG.transition.heading));
  if (head < 0) return null;
  const steps = [];
  for (let i = head + 2; i < rows.length; i += 1) {
    const line = rows[i];
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    // Короткое имя шага — до первой точки или двоеточия: графа «что делает»
    // написана для чтения, и целиком в баннер она не помещается.
    const short = cells[1]
      .replace(/\*\*/g, "")
      .split(/[.:]\s/)[0]
      .replace(/`/g, "")
      .trim();
    steps.push({ no: cells[0], what: short });
  }
  return steps.length ? steps : null;
};

/** Баннер перехода. Печатается ПЕРВОЙ строкой каждого прогона и своим
 * режимом — из него же его зовёт хук среды при правке файлов проекта.
 *
 * Первой, а не последней, и с ПЕРЕЧНЕМ шагов, а не счётом: строка «открытых
 * шагов: 7» в конце полусотни секций читается ровно до тех пор, пока её не
 * перестают замечать, и не говорит, что именно осталось. Требование
 * разработчика: «чтобы переход ни разу никогда не выпадал из поля зрения».
 */
/** Открытые находки: то, с чем проект пришёл и чего ещё не починили.
 *
 * Печатается баннером рядом с планом перехода и по той же причине: замер,
 * сделанный один раз и не доложенный больше никогда, забывается в тот же
 * день. Закрыли находку — удалили строку. */
const printFindings = () => {
  if (CONFIG.findings == null) return false;
  const at = path.join(BASE, CONFIG.findings.file);
  if (!existsSync(at)) return false;
  const open = [];
  for (const line of readFileSync(at, "utf8").split(String.fromCharCode(10))) {
    const cell = line.split("|").map((c) => c.trim());
    if (cell.length < 7) continue;
    if (cell[6] !== "открыта") continue;
    open.push(cell[1] + ". " + cell[2].slice(0, 90));
  }
  if (open.length === 0) return false;
  banner("ПРОЕКТ ПРИШЁЛ С НАХОДКАМИ, ОНИ НЕ ЗАКРЫТЫ");
  console.log(
    "  Открытых находок: " + open.length + ". Реестр: " + CONFIG.findings.file,
  );
  for (const one of open) console.log("  " + one);
  console.log("  Починили — закрыли строку коммитом и опорой. Это работа над");
  console.log("  проектом, а не переход: переход кода не трогает.");
  console.log("");
  return true;
};

const printTransition = () => {
  const steps = transitionOpen();
  if (steps === null) return false;
  banner("ОБВЯЗКА ПОСАЖЕНА, ПЕРЕХОД НЕ ЗАВЕРШЁН");
  console.log(
    "  Открытых шагов: " + steps.length + ". План: " + CONFIG.transition.file,
  );
  for (const st of steps) console.log("  " + st.no + ". " + st.what);
  console.log("  Закрыли шаг — удалили строку. Таблица пуста — удалить файл");
  console.log("  и обнулить поле настройки: переход закончен.");
  console.log("");
  return true;
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

// Неизвестный или пропущенный режим — отказ, а не молчание.
//
// До этого инструмент на `graph.mjs verfiy` печатал пусто и отдавал `0`. В
// цепочке проверок последним звеном стоит `node .claude/tools/graph.mjs verify`:
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
// Приставок столько, сколько деревьев: путь из отчёта может начинаться с
// любого из них.
const SRC_PREFIXES = SRC_ROOTS.map((one) => path.basename(one) + "/");
const argPath = (a) => {
  if (a === undefined) return a;
  const s = a
    .split(String.fromCharCode(92))
    .join("/")
    .replace(/^[.][/]/, "");
  const hit = SRC_PREFIXES.find((one) => s.startsWith(one));
  return hit === undefined ? s : s.slice(hit.length);
};

/** «Ничего не нашлось» про файл, который на диске ЕСТЬ, — это ответ не на тот
 * вопрос: читатель идёт искать опечатку в живом адресе. Разбор смотрит код и
 * стили внутри исходников, а обвязка — правила, полка, инструмент — лежит вне
 * его области, и сказать об этом надо прямо. Найдено пробой: досье на файл
 * полки правил отвечало ровно тем же, чем на выдуманный путь. */
const outOfScope = (arg) => {
  const tick = String.fromCharCode(96);
  const here = [path.join(BASE, "..", arg), path.join(ROOT, argPath(arg))];
  if (here.some((one) => existsSync(one)))
    return (
      `${tick}${arg}${tick} — файл есть, но он вне области разбора:` +
      ` инструмент смотрит код и стили внутри исходников, а своды правил,` +
      ` полка и он сам туда не входят.`
    );
  // Файла нет вовсе. Голое «ничего не нашлось» читается как «связей нет», то
  // есть как «рисков нет», — и ровно так заведение нового узла проскакивало
  // мимо замера.
  //
  // Совет при этом ЗАВИСИТ ОТ РОДА файла, и один на всех советовал не то:
  // у документа нет ни точки встраивания, ни импортов; тест сам и есть
  // проверка, радиуса у него не бывает; лист стилей в граф импортов не входит.
  // Род различает словарь области, и ответ ветвится по нему.
  const LF = String.fromCharCode(10);
  const path0 = argPath(arg);
  const say = [tick + arg + tick + " — такого файла нет.", ""];

  if (isDocPath(path0)) {
    say.push(
      "Это ДОКУМЕНТ. Радиуса у него нет: его никто не импортирует, и трогать",
      "он ничего не заставляет. Спрашивать надо про другое:",
      "",
      "  1. УКАЗАТЕЛЬ ДОКУМЕНТОВ — документ, которого в нём нет, находит только",
      "     тот, кто уже знает о его существовании. Строка заводится тем же",
      "     заходом, и её отсутствие роняет прогон.",
      "  2. УЗЕЛ, КОТОРОМУ ЭТОТ ДОКУМЕНТ ОБЪЯСНЯЕТ «ПОЧЕМУ» — на него ставится",
      "     якорь из кода. Спросить про узел: " +
        tick +
        "brief <узел>" +
        tick +
        ".",
    );
  } else if (isTestPath(path0)) {
    say.push(
      "Это ТЕСТ. Радиуса у него нет — он сам и есть проверка. Спрашивать надо",
      "про его ПРЕДМЕТ:",
      "",
      "  1. " +
        tick +
        "brief <проверяемый файл>" +
        tick +
        " — что он тянет, кто тянет его и какие",
      "     тесты его уже накрывают: тест, дублирующий существующий, не",
      "     прибавляет покрытия смысла.",
      "  2. Место — папка " +
        tick +
        "tests/" +
        tick +
        " своего слоя, и строка в реестре тестов:",
      "     папкой покрытие не зачитывается, тесты считаются поимённо.",
    );
  } else if (isStylePath(path0)) {
    say.push(
      "Это ЛИСТ СТИЛЕЙ. В граф импортов он не входит — его подключает сборщик,",
      "и радиус у него считается по тексту. Спрашивать надо про две стороны:",
      "",
      "  1. ТОЧКА ПОДКЛЮЧЕНИЯ — узел, который его подключит: " +
        tick +
        "plan <узел>" +
        tick +
        ".",
      "  2. ЧЬИ ИМЕНА КЛАССОВ ОН ПЕРЕКРЫВАЕТ ИЛИ ДОПОЛНЯЕТ — соседний лист того",
      "     же узла. Два листа на один узел спорят за один и тот же класс, и",
      "     побеждает порядок подключения, а не замысел.",
      "",
      "Тестов у стиля обычно нет: правка видна глазом, и это пункт отчёта.",
    );
  } else {
    say.push(
      "Если это ЗАВЕДЕНИЕ НОВОГО УЗЛА, спрашивать про него бессмысленно: связей",
      "у него ещё нет, и пустой ответ читается как «рисков нет». Рябь новый узел",
      "даёт с двух сторон, и обе уже существуют:",
      "",
      "  1. ТОЧКА ВСТРАИВАНИЯ — файл, который будет его звать. Её правка и есть",
      "     ваша правка: " +
        tick +
        "plan <точка>" +
        tick +
        " даст радиус, тесты, обязанные",
      "     покраснеть, и записи базы под обновление.",
      "  2. ЧТО УЗЕЛ СОБИРАЕТСЯ ТЯНУТЬ — каждый предполагаемый импорт:",
      "     " +
        tick +
        "brief <зависимость>" +
        tick +
        " скажет, кто ещё ею пользуется и какие",
      "     решения и ограничения на ней висят.",
    );
    // Папки ещё нет — значит заводится не узел, а СЛОЙ, и у слоя свои записи.
    const dir = path.dirname(path.join(ROOT, path0));
    // Адрес печатается так, как его дали: `rel0` считает от папки базы и
    // добавляет шаг вверх, а читателю нужен путь, который он сам и написал.
    const given = arg.split("\\").join("/");
    const shown = given.slice(0, given.lastIndexOf("/"));
    if (!existsSync(dir))
      say.push(
        "",
        "И отдельно: папки " +
          tick +
          shown +
          tick +
          " ещё нет — значит заводится не",
        "просто узел, а НОВЫЙ СЛОЙ. У слоя есть то, чего у узла нет: правила",
        "направления импортов и запись в карте о его составе. Пока слой один,",
        "оба раздела законно пусты; со вторым они заводятся и заполняются, иначе",
        "направление объявлено и не проверяется ничем.",
      );
  }

  say.push(
    "",
    "Если файл должен существовать — проверьте адрес: принимаются обе формы,",
    "от корня репозитория и от корня исходников.",
  );
  return say.join(LF);
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

/** Полный список сверок прогона. Заголовок секции — он же имя строки в таблице
 * сверок доктрины, и совпадение этих двух списков проверяет сверка «Таблица
 * сверок описывает существующие сверки».
 *
 * Объявлен ДАННЫМИ, а не собирается из прогона: часть сверок печатается только
 * при живом предмете, и собранный прогоном список молча терял бы их — то есть
 * сверка таблицы врала бы ровно про те сверки, о которых проект сегодня молчит.
 *
 * Заголовок сверки печатается только через `checkHead`, и незаявленный роняет
 * прогон на месте: иначе сверку можно было бы завести, нигде её не описав, а
 * ровно это с таблицей однажды и случилось. */
const CHECK_SECTIONS = [
  "Покрытие карты",
  "Покрытие тестов",
  "Правила направления",
  "Звёздные бочки",
  "Состав бочки в записи карты",
  "Правила изоляции",
  "Правила про существующее",
  "Пометки CONSTRAINT",
  "Пометки решений",
  "Якоря",
  "Константы настроек описаны",
  "Точечные исключения линта",
  "Выключения правил линта",
  "Режимы инструмента описаны",
  "Версии установленного (предупреждение, прогон не роняет)",
  "Разрешения, нажитые по ходу работы (предупреждение, прогон не роняет)",
  "Разрешения среды",
  "Якоря на документацию в коде",
  "Закомментированного кода нет",
  "Комментарий не перерос в прозу",
  "Доля комментариев в файле",
  "Новые якоря — с цитатой",
  "Найденное — исправлено, а не отложено",
  "Ссылки на разделы",
  "Версия среды (предупреждение, прогон не роняет)",
  "Инструменты звеньев на месте (предупреждение, прогон не роняет)",
  "Объявленные области существуют",
  "Обещания без опоры собираются сводкой",
  "Связи через DOM и CSS",
  "Имена классов из кода есть в листе стилей",
  "Класс из листа стилей спрошен кодом",
  "Отступление от схемы стилизации объявлено решением",
  "Код лежит в объявленных деревьях",
  "Пустой папки под корнем исходников нет",
  "Новый узел лежит по раскладке",
  "Правила проекта не спорят с реестром решений",
  "У компонента есть README",
  "Узел, тянущий соседа, назван документом",
  "Документы компонента лежат в его `docs/`",
  "Язык внутри корня исходников",
  "У каждого семени есть адрес назначения",
  "Доктрина названа в порядке чтения",
  "Синоним термина словаря не заведён",
  "Документы названы в указателе",
  "Применимость разделов планки",
  "Сверки, выключенные при живом предмете",
  "Скиллы проекта",
  "Разделы правил классифицированы",
  "Шаблон правил заполнен",
  "Отложенное без закрытых пунктов",
  "Скрипты манифеста описаны (предупреждение, прогон не роняет)",
  "Решения адресуемы",
  "Пути в обратных кавычках",
  "Ссылки markdown",
  "Проза целиком попадает в корпус сверок",
  "Строка таблицы по ширине шапки",
  "Ссылка на критерий планки несёт его заголовок",
  "Таблица состава лежит в одном месте",
  "Файлы обвязки видны git",
  "Концы строк рабочего дерева сходятся с объявленными",
  "Перечень папок полки полный",
  "Исключения сверок используются",
  "Списки исключений не разрослись (предупреждение, прогон не роняет)",
  "Имена из кода в тексте",
  "Числа в прозе базы",
  "Имена констант в тексте",
  "Тесты лежат в `tests/`",
  "Объявленный состав папок и радиусы",
  "Не разобрано (проверкой не покрыто)",
  "Конфиг звена цепочки на месте",
  "Таблица сверок описывает существующие сверки",
  "Рецепт находит место в свежей посадке",
  "Вопрос о планке задан на конечном виде правки",
  "Планка пройдена покритериально",
  "Коммит с кодом накрыт сводом",
  "Ворота перед коммитом установлены",
  "Мутационный прогон исполним",
  "Названное доктриной исполнимо",
  "В корне узла только сам узел",
  "Предложенное сводом названо находкой",
  "Файлы базы заведены под свой предмет",
  "Предмет из кода назван в своём файле базы",
  "Каркас обвязки не лежит в живом проекте",
  "Раздел планки объявлен по своему замеру",
  "Файл базы о живом коде назвал его адрес",
  "Каркас не отстал от семени",
  "Запись о пустоте не пережила появление кода",
  "Якоря семени ведут в семя",
  "Один предмет — один файл настройки",
  "Конвейер зовёт проверки",
  "Связка проверок зовёт живые звенья",
  "Настройка сборки знает про тесты",
  "Привезённый код виден компилятору",
  "Строгость компилятора там, где проверяются типы",
  "Конфиг снятого звена служит живому",
  "Настройка проекта знает все поля семени",
  "Поле семени настройки объяснено",
  "Цепочка проверок объявлена данными",
  "Звено цепочки не задвоено",
  "Одноранговая зависимость не продублирована",
  "Поставка не несёт лишнего",
  "Заготовки обвязки не разбираются линтом проекта",
  "Звену цепочки есть на чём работать",
  "Пакеты семени разобраны по звеньям",
  "Отложенное семя не положено посадкой",
  "Семя с условием не лежит без условия",
  "Отложенное семя положено, когда предмет появился",
  "Отложенное семя слито",
  "Семена приезжают отформатированными",
  "Настройка семени не ссылается на непривезённое",
  "Запись о семени помечена каркасом вместе с ним",
  "Находки закрыты",
  "Шаги перехода закрывают измерение",
  "Напоминание о переходе включено",
  "Объявленный долг назван планом перехода",
  "Объявленный долг не больше фактического",
  "План перехода не потерялся",
  "Форма отчёта посадки без слов обвязки",
  "Вопросы разработчику без ответа (предупреждение, прогон не роняет)",
  "Каждая сверка называет свой корпус",
  "Файл, написанный обвязкой, читается",
  "Диапазон среды объявлен",
  "Красное звено названо находкой",
  "Незамеренное названо находкой",
];

/** Заголовок БАННЕРА — и он НЕ заголовок сверки.
 *
 * Форма у них разная намеренно. Всё, что читает вывод механически, узнаёт
 * секцию по `=== имя ===`: разбор исхода фальсификации, драйверы посадки,
 * счёт красных строк. Баннер в той же форме читается СВЕРКОЙ, которой нет в
 * закрытом списке, — и появление баннера выглядит появлением сверки.
 *
 * Найдено рецептом на напоминание о переходе: поломка завела план, вместе с
 * ним появился баннер, и разбор доложил «поломка ушла не туда: её приняла
 * сверка ОБВЯЗКА ПОСАЖЕНА, ПЕРЕХОД НЕ ЗАВЕРШЁН». Сверки с таким именем нет
 * и быть не может.
 *
 * Прежней формой стояли три баннера; они молчали об этом только потому, что
 * появлялись и в чистом прогоне, и после поломки.
 */
const banner = (title) => {
  console.log("");
  console.log("──────────────────────────────────────────────");
  console.log(title);
  console.log("──────────────────────────────────────────────");
};

/** Сверки, назвавшие размер своего корпуса. Ключ — имя сверки. */
const LOOKED = new Map();
/** Сверки, напечатавшие заголовок в этом прогоне. */
const PRINTED = new Set();

const checkHead = (title, looked) => {
  if (!CHECK_SECTIONS.includes(title))
    throw new Error("секция не объявлена в CHECK_SECTIONS: " + title);
  console.log("=== " + title + " ===");
  PRINTED.add(title);
  if (looked === undefined) return;
  LOOKED.set(title, looked);
  sayLooked(looked.unit, looked.n);
};

// Какому полю настройки принадлежит предмет сверки. Список нужен трижды:
// сверке без рецепта — чтобы не числить её долгом там, где ломать нечего, —
// и рецепту, не нашедшему своего места: если поле пусто, это не устаревший
// рецепт, а отсутствующий предмет.
//
// Второе применение заведено по замеру: посадка в пустой проект дала
// «рецепт устарел» на сверке, чей предмет в том проекте не заводится вовсе.
// Долг, который проект не может закрыть, перестают читать целиком.
//
// Третье — сверке «Рецепт находит место в свежей посадке»: рецепт, чей
// предмет в свежей посадке не заводится, места там и не ищет.
const RECIPE_NEEDS = {
  // Ревизия сводов по истории: в песочнице истории нет вовсе — она заводит
  // свой репозиторий одним коммитом, — и предмета у сверки там не
  // существует. Опровергнута она замером на стенде: коммит, прошедший мимо
  // ворот флагом, стал красным и остался им.
  "Коммит с кодом накрыт сводом": "barSince",
  "Константы настроек описаны": "configDocs",
  "Точечные исключения линта": "lintExceptions",
  "Решения адресуемы": "adr",
  // Предмет — объявленная таблица связей. Её нет — ломать нечего; она есть —
  // рецепт ломает ОБЪЯВЛЕНИЕ, а не проектное содержимое таблицы.
  "Связи через DOM и CSS": "domTables",
  "Находки закрыты": "findings",
  // Предмет этих трёх — сам переход, и у проекта без него ломать нечего:
  // все три печатают «перехода нет». Прежде их рецепты сами заводили план,
  // опираясь на строку `transition: null`, — и у живого проекта сразу после
  // посадки, где план открыт, места не находили. Красную фальсификацию
  // получал каждый живой проект в день посадки: ровно там, где рубеж
  // завершения требует зелёной.
  "План перехода не потерялся": "transition",
  "Шаги перехода закрывают измерение": "transition",
  "Напоминание о переходе включено": "transition",
};

// Сверки, чей предмет в ЭТОМ проекте не заводится по его устройству, а не
// по пустому полю настройки. Такая сверка печатает об этом строку, и режим
// фальсификации читает её в чистом прогоне: рецепту ломать нечего. Строка
// объявлена здесь, одна на сверку и на рецепт: написанная в двух местах, она
// разошлась бы при первой правке. Заведено посадкой руками в живой проект:
// сверка каркаса у него молчит по устройству, а рецепт правил СВОЙ корневой
// компонент проекта, и поломку принимала соседняя сверка — «ушла не туда»,
// то есть красная фальсификация на здоровой обвязке.
const IDLE_NOTES = {
  "Каркас не отстал от семени":
    "  у проекта свой код: каркас спрашивает соседняя сверка",
  "Перечень папок полки полный":
    "  не мастерская: описание полки сверяется там, где его пишут",
  // Раскладка своя и объявлена решением — сверка раскладку намеренно не
  // спрашивает, и узел, положенный рецептом мимо слоёв, будит только
  // соседей. Замерено фальсификацией стенда после фазы 2: рецепт записался
  // «ушедшим не туда», и прогон режима покраснел на законном устройстве.
  "Новый узел лежит по раскладке":
    "  отступление объявлено решением: раскладка проекта своя",
};

// --- falsify: сверки ещё ловят -----------------------------------------------
//
// Фальсификация при заведении сверки доказывает, что она ловила ТОГДА. Через
// месяц сломанная сверка печатает такой же ноль, как здоровая, и отличить их
// нечем — то есть ровно тот случай, ради которого весь свод и написан.
//
// Режим ломает предмет каждой сверки по рецепту и смотрит, покраснела ли
// именно она. Работает на ВРЕМЕННОЙ КОПИИ проекта: правка в рабочем дереве
// оставила бы его сломанным, оборвись прогон на середине.
//
// Сверки без рецепта печатаются списком. Этот список — долг, и он обязан
// укорачиваться: сверка, заведённая без рецепта, снова становится
// одноразово фальсифицированной.

if (mode === "falsify") {
  const NEWLINE = String.fromCharCode(10);
  const recipesAt = path.join(TOOL_DIR, "falsify.json");
  if (!existsSync(recipesAt)) {
    console.log("=== Рецептов фальсификации нет ===");
    sayLooked("рецептов опровержения", 0);
    console.log("  Ожидался файл: " + norm(recipesAt));
    process.exit(1);
  }
  const recipes = JSON.parse(readFileSync(recipesAt, "utf8")).recipes ?? [];
  sayLooked("рецептов опровержения", recipes.length);
  const REPO_ROOT = REPO_AT;
  const tmp = path.join(REPO_ROOT, ".проба-сверок");

  // Разбор вывода и разбор исхода живут в словаре области: это чистые
  // функции, и держит их набор тестов, а не одноразовая фальсификация.
  const readSections = (out) => sectionsOf(out, NEWLINE);

  const runVerify = (cwd) => {
    try {
      return execFileSync(
        process.execPath,
        [path.join(cwd, ".claude/tools/graph.mjs"), "verify"],
        { encoding: "utf8", cwd },
      );
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };

  rmSync(tmp, { recursive: true, force: true });
  sandboxTree(REPO_ROOT, tmp);
  sandboxManifests(
    path.join(REPO_ROOT, "node_modules"),
    path.join(tmp, "node_modules"),
  );

  // В песочнице заводится СВОЙ репозиторий, и это не удобство. Часть сверок
  // читает состояние репозитория — какие файлы правлены прямо сейчас, — а копия
  // приезжает без него: `git status` в ней молчит, и такая сверка не может
  // покраснеть ни на какой поломке. Рецепт к ней выглядел бы как промолчавшая
  // сверка, то есть врал бы в худшую сторону. Найдено первым же рецептом к
  // сверке, читающей правку.
  try {
    execFileSync("git", ["init", "-q"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: tmp, stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=falsify",
        "-c",
        "user.email=falsify@local",
        "commit",
        "-qm",
        "base",
      ],
      { cwd: tmp, stdio: "ignore" },
    );
  } catch {
    // git недоступен — сверки, читающие правку, останутся без рецепта, и это
    // видно по их строке в долге.
  }

  const caught = [];
  const silent = [];
  /** Поломка легла — а её приняла ДРУГАЯ сверка, не та, ради которой
   * рецепт написан. Значит рецепт мимо, а сверка ни при чём. */
  const astray = [];
  const broken = [];
  // КОГДА СТАВИТЬ ПОМЕТКУ «под свой проект», а когда нельзя.
  //
  // Пометка ГАСИТ СИГНАЛ: рецепт, переставший работать, печатается отдельной
  // строкой, и прогон остаётся зелёным. Поставленная не по делу, она прячет
  // сверку, молча потерявшую свою фальсификацию, — ровно тот класс, ради
  // которого весь режим и заведён. Стояла она на двадцати пяти рецептах из
  // шестидесяти пяти, а места на чужом проекте не нашёл ОДИН: ставилась по
  // умолчанию, а не по признаку.
  //
  // Признак: НА ЧЬЁМ ТЕКСТЕ ДЕРЖИТСЯ ЯКОРЬ РЕЦЕПТА.
  //   Привезено посадкой — пометки НЕТ. Файлы базы, свод правил, указатель
  //   документов, поле `scripts` манифеста одинаковы в любом проекте, и
  //   переставший работать рецепт здесь обязан ронять прогон.
  //   Содержимое проекта — пометка СТОИТ. Конфиг линтера, заполненное поле
  //   настройки, закреплённая версия пакета принадлежат проекту, и их
  //   отсутствие в другом проекте законно.
  //
  // Рецепт, помеченный «под свой проект», ломает файлы КОНКРЕТНОГО проекта:
  // его код, его карту, его факты. В другом проекте своего места он не находит,
  // и это не порча рецепта, а его природа. Смешанный с настоящей порчей, он
  // давал посаженному проекту семнадцать строк «рецепт устарел» на первом же
  // прогоне — вид, в котором долг не читают вовсе.
  /** Предмет сверки в этом проекте не заводится: поле настройки пусто. */
  /** Карта посадки рядом, разобранная. */
  const seatMapOf = () => {
    const at = shelfAt("seat/map.json");
    return at === null || !existsSync(at) ? {} : readJson(at, {});
  };
  const subjectless = (section) => {
    const field = RECIPE_NEEDS[section];
    if (field !== undefined && CONFIG[field] == null) return true;
    // Семейство отложенных семян: предмет у него не поле настройки, а НАЛИЧИЕ
    // хоть одного семени с пометкой «не на посадке». Пометок не осталось —
    // ломать этим сверкам нечего, и рецепт на них не тревога.
    //
    // Правило узкое намеренно. Общее — «корпус ноль значит предмета нет» —
    // пробовалось и оказалось неверным: у многих сверок корпус в чистом
    // прогоне ноль, а рецепт предмет СОЗДАЁТ, и поймано падало с девяноста
    // четырёх до семидесяти шести.
    if (section.startsWith("Отложенное семя"))
      return !(seatMapOf().copy ?? []).some((e) => e.notAtSeating != null);
    return false;
  };
  /** Приезжает ли этот адрес СЕМЕНЕМ посадки.
   *
   * Мерка, отличающая «рецепт устарел» от «рецепт написан под другой
   * проект». Файл, который кладёт посадка, живой проект вправе разложить
   * иначе или переписать под себя: рецепт тогда не находит места не потому,
   * что сломался, а потому, что он про чужое устройство. Файл, семенем НЕ
   * приезжающий, обязан быть там, где сказано, и его отсутствие — тревога.
   *
   * Прежде это решал флаг `own` в самом рецепте, то есть рука автора. На
   * стенде со своей раскладкой девять рецептов из девяноста двух попадали в
   * тревогу, не будучи тревогой, и режим не мог дойти до нуля никогда. */
  const fromSeed = (() => {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt)) return () => false;
    const m = JSON.parse(readFileSync(mapAt, "utf8"));
    const seeded = new Set(
      [...(m.copy ?? []), ...(m.deferred ?? [])].map((c) =>
        c.to.split("\\").join("/"),
      ),
    );
    return (to) => seeded.has(String(to).split("\\").join("/"));
  })();
  /** Тот же вопрос к СОСТАВНОМУ рецепту: поля `file` у него нет, адреса
   * лежат по шагам. Хоть один шаг метит в семя — рецепт про устройство
   * умолчания, а не про этот проект. */
  const stepsFromSeed = (r) =>
    (r.edits ?? []).some((e) =>
      fromSeed(e.file ?? e.copyTo ?? e.create?.path ?? e.mkdir),
    );
  const foreign = [];
  // Рецепт написан, а предмета у сверки в ЭТОМ проекте не заводится вовсе:
  // поле настройки пусто. Это не «перенацелить на свои файлы» — цели нет, и
  // печатать такую строку вместе с проектными значило бы советовать работу,
  // которой не существует.
  const idle = [];
  try {
    const cleanOut = runVerify(tmp);
    const clean = readSections(cleanOut);
    /** Сверка сказала в чистом прогоне, что предмета у неё здесь нет. */
    const idleByNote = (section) => {
      const note = IDLE_NOTES[section];
      if (note === undefined) return false;
      const rows = cleanOut.split(NEWLINE);
      const at = rows.indexOf("=== " + section + " ===");
      if (at < 0) return false;
      for (
        let i = at + 1;
        i < rows.length && !rows[i].startsWith("=== ");
        i += 1
      )
        if (rows[i] === note) return true;
      return false;
    };

    const record = (section, after) => {
      const { how, why } = classifyRun(clean, after, section);
      if (how === "caught") caught.push(section);
      else if (how === "broken") broken.push(section + why);
      else if (how === "astray") astray.push(section + why);
      else silent.push(section);
    };

    /** Завести папку со всеми недостающими над ней — и отдать их откат.
     *
     * Откат рецепта снимал только файл: папка, заведённая под него, оставалась
     * в песочнице пустой до конца прогона. Каждый следующий рецепт находил
     * «Пустой папки под корнем исходников нет» красной, и классификатор
     * записывал здоровую сверку в «поломка ушла не туда» — то самое отравление
     * соседом, ради которого откат и заведён. Замерено фальсификацией в пустом
     * проекте: слоя узлов у него ещё нет, и рецепт, кладущий файл узла,
     * заводил папку слоя сам. В мастерской слой есть, и там это не видно
     * никогда.
     *
     * Снимается ВЕРХНЯЯ из заведённых — вместе со всем, что под ней. */
    const makeDirs = (dir) => {
      let top = null;
      for (let d = dir; !existsSync(d); d = path.dirname(d)) top = d;
      mkdirSync(dir, { recursive: true });
      return () => {
        if (top !== null) rmSync(top, { recursive: true, force: true });
      };
    };

    /** Шестая форма: НЕСКОЛЬКО правок разом.
     *
     * Часть сверок держит предмет и его объявление в разных файлах — бочку и
     * запись о ней в карте, таблицу слоёв и поле настройки, папку и её адрес в
     * списке. Сломать такую одной правкой нельзя: одна половина без другой
     * сверку не будит, а рецепт «промолчал» выглядит как непокрытая сверка.
     *
     * Шаги — те же формы, что и у одиночного рецепта. Отменяются в обратном
     * порядке: созданное удаляется, правленое возвращается.
     */
    const runSteps = (r) => {
      const undo = [];
      /** Откат. Вызывается на КАЖДОМ выходе, включая неудачный.
       *
       * Прежде ранние выходы стояли до цикла отката, и шаги, успевшие
       * примениться, оставались в песочнице ДО КОНЦА ПРОГОНА. Рецепт,
       * споткнувшийся на третьем шаге из шести, заводил файл вне карты — и
       * все последующие сверки видели её уже красной. Красная до поломки
       * сверка по правилу классификации попадает в «промолчала», то есть
       * выглядит СЛОМАННОЙ.
       *
       * Замерено на посадке в живой проект: из трёх промолчавших две были
       * отравлены соседом, а не больны. Проверено снятием составных
       * рецептов — список промолчавших изменился.
       */
      const rollback = () => {
        for (const back of undo.reverse()) back();
      };
      const give = (failed) => {
        rollback();
        return { failed };
      };
      for (const step of r.edits) {
        if (step.create !== undefined) {
          const madeAt = path.join(tmp, step.create.path);
          const dirsBack = makeDirs(path.dirname(madeAt));
          const had = existsSync(madeAt) ? readFileSync(madeAt) : null;
          writeFileSync(
            madeAt,
            step.create.text.split("\n").join(NEWLINE) + NEWLINE,
          );
          undo.push(() => {
            if (had === null) rmSync(madeAt);
            else writeFileSync(madeAt, had);
            dirsBack();
          });
          continue;
        }
        // Завести ПУСТУЮ ПАПКУ. Без этого шага сверку «Пустой папки под
        // корнем исходников нет» опровергнуть нечем: любой файл внутри
        // делает папку живой, а словарь умел заводить только файлы.
        if (step.mkdir !== undefined) {
          undo.push(makeDirs(path.join(tmp, step.mkdir)));
          continue;
        }
        const stepAt = path.join(tmp, step.file);
        if (!existsSync(stepAt)) return give("файла нет: " + step.file);
        // Прятание файла — та же форма, что у одиночного рецепта. Словарь
        // шага был беднее словаря рецепта, и рецепт, написанный по одному
        // словарю и исполняемый по другому, ронял ВЕСЬ режим стеком.
        // Заведено рецептом на вторую ветку сверки каркаса: ей нужно и
        // спрятать файл, и дописать запись о нём.
        // Форма «положить копию» — та же, что у одиночного рецепта. Нужна
        // сверкам, которые ловят ПОЯВЛЕНИЕ файла вместе с записью о нём:
        // одной правкой такую не разбудить.
        if (step.copyTo !== undefined) {
          const toAt = path.join(tmp, step.copyTo);
          const had = existsSync(toAt) ? readFileSync(toAt) : null;
          const dirsBack = makeDirs(path.dirname(toAt));
          writeFileSync(toAt, readFileSync(stepAt));
          undo.push(() => {
            if (had === null) rmSync(toAt);
            else writeFileSync(toAt, had);
            dirsBack();
          });
          continue;
        }
        if (step.rename !== undefined) {
          const hidden = path.join(path.dirname(stepAt), step.rename);
          renameSync(stepAt, hidden);
          undo.push(() => renameSync(hidden, stepAt));
          continue;
        }
        const was = readFileSync(stepAt, "utf8");
        undo.push(() => writeFileSync(stepAt, was));
        // Строка, которая обязана быть ДОСЛОВНО равной строке семени,
        // берётся из семени на прогоне. Копия в рецепте устаревала молча:
        // семя правили, совпадение пропадало, ветка сверки не срабатывала,
        // и прогон докладывал «поломка ушла не туда» — то есть указывал на
        // соседнюю сверку. Замерено дважды за один день.
        if (step.appendFrom !== undefined) {
          const seedAt = path.join(tmp, step.appendFrom.seed);
          if (!existsSync(seedAt))
            return give("семени нет: " + step.appendFrom.seed);
          const line = readFileSync(seedAt, "utf8")
            .split(NEWLINE)
            .find((l) => l.startsWith(step.appendFrom.startsWith));
          if (line === undefined)
            return give(
              "в семени нет строки, начинающейся с: " +
                step.appendFrom.startsWith,
            );
          writeFileSync(stepAt, was + NEWLINE + line);
        } else if (step.append !== undefined)
          writeFileSync(
            stepAt,
            was + NEWLINE + step.append.split("\n").join(NEWLINE),
          );
        else if (step.find === undefined)
          // Форма шага не опознана. Прежде здесь читалось поле, которого нет,
          // и режим падал стеком: рецепт с опечаткой в имени поля выглядел
          // поломкой инструмента, а не негодным рецептом. Долг рецептов при
          // этом не печатался вовсе — одна опечатка гасила ВЕСЬ отчёт.
          return give(
            "форма шага не опознана (ждали create, copyTo, rename, append, appendFrom или find): " +
              step.file,
          );
        else {
          const needle = step.find.split("\n").join(NEWLINE);
          if (!was.includes(needle))
            return give("рецепт не находит своего места: " + step.file);
          writeFileSync(
            stepAt,
            was.replace(needle, step.replace.split("\n").join(NEWLINE)),
          );
        }
      }
      const after = readSections(runVerify(tmp));
      rollback();
      return { after };
    };

    // Рецепт под раскладку ЭТОГО проекта: пути подставлены из его настройки,
    // а файл, которого нет, ищется под другим именем того же предмета — как
    // его ищет и посадка: `vite.config.js` вместо `vite.config.ts`.
    const vars = recipeVars(false);
    const seatCopy = seatMapOf().copy ?? [];
    const otherName = (file) => {
      if (existsSync(path.join(tmp, file))) return file;
      const e = seatCopy.find((one) => one.to === file);
      return (
        (e?.alsoKnownAs ?? []).find((n) => existsSync(path.join(tmp, n))) ??
        file
      );
    };
    const localise = (r0) => {
      const r = recipeSubst(r0, vars);
      for (const step of r.edits ?? [r])
        if (step.file !== undefined) step.file = otherName(step.file);
      return r;
    };
    // Предмета у рецепта нет по устройству проекта, а не по пустому полю:
    // `whenNull` — ветка про ПУСТОЕ поле, а поле задано; `whenScript` — нет
    // скрипта, который рецепт правит; семя звена, которое посадка по правилу
    // `neededBy` не положила, — звена в проекте нет. Прежде всё это шло в
    // «написаны под свой проект» с советом перенацелить рецепт — работой,
    // которой у проекта нет: у проекта со своим раннером нечего перенацеливать
    // в конфиге чужого.
    const scriptsNow = () =>
      readJson(path.join(tmp, "package.json"), {}).scripts ?? {};
    const linkLives = (name) => {
      const one = (seatMapOf().chainScripts ?? []).find((e) => e.name === name);
      if (one?.recognise == null) return true;
      // Опознание то же, что у сверок: звено, розданное пакетам корневым
      // скриптом, живое. Иначе рецепт монорепозитория считался беспредметным
      // и его сверка молча теряла фальсификацию.
      return linkCalled(new RegExp(one.recognise), scriptsNow());
    };
    // `whenLink` — звенья, чей предмет рецепт ломает: секцию тестов в
    // настройке сборщика заводит звено тестов обвязки, а импорт из
    // `vitest/config` спрашивается только при звене типов. Проект со своим
    // раннером либо на обычном JavaScript их не несёт, и рецепт там
    // печатался «устаревшим» — прогон краснел на законном устройстве.
    // Замерено фальсификацией стендов на jest и на JavaScript.
    const idleByDesign = (r) => {
      if (r.whenNull !== undefined && CONFIG[r.whenNull] != null) return true;
      if (r.whenScript !== undefined && scriptsNow()[r.whenScript] == null)
        return true;
      if ((r.whenLink ?? []).some((name) => !linkLives(name))) return true;
      return (r.edits ?? [r]).some((step) => {
        if (step.file === undefined) return false;
        if (existsSync(path.join(tmp, step.file))) return false;
        const e = seatCopy.find((one) => one.to === step.file);
        if (e?.onlyWith != null && !seedConditionHolds(e)) return true;
        return e?.neededBy != null && !linkLives(e.neededBy);
      });
    };

    for (const r0 of recipes) {
      const r = localise(r0);
      if (idleByDesign(r)) {
        idle.push(r.section + " — предмета в этом проекте нет");
        continue;
      }
      // Предмета у сверки в этом проекте нет — поле настройки пусто. Ломать
      // нечего, и прогонять рецепт незачем.
      //
      // Спрашивается это ДО прогона, а не после неудачи. Прежде спрашивалось
      // после, и вопрос доставался только рецепту, не нашедшему своего места.
      // Рецепт, который место НАХОДИТ, а сверку не будит — потому что она
      // молчит про отсутствующий предмет, — попадал в «поломка не дошла ни до
      // одной сверки», то есть объявлялся слепой здоровая сверка. Замерено
      // рецептом напоминания о переходе: правка хука ложилась, сверка отвечала
      // «перехода нет: напоминать не о чем», и прогон краснел на законном
      // устройстве проекта.
      if (subjectless(r.section) || idleByNote(r.section)) {
        idle.push(r.section + " — предмета в этом проекте нет");
        continue;
      }
      if (Array.isArray(r.edits)) {
        const { failed, after } = runSteps(r);
        if (failed !== undefined) {
          (subjectless(r.section)
            ? idle
            : r.own === true || stepsFromSeed(r)
              ? foreign
              : broken
          ).push(r.section + " — " + failed);
          continue;
        }
        record(r.section, after);
        continue;
      }
      // Пятая форма: ЗАВЕСТИ файл с заданным содержимым. Ни правка, ни копия
      // тут не годятся — ломать надо тем, чего в дереве нет вовсе и чего неоткуда
      // скопировать: местным файлом разрешений с лишней строкой, документом с
      // заведомо битой ссылкой. Заведена при выплате долга рецептов.
      if (r.create !== undefined) {
        const madeAt = path.join(tmp, r.create.path);
        const dirsBack = makeDirs(path.dirname(madeAt));
        const had = existsSync(madeAt) ? readFileSync(madeAt) : null;
        writeFileSync(
          madeAt,
          r.create.text.split("\n").join(NEWLINE) + NEWLINE,
        );
        record(r.section, readSections(runVerify(tmp)));
        if (had === null) rmSync(madeAt);
        else writeFileSync(madeAt, had);
        dirsBack();
        continue;
      }
      const at = path.join(tmp, r.file);
      if (!existsSync(at)) {
        (subjectless(r.section)
          ? idle
          : r.own === true || fromSeed(r.file)
            ? foreign
            : broken
        ).push(r.section + " — файла нет: " + r.file);
        continue;
      }
      const before = readFileSync(at, "utf8");
      // `copyTo` — третья форма рецепта: не правка файла и не его пропажа, а
      // ПОЯВЛЕНИЕ нового. Часть сверок ловит именно лишнее: файл не там, где
      // ему положено. Сломать их правкой существующего нельзя — ломать надо
      // составом дерева. Заведена под сверку раскладки тестов, у которой с этой
      // посадки есть механизм исключений: непроверяемое исключение хуже
      // отсутствующего.
      let copiedOver = null;
      let copyDirsBack = () => {};
      if (r.copyTo !== undefined) {
        const toAt = path.join(tmp, r.copyTo);
        copiedOver = existsSync(toAt) ? readFileSync(toAt) : null;
        copyDirsBack = makeDirs(path.dirname(toAt));
        writeFileSync(toAt, before);
      } else if (r.append !== undefined) {
        // Четвёртая форма: ДОПИСАТЬ. Часть сверок ловит появление новой
        // записи — строки таблицы, нового заголовка, нового якоря, — и правка
        // существующего текста тут не годится: ломать надо тем, что добавили.
        // Заведена под долг рецептов: без неё половина сверок базы остаётся
        // непроверяемой, а непроверенная сверка неотличима от здоровой.
        //
        // ЯКОРЬ обязателен там, где сверка читает не весь файл, а свой
        // раздел. Дописывание в конец совпадает с разделом, только пока
        // раздел последний; проект завёл ниже свой — и поломка легла за
        // границей чтения, а прогон объявил здоровую сверку слепой.
        // Замерено посадкой начисто.
        const text = r.append.split("\n").join(NEWLINE);
        if (r.after === undefined) writeFileSync(at, before + NEWLINE + text);
        else {
          const lines = before.split(NEWLINE);
          const at0 = lines.findIndex((l) => l.trim() === r.after);
          if (at0 < 0) {
            (subjectless(r.section)
              ? idle
              : r.own === true || fromSeed(r.file)
                ? foreign
                : broken
            ).push(r.section + " — якорь дописывания не найден: " + r.after);
            continue;
          }
          lines.splice(at0 + 1, 0, text);
          writeFileSync(at, lines.join(NEWLINE));
        }
      } else if (r.rename !== undefined) {
        writeFileSync(path.join(tmp, r.rename), before);
        rmSync(at);
      } else {
        if (!before.includes(r.find.split("\n").join(NEWLINE))) {
          (subjectless(r.section)
            ? idle
            : r.own === true || fromSeed(r.file)
              ? foreign
              : broken
          ).push(r.section + " — рецепт не находит своего места");
          continue;
        }
        writeFileSync(
          at,
          before.replace(
            r.find.split("\n").join(NEWLINE),
            r.replace.split("\n").join(NEWLINE),
          ),
        );
      }
      record(r.section, readSections(runVerify(tmp)));
      if (r.copyTo !== undefined) {
        const toAt = path.join(tmp, r.copyTo);
        if (copiedOver === null) rmSync(toAt);
        else writeFileSync(toAt, copiedOver);
        copyDirsBack();
      } else if (r.rename !== undefined) {
        writeFileSync(at, before);
        rmSync(path.join(tmp, r.rename));
      } else writeFileSync(at, before);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // Долг считается от ОБЪЯВЛЕННОГО списка сверок, а не от напечатанных секций.
  // Печатаются не все: часть сверок молчит, пока у проекта нет их предмета, — и
  // считать долг по выводу значило бы вычитать из него ровно те сверки, про
  // которые сегодня ничего не известно. Долг тогда выглядел бы меньше, чем он
  // есть, причём тем меньше, чем беднее проект.
  const covered = new Set(recipes.map((r) => r.section));
  // Сверка, чей предмет у ЭТОГО проекта отсутствует, рецепта иметь не может:
  // ломать нечего. Считать её долгом значит держать в списке пункт, который на
  // этом проекте не закрывается никогда, — и долг перестают читать, потому что
  // он не убывает. Такие называются отдельно и с причиной.
  //
  // Список закрытый и держится полем настройки: предмет появится — поле
  // заполнят, и сверка вернётся в долг сама.
  const noSubject = [];
  const uncovered = [];
  for (const s of CHECK_SECTIONS) {
    if (covered.has(s)) continue;
    const field = RECIPE_NEEDS[s];
    if (field !== undefined && CONFIG[field] == null) {
      noSubject.push(s + " — предмета нет: поле `" + field + "` не заполнено");
      continue;
    }
    uncovered.push(s);
  }

  console.log("=== СВЕРКИ ЕЩЁ ЛОВЯТ ===");
  console.log("  поймали поломку: " + caught.length + " из " + recipes.length);
  if (astray.length) {
    console.log("  ПОЛОМКА УШЛА НЕ ТУДА: " + astray.length);
    for (const s of astray) console.log("    " + s);
  }
  if (silent.length) {
    console.log("  ПОЛОМКА НЕ ДОШЛА НИ ДО ОДНОЙ СВЕРКИ: " + silent.length);
    for (const s of silent) console.log("    " + s);
    console.log(
      "    Либо рецепту здесь не за что зацепиться, либо сверка слепа.",
    );
  }
  if (broken.length) {
    console.log("  рецепт устарел: " + broken.length);
    for (const b of broken) console.log("    " + b);
  }

  console.log("");
  if (foreign.length) {
    console.log("");
    console.log("=== РЕЦЕПТЫ НАПИСАНЫ ПОД СВОЙ ПРОЕКТ ===");
    console.log(
      "  их " +
        foreign.length +
        ": ломают файлы того проекта, где написаны, и в этом места не нашли.",
    );
    for (const f of foreign) console.log("    " + f);
    console.log(
      "  Это НЕ порча: перенацелить их на свои файлы — работа проекта,",
    );
    console.log("  и она стоит шагом плана перехода.");
  }

  console.log("=== ДОЛГ: СВЕРКИ БЕЗ РЕЦЕПТА ===");
  console.log(
    "  без рецепта: " + uncovered.length + " из " + CHECK_SECTIONS.length,
  );
  for (const u of uncovered) console.log("    " + u);
  console.log(
    "  Это долг, а не состояние: сверка без рецепта фальсифицирована один раз,",
  );
  console.log("  при заведении, и с тех пор её здоровье никем не проверено.");

  if (idle.length) {
    console.log("");
    console.log("=== БЕЗ ПРЕДМЕТА: РЕЦЕПТ ЕСТЬ, ЛОМАТЬ НЕЧЕГО ===");
    for (const n of idle)
      console.log("  " + n.split(" — ")[0] + " — предмета в этом проекте нет");
    console.log(
      "  Рецепт приехал с обвязкой и здесь не на чем сработать. Заведётся предмет — сработает сам.",
    );
  }

  if (noSubject.length) {
    console.log("");
    console.log("=== БЕЗ ПРЕДМЕТА: РЕЦЕПТА БЫТЬ НЕ МОЖЕТ ===");
    for (const n of noSubject) console.log("  " + n);
    console.log(
      "  Ломать нечего. Заполнится поле — сверка вернётся в долг сама.",
    );
  }

  if (silent.length || astray.length || broken.length) process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
}
// --- handoff: собрать обвязку для передачи -----------------------------------
//
// Отвечает на вопрос «что именно копировать, чтобы папка была самодостаточной».
// Раньше ответ держался памятью и звучал как «эта папка плюс те файлы, и не
// забыть вот это» — форма, которая ломается через месяц.
//
// Отбор ИСКЛЮЧАЮЩИЙ, а не включающий: копируется всё, кроме объявленного
// проектного. Включающий список отстал бы от первого же нового файла доктрины,
// и снимок уехал бы неполным молча.
// --- transition: напомнить о незакрытом переходе -------------------------------
//
// Режим дешёвый намеренно: его зовёт хук среды при правке файлов проекта, а
// сверка базы для этого слишком долгая. Читает один файл и выходит нулём
// всегда — напоминание не может ронять чужую работу.
if (mode === "transition") {
  // Корпус — сам файл плана: есть он или нет. Шаги считает `printTransition`,
  // и второй счёт разошёлся бы с ним молча.
  sayLooked(
    "файлов плана перехода",
    CONFIG.transition != null &&
      existsSync(path.join(BASE, CONFIG.transition.file))
      ? 1
      : 0,
  );
  const said = printTransition();
  const alsoSaid = printFindings();
  if (!said && !alsoSaid)
    console.log(
      "Перехода нет: проект родился под обвязкой либо переход закончен.",
    );
  process.exit(0);
}

if (mode === "handoff") {
  sayLooked("семян в карте посадки", seedsDeclared.length);
  // Имя по умолчанию — рядом с проектом и не `.claude`: редактор держит свои
  // папки настроек и в проекте, и в рабочей области, и снимок, положенный туда,
  // сливается с ними. Найдено попыткой собрать снимок в корень рабочей области,
  // где уже лежали локальные разрешения.
  const asked = process.argv[3] ?? null;
  const dest = asked ?? path.join(BASE, "..", "..", "claudeHandoff");
  if (SHELF === null) {
    console.log("=== Обвязка не заявлена ===");
    console.log("  В настройке проекта поле `shelf` пусто: собирать нечего.");
    process.exit(1);
  }
  const mapAt = path.join(SHELF, "seat/map.json");
  if (!existsSync(mapAt)) {
    console.log("=== Карты посадки нет ===");
    console.log("  Ожидалась: " + rel0(mapAt));
    process.exit(1);
  }
  const NEWLINE = String.fromCharCode(10);
  const CRLF = String.fromCharCode(13) + NEWLINE;
  const seatMap = JSON.parse(readFileSync(mapAt, "utf8"));
  // Границу между «едет» и «не едет» проводит САМА СРЕДА, а не наша догадка.
  // Она читает два файла разрешений: общий коммитится и достаётся всем,
  // местный она держит вне git и именно в него пишет всё, что человек нажал
  // кнопкой «больше не спрашивай». Значит нажитое по ходу работы не едет по
  // умолчанию, а чтобы поехало — его переносят в общий файл руками.
  //
  // Прежде здесь стоял отбор по форме строки. Он угадывал и промахивался в обе
  // стороны молча: "Read(src/**)" — путь, но общий, а "./scripts/release.sh" —
  // и путь, и скрипт проекта сразу.
  const skip = new Set(seatMap.projectOwnedInsideHarness ?? []);

  const copied = [];
  const left = [];
  const copyTree = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from)) {
      if (OUT_OF_TREE.has(e)) continue;
      const src = path.join(from, e);
      const rel = path.relative(SHELF, src).split(path.sep).join("/");
      if (skip.has(rel)) {
        left.push(rel);
        continue;
      }
      if (statSync(src).isDirectory()) copyTree(src, path.join(to, e));
      else {
        // Концы строк приводятся к одному виду: снимок едет между машинами, а
        // на машине с иной политикой многострочная правка перестаёт находиться.
        writeFileSync(
          path.join(to, e),
          readFileSync(src, "utf8").split(CRLF).join(NEWLINE),
        );
        // Режим едет вместе с файлом: снимок, потерявший бит исполнения у
        // хука ворот, отдаёт получателю ворота, которые git не запускает.
        chmodSync(path.join(to, e), statSync(src).mode & 0o777);
        copied.push(rel);
      }
    }
  };

  // Названная папка понимается как «куда положить», а не «что заполнить».
  // Человек говорит «собери в такую-то папку», имея в виду, что внутри неё
  // появится папка снимка, — и указывает при этом живое место: корень рабочей
  // области, диск флешки. Прежде режим пытался заполнить названную папку саму и
  // отказывался, раз она не пуста. Найдено прямым несовпадением: разработчик
  // назвал корень рабочей области и получил отказ вместо снимка.
  const named = path.resolve(dest);
  // Вкладывать снимок в занятую папку можно ТОЛЬКО когда её назвали. Человек
  // говорит «собери вот сюда», имея в виду живое место — корень рабочей
  // области, флешку, — и внутри него появляется папка снимка.
  //
  // Умолчание так понимать нельзя: оно само и есть папка снимка. Занятое, оно
  // давало `claudeHandoff/claudeHandoff`, и снимок уезжал на уровень глубже,
  // чем его ищут. Прежний снимок при этом оставался лежать первым — то есть
  // получатель забирал СТАРЫЙ. Найдено повторной сборкой подряд.
  const busy = existsSync(named) && readdirSync(named).length > 0;
  const root =
    busy && asked !== null ? path.join(named, "claudeHandoff") : named;
  const claudeAt = path.join(root, ".claude");

  // Цель осматривается ДО записи, и осматривается ЦЕЛИКОМ, а не только её
  // вложенная папка настроек. Правило то же, что у первой фазы посадки:
  // существующее не перезаписывается. Без этой проверки режим положил бы
  // полсотни файлов в чужую папку настроек — редактор держит свои и в проекте,
  // и в рабочей области. Найдено попыткой собрать снимок в корень области.
  if (existsSync(root) && readdirSync(root).length > 0) {
    console.log("=== СНИМОК НЕ СОБРАН ===");
    console.log("  Папка снимка уже занята: " + norm(root));
    console.log("  В ней лежит: " + readdirSync(root).slice(0, 6).join(", "));
    console.log(
      "  Снимок кладут в пустое место: слитый с чужим содержимым он ломает",
    );
    console.log("  и его, и себя. Удалите её либо назовите другую папку.");
    process.exit(1);
  }

  copyTree(SHELF, claudeAt);

  // Памятка получателю лежит РЯДОМ с папкой, а не внутри неё. Внутри она
  // сделала бы обвязку не той же самой, и сверка состава краснела бы на файле,
  // которого в обвязке быть не должно.
  const stamp = new Date().toISOString().slice(0, 10);
  // Требования к машине берутся из проверенной связки СЕМЕНИ настройки:
  // написать их числом здесь значило бы завести второй список, и он разошёлся
  // бы с первым при первом же обновлении связки.
  const envNeeds = (() => {
    const at = shelfAt("seat/templates/graph.config.mjs");
    if (at === null || !existsSync(at)) return null;
    const body = readFileSync(at, "utf8");
    const block = body.slice(body.indexOf("verifiedVersions: {"));
    const pick = (name) => {
      const hit = new RegExp(name + ':\\s*"([^"]+)"').exec(block);
      return hit === null ? null : hit[1];
    };
    const named = [
      ["node", pick("node")],
      ["npm", pick("npm")],
    ].filter(([, v]) => v !== null);
    return named.length === 0
      ? null
      : named.map(([n, v]) => n + " " + v).join(", ");
  })();
  const envLine =
    envNeeds === null
      ? "Версии среды объявлены настройкой обвязки, полем проверенной связки."
      : "**Не ниже проверенной связки: " + envNeeds + ".**";
  writeFileSync(
    path.join(root, "ЧИТАТЬ-ПЕРВЫМ.md"),
    [
      "# Обвязка: что это и что с ней делать",
      "",
      "Рядом лежит папка `.claude` — это рабочий порядок: правила качества,",
      "устройство базы знаний, инструмент, который строит граф связей в коде",
      "и сверяет с ним записи о проекте, скиллы и заготовки всех",
      "файлов, которые нужны новому проекту.",
      "",
      "## Что нужно на машине",
      "",
      envLine,
      "",
      "Ниже этого установка пакетов падает СОБСТВЕННОЙ ошибкой менеджера, где",
      "про версию нет ни слова, и посадка встаёт на ровном месте. Проверить:",
      "`node --version`, `npm --version`.",
      "",
      "## Что сделать",
      "",
      "1. Скопировать папку `.claude` в корень своего проекта — как есть, с",
      "   точкой в начале имени. Переименовывать ничего не нужно.",
      "2. Сказать ассистенту: **посади обвязку**. Дальше он работает по",
      "   инструкции внутри — `.claude/seat/seat.md`.",
      "",
      "**Если в проекте уже есть `.claude`** — копирование её не затирает:",
      "разрешения среды обвязка готовыми не везёт, посадка дописывает свои",
      "строки в файл проекта. Совпадёт имя другого файла — он перезапишется:",
      "свои `rules/` и `skills/` сличить с обвязкой до копирования.",
      "",
      "**На macOS и Linux папка с точкой скрыта.** Копировать командой либо",
      "включить показ скрытых файлов.",
      "",
      "## Откуда снимок",
      "",
      "- собран: " + stamp,
      "- файлов: " + copied.length,
      "- проверен посадкой в пустую папку: см. вывод сборки",
      "",
      "---",
      "",
      "**Этот файл — памятка переноса, а не часть обвязки.** К её работе он",
      "отношения не имеет, никуда не копируется и ничем не проверяется.",
      "Прочитали — удаляйте.",
    ].join(NEWLINE) + NEWLINE,
  );

  // Печатается то, из чего состоит отчёт о сборке: путь, счёт, что исключено.
  // Иначе эти числа пересказываются по памяти, и проверить их по отчёту нечем.
  console.log("=== СНИМОК СОБРАН ===");
  console.log("  путь:      " + norm(root));
  console.log("  файлов:    " + copied.length);
  // Называется то, что РЕАЛЬНО не поехало, а не список правил исключения.
  // Прежде печатались правила, и в отчёте стоял файл, которого в проекте нет
  // вовсе. Найдено прямым вопросом.
  //
  // И называется полным адресом: файлов с похожим именем несколько, а
  // «settings.json» без адреса читается как любой из них.
  //
  // Плюс сказано, что с исключённым происходит. Строка «исключено» звучит как
  // «потеряно», хотя общая половина этих разрешений уже уехала семенем, а
  // осталась только проектная. Найдено тем же вопросом: «а разве оно не едет?»
  // Что сказать об исключённом, зависит от файла: местный файл разрешений
  // не едет никогда, общий — едет СЕМЕНЕМ, а файл мастерской остаётся ей.
  // Прежде строка была одна на всё и называла общий файл местным.
  const whyLeft = {
    "settings.local.json":
      "местный файл разрешений: среда пишет в него нажатое кнопкой и держит вне git; общее из него переносят в общий файл руками",
    "settings.json":
      "общий файл разрешений этого проекта: получателю он едет семенем seat/templates/settings.json и дописывается в его собственный",
  };
  for (const one of left)
    console.log(
      "  исключено: .claude/" +
        one +
        " — " +
        (whyLeft[one] ?? "файл проекта, не обвязки"),
    );

  // Самопроверка: снимок сажается в пустую папку и прогоняется сверкой.
  // Без неё «самодостаточна» остаётся обещанием: собранная папка, в которой
  // чего-то не хватает, выглядит ровно так же, как полная, и обнаруживается
  // это у получателя через неделю.
  const probe = path.join(root, ".проба-посадки");
  try {
    rmSync(probe, { recursive: true, force: true });
    for (const d of seatMap.dirs)
      mkdirSync(path.join(probe, d), { recursive: true });
    copyTree(claudeAt, path.join(probe, ".claude"));
    for (const one of seatMap.copy) {
      // Пометки карты читаются и здесь. Семя, которое кладут НЕ на посадке,
      // проба не кладёт — иначе она сажает не то, что сажает посадка, и
      // собственная сверка снимка краснеет на его же правильной сборке.
      // Найдено ровно так: пометка появилась данными, проба её не узнала, и
      // снимок перестал собираться — молча для того, кто смотрит на первую
      // строку вывода.
      if (one.notAtSeating !== undefined) continue;
      const src = path.join(claudeAt, one.from);
      const dst = path.join(probe, one.to);
      if (!existsSync(src)) throw new Error("в снимке нет семени: " + one.from);
      mkdirSync(path.dirname(dst), { recursive: true });
      writeFileSync(dst, readFileSync(src, "utf8"));
    }
    // Годность снимка определяет КОД ВОЗВРАТА сверки, а не разбор её вывода.
    // Разбор строк уже соврал однажды: выражение искало букву вместо любого
    // непробела, потому что обратный слеш терялся при правке, и снимок
    // объявлялся годным, не посмотрев ни на одну строку. Плюс под флагом
    // посадки часть строк законно печатается при зелёном прогоне — их разбор
    // принимал за поломку.
    execFileSync(
      process.execPath,
      [path.join(probe, ".claude/tools/graph.mjs"), "verify"],
      { encoding: "utf8", cwd: probe },
    );
    console.log("  проверка:  посажен в пустую папку, сверка базы — код 0");
    console.log("");
    console.log("=== ЧТО С НИМ ДЕЛАТЬ ===");
    console.log("  - взять папку целиком: " + norm(root));
    console.log(
      "  - получатель копирует .claude в корень своего проекта и говорит",
    );
    console.log("    «посади обвязку»");
    console.log(
      "  - памятка ЧИТАТЬ-ПЕРВЫМ.md одноразовая, удаляется после прочтения",
    );
    // исход снимка решает код возврата сверки выше
  } catch (e) {
    console.log("=== СНИМОК НЕ СОБРАН ===");
    // Печатается вывод СВЕРКИ, а не текст исключения: «команда завершилась
    // ошибкой» не говорит, чего не хватило, и чинить по нему нечего.
    const said = String(e.stdout ?? "").split(NEWLINE);
    const red = said.filter((l) => /^ {4}\S/.test(l) && !l.includes("<"));
    if (red.length) for (const r of red) console.log("  " + r.trim());
    else console.log("  " + String(e.message).split(NEWLINE)[0]);
    console.log("  Отдавать нельзя: у получателя он не встанет,");
    console.log("  и потому папка снимка удалена: " + norm(root) + ".");
    // Негодный снимок не остаётся лежать. Оставленный, он неотличим от
    // годного: строка об отказе уходит в конец длинного вывода, а папка на
    // месте — и её берут. Замерено на себе: снимок не собирался несколько
    // кругов подряд, а посадки шли из него как ни в чём не бывало.
    rmSync(root, { recursive: true, force: true });
    process.exitCode = 1;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
  process.exit(process.exitCode ?? 0);
}
if (mode === "dead") {
  sayLooked(
    "файлов с экспортами",
    files.filter((f) => !isTest(f) && exportsOf.get(f)?.size).length,
  );
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
  console.log(`
Файлов с неимпортируемым экспортом: ${rows.length}.`);
}

if (mode === "blast") {
  sayLooked("файлов кода", files.length);
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
  sayLooked("файлов кода и стилей в графе", files.length + styleFiles.length);
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
      "Укажи путь: node .claude/tools/graph.mjs plan <путь или его хвост>",
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
      const isStyle = isStylePath(r);
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
  sayLooked("файлов кода", files.length);
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
  sayLooked(
    "файлов базы",
    readdirSync(BASE).filter((n) => n.endsWith(".md")).length,
  );
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
  // Имя файла без папки — ещё не адрес. Одноимённый файл лежал в проекте в трёх
  // местах, и документ про один из них засчитывался другому, в соседней папке:
  // пункт, который нельзя закрыть, —
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
    const bare = base.replace(CODE_OR_STYLE, "");
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

  // Пустое поле настройки означает сверку, которой в этом проекте не на чем
  // сработать. Само по себе это законно — не у всякого проекта есть парные
  // копии или связи через DOM. Но сводка открытого для того и собирается, чтобы
  // видеть, ЧЕГО не доказано: прогон, у которого половина сверок молчит за
  // отсутствием предмета, читается как прогон, у которого всё хорошо.
  //
  // Печатается счётом, а не списком: список повторял бы настройку, а она рядом
  // и с объяснениями. Сверку «выключено при живом предмете» это не заменяет —
  // та ловит пустое поле ПРИ предмете, здесь же речь о честно пустых.
  const empty = Object.entries(CONFIG).filter(
    ([, v]) => v === null || (Array.isArray(v) && v.length === 0),
  ).length;
  console.log("=== Сверки без предмета в этом проекте ===");
  console.log(
    `  полей настройки пусто: ${empty} из ${Object.keys(CONFIG).length}` +
      " — столько сверок здесь молчит не потому, что всё сошлось",
  );
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
// --- gate: ворота перед коммитом --------------------------------------------
//
// Свод по планке спрашивался только с НЕЗАКОММИЧЕННОГО: предмет его —
// правленое по `git status`, то есть рабочее дерево. Коммит дерево опустошает,
// и сверка замолкала. Требование при этом не откладывалось — оно УДАЛЯЛОСЬ:
// красное «свод на другом предмете» исчезало от коммита, а не от починки, и
// ни один следующий прогон о нём не вспоминал.
//
// Ломалось это четырьмя обычными способами, и ни один не был жульничеством:
// коммит раньше прогона; коммит поверх красного; сессия, кончившаяся посреди
// работы; несколько коммитов подряд. Замерено на себе.
//
// Ворота стоят там, где ошибка совершается. Предмет их — ИНДЕКС, а не рабочее
// дерево: отпечатки считаются с того содержимого, которое поедет в коммит, и
// свод обязан быть в индексе вместе с ним. Иначе история получила бы правку
// без свода, а ревизия — свод, которого в коммите нет.
if (mode === "gate") {
  const NEWLINE = String.fromCharCode(10);
  const { execFileSync } = await import("node:child_process");
  const git = (args) =>
    execFileSync("git", args, {
      cwd: REPO_AT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  let staged;
  try {
    staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
      .split(NEWLINE)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    staged = null;
  }
  if (staged === null) {
    sayLooked("файлов в индексе", 0);
    console.log("  git недоступен — ворота проверить нечем, и это не «чисто»");
    process.exit(1);
  }
  sayLooked("файлов в индексе", staged.length);
  const seeds = seedOfPath();
  let fromShelf = 0;
  let formatted = 0;
  const want = [];
  for (const one of staged) {
    const abs = norm(path.join(REPO_AT, one));
    if (!files.includes(abs) && !styleFiles.includes(abs)) continue;
    if (abs.endsWith(".d.ts")) continue;
    let body;
    try {
      body = git(["show", ":" + one]);
    } catch {
      continue;
    }
    // Семя, лежащее нетронутым, — работа обвязки, а не проекта.
    const seedAt = seeds.has(one) ? shelfAt(seeds.get(one)) : null;
    const seedBody =
      seedAt !== null && existsSync(seedAt)
        ? readFileSync(seedAt, "utf8")
        : null;
    if (
      sameAsSeed(body, seedBody) ||
      (await formatOnly(seedBody, body, abs))
    ) {
      fromShelf += 1;
      continue;
    }
    let head = null;
    try {
      head = git(["show", "HEAD:" + one]);
    } catch {
      head = null;
    }
    if (await formatOnly(head, body, abs)) {
      formatted += 1;
      continue;
    }
    want.push({ file: rel(abs), mark: barDigest(body) });
  }
  want.sort((x, y) => (x.file < y.file ? -1 : 1));
  console.log("=== Ворота перед коммитом ===");
  console.log(
    "  кода и стилей в индексе: " +
      want.length +
      (fromShelf ? ", и ещё " + fromShelf + " лежит семенем обвязки" : "") +
      (formatted ? ", и ещё " + formatted + " — одно приведение формата" : ""),
  );
  if (!want.length) {
    console.log("  кода в коммите нет — свод не спрашивается");
    process.exit(0);
  }
  for (const one of want) console.log("    " + one.file);
  let body = null;
  if (CONFIG.barProtocol != null) {
    const at = path.posix.join(
      path.relative(REPO_AT, BASE).split(path.sep).join("/"),
      CONFIG.barProtocol,
    );
    try {
      body = git(["show", ":" + at]);
    } catch {
      body = null;
    }
  }
  const fault = barCoverFault(want, body);
  if (fault === "") {
    console.log("  свод покрывает правку: коммит проходит");
    process.exit(0);
  }
  console.log("  КОММИТ НЕ ПРОХОДИТ: " + fault);
  console.log(
    "  Свод по планке делают ДО коммита: node .claude/tools/graph.mjs bar",
  );
  console.log(
    "  Протокол добавляют в тот же коммит — иначе история получит правку без свода.",
  );
  process.exit(1);
}
if (mode === "twins") {
  sayLooked("объявленных пар форков", (CONFIG.forks ?? []).length);
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
  sayLooked("файлов кода и стилей в графе", files.length + styleFiles.length);
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
      .filter((f) => CODE_OR_STYLE.test(f) && !isTest(f) && !existsSync(f));

    // Стиль в граф импортов не входит — его подключает сборщик, — поэтому в
    // `touchedCode` он не попадает, и раньше правка стилей получала ответ
    // «правка кода не касается». Между тем держат стили как раз тесты, читающие
    // их ТЕКСТОМ: соответствие переменных, слои, фолбэки. Найдено пробой:
    // тронутый файл стилей не назвал ни одного из своих тестов, а их было пять.
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

    // След прогона: какие файлы кода этот режим показал и в каком виде.
    //
    // Зачем. Правила объявляют этот режим частью КАЖДОГО отчёта о правке кода,
    // а держалось это памятью: вопрос о планке печатается здесь, но напечатан
    // он только если режим позвали. Найдено рефактором по планке: две находки
    // раздела «форма контракта» прошли мимо, и режим в тот заход не звали ни
    // разу — то есть вопрос не был задан вообще.
    //
    // Следом закрывается ровно одна половина: что вопрос ПРЕДЪЯВЛЕН на конечном
    // виде правки. Честность ответа машине по-прежнему недоступна, и это
    // объявлено в каталоге ограничений.
    //
    // Содержимое, а не время: клон ставит всем файлам одну свежую метку.
    if (CONFIG.testedLedger != null) {
      const at = path.join(BASE, CONFIG.testedLedger);
      const seen = readJson(at, {});
      for (const f of [...touchedCode, ...touchedStyles])
        seen[rel(f)] = createHash("sha1")
          .update(readFileSync(f, "utf8").split("\r\n").join("\n"))
          .digest("hex")
          .slice(0, 12);
      writeFileSync(at, JSON.stringify(seen, null, 2) + NEWLINE);
    }

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
        if (scope.state === "не прочитано")
          console.log(
            "  ВНИМАНИЕ: деление на применимые заявлено, а таблицу" +
              " применимости прочитать не удалось — какие разделы живые," +
              " сейчас неизвестно. Чинится до сверки, а не после.",
          );
        // Проход по планке ведёт свой режим: он печатает строку на каждый
        // живой критерий и ставит печать, сверив форму. Перечень разделов
        // печатался здесь и переехал туда, где по нему ставят исход, — тут
        // он был бы вторым списком тех же имён и разошёлся бы с политикой
        // первой же её правкой. Указание «сверься с планкой» без адреса
        // бесполезно, и адрес теперь есть: это команда, а не раздел правил,
        // в который надо вспомнить заглянуть.
        console.log(
          "  Проход ведёт режим `bar`: строка на каждый живой критерий," +
            " исход в каждой строке, печать по сверенной форме.",
        );
        console.log(
          "  Звать: node " +
            norm(path.relative(REPO_AT, fileURLToPath(import.meta.url))) +
            " bar",
        );
        // Связь через разметку и стили — второй по незаметности способ: она
        // не видна ни компилятору, ни графу импортов, а новый компонент
        // заводит её первой же строкой стиля. Спрашивается по факту правки
        // кода или стилей, а не ждёт прогона: прогон бывает позже, а решение
        // «объявлять или сводить конструкцией» принимают здесь.
        {
          const { vars, attrs } = foreignLinks();
          if (vars.length || attrs.length)
            console.log(
              "  Чужих связей через разметку и стили: " +
                (vars.length + attrs.length) +
                ". Каждая обязана быть названа таблицей связей.",
            );
          console.log(
            "  Своё дублирование через границу языков таблицей НЕ" +
              " объявляют — его сводят к одному источнику (критерий C7-бис).",
          );
        }
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
      // Вопрос был прозой и ответ держался памятью: замерено на приложении с
      // нуля, где заполнены оказались ровно те записи базы, у которых есть
      // сверка. Теперь у него есть адрес, словарь и печать — таблица «База и
      // документация» в протоколе свода.
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
      console.log(
        "  Ответ ставится ПОФАЙЛОВО и порознь в протоколе свода, таблица",
      );
      console.log(
        "  «База и документация»: `правлено` с адресом либо `не требуется`",
      );
      console.log("  с причиной. Пустая клетка не даёт печати.");

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

      // Сводка исходов — машинный крючок на требование формы отчёта. Исход у
      // каждой находки называется внутри прозы, и собрать итог можно только
      // прочитав весь текст; читатель начинает угадывать его по оборотам.
      // Печатается всегда, когда правка вообще была: находок могло не быть, но
      // сделанное было, и блок «исправлено» в отчёте обязан стоять.
      console.log(NEWLINE + "=== Сводка исходов — последним блоком отчёта ===");
      console.log(
        "  ИСПРАВЛЕНО / НЕ ИСПРАВЛЕНО / ОТЛОЖЕНО — списком, каждая строка про",
      );
      console.log(
        "  одно: что было не так и что с этим стало. Блок, в котором нечего",
      );
      console.log(
        "  сказать, не печатается. Объяснения остаются у находок; здесь итог.",
      );

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
        const bare = base.replace(BARE_EXT, "");
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
  sayLooked("файлов кода и стилей в графе", files.length + styleFiles.length);
  // Мутационный прогон бывает не у всякого проекта, и молчать об этом нельзя.
  // Прежде поле указывало на конфиг, которого нет, область прогона выходила
  // пустой, и режим печатал «правка файлов в области прогона не касается» —
  // то есть зелёное. Выключенное и «нечего делать» выглядели одинаково.
  if (CONFIG.mutationConfig == null) {
    console.log("=== Мутационный прогон против правки ===");
    console.log("  мутационный прогон в этом проекте не заявлен");
    process.exit(0);
  }
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

  const ledger = existsSync(ledgerPath) ? readJson(ledgerPath, {}) : {};

  // Область прогона берётся из конфига самого инструмента. Считать долг по
  // всему `src` значило бы врать: часть файлов исключена намеренно и с
  // записанной причиной, и они бы числились долгом навсегда.
  const mutateGlobs = (() => {
    const cfg = path.join(BASE, CONFIG.mutationConfig);
    if (!existsSync(cfg)) return null;
    return readJson(cfg, {}).mutate ?? [];
  })();
  // Третье состояние, которого не было: конфиг ЕСТЬ, а область в нём не
  // заполнена. Семя привозит его с заглушкой, и заполняет её проект. Пока не
  // заполнил, ни один путь не совпадает — и режим печатал «правка файлов в
  // области прогона не касается», то есть зелёное. Выключенное от «нечего
  // делать» отличали, а НЕЗАПОЛНЕННОЕ — нет, и выглядело оно как второе.
  //
  // Найдено вопросом разработчика «прогонялось ли написанное Stryker»: на
  // стенде область стояла заглушкой с посадки, прогон не делался ни разу, а
  // режим отвечал так, будто делать нечего.
  // Состояний у прогона ЧЕТЫРЕ, а различалось два.
  //
  //   поле пусто            — прогон не заявлен, и режим так и говорит;
  //   поле есть, файла нет  — объявлено то, чего на диске не существует;
  //   файл есть, область не заполнена — заглушка семени стоит как приехала;
  //   область заполнена     — только здесь долг считается по-настоящему.
  //
  // Второе и третье печатали «правка файлов в области прогона не касается», то
  // есть зелёное. Первое было починено раньше — и починено только оно.
  const areaMissing = CONFIG.mutationConfig != null && mutateGlobs === null;
  const areaEmpty =
    mutateGlobs !== null &&
    (mutateGlobs.length === 0 ||
      mutateGlobs.every((g) => /^<.*>$/.test(String(g).trim())));
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
      console.log(
        areaMissing
          ? "  КОНФИГ ПРОГОНА ОБЪЯВЛЕН, А ФАЙЛА НЕТ: " +
              CONFIG.mutationConfig +
              NEWLINE +
              "  долг мутационного прогона не считается ни по одному файлу"
          : areaEmpty
            ? "  ОБЛАСТЬ ПРОГОНА НЕ ЗАПОЛНЕНА: в конфиге стоит заглушка с посадки," +
              NEWLINE +
              "  и долг мутационного прогона не считается ни по одному файлу"
            : "  правка файлов в области прогона не касается",
      );
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

// Фальсификация самого ПРОХОДА по планке.
//
// Печать протокола говорит: по каждому критерию дан ответ, и дан на этом виде
// предмета. О верности ответа она не говорит ничего — и это была последняя
// опора, державшаяся одним вниманием. Приём, которому обвязка уже доверяет,
// сюда просто не наводили: сверки фальсифицируются рецептом, звенья цепочки —
// посаженной поломкой, а человеческий шаг не фальсифицировался никогда.
//
// Режим сажает в песочную копию известное нарушение известного критерия и
// молчит о том, какое. Свод делается в песочнице обычным порядком. Второй
// вызов судит: назван ли посаженный критерий с посаженным адресом. Вердикт
// машинный целиком — отчёт читать не нужно, читается протокол.
//
// Чего замер не доказывает: нарушение посажено в файле, заведённом ради пробы,
// и оттого заметнее настоящего. Доля выходит оптимистичной и читается как
// верхняя граница. Критерии-суждения не сажаются вовсе.
if (mode === "bar-probe") {
  {
    const all = liveBarCriteria();
    sayLooked("живых критериев планки", all === null ? 0 : all.all.length);
  }
  const NEWLINE = String.fromCharCode(10);
  const at = path.join(TOOL_DIR, "bar-probes.json");
  if (!existsSync(at)) {
    console.log("=== Сажаемых нарушений нет ===");
    console.log("  Ожидался файл: " + norm(at));
    process.exit(1);
  }
  const plants = JSON.parse(readFileSync(at, "utf8")).plants;
  const ledgerAt =
    CONFIG.barProbeLedger == null
      ? null
      : path.join(BASE, CONFIG.barProbeLedger);
  const judged = process.argv[3];

  if (judged === undefined) {
    // Посадка. Песочница живёт ВНЕ репозитория: свод на задаче изменения
    // читает состояние репозитория, и песочница внутри рабочего дерева
    // попадала бы в предмет свода самого проекта.
    const id = String(Date.now()).slice(-8);
    const box = path.join(tmpdir(), "bar-probe-" + id);
    const mark = path.join(tmpdir(), "bar-probe-" + id + ".plant.json");
    const plant = plants[Math.floor(Math.random() * plants.length)];
    rmSync(box, { recursive: true, force: true });
    sandboxTree(path.join(BASE, ".."), box);
    sandboxManifests(
      path.join(BASE, "..", "node_modules"),
      path.join(box, "node_modules"),
    );
    // Протокол прошлой работы в песочницу не едет: свод обязан начаться с
    // чистого листа, иначе проба мерит вчерашний проход.
    if (CONFIG.barProtocol != null)
      rmSync(
        path.join(
          box,
          path.relative(path.join(BASE, ".."), BASE),
          CONFIG.barProtocol,
        ),
        {
          force: true,
        },
      );
    try {
      execFileSync("git", ["init", "-q"], { cwd: box, stdio: "ignore" });
      execFileSync("git", ["add", "-A"], { cwd: box, stdio: "ignore" });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=probe",
          "-c",
          "user.email=probe@local",
          "commit",
          "-qm",
          "base",
        ],
        { cwd: box, stdio: "ignore" },
      );
    } catch {
      console.log("=== Проба не посажена ===");
      console.log(
        "  git в песочнице недоступен, а предмет свода на задаче изменения —",
      );
      console.log("  это правленое. Судить было бы не о чем.");
      rmSync(box, { recursive: true, force: true });
      process.exit(1);
    }
    // Адрес посадки считается от корня ИСХОДНИКОВ: у чужого проекта он зовётся
    // не `src`, и адрес, записанный от корня репозитория, лёг бы мимо.
    const where = path.join(
      box,
      path.relative(path.join(BASE, ".."), ROOT),
      plant.create.path,
    );
    mkdirSync(path.dirname(where), { recursive: true });
    writeFileSync(where, plant.create.text.split("\n").join(NEWLINE));
    writeFileSync(
      mark,
      JSON.stringify(
        { criterion: plant.criterion, why: plant.why, file: norm(where), box },
        null,
        2,
      ) + NEWLINE,
    );
    console.log("=== Проба планки посажена ===");
    console.log("  песочница: " + norm(box));
    console.log("");
    console.log("  Что делать: сделать свод в песочнице обычным порядком —");
    console.log("    cd " + norm(box));
    console.log("    node .claude/tools/graph.mjs bar");
    console.log("  прочитать правленое, поставить исход по каждому критерию,");
    console.log("  позвать режим снова и получить печать.");
    console.log("");
    console.log("  Затем судить: node .claude/tools/graph.mjs bar-probe " + id);
    console.log("");
    console.log("  Что посажено — не говорится намеренно. Запись лежит ВНЕ");
    console.log("  песочницы, чтобы не попасться своду на глаза случайно;");
    console.log("  от умышленного подглядывания она не защищает и не может.");
    process.exit(0);
  }

  // Суд. Принимается и короткий номер, и полный путь песочницы.
  const id =
    judged.includes(path.sep) || judged.includes("/")
      ? path.basename(norm(judged)).replace(/^bar-probe-/, "")
      : judged;
  const mark = path.join(tmpdir(), "bar-probe-" + id + ".plant.json");
  if (!existsSync(mark)) {
    console.log("=== Пробы с таким номером нет ===");
    console.log("  Ожидалась запись: " + norm(mark));
    process.exit(1);
  }
  const plant = JSON.parse(readFileSync(mark, "utf8"));
  const protocolAt =
    CONFIG.barProtocol == null
      ? null
      : path.join(
          plant.box,
          path.relative(path.join(BASE, ".."), BASE),
          CONFIG.barProtocol,
        );
  const was = barHeader(protocolAt);
  console.log("=== Суд по пробе планки ===");
  console.log("  посажено: " + plant.criterion + " — " + plant.why);
  console.log("  где: " + norm(path.relative(plant.box, plant.file)));
  let verdict;
  if (was === null) verdict = "свода нет";
  else if (was.seal === null || was.seal === "нет") verdict = "свод без печати";
  else if (was.seal !== barSealOf(was.body))
    verdict = "печать не сходится: протокол правлен после неё";
  else {
    const said = new Map();
    for (const line of was.body.split(/\r?\n/)) {
      if (!line.startsWith("| ")) continue;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length !== 6 || /^-+$/.test(cells[0])) continue;
      said.set(cells[0], { outcome: cells[2], addr: cells[3], what: cells[4] });
    }
    const planted = path.basename(plant.file);
    const hitsPlanted = (one) =>
      one !== undefined &&
      one.outcome === "нашлось" &&
      one.addr.includes(planted);
    const mine = said.get(plant.criterion);
    if (hitsPlanted(mine)) verdict = "поймано";
    else if (mine !== undefined && mine.outcome === "нашлось")
      verdict = "критерий назван, адрес другой: " + mine.addr;
    else {
      const byOther = [...said.entries()].filter(([, one]) => hitsPlanted(one));
      verdict =
        byOther.length > 0
          ? "названо другим критерием: " + byOther.map(([k]) => k).join(", ")
          : "мимо";
    }
  }
  console.log("  исход: " + verdict);

  if (ledgerAt !== null) {
    const book = existsSync(ledgerAt) ? readJson(ledgerAt, {}) : { runs: [] };
    book.runs.push({
      criterion: plant.criterion,
      verdict,
      when: new Date().toISOString().slice(0, 10),
    });
    writeFileSync(ledgerAt, JSON.stringify(book, null, 2) + NEWLINE);
    const caught = book.runs.filter((r) => r.verdict === "поймано").length;
    console.log("  всего проб: " + book.runs.length + ", поймано: " + caught);
    console.log(
      "  Доля оптимистична: нарушение посажено в файле, заведённом ради пробы,",
    );
    console.log("  и оттого заметнее настоящего. Это верхняя граница.");
  }
  rmSync(plant.box, { recursive: true, force: true });
  rmSync(mark, { force: true });
  process.exit(verdict === "поймано" ? 0 : 1);
}

// Свод по планке — покритериальный протокол.
//
// Шаг, у которого машинного крючка не было вовсе. Режим «правка против её
// тестов» печатал разделы планки и ЧИСЛО критериев в них, а проход по этому
// числу не перечислим: пропуск отдельного критерия не виден ни сессии, ни
// читателю отчёта. Держалось тем, что сессия вспомнит про каждый из ста
// восьмидесяти. Требование завёл разработчик: проход обязан держаться не
// памятью, а записью, которую видно и можно сверить.
//
// Что сверяется: по каждому живому критерию дан исход; словарь исходов
// закрыт; у находки есть адрес, существующий на диске, слова и судьба; судьба
// согласна роду задачи; протокол сделан на ТОМ ЖЕ виде предмета, что лежит
// сейчас. Верность самого исхода машине недоступна и здесь не изображается.
if (mode === "bar") {
  {
    const all = liveBarCriteria();
    sayLooked("живых критериев планки", all === null ? 0 : all.all.length);
  }
  const NEWLINE = String.fromCharCode(10);
  const at =
    CONFIG.barProtocol == null ? null : path.join(BASE, CONFIG.barProtocol);
  const live = liveBarCriteria();
  if (at === null || live === null) {
    console.log("=== Свод по планке не заведён ===");
    console.log(
      at === null
        ? "  Поле `barProtocol` не объявлено: протоколу негде лежать."
        : "  Поле `qualityScope` не объявлено: набор критериев неоткуда взять.",
    );
    process.exit(1);
  }
  if (live.blind) {
    console.log("=== Свод по планке невозможен ===");
    console.log(
      "  Таблицу применимости прочитать не удалось: какие разделы живые,",
    );
    console.log(
      "  сейчас неизвестно. Свод по одному ядру выглядел бы полным проходом,",
    );
    console.log("  не будучи им. Чинится до свода, а не после.");
    process.exit(1);
  }

  // Предмет свода считает ИНСТРУМЕНТ, а не сессия: предмет, выбираемый тем,
  // кого проверяют, сужается до удобного незаметно для всех.
  const arg = argPath(process.argv[3]);
  const repoRoot = path.join(BASE, "..");
  let kind;
  let subject;
  let manifestTouched = false;
  if (arg) {
    const hits = [...files, ...styleFiles]
      .filter((f) => rel(f).includes(arg))
      .sort((x, y) => Number(isTest(x)) - Number(isTest(y)));
    if (hits.length === 0) {
      console.log(outOfScope(arg));
      process.exit(1);
    }
    const target = hits[0];
    // Область чтения — та же, что очерчивает досье: сам узел, то, что он
    // берёт, то, что берёт его, и листы стилей, которых граф не видит.
    const near = isStylePath(rel(target))
      ? { own: [], viaUsers: [] }
      : stylesNear(target);
    kind = "на чтение";
    subject = [
      target,
      ...(importsOf.get(target) ?? []),
      ...(importedBy.get(target) ?? []),
      ...near.own,
      ...near.viaUsers,
    ]
      .map(norm)
      .sort((x, y) => (rel(x) < rel(y) ? -1 : 1));
  } else {
    subject = await barChangedSubject(repoRoot);
    if (subject === null) {
      console.log("=== Предмет свода не определить ===");
      console.log(
        "  git недоступен, а на задаче изменения предмет — это правленое.",
      );
      console.log(
        "  Свод по задаче чтения зовут с путём: graph.mjs bar <путь>.",
      );
      process.exit(1);
    }
    kind = "на изменение";
    // Манифест в предмет не входит — предмет только код и стили, — а
    // критерии о зависимостях спрашивают именно с его правки. Признак, взятый
    // из предмета, был ложен всегда: правка, добавившая пакет, получала «нет
    // предмета» по зависимостям, и вопрос о пакете не задавался.
    const manifestAt =
      CONFIG.manifest == null ? null : norm(path.join(BASE, CONFIG.manifest));
    manifestTouched =
      manifestAt !== null &&
      ((await changedPaths(repoRoot)) ?? []).some(
        (f) => norm(path.join(repoRoot, f)) === manifestAt,
      );
  }
  subject = [...new Set(subject)];

  if (subject.length === 0) {
    console.log("=== Свод по планке: предмета нет ===");
    console.log(
      kind === "на изменение"
        ? "  Правленого кода и стилей нет — сводить не по чему."
        : "  Область пуста.",
    );
    process.exit(0);
  }

  // Что ЕСТЬ в предмете этой правки. Признаки узкие и замеряются текстом:
  // по ним инструмент сам проставляет «нет предмета» там, где критерий эту
  // правку не касается, — и только там, где это выводится, а не судится.
  //
  // Разбор, какой критерий каким признаком закрывается, живёт в словаре
  // области: здесь только замер. Второй разбор здесь разошёлся бы с первым
  // при первой же правке набора критериев.
  const subjectFlags = (() => {
    const code = subject.filter((f) => !isStylePath(f));
    const styles = subject.filter((f) => isStylePath(f));
    const tests = new Set();
    for (const f of subject)
      for (const t of testReach().get(f) ?? []) tests.add(t);
    for (const f of subject) if (isTest(f)) tests.add(f);
    const text = code
      .map((f) => (existsSync(f) ? codeOf(readFileSync(f, "utf8")) : ""))
      .join(NEWLINE);
    const has = (re) => re.test(text);
    return {
      code: code.length > 0,
      // Вид задаётся и прямо в разметке — строкой классов утилит или
      // встроенным стилем. Такой вид — тоже предмет раздела стилей, хотя листа
      // в правке нет; ссылка на класс модуля (`styles.x`) предметом не считается:
      // её вид лежит в листе.
      style:
        styles.length > 0 ||
        has(
          /className=\s*["'`]|className=\{\s*(cn|clsx|classnames|twMerge)\(|\bstyle=\{\{/,
        ),
      test: tests.size > 0,
      time: has(
        /useEffect|useLayoutEffect|setTimeout|setInterval|requestAnimationFrame|addEventListener|new [A-Za-z]*Observer|\.subscribe\(/,
      ),
      async: has(/\basync\b|\bawait\b|Promise|\.then\(|AbortController/),
      list: has(/\.map\(|\.flatMap\(/),
      manifest: manifestTouched,
      forks: (CONFIG.forks ?? []).length > 0,
    };
  })();
  const subjectRow = Object.entries(subjectFlags)
    .map(([k, v]) => k + "=" + (v ? "1" : "0"))
    .join(",");
  const marks = barMarks(subject);
  const HEAD = "| критерий | о чём | исход | адрес | что | судьба |";
  const BASE_HEAD = "| файл | база | документация | чем это объяснено |";
  const skeleton = () => {
    const rows = [
      "# Свод по планке — протокол текущей работы",
      "",
      "Скелет печатает режим " +
        barQuoted("bar") +
        ", исход ставит сессия, печать ставит режим.",
      "Шапку руками не правят: она описывает предмет, на котором свод сделан,",
      "и правка предмета гасит печать целиком. Правка самого протокола после",
      "печати гасит её тоже: печать — отпечаток всего, что ниже.",
      "",
      "## Предмет",
      "",
      "- род: " + barQuoted(kind),
      BAR_NOSEAL,
      "",
      "| файл | отпечаток |",
      "| --- | --- |",
      ...marks.map(
        (m) => "| " + barQuoted(m.file) + " | " + barQuoted(m.mark) + " |",
      ),
      "",
      "## Исходы",
      "",
      "Исход: " +
        barQuoted("чисто") +
        " — нарушения нет; " +
        barQuoted("нет предмета") +
        " — с причиной",
      "в колонке «что»; " +
        barQuoted("нашлось") +
        " — с адресом «путь:строка», словами и судьбой.",
      "Судьба: " +
        barQuoted("починено") +
        " — адрес обязан быть в правленом; " +
        barQuoted("предложено"),
      "— только на задаче чтения; " +
        barQuoted("отложено") +
        " — после ответа разработчика, и список",
      "отложенного называет файл находки.",
      "",
      HEAD,
      "| --- | --- | --- | --- | --- | --- |",
      // Лозунгу исход проставлен заранее: ставить его нечем, и пустая
      // клетка тут означала бы работу, которой не существует. Беспредметное
      // на ЭТОЙ правке — тоже: причина при нём замеренная, и переписать её
      // руками никто не мешает.
      ...live.all.map((c) => {
        const none = c.slogan ? "" : barNoSubject(c.id + "|" + subjectRow);
        const outcome = c.slogan ? "лозунг" : none === "" ? "" : "нет предмета";
        return (
          "| " +
          c.id +
          " | " +
          // Строка архитектурного ядра помечена в самом протоколе: клетка
          // основания у неё обязательна, и без пометки она выглядела бы
          // лишней ровно там, где нужнее всего.
          (barCoreCriterion(c.id) ? "**ядро.** " : "") +
          c.title +
          " | " +
          outcome +
          " |  | " +
          none +
          " |  |"
        );
      }),
      "",
      "## База и документация",
      "",
      "Ответ на каждый файл предмета ПОРОЗНЬ: правлена ли запись базы",
      "о нём, правлен ли документ. Один ответ на оба вопроса сливает их,",
      "а слитый ответ всегда положителен.",
      "",
      "Исход: " +
        barQuoted("правлено") +
        " — с адресом правленого; " +
        barQuoted("не требуется") +
        " — с причиной.",
      "",
      BASE_HEAD,
      "| --- | --- | --- | --- |",
      ...marks.map((m) => "| " + barQuoted(m.file) + " |  |  |  |"),
      "",
    ];
    writeFileSync(at, rows.join(NEWLINE));
  };

  const was = barHeader(at);
  const sameSubject =
    was !== null && was.kind === kind && barSameMarks(was.marks, marks);

  if (!sameSubject) {
    // Сказать, что прежние исходы ОТБРОШЕНЫ. Скелет печатается поверх, и
    // сотня заполненных строк исчезает без слова — а исчезают они законно
    // (исходы были про другой вид файлов), и потому молчание тут дороже
    // всего: человек ищет свою работу, а не причину. Найдено сессией,
    // затёршей строку шапки: предмет «изменился», и 152 строки ушли.
    const lost =
      was === null
        ? 0
        : readFileSync(at, "utf8")
            .split(NEWLINE)
            .filter((l) => /^\| [A-Z][^|]*\|[^|]*\|\s*\S/.test(l)).length;
    skeleton();
    console.log("=== Свод по планке: протокол напечатан ===");
    if (lost > 0)
      console.log(
        "  ПРЕЖНИЕ ИСХОДЫ ОТБРОШЕНЫ: их было " +
          lost +
          ". Предмет свода не тот, на котором они ставились",
      );
    console.log("  " + rel0(at));
    console.log(
      "  род: " +
        kind +
        ", файлов в предмете: " +
        marks.length +
        ", критериев: " +
        live.all.length,
    );
    console.log("");
    console.log("  По КАЖДОМУ критерию поставить исход, читая политику, а не");
    console.log("  название в строке: название — указатель, а не критерий.");
    console.log(
      "  Затем позвать режим снова — он сверит форму и поставит печать.",
    );
    process.exit(1);
  }

  // Разбор исходов. Строка таблицы — шесть колонок, и всё прочее пропускается
  // молча: полупонятая строка хуже непонятой.
  const body = was.body;
  const said = new Map();
  const twice = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("| ") || line === HEAD) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 6 || /^-+$/.test(cells[0])) continue;
    const [id, , outcome, addr, what, fate] = cells;
    if (said.has(id)) twice.push(id);
    said.set(id, { outcome, addr, what, fate });
  }

  // Адрес находки принимается в обеих ходовых формах: от корня репозитория
  // (так печатают git, редактор и отчёт) и от корня исходников (так печатает
  // база). Отказ по одной из них звучал бы как «файла нет» про существующий
  // файл — тот самый класс, что уже записан у разбора путей-аргументов.
  const spotFile = (p) => {
    for (const one of [path.join(repoRoot, p), path.join(ROOT, p)]) {
      const abs = norm(one);
      if (existsSync(abs)) return abs;
    }
    return null;
  };

  const holes = [];
  const changedNow = new Set(
    kind === "на изменение"
      ? subject
      : ((await barChangedSubject(repoRoot)) ?? []),
  );
  for (const c of live.all) {
    const one = said.get(c.id) ?? { outcome: "", addr: "", what: "", fate: "" };
    // Чистая часть разбора живёт в словаре области: закрытые словари,
    // законность судьбы при роде задачи, вид адреса. Второй её разбор здесь
    // разошёлся бы с первым при первой же правке словаря исходов.
    const fault = barRowFault(
      [kind, one.outcome, one.addr, one.what, one.fate, c.id].join("|"),
    );
    if (fault !== "") {
      // Неверное значение называется тут же: сообщение, после которого надо
      // идти искать строку глазами, перестают читать.
      const shown = {
        "исход не из словаря": one.outcome,
        "судьба не из словаря": one.fate,
        "адрес не вида путь:строка": one.addr,
      }[fault];
      holes.push(
        c.id + ": " + fault + (shown === undefined ? "" : ": «" + shown + "»"),
      );
      continue;
    }
    if (one.outcome !== "нашлось") continue;
    const spot = new RegExp(
      "^" + BAR_TICK + "?(.+?):([0-9]+)" + BAR_TICK + "?$",
    ).exec(one.addr);
    if (spot === null) continue;
    const abs = spotFile(spot[1]);
    if (abs === null) {
      holes.push(c.id + ": файла " + barQuoted(spot[1]) + " нет");
      continue;
    }
    const lines = readFileSync(abs, "utf8").split(/\r?\n/).length;
    if (Number(spot[2]) < 1 || Number(spot[2]) > lines)
      holes.push(
        c.id +
          ": строки " +
          spot[2] +
          " в " +
          barQuoted(spot[1]) +
          " нет, всего " +
          lines,
      );
    if (one.fate === "починено" && !changedNow.has(abs))
      holes.push(
        c.id +
          ": «починено», а " +
          barQuoted(spot[1]) +
          " в правленом не числится",
      );
    // «Отложено» — после ответа разработчика, и запись уходит в отложенное.
    //
    // Прежде судьба принималась голой: слово «отложено» закрывало строку, а
    // куда отложено, не спрашивал никто. Протокол перезаписывается следующим
    // проходом, и отложенная находка исчезала так же, как предложенная до
    // своей сверки. Замерено на стенде: сессия отложила шесть находок без
    // ответа разработчика, назвав вместо записи номер строки реестра.
    //
    // Спрашивается самое слабое, что проверяемо: список отложенного называет
    // файл находки в одной из ходовых форм пути.
    if (one.fate === "отложено") {
      const todoAt = CONFIG.todo == null ? null : path.join(BASE, CONFIG.todo);
      const todo =
        todoAt !== null && existsSync(todoAt)
          ? readFileSync(todoAt, "utf8")
          : null;
      const forms = [
        spot[1],
        norm(path.relative(repoRoot, abs)),
        norm(path.relative(ROOT, abs)),
      ];
      if (todo === null || !forms.some((f) => todo.includes(f)))
        holes.push(
          c.id +
            ": «отложено», а " +
            (todo === null
              ? "списка отложенного нет (поле `todo`)"
              : "отложенное " +
                barQuoted(CONFIG.todo) +
                " не называет " +
                barQuoted(spot[1])),
        );
    }
  }
  const extra = [...said.keys()].filter(
    (id) => !live.all.some((c) => c.id === id),
  );

  // Вторая таблица: база и документация, по файлу предмета и порознь.
  //
  // Прежде это был вопрос прозой в другом режиме, и ответ на него держался
  // памятью. Замерено на приложении с нуля: карта заполнена, реестр тестов
  // заполнен — у обоих есть сверка, — а запись о состоянии, назначение и
  // витрина остались от посадки. База заполняется по форме своего ловца.
  {
    const want = new Set(marks.map((m) => m.file));
    const rows = new Map();
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("| ")) continue;
      const c = line
        .split("|")
        .slice(1, -1)
        .map((x) => x.trim());
      if (c.length !== 4) continue;
      const file = c[0].replace(new RegExp(BAR_TICK, "g"), "");
      if (!want.has(file)) continue;
      rows.set(file, c);
    }
    for (const file of want) {
      const c = rows.get(file);
      if (c === undefined) {
        holes.push("база: строки про " + barQuoted(file) + " нет");
        continue;
      }
      for (const [i, what] of [
        [1, "база"],
        [2, "документация"],
      ]) {
        const one = c[i];
        if (one === "") {
          holes.push(file + ", " + what + ": исход не поставлен");
          continue;
        }
        if (!["правлено", "не требуется"].includes(one)) {
          holes.push(
            file + ", " + what + ": исход не из словаря: " + barQuoted(one),
          );
          continue;
        }
        if (c[3] === "")
          holes.push(
            file +
              ", " +
              what +
              ": " +
              one +
              (one === "правлено" ? " без адреса" : " без причины"),
          );
      }
    }
  }

  console.log("=== Свод по планке ===");
  console.log("  " + rel0(at));
  console.log(
    "  род: " +
      kind +
      ", критериев: " +
      live.all.length +
      ", файлов: " +
      marks.length,
  );
  if (twice.length)
    console.log("  критерий назван дважды: " + twice.join(", "));
  if (extra.length)
    console.log("  критерий, которого в политике нет: " + extra.join(", "));
  if (holes.length === 0 && twice.length === 0 && extra.length === 0) {
    const found = live.all.filter(
      (c) => (said.get(c.id) ?? {}).outcome === "нашлось",
    );
    const seal = barSealOf(body);
    // Печать пишется ЗАМЕНОЙ строки «печать: нет». Если печать уже стоит,
    // заменять нечего: файл остаётся как был, а режим рапортовал об успехе и
    // называл отпечаток, которого в протоколе нет. Замерено на правке
    // запечатанного протокола — сверка базы тут же доложила «печать не
    // сходится», и понять, откуда это, было неоткуда.
    //
    // Отказ, а не перепечать: доктрина протокола говорит прямо — правка после
    // печати её гасит, потому что печать есть отпечаток всего, что ниже.
    // Перепечатывать значило бы разрешить править исходы под уже закрытым
    // сводом.
    if (!body.includes(BAR_NOSEAL)) {
      console.log(
        "  ПЕЧАТЬ НЕ ПОСТАВЛЕНА: протокол уже закрыт и правлен после этого." +
          NEWLINE +
          "  Правка после печати её гасит. Свод делают заново: снести протокол" +
          NEWLINE +
          "  и позвать режим ещё раз.",
      );
      process.exit(1);
    }
    writeFileSync(
      at,
      body.split(BAR_NOSEAL).join("- печать: " + barQuoted(seal)),
    );
    console.log("  печать поставлена: " + seal);
    console.log("  находок: " + found.length);
    for (const c of found) {
      const one = said.get(c.id);
      console.log(
        "    " +
          c.id +
          " " +
          one.addr +
          " — " +
          one.what +
          " (" +
          one.fate +
          ")",
      );
    }
    console.log("");
    console.log(
      "  Печать говорит: по каждому критерию дан ответ, и дан на этом",
    );
    console.log("  виде предмета. О ВЕРНОСТИ ответа она не говорит ничего —");
    console.log(
      "  признаки планки прогоном не ловятся, и это не изображается.",
    );
    process.exit(0);
  }
  console.log("  дыр: " + holes.length);
  for (const h of holes) console.log("    " + h);
  console.log("");
  console.log("  Печать не поставлена. Свод с дырами — не свод.");
  process.exit(1);
}

if (mode === "brief") {
  sayLooked("файлов кода и стилей в графе", files.length + styleFiles.length);
  const NEWLINE = String.fromCharCode(10);
  const arg = argPath(process.argv[3]);
  if (!arg) {
    console.log(
      "Укажи путь: node .claude/tools/graph.mjs brief <путь или его хвост>",
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
        const bare = base.replace(BARE_EXT, "");
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
        } else if (isStylePath(r)) {
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
        // Долг про ЭТОТ файл — часть ответа на «что надо знать перед правкой».
        // Прежде о нём знал только полный прогон: режим называл радиус, тесты и
        // записи базы и молчал о том, что записи о состоянии или о порядке у
        // файла нет вовсе. Замерено пробой «убери этот эффект, он лишний»:
        // остановить её должна была запись о порядке, а её не было, и область
        // об этом не сказала.
        {
          const owed = owedFor(target).map((one) =>
            one.why === "нет файла"
              ? one.to + " — файла базы нет вовсе"
              : one.to +
                " — файл не назван, а предмет «" +
                one.subject +
                "» в нём есть",
          );
          if (owed.length) {
            console.log("--- ДОЛГ базы про этот файл ---");
            for (const one of owed) console.log("  " + one);
          }
        }
        // Листы стилей — часть области, и без них критерий про границу языков не
        // применить: половины написаны на разных языках, и графу импортов эта связь
        // не видна.
        if (!isStylePath(r)) {
          const near = stylesNear(target);
          if (near.own.length || near.viaUsers.length) {
            console.log("--- листы стилей области (граф их не видит) ---");
            for (const one of near.own)
              console.log("  подключает сам: " + rel(one));
            for (const one of near.viaUsers)
              console.log("  приходит от зовущего: " + rel(one));
            console.log(
              "  значение, живущее и там и тут, — дублирование через границу языков",
            );
          }
        }
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
  sayLooked("файлов кода", files.length);
  const NEWLINE = String.fromCharCode(10);
  const size = (f) =>
    readFileSync(f, "utf8")
      .split(NEWLINE)
      .filter((l) => l.trim() !== "").length;
  const arg = process.argv[3];
  // Стили считаются НАРАВНЕ с кодом, а не пропускаются.
  //
  // Этот режим называет цену последнего шага плана перехода — сплошного чтения
  // всего кода под описание в карте. А карта описывает «файлы кода И СТИЛЕЙ»:
  // сверка покрытия требует записи о каждом файле стилей так же, как о файле
  // кода. Пока режим их не считал, объявленная цена была занижена, и занижена
  // молча. Замерено посадкой в живой проект: режим напечатал двести тринадцать
  // непустых строк на весь проект, а сто восемьдесят пять строк стилей в это
  // число не входили — то есть почти половина чтения была невидима.
  //
  // Тесты из счёта не убираются: их тоже читают, и реестр тестов требует
  // записи о каждом. Но печатаются они отдельным счётом — предмет чтения у них
  // другой, и смешанное число не даёт оценить ни то, ни другое.
  const pick = (list) =>
    list
      .filter((f) => (arg ? rel(f).includes(arg) : true))
      .map((f) => [rel(f), size(f)])
      .sort((a, b) => b[1] - a[1]);
  const codeRows = pick(files.filter((f) => !isTest(f)));
  const testRows = pick(files.filter((f) => isTest(f)));
  const styleRows = pick(styleFiles);
  const sum = (rows) => rows.reduce((s, r) => s + r[1], 0);

  console.log("=== Непустых строк на файл ===" + NEWLINE);
  for (const [f, n] of [...codeRows, ...styleRows, ...testRows])
    console.log(String(n).padStart(5) + "  " + f);
  const line = (what, rows) =>
    `${what} — файлов: ${rows.length}, непустых строк: ${sum(rows)}.`;
  console.log(NEWLINE + line("Код", codeRows));
  console.log(line("Стили", styleRows));
  console.log(line("Тесты", testRows));
  console.log(
    line("ПОД ОПИСАНИЕ В КАРТЕ, код и стили", [...codeRows, ...styleRows]),
  );
}

// Цена ярусов входа: СКОЛЬКО читается до кода на задаче каждого класса.
//
// Доктрина требует числа прямо — «у каждого яруса есть цена, и она
// замеряется, а не прикидывается», — и запрещает ставить их в себя: она одна
// на все проекты, а цена у каждого своя. Инструмента под это требование не
// было ни одного, и таблица фактов стояла «не мерено» на каждом проекте,
// включая саму мастерскую: открытая находка висела дольше всех прочих.
//
// Считается СЛОВАМИ, а не строками: цена яруса — это объём, который войдёт в
// контекст, и слово ближе к нему, чем строка. Порядок, а не точность: между
// «две тысячи» и «тридцать тысяч» разница решающая, между двадцатью восемью
// и тридцатью — никакой, и печатается поэтому порядок.
//
// Состав ярусов взят из таблицы `loop.md` дословно и здесь не выдуман.
if (mode === "tiers") {
  const NEWLINE = String.fromCharCode(10);
  const words = (f) => {
    if (!existsSync(f)) return 0;
    return readFileSync(f, "utf8")
      .split(/[ \t\r\n]+/)
      .filter(Boolean).length;
  };
  const baseAt = (name) => path.join(BASE, name);
  const sum = (list) => list.reduce((n, f) => n + words(f), 0);
  const order = (n) =>
    n === 0
      ? "0"
      : n < 1000
        ? "сотни"
        : n < 10000
          ? "тысячи"
          : n < 100000
            ? "десятки тысяч"
            : "сотни тысяч";

  // Правила доктрины целиком: полный вход верхних ярусов.
  const doctrine = [];
  if (SHELF !== null) {
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir)) {
        const at = norm(path.join(dir, e));
        if (statSync(at).isDirectory()) walk(at);
        else if (e.endsWith(".md")) doctrine.push(at);
      }
    };
    walk(norm(path.join(SHELF, "rules")));
  }
  // База целиком.
  const baseAll = readdirSync(BASE)
    .filter((e) => e.endsWith(".md"))
    .map((e) => baseAt(e));

  // Узел с самой большой областью: цена яруса называется по ВЕРХНЕЙ оценке,
  // иначе она обещает меньше, чем стоит.
  const nodes = new Map();
  for (const layer of CONFIG.componentsAt ?? ["components"])
    for (const f of [...files, ...styleFiles]) {
      const m = new RegExp("^" + layer + "/([^/]+)/").exec(rel(f));
      if (m === null) continue;
      const key = layer + "/" + m[1];
      nodes.set(key, (nodes.get(key) ?? 0) + words(f));
    }
  let node = null;
  let nodeWords = 0;
  for (const [k, n] of nodes) if (n > nodeWords) [node, nodeWords] = [k, n];
  const nodeDocs =
    node === null ? 0 : words(norm(path.join(ROOT, node, "docs", "README.md")));

  const map0 = words(baseAt(CONFIG.map ?? "00-map.md"));
  const rows = [
    ["Где что лежит, что уже решено", map0, "карта кода целиком"],
    [
      "Объяснить поведение одного узла",
      map0 + nodeWords + nodeDocs,
      node === null
        ? "карта: узлов у проекта нет, область совпадает с первым ярусом"
        : "карта + область узла " + node + " + его документ",
    ],
    [
      "Багфикс в известном месте",
      map0 +
        nodeWords +
        nodeDocs +
        words(baseAt(CONFIG.invariants ?? "07-invariants.md")) +
        words(baseAt(CONFIG.decisions ?? "09-decisions.md")),
      "то же + ограничения и решения",
    ],
    [
      "Рефактор узла или слоя",
      sum(doctrine) + sum(baseAll),
      "полный вход: доктрина и база целиком",
    ],
    [
      "Новая функциональность",
      sum(doctrine) + sum(baseAll) + words(baseAt("10-idioms.md")),
      "полный вход + идиомы",
    ],
  ];

  sayLooked("ярусов входа", rows.length);
  console.log("=== Цена ярусов входа, словами ===" + NEWLINE);
  for (const [what, n, how] of rows)
    console.log(
      String(n).padStart(7) +
        "  " +
        order(n).padEnd(14) +
        "  " +
        what +
        " — " +
        how,
    );
  console.log(
    NEWLINE +
      "Числа переписывают в таблицу «Цена ярусов входа» файла фактов графой" +
      NEWLINE +
      "«Порядок цены», в обратных кавычках. Пересчитывают той же командой.",
  );
}
if (mode === "verify") {
  // Прогон запоминает свой вывод, потому что по нему же и судит: красное —
  // это НАПЕЧАТАННАЯ находка, а не имя переменной в перечне.
  //
  // Прежде код возврата собирался руками — длинной цепочкой `a.length ||
  // b.length || …`, куда новую сверку полагалось дописать. Шесть сверок
  // подряд туда не дописали, и все шесть печатали находки при зелёном
  // прогоне: вершина обвязки держалась вниманием, то есть ровно тем, что
  // сама обвязка объявляет ненадёжным.
  //
  // Признак находки у вывода один и давний: четыре пробела в начале строки —
  // им его узнаёт и разбор фальсификации. Секция, которая печатает не
  // находки, а предупреждение, говорит это своим заголовком, и только она
  // исключается.
  const SAID = [];
  {
    const was = console.log;
    console.log = (...args) => {
      SAID.push(args.join(" "));
      was(...args);
    };
  }
  const WARNING = "прогон не роняет";
  // Сверки, которые СМЯГЧАЕТ флаг посадки: их предмет доделывает фаза 2 —
  // правила проекта заполняются из ответа разработчика, отложенные семена
  // сливаются. Секция печатает всё
  // найденное: отчёт фазы 1 берёт отсюда список работы. Прогон она не роняет,
  // пока флаг стоит.
  //
  // Список один, и баннер посадки печатает его отсюда же: прежде баннер,
  // инструкция и настройка перечисляли смягчения прозой, и за два переделки
  // вердикта проза разошлась с кодом — называла смягчённым долг карты,
  // которого флаг давно не трогал, и молчала о том, что смягчений не стало
  // вовсе.
  const SOFT_WHILE_SEATING = [
    "Шаблон правил заполнен",
    "Отложенное семя слито",
  ];
  const printedRed = () =>
    printedIsRed(
      SAID,
      WARNING,
      new Set(seatingIsUp() ? SOFT_WHILE_SEATING : []),
    );
  const MAP = CONFIG.map;
  const TESTS = CONFIG.tests;
  const NEWLINE = String.fromCharCode(10);
  const REPO = REPO_AT;

  /** Предмет звена цепочки: файлы, которые читает его инструмент.
   *
   * Объявлен в карте посадки — там же, откуда его берёт слияние манифеста.
   * Двух источников тут быть не должно: разойдясь, они дали бы разные ответы
   * на один вопрос «нужно ли этому проекту такое звено». */
  // Имя, под которым звено живёт В ЭТОМ проекте. Ищется по тому, что скрипт
  // ЗОВЁТ, а не по тому, как он назван: проект часто держит то же звено под
  // своим словом — `types`, `tsc:check`, `lint:ts`. Образец опознания объявлен
  // данными карты, теми же, по которым звено опознаёт слияние манифеста.
  //
  // Двух источников тут быть не должно. Пока их было два, сверка инструментов
  // на проекте со своим именем звена докладывала ДВА ложных пробела разом:
  // «команды typecheck нет» — при живом звене под именем `types`, — и «types
  // цепочка зовёт, а в объявлении его нет». Оба про одно и то же звено, и оба
  // неверны. Найдено посадкой в стороннюю библиотеку.
  const linkOwnName = (script, scripts) => {
    if (script == null) return null;
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt)) return null;
    const one = (
      JSON.parse(readFileSync(mapAt, "utf8")).chainScripts ?? []
    ).find((e) => e.name === script);
    if (one === undefined || one.recognise == null) return null;
    const re = new RegExp(one.recognise);
    const hit = Object.entries(scripts).find(([, body]) => re.test(body));
    if (hit !== undefined) return hit[0];
    // Звено, ДЕЛЕГИРОВАННОЕ пакетам: корневой скрипт зовёт одноимённые
    // скрипты воркспейсов, а уже они — инструмент звена. Опознаётся по тому,
    // что зовут пакеты. Прежде корень монорепозитория с `types`, раздающим
    // проверку типов пакетам, считался проектом без звена типов: посадка
    // дописывала в корень свой `tsc --noEmit`, слепой к коду пакетов, —
    // посаженную ошибку в пакете он пропускал кодом ноль. Замерено посадкой
    // руками в монорепозиторий.
    return delegatedLink(re, scripts);
  };
  const linkNeeds = new Map();
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt))
      for (const e of JSON.parse(readFileSync(mapAt, "utf8")).chainScripts ??
        [])
        if (Array.isArray(e.needsFiles)) linkNeeds.set(e.name, e.needsFiles);
  }
  // Предмет звена — код ПРОЕКТА, и нетронутые семена в него не входят, ПОКА
  // у проекта есть свой код. Обвязка везёт файлы на своём языке — общий
  // помощник и подготовку прогона, — и в проекте на обычном JavaScript они
  // оказывались всем ответом на вопрос «есть ли тут TypeScript»: звено типов
  // выглядело применимым оттого, что обвязка сама же положила два своих
  // файла. Дописанное по такому ответу звено разбирало бы только их — зелено,
  // а проверено ничего.
  //
  // Своего кода нет — считается ВСЁ: проект живёт каркасом, и каркас ему не
  // чужой, он и есть его код. Признак тот же, что у ворот, ревизии, предмета
  // свода и следа прогона: шестое его место, и общий помощник на всех один.
  const subjectCode = (() => {
    const every = [...files, ...styleFiles];
    const seeds = seedOfPath();
    const repoRoot = path.join(BASE, "..");
    const own = every.filter((f) => !untouchedSeed(f, repoRoot, seeds));
    return own.length > 0 ? own : every;
  })();
  // Звено, которого в проекте нет ПО ЕГО УСТРОЙСТВУ, а не по недосмотру.
  // Два случая, оба из правил слияния манифеста. Семенное имя звена занято
  // другой работой — скрипт под ним есть, а образец звена не совпадает ни с
  // одним скриптом: у проекта свой раннер тестов, и пакеты, конфиг и семена
  // звена посадка не кладёт, а расхождение держит план перехода. И спутник,
  // чьего ведущего звена в проекте нет: покрытие и мутации следуют за
  // тестами и без них не работают.
  //
  // Прежде сверка инструментов спрашивала с такого звена пакеты семени и,
  // едва посадка снимала флаг, краснела навсегда: проект со своим раннером
  // не мог стать зелёным ни при какой работе. Замерено посадкой руками в
  // проект на jest.
  const linkTakenElsewhere = (script, scripts) => {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt)) return false;
    const chain = JSON.parse(readFileSync(mapAt, "utf8")).chainScripts ?? [];
    const one = chain.find((e) => e.name === script);
    if (one === undefined) return false;
    const called = (e) =>
      e?.recognise != null && linkCalled(new RegExp(e.recognise), scripts);
    if (one.follows != null) {
      const master = chain.find((e) => e.name === one.follows);
      if (master?.recognise != null && !called(master)) return true;
    }
    if (one.recognise == null || scripts[script] == null) return false;
    return !called(one);
  };
  const linkHasSubject = (script) => {
    // Звено мутационного прогона беспредметно там, где прогон не заявлен:
    // поле настройки пусто — и спрашивать с проекта его пакеты не за что.
    if (script === "mutate" && CONFIG.mutationConfig == null) return false;
    const want = linkNeeds.get(script);
    if (want === undefined) return true;
    const ext = new Set(want.map((x) => "." + x));
    return subjectCode.some((f) => ext.has(f.slice(f.lastIndexOf("."))));
  };

  const bare = (q) => q.replace(/[*]+$/, "").replace(/[/]+$/, "");

  // Пути в базе сокращены и лежат на разной глубине: разрешаются по префиксу
  // раздела, затем по однозначному суффиксу.
  // Сокращения объявлены НАСТРОЙКОЙ, а не зашиты сюда. Прежде здесь стояла
  // раскладка одного конкретного проекта: префиксы его папок разрешались в его
  // же адреса. В любом другом проекте те же префиксы указывали в несуществующие
  // места — и делали это молча, потому что неразрешённый адрес просто уходил
  // дальше по цепочке разрешения. Найдено поиском следов проекта в обвязке.
  const expand = (q) => {
    if (q.startsWith("src/")) return path.join(REPO, q);
    for (const [prefix, base] of CONFIG.pathShortcuts ?? [])
      if (q.startsWith(prefix)) return path.join(REPO, base, q);
    // Адрес ОТ КОРНЯ ИСХОДНИКОВ — та форма, в которой инструмент сам их и
    // печатает: `components/CheckboxPanel/domain/selection.ts`. Ветка выше
    // знает один литерал `src/`, и проект, зовущий корень иначе, не разрешал
    // ни одного адреса с косой чертой — а признака у этого не было: сверка
    // слоёв краснела строкой «слоя нет на диске» про папку, которая есть.
    // Слой без косой черты при этом проходил зелёным по другой ветке, и
    // расхождение выглядело случайным. Найдено посадкой в проект со слоями.
    const atRoot = path.join(ROOT, q);
    if (existsSync(atRoot)) return atRoot;
    return null;
  };

  // Два списка, и смешивать их нельзя: размеры папок считаются по коду
  // (`everyFile`), а якоря указывают ещё и на доки (`everyPath`).
  const everyFile = [];
  const everyPath = [];
  const walkAll = (dir) => {
    if (!walkable(dir)) return;
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (outOfTree(e, full)) continue;
      if (statSync(full).isDirectory()) walkAll(full);
      else if (/\.[jt]sx?$/.test(e) || isStylePath(e) || /\.md$/.test(e)) {
        everyPath.push(full.split(path.sep).join("/"));
        if (!e.endsWith(".md")) everyFile.push(everyPath[everyPath.length - 1]);
      }
    }
    // Корень исходников берётся ИЗ НАСТРОЙКИ, а не зашит именем `src`.
    //
    // Поле настройки существует именно затем, что корень бывает другой:
    // библиотеки зовут его `lib`, каркасы — `app`. Пока имя стояло здесь
    // строкой, у такого проекта этот обход возвращал ПУСТО, и всё, что на нём
    // стоит, молчало — в первую очередь покрытие карты по файлам стилей.
    // Заметить это было нечем: соседний список собирается другим обходом, тоже
    // молча, и сверка печатала правдоподобное число. Найдено сверкой двух
    // замеров одного и того же проекта, разошедшихся на единицу. Деревьев
    // бывает несколько, и обход зовётся по каждому.
  };
  for (const one of SRC_ROOTS) walkAll(one);

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
  const PATH_RE = new RegExp(
    "`([\\w./{},*-]+\\.(?:" + CODE_STYLE_ALT + "))`",
    "g",
  );
  const HEAD_RE = /^#{2,4}[^`]*`([^`]+)`/;
  const HEAD_FILES_RE = new RegExp(
    "`([\\w./{},*-]+\\.(?:" + CODE_STYLE_ALT + "))`",
    "g",
  );
  const ANCHOR_TAIL = new RegExp("\\.(" + CODE_STYLE_ALT + "|md|json|html)$");
  // Якорь с цитатой: номер строки плюс сама конструкция в кавычках. Номер съедет
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
  // Заголовок из настройки — ТЕКСТ, а не образец, и подставляется он
  // экранированным.
  //
  // Настройка называет шапку таблицы дословно, а шапка markdown-таблицы состоит
  // из вертикальных черт — в регулярном выражении это «или». Подставленная как
  // есть, она превращала образец в «любой заголовок ИЛИ вот это», и `inRules`
  // вставал на ПЕРВОМ же заголовке файла и не сбрасывался. Дальше правилом
  // направления читалась каждая трёхколоночная строка базы: строки таблиц
  // файлов в карте, строки базовой линии в фактах. Замерено на посадке в проект
  // со слоями: двенадцать правил вместо трёх, и ячейки чужих строк объявлены
  // мёртвыми разрешениями.
  //
  // Не находило это ничто: во всех предыдущих проектах поле стояло `null`, и
  // сверка молчала за отсутствием предмета. Первый же проект, объявивший слои,
  // получил её сломанной.
  // Поле не объявлено — таблицы нет, и разбор не запускается ВОВСЕ. Образец из
  // пустого текста совпал бы с любым заголовком, то есть ровно с тем, что эта
  // правка и чинит: пустая подстановка опаснее неверной, потому что выглядит
  // безобидно. Поймано тем же прогоном сразу после первой редакции.
  const headRe = (text) =>
    text == null
      ? { test: () => false }
      : new RegExp("^#+.*" + text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const RULES_HEAD = headRe(CONFIG.rulesHeading);
  const ISOLATION_HEAD = headRe(CONFIG.isolationHeading);
  const ROW_RE = /^\|(.+)\|(.+)\|(.*)\|\s*$/;
  const ISO_ROW_RE = /^\|([^|]+)\|([^|]+)\|\s*$/;
  const cellPaths = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const rules = [];
  // Нашёлся ли РАЗДЕЛ с объявленным заголовком — отдельно от того, разобрались
  // ли в нём строки. Это разные поломки: заголовок назван неверно, либо таблица
  // под ним другой формы. Одно сообщение на оба случая отправляло бы искать не
  // там — поймано собственной правкой на живом проекте.
  let rulesHeadSeen = false;
  let isolationHeadSeen = false;
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
    // Огороженный блок — ПРИМЕР, а не заявление о проекте.
    //
    // Разбор читал строки базы подряд, не отличая примера от записи. Пока
    // примеров в базе не было, это не проявлялось; первый же появился в
    // семени карты — образец обеих таблиц слоёв, заведённый затем, чтобы
    // форму этих таблиц было откуда списать.
    //
    // Замерено на живом проекте: он объявил заголовки таблиц, и разбор
    // выдал ТРИ слоя при одной строке в таблице — два лишних пришли из
    // примера, и правила для несуществующих слоёв проверялись на настоящем
    // коде. Пример, ставший правилом, — худший вид записи: он выглядит
    // документацией и работает как объявление.
    let fenced = false;
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
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const head = HEAD_RE.exec(line);
      if (head !== null) {
        const token = head[1];
        prefix = !token.includes("/")
          ? null
          : CODE_OR_STYLE.test(token)
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
        if (inRules) rulesHeadSeen = true;
        inIsolation = ISOLATION_HEAD.test(line);
        if (inIsolation) isolationHeadSeen = true;
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
            if (name === TESTS && isTestPath(one) && !existsSomewhere)
              goneTests.push(`${name}: ${one}`);
            // Шаблоны со звёздочкой и перечисления расширений (`.ts/.tsx`)
            // адресами не являются: они описывают форму, а не файл. Замер на
            // здоровом дереве дал ровно три таких и ноль настоящих.
            if (
              name === MAP &&
              (/\.tsx?$/.test(one) || isStylePath(one)) &&
              !isTestPath(one) &&
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
    ...everyFile.filter(isStylePath),
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

  const markerCheck = ({ inCode, nearMiss, names, anchors }) => {
    const bodies = new Map();
    const marks = new Map();
    const missed = [];
    let total = 0;
    for (const f of marked) {
      const body = readFileSync(f, "utf8").split(NEWLINE);
      bodies.set(f, body);
      const found = [];
      body.forEach((line, index) => {
        if (inCode(line)) found.push(index + 1);
        else if (nearMiss !== undefined && nearMiss(line))
          missed.push(
            rel(f) + ":" + (index + 1) + " — форма пометки не та: ждём тире",
          );
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
    return { total, unlisted, missed, gone: [...gone] };
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
      debtKind: "invariants",
      base: CONFIG.invariants,
      // В коде пометка пишется с тире: `CONSTRAINT — что нельзя`. Запись тире
      // не повторяет — она называет пометку одним словом.
      inCode: (line) => /(CONSTRAINT|ОГРАНИЧЕНИЕ)\s+—/.test(line),
      // Почти-верная форма: слово пометки есть, тире нет. Пишут её постоянно —
      // двоеточие после ключевого слова привычнее тире, — и до этой ветки она
      // была НЕВИДИМА: ограничение объявлено в коде, сканер его не находит,
      // сверка печатает ноль и остаётся зелёной. Свод такое запрещает прямо:
      // проверка, которая может быть только зелёной, хуже отсутствующей.
      //
      // Второй формой двоеточие НЕ принимается намеренно. Форма — интерфейс, и
      // двух интерфейсов у одного предмета не бывает: приняв оба, сверка
      // перестала бы учить форме, а следующая пометка была бы написана третьим
      // способом. Она называет промах и требует поправить.
      nearMiss: (line) =>
        /(CONSTRAINT|ОГРАНИЧЕНИЕ)\s*[:\-–]/.test(line) &&
        !/(CONSTRAINT|ОГРАНИЧЕНИЕ)\s+—/.test(line),
      names: /CONSTRAINT|ОГРАНИЧЕНИЕ/,
      anchors: invariantAnchors,
    },
    {
      title: "Пометки решений",
      debtKind: "decisions",
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
    ...everyFile.filter(isStylePath),
  ];
  const missing = code.filter((f) => !mapMentions.has(f));
  // Долг карты — храповик, и заведён он под посадку в ЖИВОЙ проект. Там
  // описать триста файлов в день посадки нельзя, а требовать этого значит
  // оставить проект красным навсегда — после чего красный прогон перестают
  // читать. Долг объявляется числом на день посадки, печатается каждым
  // прогоном и **расти не может**: новый файл обязан быть описан сразу, старый
  // долг ждёт команды разработчика. Пустое поле — долга нет, карта обязана быть
  // полной.
  /** Долг описания по видам. Читается в ОДНОМ месте: пока поле было одно —
   * про карту, — остальные четыре сверки роняли живой проект навсегда, и
   * рубеж завершения посадки, требующий зелёную сверку базы, был для него
   * недостижим в принципе. Найдено посадкой в копию настоящего проекта.
   *
   * Долгом считается только НЕОПИСАННОЕ. Запись о том, чего в коде нет, и
   * пометка не той формы — ошибки: они роняют прогон при любом долге. */
  // Баннер перехода — ПЕРВОЙ строкой прогона. Прежде он стоял последней, и
  // читался ровно до тех пор, пока его переставали замечать: полсотни секций
  // выше, а внизу счёт открытых шагов без единого их имени.
  printTransition();
  printFindings();

  const overDebt = overDebtOf("map", missing.length);
  checkHead("Покрытие карты", {
    n: code.length,
    unit: "файлов кода и стилей (без тестов)",
  });
  console.log(
    `  не упомянуто: ${missing.length}` +
      debtTail("map") +
      (goneMapped.length
        ? `, названо и не существует: ${goneMapped.length}`
        : ""),
  );
  debtNote("map", missing.length);
  for (const f of debtList("map", missing)) console.log("    " + rel(f));
  for (const m of goneMapped) console.log("    " + m);

  // 2. каждый тестовый файл назван в 08-tests.md — поимённо, папкой не зачесть
  const testFiles = files.filter(isTest);
  const unnamed = testFiles.filter((f) => !testMentions.has(f));
  checkHead("Покрытие тестов", {
    n: testFiles.length,
    unit: "тестовых файлов",
  });
  console.log(
    `  не названо: ${unnamed.length}` +
      debtTail("tests") +
      (goneTests.length
        ? `, названо и не существует: ${goneTests.length}`
        : ""),
  );
  debtNote("tests", unnamed.length);
  for (const f of debtList("tests", unnamed)) console.log("    " + rel(f));
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
      // Папка это или имя пакета — ЗАМЕР, а не догадка по косой черте.
      //
      // Прежде запрет без косой черты считался именем пакета и сверялся с
      // написанным спецификатором. Слой, лежащий одной папкой в корне
      // исходников, — `app`, `ui`, `domain` — под это правило попадал целиком:
      // запрет на него не проверялся НИ РАЗУ, и таблица направления молчала
      // при живом нарушении. Замерено на проекте, где фиче запрещён импорт из
      // слоя приложения: импорт был, запрет был, нарушений — ноль.
      //
      // Спрашиваются теперь обе стороны сразу: область на диске и имя пакета
      // как написано. Совпасть может и то, и другое — пакет, названный как
      // папка, законен, и молчать о нём было бы тем же дефектом.
      const target = new Set(inside(banned, null)?.hits ?? []);
      for (const f of layer) {
        if (specsOf.get(f)?.has(banned)) broken7.push(`${rel(f)} → ${banned}`);
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
  // Объявленный и ненайденный заголовок НАЗЫВАЕТСЯ, а не молчит.
  //
  // Поле настройки описано прозой, примера в файле нет, и естественное неверное
  // прочтение давало ноль правил при живой таблице на диске. Ноль тут читается
  // как «слой один, проверять нечего» — то есть сверка зелена оттого, что не
  // нашла своего предмета, а это худший из возможных исходов.
  const headingMissed =
    CONFIG.rulesHeading == null || rules.length > 0
      ? null
      : rulesHeadSeen
        ? "РАЗДЕЛ «" +
          CONFIG.rulesHeading +
          "» найден, но ни одной строки правила в нём нет: таблица направления" +
          " состоит из ТРЁХ граф — слой, что запрещено, что разрешено исключением." +
          " Таблица из двух граф — это изоляция, и объявляется она полем" +
          " `isolationHeading`"
        : "ЗАГОЛОВОК ОБЪЯВЛЕН, А РАЗДЕЛА С НИМ НЕТ: «" +
          CONFIG.rulesHeading +
          "» — объявляется текст ЗАГОЛОВКА РАЗДЕЛА, а не шапка таблицы";
  checkHead("Правила направления", {
    n: rules.length,
    unit: "правил направления",
  });
  console.log(`  нарушено: ${broken7.length}`);
  // Находка печатается строкой С ОТСТУПОМ — той же формой, какой её печатают все
  // сверки. Приписанная к строке счёта, она не делала секцию красной ни для
  // глаза, ни для режима фальсификации: числа оставались нулями. Поймано
  // рецептом, который «промолчал» на заведомо неверном поле.
  if (headingMissed !== null) console.log("    " + headingMissed);
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
  let starLooked = 0;
  if (CONFIG.starBarrels != null) {
    const declared = new Set(CONFIG.starBarrels);
    const onDisk = new Set(
      files
        .filter(
          (f) => !isTest(f) && /^\s*export\s+\*/m.test(readFileSync(f, "utf8")),
        )
        .map(rel),
    );
    starLooked = new Set([...declared, ...onDisk]).size;
    for (const f of onDisk)
      if (!declared.has(f))
        starDrift.push(
          `звёздная бочка не объявлена: ${f} — здесь выключен анализ мёртвых экспортов`,
        );
    for (const f of declared)
      if (!onDisk.has(f)) starDrift.push(`объявлена, но звёздочки нет: ${f}`);
  }
  checkHead("Звёздные бочки", {
    n: starLooked,
    unit: "звёздных бочек объявленных и на диске",
  });
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
  let barrelLooked = 0;
  {
    const CAMEL = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z][A-Za-z0-9]*$/;
    const mapLines = readFileSync(path.join(BASE, CONFIG.map), "utf8").split(
      NEWLINE,
    );
    let barrel = null;
    const close = () => {
      if (barrel === null) return;
      barrelLooked += 1;
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
  checkHead("Состав бочки в записи карты", {
    n: barrelLooked,
    unit: "бочек, названных картой",
  });
  console.log(`  имён названо неверно: ${barrelDrift.length}`);
  for (const b of barrelDrift) console.log("    " + b);

  // Тот же крючок, что у направления: объявленный и не сработавший заголовок
  // называется. Ноль слоёв читается как «изоляции нет, проверять нечего», и
  // отличить это от «таблица на диске есть, а разбор её не нашёл» по числу
  // нельзя.
  const isoMissed =
    CONFIG.isolationHeading == null || isolation.length > 0
      ? null
      : isolationHeadSeen
        ? "РАЗДЕЛ «" +
          CONFIG.isolationHeading +
          "» найден, но ни одной строки в нём нет: таблица изоляции состоит из" +
          " ДВУХ граф — слой и то, что ему разрешено. Таблица из трёх граф — это" +
          " направление, и объявляется она полем `rulesHeading`"
        : "ЗАГОЛОВОК ОБЪЯВЛЕН, А РАЗДЕЛА С НИМ НЕТ: «" +
          CONFIG.isolationHeading +
          "» — объявляется текст ЗАГОЛОВКА РАЗДЕЛА, а не шапка таблицы";
  checkHead("Правила изоляции", {
    n: isolation.length,
    unit: "слоёв изоляции",
  });
  console.log(`  нарушено: ${brokenIso.length}`);
  if (isoMissed !== null) console.log("    " + isoMissed);
  for (const b of brokenIso) console.log("    " + b);

  // 7c. правило про несуществующий предмет.
  // Обе таблицы слоёв судят «сверху вниз»: берут слой и смотрят его импорты.
  // Слой, которого на диске нет, даёт пустой список — и строка проходит
  // зелёной, продолжая читаться как действующее правило. Найдено пробой на
  // свежей таблице изоляции; у таблицы направлений дыра та же. Имена пакетов
  // (без косой черты) сюда не идут: они и не пути.
  const emptyRules = [];
  /** Имя пакета — не путь, и спрашивать с него существования на диске нельзя.
   * Отличается оно от имени СЛОЯ не косой чертой, а тем, что объявлено
   * зависимостью: слои в обеих таблицах пишутся без косой ровно так же, и
   * прежняя оговорка «без косой — значит пакет» уводила из-под сверки весь её
   * главный случай. */
  const declaredPackages = (() => {
    const out = new Set();
    if (CONFIG.manifest == null) return out;
    const at = path.join(BASE, CONFIG.manifest);
    if (!existsSync(at)) return out;
    const j = JSON.parse(readFileSync(at, "utf8"));
    for (const kind of ["dependencies", "devDependencies", "peerDependencies"])
      for (const name of Object.keys(j[kind] ?? {})) out.add(name);
    return out;
  })();
  const resolves = (q) =>
    declaredPackages.has(q) ||
    q.startsWith("@") ||
    (inside(q, null)?.hits ?? []).length > 0;
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

  checkHead("Правила про существующее", {
    n: rules.length + isolation.length,
    unit: "правил направления и изоляции",
  });
  console.log(
    `  правил ни о чём: ${emptyRules.length}, заявленных таблиц не найдено: ${missingTables.length}`,
  );
  for (const e of emptyRules) console.log("    " + e);
  for (const m of missingTables) console.log("    " + m);

  for (const kind of markerKinds) {
    checkHead(kind.title, { n: kind.total, unit: "пометок в коде" });
    console.log(
      `  без записи в ${kind.base}: ${kind.unlisted.length}` +
        debtTail(kind.debtKind) +
        `, названо записью и снято из кода: ${kind.gone.length}` +
        (kind.missed?.length ? `, форма не та: ${kind.missed.length}` : ""),
    );
    debtNote(kind.debtKind, kind.unlisted.length);
    for (const m of kind.missed ?? []) console.log("    " + m);
    for (const u of debtList(kind.debtKind, kind.unlisted))
      console.log("    " + u);
    for (const g of kind.gone) console.log(`    ${kind.base} → ${g}`);
  }

  checkHead("Якоря", { n: anchors, unit: "якорей" });
  console.log(`  с цитатой: ${cited}, битых: ${broken.length}`);
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
      for (const hit of manual.matchAll(/^### `([a-z-]+)\b/gm))
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
  let adrLooked = 0;
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
      adrLooked = decisions.length;
      // Ссылкой считается номер решения (`ADR-004`) или имя его файла. Сам
      // документ себя не адресует, поэтому из корпуса исключается он один.
      for (const file of decisions) {
        const number = /^(\d+)/.exec(file)?.[1] ?? null;
        const marks = [file.replace(/\.md$/, ""), file];
        // Корпус ссылок включает ФАЙЛЫ ПРАВИЛ. Правила — естественное место
        // сослаться на решение: «почему так» там и объясняют. Без них решение,
        // названное только в правилах, читалось как никем не адресованное, и
        // предлагалось снести живую запись. Найдено посадкой в проект со
        // вложенными правилами единицы.
        const rulesFiles = (CONFIG.rulesManifest?.rules ?? [])
          .map((one) => norm(path.join(BASE, one)))
          .filter((one) => existsSync(one));
        const found = [
          ...files,
          ...styleFiles,
          ...docFiles,
          ...rulesFiles,
        ].some((f) => {
          if (norm(f) === norm(path.join(dir, file))) return false;
          const body = readFileSync(f, "utf8");
          if (marks.some((m) => body.includes(m))) return true;
          // Номер сравнивается ЧИСЛОМ, а не строкой. Имя файла решения
          // дополняют нулями до ширины — `0001`, — а ссылаются на него коротко:
          // `ADR-1`. Так написан и заголовок самого документа. Сравнение строкой
          // требовало дословного `ADR-0001`, и проект, сославшийся естественной
          // формой, получал «на решение не ссылается никто» — при том что
          // СОСЕДНЯЯ сверка, разбирающая якоря на документы, ту же ссылку
          // разрешает: она номер к числу приводит. Два места инструмента читали
          // одну форму по-разному, и расходились они молча.
          if (number === null) return false;
          ADR_REF.lastIndex = 0;
          let hit;
          while ((hit = ADR_REF.exec(body)) !== null)
            if (Number(hit[1]) === Number(number)) return true;
          return false;
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
        // Спрашивается только с документа, который КОНСТАНТЫ И ОПИСЫВАЕТ, —
        // признак: он называет хотя бы одно имя из заглавных букв в обратных
        // кавычках. Папка документации держит и другое: соглашения проекта,
        // витрину возможностей, решения. Требовать таблицы настроек от них
        // значило бы краснеть на законном — и краснеть в первую очередь на
        // СОБСТВЕННЫХ семенах обвязки, которые кладутся в ту же папку. Найдено
        // посадкой в проект, впервые объявивший таблицы настроек.
        const body = readFileSync(path.join(docsDir, doc), "utf8");
        if (!/`[A-Z][A-Z0-9_]*`/.test(body)) continue;
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
  checkHead("Константы настроек описаны", {
    n: constantsChecked,
    unit: "констант настроек",
  });
  console.log(
    `  разошлось: ${undocumentedConst.length}` + debtTail("constants"),
  );
  debtNote("constants", undocumentedConst.length);
  for (const c of debtList("constants", undocumentedConst))
    console.log("    " + c);

  checkHead("Точечные исключения линта", {
    n: files.length,
    unit: "файлов кода",
  });
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
  checkHead("Выключения правил линта", {
    n: (CONFIG.lintConfigOff?.allowed ?? []).length,
    unit: "объявленных выключений",
  });
  console.log(
    CONFIG.lintConfigOff == null
      ? "  конфиг линта не заявлен"
      : `  расхождений: ${offDrift.length}`,
  );
  for (const o of offDrift) console.log("    " + o);

  checkHead("Режимы инструмента описаны", {
    n: toolModes().length,
    unit: "режимов инструмента",
  });
  console.log(`  без описания: ${undocumented.length}`);
  for (const u of undocumented) console.log("    " + u);

  // 9b. список разрешений среды не потерял того, что обещает полка
  const settingsDrift = [];
  let settingsLooked = 0;
  const settingsEarned = [];
  {
    // Правило записывается двумя равными формами: `Bash(ls *)` и `Bash(ls:*)`
    // — среда считает их одним и тем же, а диалог подтверждения пишет первую.
    // Сравнение дословно объявляло бы потерянным правило, записанное второй
    // формой, то есть краснело бы на законном. Проверено по описанию среды.
    const same = (one) =>
      one.replace(new RegExp(":\\*\\)$"), " *)").replace(/\s+/g, " ");
    // Спрашиваются ТРИ списка, а не один. Прежде смотрели только `allow`, и
    // проект, потерявший запреты, проходил зелёным — при том что `deny` и
    // `ask` и есть страховка от разрушительного, а `allow` всего лишь снимает
    // вопросы. Хуже того: `allow` начинает действовать только после того, как
    // папке доверились, а `deny` и `ask` — сразу.
    const kinds = ["deny", "ask", "allow"];
    const readAt = (at) => {
      if (!existsSync(at)) return null;
      const parsed = JSON.parse(readFileSync(at, "utf8"));
      return Object.fromEntries(
        kinds.map((k) => [k, (parsed?.permissions?.[k] ?? []).map(same)]),
      );
    };
    const shared = readAt(path.join(BASE, CONFIG.settingsProject));
    settingsLooked =
      shared === null
        ? 0
        : kinds.reduce((n, k) => n + (shared[k] ?? []).length, 0);
    const local = readAt(
      path
        .join(BASE, CONFIG.settingsProject)
        .replace(/settings.json$/, "settings.local.json"),
    );
    if (shared === null)
      settingsDrift.push(`нет файла: ${CONFIG.settingsProject}`);
    // Запреты и вопросы СЕМЕНИ обязаны стоять в общем файле проекта. Файл
    // ложится семенем, а у проекта со своим — дописывается в него; слияние
    // делает человек, и потерянный запрет выглядит так же, как не
    // привезённый. Прежде общий файл ехал в самом снимке, и команда установки
    // затирала им файл проекта — теперь проект сохраняет своё, и держать
    // приходится обратное: что обвязкино не потерялось. Разрешения `allow`
    // не спрашиваются: без них задают вопрос, а без запрета — не спрашивают.
    const seedSettings = readAt(shelfAt("seat/templates/settings.json") ?? "");
    if (shared !== null && seedSettings !== null)
      for (const kind of ["deny", "ask"])
        for (const entry of seedSettings[kind])
          if (!shared[kind].includes(entry))
            settingsDrift.push(
              `${kind}: ${entry} — есть в семени, нет в общем файле проекта`,
            );
    // Обратная сторона, и она НЕ роняет прогон. Проект наживает разрешения по
    // ходу работы, и большая часть из них законно проектная — свои скрипты,
    // свои пути, свои службы. Но часть общая, и семя о ней не узнаёт ничем:
    // следующий проект начнёт с нуля и нажмёт те же подтверждения заново.
    // Замерено на живом файле рабочей области: сорок пять общих правил,
    // которых в семени не было, нашлись только ручным сравнением.
    //
    // Печатается вопросом, а не ошибкой: судить «общее или проектное» может
    // только человек, а прогон, краснеющий на законном, перестают читать.
    // Нажитое кнопкой попадает в местный файл, и туда ему и дорога: оно не
    // едет. Но часть нажитого общая, и тогда её переносят в общий файл руками.
    // Вопрос об этом задаётся здесь; молча общее правило осталось бы местным
    // навсегда, и следующий проект нажал бы его заново.
    if (shared !== null && local !== null)
      for (const kind of kinds)
        for (const entry of local[kind])
          if (!shared[kind].includes(entry))
            settingsEarned.push(`${kind}: ${entry}`);
  }
  // Версии установленного против объявленных минимумов.
  //
  // Спрашивается то, что РЕАЛЬНО лежит в зависимостях, а не диапазон из
  // манифеста: диапазон говорит о намерении, а работает установленное. У среды
  // версия берётся у самого запущенного процесса.
  //
  // **Уведомляет, а не роняет.** Решение обновляться принимает разработчик;
  // прогон, останавливающий работу из-за минорной версии, начнут гонять реже, и
  // тогда он перестанет ловить то, ради чего заведён.
  const oldVersions = [];
  if (CONFIG.verifiedVersions != null) {
    const older = (have, need) => {
      const a = String(have)
        .replace(/^[^0-9]*/, "")
        .split(".")
        .map(Number);
      const b = String(need).split(".").map(Number);
      for (let i = 0; i < 3; i += 1) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x < y;
      }
      return false;
    };
    // Версия установленного: у `node` она своя, у МЕНЕДЖЕРА ПАКЕТОВ —
    // спрашивается у него самого, у пакета — из его манифеста.
    //
    // Менеджер добавлен по замеру: его версия объявлена полем среды манифеста,
    // сам он это поле не соблюдает, и на версии ниже объявленной установка
    // падает собственной ошибкой, где про версию нет ни слова. Посадка при этом
    // встаёт, а причина выглядит дефектом проекта.
    const installed = (name) => {
      if (name === "node") return process.versions.node;
      if (name === "npm") {
        try {
          return execFileSync("npm", ["--version"], {
            encoding: "utf8",
            shell: true,
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
        } catch {
          return null;
        }
      }
      const at = path.join(BASE, "..", "node_modules", name, "package.json");
      if (!existsSync(at)) return null;
      return JSON.parse(readFileSync(at, "utf8")).version;
    };
    // Стороны называются ПОРОЗНЬ, потому что означают разное. Ниже связки
    // поведение неизвестно, и обвязка за него не отвечает. Выше — каждый пакет
    // сам по себе, вероятно, исправен, но связка как целое не мерена: ровно так
    // мутационное звено и перестало читать результаты тестов, когда их раннер
    // ушёл на мажор вперёд.
    for (const [name, want] of Object.entries(CONFIG.verifiedVersions)) {
      const have = installed(name);
      if (have === null) continue;
      if (older(have, want))
        oldVersions.push(
          `${name} ${have} — НИЖЕ проверенной связки (${want}): поведение неизвестно`,
        );
      else if (older(want, have))
        oldVersions.push(
          `${name} ${have} — ВЫШЕ проверенной связки (${want}): сам по себе исправен, совместимость связки не мерена`,
        );
    }
  }

  checkHead("Версии установленного (предупреждение, прогон не роняет)", {
    n: Object.keys(CONFIG.verifiedVersions ?? {}).length,
    unit: "объявленных версий",
  });
  console.log(
    CONFIG.verifiedVersions == null
      ? "  проверенная связка не объявлена"
      : oldVersions.length === 0
        ? "  связка совпадает с проверенной"
        : `  расходится с проверенной связкой: ${oldVersions.length}.` +
          " Объявлен НАБОР версий, на котором обвязку мерили как целое, а не" +
          " порог. Ниже него обвязка не отвечает ни за что; выше каждый пакет" +
          " сам по себе, вероятно, исправен, но совместимость связки надо" +
          " перемерить — прогнать цепочку и мутационное звено, и обновить" +
          " объявление. Решение разработчика",
  );
  for (const o of oldVersions) console.log("    " + o);

  checkHead(
    "Разрешения, нажитые по ходу работы (предупреждение, прогон не роняет)",
    {
      n: settingsLooked,
      unit: "разрешений в общем файле",
    },
  );
  console.log(
    settingsEarned.length === 0
      ? "  нет: местный файл разрешений ничего не добавляет к общему"
      : `  в местном файле есть, а в общем нет: ${settingsEarned.length}.` +
          " Общее — перенести в общий, проектное — оставить местным",
  );
  for (const e of settingsEarned) console.log("    " + e);

  checkHead("Разрешения среды", {
    n: settingsLooked,
    unit: "разрешений в общем файле",
  });
  console.log(`  расхождений: ${settingsDrift.length}`);
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
      // Подъём идёт до корня РЕПОЗИТОРИЯ, а не исходников. Папка документации
      // лежит рядом с исходниками, а не внутри: адрес, начинающийся с папки
      // документации, с остановкой на корне исходников не разрешался никогда.
      // Пока решений у
      // проектов не было, это не проявлялось — первая же ссылка на решение из
      // кода легла в «ведут в никуда», при живом файле на диске.
      const stop = norm(path.join(BASE, ".."));
      while (dir.length >= stop.length) {
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
  // 10-бис. комментарий не перерос в прозу, и его не стало слишком много
  //
  // Корпус — ВЕСЬ код проекта, включая тесты и листы стилей: свод объявляет
  // кодом все три, и поэма в тесте ничем не лучше поэмы в модуле.
  //
  // Списка исключений у сверки нет намеренно: длинный комментарий всегда
  // можно объявить тонким местом. Нужно больше слов — это решение или
  // документ слоя, а в коде остаётся строка с якорём, и якорь сверяет
  // соседняя сверка.
  // Семя, лежащее нетронутым, — работа обвязки, а не проекта, и СУДИТЬ его
  // по правилам проекта нельзя: это её текст, её решения, её длина
  // комментария. Пока проект держал исходники в `src/`, семена конфигов
  // лежали вне корпуса сами собой. Проект с двумя деревьями объявляет
  // корнем исходников корень репозитория — и семена оказались внутри:
  // прогон выдал `восемь` находок про длину комментария в привезённом
  // конфиге линта и пометку решения в нём же.
  //
  // Признак общий с воротами, ревизией, предметом свода, следом прогона и
  // предметом звена — седьмое его место.
  const ownCode = (() => {
    const seeds = seedOfPath();
    const repoRoot = path.join(BASE, "..");
    const every = [...files, ...styleFiles];
    const own = every.filter((f) => !untouchedSeed(f, repoRoot, seeds));
    // Своего кода нет — судится ВСЁ: проект живёт каркасом, и каркас ему не
    // чужой. Иначе корпус этих сверок становится нулевым, а ноль осмотренного
    // неотличим от здоровья — что свод запрещает прямо. Оговорка та же, что у
    // предмета звена цепочки.
    return own.length > 0 ? own : every;
  })();
  const wordyComments = [];
  const chattyFiles = [];
  let shareLooked = 0;
  let commentRuns = 0;
  // Листы стилей входят в корпус наравне с кодом: проза в них стареет так же,
  // а мёртвый блок объявлений лежит там столь же охотно. Прежде корпус был
  // только кодом, и лист не видела ни одна из двух сверок.
  // Код, закомментированный «на всякий случай». Доктрина запрещает его
  // прямо — documentation.md, список «нельзя», — а крючка у запрета не
  // было ни одного. Единственной соседней сверкой была доля комментария в
  // файле, и та смотрит файлы ОТ ПОТОЛКА СТРОК: короткий файл, наполовину
  // состоящий из прежней витрины, проходил зелёным.
  //
  // Опознаётся по СТРОЕНИЮ строки, а не по словам: строка кода начинается
  // ключевым словом языка либо кончается знаком, которым проза не
  // кончается. Одной такой строки мало — цитата в объяснении законна, — и
  // потому спрашивается ряд: три строки и не меньше двух похожих на код.
  const CODE_HEADS = [
    "import ",
    "export ",
    "const ",
    "let ",
    "var ",
    "function ",
    "class ",
    "return ",
    "await ",
    "new ",
  ];
  const looksCode = (line) => {
    const bare = line.trim();
    if (bare.length === 0) return false;
    if (CODE_HEADS.some((h) => bare.startsWith(h))) return true;
    const tail = bare.slice(-1);
    if (tail !== ";" && tail !== "{" && tail !== "}") return false;
    return bare.includes("(") || bare.includes("=") || bare.includes("<");
  };
  const deadCode = [];
  for (const f of ownCode) {
    const body = readFileSync(f, "utf8");
    const runs = commentRunsOf(body);
    if (runs === "") continue;
    let commentLines = 0;
    for (const run of runs.split(";")) {
      const [kind, at, words, rows] = run.split(":");
      commentRuns += 1;
      commentLines += Number(rows);
      const ceiling =
        kind === "block" ? COMMENT_BLOCK_WORDS : COMMENT_RUN_WORDS;
      if (Number(words) <= ceiling) continue;
      wordyComments.push(
        rel(f) +
          ":" +
          at +
          " — " +
          (kind === "block" ? "блок" : "ряд") +
          ", слов " +
          words +
          " при потолке " +
          ceiling,
      );
    }
    {
      const lines = body.split(NEWLINE);
      for (const run of runs.split(";")) {
        const [, at, , rows] = run.split(":");
        if (Number(rows) < 3) continue;
        const from = Number(at) - 1;
        let hits = 0;
        for (let i = from; i < from + Number(rows); i += 1) {
          const bare = lines[i]
            .replace("//", " ")
            .replace("/*", " ")
            .replace("*/", " ")
            .trim();
          const body2 = bare.startsWith("*") ? bare.slice(1).trim() : bare;
          if (looksCode(body2)) hits += 1;
        }
        if (hits < 2) continue;
        deadCode.push(
          rel(f) +
            ":" +
            at +
            " — в комментарии лежит код: строк, похожих на код, " +
            hits +
            " из " +
            rows,
        );
      }
    }
    const total = body.split(NEWLINE).length;
    if (total < COMMENT_SHARE_FLOOR) continue;
    shareLooked += 1;
    if (commentLines / total <= COMMENT_SHARE) continue;
    chattyFiles.push(
      rel(f) +
        " — строк комментария " +
        commentLines +
        " из " +
        total +
        ", это " +
        Math.round((100 * commentLines) / total) +
        " % при потолке " +
        Math.round(100 * COMMENT_SHARE) +
        " %",
    );
  }
  // Долг `comments` у трёх сверок ОДИН, и мерится он СУММОЙ их находок.
  // Предмет у сверок общий — комментарии кода, пришедшего до посадки, — а
  // поле в настройке одно. Пока каждая сравнивала с полем СВОЙ счёт, долг,
  // объявленный под одну из них, молча прощал столько же находок каждой
  // соседней, а фактический долг мерила только первая: честно объявленный
  // долг за длинный комментарий прогон называл лишним и велел обнулить.
  // Замерено посадкой стенда, чей единственный старый комментарий длиннее
  // потолка.
  const commentFound =
    deadCode.length + wordyComments.length + chattyFiles.length;
  DEBT_REAL.set(
    "comments",
    Math.max(DEBT_REAL.get("comments") ?? 0, commentFound),
  );
  const overComments = overDebtOf("comments", commentFound);
  const commentTail =
    debtOf("comments") > 0
      ? "; у трёх сверок комментариев вместе находок " +
        commentFound +
        ", долг посадки на них общий: " +
        debtOf("comments")
      : "";
  checkHead("Закомментированного кода нет", {
    n: commentRuns,
    unit: "рядов комментария",
  });
  console.log("  рядов с кодом внутри: " + deadCode.length + commentTail);
  for (const one of overComments > 0 ? deadCode : []) console.log("    " + one);
  if (deadCode.length > 0 && overComments === 0)
    console.log(
      "  Держится долгом посадки: код закомментирован до неё. Снять его — работа, а не правка",
    );
  checkHead("Комментарий не перерос в прозу", {
    n: commentRuns,
    unit: "рядов комментария",
  });
  console.log("  длиннее потолка: " + wordyComments.length + commentTail);
  if (wordyComments.length > 0) debtNote("comments", commentFound);
  // Список печатается ЦЕЛИКОМ, а не хвостом сверх долга. Долг решает, красный
  // ли прогон; что именно нарушено — не его дело. Срез по числу отсекал с
  // начала списка и потому поглощал НОВОЕ нарушение, показывая вместо него
  // старое, известное. Замерено на стенде: сессия дописала свой длинный
  // комментарий, прогон покраснел — и назвал чужой блок, принесённый кодом.
  for (const c of overComments > 0 ? wordyComments : [])
    console.log(
      "    " + c + ". Оставить суть; остальное — в документ слоя или решение",
    );

  checkHead("Доля комментариев в файле", {
    n: shareLooked,
    unit: "файлов от потолка строк и выше",
  });
  console.log("  файлов сверх потолка: " + chattyFiles.length + commentTail);
  if (chattyFiles.length > 0) debtNote("comments", commentFound);
  for (const c of overComments > 0 ? chattyFiles : [])
    console.log("    " + c + ". Объяснения переносят в документ слоя");
  checkHead("Якоря на документацию в коде", {
    n: anchorCount,
    unit: "якорей на документацию",
  });
  console.log(`  ведут в никуда: ${deadAnchors.length}`);
  for (const a of deadAnchors) console.log("    " + a);

  // 11. отложенное не превращается в историю
  // Правило написано дважды — в шапке самого файла и в CLAUDE.md — и всё равно
  // нарушается: пометить пункт дешевле, чем удалить. Ловится маркер статуса,
  // а не слово: капсом в любом месте заголовка, либо в его хвосте после тире
  // или в скобках. «Закрыть доступность» — законный открытый пункт, и он не
  // должен ловиться.
  const closedTodos = [];
  let todoLooked = 0;
  if (CONFIG.todo != null) {
    const todoPath = path.join(BASE, CONFIG.todo);
    if (!existsSync(todoPath)) closedTodos.push(`файла нет: ${CONFIG.todo}`);
    else {
      // Обе половины этой сверки читают ОДИН файл и обязаны считать в нём
      // одно и то же. Читали разное: сторона ссылок — через съёмник
      // огороженных блоков и только нумерованный заголовок, сторона счёта —
      // сырой текст и любой заголовок второго уровня.
      //
      // Цена замерена сценарием на стенде: свод по планке завёл шесть
      // пунктов, а сверка доложила девять — в счёт попали образец формы из
      // самого семени, лежащий в блоке кода, и заголовок раздела про форму.
      // Хуже счёта то, что номера образца совпали с настоящими: в файле
      // оказалось два пункта `1` и два пункта `2`, а на номер ссылаются из
      // кода и из других файлов базы.
      //
      // Съёмник заведён ровно для этого, и его же комментарий называет
      // пункты отложенного одним из четырёх сканеров, которым он нужен, —
      // этот при заведении пропустили. Соседнее семя, список вопросов,
      // обошло тот же класс иначе: приводит образец цитатой, а не разметкой.
      const todoText = unfenced(readFileSync(todoPath, "utf8"));
      todoLooked = todoText
        .split(NEWLINE)
        .filter((l) => /^#{2,}\s+\d+\./.test(l)).length;
      const shouting = /(ЗАКРЫТО|СДЕЛАНО|ГОТОВО|ВЫПОЛНЕНО|DONE|CLOSED)/;
      const trailing = /[—\-(]\s*(закрыт|сделан|готов|выполнен)\S*\s*\)?\s*$/i;
      const struck = /^~~.*~~$/;
      for (const line of todoText.split(NEWLINE)) {
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
  let questionsSeen = 0;
  const malformedQuestions = [];
  // Списков два, и читаются они одинаково: проектный — про этот репозиторий,
  // доктринальный — про саму обвязку, и он едет с ней дальше. Второй не
  // печатался никем, и единственная машинная опора требования «назвать каждый
  // вопрос в отчёте» для него была выключена: вопрос о доктрине жил ровно
  // столько, сколько его помнила сессия.
  const questionLists = [];
  if (CONFIG.questions != null)
    questionLists.push([
      "проект",
      path.join(BASE, CONFIG.questions),
      CONFIG.questions,
    ]);
  if (SHELF !== null) {
    const at = shelfAt("state/questions.md");
    if (at !== null && existsSync(at))
      questionLists.push(["доктрина", at, "state/questions.md"]);
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
      questionsSeen += heads.length;
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
      for (const line of unfenced(readFileSync(todoPath, "utf8")).split(
        NEWLINE,
      )) {
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
        unfenced(readFileSync(full, "utf8"))
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
      // Дифф против HEAD не видит файлов, ещё не взятых в git: новый файл
      // базы проходил с якорями без цитат целиком. Его строки — тоже
      // добавленные, и они дописываются к диффу в той же форме.
      const fresh = execSync(
        "git ls-files --others --exclude-standard -- .context",
        { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      for (const one of fresh.split(NEWLINE).filter(Boolean))
        diff +=
          NEWLINE +
          "+++ b/" +
          one +
          NEWLINE +
          readFileSync(path.join(REPO, one), "utf8")
            .split(NEWLINE)
            .map((l) => "+" + l)
            .join(NEWLINE);
    } catch {
      newAnchorsChecked = false;
    }
    // Адреса протокола свода — не записи базы, а форма режима `bar`: адрес
    // там пишется строго «путь:строка», и существование строки сверяет сам
    // режим при печати. Цитата у них невозможна по форме.
    const barFile =
      CONFIG.barProtocol == null
        ? null
        : norm(path.relative(REPO, path.join(BASE, CONFIG.barProtocol)));
    if (diff !== null) {
      let file = "";
      for (const line of diff.split(NEWLINE)) {
        if (line.startsWith("+++ b/")) {
          file = line.slice(6);
          continue;
        }
        if (file === barFile) continue;
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
  checkHead("Новые якоря — с цитатой", {
    n: files.length,
    unit: "файлов кода",
  });
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
  checkHead("Найденное — исправлено, а не отложено", {
    n: files.length,
    unit: "файлов кода",
  });
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
  // Сколько ссылок вообще разобрано. Без этого числа секция печатала один ноль
  // висячих, а ноль разобранного выглядит точно так же — то есть выключенная
  // сверка читалась бы как здоровая. Класс в проекте уже ловился («пустой
  // разбор печатается как 0»), здесь он был не закрыт.
  let refTokens = 0;
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
          if (skipDirs.has(e) || OUT_OF_TREE.has(e)) continue;
          const full = norm(path.join(dir, e));
          // Обвязка из обхода исключена целиком: в её семенах лежит заготовка
          // файла правил, и обход объявлял её незаявленным файлом правил
          // проекта. Найдено пересадкой начисто.
          if (SHELF !== null && full.startsWith(norm(SHELF) + "/")) continue;
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
    // правилах законно стоят имена компонентов в угловых скобках и десяток
    // оборотов вида `<путь>` —
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
      // Признак — открывающая скобка в начале строки, **после необязательного
      // маркера комментария**. Без него детектор был слеп на конфигах: заготовка
      // там пишется комментарием (`// <ПРОЕКТНОЕ: …>`, `# <ПРОЕКТНОЕ: …>`), и
      // сверка проходила зелёной на файле, где место под заполнение стоит прямо
      // в первой строке. Найдено пробой сразу после того, как корпус расширили
      // на засеянные файлы: расширили, а форму не тронули.
      // Пометки каркаса из счёта исключены. Это объявленная ПАРА маркеров, а
      // не место под заполнение: у пустого проекта каркас лежит законно, и
      // пометки при нём остаются. Образец ловил их открывающей скобкой — и
      // верно посаженный пустой проект не мог пройти эту сверку в принципе,
      // а рубеж завершения посадки у него как раз нулевой код возврата.
      // Найдено посадкой в проект без кода.
      // Маркеры обвязки — не подсказки заготовки: они приезжают в семенах и
      // в правильно посаженном проекте обязаны стоять. Образец один на все:
      // второй рядом с первым разошёлся бы при заведении третьего.
      // Границы слова здесь нет и быть не может: она считается по латинице,
      // а имена маркеров кириллические — после них `\b` не срабатывает
      // никогда. Замерено вторым прогоном начисто: починка соседней запинки
      // сломала опознание маркеров каркаса, и число подсказок втрое выросло.
      const FRAME_MARK = /^\s*<!--\s*\/?(?:КАРКАС|ПУСТО|ЗАПОЛНИТЬ)[^>]*-->\s*$/;
      const prose = body
        .split(NEWLINE)
        .filter(
          (l) => !FRAME_MARK.test(l) && /^\s*(?:\/\/|#|\*|<!--)?\s*</.test(l),
        ).length;
      if (prose > 0)
        unfilledTemplate.push(`${one}: подсказок заготовки прозой: ${prose}`);
      // Инструкция ЗАПОЛНЯЮЩЕМУ живёт ровно до заполнения. У пустоты и у
      // каркаса пометки есть, у слотов правил не было ни одной — и абзац
      // «отвечать по слотам, слотов четыре» оставался в правилах проекта,
      // обращённый к никому, при нуле слотов. Найдено ревизией результата
      // на семи стендах разом: у всех семи.
      if (body.includes("<!-- ЗАПОЛНИТЬ -->") && prose === 0)
        unfilledTemplate.push(
          one +
            ": инструкция заполняющему пережила заполнение — снять абзац вместе с пометками ЗАПОЛНИТЬ",
        );
      // Четвёртая форма: ОБОРВАННАЯ подсказка. Три формы выше ищут
      // открывающую скобку, и место, заполненное наполовину, ни одной из них
      // не видно: ответ пишут поверх первых строк подсказки, а хвост её
      // остаётся вместе с закрывающей скобкой. Замерено третьим кругом проб:
      // в правилах стенда лежал абзац подсказки, кончающийся `>`, при ответе
      // сверки «незаполненных мест: 0».
      //
      // Признак — строка, кончающаяся одинокой `>`, при том что открывающей
      // скобки выше по файлу не осталось. Стрелка сравнения, закрывающая
      // скобка разметки и цитата markdown под него не подходят: первая не
      // стоит в конце строки, вторая кончается `-->`, третья начинается с
      // `>`, а не кончается ею.
      {
        const rows = body.split(NEWLINE);
        let opened = false;
        let orphan = 0;
        for (const l of rows) {
          if (/^\s*(?:\/\/|#|\*|<!--)?\s*</.test(l)) opened = true;
          if (!/[^-\s]>\s*$/.test(l)) continue;
          if (opened) {
            opened = false;
            continue;
          }
          orphan += 1;
        }
        if (orphan > 0)
          unfilledTemplate.push(
            `${one}: оборванных подсказок заготовки: ${orphan}`,
          );
      }
      // Третья форма: место под заполнение ВНУТРИ строки таблицы. Две формы выше
      // требуют, чтобы скобка стояла в начале строки либо чтобы подсказка была
      // набрана заглавными, — и обе слепы на строку таблицы с угловыми скобками.
      // Такая строка пролежала в реестре решений с самой посадки, при том что
      // файл объявлен засеянным и проверяется каждым прогоном. Найдено прямым
      // вопросом «полка готова?», то есть чтением, а не прогоном.
      //
      // Корпус узкий по построению: спрашиваются только объявленные засеянными
      // файлы, а в них угловая скобка означает ровно одно.
      const inRow = body.split(NEWLINE).filter(
        (l) =>
          l.trimStart().startsWith("|") &&
          // Обратные кавычки снимаются до поиска: угловая скобка внутри них
          // — нотация пути (`components/<Имя>/`), а не место под заполнение.
          // Место под заполнение в кавычках не пишут никогда. Замерено
          // посадкой начисто: проект, описавший раскладку доктринальной
          // нотацией, закрыться не мог.
          /<[^>]+>/.test(l.replace(/`[^`]*`/g, "")),
      ).length;
      if (inRow > 0)
        unfilledTemplate.push(
          one + ": мест под заполнение в таблицах: " + inRow,
        );
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
      // Собственная проза ПОЛКИ: доктрина, инструкция посадки, справочник
      // инструмента, памятки. В корпус этой сверки не входила, и ссылка на
      // несуществующий раздел из доктрины проходила молча. Замерено: из
      // `25` ссылок на разделы во всей прозе репозитория сверка читала `5`.
      ...shelfProse(),
    ];
    // Заголовки берутся из ТОГО ЖЕ корпуса, что и ссылки: иначе живая ссылка
    // внутрь доктрины объявляется висячей.
    for (const [, at] of sources)
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
        refTokens++;
        // Место под заполнение ссылкой не бывает: `«<ось>»` в форме отчёта —
        // слот, который заполняют, а не адрес, по которому ходят.
        if (title.includes("<")) continue;
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
        //
        // Сравнение без регистра и без НУМЕРАТОРА: разделы доктрины идут
        // буквой или числом («## B. Форма контракта: …»), а ссылаются на них
        // строчными и без номера. Буквальное сравнение объявляло висячей
        // живую ссылку — ложное срабатывание, а крикливой сверке перестают
        // верить. Замерено на первом же расширении корпуса.
        const bare = (one) =>
          one
            .toLowerCase()
            .replace(/^[a-zа-яё0-9]{1,3}[.)]s*/i, "")
            .trim();
        const want = bare(title);
        const found = [...allHeads].some((h) => {
          const has = bare(h);
          return has === want || has.startsWith(want);
        });
        if (!found) danglingRefs.push(`${name}: «${title}»`);
      }
    }
    for (const one of skip)
      if (!skipUsed.has(one))
        deadExceptions.push(`ссылки на разделы: «${one}» — ничего не гасит`);
  }
  checkHead("Ссылки на разделы", { n: refTokens, unit: "ссылок на разделы" });
  console.log(
    CONFIG.rulesManifest == null
      ? "  реестр правил не заявлен"
      : `  ведут в никуда: ${danglingRefs.length}`,
  );
  for (const d of danglingRefs) console.log("    " + d);
  // 13c. Скиллы проекта: объявлены, лежат на месте, совпадают с полкой.
  const skillDrift = [];
  let skillsLooked = 0;
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
    skillsLooked = new Set([...onDisk, ...listed.keys()]).size;
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
    for (const [name] of listed) {
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
  let disarmedLooked = 0;
  const dirsUnder = (root, name) => {
    const found = [];
    if (!existsSync(root)) return found;
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = norm(path.join(dir, entry));
        if (!statSync(full).isDirectory()) continue;
        // Общее исключение спрашивается и здесь: на проекте, объявившем
        // корнем исходников корень репозитория, обход находил папки внутри
        // `node_modules` и предлагал объявить ЧУЖИЕ таблицы настроек своими.
        if (outOfTree(entry, full)) continue;
        if (entry === name) found.push(full);
        walk(full);
      }
    })(norm(root));
    return found;
  };
  if (CONFIG.adr == null) {
    disarmedLooked += 1;
    // Папку решений ищут и в документах корня: по обычаю она лежит в
    // `docs/adr`, а не среди исходников. Пока искали в одних деревьях кода,
    // проект со своими решениями в документах посадку проходил с пустым
    // полем, и сверка адресуемости решений не вооружалась никогда —
    // напоминание, обещанное шагом 2, не звучало. Замерено посадкой руками.
    const docsAt = path.join(REPO, "docs");
    const found = [
      ...SRC_ROOTS.flatMap((one) => dirsUnder(one, "adr")),
      ...(existsSync(docsAt) ? dirsUnder(docsAt, "adr") : []),
    ].filter((d) => readdirSync(d).some((n) => /^\d+.*\.md$/.test(n)));
    if (found.length)
      disarmed.push(
        "решения уже есть (" +
          path.relative(REPO, found[0]).split(path.sep).join("/") +
          "), а CONFIG.adr пуст",
      );
  }
  if (CONFIG.configDocs == null) {
    disarmedLooked += 1;
    const found = SRC_ROOTS.flatMap((one) => dirsUnder(one, "config")).filter(
      (d) =>
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
  // Направление зависимостей: правила проекта называют его ПРОЗОЙ, а таблицу,
  // по которой оно проверяется, не объявляют. Сверка направления осматривала
  // ноль правил во всех восьми замеренных прогонах — то есть доктрина
  // утверждает направление, а держит его ничто.
  if (CONFIG.rulesHeading == null && CONFIG.isolationHeading == null) {
    disarmedLooked += 1;
    const said = (CONFIG.rulesManifest?.rules ?? [])
      .map((r) => path.join(BASE, r))
      .filter((at) => existsSync(at))
      .map((at) => readFileSync(at, "utf8"))
      .join(NEWLINE);
    if (/Направление\s+(зависимостей|одно)/.test(said))
      disarmed.push(
        "правила проекта называют направление зависимостей прозой, а " +
          "ни CONFIG.rulesHeading, ни CONFIG.isolationHeading не объявлены — держит это ничто",
      );
  }
  // Реестр находок: поле пусто, а история полна починок. Обратная сторона
  // сверки «Находки закрыты» — коммит `fix:`, не названный ни одной строкой,
  // — при пустом поле молчит обо всех сразу.
  if (CONFIG.findings == null) {
    disarmedLooked += 1;
    let fixes = 0;
    try {
      fixes = execFileSync(
        "git",
        ["log", "--oneline", "--format=%s", "-n", "200"],
        {
          cwd: path.join(BASE, ".."),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .split(NEWLINE)
        .filter((l) => /^fix(\([^)]*\))?: /.test(l)).length;
    } catch {
      fixes = 0;
    }
    if (fixes > 0)
      disarmed.push(
        "починок в истории: " +
          fixes +
          ", а CONFIG.findings пуст — «всё найденное починено» держится памятью",
      );
  }
  // Звёздная бочка выключает разбор мёртвых экспортов внутри себя, и пустое
  // поле выключает сверку целиком: `export *` появится — не скажет никто.
  if (CONFIG.starBarrels == null) {
    disarmedLooked += 1;
    const found = files.filter(
      (f) => !isTest(f) && /^\s*export\s+\*/m.test(readFileSync(f, "utf8")),
    );
    if (found.length)
      disarmed.push(
        "звёздные бочки уже есть (" +
          rel(found[0]) +
          "), а CONFIG.starBarrels пуст",
      );
  }
  // Планка: политика качества лежит на диске, а протокол или набор критериев
  // не объявлены — свод по планке держится памятью целиком.
  for (const [field, why] of [
    ["barProtocol", "протоколу негде лежать"],
    ["qualityScope", "набор критериев неоткуда взять"],
  ]) {
    if (CONFIG[field] != null) continue;
    disarmedLooked += 1;
    const policy = path.join(BASE, "..", ".claude/rules/quality.md");
    if (existsSync(policy))
      disarmed.push(
        "политика качества на диске есть, а CONFIG." + field + " пуст — " + why,
      );
  }
  // След прогона: протокол планки ведётся, а следа нет — вопрос о планке
  // держится памятью на каждой правке.
  if (CONFIG.testedLedger == null) {
    disarmedLooked += 1;
    if (CONFIG.barProtocol != null)
      disarmed.push(
        "протокол планки ведётся, а CONFIG.testedLedger пуст — вопрос о планке держится памятью",
      );
  }
  // Сводка обещаний: раздел в базе заведён, а поле пусто — обещания без опоры
  // никто не собирает.
  if (CONFIG.promises == null) {
    disarmedLooked += 1;
    const found = readdirSync(BASE)
      .filter((n) => n.endsWith(".md"))
      .find((n) => /Держится:/.test(readFileSync(path.join(BASE, n), "utf8")));
    if (found !== undefined)
      disarmed.push(
        "записи обещаний уже есть (" + found + "), а CONFIG.promises пуст",
      );
  }
  if (CONFIG.lintConfigOff == null) {
    disarmedLooked += 1;
    const at = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"]
      .map((n) => path.join(BASE, "..", n))
      .find((f) => existsSync(f) && /:\s*"off"/.test(readFileSync(f, "utf8")));
    if (at !== undefined)
      disarmed.push(
        "правила линта уже выключаются в конфиге, а CONFIG.lintConfigOff пуст",
      );
  }
  if (CONFIG.domTables == null) {
    disarmedLooked += 1;
    // Предмет таблицы — ЧУЖАЯ связь: имя, второго конца которого в
    // репозитории нет. Своё дублирование предметом этого поля не является и
    // объявлению не подлежит — его сводят к одному источнику конструкцией, а
    // ловит его свод по планке.
    const { vars, attrs } = foreignLinks();
    // Сигналы называются ВСЕ, а не первый попавшийся: закрыв таблицей одни
    // переменные, проект оставлял бы атрибуты необъявленными при зелёном
    // прогоне и выполненном требовании.
    if (vars.length)
      disarmed.push(
        "переменная стиля " +
          vars[0].name +
          " читается в " +
          vars[0].where +
          " и не объявлена ни одним листом проекта — её ставит кто-то снаружи, а CONFIG.domTables пуст",
      );
    if (attrs.length)
      disarmed.push(
        "атрибут " +
          attrs[0].name +
          " есть в " +
          attrs[0].where +
          " и не встречается в коде проекта — его пишет кто-то снаружи, а CONFIG.domTables пуст",
      );
  }
  if (CONFIG.skills == null) {
    disarmedLooked += 1;
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
  // Страж был неполон: смотрел шесть необязательных полей из полутора десятков,
  // и какие именно — не говорил нигде. Сверка готовности нашла живой пример:
  // папка документации с двумя документами при пустом `docsIndex`. Список
  // дополняется вместе с каждым новым необязательным полем — иначе страж
  // стареет ровно так же, как то, что он стережёт.
  if (CONFIG.docsIndex == null) {
    disarmedLooked += 1;
    const at = path.join(BASE, "../docs");
    if (
      existsSync(at) &&
      readdirSync(at).filter((n) => n.endsWith(".md")).length
    )
      disarmed.push("документы уже есть (docs/), а CONFIG.docsIndex пуст");
  }
  if (CONFIG.mutationConfig == null) {
    disarmedLooked += 1;
    const at = ["stryker.config.json", "stryker.conf.json"]
      .map((n) => path.join(BASE, "..", n))
      .find((f) => existsSync(f));
    if (at !== undefined)
      disarmed.push(
        "конфиг мутационного прогона уже есть, а CONFIG.mutationConfig пуст",
      );
  }
  if (CONFIG.lintExceptions == null) {
    disarmedLooked += 1;
    const hit = files.find((f) =>
      /eslint-disable-next-line|eslint-disable-line/.test(
        readFileSync(f, "utf8"),
      ),
    );
    if (hit !== undefined)
      disarmed.push(
        "точечные исключения линта уже есть (" +
          rel(hit) +
          "), а CONFIG.lintExceptions пуст",
      );
  }
  if (CONFIG.transition == null) {
    disarmedLooked += 1;
    const at = path.join(BASE, "15-transition.md");
    if (existsSync(at))
      disarmed.push("план перехода уже есть, а CONFIG.transition пуст");
  }
  if (CONFIG.checksTable == null && SHELF !== null) {
    const at = path.join(SHELF, "rules/base-format.md");
    if (
      existsSync(at) &&
      readFileSync(at, "utf8").includes("| Что сверяется |")
    )
      disarmed.push("таблица сверок уже есть, а CONFIG.checksTable пуст");
  }
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
  let barScopes = 0;
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
      barScopes = sections.size;
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
      // Считается только то, что проект добавил САМ.
      //
      // Сеть по зависимостям ищет предмет раздела по имени библиотеки:
      // клиент запросов, обёртка хранилища, движок движения, набор
      // локализации. Пока полка везла один React, имя в манифесте означало
      // выбор проекта. Как только она стала раздавать стек приложения —
      // маршрутизатор, кэш запросов, хранилище, очистку разметки, даты,
      // локализацию, — те же имена стали означать ПОДАРОК ПОЛКИ, и сеть
      // объявляла бы живыми шесть разделов на проекте, где нет ни строки
      // соответствующего кода.
      //
      // Поэтому из манифеста вычитается манифест семени: остаётся то, что
      // дописали после посадки. Сеть по КОДУ при этом не трогается — она
      // и была про код, а не про намерение.
      const shelfDeps = new Set();
      {
        const seedAt = shelfAt("seat/templates/package.json");
        if (seedAt !== null && existsSync(seedAt)) {
          const seed = readJson(seedAt, {});
          for (const d of Object.keys(seed.dependencies ?? {}))
            shelfDeps.add(d);
          for (const d of Object.keys(seed.devDependencies ?? {}))
            shelfDeps.add(d);
        }
      }
      const deps = Object.keys({
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      }).filter((d) => !shelfDeps.has(d));
      const dep = (re) => deps.some((d) => re.test(d));
      // Признак ищется двумя сетями: по коду и по зависимостям. Вторая нужна
      // потому, что предмет чаще всего приезжает библиотекой, а её имя известно
      // заранее там, где выбор невелик: клиент запросов, обёртка хранилища,
      // движок движения, набор локализации. Список закрытый и назван поимённо —
      // угадывать он не пытается, а известное закрывает.
      const hasMarkup = () => code.some((f) => /\.(tsx|jsx)$/.test(f));
      // Третья сеть: СТИЛИ. Два признака анимации — объявление перехода и
      // ключевые кадры — по природе живут в файлах стилей, а корпус выше держит
      // только исполняемый текст. То есть сработать они не могли никогда, и
      // проект, у которого вся анимация сделана классами, проходил как «анимации
      // нет». Найдено вторым полигоном посадки.
      const hasStyle = (re) =>
        styleFiles.some((f) => re.test(readFileSync(f, "utf8")));
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
            new RegExp(
              "\\brequestAnimationFrame\\s*\\(|\\.animate\\s*\\(|pointerdown|pointermove|touchstart",
            ),
          ) ||
          hasStyle(new RegExp("@keyframes|transition\\s*:|animation\\s*:")) ||
          dep(
            /^(framer-motion|motion|gsap|react-spring|@react-spring|popmotion|anime|lottie|react-transition-group|react-transition-state)/i,
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
  let indexDocs = 0;
  if (CONFIG.docsIndex != null) {
    const dir = norm(path.join(BASE, CONFIG.docsIndex.dir));
    const table = path.join(BASE, CONFIG.docsIndex.table);
    if (existsSync(dir) && existsSync(table)) {
      const text = readFileSync(table, "utf8");
      if (!text.includes(CONFIG.docsIndex.heading))
        indexDrift.push(`таблицы указателя нет: «${CONFIG.docsIndex.heading}»`);
      else {
        const named = readdirSync(dir).filter((n) => n.endsWith(".md"));
        indexDocs = named.length;
        for (const name of named)
          if (!text.includes(name))
            indexDrift.push(`документа нет в указателе: ${name}`);
      }
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
        ? "    диапазон версии не объявлен — переносимость держится на памяти"
        : low === null && high === null
          ? `    диапазон «${want}» записан формой, которой разбор не знает`
          : low !== null && cmp(now, low) < 0
            ? `    версия НИЖЕ объявленной: ${now} при «${want}»`
            : high !== null && cmp(now, high) >= 0
              ? `    версия ВЫШЕ объявленной: ${now} при «${want}»`
              : null;
    // Отсутствие объявления — не предупреждение: опоры нет вовсе, и это
    // роняет прогон. Дрейф версии остаётся предупреждением.
    envUndeclared = want === null;
    checkHead("Диапазон среды объявлен", {
      n: envUndeclared ? 0 : 1,
      unit: "объявленных диапазонов",
    });
    console.log("  не объявлено: " + (envUndeclared ? 1 : 0));
    if (envUndeclared)
      console.log(
        "    переносимость держится на памяти. Объявить `engines` в манифесте",
      );
    {
      checkHead("Версия среды (предупреждение, прогон не роняет)", {
        n: envUndeclared ? 0 : 1,
        unit: "объявленный диапазон среды",
      });
      if (say !== null && !envUndeclared) {
        console.log(say);
        console.log(
          "  Числа базовой линии снимались на объявленной версии; решение, что",
        );
        console.log("  с этим делать, за вами — прогон остановлен не будет.");
      } else {
        console.log(
          envUndeclared
            ? "  диапазон не объявлен — сверять не с чем"
            : "  версия в объявленном диапазоне",
        );
      }
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
    const elsewhere = [];
    for (const link of CONFIG.toolchain) {
      // Звено без предмета пробелом не является: его не дописывают намеренно.
      if (!linkHasSubject(link.script)) continue;
      if (linkTakenElsewhere(link.script, scripts)) {
        elsewhere.push(link.script);
        continue;
      }
      // Спрашивается ПРОЕКТНОЕ имя звена, а не семенное.
      const own = linkOwnName(link.script, scripts) ?? link.script;
      const noScript = link.script != null && scripts[own] == null;
      const missing = (link.packages ?? []).filter((p) => !declared.has(p));
      if (!noScript && missing.length === 0) continue;
      const what = [
        noScript ? `команды \`${link.script}\` нет` : null,
        missing.length ? `не объявлены: ${missing.join(", ")}` : null,
      ]
        .filter((x) => x !== null)
        .join("; ");
      // Четыре пробела: этим отступом прогон узнаёт находку. С двумя она не
      // роняла его даже после того, как секция перестала быть предупреждением.
      gaps.push(
        `    ${link.script ?? "звено"} — ${what}` +
          NEWLINE +
          `      зачем: ${link.why ?? "не сказано в настройке"}` +
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
      // Связка читается именем менеджера, объявленного ПРОЕКТОМ. Прежде имя
      // стояло здесь литералом, и на проекте с другим менеджером связка
      // читалась как пустая: обратная сторона сверки не видела в ней ни
      // одного звена и молчать могла только зелено.
      const inChain = scriptCallsIn(chain);
      // Известными считаются и семенные имена звеньев, и те, под которыми
      // звено живёт в этом проекте: иначе проектное имя, законно попавшее в
      // связку, докладывается как необъявленное звено.
      const known = new Set();
      for (const l of CONFIG.toolchain) {
        if (l.script == null) continue;
        known.add(l.script);
        const mine = linkOwnName(l.script, scripts);
        if (mine !== null) known.add(mine);
      }
      for (const link of inChain)
        if (!known.has(link))
          gaps.push(
            `    ${link} — цепочка проверок его зовёт, а в объявлении звеньев его нет` +
              NEWLINE +
              "      значит про его инструмент на посадке не спросят",
          );
    }

    // Смотрится ВСЕГДА, краснеет только при снятом флаге посадки.
    //
    // Прежде секция была объявлена предупреждением и прогон не роняла никогда
    // — при том, что докладывает ровно то, чего у обвязки быть не должно:
    // звено цепочки объявлено, а инструмента под него нет. Её собственный
    // вывод говорит это прямым текстом: «поставленный без настройки проходит,
    // не проверив ничего».
    //
    // Оправдание было, но узкое: пока посадка идёт, пакеты ещё не поставлены,
    // и падать на этом значило бы падать на собственном незаконченном шаге.
    // Флаг посадки это и различает — тем же приёмом, каким соседняя сверка
    // различает несведённое семя.
    //
    // Найдено обходом «требование стояло, а инструмента не было»: рецепт
    // фальсификации на эту секцию не доходил ни до одной сверки, потому что
    // дойти было некуда.
    // Печатается ВСЕГДА, а не только при находках. Секция, которой в чистом
    // прогоне нет вовсе, не попадает ни в мета-сверку о корпусе, ни в разбор
    // фальсификации: подсаженную поломку тот приписать некуда, и рецепт на неё
    // докладывал «не дошла ни до одной сверки» с рождения.
    {
      // Связка проверок — ОДНА СТРОКА манифеста, приехавшая семенем целиком,
      // и данными она не является. Проект, снявший звено без предмета,
      // обязан вычеркнуть его и отсюда — а не вычеркнув, получает цепочку,
      // которая не доходит до первой команды: `npm run check` падает на
      // «Missing script», и падает НАВСЕГДА. Сверки при этом зелёные: они
      // спрашивают звенья по отдельности, а связку не читал никто.
      //
      // Замерено посадкой в проект на обычном JavaScript: звено типов снято
      // по инструкции, связка осталась семенной, прогон зелен, цепочка мертва.
      const chainCalls =
        typeof scripts.check === "string" ? scriptCallsIn(scripts.check) : [];
      const chainBroken = [];
      for (const one of chainCalls)
        if (scripts[one] == null)
          chainBroken.push(
            one +
              " — связка проверок зовёт команду, которой в манифесте нет: цепочка не доходит до первой",
          );
      {
        // Обратная сторона: живое звено, выпавшее из связки, перестаёт
        // спрашиваться вовсе — и молча. Состав связки объявлен СЕМЕНЕМ
        // манифеста, а не этим списком: он растёт вместе с цепочкой.
        const seedAt = shelfAt("seat/templates/package.json");
        const seedBody =
          seedAt === null || !existsSync(seedAt)
            ? null
            : readJson(seedAt, {}).scripts?.check;
        for (const piece of String(seedBody ?? "").split("&&")) {
          const one = piece.trim();
          const run = /^npm run ([^ ]+)/.exec(one);
          const name =
            run !== null ? run[1] : /^npm test( |$)/.test(one) ? "test" : null;
          if (name === null) continue;
          if (!linkHasSubject(name)) continue;
          const own = linkOwnName(name, scripts) ?? name;
          if (scripts[own] == null) continue;
          if (chainCalls.includes(own)) continue;
          chainBroken.push(
            own +
              " — звено живо и команда есть, а связка проверок его не зовёт: спрашивать его нечему",
          );
        }
      }

      // Конфиг СНЯТОГО звена остаётся, когда его инструмент служит живому.
      // Оговорка та же, что у пакетов, и следует из неё: пакет, названный
      // двумя звеньями, живёт, пока живо хотя бы одно, — а инструмент без
      // своей настройки не работает. Компилятор назван и у звена линта:
      // правила с типами держатся на нём и читают `tsconfig.json`.
      //
      // Замерено посадкой в проект на обычном JavaScript: звено типов снято
      // по инструкции вместе с конфигом, и живое звено линта стало падать
      // разбором на файлах САМОЙ ОБВЯЗКИ — «не найден в проекте компилятора».
      // Цепочка красная, чинить нечем: конфиг класть запрещала инструкция.
      const sharedConfigs = [];
      {
        const live = CONFIG.toolchain.filter((one) =>
          linkHasSubject(one.script),
        );
        const livePacks = new Set(live.flatMap((one) => one.packages ?? []));
        // Спрашивается СЕМЯ, а не настройка проекта. Звено, у которого
        // предмета нет, проект вправе вычеркнуть из своего списка звеньев
        // целиком, — и охранять его конфиг стало бы нечем: сверка смотрела
        // бы в список, из которого звено уже вычеркнуто.
        // Семя знает все звенья и их инструменты, и знание это не
        // зависит от того, что проект у себя оставил.
        //
        // Замерено повторной посадкой в проект на обычном JavaScript:
        // звено типов снято по инструкции, конфиг компилятора унесён
        // вместе с ним, и живое звено линта снова падало разбором на
        // файлах самой обвязки — при зелёном прогоне.
        const seedLinks = (() => {
          const at = shelfAt("seat/templates/graph.config.mjs");
          if (at === null || !existsSync(at)) return [];
          const body = readFileSync(at, "utf8");
          const from = body.indexOf("toolchain: [");
          if (from < 0) return [];
          const out = [];
          for (const piece of body.slice(from).split("    {")) {
            const pick = (key) => {
              const k = piece.indexOf(key + ": ");
              if (k < 0) return null;
              const q1 = piece.indexOf(String.fromCharCode(34), k);
              if (q1 < 0) return null;
              const q2 = piece.indexOf(String.fromCharCode(34), q1 + 1);
              return q2 < 0 ? null : piece.slice(q1 + 1, q2);
            };
            const name = pick("script");
            if (name === null) continue;
            const conf = pick("config");
            const packs = (() => {
              const k = piece.indexOf("packages: [");
              if (k < 0) return [];
              const end = piece.indexOf("]", k);
              const parts = piece.slice(k, end).split(String.fromCharCode(34));
              const out = [];
              for (let i = 1; i < parts.length; i += 2) out.push(parts[i]);
              return out;
            })();
            out.push({ script: name, config: conf, packages: packs });
          }
          return out;
        })();
        for (const link of seedLinks) {
          if (linkHasSubject(link.script)) continue;
          if (link.config == null) continue;
          const shared = (link.packages ?? []).filter((one) =>
            livePacks.has(one),
          );
          if (shared.length === 0) continue;
          if (existsSync(path.join(BASE, "..", link.config))) continue;
          sharedConfigs.push(
            link.config +
              " — конфиг снятого звена " +
              link.script +
              ", а его инструмент служит живому: " +
              shared.join(", "),
          );
        }
      }

      // Обвязка везёт СВОИ файлы кода — общий помощник, подготовку прогона —
      // и кладёт их в `src/`. Проект, чей компилятор смотрит в другие папки,
      // их не видит: звено типов их не проверяет, а звено линта с типами
      // падает РАЗБОРОМ — «файл не найден по настройке компилятора», — и
      // падает на файлах самой обвязки, а не на коде проекта.
      //
      // Замерено посадкой стенда с двумя деревьями: `include` объявлял
      // `client` и `server`, привезённые семена легли в `src`, и линт дал
      // три ошибки разбора подряд.
      const unseen = [];
      let seedCode = 0;
      {
        const at = path.join(BASE, "..", "tsconfig.json");
        const inc = existsSync(at) ? (readJson(at, {}).include ?? null) : null;
        const mapAt = shelfAt("seat/map.json");
        const seeds =
          mapAt === null || !existsSync(mapAt)
            ? []
            : (readJson(mapAt, {}).copy ?? []);
        const covers = (one, file) => {
          const bare = one.replace(/[/]+$/, "");
          if (file === bare || file.startsWith(bare + "/")) return true;
          if (!bare.includes("*")) return false;
          const head = bare.slice(0, bare.indexOf("*"));
          return file.startsWith(head);
        };
        if (inc !== null)
          for (const e of seeds) {
            if (!/[.][jt]sx?$/.test(e.to)) continue;
            // Конфиг в корне репозитория компилятору не принадлежит: его
            // читает свой инструмент, и в область типов он не входит.
            if (!e.to.includes("/")) continue;
            if (!existsSync(path.join(REPO, e.to))) continue;
            seedCode += 1;
            if (inc.some((one) => covers(one, e.to))) continue;
            unseen.push(
              e.to +
                " — файл кода приехал обвязкой, а `include` компилятора его не накрывает: звено линта с типами падает на нём разбором",
            );
          }
      }

      // Секция тестов в настройке сборщика требует, чтобы `defineConfig`
      // был взят из `vitest/config`, а не из `vite`: у сборщика в типе
      // такого поля нет вовсе. Привозит секцию обвязка, а импорт остаётся
      // проектным — и звено типов краснеет на СВОЕЙ ЖЕ настройке, сообщением
      // «'test' does not exist in type UserConfigExport», которое про тесты
      // не говорит ничего.
      //
      // Замерено посадкой стенда с раскладкой умолчания: слияние дописало
      // секцию в проектный конфиг, импорт остался прежним, компилятор встал.
      const viteDrift = [];
      let viteLooked = 0;
      // Спрашивается только там, где есть ЗВЕНО ТИПОВ: ломается от этого
      // именно компилятор. В проекте на обычном JavaScript импорт берут
      // откуда угодно — раннер читает секцию тестов в любом случае, и
      // требовать тут `vitest/config` значило бы краснеть на законном.
      if (linkHasSubject("typecheck")) {
        for (const name of ["vite.config.ts", "vite.config.js"]) {
          const at = path.join(BASE, "..", name);
          if (!existsSync(at)) continue;
          viteLooked += 1;
          const body = readFileSync(at, "utf8");
          if (!body.includes("test: {")) continue;
          if (body.includes("vitest/config")) continue;
          // Раннер второй версии даёт сборщику поле `test` и ссылкой на свои
          // типы — замерено компилятором на такой настройке. Для старших
          // версий это не мерено, и они спрашиваются по-прежнему.
          const runner = readJson(
            path.join(BASE, "..", "node_modules", "vitest", "package.json"),
            {},
          );
          const major = Number(String(runner.version ?? "0").split(".")[0]);
          if (
            major === 2 &&
            /\/\/\/\s*<reference\s+types=["']vitest["']\s*\/>/.test(body)
          )
            continue;
          viteDrift.push(
            name +
              " — секция тестов есть, а `defineConfig` взят не из `vitest/config`: у типа сборщика поля `test` нет",
          );
        }
      }
      // Подготовка прогона легла — раннер обязан её звать. Правило слияния
      // «дописать в конфиг раннера область сбора, и только её» оставляло
      // семя подготовки лежать мёртвым: реестр тестов называл его уборкой
      // между тестами, а раннер проекта с `globals: false` его не читал, и
      // вторая же отрисовка в одном файле нашла бы две копии узла. Замерено
      // посадкой руками в проект со своей секцией тестов.
      {
        const setupAt = shelfAt("seat/map.json");
        const setupSeed =
          setupAt !== null && existsSync(setupAt)
            ? (readJson(setupAt, {}).copy ?? []).find((e) =>
                e.from.endsWith("tests/setup.ts"),
              )
            : undefined;
        if (
          setupSeed !== undefined &&
          existsSync(path.join(REPO, setupSeed.to))
        ) {
          const runnerConf = [
            "vitest.config.ts",
            "vitest.config.js",
            "vitest.config.mts",
            "vite.config.ts",
            "vite.config.js",
            "vite.config.mts",
          ]
            .map((n) => path.join(BASE, "..", n))
            .filter((at) => existsSync(at))
            .map((at) => readFileSync(at, "utf8"))
            .find((body) => body.includes("test: {"));
          viteLooked += 1;
          if (
            runnerConf !== undefined &&
            !runnerConf.includes(setupSeed.to.replace(/^src\//, ""))
          )
            viteDrift.push(
              setupSeed.to +
                " — подготовка прогона лежит, а секция тестов её не называет в `setupFiles`: уборка между тестами не работает",
            );
          // Секции тестов нет НИ В ОДНОЙ настройке, а звено тестов обвязки
          // живое: раннер идёт умолчанием и подготовку не зовёт. Так выходило,
          // когда настройку сборщика под другим именем того же формата
          // откладывали в `.seat` до фазы 2 — тесты фазы 1 шли без области
          // сбора и без подготовки, и зелёными. Найдено посадкой руками в
          // проект с `vite.config.js`. У проекта со своим раннером звено
          // тестов не живое, и вопроса нет.
          const testLink = (
            readJson(shelfAt("seat/map.json") ?? "", {}).chainScripts ?? []
          ).find((e) => e.name === "test");
          const testLives =
            testLink?.recognise != null &&
            linkCalled(
              new RegExp(testLink.recognise),
              readJson(
                path.join(BASE, CONFIG.manifest ?? "../package.json"),
                {},
              ).scripts ?? {},
            );
          if (runnerConf === undefined && testLives)
            viteDrift.push(
              setupSeed.to +
                " — подготовка прогона лежит, звено тестов живое, а секции тестов нет ни в одной настройке сборщика: раннер идёт умолчанием и подготовку не зовёт",
            );
        }
      }
      checkHead("Настройка сборки знает про тесты", {
        n: viteLooked,
        unit: "настроек сборки",
      });
      console.log("  расхождений: " + viteDrift.length);
      for (const one of viteDrift) console.log("    " + one);
      checkHead("Привезённый код виден компилятору", {
        n: seedCode,
        unit: "файлов кода, привезённых обвязкой",
      });
      console.log("  вне области компилятора: " + unseen.length);
      for (const one of unseen) console.log("    " + one);

      // Строгость компилятора — там, где звено типов проверяет код.
      //
      // Половина планки стоит на строгости, и посадка дописывает её всегда.
      // Проверки у этого не было никакой: монорепозиторий раздаёт проверку
      // типов пакетам, строгость дописали в конфиг корня, а пакеты остались
      // при своей, и звено типов проверяло их мягче объявленного — зелёным.
      // Замерено посадкой руками в монорепозиторий.
      //
      // Конфиги берутся по тому, что звено ЗОВЁТ: `-p` и `--project` —
      // названный файл, иначе конфиг корня; конфиг-решение со ссылками — его
      // ссылки; делегирование пакетам — те же вызовы в каждом пакете. Опции
      // читаются вместе с тем, что конфиг продолжает. Набор флагов — из семени
      // конфига: всё включённое в нём, что строже умолчания.
      const strictGap = [];
      let strictLooked = 0;
      if (linkHasSubject("typecheck")) {
        const seedTs = shelfAt("seat/templates/tsconfig.json");
        const seedOpts =
          seedTs !== null && existsSync(seedTs)
            ? (parseJsonc(readFileSync(seedTs, "utf8"))?.compilerOptions ?? {})
            : {};
        const want = Object.entries(seedOpts)
          .filter(
            ([k, v]) =>
              v === true && /^(?:strict|exactOptional|no(?!Emit$))/.test(k),
          )
          .map(([k]) => k);
        for (const [one, opts] of typeCheckOptions()) {
          if (opts == null) continue;
          strictLooked += 1;
          const lax = want.filter((k) => opts[k] !== true);
          if (lax.length)
            strictGap.push(
              path.relative(REPO, one).split(path.sep).join("/") +
                " — звено типов проверяет по нему, а строгости семени нет: " +
                lax.join(", "),
            );
        }
      }
      checkHead("Строгость компилятора там, где проверяются типы", {
        n: strictLooked,
        unit: "конфигов компилятора, по которым идёт проверка типов",
      });
      console.log("  без строгости семени: " + strictGap.length);
      for (const one of strictGap) console.log("    " + one);
      checkHead("Конфиг снятого звена служит живому", {
        n: CONFIG.toolchain.length,
        unit: "звеньев цепочки",
      });
      console.log(
        "  снятых конфигов, нужных живому звену: " + sharedConfigs.length,
      );
      for (const one of sharedConfigs) console.log("    " + one);

      // Конвейер — ТА ЖЕ СВЯЗКА, что скрипт проверок, только написанная
      // однажды и живущая отдельно. Описание сборки на сервере, которое
      // собирает проект и не зовёт ни одного звена цепочки, даёт ворота,
      // не проверяющие ничего: зелёная галочка стоит, типы и тесты не
      // прогонялись. Планка требует обратного прямо — раздел U, «порядок
      // ворот от дешёвых к дорогим», — а ловца у требования не было.
      //
      // Замерено посадкой стенда с описанием на сервере: единственный шаг
      // конвейера — сборка, и прогон об этом молчал.
      const ciFiles = [];
      {
        const roots = [".github/workflows", ".circleci"];
        const loose = [
          ".gitlab-ci.yml",
          ".drone.yml",
          "azure-pipelines.yml",
          "Jenkinsfile",
          "bitbucket-pipelines.yml",
          ".woodpecker.yml",
        ];
        const at = (one) => path.join(BASE, "..", one);
        for (const one of loose) if (existsSync(at(one))) ciFiles.push(one);
        for (const dir of roots) {
          if (!existsSync(at(dir))) continue;
          for (const name of readdirSync(at(dir))) {
            const full = path.join(at(dir), name);
            if (statSync(full).isDirectory()) continue;
            ciFiles.push(dir + "/" + name);
          }
        }
      }
      const ciMute = [];
      for (const one of ciFiles) {
        const body = readFileSync(path.join(BASE, "..", one), "utf8");
        const names = CONFIG.toolchain
          .map((link) => link.script)
          .filter((name) => name != null)
          .filter((name) => linkHasSubject(name))
          .filter(
            (name) => scripts[linkOwnName(name, scripts) ?? name] != null,
          );
        // Звено зовут ЕГО ИМЕНЕМ В ПРОЕКТЕ, а не семенным: конвейер проекта
        // пишет `npm run types`, если звено типов у него `types`. Прежде
        // искалось семенное имя, и конвейер, зовущий звено типов проекта,
        // объявлялся не зовущим ни одного — замерено посадкой руками. Звено
        // тестов менеджер зовёт и сокращённо, `npm test`.
        const called = new Set(
          body
            .split(NEWLINE)
            .flatMap((line) =>
              scriptCallsIn(line.replace(/^\s*(-\s*)?(run:\s*)?/, "")),
            ),
        );
        const calls = names.filter((name) => {
          const own = linkOwnName(name, scripts) ?? name;
          return body.includes("run " + own) || called.has(own);
        });
        if (body.includes("run check") || calls.length > 0) continue;
        // Конвейер — устройство ПРОЕКТА, а состояние проекта в рубеж
        // посадки не входит: она ставит инструмент, а не чинит код. Строка
        // реестра, открытая под эту находку, снимает красное и оставляет
        // её на виду — тот же порядок, что у красного звена цепочки.
        if (overOpen("Конвейер зовёт проверки", 1) === 0) continue;
        ciMute.push(
          one +
            " — описание сборки на сервере не зовёт ни связку проверок, ни одно звено цепочки: ворота стоят и не проверяют ничего. Завести строку реестра открытой либо позвать цепочку",
        );
      }
      checkHead("Конвейер зовёт проверки", {
        n: ciFiles.length,
        unit: "описаний сборки на сервере",
      });
      console.log("  не зовут цепочку: " + ciMute.length);
      for (const one of ciMute) console.log("    " + one);
      checkHead("Связка проверок зовёт живые звенья", {
        n: chainCalls.length,
        unit: "вызовов в связке проверок",
      });
      console.log("  расхождений: " + chainBroken.length);
      for (const one of chainBroken) console.log("    " + one);
      checkHead(
        "Инструменты звеньев на месте (предупреждение, прогон не роняет)",
        {
          n: CONFIG.toolchain.length,
          unit: "звеньев цепочки",
        },
      );
      console.log("  звеньев цепочки без инструмента: " + gaps.length + "");
      for (const g of gaps) console.log(g);
      if (elsewhere.length)
        console.log(
          "  у проекта своё устройство, не пробел: " +
            elsewhere.join(", ") +
            " — имя звена занято своей работой либо нет ведущего звена; расхождение с умолчанием держит план перехода",
        );
      if (gaps.length) {
        console.log(
          "  Поставить и настроить — шаг 6 фазы 1 посадки, «Поставить пакеты».",
        );
        console.log(
          "  Инструмент ставится вместе со своей настройкой, одной правкой:",
        );
        console.log("  поставленный без неё проходит, не проверив ничего.");
      }
    }
  }

  // Обещания без опоры: раздел объявлен — значит собираемо всё, что в нём.
  // Прямая сторона у этой формы уже есть (`open` собирает по слову); здесь
  // обратная: запись, написанная мимо словаря, из сводки выпадает молча.
  const mutePromises = [];
  let promiseRows = 0;
  if (CONFIG.promises != null) {
    const at = path.join(BASE, CONFIG.promises.file);
    if (!existsSync(at))
      mutePromises.push(`файла нет: ${CONFIG.promises.file}`);
    else {
      const lines = readFileSync(at, "utf8").split(NEWLINE);
      const from = lines.findIndex((l) => l.trim() === CONFIG.promises.heading);
      promiseRows = lines.filter((l) => /^\s*Держится:/.test(l)).length;
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
  checkHead("Объявленные области существуют", {
    n: scopePaths,
    unit: "адресов объявленных областей",
  });
  console.log(`  ведут в никуда: ${goneScope.length}`);
  for (const g of goneScope) console.log("    " + g);

  checkHead("Обещания без опоры собираются сводкой", {
    n: promiseRows,
    unit: "записей сводки обещаний",
  });
  console.log(`  записей мимо словаря: ${mutePromises.length}`);
  for (const m of mutePromises) console.log("    " + m);

  // 13h. имена связей через DOM и CSS существуют в коде.
  const domDrift = [];
  let domNames = 0;
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
      domNames = text.filter((l) => /^\|/.test(l.trim())).length;
      for (const f of [...files, ...styleFiles])
        for (const line of readFileSync(f, "utf8").split(NEWLINE))
          for (const hit of line.matchAll(/--[a-z-]+|data-[a-z-]+/g))
            if (!inComment(line, hit.index)) liveDomNames.add(hit[0]);
      // Класс живёт в двух формах: в листе стилей он с точкой, в контракте —
      // строкой в кавычках. Обе засчитываются как одно имя.
      for (const f of styleFiles)
        for (const one of cssClasses(readFileSync(f, "utf8")))
          liveDomNames.add("." + one);
      for (const f of files.filter((one) => !isTestPath(one)))
        for (const line of readFileSync(f, "utf8").split(NEWLINE))
          for (const hit of line.matchAll(CODE_NAME))
            if (!inComment(line, hit.index))
              liveDomNames.add("." + (hit[1] ?? hit[2] ?? hit[3]));
      for (const heading of CONFIG.domTables.headings) {
        const from = text.indexOf(heading);
        if (from < 0) {
          domDrift.push(`таблицы нет: «${heading}»`);
          continue;
        }
        const { rows: domRows, problem: domProblem } = tableAfter(text, from);
        if (domProblem !== null) {
          domDrift.push(`«${heading}»: ${domProblem}`);
          continue;
        }
        for (const row of domRows) {
          const named = [
            ...row
              .split("|")[1]
              .matchAll(/`(--[a-z-]+|data-[a-z-]+|\.[A-Za-z][\w-]*)`/g),
          ].map((hit) => hit[1]);
          // Адреса, названные ТОЙ ЖЕ строкой: кто объявляет, кто читает.
          // Строка, не называющая файлов, проверяется как прежде.
          const where = [...row.matchAll(/`([^`]+)`/g)]
            .map((hit) => hit[1])
            .filter((one) => one.includes("/") && CODE_OR_STYLE.test(one))
            .map((one) => path.join(BASE, "..", one))
            .filter((one) => existsSync(one));
          for (const name of named) {
            if (!liveDomNames.has(name)) {
              domDrift.push(`названо в таблице, нет в коде: ${name}`);
              continue;
            }
            // Имя живо где-то — этого мало. Половина согласованного
            // переименования оставляет его живым только у читателя, и связь
            // рвётся при зелёном прогоне.
            for (const at of where) {
              const body = readFileSync(at, "utf8").split(NEWLINE);
              // Класс в листе стилей пишется с точкой, а в контракте — без
              // неё, строкой в кавычках. Ищутся обе формы: иначе строка
              // таблицы краснела бы на законной записи контракта.
              const forms = name.startsWith(".")
                ? [name, name.slice(1)]
                : [name];
              const here = body.some((line) =>
                forms.some((one) => {
                  // Имя ищется ЦЕЛИКОМ, а не вхождением: `.messageEnterActive`
                  // входит подстрокой в `.messageEnterActiveXX`, и сверка
                  // отвечала «имя на месте» о переименованном классе.
                  let at = line.indexOf(one);
                  while (at >= 0) {
                    const after = line[at + one.length] ?? "";
                    const before = line[at - 1] ?? "";
                    const tail = /[A-Za-z0-9_-]/.test(after);
                    const head = /[A-Za-z0-9_-]/.test(before);
                    if (!tail && !head && !inComment(line, at)) return true;
                    at = line.indexOf(one, at + 1);
                  }
                  return false;
                }),
              );
              if (!here)
                domDrift.push(
                  `${name} — названо строкой таблицы, но в ${rel(at)} его нет`,
                );
            }
          }
        }
      }
    }
  }
  // Обратная сторона: ЧУЖАЯ связь, найденная на диске, обязана быть
  // названа таблицей. Прежде её не было вовсе, и новое имя, заведённое
  // завтра, не видел никто: предмет спрашивался ровно один раз — пока поле
  // пусто. Объявили таблицу — и связь, приехавшая с новым компонентом,
  // проходила молча.
  //
  // Заводится только на УЗКИХ признаках. Довод «список врал бы» верен для
  // имён классов: там это любая строка кода. Переменная, не объявленная ни
  // одним нашим листом, и атрибут, которого нет в нашем коде, перечислимы
  // полностью.
  const domMissed = [];
  if (CONFIG.domTables != null) {
    const at = path.join(BASE, CONFIG.domTables.file);
    const body = existsSync(at) ? readFileSync(at, "utf8") : "";
    const { vars, attrs } = foreignLinks();
    for (const one of [...vars, ...attrs])
      if (!body.includes(one.name))
        domMissed.push(
          one.name + " — чужая связь в " + one.where + ", таблицей не названа",
        );
  }
  // 13i. Имена классов, названные кодом, существуют в листе стилей.
  //
  // Связь кода с листом модуля стилей НЕ ВИДИТ НИКТО. Объявление, которое
  // привозит сборщик, — индексная подпись:
  //
  //   declare module "*.module.scss" {
  //     const classes: { readonly [key: string]: string };
  //   }
  //
  // то есть `styles.track`, `styles.trrack` и `styles.чегоТоНет` проходят
  // компилятор все три. Удалили класс из листа — обращение вернёт `undefined`,
  // элемент отрисуется без стилей, и не шелохнётся ни одна проверка: ни типы,
  // ни линт, ни тесты, ни сборка.
  //
  // Это СВОЁ дублирование через границу языков (`quality.md`, критерий
  // `C7-бис`), и свести его к одному источнику конструкцией нельзя: CSS не
  // умеет импортировать типы, а объявление сборщика набора имён не содержит.
  // Генератор слепков это чинит, но он сторонний пакет, обвязкой не меренный, и
  // умолчанием не объявляется. Значит остаётся третий исход критерия — держать
  // сверкой, и вот она.
  //
  // Сторон у сверки две, потому что имена доходят до разметки двумя путями.
  //
  // ПЕРВАЯ — обращения в файле, который лист импортирует. Берётся привязка
  // импорта и её местные псевдонимы: эталонная раскладка подмешивает внешнюю
  // карту (`const classNames = merge(styles, className)`), и обращения идут уже
  // к псевдониму. Дальше одного уровня разбор не идёт намеренно: за пределами
  // файла имя едет пропом, и проследить его текстом нельзя — этот путь
  // закрывает вторая сторона.
  //
  // ВТОРАЯ — именованные ключи КАРТЫ КЛАССОВ, объявленной рядом с листом. В
  // эталонной раскладке это она и есть: публичная поверхность перекраски,
  // через которую имена уходят в соседние файлы и к потребителю. Ключи её
  // написаны руками и обязаны существовать в листе.
  //
  // Имя, названное таблицей связей, законно: это объявленная ЧУЖАЯ сторона, и
  // сводить её не с чем.
  const classDrift = [];
  {
    const classesOf = (sheets) => {
      const out = new Set();
      for (const f of sheets)
        for (const one of cssClasses(readFileSync(f, "utf8"))) out.add(one);
      return out;
    };
    // Для ключей карты классов набор берётся по ПАПКЕ: карта объявлена
    // рядом с листом, а импортирует лист соседний файл той же папки.
    const nearDir = (dir) => {
      const sheets = styleFiles.filter((f) => path.dirname(f) === dir);
      for (const f of files)
        if (path.dirname(f) === dir)
          for (const m of codeOf(readFileSync(f, "utf8")).matchAll(
            STYLE_IMPORT,
          )) {
            const at = norm(path.resolve(dir, m[2]));
            if (existsSync(at) && !sheets.includes(at)) sheets.push(at);
          }
      return classesOf(sheets);
    };
    const foreignNamed = new Set();
    if (CONFIG.domTables != null) {
      const at = path.join(BASE, CONFIG.domTables.file);
      if (existsSync(at))
        for (const m of readFileSync(at, "utf8").matchAll(/`([^`]+)`/g))
          foreignNamed.add(m[1]);
    }

    // Ключ карты классов: строка вида `имя?: string`. Индексная подпись сюда не
    // попадает — у неё в позиции имени скобка.
    const MAP_KEY = /^\s{2,}(\w+)\??:\s*string/gm;
    const LITERAL = /"(\w+)"/g;

    for (const f of files) {
      if (isTest(f) || f.endsWith(".d.ts")) continue;
      const body = codeOf(readFileSync(f, "utf8"));
      const dir = path.dirname(f);

      // --- сторона первая: обращения к привязке импорта и её псевдонимам ---
      const bindings = [];
      const sheets = [];
      for (const m of body.matchAll(STYLE_IMPORT)) {
        bindings.push(m[1]);
        const at = norm(path.resolve(dir, m[2]));
        if (existsSync(at)) sheets.push(at);
      }
      if (bindings.length) {
        // Псевдоним — местная константа, в объявлении которой стоит
        // ИСХОДНАЯ привязка. Цепочкой они не собираются: найденный
        // псевдоним, ставший зацепкой для следующего, за два шага утаскивал
        // в список кэш и ссылку на него, и обращения к методам словаря
        // объявлялись расхождением. Замерено на эталонном проекте.
        const seeds = [...bindings];
        for (const chunk of body.split(";")) {
          if (chunk.length > 400) continue;
          const named = /const\s+(\w+)\s*=/.exec(chunk);
          if (named === null) continue;
          // Смотрим ТОЛЬКО часть от самого объявления: кусок, нарезанный
          // по точке с запятой, начинается хвостом предыдущего оператора,
          // и упомянутая там привязка утаскивала в псевдонимы соседнюю
          // ссылку. Замерено на эталонном проекте.
          const tail = chunk.slice(named.index);
          if (seeds.some((b) => new RegExp("\\b" + b + "\\b").test(tail)))
            bindings.push(named[1]);
        }
        const allowed = new Set([...classesOf(sheets), ...foreignNamed]);
        for (const b of new Set(bindings))
          for (const m of body.matchAll(
            new RegExp("\\b" + b + "\\.(\\w+)", "g"),
          ))
            if (!allowed.has(m[1]))
              classDrift.push(
                rel(f) +
                  ": `" +
                  b +
                  "." +
                  m[1] +
                  "` — класса нет в листе, который этот файл импортирует",
              );
      }

      // --- сторона вторая: именованные ключи карты классов ---
      const own = nearDir(dir);
      if (own.size === 0) continue;
      // Тело в фигурных скобках читается ДО ЗАКРЫВАЮЩЕЙ СКОБКИ в начале
      // строки. Прежде захват кончался «на скобке ИЛИ на точке с запятой», и
      // нежадный разбор останавливался на первой же — на индексной подписи,
      // которая в эталонной карте стоит первой строкой. Именованные ключи шли
      // после неё и не читались ни разу.
      const blocks = [
        ...body.matchAll(/(?:interface|type)\s+(\w+)[^{;]*\{([\s\S]*?)^\}/gm),
      ].map((m) => ({ name: m[1], body: m[2] }));
      // Псевдоним-объединение скобок не имеет и кончается точкой с запятой.
      const unions = [...body.matchAll(/type\s+(\w+)\s*=\s*([^;{]*);/g)].map(
        (m) => ({ name: m[1], body: m[2] }),
      );
      // Признак карты классов двойной. Соглашение об имени покрывает
      // объединение литералов, у которого строения нет. Строение — индексная
      // подпись строки на строку — переживает переименование типа, а имя
      // нет: переименовали бы, и покрытие пропало бы молча.
      const isMap = (one) =>
        /ClassMap|ClassNames?|ClassNameKeys|ClassNameMap/.test(one.name) ||
        /\[\s*key\s*:\s*string\s*\]\s*:\s*string/.test(one.body);
      for (const one of [...blocks, ...unions].filter(isMap)) {
        const keys = new Set();
        for (const m of one.body.matchAll(MAP_KEY)) keys.add(m[1]);
        for (const m of one.body.matchAll(LITERAL)) keys.add(m[1]);
        for (const k of keys)
          if (!own.has(k) && !foreignNamed.has(k))
            classDrift.push(
              rel(f) + ": ключ карты классов `" + k + "` в листе не объявлен",
            );
      }
    }
  }
  checkHead("Имена классов из кода есть в листе стилей", {
    n: files.length,
    unit: "файлов кода",
  });
  console.log("  расхождений: " + classDrift.length);
  for (const d of classDrift) console.log("    " + d);

  // Сторона обратная: класс объявлен листом, и не спрашивает его никто.
  //
  // Первая сторона ловит имя, которого нет в листе, — оно даёт `undefined` в
  // разметке. Эта ловит имя, которого нет в коде, и оно не даёт ничего: лист
  // растёт мёртвыми правилами, каждое из которых читается как живое. Правка
  // такого правила — работа впустую, а удаление соседнего — поломка.
  //
  // Признак широкий: имя ищется текстом по всему коду и тестам. Класс,
  // применённый строкой, через карту, из соседнего файла или из теста,
  // найдётся — не найдётся только никем не спрошенный. Объявленная чужая
  // сторона законна: её имена перечислены таблицей связей.
  const classDead = [];
  let classesSeen = 0;
  {
    const asked = [];
    for (const f of files)
      if (existsSync(f)) asked.push(readFileSync(f, "utf8"));
    const haystack = asked.join(NEWLINE);
    // Объявленная чужая сторона берётся из таблицы связей — тем же чтением,
    // что и у первой стороны: имена в обратных кавычках.
    const foreign = new Set();
    if (CONFIG.domTables != null) {
      const atDom = path.join(BASE, CONFIG.domTables.file);
      if (existsSync(atDom))
        for (const m of readFileSync(atDom, "utf8").matchAll(/`([^`]+)`/g))
          foreign.add(m[1]);
    }
    for (const sheet of styleFiles) {
      const text = readFileSync(sheet, "utf8");
      for (const name of cssClasses(text)) {
        classesSeen += 1;
        if (foreign.has(name)) continue;
        // Имя, встреченное в коде хоть раз и хоть как, считается спрошенным.
        // Граница слова обязательна: без неё `button` нашёлся бы внутри
        // `buttonGroup`, и мёртвый класс прошёл бы как живой.
        const edge = new RegExp(
          "\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
        );
        if (edge.test(haystack)) continue;
        classDead.push(
          rel(sheet) + ": класс `" + name + "` не спрашивает ни один файл",
        );
      }
    }
  }
  // Мёртвое правило в листе живого проекта снимает правка кода, а не посадка:
  // до неё его держит открытая строка реестра, строка на класс.
  const deadOpen = Math.min(
    classDead.length,
    openFindings().get("Класс из листа стилей спрошен кодом") ?? 0,
  );
  checkHead("Класс из листа стилей спрошен кодом", {
    n: classesSeen,
    unit: "имён классов в листах",
  });
  console.log("  расхождений: " + (classDead.length - deadOpen));
  if (deadOpen > 0)
    console.log("  держатся открытыми строками реестра: " + deadOpen);
  for (const d of classDead.slice(deadOpen))
    console.log(
      "    " +
        d +
        ". Убрать из листа либо объявить чужой стороной в таблице связей",
    );

  // 13j. Отступление от схемы стилизации объявлено решением.
  //
  // Схема — умолчание обвязки: компонент импортирует СВОЙ лист модулем, а карта
  // классов вызывающего подмешивается поверх. Живой проект, написанный до
  // посадки, часто устроен иначе — компонент своего листа не имеет и получает
  // весь свой вид пропом.
  //
  // Это законное устройство, и переводить его никто не вправе. Но у него есть
  // цена, и молчаливой она быть не должна: связь кода с листом проходит через
  // границу модуля, импорта между ними нет, и инструмент разбирает её хуже —
  // очерченная область узла листа не содержит, радиус правки листа не
  // вычисляется, а сверка имён классов видит только ключи типа карты.
  //
  // Поэтому спрашивается не перевод, а ЗАПИСЬ: отступление от умолчания — решение
  // с причиной в реестре, иначе следующая сессия примет его за недосмотр и
  // «починит» обратно. Записали — зелено навсегда, и перевод идёт отложенным, по
  // одному компоненту, когда до него дойдут руки. Шагом перехода он не является:
  // переход меняет обвязку, а перевод меняет код проекта.
  //
  // Признак отступления: файл объявляет карту классов ИЛИ принимает проп с
  // классами — и при этом не импортирует ни одного листа модуля. Файл без карты
  // и без пропа схемы не касается вовсе.
  const schemeStray = [];
  // Реестр решений адресуется полем `decisions` — он есть у каждого
  // посаженного проекта. Поле `adr` — про адресуемость отдельных решений
  // якорями, и его пустота не значит, что решений негде записать: привязка к
  // нему оставляла сверку немой ровно там, где отступление и живёт.
  const decidedAt =
    CONFIG.decisions == null ? null : path.join(BASE, CONFIG.decisions);
  if (decidedAt !== null) {
    const decided = existsSync(decidedAt)
      ? readFileSync(decidedAt, "utf8")
      : "";
    // Единица — ПАПКА компонента: в ней и он сам, и его тип, и его лист.
    // Пофайловый разбор называл файл типов — адрес, по которому чинить
    // нечего, потому что лист импортирует не тип, а компонент рядом.
    const byDir = new Map();
    for (const f of files) {
      if (isTest(f) || f.endsWith(".d.ts")) continue;
      const dir = path.dirname(f);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(f);
    }
    for (const [dir, kin] of byDir) {
      let ownSheet = false;
      let takesMap = false;
      for (const f of kin) {
        const body = codeOf(readFileSync(f, "utf8"));
        STYLE_IMPORT.lastIndex = 0;
        if (STYLE_IMPORT.test(body)) ownSheet = true;
        STYLE_IMPORT.lastIndex = 0;
        // Карта классов узнаётся так же, как в соседней сверке: по строению
        // с индексной подписью либо по соглашению об имени.
        if (
          /\[\s*key\s*:\s*string\s*\]\s*:\s*string/.test(body) ||
          // Объявить карту классов можно не только типом: проект, пишущий
          // контракт СХЕМОЙ, объявляет её обычной константой. Пока здесь
          // стояли только interface и type, такой проект был для сверки
          // невидим, и отступление от схемы стилизации молчало ровно там, где
          // оно самое сильное. Замерено на стенде, объявляющем контракт через
          // zod, — а zod обвязка везёт с собой сама.
          /(?:interface|type|const|let|var)\s+\w*(?:ClassMap|ClassNames?|ClassNameKeys|ClassNameMap)\w*\b/.test(
            body,
          )
        )
          takesMap = true;
      }
      // Папка без КОМПОНЕНТА схемы не касается: набор объявлений публичного
      // контракта тоже называет карту классов, но не рисует ничего и листа
      // иметь не должен. Замерено на эталонном проекте: единственным ложным
      // срабатыванием была ровно такая папка.
      const hasComponent = kin.some((f) => /[.](tsx|jsx)$/.test(f));
      if (ownSheet || !takesMap || !hasComponent) continue;
      const at = rel(dir);
      if (decided.includes(at)) continue;
      schemeStray.push(at);
    }
  }
  // 13k. Новый узел лежит по раскладке.
  //
  // Умолчание обвязки: `app` — корень композиции, `components/<Имя>` — папка
  // на компонент, `shared/<область>` — общее областями. Прежде про раскладку
  // не было ни правила, ни сверки, и сессия выбирала её вкусом задачи:
  // приложение из одной кнопки получило папку компонента рядом с корневым
  // компонентом, потому что задача была маленькая.
  //
  // Сверка одна на оба случая. Совпадающий с умолчанием проект держит ноль
  // файлов вне слоёв — положили один мимо, стало красным. Разложенный иначе
  // держит их сотни, и спрашивается с него не перевод, а ЗАПИСЬ: отступление
  // от умолчания — решение с ценой, иначе следующая сессия примет чужую
  // раскладку за недосмотр и начнёт «чинить».
  //
  // Тесты не считаются: их место держит своя сверка, и два правила об одном
  // предмете разошлись бы.
  const layoutStray = [];
  let layoutSaid = null;
  {
    const decidedAt2 =
      CONFIG.decisions == null ? null : path.join(BASE, CONFIG.decisions);
    const decided2 =
      decidedAt2 !== null && existsSync(decidedAt2)
        ? readFileSync(decidedAt2, "utf8")
        : "";
    // Регистр не спрашивается: слова пишут в начале предложения с заглавной,
    // и посадка начисто на этом и споткнулась — решение записано, сверка его
    // не увидела.
    if (decided2.toLowerCase().includes("раскладка проекта"))
      layoutSaid = "отступление объявлено решением: раскладка проекта своя";
    else {
      // Слой УЗЛОВ берётся из объявления, а не из умолчания: проект уже
      // сказал обвязке, где они лежат, полем componentsAt — им пользуются и
      // сверка про README, и область мутационного прогона. Пока здесь стояло
      // зашитое components, проект со своим именем слоя получал находку на
      // каждом файле узла и ответ «место по умолчанию — components», то есть
      // обвязка переспрашивала то, что ей уже объявили.
      const LAYERS = [
        new RegExp("^app/"),
        ...(CONFIG.componentsAt ?? ["components"]).map(
          (one) => new RegExp("^" + one + "/[^/]+/"),
        ),
        new RegExp("^shared/[^/]+/"),
      ];
      for (const f of [...files, ...styleFiles]) {
        // Объявления типов принадлежат проекту, а не слою: их кладут в
        // корень исходников, и сборщик ищет их там.
        if (isTest(f) || f.endsWith(".d.ts")) continue;
        const r = rel(f);
        if (LAYERS.some((re) => re.test(r))) continue;
        // У проекта со СПИСКОМ деревьев адрес пишется от общего родителя, а
        // слои приложения и общего живут внутри каждого дерева. Файл узнаётся
        // и по адресу внутри своего дерева. Прежде помощник слияния карт
        // классов, который обвязка кладёт в `src/shared/`, в любом проекте с
        // несколькими деревьями объявлялся лежащим вне раскладки. Замерено
        // посадкой руками в монорепозиторий.
        const tree = SRC_ROOTS.find((one) =>
          norm(f).startsWith(norm(one) + "/"),
        );
        if (
          tree !== undefined &&
          LAYERS.some((re) =>
            re.test(path.relative(tree, f).split(path.sep).join("/")),
          )
        )
          continue;
        layoutStray.push(r);
      }
      if (layoutStray.length === 0) layoutSaid = "вне объявленных слоёв: 0";
    }
  }
  // 13l. У папки компонента есть README.
  //
  // Компонент переносят копированием папки, и первое, что открывает пришедший
  // к ней снаружи, — README: зачем она, что берут, что тянется следом, чего
  // делать нельзя. Свод описывал этот вид документа и не требовал его нигде.
  //
  // Спрашивается только с папок компонентов: у слоя приложения читатель
  // снаружи один — сам проект, — а общие области описывает их собственный
  // README, и требовать его с каждой подпапки значит плодить пустые файлы.
  //
  // Слой компонентов брался по образцу `components/<Имя>/` — по раскладке
  // УМОЛЧАНИЯ. Проект, разложенный иначе, ни одной такой папки не имеет, и
  // сверка печатала «без README: 0»: зелено при том, что проверено ничего.
  // Замерено третьим кругом проб — новый компонент заведён по своей
  // раскладке, без документации, и сверка его не увидела; пять стендов из
  // семи разложены не по умолчанию, и во всех пяти она молчала с первого дня.
  //
  // Поэтому слой объявляется полем настройки, как объявляются папки тестов
  // вне корня и проза вне корпуса. Необъявленный при своей раскладке слой
  // сверка называет СВОЕЙ СЛЕПОТОЙ и роняет прогон: зелёное «я ничего не
  // проверила» и есть тот дефект, который она обязана ловить.

  // Узел, тянущий за собой СОСЕДА. Единица переноса компонента — его папка
  // целиком, и отсюда следует, что взять его отдельно можно. Импорт из
  // папки одного узла в папку другого это ломает: переносишь один — тянешь
  // второго, а узнаёшь об этом, когда перенос уже не собрался.
  //
  // Запрета здесь нет: композиция узлов законна, и в приложении из многих
  // компонентов она неизбежна. Спрашивается НАЗВАНО ЛИ — документ узла
  // отвечает на вопрос «что тянется следом» по своей же форме, и сосед
  // обязан быть в нём назван. Пока документа нет вовсе, за него отвечает
  // долг посадки `debt.readme`, и эта сверка молчит.
  //
  // Заведено по разбору с разработчиком: компоненты проектируются по
  // одному, а собираются в приложение, и обвязка обязана держать сборку
  // штатно, а не потому, что повезло.
  const pulled = [];
  const pullSeen = [];
  let pullLooked = 0;
  {
    const layers = CONFIG.componentsAt ?? ["components"];
    const nodeOf = (f) => {
      for (const layer of layers) {
        const m = new RegExp("^" + layer + "/([^/]+)/").exec(rel(f));
        if (m !== null) return layer + "/" + m[1];
      }
      return null;
    };
    for (const [from, targets] of importsOf) {
      const here = nodeOf(from);
      if (here === null) continue;
      for (const to of targets) {
        const there = nodeOf(to);
        if (there === null || there === here) continue;
        pullLooked += 1;
        const doc = norm(path.join(ROOT, here, "docs", "README.md"));
        // Пара называется ВСЕГДА, даже когда документа ещё нет: строение
        // приложения — кто кого тянет — видно из графа импортов и без
        // чтения кода, и прятать его до перехода незачем. Находкой это
        // становится только при живом документе, который молчит.
        pullSeen.push(here + " → " + there);
        if (!existsSync(doc)) continue;
        if (readFileSync(doc, "utf8").includes(there)) continue;
        pulled.push(
          here +
            " тянет за собой " +
            there +
            ", а его README об этом не говорит: взять узел отдельно нельзя, и узнают это переносом",
        );
      }
    }
  }
  checkHead("Узел, тянущий соседа, назван документом", {
    n: pullLooked,
    unit: "импортов из узла в узел",
  });
  console.log("  не названо документом: " + pulled.length);
  for (const one of pulled) console.log("    " + one);
  if (pullSeen.length)
    console.log(
      "  узлы, тянущие соседей: " + [...new Set(pullSeen)].join(", "),
    );
  const noReadme = [];
  let readmeBlind = null;
  let componentDirs = 0;
  {
    const layers = CONFIG.componentsAt ?? ["components"];
    const seen = new Set();
    for (const f of [...files, ...styleFiles])
      for (const layer of layers) {
        const m = new RegExp("^" + layer + "/([^/]+)/").exec(rel(f));
        if (m === null) continue;
        seen.add(layer + "/" + m[1]);
      }
    componentDirs = seen.size;
    for (const one of seen) {
      const at = norm(path.join(ROOT, one, "docs", "README.md"));
      if (!docFiles.includes(at)) noReadme.push(rel(at));
    }
    // Своя раскладка, а не просто «слоёв нет»: проект умолчания без
    // компонентов не слеп — ему нечего смотреть, и это разные состояния.
    const ownLayout =
      layoutSaid !== null && layoutSaid.includes("раскладка проекта своя");
    if (seen.size === 0 && ownLayout && CONFIG.componentsAt == null)
      readmeBlind =
        "раскладка своя, а слой компонентов не объявлен полем `componentsAt` — сверка не смотрит никуда";
  }
  // 13m. Язык внутри корня исходников.
  //
  // Правило механическое и давно записано: внутри корня исходников —
  // английский, вне — русский. Ловца у него не было ни одного, и нарушено оно
  // оказалось во всех файлах приложения, написанного под этой обвязкой, —
  // сразу и целиком, при восьмидесяти зелёных сверках.
  //
  // Признак грубый и потому надёжный: буква кириллицы в строке комментария
  // либо в строковом литерале. Имена не ловятся — имя с кириллицей не
  // собирается, и сверка дублировала бы компилятор.
  //
  // Вложенные файлы правил под это не подпадают: они разговор о коде, а не
  // код, и корпус сверки — исходники и листы стилей, а не проза рядом с ними.
  const wrongTongue = [];
  {
    const CYR = /[\u0400-\u04FF]/;
    for (const f of [...files, ...styleFiles]) {
      const rows = readFileSync(f, "utf8").split(NEWLINE);
      for (let i = 0; i < rows.length; i++) {
        const line = rows[i].trim();
        // Спрашивается ТОЛЬКО комментарий. Строковый литерал не спрашивается:
        // текст для пользователя и текст диагностики машине неотличимы, а
        // первый — предмет раздела об интернационализации, а не языковой
        // границы. Замерено задачей от разработчика: он попросил кнопку с
        // русской подписью, и сверка объявила нарушением выполненную просьбу.
        const isComment =
          line.startsWith("//") ||
          line.startsWith("/*") ||
          line.startsWith("*");
        if (!isComment || !CYR.test(line)) continue;
        wrongTongue.push(rel(f) + ":" + (i + 1));
      }
    }
  }
  checkHead("Язык внутри корня исходников", {
    n: files.length + styleFiles.length,
    unit: "файлов кода и стилей",
  });
  console.log(
    "  строк не на языке кода: " + wrongTongue.length + debtTail("tongue"),
  );
  debtNote("tongue", wrongTongue.length);
  // Долг обещан доктриной с тех пор, как сверка заведена, а поля не было ни
  // одного: живой проект с русскими комментариями — обычный случай у этой
  // обвязки — краснел навсегда, и свод запрещает это сам. Найдено посадкой
  // библиотеки, чей лист стилей объясняется по-русски.
  const tongueSaid = debtList("tongue", wrongTongue);
  for (const one of tongueSaid.slice(0, 20))
    console.log(
      "    " +
        one +
        " — комментарий на русском, а внутри корня исходников пишут по-английски",
    );
  if (tongueSaid.length > 20)
    console.log("    …и ещё " + (tongueSaid.length - 20));
  // 13l-бис. Документы компонента лежат в его `docs/`.
  //
  // Вся проза компонента лежит в `docs/`, и дверь — `docs/README.md`. В корне
  // папки прозы нет ни строчки: иначе она перемешивается с кодом, и папка
  // тяжёлого компонента превращается в свалку, где не видно ни кода, ни
  // документов.
  //
  // Спрашивается со всего поддерева компонента, а не с его корня: у крупного
  // компонента документы есть в каждой значимой подпапке, и это правильно — а
  // вот документ РЯДОМ с ними правильным не становится.
  //
  // Слой компонентов брался зашитым образцом `^components/` — то есть по
  // раскладке умолчания, — и в проекте, разложенном иначе, сверка не смотрела
  // никуда и печатала ноль. Тот же дефект, что нашёлся у соседней сверки про
  // README, вторым экземпляром; слой берётся из того же поля `componentsAt`.
  const looseDocs = [];
  let componentDocs = 0;
  {
    const layers = CONFIG.componentsAt ?? ["components"];
    for (const f of docFiles) {
      const r = rel(f);
      if (!layers.some((l) => r.startsWith(l + "/"))) continue;
      componentDocs += 1;
      if (r.includes("/docs/")) continue;
      looseDocs.push(r);
    }
  }
  checkHead("Документы компонента лежат в его `docs/`", {
    n: componentDocs,
    unit: "документов внутри папок компонентов",
  });
  console.log("  документов мимо `docs/`: " + looseDocs.length);
  for (const one of looseDocs)
    console.log(
      "    " + one + ". Вся проза компонента внутри `docs/`, включая README",
    );
  checkHead("У компонента есть README", {
    n: componentDirs,
    unit: "папок компонентов",
  });
  if (readmeBlind !== null) console.log("  " + readmeBlind);
  console.log(
    "  папок компонентов без README: " + noReadme.length + debtTail("readme"),
  );
  debtNote("readme", noReadme.length);
  for (const one of debtList("readme", noReadme))
    console.log(
      "    " +
        one +
        ". Зачем папка, что берут, что тянется следом, чего нельзя",
    );
  // 13k-бис. Правила проекта не утверждают чужую раскладку.
  //
  // Семя правил приезжает с таблицей раскладки УМОЛЧАНИЯ и говорит прозой:
  // разложенный иначе проект переписывает её под себя. Проза держится
  // вниманием, и на первой же посадке после того, как таблицу в семя
  // положили, живой проект получил оба утверждения сразу — умолчание и
  // фактическую раскладку, — при зелёном прогоне.
  //
  // Признак точный и дешёвый: отступление объявлено решением, а правила
  // проекта дословно несут фразу семени про умолчание. Одно из двух лжёт.
  // Осей у умолчаний ДВЕ — раскладка и схема стилизации, — и проверять одну
  // из них и есть дефект. Замерено прогоном проб: правила проекта говорили
  // «схема стилизации действует с первого дня», реестр решений — «своя схема,
  // к умолчанию не приводится», и не ловило этого ничто.
  //
  // Вторая сторона того же: сняв утверждение об умолчании, правила перестают
  // ОТВЕЧАТЬ, куда кладут новый узел, — и сверка раскладки следующую сессию
  // не остановит: отступление объявлено, и она молчит.
  //
  // Отвечает при этом САМ ПРОЕКТ, а не доктрина. Прежде здесь стояло
  // требование сохранить указатель на раздел доктрины, и оно было хуже, чем
  // ничего: доктрина описывает другую раскладку и отвечает «в `components`»
  // проекту, у которого такой папки нет. Замерено вторым кругом проб.
  const layoutLie = [];
  {
    const seedAt = shelfAt("seat/templates/CLAUDE.md");
    const decidedAt3 =
      CONFIG.decisions == null ? null : path.join(BASE, CONFIG.decisions);
    const decided3 =
      decidedAt3 !== null && existsSync(decidedAt3)
        ? readFileSync(decidedAt3, "utf8").toLowerCase()
        : "";
    const mine = (CONFIG.rulesManifest?.rules ?? []).map((r) =>
      path.join(BASE, r),
    );
    if (seedAt !== null && existsSync(seedAt)) {
      const seed = readFileSync(seedAt, "utf8").split(NEWLINE);
      const lineWith = (what) =>
        (seed.find((l) => l.includes(what)) ?? "").trim();
      const axes = [
        {
          decided: "раскладка проекта",
          claim: lineWith("Раскладка умолчания обвязки"),
          what: "раскладку умолчания",
        },
        {
          decided: "схема стилизации",
          claim: lineWith("Схема стилизации при этом действует"),
          what: "схему стилизации умолчания",
        },
      ];
      for (const axis of axes) {
        if (!decided3.includes(axis.decided)) continue;
        if (axis.claim === "") continue;
        for (const at of mine) {
          if (!existsSync(at)) continue;
          if (!readFileSync(at, "utf8").includes(axis.claim)) continue;
          layoutLie.push(
            rel0(at) +
              " — утверждает " +
              axis.what +
              ", а отступление от неё объявлено решением. Решение опознаётся ПО СЛОВАМ «" +
              axis.decided +
              "»: при совпадении с умолчанием этих слов в реестре решений не пишут",
          );
        }
      }
      // Своя раскладка обязана быть НАЗВАНА: каждая папка верхнего уровня,
      // держащая код, названа в правилах проекта путём — с косой чертой либо
      // в обратных кавычках. Без косой черты и кавычек имя папки не
      // отличить от слова прозы: «весь показ под ui» проверку проходило бы,
      // а ответом на «куда класть» не было.
      if (decided3.includes("раскладка проекта")) {
        const tops = new Set();
        for (const f of [...files, ...styleFiles]) {
          if (isTest(f) || f.endsWith(".d.ts")) continue;
          const top = rel(f).split("/")[0];
          if (top !== undefined && top !== rel(f)) tops.add(top);
        }
        const said = mine
          .filter((at) => existsSync(at))
          .map((at) => readFileSync(at, "utf8"))
          .join(NEWLINE);
        const nameless = [...tops]
          .sort()
          .filter(
            (top) =>
              !said.includes(top + "/") && !said.includes("`" + top + "`"),
          );
        for (const top of nameless)
          layoutLie.push(
            "раскладка своя, а папка `" +
              top +
              "/` в правилах проекта не названа: «куда кладут новый узел» ответа не имеет",
          );
      }
    }
  }
  // Пустая папка под корнем исходников не бывает своей: файл её заводит,
  // файл и уносит. Остаётся она от посадки, заведшей папку раскладки
  // умолчания там, где раскладка своя, и от правки, унёсшей последний файл.
  // И то и другое — утверждение о раскладке, которого никто не делал.
  const hollow = [];
  let dirsWalked = 0;
  {
    const walk = (dir) => {
      let kids = [];
      try {
        kids = readdirSync(dir, { withFileTypes: true });
      } catch {
        return true;
      }
      dirsWalked += 1;
      let live = false;
      for (const e of kids) {
        if (!e.isDirectory()) {
          live = true;
          continue;
        }
        const inner = dir + "/" + e.name;
        // Обход обязан спрашивать то же исключение, что и сбор кода. Своего у
        // него не было, и на проекте, объявившем корнем исходников корень
        // репозитория, сверка потребовала убрать папки внутри `.git` и
        // `node_modules`. Замерено посадкой стенда с двумя деревьями.
        if (outOfTree(e.name, inner)) continue;
        if (walk(inner)) live = true;
      }
      if (!live)
        hollow.push(path.relative(ROOT, dir).split(path.sep).join("/"));
      return live;
    };
    for (const one of SRC_ROOTS) if (existsSync(one)) walk(one);
  }

  // Код, лежащий ВНЕ объявленных деревьев. Спрашивается только у проекта,
  // который объявил их СПИСКОМ: он тем самым сказал «мои деревья вот эти», и
  // файл рядом с ними — либо забытое дерево, либо чужая копия. Ни одна
  // сверка кода его не видит, и молчать об этом нельзя: «осмотрено ноль»
  // неотличимо от здоровья.
  //
  // У проекта с ОДНИМ деревом вопрос не задаётся: там корень и есть весь
  // корпус по определению, а код вне него объявляют полями `testDirs` и
  // `corpusOutside` — это другая развилка, со своей ценой.
  const outsideRoots = [];
  let outsideLooked = 0;
  if (Array.isArray(CONFIG.src) && CONFIG.src.length > 1) {
    const skip = new Set(ROOT_SEEDS);
    const walk = (dir) => {
      let kids = [];
      try {
        kids = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of kids) {
        const at = norm(path.join(dir, e.name));
        if (outOfTree(e.name, at)) continue;
        if (e.isDirectory()) {
          walk(at);
          continue;
        }
        if (!/[.][jt]sx?$/.test(e.name) && !isStylePath(e.name)) continue;
        // Файл в самом корне репозитория — настройка, а не код проекта:
        // тот же признак, что у описи кода.
        if (norm(dir) === norm(REPO)) continue;
        // Настройка инструмента названа по обычаю — `*.config.*`, — и лежит
        // она не только в корне репозитория, но и в корне каждого пакета
        // монорепозитория. Прежде исключался один корень репозитория, и
        // конфиг сборщика пакета приложения объявлялся кодом вне деревьев.
        // Замерено посадкой руками в монорепозиторий.
        if (/[.]config[.][cm]?[jt]s$/.test(e.name)) continue;
        outsideLooked += 1;
        if (insideRoots(at)) continue;
        if (skip.has(at)) continue;
        // Файл ОБВЯЗКИ называется особо. Она везёт свой код — общий
        // помощник и подготовку прогона — и кладёт его в `src/`; проект,
        // перечисливший свои деревья, это дерево объявить обязан наравне
        // с ними. Иначе записи базы о привезённых файлах указывают в
        // корпус, которого нет, а звенья цепочки их всё равно разбирают.
        const seeded = seedOfPath().has(
          norm(path.relative(REPO, at)).split(path.sep).join("/"),
        );
        outsideRoots.push(
          norm(path.relative(REPO, at)).split(path.sep).join("/") +
            (seeded
              ? " — код ОБВЯЗКИ вне объявленных деревьев: она кладёт свой в `src/`, и это дерево объявляют наравне со своими"
              : " — код вне объявленных деревьев: его не видит ни одна сверка кода"),
        );
      }
    };
    walk(norm(REPO));
  }
  checkHead("Код лежит в объявленных деревьях", {
    n: outsideLooked,
    unit: "файлов кода под корнем репозитория",
  });
  console.log(
    Array.isArray(CONFIG.src) && CONFIG.src.length > 1
      ? "  вне деревьев: " + outsideRoots.length
      : "  дерево исходников одно: корень и есть весь корпус",
  );
  for (const one of outsideRoots) console.log("    " + one);
  checkHead("Пустой папки под корнем исходников нет", {
    n: dirsWalked,
    unit: "папок под корнем исходников",
  });
  console.log(
    hollow.length === 0
      ? "  пустых папок: 0"
      : "  пустых папок: " + hollow.length,
  );
  for (const one of hollow)
    console.log(
      "    " +
        one +
        ". Убрать: папка без файлов утверждает раскладку, которой нет",
    );

  checkHead("Правила проекта не спорят с реестром решений", {
    n: (CONFIG.rulesManifest?.rules ?? []).length,
    unit: "файлов правил",
  });
  console.log(
    layoutLie.length === 0
      ? "  расхождений: 0"
      : "  расхождений: " + layoutLie.length,
  );
  for (const one of layoutLie)
    console.log(
      "    " + one + ". Переписать под фактическое устройство проекта",
    );
  checkHead("Новый узел лежит по раскладке", {
    n: files.length + styleFiles.length,
    unit: "файлов кода и стилей",
  });
  if (layoutSaid !== null) console.log("  " + layoutSaid);
  if (layoutStray.length)
    console.log("  вне объявленных слоёв: " + layoutStray.length);
  for (const one of layoutStray)
    console.log(
      "    " +
        one +
        ". Объявленные слои: app — корень композиции, " +
        (CONFIG.componentsAt ?? ["components"])
          .map((one) => one + "/<Имя>")
          .join(", ") +
        " — узел, shared/<область> — общее",
    );
  if (layoutStray.length)
    console.log(
      "  Раскладка проекта своя — объявить решением со словами «раскладка проекта» и завести план в 17-conversion.md",
    );
  checkHead("Отступление от схемы стилизации объявлено решением", {
    n: files.length,
    unit: "файлов кода",
  });
  console.log(
    decidedAt === null
      ? "  реестр решений не объявлен — спрашивать негде"
      : "  без записи: " + schemeStray.length,
  );
  for (const one of schemeStray)
    console.log(
      "    " +
        one +
        " — компонент стилизуется не по умолчанию: своего листа не импортирует, весь вид приходит пропом. Записать решением с ценой либо привести к схеме",
    );

  checkHead("Связи через DOM и CSS", {
    n: domNames,
    unit: "строк таблицы связей",
  });
  console.log(
    CONFIG.domTables == null
      ? "  таблицы не заявлены"
      : `  названо и не найдено: ${domDrift.length}, чужого не названо: ${domMissed.length}`,
  );
  for (const d of domDrift) console.log("    " + d);
  for (const d of domMissed) console.log("    " + d);

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
      // Звено, для которого в проекте нет ни одного файла его вида, конфига и не
      // требует: его не дописывают намеренно. Пакеты при этом могут стоять —
      // они служат и другому звену. Прежде сверка звала это расхождением, то
      // есть краснела на законном устройстве проекта.
      if (!linkHasSubject(link.script)) continue;
      const installed = link.packages.every((p) => deps.includes(p));
      if (!installed) continue;
      // Конфиг живого проекта часто лежит под другим именем того же
      // предмета — `.prettierrc` вместо `.prettierrc.json`; имена объявлены
      // картой посадки, и соседняя сверка звеньев читает их оттуда же.
      const names = [link.config];
      const mapAt = shelfAt("seat/map.json");
      if (mapAt !== null && existsSync(mapAt))
        for (const e of JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [])
          if (e.to === link.config) names.push(...(e.alsoKnownAs ?? []));
      if (!names.some((n) => existsSync(path.join(BASE, "..", n))))
        toolchainDrift.push(
          `${link.script}: пакеты стоят, а конфига нет — ${link.config}`,
        );
    }
  }

  const unexplained = [];
  {
    // Спрашивается с СЕМЯН, и спрашивается по КАРТЕ ПОСАДКИ, а не по прозе.
    //
    // Остальное — доктрина, инструмент, скиллы — переносится папкой целиком, и
    // перечислять его незачем: забыть при копировании папки нечего. У семени
    // назначение своё: оно едет в конкретное место проекта под конкретным
    // именем, и это соответствие существует только в карте.
    //
    // Прежде сверка смотрела в таблицу инструкции, а карта появилась рядом с
    // теми же данными — и они разошлись бы при первой правке. Источник теперь
    // один: карту читает и эта сверка, и самопроверка снимка, и посадка.
    const mapAt = shelfAt("seat/map.json");
    const seedsAt = shelfAt("seat/templates");
    if (
      SHELF !== null &&
      mapAt !== null &&
      existsSync(mapAt) &&
      seedsAt !== null &&
      existsSync(seedsAt)
    ) {
      const seatMap = JSON.parse(readFileSync(mapAt, "utf8"));
      const placed = new Set(
        [
          ...(seatMap.copy ?? []),
          ...(seatMap.onSubject ?? []),
          // Семя плана перехода: кладётся, когда заводится переход, и у
          // пустого проекта не кладётся вовсе. Условие своё — и список свой.
          ...(seatMap.onTransition ?? []),
        ].map((c) => c.from),
      );
      (function walkSeeds(dir) {
        for (const entry of readdirSync(dir)) {
          if (OUT_OF_TREE.has(entry)) continue;
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) {
            walkSeeds(full);
            continue;
          }
          const rel = path.relative(SHELF, full).split(path.sep).join("/");
          if (placed.has(rel)) continue;
          unexplained.push(
            rel + " — семя без адреса назначения в карте посадки",
          );
        }
      })(seedsAt);
      // Обратная сторона: карта называет семя, которого нет. Без неё запись
      // переживает удалённый файл, и посадка падает на копировании.
      for (const one of placed)
        if (!existsSync(path.join(SHELF, one)))
          unexplained.push(one + " — назван в карте посадки, а файла нет");
      // Адрес назначения решает и то, КАК файл будет прочитан. Семя,
      // написанное модулем, под именем `.js` читается модулем или сценарием
      // по полю `type` манифеста ЧУЖОГО проекта: без поля среда на каждом
      // прогоне печатает предупреждение и разбирает файл дважды, а дописать
      // поле посадка не вправе — оно меняет, как грузится каждый файл
      // проекта. Так ложился конфиг линта. Найдено посадкой руками в проект
      // на обычном JavaScript. Модуль ложится под `.mjs`, и вопроса нет.
      for (const e of [
        ...(seatMap.copy ?? []),
        ...(seatMap.onSubject ?? []),
        ...(seatMap.onTransition ?? []),
      ]) {
        if (!String(e.to ?? "").endsWith(".js")) continue;
        const at = path.join(SHELF, e.from);
        if (!existsSync(at)) continue;
        if (/^\s*(?:import|export)\s/m.test(readFileSync(at, "utf8")))
          unexplained.push(
            e.from +
              " — написано модулем, а ложится как " +
              e.to +
              ": тип модуля решит манифест проекта. Класть под .mjs",
          );
      }
    }
  }
  checkHead("У каждого семени есть адрес назначения", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  console.log(`  расхождений: ${unexplained.length}`);
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
  let doctrineListed = 0;
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
      doctrineListed = list.length;
      if (list === null)
        doctrineDrift.push(
          `раздела нет: ${CONFIG.doctrineReading.listHeading}`,
        );
      if (order === null)
        doctrineDrift.push(
          `раздела нет: ${CONFIG.doctrineReading.orderHeading}`,
        );
      // Доктрина — это папка правил, а не всё, что лежит в корне обвязки.
      // Плоский обход брал и памятку для человека, и требовал назвать её в
      // порядке чтения — то есть открывать каждой сессией описание папки.
      const doctrineDir = shelfAt("rules");
      const doctrine =
        doctrineDir !== null && existsSync(doctrineDir)
          ? readdirSync(doctrineDir).filter((n) => n.endsWith(".md"))
          : [];
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
      // Состав соседнего файла доктрины описывается ОДИН раз — здесь, в
      // указателе. Пересказ рядом со ссылкой («`close.md` — коммиты,
      // необратимые действия, отчёт») никто не сверяет, и он пережил переезд
      // правил о коммитах в `safety.md`: порядок работы отправлял за ними
      // туда, где их давно нет. Найдено чтением полки со стороны. Форма
      // пересказа — ссылка на соседний файл, тире и описание строчными.
      const index = path.basename(at);
      for (const name of doctrine) {
        if (name === index) continue;
        const body = unfenced(
          readFileSync(path.join(doctrineDir, name), "utf8"),
        );
        for (const para of body.split(/\r?\n\s*\r?\n/)) {
          const one = para.split(/\r?\n/).join(" ");
          for (const m of one.matchAll(
            /\[`?[\w.-]+\.md`?\]\(\.\/([\w.-]+\.md)\)\s+—\s+[а-яё]/g,
          ))
            if (doctrine.includes(m[1]))
              doctrineDrift.push(
                `${name}: состав \`${m[1]}\` пересказан рядом со ссылкой — описание файла живёт в указателе ${index}`,
              );
        }
      }
    }
  }
  // Синоним термина словаря.
  //
  // Второе слово для одного понятия запрещено критерием `H6`, и правило это
  // держалось вниманием — пока рядом с объявленным КРЮЧКОМ не завёлся
  // «ловец» и не расползся по четырём местам доктрины.
  //
  // Чего сверка НЕ умеет: поймать синоним, которого ещё никто не назвал.
  // Список нельзя перечислить заранее — синоним придумывают на ходу. Что она
  // умеет: не дать вернуться тому, что однажды нашли. Тот же приём, что у
  // точечных исключений линта: список растёт находками, а не воображением.
  const bannedWords = [];
  let bannedTerms = 0;
  let bannedSaid = null;
  {
    const at = shelfAt("rules/glossary.banned.json");
    if (at === null || !existsSync(at))
      bannedSaid = "списка отвергнутых слов рядом нет";
    else {
      const book = JSON.parse(readFileSync(at, "utf8"));
      bannedTerms = Object.keys(book).length;
      // Корпус — проза обвязки и проза проекта: доктрина, скиллы, посадка и
      // файлы базы. Именно там термин и живёт; исходники сюда не идут — в них
      // говорят на языке кода.
      const walkMd = (dir) => {
        if (dir === null || !existsSync(dir)) return [];
        return readdirSync(dir).flatMap((e) => {
          const full = norm(path.join(dir, e));
          if (statSync(full).isDirectory()) return walkMd(full);
          return /.md$/.test(e) ? [full] : [];
        });
      };
      const corpus = [
        ...walkMd(shelfAt("rules")),
        ...walkMd(shelfAt("skills")),
        ...walkMd(shelfAt("seat")),
        ...walkMd(BASE),
      ];
      for (const f of corpus) {
        const rows = readFileSync(f, "utf8").split(NEWLINE);
        for (let i = 0; i < rows.length; i += 1) {
          const low = rows[i].toLowerCase();
          for (const one of book.banned ?? []) {
            if (!one.forms.some((w) => low.includes(w))) continue;
            bannedWords.push(
              rel0(f) +
                ":" +
                (i + 1) +
                " — " +
                one.forms[0] +
                ", а в словаре это " +
                one.instead,
            );
          }
        }
      }
      // Тот же термин, определённый в словаре ДВАЖДЫ. Два определения одного
      // слова — две концепции под одним именем, только спрятанные в одном
      // файле: читают первое найденное, и какое — дело случая. Найдено
      // чтением полки со стороны: фальсификация была определена в одной
      // таблице дважды — процедурой и значением слова. Спрашивается внутри
      // одной таблицы: краткая таблица в начале словаря законно повторяет
      // слова полной.
      const glossaryAt = shelfAt("rules/glossary.md");
      if (glossaryAt !== null && existsSync(glossaryAt)) {
        const rows = unfenced(readFileSync(glossaryAt, "utf8")).split(NEWLINE);
        let seen = null;
        rows.forEach((line, i) => {
          if (!line.trimStart().startsWith("|")) {
            seen = null;
            return;
          }
          if (seen === null) seen = new Map();
          const term = /^\|\s*\*\*([^*]+)\*\*\s*\|/.exec(line.trim());
          if (term === null) return;
          const key = term[1].trim().toLowerCase();
          if (seen.has(key))
            bannedWords.push(
              rel0(glossaryAt) +
                ":" +
                (i + 1) +
                " — «" +
                term[1].trim() +
                "» определён второй раз, первый — строкой " +
                seen.get(key) +
                ", а в словаре это одна строка",
            );
          else seen.set(key, i + 1);
        });
      }
      if (bannedWords.length === 0)
        bannedSaid =
          "отвергнутых слов в корпусе: 0 (список: " +
          (book.banned ?? []).length +
          ")";
    }
  }
  checkHead("Синоним термина словаря не заведён", {
    n: bannedTerms,
    unit: "терминов словаря под запретом",
  });
  if (bannedSaid !== null) console.log("  " + bannedSaid);
  if (bannedWords.length)
    console.log("  синонимов в корпусе: " + bannedWords.length);
  for (const one of bannedWords)
    console.log("    " + one + ". Один термин — одна концепция");
  checkHead("Доктрина названа в порядке чтения", {
    n: doctrineListed,
    unit: "документов в порядке чтения",
  });
  console.log(
    CONFIG.doctrineReading == null || SHELF === null
      ? "  полка не заявлена"
      : `  расхождений: ${doctrineDrift.length}`,
  );
  for (const d of doctrineDrift) console.log("    " + d);

  checkHead("Документы названы в указателе", {
    n: indexDocs,
    unit: "документов в папке",
  });
  console.log(
    CONFIG.docsIndex == null
      ? "  указатель не заявлен"
      : `  не названо: ${indexDrift.length}`,
  );
  for (const d of indexDrift) console.log("    " + d);

  checkHead("Применимость разделов планки", {
    n: barScopes,
    unit: "разделов планки",
  });
  console.log(
    CONFIG.qualityScope == null
      ? "  деление на ядро и применимые не заявлено"
      : `  расхождений: ${scopeDrift.length}` +
          (liveScopes.length
            ? `; живые разделы: ${liveScopes.join(", ")}`
            : ""),
  );
  for (const s of scopeDrift) console.log("    " + s);

  checkHead("Сверки, выключенные при живом предмете", {
    n: disarmedLooked,
    unit: "пустых полей настройки",
  });
  console.log(`  выключено зря: ${disarmed.length}`);
  for (const d of disarmed) console.log("    " + d);

  checkHead("Скиллы проекта", {
    n: skillsLooked,
    unit: "скиллов на диске и в таблице",
  });
  console.log(
    CONFIG.skills == null
      ? "  скиллы не заявлены"
      : `  расхождений: ${skillDrift.length}`,
  );
  for (const s of skillDrift) console.log("    " + s);

  checkHead("Разделы правил классифицированы", {
    n: (CONFIG.rulesManifest?.rules ?? []).length,
    unit: "файлов правил",
  });
  console.log(
    CONFIG.rulesManifest == null
      ? "  файлы правил не заявлены"
      : `  расхождений: ${unclassified.length}`,
  );
  for (const u of unclassified) console.log("    " + u);

  checkHead("Шаблон правил заполнен", {
    n:
      (CONFIG.rulesManifest?.rules ?? []).length + (CONFIG.seeded ?? []).length,
    unit: "засеянных файлов",
  });
  console.log(
    CONFIG.rulesManifest == null
      ? "  файлы правил не заявлены"
      : `  осталось незаполненных мест: ${unfilledTemplate.length}`,
  );
  for (const u of unfilledTemplate) console.log("    " + u);

  checkHead("Отложенное без закрытых пунктов", {
    n: todoLooked,
    unit: "пунктов отложенного",
  });
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
  // Полка из сверки адресов исключалась ЦЕЛИКОМ, и исключение пережило свой
  // повод. Повод был верный: её файлы описывают проект, которого ЕЩЁ НЕТ —
  // инструкция посадки называет файлы базы, заводимые позже, и первый же
  // прогон после посадки краснел бы на тексте, приехавшем вместе с правилами.
  //
  // Но с тех пор на полку переехала САМА ДОКТРИНА, и вместе с чужими адресами
  // из сверки выпали её собственные: сто девяносто семь адресов свода не
  // проверялись вовсе, семь из них вели в файл, удалённый при расщеплении
  // доктрины, и прогон оставался зелёным. Это тот самый класс «исключение
  // сужено по источнику, а причина его про предмет», который свод уже знает, —
  // и он выстрелил снова, тем же способом.
  //
  // Поэтому исключается не источник, а ФОРМА адреса: файл базы проекта
  // (`NN-имя.md`), документация проекта (`docs/…`) и местный файл разрешений —
  // ровно то, чего в новом проекте ещё нет. Всё остальное на полке обязано
  // разрешаться: оно говорит про саму обвязку, а она существует уже сейчас.
  // Семена — единственное место, где адрес описывает проект, КОТОРОГО ЕЩЁ НЕТ:
  // в том и назначение заготовки. Требовать от них разрешения значило бы
  // краснеть на законном, а подгонять их под текущий проект — портить шаблон.
  // Здесь граница проходит по расположению, и это тот случай, когда
  // расположение совпадает с различием: в `seat/templates/` не лежит ничего,
  // кроме заготовок. Держит их другое — самопроверка снимка: она сажает обвязку
  // в пустую папку, где семена становятся файлами проекта, и гоняет сверку там.
  // Найдено посадкой в живой проект: семя реестра тестов называет тест каркаса,
  // а каркас в живой проект не кладётся.
  const fromTemplates = (at) => norm(at).includes("/seat/templates/");
  const ofAnyProject = (tok) =>
    /^\d\d-[^/]+\.md$/.test(tok) ||
    tok.startsWith("docs/") ||
    tok.endsWith("settings.local.json");
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
    // ВСЯ проза в корне репозитория: она не лежит ни в папке базы, ни в папке
    // документов, ни среди файлов правил — то есть проваливается между тремя
    // источниками сразу. Найдено посадкой полки саму в себя: её README раздаёт
    // обвязку и не читался ни одной сверкой.
    //
    // Брался при этом ОДИН файл по имени, и это была починка на файле вместо
    // класса: следующая корневая проза провалилась туда же. Замерено вторым
    // кругом проб — реестр находок, вынесенный в корень, чтобы пережить
    // клонирование, не читала ни одна сверка.
    ...readdirSync(REPO)
      .filter((e) => e.endsWith(".md"))
      .filter((e) => statSync(norm(path.join(REPO, e))).isFile())
      .map((e) => [e, norm(path.join(REPO, e))]),
    // Собственные файлы полки: доктрина, инструкция посадки, справочник
    // инструмента, памятки. Читают их чаще всего остального, а адреса в них
    // до сих пор не проверялись ни одной сверкой.
    ...(SHELF === null
      ? []
      : (function walkShelf(dir) {
          const out = [];
          for (const e of readdirSync(dir)) {
            const full = norm(path.join(dir, e));
            if (statSync(full).isDirectory()) out.push(...walkShelf(full));
            else if (e.endsWith(".md"))
              out.push([
                path.relative(REPO, full).split(path.sep).join("/"),
                full,
              ]);
          }
          return out;
        })(norm(SHELF))),
  ]
    // Скиллы приходят дважды — своим сборщиком и обходом полки.
    .filter((one, i, all) => all.findIndex(([, at]) => at === one[1]) === i)
    .map(([name, at]) => [name, at, at.startsWith(SHELF_ROOT)]);

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
      // Семена в счёт не идут. Файл в `seat/templates/` — ЗАГОТОВКА, а не проза
      // этого проекта: он называет `npm run dev`, потому что так у приложения,
      // и в библиотеке такого скрипта нет и не будет. Пока семена читались
      // наравне с прозой, предупреждение висело вечно и указывало на файл,
      // который никто не писал под этот проект. Найдено посадкой в чужую
      // библиотеку.
      const spans = new Set();
      for (const [, src] of docSources) {
        // Вся папка ПОСАДКИ, а не только семена: сама инструкция лежит рядом с
        // ними и называет команды так же — как образец, а не как утверждение об
        // этом проекте. Пока исключались только семена, инструкция называла
        // звено, которого у проекта нет намеренно, и предупреждение висело на
        // законном устройстве. Найдено посадкой в проект без TypeScript.
        if (norm(src).includes("/seat/")) continue;
        for (const hit of readFileSync(src, "utf8").matchAll(/`([^`\n]+)`/g))
          spans.add(hit[1].trim());
      }
      const named = (s) =>
        spans.has(s) ||
        spans.has(`${PACKAGE_MANAGER} ${s}`) ||
        spans.has(`${PACKAGE_MANAGER} run ${s}`);
      const silent = scripts.filter((s) => !named(s));
      {
        checkHead(
          "Скрипты манифеста описаны (предупреждение, прогон не роняет)",
          { n: scripts.length, unit: "скриптов манифеста" },
        );
        console.log(`  не названы нигде: ${silent.length}`);
        for (const s of silent)
          console.log(
            `    ${s} — есть в манифесте, но ни таблица проверок, ни список` +
              NEWLINE +
              "      исключённых его не называет: решение о нём не принято",
          );
        // Половина «названо в прозе, а скрипта нет» отсюда УБРАНА: это
        // ошибка, а не предупреждение, и в секции, которая прогон не роняет,
        // она не краснела никогда. Её спрашивает сверка «Названное доктриной
        // исполнимо» — там же, где команду без пакета и режим без режима.
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

  checkHead("Решения адресуемы", { n: adrLooked, unit: "записей решений" });
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
  const PATH_EXT = new RegExp("\\.(" + CODE_STYLE_ALT + "|md|json|mjs)$");
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
  // Основа имени обязана быть непустой: `.md` в тексте — это расширение как
  // предмет разговора, а не адрес. Без этого условия форма записи, объясняемая
  // прозой, читалась бы как несуществующий файл.
  const looksLikeBareName = (tok) =>
    !tok.includes("/") && /[^.]\.md$/.test(tok) && !isExtensionList(tok);
  // `everyPath` собран под подсчёт папок и намеренно держит только
  // `.ts/.tsx/.scss/.md`; расширять его нельзя — на его составе стоят числа
  // заявленных папок. Поэтому у сверки путей свой инвентарь: тот же список
  // плюс скрипты, на которые база ссылается по имени.
  const scriptFiles = [];
  const walkScripts = (dir) => {
    if (!walkable(dir)) return;
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walkScripts(full);
      else if (e.endsWith(".mjs")) scriptFiles.push(norm(full));
    }
    // Корень исходников — из настройки, а не имя `src` строкой: см. соседний
    // обход. У проекта, зовущего его иначе, этот список выходил пустым.
  };
  for (const one of SRC_ROOTS) walkScripts(one);
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
  let linkFiles = 0;
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
        if (skipDirs.has(e) || OUT_OF_TREE.has(e)) continue;
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) walkMd(full);
        else if (e.endsWith(".md")) mdFiles.push(norm(full));
      }
    })(norm(REPO));
    linkFiles = mdFiles.length;
    for (const f of mdFiles) {
      for (const m of unfenced(readFileSync(f, "utf8")).matchAll(
        /\]\(([^)\s]+)\)/g,
      )) {
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
  // План перехода называет работу, КОТОРОЙ ЕЩЁ НЕТ, и адреса будущих файлов
  // в нём законны по устройству: семя плана прямо велит завести шаг на
  // документ каждого узла, а документа на диске нет — затем шаг и стоит.
  // Пока это не различалось, доктрина спорила сама с собой: посадка писала
  // предписанный шаг и получала «путь ведёт в никуда» на собственном плане.
  // Молча такие адреса пропускать нельзя — опечатка в плане невидима, — и
  // потому они считаются и печатаются своей строкой, не роняя прогон.
  // План ПРИВЕДЕНИЯ того же рода: он переносит код туда, где его ещё нет, и
  // называет новые адреса по построению. Пока освобождался один план
  // перехода, шаг «перенести поверхность пакета в `src/app/`» ронял прогон
  // строкой «ведёт в никуда» на плане, который семя велит написать. Замерено
  // посадкой руками в библиотеку. Адрес плана берётся из карты посадки — там
  // же, откуда его кладёт посадка.
  const plannedPaths = [];
  const planName = CONFIG.transition == null ? null : CONFIG.transition.file;
  const conversionName = (() => {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt)) return null;
    const e = (readJson(mapAt, {}).copy ?? []).find((one) =>
      one.from.endsWith("/17-conversion.md"),
    );
    return e === undefined
      ? null
      : path.relative(BASE, path.join(REPO, e.to)).split(path.sep).join("/");
  })();
  const isPlan = (name) =>
    (planName !== null && name === planName) || name === conversionName;
  let pathTokens = 0;
  for (const [name, at, fromShelf] of docSources) {
    const dir = norm(path.dirname(at));
    for (const hit of unfenced(readFileSync(at, "utf8")).matchAll(
      /`([^`\n]+)`/g,
    )) {
      let tok = hit[1].trim();
      if (/[\s(){}*[\]<>|,]/.test(tok)) continue;
      tok = tok.replace(/[:#].*$/, "");
      // Адрес, принадлежащий ЛЮБОМУ проекту, а не этому: в тексте полки его
      // требовать нельзя — в новом проекте такого файла ещё нет.
      if (fromShelf === true && (fromTemplates(at) || ofAnyProject(tok)))
        continue;
      if (looksLikeBareName(tok)) {
        // Неоднозначное имя отсутствием не является — тот же принцип, что у
        // реестра тестов и у карты: список, наполненный живыми файлами,
        // перестают читать.
        const seen = bareCount.get(tok) ?? 0;
        if (seen === 0) {
          pathTokens++;
          if (knownDangling.has(`${name}|${tok}`))
            knownUsed.add(`${name}|${tok}`);
          else if (isPlan(name)) plannedPaths.push(`${name}: ${tok}`);
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
      // Текст полки адресует своих соседей от КОРНЯ ОБВЯЗКИ, а не от папки
      // самого файла: инструкция посадки пишет `seat/map.json`, лёжа в
      // `seat/`. Разрешение от папки файла давало бы `seat/seat/map.json` —
      // то есть сверка краснела бы на законной форме записи.
      const fromShelfRoot =
        fromShelf === true && SHELF !== null
          ? norm(path.join(SHELF, tok))
          : null;
      if (fromShelfRoot !== null && existsSync(fromShelfRoot)) continue;
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
      if (isPlan(name)) {
        plannedPaths.push(`${name}: ${tok}`);
        continue;
      }
      danglingPaths.push(`${name}: ${tok}`);
    }
  }
  for (const one of knownDangling)
    if (!knownUsed.has(one))
      deadExceptions.push(`пути в обратных кавычках: ${one} — ничего не гасит`);

  checkHead("Пути в обратных кавычках", {
    n: pathTokens,
    unit: "путей в обратных кавычках",
  });
  console.log(`  ведут в никуда: ${danglingPaths.length}`);
  for (const d of danglingPaths) console.log("    " + d);
  if (plannedPaths.length)
    console.log(
      "  адресов будущих файлов в планах перехода и приведения: " +
        plannedPaths.length +
        " — их заводят шаги плана",
    );
  // Отступ здесь ДВА пробела, а не четыре: четыре — признак находки, и
  // список, напечатанный ими, ронял бы прогон ровно за то, что сверка
  // только что признала законным.
  for (const d of plannedPaths) console.log("  · " + d);

  checkHead("Ссылки markdown", { n: linkFiles, unit: "файлов прозы" });
  console.log(`  ведут в никуда: ${danglingLinks.length}`);
  for (const d of danglingLinks) console.log("    " + d);

  // 14a-2. Проза целиком попадает в корпус сверок.
  //
  // Сверка печатает, СКОЛЬКО она проверила, и никогда — сколько должна была.
  // Разница между этими двумя числами и есть слепое пятно: «проверено: 15»
  // читается как работа, а не как дыра, а «проверено: 0» неотличимо от «предмета
  // нет». Замерено на живом случае: адресов проверялось пятнадцать при ста
  // девяноста семи, и тридцать восемь файлов прозы из пятидесяти одного не
  // читала ни одна текстовая сверка. Заметил это человек чтением, не прогон.
  //
  // Поэтому сверяется не объявление, а САМ КОРПУС: множество файлов, которые
  // сверки действительно прочитали, против всей прозы репозитория. Объявлением
  // тут не отделаться — объявить корень можно и не читать его.
  const corpusGap = [];
  const proseFiles = [];
  {
    const inCorpus = new Set(docSources.map(([, at]) => norm(at)));
    const shortOf = (full) =>
      path.relative(REPO, full).split(path.sep).join("/");
    const outside = new Set(
      (CONFIG.corpusOutside ?? []).map((one) => norm(path.join(REPO, one))),
    );
    const outsideUsed = new Set();
    (function walkProse(dir) {
      for (const e of readdirSync(dir)) {
        if (OUT_OF_TREE.has(e)) continue;
        const full = norm(path.join(dir, e));
        if (statSync(full).isDirectory()) {
          walkProse(full);
          continue;
        }
        if (!e.endsWith(".md")) continue;
        proseFiles.push(full);
        if (inCorpus.has(full)) continue;
        if (outside.has(full)) {
          outsideUsed.add(full);
          continue;
        }
        corpusGap.push(shortOf(full) + " — прозу не читает ни одна сверка");
      }
    })(norm(REPO));
    for (const one of outside)
      if (!outsideUsed.has(one))
        deadExceptions.push(
          "проза вне корпуса: " + shortOf(one) + " — ничего не исключает",
        );
  }
  checkHead("Проза целиком попадает в корпус сверок", {
    n: proseFiles.length,
    unit: "файлов прозы",
  });
  console.log(`  вне корпуса: ${corpusGap.length}`);
  for (const c of corpusGap) console.log("    " + c);

  // 14a-3. Строка таблицы по ширине шапки.
  //
  // Лишнюю ячейку разметка ОТБРАСЫВАЕТ: всё, что стоит правее последней
  // графы шапки, при показе не видно, а в сыром тексте выглядит абзацем
  // как абзац. Черта вместо точки при правке строки — и полабзаца правила
  // пропадает у читателя, не пропав из файла. Нехватка ячейки ломает
  // другое — чтение по номеру графы: состояние строки реестра берётся
  // шестой ячейкой, и в короткой строке оно читается пустым. Разделитель
  // иной ширины, чем шапка, не даёт таблице собраться вовсе.
  //
  // Черта считается так же, как её считает разметка: экранированная не
  // делит, неэкранированная делит и внутри обратных кавычек.
  //
  // Замерено ревизией свода глазами: в таблице сверок шесть строк несли
  // третью ячейку при двух графах шапки, и в пяти из них в ней стоял
  // абзац правила.
  const tableWidthDrift = [];
  let tableRowsLooked = 0;
  {
    const cellsOf = (line) => {
      const bare = line.trim();
      let bars = 0;
      for (let i = 0; i < bare.length; i += 1) {
        if (bare[i] === "\\") {
          i += 1;
          continue;
        }
        if (bare[i] === "|") bars += 1;
      }
      const lead = bare.startsWith("|") ? 1 : 0;
      const tail =
        bare.length > 1 && bare.endsWith("|") && !bare.endsWith("\\|") ? 1 : 0;
      return bars - lead - tail + 1;
    };
    const SEPARATOR = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
    for (const [name, at] of docSources) {
      const rows = unfenced(readFileSync(at, "utf8")).split(NEWLINE);
      for (let i = 0; i + 1 < rows.length; i += 1) {
        if (!rows[i].trimStart().startsWith("|")) continue;
        if (!SEPARATOR.test(rows[i + 1])) continue;
        const width = cellsOf(rows[i]);
        const sepWidth = cellsOf(rows[i + 1]);
        if (sepWidth !== width)
          tableWidthDrift.push(
            `${name}:${i + 2} — разделитель в ${sepWidth} граф под шапкой в ${width}: таблица не собирается`,
          );
        let j = i + 2;
        for (; j < rows.length && rows[j].trimStart().startsWith("|"); j += 1) {
          tableRowsLooked += 1;
          const got = cellsOf(rows[j]);
          if (got > width)
            tableWidthDrift.push(
              `${name}:${j + 1} — ячеек ${got} при шапке в ${width}: правее последней графы текст не виден`,
            );
          else if (got < width)
            tableWidthDrift.push(
              `${name}:${j + 1} — ячеек ${got} при шапке в ${width}: графа по номеру читается пустой`,
            );
        }
        i = j - 1;
      }
    }
  }
  checkHead("Строка таблицы по ширине шапки", {
    n: tableRowsLooked,
    unit: "строк таблиц прозы",
  });
  console.log(`  ширина разошлась с шапкой: ${tableWidthDrift.length}`);
  for (const d of tableWidthDrift) console.log("    " + d);

  // 14a-4. Ссылка на критерий планки несёт его заголовок.
  //
  // Голое обозначение критерия переживает перенумерацию политики молча: раздел
  // тестов уехал из `F` в `J`, а свод, скилл входа в задачу и семя правил
  // продолжали звать «тест обязан уметь падать» критерием F1 — о
  // владельце ресурса. Ссылку никто не разрешал: сверка адресов читает пути, а
  // не обозначения. Найдено чтением полки со стороны.
  //
  // Форма одна — обозначение и сразу за ним заголовок ёлочками, дословно или
  // его началом: `J1 «Тест обязан уметь падать»`. Тогда перенумерация
  // краснеет на каждой ссылке, а не проходит, потому что обозначение
  // по-прежнему существует. Корпус — проза полки и правила проекта; сама
  // политика ссылается на свои критерии свободно, а база проекта — нет: в ней
  // обозначения вроде `P5` бывают именами, а не критериями.
  const critRefDrift = [];
  let critRefs = 0;
  {
    const policyFiles = ["rules/quality.md", "rules/quality-scoped.md"]
      .map((one) => shelfAt(one))
      .filter((one) => one !== null && existsSync(one));
    const titles = new Map();
    for (const f of policyFiles)
      for (const c of barCriteria(f)) titles.set(c.id, c.title);
    const plain = (s) =>
      s
        .toLowerCase()
        .split("ё")
        .join("е")
        .replace(/[^a-zа-я0-9]+/g, " ")
        .trim();
    const policy = new Set(policyFiles.map((one) => norm(one)));
    const rulesMine = new Set(
      (CONFIG.rulesManifest?.rules ?? []).map((r) => norm(path.join(BASE, r))),
    );
    const ID =
      /(?<![\wА-Яа-яЁё`-])([A-Z]\d{1,2}(?:-(?:бис|тер))?)(?![\wА-Яа-яЁё-])/g;
    for (const [name, at, fromShelf] of docSources) {
      if (policy.has(norm(at))) continue;
      if (fromShelf !== true && !rulesMine.has(norm(at))) continue;
      const rows = unfenced(readFileSync(at, "utf8")).split(NEWLINE);
      // Единица — абзац: заголовок ёлочками законно переносится на строку ниже.
      for (let i = 0; i < rows.length;) {
        if (rows[i].trim() === "") {
          i += 1;
          continue;
        }
        const from = i;
        const para = [];
        while (i < rows.length && rows[i].trim() !== "") para.push(rows[i++]);
        const text = para.join(" ");
        for (const m of text.matchAll(ID)) {
          const title = titles.get(m[1]);
          if (title === undefined) continue;
          critRefs += 1;
          const quote = /^\s+«([^»]+)»/.exec(text.slice(m.index + m[0].length));
          const said = quote === null ? "" : plain(quote[1]);
          if (said.split(" ").length >= 2 && plain(title).startsWith(said))
            continue;
          critRefDrift.push(
            `${name}:${from + 1} — ${m[1]} ` +
              (quote === null
                ? "без заголовка ёлочками"
                : `с заголовком «${quote[1]}», а в политике он «${title}»`) +
              `. Писать: ${m[1]} «${title}»`,
          );
        }
      }
    }
  }
  checkHead("Ссылка на критерий планки несёт его заголовок", {
    n: critRefs,
    unit: "ссылок на критерии в прозе полки и правил",
  });
  console.log(`  без своего заголовка: ${critRefDrift.length}`);
  for (const d of critRefDrift) console.log("    " + d);

  // 14a-5. Таблица состава лежит в одном месте.
  //
  // Таблица, объявленная полем настройки, — данные: её читает сверка, по ней
  // судят о составе проекта. Копия рядом не читается никем и расходится
  // молча. Замерено чтением полки со стороны: доктрина держала таблицу
  // скиллов второй копией, и в копии не было одного скилла. Узнаётся по
  // шапке: та же строка шапки вне своего файла — копия. Семена не в счёт:
  // семя и есть источник таблицы, а не её двойник. План перехода не
  // объявляется здесь намеренно: его форму законно повторяет план приведения.
  const tableTwin = [];
  const declaredTables = [];
  if (CONFIG.skills != null) {
    declaredTables.push([CONFIG.skills.heading, CONFIG.skills.table]);
    if (CONFIG.skills.memoHeading != null && CONFIG.skills.memo != null)
      declaredTables.push([
        CONFIG.skills.memoHeading,
        path.join(CONFIG.skills.dir, CONFIG.skills.memo),
      ]);
  }
  if (CONFIG.qualityScope != null)
    declaredTables.push([
      CONFIG.qualityScope.heading,
      CONFIG.qualityScope.table,
    ]);
  if (CONFIG.checksTable != null)
    declaredTables.push([CONFIG.checksTable.heading, CONFIG.checksTable.file]);
  if (CONFIG.findings != null)
    declaredTables.push([CONFIG.findings.heading, CONFIG.findings.file]);
  for (const [head, file] of declaredTables) {
    const home = norm(path.join(BASE, file));
    for (const [name, at] of docSources) {
      if (norm(at) === home || fromTemplates(at)) continue;
      unfenced(readFileSync(at, "utf8"))
        .split(NEWLINE)
        .forEach((line, i) => {
          if (line.trim() === head.trim())
            tableTwin.push(
              `${name}:${i + 1} — копия таблицы, объявленной в ${rel0(home)}. Сослаться на неё, а не повторять`,
            );
        });
    }
  }
  checkHead("Таблица состава лежит в одном месте", {
    n: declaredTables.length,
    unit: "таблиц, объявленных настройкой",
  });
  console.log(`  копий вне своего файла: ${tableTwin.length}`);
  for (const d of tableTwin) console.log("    " + d);

  // 14a-6. Перечень папок полки полный.
  //
  // Состав обвязки описан её же словами в нескольких местах — витрина
  // репозитория, памятка папки, её таблица «что читают когда», — и каждое
  // перечисление стареет от первой новой папки. Папка ворот перед коммитом
  // появилась и не попала ни в одно из них. Замерено чтением полки со
  // стороны. Перечнем считается таблица целиком либо абзац, называющие
  // папки полки путём в обратных кавычках — `rules/`, `.claude/rules/` или
  // адресом внутри неё, `seat/seat.md`;
  // назвавший хотя бы три обязан назвать все.
  //
  // Спрашивается только в мастерской: в посаженном проекте в `.claude`
  // законно лежат и папки самого проекта, а описание обвязки их знать не
  // обязано и не может.
  const shelfListGap = [];
  let shelfLists = 0;
  if (IN_WORKSHOP && SHELF !== null) {
    const mapAt = shelfAt("seat/map.json");
    const skipOwn = new Set(
      (mapAt !== null && existsSync(mapAt) ? readJson(mapAt, {}) : {})
        .projectOwnedInsideHarness ?? [],
    );
    const tops = readdirSync(SHELF)
      .filter((e) => !OUT_OF_TREE.has(e) && !skipOwn.has(e))
      .filter((e) => statSync(path.join(SHELF, e)).isDirectory())
      .sort();
    for (const [name, at] of docSources) {
      const rows = unfenced(readFileSync(at, "utf8")).split(NEWLINE);
      const units = [];
      let unit = null;
      rows.forEach((line, i) => {
        const bare = line.trim();
        const kind = bare === "" ? null : bare.startsWith("|") ? "t" : "p";
        if (unit !== null && kind !== unit.kind) {
          units.push(unit);
          unit = null;
        }
        if (kind === null) return;
        if (unit === null) unit = { kind, from: i, text: "" };
        unit.text += " " + line;
      });
      if (unit !== null) units.push(unit);
      for (const u of units) {
        // Папка считается пунктом перечня, когда за её адресом идёт описание —
        // тире либо граница ячейки. Упоминание внутри определения перечнем не
        // является: словарь называет папку доктрины, определяя доктрину.
        const said = tops.filter((t) =>
          new RegExp("`(?:\\.claude/)?" + t + "/[^`]*`\\s*(?:—|\\|)").test(
            u.text,
          ),
        );
        if (said.length < 3) continue;
        shelfLists += 1;
        if (said.length < tops.length)
          shelfListGap.push(
            `${name}:${u.from + 1} — перечень папок полки без ` +
              tops
                .filter((t) => !said.includes(t))
                .map((t) => "`" + t + "/`")
                .join(", "),
          );
      }
    }
  }
  // 14a-7. Файлы обвязки видны git.
  //
  // Обвязка — файлы проекта: едут с ним коммитом и клоном. Файл полки под
  // правилом игнорирования не едет никуда и пропадает молча: прогон на этой
  // машине зелёный, а в клоне файла нет. Замерено в мастерской: конфиг линта
  // переименовали вслед за семенем, а список исключений называл прежнее имя,
  // и переименованный файл выпал из отслеживания. Свои файлы проекта внутри
  // папки обвязки — разрешения среды — не в счёт: карта посадки называет их.
  const shelfHidden = [];
  const sandboxOpen = [];
  let shelfFilesLooked = 0;
  let shelfGitBlind = false;
  if (SHELF !== null) {
    const mapAt = shelfAt("seat/map.json");
    const own = new Set(
      (mapAt !== null && existsSync(mapAt) ? readJson(mapAt, {}) : {})
        .projectOwnedInsideHarness ?? [],
    );
    const list = [];
    (function walkShelfFiles(dir) {
      for (const e of readdirSync(dir)) {
        if (OUT_OF_TREE.has(e)) continue;
        const full = path.join(dir, e);
        const inShelf = path.relative(SHELF, full).split(path.sep).join("/");
        if (own.has(inShelf)) continue;
        if (statSync(full).isDirectory()) walkShelfFiles(full);
        else list.push(path.relative(REPO_AT, full).split(path.sep).join("/"));
      }
    })(SHELF);
    shelfFilesLooked = list.length;
    try {
      // `--no-index`: правило спрашивается и с отслеживаемого файла. Он сам
      // едет, но правило поджидает следующий: переименованный вслед за
      // семенем файл новый, и под правилом он уже не отслеживается.
      const out = execFileSync(
        "git",
        ["check-ignore", "--no-index", "--stdin"],
        {
          cwd: REPO_AT,
          encoding: "utf8",
          input: list.join(NEWLINE) + NEWLINE,
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      for (const one of out.split(NEWLINE).filter(Boolean))
        shelfHidden.push(
          one.trim() +
            " — файл обвязки под правилом игнорирования: новый либо переименованный в клон не уедет",
        );
    } catch (e) {
      // Код 1 у `check-ignore` значит «ничего не скрыто»; иное — git
      // недоступен или репозитория нет, и тогда это слепота, а не чистота.
      if (e.status !== 1) shelfGitBlind = true;
    }
    // Обратная сторона: песочницы, которые порождает сам инструмент, от git
    // СКРЫТЫ. Каждая — полная копия дерева и живёт минутами, и коммит,
    // сделанный в это время из соседней консоли, захватил бы копию проекта
    // целиком. Песочница мутаций была в семени игнорирования, а песочница
    // фальсификации — нет: замерено `git status` мастерской посреди прогона.
    if (!shelfGitBlind)
      for (const dir of [".проба-сверок", ".stryker-tmp"]) {
        try {
          execFileSync("git", ["check-ignore", "--no-index", "-q", dir], {
            cwd: REPO_AT,
            stdio: ["ignore", "ignore", "ignore"],
          });
        } catch (e) {
          if (e.status === 1)
            sandboxOpen.push(
              dir +
                " — песочница инструмента не скрыта от git: коммит во время прогона захватит копию проекта. Дописать в .gitignore",
            );
        }
      }
  }
  checkHead("Файлы обвязки видны git", {
    n: shelfFilesLooked,
    unit: "файлов обвязки",
  });
  console.log(
    shelfGitBlind
      ? "  репозитория нет либо git недоступен — не сверено"
      : `  скрытых от git: ${shelfHidden.length}, песочниц на виду: ${sandboxOpen.length}`,
  );
  for (const d of [...shelfHidden, ...sandboxOpen]) console.log("    " + d);

  // 14a-8. Концы строк рабочего дерева сходятся с объявленными.
  //
  // `.gitattributes` объявляет концы строк, а приводит он только индекс:
  // файл, выписанный с CRLF до его появления, так и лежит с CRLF. Правка,
  // ищущая текст по одному переводу строки, на таком файле не находит
  // ничего — без признака и без ошибки. Замерено посадкой руками в проект,
  // выписанный с CRLF: шаг приведения выглядел исполненным, а рабочее дерево
  // осталось прежним целиком. Спрашивается то, что показывает сам git:
  // `git ls-files --eol`, файл с объявленным LF и CRLF в рабочем дереве.
  const eolDrift = [];
  let eolLooked = 0;
  let eolBlind = false;
  try {
    const rows = execFileSync("git", ["ls-files", "--eol"], {
      cwd: REPO_AT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).split(NEWLINE);
    for (const row of rows) {
      const m = /^i\/(\S*)\s+w\/(\S*)\s+attr\/(.*?)\t(.+)$/.exec(row);
      if (m === null) continue;
      if (!/eol=lf/.test(m[3])) continue;
      eolLooked += 1;
      if (m[2] === "crlf" || m[2] === "mixed")
        eolDrift.push(
          `${m[4]} — объявлен LF, а в рабочем дереве ${m[2] === "crlf" ? "CRLF" : "концы вперемешку"}: не тронутый правкой файл выписать заново из индекса`,
        );
    }
  } catch {
    eolBlind = true;
  }
  checkHead("Концы строк рабочего дерева сходятся с объявленными", {
    n: eolLooked,
    unit: "файлов с объявленным LF",
  });
  console.log(
    eolBlind
      ? "  репозитория нет либо git недоступен — не сверено"
      : `  расходятся: ${eolDrift.length}`,
  );
  for (const d of eolDrift) console.log("    " + d);

  checkHead("Перечень папок полки полный", {
    n: shelfLists,
    unit: "перечней папок полки",
  });
  console.log(
    IN_WORKSHOP
      ? `  неполных: ${shelfListGap.length}`
      : "  не мастерская: описание полки сверяется там, где его пишут",
  );
  for (const d of shelfListGap) console.log("    " + d);

  // Тесты, которым решением разрешено лежать вне своей папки. Считается ЗДЕСЬ,
  // а печатается сверкой «Тесты лежат в `tests/`» ниже: мёртвое исключение
  // называет сверка, которая идёт раньше, и посчитанное после неё она бы уже не
  // увидела. Найдено фальсификацией самого списка — снятый тест при оставшемся
  // исключении не дал ни одной строки.
  // Запись — файл, папка с косой на конце либо образец со звёздочкой. Прежде
  // принимался только файл, и проект, держащий тесты в `__tests__/` у каждого
  // узла, отвечал на КЛАСС записями по одной: список рос с каждым тестом,
  // порог разросшихся списков срабатывал на законном, а новый тест краснел,
  // пока его не вписали. Замерено посадкой в живое приложение: пятнадцать
  // записей на одну раскладку. Решение при этом уже принималось про папку.
  const testsOutsideRules = (CONFIG.testsOutside ?? []).map((one) => {
    if (one.includes("*")) {
      const test = globsToTest([one]);
      return {
        one,
        hit: (f) => test(path.relative(REPO, f).split(path.sep).join("/")),
      };
    }
    const at = norm(path.join(REPO, one));
    return one.endsWith("/")
      ? { one, hit: (f) => f.startsWith(at + "/") }
      : { one, hit: (f) => f === at };
  });
  const testsOutsideHit = (f) => testsOutsideRules.some((r) => r.hit(f));
  const testsOutsideUsed = new Set(
    files.filter((f) => isTestPath(f) && testsOutsideHit(f)),
  );
  for (const r of testsOutsideRules)
    if (![...testsOutsideUsed].some((f) => r.hit(f)))
      deadExceptions.push(
        "тест вне своей папки: " + r.one + " — ничего не исключает",
      );

  checkHead("Исключения сверок используются", {
    n: (CONFIG.testsOutside ?? []).length + (CONFIG.corpusOutside ?? []).length,
    unit: "объявленных исключений",
  });
  console.log(`  мёртвых исключений: ${deadExceptions.length}`);
  for (const d of deadExceptions) console.log("    " + d);

  // 14a. Списки исключений не разрослись.
  //
  // Исключение гасит ОДНО ложное срабатывание, и пока их единицы — это честная
  // плата за точность. Когда их набирается список, гасится уже не случай, а
  // КЛАСС случаев: значит, класс надо было объяснить сверке, а не отвечать на
  // него записями по одной. Разницы между «единицы» и «список» не видно ниоткуда,
  // кроме счёта, поэтому счёт печатается каждым прогоном, а не в тот день, когда
  // кто-то решит посмотреть.
  //
  // Порог взят замером, а не на глаз. В зрелом проекте-доноре на 893
  // проверенных адреса пришлось 4 исключения, на 1187 имён — 2, на ссылки — 1.
  // То есть объявленный порог больше, чем когда-либо требовалось на деле, и
  // первое же превышение означает случай, которого в практике ещё не было.
  //
  // **Предупреждает, а не роняет.** Иначе у превышения появился бы дешёвый
  // ответ — удалить нужную запись ради зелёного, — и сверка ослепла бы
  // по-настоящему. Решение принимает разработчик, как с версиями среды.
  const excLimit = CONFIG.exceptionLimit ?? 0;
  const excLists = [
    [
      "адреса в обратных кавычках",
      (CONFIG.docPathExceptions ?? []).length,
      "объяснить сверке класс, а не вести список",
    ],
    [
      "ссылки на разделы",
      CONFIG.rulesManifest?.refExceptions?.length ?? 0,
      "объяснить сверке класс, а не вести список",
    ],
    [
      "имена из чужих API",
      (CONFIG.foreignNames ?? []).length,
      "взять второй источник правды вместо перечисления",
    ],
    [
      "разрешения в правилах направления",
      rules.reduce((n, r) => n + r.allowed.length, 0),
      "поправить раскладку слоёв, а не копить разрешения",
    ],
    [
      "тесты вне своей папки",
      (CONFIG.testsOutside ?? []).length,
      "перенести тесты в папку слоя, а не копить исключения",
    ],
  ];
  const excTotal = excLists.reduce((n, one) => n + one[1], 0);
  const overgrown =
    excLimit === 0 ? [] : excLists.filter((one) => one[1] > excLimit);
  checkHead(
    "Списки исключений не разрослись (предупреждение, прогон не роняет)",
    {
      n: excLists.length,
      unit: "списков исключений",
    },
  );
  console.log(
    excLimit === 0
      ? "  порог не объявлен"
      : overgrown.length === 0
        ? `  всего исключений: ${excTotal}, порог на список: ${excLimit}`
        : `  списков сверх порога: ${overgrown.length}.` +
          " Чинить надо то, что породило класс; прогон это не роняет",
  );
  for (const [what, count, fix] of overgrown)
    console.log(`    ${what}: ${count} при пороге ${excLimit} — ${fix}`);

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
        // Каталог рецептов фальсификации — НЕ исходник. В нём лежат заведомо
        // несуществующие имена: рецепт ломает сверку тем, что называет имя,
        // которого в коде нет. Прочитанный как исходник, он делал это имя
        // «живым» и гасил ровно ту сверку, которую рецепт проверяет — то есть
        // рецепт удовлетворял собственное условие и молчал. Найдено при выплате
        // долга рецептов: сверка имён не покрывалась в принципе.
        if (full.endsWith("/falsify.json")) continue;
        fileStems.add(entry.replace(/\.[a-z.]+$/, ""));
        if (!new RegExp("\\.(" + CODE_STYLE_ALT + "|mjs|js|json)$").test(entry))
          continue;
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
  const nameSources = docSources.filter(
    ([, , fromShelf]) => fromShelf !== true,
  );
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

  checkHead("Имена из кода в тексте", {
    n: camelTokens,
    unit: "имён из кода в тексте",
  });
  console.log(`  нет в исходниках: ${goneCamel.length}`);
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
  //
  // Стем — ОСНОВА, а не словоформа, и с беглой гласной основ у слова две:
  // «сверки» и «сверок», «папки» и «папок». Родительный множественного —
  // ровно та форма, что стоит после «пяти» и дальше, и «7 сверок», «12
  // папок», «6 бочек» проходили зелёными при пойманных «2 сверки». Слой
  // стоял словоформой «слоёв», и «три слоя» проходило тоже. Замерено
  // ревизией результата посадки: план приведения назвал слои счётом.
  const NUM_NOUN =
    "файл|бочк|бочек|сверк|сверок|рецепт|слов(?!ар)|режим|провер|тест|правил|экспорт|строк|исключен|папк|папок|модул|пункт|запис|констант|слайд|мутант|раздел|команд|хук|сло(?:й|я|ю|ем|е|ёв|ям|ями|ях)(?![а-яё])|секунд|минут|мс(?![а-яё])|px|обещан|критери|принцип|проп";
  // Стем ищется и ВНУТРИ слова, а не только в начале: «14 реэкспортов» — тот же
  // счёт, что «14 экспортов», и привязка к началу слова пропускала его молча.
  // Найдено пробой. Расширение измерено на всей базе: новых попаданий ровно
  // одно, и оно настоящее — ложных ноль, поэтому шума сверка не даёт.
  // Числительное СЛОВОМ — тот же счёт и тот же обход. Замер: карта говорила
  // «четыре пропа» при пяти в контракте, и сверка молчала, потому что искала
  // цифру. Ограничитель общий с цифрой — существительное из списка выше, иначе
  // «две стороны» и «три причины» краснели бы на законной прозе.
  const NUM_WORD =
    "дв(?:а|е|ух|ум|умя)" +
    "|" +
    "тр(?:и|ёх|ем|емя|ём)" +
    "|" +
    "четыр(?:е|ёх|ьмя|ем)" +
    "|" +
    "пят(?:ь|и|ью)" +
    "|" +
    "шест(?:ь|и|ью)" +
    "|" +
    "сем(?:ь|и|ью)" +
    "|" +
    "вос(?:емь|ьми|емью)" +
    "|" +
    "девят(?:ь|и|ью)" +
    "|" +
    "десят(?:ь|и|ью)" +
    "|" +
    "(?:один|две|три|четыр|пят|шест|сем|восем|девят)надцат(?:ь|и|ью)" +
    "|" +
    "двадцат(?:ь|и|ью)" +
    "|" +
    "тридцат(?:ь|и|ью)" +
    "|" +
    "сорок(?:а)?" +
    "|" +
    "пятидесяти" +
    "|" +
    "пятьдесят" +
    "|" +
    "ст(?:о|а)";
  const PROSE_NUM = new RegExp(
    `(?:\\d[\\d.,]*|(?<![а-яёa-z])(?:${NUM_WORD})(?![а-яё]))\\s+(?:[а-яё]+\\s+)?[а-яё]*(?:${NUM_NOUN})[а-яё]*`,
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
    // Протокол свода не спрашивается, и это не поблажка, а развязка тупика:
    // форму протокола проверяет сам режим `bar`, а печать — отпечаток всего,
    // что ниже неё. Требование этой сверки переписать в нём слово исполнить
    // нельзя: правка после печати её гасит, а заново печать ставится только
    // поверх ПУСТОГО скелета — то есть ценой всех ста пятидесяти трёх строк.
    // Замерено на стенде: сверка потребовала объявить счёт формой, протокол
    // был закрыт, и выхода из этой пары не было ни одного.
    if (name === "bar-protocol.md") continue;
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
  // Записи полки О САМОЙ СЕБЕ — отложенное и вопросы в `state/`, памятка
  // папки и витрина репозитория раздачи — того же рода, что база: они
  // описывают, что есть сейчас, и счёт в них застывает так же. Доктрина под
  // правило не идёт: числа в ней — иллюстрации. Замерено чтением полки со
  // стороны: отложенное держало «рецептов 23, сверок 54, без рецепта 31» при
  // единицах без рецепта, витрина — «восемь слов» при девяти, памятка — «два
  // файла репозитория» при трёх. Витрина корня спрашивается только в
  // мастерской: в проекте корневая витрина — проектная.
  let shelfNumLines = 0;
  {
    const own = [];
    const stateDir = shelfAt("state");
    if (stateDir !== null && existsSync(stateDir))
      for (const e of readdirSync(stateDir))
        if (e.endsWith(".md")) own.push(path.join(stateDir, e));
    const memo = shelfAt("README.md");
    if (memo !== null && existsSync(memo)) own.push(memo);
    if (IN_WORKSHOP && existsSync(path.join(REPO_AT, "README.md")))
      own.push(path.join(REPO_AT, "README.md"));
    for (const at of own) {
      const rows = unfenced(readFileSync(at, "utf8")).split(NEWLINE);
      shelfNumLines += rows.length;
      rows.forEach((line, i) => {
        const bare = outsideTicks(line).replace(NUMBERING, " ");
        const hit = bare.match(PROSE_NUM);
        if (hit !== null)
          frozenNumbers.push(`${rel0(at)}:${i + 1} — ${hit.join(" | ")}`);
      });
    }
  }
  checkHead("Числа в прозе базы", {
    n: dossierLines().base.length + shelfNumLines,
    unit: "строк прозы базы и записей полки о себе",
  });
  console.log(`  счётов вне формы: ${frozenNumbers.length}`);
  for (const f of frozenNumbers) console.log("    " + f);

  checkHead("Имена констант в тексте", {
    n: capsTokens,
    unit: "имён констант в тексте",
  });
  console.log(`  нет в исходниках: ${goneNames.length}`);
  for (const g of goneNames) console.log("    " + g);

  // 16. тест лежит в папке `tests/` своего слоя.
  // Соглашение несущее: база описывает каждый тест ПУТЁМ, а размер папки
  // считается по коду, отдельно от путей со словом `tests`. Перенос теста к
  // его файлу не уронил бы ни один прогон — `isTest` ловит и по суффиксу
  // имени, — зато обессмыслил бы записи базы молча.
  //
  // У соглашения есть ИСКЛЮЧЕНИЯ, и заведены они по факту. Доктрина объявляет
  // отступление от умолчания законным решением, которое записывают в реестр
  // «вместе с ценой: какая сверка из-за этого краснеет постоянно». Цена была
  // названа неверно. Замерено посадкой в живой проект: один тест рядом со своим
  // компонентом даёт сверке базы код возврата `1`, то есть красной становится
  // ВСЯ цепочка и навсегда — а свод тут же запрещает такое состояние, потому
  // что прогон, красный всегда, перестают читать целиком.
  //
  // Решение, за которое нечем заплатить, решением не является: доктрина
  // предлагала выбор, которого не было. Список закрывает эту дыру и полностью
  // повторяет идиому остальных исключений обвязки — мёртвое исключение
  // называется, а разросшийся список ловит порог.
  // Опознаётся тест ТЕМ ЖЕ предикатом, каким его опознаёт весь остальной
  // инструмент, а не своим образцом. Пока здесь стоял свой, он видел одно
  // написание из двух: файл с именем через `spec`, лежащий не там, попадал в
  // сбор тестов и НЕ попадал в эту сверку — то есть раскладка расходилась с
  // объявленной, и об этом не говорила ни одна строка. Найдено сразу после
  // того, как сбор научился видеть второе написание: видимость появилась,
  // несогласие осталось немым.
  const strayTests = files.filter(
    (f) => isTestPath(f) && !f.includes("/tests/") && !testsOutsideHit(f),
  );
  // Исключение обязано стоять на РЕШЕНИИ: поле снимает красное, а причину
  // снять не может. Настройка говорила «обязан иметь запись в реестре
  // решений», а спрашивала это одна лишь её строка: адрес, вписанный без
  // записи, гасил сверку молча. Запись узнаётся по адресу файла, его папки
  // либо самой записи списка — проект, держащий тесты в `__tests__/`, решает
  // про папку, а не про каждый файл. Найдено посадкой руками в проект на
  // `jest`.
  //
  // Папки ВЫШЕ своей не в счёт, и адрес ищется целиком: решение о раскладке
  // проекта называет `src/` и `src/lib/`, и тест под ними проходил без
  // всякого решения о себе. Замерено снятием папки тестов из записи решения:
  // прогон остался зелёным.
  const reasonlessTests = [];
  {
    const decidedAt =
      CONFIG.decisions == null ? null : path.join(BASE, CONFIG.decisions);
    const decided =
      decidedAt !== null && existsSync(decidedAt)
        ? readFileSync(decidedAt, "utf8")
        : "";
    for (const f of testsOutsideUsed) {
      const own = path.relative(REPO, f).split(path.sep).join("/");
      const said = [
        own,
        path.posix.dirname(own) + "/",
        ...testsOutsideRules.filter((r) => r.hit(f)).map((r) => r.one),
      ];
      if (!said.some((one) => namesAddress(one + "|" + decided)))
        reasonlessTests.push(
          own +
            " — объявлен вне папки, а записи решения ни с его адресом, ни с адресом его папки нет",
        );
    }
  }
  checkHead("Тесты лежат в `tests/`", {
    n: files.filter(isTest).length,
    unit: "тестовых файлов",
  });
  console.log(
    `  вне своей папки: ${strayTests.length}` +
      (testsOutsideUsed.size
        ? `, объявлено решением: ${testsOutsideUsed.size}`
        : ""),
  );
  for (const s of strayTests) console.log("    " + rel(s));
  for (const s of reasonlessTests) console.log("    " + s);

  checkHead("Объявленный состав папок и радиусы", {
    n: dirs + radii,
    unit: "объявленных папок и радиусов",
  });
  console.log(`  разошлось: ${wrong.length}`);
  for (const w of wrong) console.log("    " + w);
  {
    checkHead("Не разобрано (проверкой не покрыто)", {
      n: unresolved.length,
      unit: "нерасшифрованных адресов",
    });
    console.log("  не разобрано: " + unresolved.length);
    for (const u of unresolved) console.log("    " + u);
  }
  // Печатается заголовками, а не числом: число рядом с сорока другими числами
  // проглядывают, а вопрос, названный своими словами, — нет. Ради того же он
  // стоит последней секцией: последнее прочитанное и есть прочитанное.
  checkHead("Конфиг звена цепочки на месте", {
    n: chainDeclared.length,
    unit: "звеньев цепочки",
  });
  console.log(`  расхождений: ${toolchainDrift.length}`);
  for (const d of toolchainDrift) console.log("    " + d);

  // 44. Таблица сверок доктрины описывает существующие сверки.
  //
  // Таблица — ОПРЕДЕЛЕНИЕ того, что обвязка проверяет: пять тысяч строк
  // инструмента ради этого не читают, читают её. Сверялась она ничем и
  // разошлась молча — часть строк описывала сверки, ушедшие вместе со вторым
  // экземпляром доктрины, часть задваивалась, часть сверок не была описана
  // никак. Нашёл это человек вопросом, а не прогон, — то есть ровно тот класс,
  // про который весь свод и написан.
  //
  // Сторон три, и каждая закрывает свою дыру:
  //   печать незаявленного — ловит `checkHead`, сразу и насмерть;
  //   строка без сверки и сверка без строки — ловятся здесь, по дословному имени;
  //   заявленная сверка, которой в коде уже нет, — спрашивается у ИСХОДНИКА:
  //     часть сверок печатается только при живом предмете, и молчание в прогоне
  //     отсутствием не является.
  const checksTableDrift = [];
  if (CONFIG.checksTable != null) {
    const at = path.join(BASE, CONFIG.checksTable.file);
    if (!existsSync(at))
      checksTableDrift.push(`нет файла таблицы: ${CONFIG.checksTable.file}`);
    else {
      const rows = readFileSync(at, "utf8").split(NEWLINE);
      const head = rows.findIndex((l) =>
        l.startsWith(CONFIG.checksTable.heading),
      );
      if (head < 0)
        checksTableDrift.push(
          `шапка таблицы не найдена: ${CONFIG.checksTable.heading}`,
        );
      else {
        const named = [];
        const { rows: tableRows, problem: tableProblem } = tableAfter(
          rows,
          head,
        );
        if (tableProblem !== null)
          checksTableDrift.push(
            `${CONFIG.checksTable.heading}: ${tableProblem}`,
          );
        for (const row of tableRows) named.push(row.split("|")[1].trim());
        const seen = new Set();
        for (const one of named) {
          if (seen.has(one)) checksTableDrift.push(`строка задвоена: ${one}`);
          seen.add(one);
          if (!CHECK_SECTIONS.includes(one))
            checksTableDrift.push(`строка есть, сверки нет: ${one}`);
        }
        for (const one of CHECK_SECTIONS)
          if (!seen.has(one))
            checksTableDrift.push(`сверка есть, строки нет: ${one}`);
        const own = readFileSync(path.join(TOOL_DIR, "graph.mjs"), "utf8");
        for (const one of CHECK_SECTIONS)
          if (own.split(JSON.stringify(one)).length < 3)
            checksTableDrift.push(`сверка объявлена, а в коде её нет: ${one}`);
      }
    }
  }
  checkHead("Таблица сверок описывает существующие сверки", {
    n: CHECK_SECTIONS.length,
    unit: "сверок прогона",
  });
  console.log(
    CONFIG.checksTable == null
      ? "  таблица сверок не заявлена"
      : `  сверок объявлено: ${CHECK_SECTIONS.length}, расхождений: ${checksTableDrift.length}`,
  );
  for (const d of checksTableDrift) console.log("    " + d);

  // Рецепт фальсификации находит место в СВЕЖЕЙ посадке.
  //
  // Рецепты едут с обвязкой в каждый проект, а пишутся в мастерской — и
  // якорь, списанный с её правленого файла, в свежепосаженном проекте не
  // находится: семя говорит иное. Режим фальсификации называет такой рецепт
  // «написан под свой проект», и прогон остаётся зелёным — пометка гасит
  // сигнал, о чём она сама и предупреждает. Замерено посадкой руками в пустой
  // проект: семь рецептов из ста шестнадцати не нашли места, и три из них не
  // находили его НИГДЕ, в мастерской тоже. Три сверки молча потеряли
  // фальсификацию, а видно это было только как «работа проекта».
  //
  // Свежая посадка — это семена и сама обвязка, больше ничего. Поэтому вопрос
  // простой: каждый якорь рецепта — строка, которую он ищет, и строка, за
  // которой дописывает, — стоит в СЕМЕНИ того файла, куда рецепт нацелен, или
  // в файле обвязки. Файл, которого посадка не кладёт, рецепт заводит сам.
  // Рецепт сверки, чей предмет посадка не заводит — поле настройки в семени
  // пусто, — места в ней и не ищет.
  //
  // Живой проект правит свои файлы, и там рецепт вправе не найти места:
  // это законно и печатается режимом отдельно. Здесь спрашивается другое —
  // что рецепт работает хотя бы там, откуда начинает каждый проект.
  const recipeAdrift = [];
  let recipeAnchors = 0;
  {
    const recipesAt = path.join(TOOL_DIR, "falsify.json");
    const mapAt = shelfAt("seat/map.json");
    if (existsSync(recipesAt) && mapAt !== null && existsSync(mapAt)) {
      const seat = readJson(mapAt, {});
      const seedFrom = new Map(
        [
          ...(seat.copy ?? []),
          ...(seat.onSubject ?? []),
          ...(seat.onTransition ?? []),
        ].map((e) => [e.to, e.from]),
      );
      const shelfRel = path.relative(REPO, SHELF).split(path.sep).join("/");
      const seedConfigAt = shelfAt("seat/templates/graph.config.mjs");
      const seedConfig = existsSync(seedConfigAt)
        ? readFileSync(seedConfigAt, "utf8")
        : "";
      const idleInSeat = (section) => {
        const field = RECIPE_NEEDS[section];
        return (
          field !== undefined &&
          seedConfig.includes(NEWLINE + "  " + field + ": null,")
        );
      };
      // Текст файла в свежей посадке: семя, если посадка его кладёт; сам
      // файл, если он из обвязки; иначе такого файла там нет.
      const freshText = (file) => {
        const at = seedFrom.has(file)
          ? shelfAt(seedFrom.get(file))
          : file.startsWith(shelfRel + "/")
            ? path.join(REPO, file)
            : null;
        return at !== null && existsSync(at) ? readFileSync(at, "utf8") : null;
      };
      const freshVars = recipeVars(true);
      for (const r0 of readJson(recipesAt, {}).recipes ?? []) {
        const r = recipeSubst(r0, freshVars);
        if (idleInSeat(r.section)) continue;
        for (const step of r.edits ?? [r]) {
          // Шаг без адреса заводит свой предмет сам: файл или папку.
          if (step.file === undefined) continue;
          recipeAnchors += 1;
          const say = (why) =>
            recipeAdrift.push(
              "«" + r.section + "» — " + step.file + ": " + why,
            );
          const text = freshText(step.file);
          if (text === null) {
            say(
              "в свежей посадке такого файла нет — рецепт обязан завести его сам",
            );
            continue;
          }
          if (step.find !== undefined && !text.includes(step.find))
            say("якоря нет в семени — «" + step.find.split("\n")[0] + "»");
          if (
            step.after !== undefined &&
            !text.split(NEWLINE).some((l) => l.trim() === step.after)
          )
            say("якоря дописывания нет в семени — «" + step.after + "»");
        }
      }
    }
  }
  checkHead("Рецепт находит место в свежей посадке", {
    n: recipeAnchors,
    unit: "шагов рецептов с адресом файла",
  });
  console.log("  не найдут места: " + recipeAdrift.length);
  for (const one of recipeAdrift) console.log("    " + one);

  // Флаг посадки читается ОДНИМ способом на весь инструмент.
  //
  // Значений в ходу три, и прежде баннер смотрел «не null», а две сверки —
  // «не ноль». Посадка, снявшая флаг в ноль (естественное прочтение слов
  // «снять флаг»), получала вечный баннер при зелёном прогоне. Замерено
  // посадкой начисто.
  if (seatingIsUp()) {
    console.log("");
    banner("ПОСАДКА НЕ ЗАВЕРШЕНА");
    console.log(
      "  Флаг посадки стоит: фаза 2 ещё не закончена. Пока он стоит,",
    );
    console.log("  прогон не роняют сверки, чей предмет доделывает фаза 2.");
    console.log("  Найденное они печатают целиком — это и есть её работа:");
    for (const one of SOFT_WHILE_SEATING) console.log("  «" + one + "»");
    console.log("  Снять флаг — отдельное действие, и делает его фаза 2, а не");
    console.log("  прогон.");
  }

  // 44b. Вопрос о планке задан на конечном виде правки.
  //
  // Правила объявляют режим «правка против её тестов» частью КАЖДОГО отчёта о
  // правке кода — он печатает перечень разделов планки и счёт критериев, то
  // есть он и есть тот момент, когда вопрос о качестве предъявляют. Держалось
  // это памятью, и память подвела: рефактор по планке прошёл мимо двух находок
  // раздела «форма контракта», а режим в тот заход не звали ни разу.
  //
  // Сверяется ровно одно: файл кода, изменившийся ПОСЛЕ последнего показа,
  // вопроса не получил. Честность ответа машине недоступна — она объявлена
  // держащейся вниманием, и эта сверка её не заменяет. Она закрывает вторую
  // половину: что вопрос был задан, и задан на том виде правки, который сдают.
  //
  // Сравнивается содержимое, а не время: клон ставит всем файлам одну свежую
  // метку, и по времени всё выглядело бы устаревшим.
  const unasked = [];
  let ledgerSeen = 0;
  // Слепота сверки — отдельное состояние, и держит его своя переменная:
  // «правленого нет» и «смотреть нечем» печатаются разными строками.
  let ledgerBlind = false;
  if (CONFIG.testedLedger != null) {
    const at = path.join(BASE, CONFIG.testedLedger);
    const seen = readJson(at, {});
    ledgerSeen = Object.keys(seen).length;
    // Правка берётся у состояния репозитория тем же способом, что и в режиме
    // «правка против её тестов»: без неё сверка спрашивала бы про весь код, а
    // не про то, что тронуто сейчас.
    let changedNow;
    try {
      changedNow = execFileSync("git", ["status", "--porcelain", "-uall"], {
        cwd: path.join(BASE, ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split(NEWLINE)
        .map((l) => l.slice(3).trim())
        .filter(Boolean)
        .map((l) => (l.includes(" -> ") ? l.split(" -> ")[1] : l))
        .map((f) => norm(path.join(BASE, "..", f)))
        .filter((f) => files.includes(f) && !isTest(f) && !f.endsWith(".d.ts"))
        // Нетронутое семя — работа обвязки: свода на него не спрашивают, и
        // вопроса о планке тоже. Признак общий со сводом намеренно.
        .filter((f) => !untouchedSeed(f, path.join(BASE, ".."), seedOfPath()));
    } catch {
      // Репозитория нет или git недоступен. Это НЕ «правленого нет»: сверке
      // нечего смотреть, и молчать об этом нельзя. Проект без репозитория
      // существует — на таком стенде сверка печатала «правленого без вопроса
      // нет» и проходила зелёной, то есть была зелена оттого, что ей нечего
      // проверять. Прогон при этом не роняется: жить без репозитория законно,
      // а красный навсегда перестают читать.
      changedNow = null;
      ledgerBlind = true;
    }
    // Приведение формата вопроса о планке не требует — ответ общий с воротами.
    if (changedNow !== null)
      changedNow = await withoutFormatOnly(changedNow, path.join(BASE, ".."));
    for (const f of changedNow ?? []) {
      const now = createHash("sha1")
        .update(readFileSync(f, "utf8").split("\r\n").join("\n"))
        .digest("hex")
        .slice(0, 12);
      if (seen[rel(f)] !== now) unasked.push(rel(f));
    }
  }
  checkHead("Вопрос о планке задан на конечном виде правки", {
    n: ledgerSeen,
    unit: "записей следа прогона",
  });
  console.log(
    CONFIG.testedLedger == null
      ? "  след прогона не ведётся — вопрос держится памятью целиком"
      : ledgerBlind
        ? "  состояние репозитория прочитать не удалось: репозитория нет либо git недоступен — предмета у сверки нет"
        : unasked.length === 0
          ? "  правленого без вопроса нет"
          : "  правлено после последнего вопроса: " +
            unasked.length +
            ". Позвать режим «правка против её тестов» и пройти по планке",
  );
  for (const u of unasked) console.log("    " + u);

  // 44c. Планка пройдена ПОКРИТЕРИАЛЬНО.
  //
  // Соседняя сверка выше закрывает, что вопрос ПРЕДЪЯВЛЕН. Предъявленный
  // вопрос и отвеченный — разное: режим печатал разделы планки и число
  // критериев в них, уходил, и проход по этим ста восьмидесяти держался
  // тем, что сессия вспомнит про каждый. Требование завёл разработчик:
  // проход обязан держаться записью, а не памятью о том, заглядывали ли в
  // политику.
  //
  // Печать пересчитывается на месте: протокол, правленный ПОСЛЕ печати, от
  // неё расходится, и «нашлось», переписанное в «чисто», всплывает здесь.
  //
  // Сверка защищает от забывчивости, а не от подлога, и о верности исхода
  // не говорит ничего: признаки планки прогоном не ловятся. Ловчесть самого
  // прохода меряет режим `bar-probe`, а не эта строка.
  const barGaps = [];
  let barCriteriaLive = 0;
  let barSaid = null;
  {
    const at =
      CONFIG.barProtocol == null ? null : path.join(BASE, CONFIG.barProtocol);
    const subject = at === null ? [] : await barChangedSubject(REPO);
    {
      const all = liveBarCriteria();
      barCriteriaLive = all === null ? 0 : all.all.length;
    }
    if (at === null)
      barSaid =
        "протокол не ведётся — проход по планке держится памятью целиком";
    else if (subject === null)
      barSaid =
        "состояние репозитория прочитать не удалось: репозитория нет либо git недоступен — предмета у сверки нет";
    else if (subject.length === 0) barSaid = "правленого кода и стилей нет";
    else {
      const was = barHeader(at);
      const live = liveBarCriteria();
      const marks = barMarks(subject);
      if (was === null) barGaps.push("протокола нет: свод не делался");
      else if (was.kind !== "на изменение")
        barGaps.push(
          "протокол сделан на задаче чтения, а правленое есть: свод не о нём",
        );
      else if (!barSameMarks(was.marks, marks))
        barGaps.push(
          "протокол сделан на другом виде предмета: файлов в нём " +
            was.marks.length +
            ", правленых " +
            marks.length,
        );
      else if (was.seal === null || was.seal === "нет")
        barGaps.push("печати нет: свод начат и не закончен");
      else if (was.seal !== barSealOf(was.body))
        barGaps.push(
          "печать не сходится: протокол правлен после того, как закрыт",
        );
      else if (live !== null && !live.blind) {
        // Счёт — дешёвая вторая опора к печати: полноту сверяет режим при
        // печати, но протокол, собранный мимо режима, печать бы унаследовал
        // вместе с недостающими строками.
        const answered = was.body
          .split(/\r?\n/)
          .filter((l) => l.startsWith("| "))
          .map((l) =>
            l
              .split("|")
              .slice(1, -1)
              .map((c) => c.trim()),
          )
          // Исход сверяется со СЛОВАРЁМ, а не с непустотой. Шапка таблицы
          // несёт в той же клетке слово «исход» и считалась ответом: счёт
          // выходил на единицу больше живого набора всегда, и вторая опора к
          // печати говорила о дыре там, где дыры не было.
          // «Лозунг» стоит здесь наравне с исходами: он проставлен скелетом
          // и означает, что исхода у пункта быть не может. Не считать его
          // ответом значило бы требовать к печати ровно тех оценок, которые
          // политика объявила невыводимыми.
          .filter(
            (c) =>
              c.length === 6 &&
              ["чисто", "нет предмета", "нашлось", "лозунг"].includes(c[2]),
          ).length;
        if (answered !== live.all.length)
          barGaps.push(
            "исходов в протоколе " +
              answered +
              ", живых критериев " +
              live.all.length,
          );
        else
          barSaid =
            "свод закрыт печатью: критериев " +
            live.all.length +
            ", файлов " +
            marks.length;
      } else barSaid = "свод закрыт печатью, живой набор критериев не прочитан";
    }
  }
  // Предложенное сводом по планке живёт в реестре, а не в отчёте.
  //
  // На задаче ЧТЕНИЯ находка получает судьбу «предложено»: чинить нечего,
  // код не тронут. Дальше она не живёт нигде. Протокол перезаписывается
  // следующим проходом — свод на чтении и свод на правке пишутся в один
  // файл, — а отчёт исчезает вместе с сессией.
  //
  // Тот же довод доктрина уже привела про вопросы: «Вопрос, существующий
  // только в тексте отчёта, не сохраняется до следующего захода: контекст
  // сессии не переносится, и повторно вопрос не задаётся». Для предложенного
  // он верен слово в слово, а опоры не было.
  //
  // Замерено сценарием на стенде: проход по ста пятидесяти трём критериям
  // дал четырнадцать находок, и через один прогон от них не осталось
  // ничего. Держится тем же способом, что красное звено и незамеренное:
  // открытой строкой реестра, называющей критерий ёлочками.
  const barLoose = [];
  let barProposed = 0;
  {
    const at =
      CONFIG.barProtocol == null ? null : path.join(BASE, CONFIG.barProtocol);
    if (at !== null && existsSync(at)) {
      for (const line of readFileSync(at, "utf8").split(NEWLINE)) {
        const cell = line.split("|").map((c) => c.trim());
        if (cell.length < 7) continue;
        if (cell[3] !== "нашлось" || cell[6] !== "предложено") continue;
        barProposed += 1;
        if (overOpen(cell[1], 1) > 0)
          barLoose.push(
            cell[1] +
              " — предложено сводом и не названо открытой строкой реестра: адрес " +
              cell[4],
          );
      }
    }
  }
  checkHead("Предложенное сводом названо находкой", {
    n: barProposed,
    unit: "предложенного в протоколе свода",
  });
  console.log("  без строки реестра: " + barLoose.length);
  for (const one of barLoose)
    console.log("    " + one + ". Завести строку открытой");
  // Коммит с кодом накрыт запечатанным сводом — ревизия по ИСТОРИИ.
  //
  // Соседняя сверка спрашивает свод с правленого, то есть с рабочего дерева.
  // Коммит дерево опустошает, и она замолкает: требование не откладывалось, а
  // удалялось. Ворота — хук перед коммитом — правку без свода не пропускают,
  // но хук лежит в `.git`, с клоном не едет и снимается флагом. Эта сверка
  // обход не предотвращает: она делает его вечно красным.
  //
  // Обе стороны спрашивают один помощник, `barCoverFault`. Разойтись им
  // нечем — это не две проверки одного, а ворота и ревизия при них.
  const barPast = [];
  let barPastLooked = 0;
  let barPastNote = null;
  {
    const at =
      CONFIG.barProtocol == null
        ? null
        : path.posix.join(
            path.relative(REPO_AT, BASE).split(path.sep).join("/"),
            CONFIG.barProtocol,
          );
    if (at === null) barPastNote = "протоколу негде лежать: поле не объявлено";
    else if (CONFIG.barSince == null)
      barPastNote =
        "коммит-основание сводов не объявлено — история не сверяется";
    else {
      const { execFileSync } = await import("node:child_process");
      const git = (args) =>
        execFileSync("git", args, {
          cwd: REPO_AT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      const seeds = seedOfPath();
      let log;
      try {
        log = git(["log", "--format=%H", CONFIG.barSince + "..HEAD"])
          .split(NEWLINE)
          .map((l) => l.trim())
          .filter(Boolean);
      } catch {
        log = null;
      }
      if (log === null)
        barPastNote =
          "коммита-основания " +
          CONFIG.barSince +
          " в истории этой копии нет — своды по истории не сверены";
      else
        for (const hash of log) {
          let touched;
          try {
            touched = git(["show", "--name-only", "--format=", hash])
              .split(NEWLINE)
              .map((l) => l.trim())
              .filter(Boolean);
          } catch {
            continue;
          }
          const want = [];
          for (const one of touched) {
            const abs = norm(path.join(REPO_AT, one));
            // Предикат тот же, что у предмета свода и у ворот: корпус кода и
            // корпус стилей. Свой предикат здесь отбирал иначе — тесты в него
            // не попадали, — и ревизия объявляла непокрытым коммит, накрытый
            // сводом полностью. Та же болезнь, от которой эта пара и лечит.
            //
            // Цена у общего предиката одна: файл, снесённый после того
            // коммита, в корпусе не значится, и коммит, только сносивший код,
            // ревизией не спрашивается.
            if (!files.includes(abs) && !styleFiles.includes(abs)) continue;
            if (abs.endsWith(".d.ts")) continue;
            let was;
            try {
              was = git(["show", hash + ":" + one]);
            } catch {
              continue;
            }
            // Семя берётся ИЗ ТОГО ЖЕ коммита: семя правится своей жизнью,
            // и сравнение с сегодняшним сделало бы старую посадку красной
            // задним числом.
            let seedWas = null;
            if (seeds.has(one)) {
              const from = seeds.get(one);
              try {
                seedWas = git(["show", hash + ":.claude/" + from]);
              } catch {
                seedWas = null;
              }
            }
            if (
              sameAsSeed(was, seedWas) ||
              (await formatOnly(seedWas, was, abs))
            )
              continue;
            want.push({ file: rel(abs), mark: barDigest(was), one, abs, was });
          }
          if (!want.length) continue;
          barPastLooked += 1;
          want.sort((x, y) => (x.file < y.file ? -1 : 1));
          let said = null;
          try {
            said = git(["show", hash + ":" + at]);
          } catch {
            said = null;
          }
          let fault = barCoverFault(want, said);
          // Приведение формата свода не требует — тот же ответ, что у ворот.
          // Спрашивается лениво: только у коммита, который иначе красный.
          if (fault !== "") {
            const meant = [];
            for (const w of want) {
              let before = null;
              try {
                before = git(["show", hash + "^:" + w.one]);
              } catch {
                before = null;
              }
              if (!(await formatOnly(before, w.was, w.abs))) meant.push(w);
            }
            fault = barCoverFault(meant, said);
          }
          if (fault !== "") barPast.push(hash.slice(0, 7) + " — " + fault);
        }
    }
  }
  // Ворота перед коммитом УСТАНОВЛЕНЫ.
  //
  // Хуки git лежат в `.git/hooks`, а `.git` с клоном не копируется. Поэтому
  // они лежат в репозитории, а git направляется туда настройкой
  // `core.hooksPath` — одной командой, которую даёт посадка. Команду можно не
  // дать, отменить или перенаправить, и тогда ворота молчат: правка без свода
  // проходит в коммит, и узнаёт об этом только ревизия по истории, позже.
  //
  // Сверка говорит это вслух. Ревизия остаётся вторым слоем: она ловит и
  // снятые ворота, и обход флагом.
  const gateGap = [];
  let gateLooked = 0;
  let gateNote = null;
  {
    const mapAt = shelfAt("seat/map.json");
    const said = mapAt === null ? null : readJson(mapAt, {}).gitHooks;
    if (said == null) gateGap.push("папка хуков не объявлена картой посадки");
    else {
      gateLooked = (said.hooks ?? []).length;
      for (const one of said.hooks ?? []) {
        const at = path.join(REPO_AT, said.dir, one);
        if (!existsSync(at))
          gateGap.push(
            said.dir + "/" + one + " — объявлен картой, а файла нет",
          );
        // Хук без бита исполнения git пропускает одной подсказкой, и коммит
        // идёт мимо ворот. Замерено посадкой из свежего клона полки: хук
        // лежал там с режимом `100644`, и ворота не срабатывали ни разу.
        else if (
          process.platform !== "win32" &&
          (statSync(at).mode & 0o111) === 0
        )
          gateGap.push(
            said.dir +
              "/" +
              one +
              " — не исполняемый: git его пропускает, и коммит идёт мимо ворот. `chmod +x " +
              said.dir +
              "/" +
              one +
              "`",
          );
      }
      // «Репозитория нет» и «настройка не задана» — разные ответы, и обе
      // команды падают одинаково. Проект без git коммитов не делает, дыры у
      // него нет, и краснеть тут не на что: сверка это НАЗЫВАЕТ, а не молчит.
      const { execFileSync } = await import("node:child_process");
      const gitSays = (args) => {
        try {
          return execFileSync("git", args, {
            cwd: REPO_AT,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
        } catch {
          return null;
        }
      };
      const repo = gitSays(["rev-parse", "--git-dir"]);
      const where =
        repo === null ? null : gitSays(["config", "core.hooksPath"]);
      // Проект со своим менеджером хуков держит `core.hooksPath` за собой и
      // возвращает его при каждой установке пакетов: husky делает это
      // сценарием `prepare`. Направить git к нам там нельзя — следующая
      // установка молча вернёт своё. Ворота тогда зовутся ИЗ его хука, и
      // сверка принимает это, найдя вызов режима в хуке, который git
      // исполнит: у husky девятой версии это хук папкой выше служебной `_`.
      // Замерено посадкой в проект на husky: после установки пакетов ворота
      // молчали, а сверка требовала настройки, которая не держится.
      const callsGate = (dir) =>
        [
          path.join(REPO_AT, dir, "pre-commit"),
          ...(path.basename(dir) === "_"
            ? [path.join(REPO_AT, path.dirname(dir), "pre-commit")]
            : []),
        ].some(
          (at) =>
            existsSync(at) &&
            /graph\.mjs["']?\s+gate\b/.test(readFileSync(at, "utf8")),
        );
      if (repo === null)
        gateNote = "репозитория нет: коммитов не делают, и ворота не нужны";
      else if (where === null)
        gateGap.push(
          "`core.hooksPath` не задан — ворота не установлены: `git config core.hooksPath " +
            said.dir +
            "`",
        );
      else if (norm(where) !== norm(said.dir) && !callsGate(where))
        gateGap.push(
          "`core.hooksPath` ведёт в " +
            where +
            ", а ворота лежат в " +
            said.dir +
            ", и хук " +
            where +
            " ворот не зовёт. Свой менеджер хуков — вызов " +
            "`node .claude/tools/graph.mjs gate` в его хуке перед коммитом",
        );
    }
  }
  // Мутационный прогон, объявленный проектом, ИСПОЛНИМ.
  //
  // Доктрина требует его по новым файлам — `code.md`, шаг прогона. Держался
  // он одним лишь режимом долга, а режим зовут руками, и до этой сверки он
  // на три состояния из четырёх отвечал зелёным.
  //
  // Спрашивается всё, без чего прогон невозможен: файл конфига на месте,
  // область в нём заполнена, а не стоит заглушкой семени, и сам прогон есть
  // среди зависимостей. Объявить и не мочь — хуже, чем не объявлять: режим
  // долга тогда считает по пустой области и докладывает ноль.
  //
  // Найдено вопросом разработчика «прогонялось ли написанное Stryker». На
  // стенде область стояла заглушкой с посадки, пакетов прогона не было ни
  // одного, и всё это молчало.
  const mutGap = [];
  let mutLooked = 0;
  let mutNote = null;
  {
    if (CONFIG.mutationConfig == null)
      mutNote = "мутационный прогон в этом проекте не заявлен";
    else {
      mutLooked = 1;
      const at = path.join(BASE, CONFIG.mutationConfig);
      if (!existsSync(at))
        mutGap.push(
          "конфиг объявлен полем `mutationConfig`, а файла нет: " +
            CONFIG.mutationConfig,
        );
      else {
        const mutConf = readJson(at, {});
        const area = mutConf.mutate ?? [];
        // Папка обвязки в песочнице прогона — чужой груз с последствием:
        // прогон вписывает `// @ts-nocheck` первой строкой в файлы кода под
        // `src/`, `lib/` и `test/` где угодно в дереве, в том числе в семена
        // обвязки, и её тест, сажающий снимок в пустую папку, падает в
        // пробном прогоне — мутационный прогон проекта не стартует вовсе.
        // Замерено посадкой руками.
        const shelfName =
          SHELF === null ? null : path.relative(REPO, SHELF).split(path.sep)[0];
        if (
          shelfName !== null &&
          !(mutConf.ignorePatterns ?? []).some(
            (one) => String(one).replace(/^\/|\/$/g, "") === shelfName,
          )
        )
          mutGap.push(
            'песочница прогона копирует папку обвязки и правит её семена: тест обвязки падает, прогон не стартует. Нужно `ignorePatterns: ["' +
              shelfName +
              '"]`',
          );
        // Раннер тестов по умолчанию ищет тесты, СВЯЗАННЫЕ с мутируемым
        // файлом. Узел без своих тестов — обычное дело в живом проекте — не
        // даёт ни одного, и прогон падает стеком «No tests were executed…
        // check your configuration»: вместо замера «убито ноль» разработчик
        // получает ошибку, указывающую на настройку обвязки. Замерено
        // посадкой руками в живой проект с одним компонентом без тестов.
        if (
          mutConf.testRunner === "vitest" &&
          mutConf.vitest?.related !== false
        )
          mutGap.push(
            "раннер ищет только тесты, связанные с мутируемым файлом: узел без своих тестов роняет прогон ошибкой настройки вместо замера. Нужно `vitest.related: false`",
          );
        if (
          area.length === 0 ||
          area.every((g) => /^<.*>$/.test(String(g).trim()))
        )
          mutGap.push(
            "область прогона не заполнена: в конфиге стоит заглушка с посадки",
          );
        // Область, ЗАПОЛНЕННАЯ путями, по которым ничего не лежит, бесполезна
        // так же, как заглушка, и выглядит наоборот — заполненной. Случай не
        // выдуманный: семя кладёт умолчание под раскладку обвязки, а проект со
        // своей раскладкой держит узлы под другим именем слоя.
        // ...но у ПУСТОГО проекта узлов ещё нет вовсе, и мерить мутациями
        // нечего по построению. Слой компонентов заводится с первым
        // компонентом, а не посадкой: каркас кладёт приложение и общее, и
        // пустую папку под узлы завести нельзя — её запрещает соседняя
        // сверка. Пока это считалось находкой, пустой проект не мог пройти
        // СВОЙ ЖЕ рубеж: он требует нулевого кода возврата. Замерено первой
        // посадкой в пустой проект за всю серию.
        else if (mutationArea().length === 0) {
          const seeds = seedOfPath();
          const own = [...files, ...styleFiles].filter((f) => {
            if (isTest(f) || f.endsWith(".d.ts")) return false;
            const to = norm(path.relative(path.join(BASE, ".."), f));
            const from = seeds.has(to) ? shelfAt(seeds.get(to)) : null;
            if (from === null || !existsSync(from)) return true;
            if (SEEDS_REFORMATTED.has(to)) return false;
            return !sameAsSeed(
              readFileSync(f, "utf8"),
              readFileSync(from, "utf8"),
            );
          });
          if (own.length > 0)
            mutGap.push(
              "область прогона не совпала ни с одним файлом: пути есть, предмета нет",
            );
          else
            mutNote =
              "мерить мутациями нечего: своих узлов в проекте ещё нет. Область заполнится вместе с первым";
        }
      }
      const manifest = path.join(BASE, "..", "package.json");
      const pkg = readJson(manifest, {});
      const deps = Object.keys({
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      });
      if (!deps.some((d) => /^@stryker-mutator\//.test(d)))
        mutGap.push(
          "прогон объявлен, а инструмента нет: ни одного пакета `@stryker-mutator/` в манифесте",
        );
    }
  }
  // В корне папки узла — только то, что отвечает за узел целиком.
  //
  // Раскладка проекта отвечает, куда кладут узел; внутри его папки раскладки
  // не было вовсе, и держалось это на вкусе. Первый вынесенный помощник
  // ложится в корень папки, второй рядом, десятый превращает корень в
  // свалку, где сам узел уже не найти глазом.
  //
  // Корень узла держит: сам узел, его лист, его типы, и папки `tests/`,
  // `docs/`. Всё прочее — в папке по смыслу. Папка заводится со ВТОРОГО
  // файла: один помощник в корне законен, папка на один файл — лишний
  // уровень.
  //
  // Имя узла берётся у папки, а не угадывается: папка компонента названа им
  // же, и файл узла лежит её именем со строчной буквы либо точно её именем.
  const nodeLitter = [];
  let nodeLooked = 0;
  {
    // Слой компонентов — СПИСОК имён под корнем исходников, и умолчание у
    // него то же, что у соседних сверок. Своя форма здесь разошлась бы с ними
    // при первом же проекте, объявившем два слоя.
    for (const layer of CONFIG.componentsAt ?? ["components"]) {
      const root = path.join(ROOT, layer);
      if (!existsSync(root)) continue;
      for (const name of readdirSync(root)) {
        const folder = path.join(root, name);
        if (!statSync(folder).isDirectory()) continue;
        nodeLooked += 1;
        const loose = [];
        for (const one of readdirSync(folder)) {
          const inside = path.join(folder, one);
          if (statSync(inside).isDirectory()) continue;
          const bare = one.replace(/\.[^.]+$/, "").replace(/\.module$/, "");
          if (bare.toLowerCase() === name.toLowerCase()) continue;
          if (one === "types.ts" || one === "index.ts" || one === "index.tsx")
            continue;
          if (!isCodePath(norm(inside)) && !isStylePath(norm(inside))) continue;
          loose.push(one);
        }
        // Один в корне законен: папка на один файл — лишний уровень.
        if (loose.length > 1)
          nodeLitter.push(
            layer +
              "/" +
              name +
              " — в корне узла лежит не только он: " +
              loose.join(", ") +
              ". Развести по папкам ПО СМЫСЛУ",
          );
      }
    }
  }
  // Разложить узел по папкам — правка кода, а посадка код не трогает: живой
  // проект держит свалку открытой строкой реестра, строка на узел.
  const litterOpen = Math.min(
    nodeLitter.length,
    openFindings().get("В корне узла только сам узел") ?? 0,
  );
  checkHead("В корне узла только сам узел", {
    n: nodeLooked,
    unit: "папок узлов",
  });
  console.log("  со свалкой в корне: " + (nodeLitter.length - litterOpen));
  if (litterOpen > 0)
    console.log("  держатся открытыми строками реестра: " + litterOpen);
  for (const one of nodeLitter.slice(litterOpen)) console.log("    " + one);
  // Названное доктриной ИСПОЛНИМО.
  //
  // Класс находки: требование стояло, а инструмента не было. Замерено на
  // мутационном прогоне: `code.md` требовал его по новым файлам, конфиг
  // приезжал с заглушкой вместо области, пакетов не было ни одного, а режим
  // долга отвечал зелёным. Обещание без опоры — не мелочь, о которой помнят:
  // оно не проявляется, пока помнят, и проявляется, когда забыли.
  //
  // Спрашивается всё, что проза велит ЗАПУСКАТЬ: звено связки, пакет,
  // режим инструмента. Три вида, и все три проверяемы точно — ни одного
  // суждения. Обход по всей доктрине дал ровно один случай, и это был он.
  //
  // Блоки кода снимаются: пример — не требование. Тем же съёмником и по той
  // же причине, что у прочих сканеров прозы.
  const unrunnable = [];
  let runnableLooked = 0;
  {
    const seedAt = shelfAt("seat/templates/package.json");
    const seed = seedAt === null ? {} : readJson(seedAt, {});
    const scripts = new Set(Object.keys(seed.scripts ?? {}));
    const deps = Object.keys({
      ...(seed.dependencies ?? {}),
      ...(seed.devDependencies ?? {}),
    });
    const said = new Set();
    const say = (what, why, where) => {
      if (said.has(what)) return;
      said.add(what);
      unrunnable.push(what + " — " + why + " (" + where + ")");
    };
    const RUN = /npm run ([a-z:]+)/g;
    const NPX = /npx ([@a-z0-9/-]+)/g;
    const MODE = /graph\.mjs ([a-z-]+)/g;
    const BASE_FILE = /`(\d\d-[a-z]+\.md)`/g;
    const SEED_PATH = /seat\/templates\/([A-Za-z0-9_./-]*[A-Za-z0-9_])/g;
    // Семя → кладёт ли его посадка. Кладёт — всё из `copy`, кроме помеченного
    // `notAtSeating`; семена по предмету и по переходу — нет.
    const seatEntries = (() => {
      const out = new Map();
      const mapAt = shelfAt("seat/map.json");
      if (mapAt === null || !existsSync(mapAt)) return out;
      const seat = readJson(mapAt, {});
      for (const e of seat.copy ?? [])
        out.set(e.from, { laidBySeat: e.notAtSeating == null });
      for (const e of [...(seat.onSubject ?? []), ...(seat.onTransition ?? [])])
        out.set(e.from, { laidBySeat: false });
      return out;
    })();
    // Помощник прозы отдаёт ПАРУ ПУТЕЙ — короткий для сообщений и полный для
    // чтения, — а не текст. Первая редакция сканировала строку полного пути и
    // молчала всегда: сверка, заведённая против зелёного без проверки, сама им
    // и была. Найдено подсадкой всех трёх видов сразу.
    // Корпус — проза ПОЛКИ и проза БАЗЫ ПРОЕКТА. Вопрос к ним один и тот
    // же: названа команда — она обязана существовать. Пока спрашивалась
    // одна полка, план перехода мог звать режим, которого у инструмента
    // нет, и прогон молчал. Замерено на собственном плане: последний шаг
    // звал `graph.mjs snapshot` — режим, которого не было никогда.
    const baseProse = readdirSync(BASE)
      .filter((e) => e.endsWith(".md"))
      .map((e) => [e, path.join(BASE, e)]);
    // Проза ОБВЯЗКИ говорит семенными именами — она одна на все проекты, —
    // и спрашивается с манифестом семени. Проза БАЗЫ пишется про этот проект
    // и его же командами, и спрашивается с его манифестом. Прежде обе шли
    // по семени: живой проект держит звено типов под именем `types`, базовая
    // линия записала замер его командой — и сверка ответила «звена нет в
    // манифесте проекта» про звено, которое там есть. Замерено посадкой
    // руками в проект со своим именем звена.
    const own = readJson(path.join(BASE, "..", "package.json"), {});
    const ownScripts = new Set(Object.keys(own.scripts ?? {}));
    const ownDeps = Object.keys({
      ...(own.dependencies ?? {}),
      ...(own.devDependencies ?? {}),
    });
    const shelfSide = new Set(shelfProse().map(([, full]) => full));
    for (const [where, full] of [...shelfProse(), ...baseProse]) {
      runnableLooked += 1;
      const flat = unfenced(readFileSync(full, "utf8"));
      const fromShelf = shelfSide.has(full);
      const names = fromShelf ? scripts : ownScripts;
      const packs = fromShelf ? deps : ownDeps;
      const whose = fromShelf ? "манифесте семени" : "манифесте проекта";
      for (const m of flat.matchAll(RUN))
        if (!names.has(m[1]))
          say("npm run " + m[1], "звена нет в " + whose, where);
      for (const m of flat.matchAll(NPX))
        if (!packs.some((d) => d === m[1] || d.includes(m[1])))
          say("npx " + m[1], "пакета нет в " + whose, where);
      for (const m of flat.matchAll(MODE))
        if (!toolModes().includes(m[1]))
          say("graph.mjs " + m[1], "такого режима у инструмента нет", where);
      // Четвёртый вид: файл базы, названный прозой по имени. Запускать его не
      // велят, но требование он несёт то же самое — «запиши это туда», — и без
      // семени исполнить его нечем: разработчик выдумывает и файл, и форму
      // таблицы в нём. Замерено на переходе живого проекта: сверка потребовала
      // объявить таблицу связей через разметку и стили, доктрина назвала для
      // неё `03-graph.md`, а полка не везла ни семени, ни записи в карте — и
      // шапки таблицы пришлось вычитывать из разбора вот в этом файле.
      for (const m of flat.matchAll(BASE_FILE))
        if (!seededBase().has(m[1]))
          say(m[1], "файла базы нет ни в семенах, ни в карте посадки", where);
      // Пятый вид: СЕМЯ, названное прозой по пути. Что откуда куда и КОГДА
      // кладётся, объявляет карта, и она единственный источник; проза,
      // повторяющая это, расходится с ней при первой же правке карты.
      // Замерено посадкой руками: конфиг мутационного прогона переехал в
      // посадку, починку записали в шаге 1 — а последний раздел инструкции
      // по-прежнему велел класть его «не при посадке», руками и потом.
      //
      // Спрашивается узко: названное семя существует, и абзац, говорящий
      // о нём «не при посадке», говорит это про семя, которое карта и правда
      // не кладёт посадкой. Семена по предмету и по переходу — законно такие.
      // Единица — абзац, а у таблицы строка: строки таблицы идут подряд без
      // пустой, и «не на посадке» одной строки иначе цеплялось к семени,
      // названному другой.
      const units = flat
        .split(NEWLINE + NEWLINE)
        .flatMap((p) =>
          p.trimStart().startsWith("|") ? p.split(NEWLINE) : [p],
        );
      for (const para of units) {
        const deferred = /не (?:при|на) посадке/.test(para);
        for (const m of para.matchAll(SEED_PATH)) {
          const seed = "seat/templates/" + m[1];
          const entry = seatEntries.get(seed);
          if (entry === undefined) {
            const seedAt = shelfAt(seed);
            if (seedAt === null || !existsSync(seedAt))
              say(seed, "такого семени на полке нет", where);
            continue;
          }
          if (deferred && entry.laidBySeat)
            say(
              seed,
              "проза кладёт его не при посадке, а карта — посадкой",
              where,
            );
        }
      }
    }
  }
  // Команда долга мутаций в правилах проекта — ровно тогда, когда мутационный
  // прогон объявлен. Семя правил описывало эту команду абзацем, а в его
  // таблице её не было вовсе; проект без мутаций получал абзац о команде,
  // которой ему нечего спрашивать. Найдено ревизией правил посаженных
  // стендов. Спрашивается в обе стороны: названа без прогона — требование
  // без предмета; прогон есть, а команды нет — отчёт о правке её не спросит.
  {
    const mine = (CONFIG.rulesManifest?.rules ?? [])
      .map((one) => path.join(BASE, one))
      .filter((one) => existsSync(one));
    if (mine.length) {
      const said = mine
        .map((one) => readFileSync(one, "utf8"))
        .some((body) => /graph\.mjs mutated/.test(body));
      if (said && CONFIG.mutationConfig == null)
        unrunnable.push(
          "правила проекта называют `graph.mjs mutated`, а мутационного прогона у проекта нет: снять строку таблицы и слова о команде",
        );
      if (!said && CONFIG.mutationConfig != null)
        unrunnable.push(
          "мутационный прогон объявлен, а правила проекта не называют `graph.mjs mutated` — команду его долга, часть каждого отчёта о правке",
        );
    }
  }
  checkHead("Названное доктриной исполнимо", {
    n: runnableLooked,
    unit: "файлов прозы обвязки и базы",
  });
  console.log("  требований без инструмента: " + unrunnable.length);
  for (const one of unrunnable) console.log("    " + one);
  checkHead("Мутационный прогон исполним", {
    n: mutLooked,
    unit: "объявлений мутационного прогона",
  });
  console.log(
    mutNote === null ? "  нечем исполнить: " + mutGap.length : "  " + mutNote,
  );
  for (const one of mutGap) console.log("    " + one);
  checkHead("Ворота перед коммитом установлены", {
    n: gateLooked,
    unit: "объявленных хуков git",
  });
  console.log(
    gateNote === null ? "  не на месте: " + gateGap.length : "  " + gateNote,
  );
  for (const one of gateGap) console.log("    " + one);
  checkHead("Коммит с кодом накрыт сводом", {
    n: barPastLooked,
    unit: "коммитов с кодом после основания",
  });
  console.log(
    barPastNote === null
      ? "  без свода: " + barPast.length
      : "  " + barPastNote,
  );
  for (const one of barPast)
    console.log(
      "    " + one + ". Свод делают ДО коммита и кладут в тот же коммит",
    );
  checkHead("Планка пройдена покритериально", {
    n: barCriteriaLive,
    unit: "живых критериев планки",
  });
  if (barSaid !== null) console.log("  " + barSaid);
  // Находка печатается отступом в ЧЕТЫРЕ пробела: именно по нему её узнаёт
  // разбор вывода, которым фальсификация отличает выросшую секцию от
  // прежней. Напечатанная мельче, она видна глазу и не видна прогону.
  if (barGaps.length) console.log("  дыр: " + barGaps.length);
  for (const g of barGaps) console.log("    " + g);
  if (barGaps.length)
    console.log(
      "  Позвать режим `bar` и пройти по критериям: свод без печати не свод.",
    );

  // 44a. Файл базы заведён под свой предмет.
  //
  // Часть файлов базы приезжает не на посадке, а когда в коде появляется их
  // предмет: состояние и порядок выполнения. У пустого проекта их нет, у живого
  // они обычно есть с первого дня — и не спрашивал о них никто. Доктрина велит
  // заводить их «с первого состояния» и «с первого эффекта или таймера», а
  // machinery у этого требования не было: прогон вообще не знал, что такие
  // файлы бывают. Найдено вопросом человека при разборе плана перехода.
  //
  // Предмет ищется в ИСПОЛНЯЕМОМ тексте исходников, мимо тестов: тест вправе
  // завести состояние ради самой проверки, и требовать из-за этого записи о
  // состоянии проекта значило бы краснеть на законном.
  const SUBJECTS = BRIEF_SUBJECTS;
  const baseGap = [];
  const baseMute = [];
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt)) {
      const seatMap = JSON.parse(readFileSync(mapAt, "utf8"));
      const body = files
        .filter((f) => !isTest(f))
        .map((f) => readFileSync(f, "utf8"))
        .join(NEWLINE);
      for (const one of seatMap.onSubject ?? []) {
        const re = SUBJECTS[one.subject];
        if (re === undefined) {
          baseGap.push(one.to + " — предмет «" + one.subject + "» неизвестен");
          continue;
        }
        if (!re.test(body)) continue;
        const at = path.join(REPO, one.to);
        if (!existsSync(at)) {
          baseGap.push(
            one.to + " — предмет в коде есть, а файла базы нет: " + one.subject,
          );
          continue;
        }
        // Вторая сторона: файл заведён и молчит. Спрашивается НАЗВАН ЛИ
        // АДРЕС — самое слабое, что вообще проверяемо, и этого довольно:
        // пустая таблица не называет ни одного.
        const said = readFileSync(at, "utf8");
        for (const f of files) {
          if (isTest(f)) continue;
          if (!re.test(readFileSync(f, "utf8"))) continue;
          if (said.includes(rel(f))) continue;
          baseMute.push(
            one.to +
              " — не назван " +
              rel(f) +
              ", а предмет в нём есть: " +
              one.subject,
          );
        }
      }
    }
  }
  checkHead("Файлы базы заведены под свой предмет", {
    n: subjectsDeclared.length,
    unit: "предметов базы",
  });
  console.log("  предмет есть, файла нет: " + baseGap.length);
  for (const g of baseGap) console.log("    " + g);

  // 45a. Каркас обвязки не лежит в живом проекте.
  //
  // Каркас — точка входа, корневой компонент, разметка страницы и тест на неё —
  // нужен ПУСТОМУ проекту, чтобы цепочке было на чём прогнаться с первого дня.
  // Живому он не нужен: у того свой корень.
  //
  // Правило это в карте помечено `onlyWhenEmpty`, и посадка читала пометку как
  // «путь свободен». Замерено на чужой библиотеке: путям не обо что было
  // столкнуться — проект держит код в `lib/`, а каркас кладётся в `src/`, — и
  // каркас приехал ЦЕЛИКОМ. В пакет с `exports` и одноранговыми зависимостями
  // легли демо-приложение, страница и второй корень исходников.
  //
  // Настоящий признак другой и проверяется здесь: файл каркаса лежит ПОБАЙТОВО
  // такой же, как семя, а рядом есть чужой код. Побайтово — потому что каркас,
  // который начали править, каркасом быть перестал: это уже корень проекта.
  const frameLitter = [];
  const FRAME_OPEN = "<!-- КАРКАС -->";
  const FRAME_SHUT = "<!-- /КАРКАС -->";
  /** Номера строк файла базы, накрытых пометкой каркаса. Нужны дважды: чтобы
   * назвать блок целиком и чтобы не называть его строки ВТОРОЙ раз адресом —
   * снимут их всё равно вместе с блоком. */
  //
  // Блок из одних СТРОК ТАБЛИЦЫ сюда не входит: прозой его не называет
  // третья сторона — она отдаёт такие блоки поадресной ветке, — и поадресная
  // обязана их видеть. Прежде обе стороны ссылались друг на друга, и строки
  // таблиц под пометкой не называл никто. Замерено посадкой руками в живой
  // проект со своими `main.tsx` и `App.tsx`: строки карты о них остались
  // описанием чужих файлов, никем не читанных, долг карты занизился на два,
  // а строку реестра о тесте, которого нет, называли две сверки, и ни одна —
  // как мусор посадки.
  const tableOnly = (block) => {
    const inside = block.filter((l) => l.trim() !== "");
    return inside.length > 0 && inside.every((l) => l.trim().startsWith("|"));
  };
  const markedLines = (lines) => {
    const out = new Set();
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== FRAME_OPEN) continue;
      let shut = i + 1;
      while (shut < lines.length && lines[shut].trim() !== FRAME_SHUT)
        shut += 1;
      if (!tableOnly(lines.slice(i + 1, shut)))
        for (let k = i; k <= Math.min(shut, lines.length - 1); k += 1)
          out.add(k);
      i = shut;
    }
    return out;
  };
  // Сколько семян каркаса лежит положенными и сколько у проекта своих файлов:
  // обе величины нужны и второй стороне сверки, и третьей, а считаются они
  // внутри блока, читающего карту посадки.
  const staleFrame = [];
  const emptyClaims = [];
  const emptySlots = [];
  let emptyLooked = 0;
  let frameLaid = 0;
  let frameOwn = 0;
  let frameLives = true;
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt)) {
      const seatMap = JSON.parse(readFileSync(mapAt, "utf8"));
      const frame = (seatMap.copy ?? []).filter((e) => e.onlyWhenEmpty);
      // Концы строк приводятся к одному виду: снимок едет между машинами, и на
      // машине с иной политикой побайтовое сравнение расходилось бы на каждой
      // строке, не говоря ничего о содержимом.
      const eol = String.fromCharCode(13) + NEWLINE;
      const same = (a, b) =>
        readFileSync(a, "utf8").split(eol).join(NEWLINE) ===
        readFileSync(b, "utf8").split(eol).join(NEWLINE);
      const laid = frame.filter((e) => {
        const to = path.join(REPO, e.to);
        const from = shelfAt(e.from);
        return (
          existsSync(to) && from !== null && existsSync(from) && same(to, from)
        );
      });
      // Свой код — всё, что НЕ равно своему семени побайтово.
      //
      // Прежде исключались адреса каркаса, и пока семенами кода был один
      // каркас, это совпадало. Как только помощник слияния и файл подготовки
      // тестов поехали в каждый проект, они стали считаться собственным
      // кодом — и пустой проект, только что посаженный, объявлялся живым:
      // сверка докладывала, что каркас лежит при чужом коде, хотя этим
      // «чужим кодом» были её же семена.
      //
      // Признак верен в обе стороны: положенное посадкой семя своим кодом не
      // является, а файл живого проекта по тому же адресу семени не равен и
      // своим кодом остаётся.
      const seedAt = new Map();
      for (const e of seatMap.copy ?? []) {
        const from0 = shelfAt(e.from);
        if (from0 !== null) seedAt.set(norm(path.join(REPO, e.to)), from0);
      }
      const fromSeed = (f) => {
        const src = seedAt.get(f);
        return (
          src !== undefined && existsSync(src) && existsSync(f) && same(f, src)
        );
      };
      // Ищется свой код ПО ВСЕМУ РЕПОЗИТОРИЮ, а не под объявленным корнем
      // исходников. Корень объявляет настройка, а настройку правят ШАГОМ 2 —
      // после того, как шаг 1 уже решил, класть ли каркас. Проект, чьи
      // исходники лежат не в `src/`, на этом шаге виден пустым: каркас
      // ложится целиком, а потом и эта сверка смотрит в им же созданную
      // папку и докладывает «проект живёт каркасом».
      //
      // Замерено посадкой стенда с ДВУМЯ деревьями, `client/` и `server/`:
      // папки `src/` у него нет вовсе, и в живой проект легли чужая точка
      // входа, чужой корневой компонент и чужая страница.
      const everywhere = [];
      {
        const skip = new Set([
          ".claude",
          ".context",
          ".git",
          "node_modules",
          "docs",
          "dist",
          "coverage",
        ]);
        const walk = (dir) => {
          let kids = [];
          try {
            kids = readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of kids) {
            if (skip.has(e.name) || OUT_OF_TREE.has(e.name)) continue;
            const at = norm(path.join(dir, e.name));
            if (e.isDirectory()) walk(at);
            else if (
              (/[.][jt]sx?$/.test(e.name) || isStylePath(e.name)) &&
              norm(dir) !== norm(REPO)
            )
              everywhere.push(at);
          }
        };
        // Файлы В САМОМ КОРНЕ репозитория не считаются: там лежат конфиги
        // — сборщика, линтера, мутационного прогона, — и код проекта в корне
        // не держат. Иначе привезённый и правленый проектом конфиг сошёл бы
        // за свой код и объявил живым любой посаженный проект.
        walk(norm(REPO));
      }
      const own = everywhere.filter((f) => !fromSeed(f) && !isTest(f));
      // Обратная сторона того же признака: пока СВОЕГО КОДА НЕТ, проект
      // живёт каркасом — и каркас обязан быть тем самым, который проект
      // раздаёт. Это случай полки: она держит свою копию, чтобы цепочке
      // было на чём прогоняться, правит обе стороны руками, и правку
      // одной не ловило ничто. Появился свой код — сверка молчит, а про
      // оставшийся каркас спрашивает соседняя.
      // Признак «проект живёт каркасом» считается по НЕ-каркасным файлам.
      //
      // По всем считать нельзя: расхождение, которое сверка ищет, само делает
      // каркасный файл «своим кодом» и гасит её. Замерено посаженной
      // поломкой — строка, дописанная в корневой компонент, сверку не
      // разбудила, а усыпила.
      const frameTo = new Set(frame.map((e) => norm(path.join(REPO, e.to))));
      const ownOutsideFrame = own.filter((f) => !frameTo.has(f));
      frameLives = ownOutsideFrame.length === 0;
      // Записи о пустоте: посадка пишет правду, а свой код делает её ложью.
      // Маркер ставится там, где утверждается пустота, и обязан уйти вместе
      // с текстом. Признак тот же, что у каркаса: свой код вне каркаса.
      // Спрашивается САМО УТВЕРЖДЕНИЕ, а не пометка при нём.
      //
      // Пометка стоит в СЕМЕНИ и там же называет свои строки: всё, что
      // внутри неё, — текст, верный только для пустого проекта. Сверка
      // читает семя, берёт эти строки и ищет их в файле проекта.
      //
      // Прежде искалась пометка в файле ПРОЕКТА, и это ловилось снятием
      // одной строки. Замерено круговым прогоном стенда: переход снял пять
      // пометок, не тронув ни слова под ними, — свод идиом остался с
      // привезённым «Здесь пока нечего описывать» при готовом компоненте
      // рядом, и сверка вышла зелёной. То есть механизм закрывал ровно ту
      // работу, ради которой заведён, и закрывался жестом.
      //
      // Утверждение уходит только вместе с текстом, потому что спрашивают
      // текст. Пометка в файле проекта тоже считается: её оставили — значит
      // оставили и то, что она накрывает.
      {
        const OPEN = "<!-- ПУСТО -->";
        const SHUT = "<!-- /ПУСТО -->";
        for (const e of seatMap.copy ?? []) {
          const seedAt = shelfAt(e.from);
          if (seedAt === null || !existsSync(seedAt)) continue;
          const seed = unfenced(readFileSync(seedAt, "utf8")).split(NEWLINE);
          const claim = [];
          for (let i = 0; i < seed.length; i += 1) {
            if (seed[i].trim() !== OPEN) continue;
            let shut = i + 1;
            while (shut < seed.length && seed[shut].trim() !== SHUT) {
              const row = seed[shut].trim();
              if (row !== "") claim.push(row);
              // Место под заполнение ВНУТРИ записи о пустоте — противоречие в
              // самом семени: пометка велит снять блок целиком с первой
              // строкой своего кода, и заполненное уйдёт вместе с ним. Так
              // стояли сводка о проекте в карте и базовая линия в фактах:
              // заполнив их в фазе 2, пустой проект с первой строкой кода
              // получил бы требование их снять. Найдено посадкой руками.
              if (/<(?!!--)[^<>]{3,}>/.test(row))
                emptySlots.push(
                  e.from +
                    ":" +
                    (shut + 1) +
                    " — внутри записи о пустоте стоит место под заполнение: заполненное уйдёт вместе с пометкой",
                );
              shut += 1;
            }
            i = shut;
          }
          if (!claim.length) continue;
          const at = path.join(REPO, e.to);
          if (!existsSync(at)) continue;
          // Корпус считается в СТРОКАХ, а не в файлах: находки — строки, и
          // пока счёт шёл по файлам, прогон печатал «осмотрено 5» над
          // списком из 36 находок. Найдено больше, чем осмотрено, —
          // отличить здоровье от слепоты по такому числу нельзя вовсе.
          const rows = unfenced(readFileSync(at, "utf8")).split(NEWLINE);
          emptyLooked += rows.length;
          if (frameLives) continue;
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i].trim();
            if (!claim.includes(row) && row !== OPEN) continue;
            emptyClaims.push(
              norm(at).slice(norm(REPO).length + 1) +
                ":" +
                (i + 1) +
                " — утверждает пустоту, а свой код уже есть",
            );
          }
        }
      }
      if (frameLives)
        for (const e of seatMap.copy ?? []) {
          const from0 = shelfAt(e.from);
          const to0 = norm(path.join(REPO, e.to));
          if (from0 === null || !existsSync(from0)) continue;
          if (!existsSync(to0) || !files.includes(to0)) continue;
          if (same(to0, from0)) continue;
          staleFrame.push(
            e.to +
              " — расходится со своим семенем " +
              e.from +
              ". Править обе стороны одной правкой",
          );
        }
      // Законный выход: запись решения, называющая адрес. Проект, выросший
      // из пустого, вправе оставить файл каркаса как есть — менять в нём
      // могло быть нечего, — и тогда это решение с причиной, а не мусор.
      // Без выхода сверка краснела бы навсегда, а красное навсегда
      // перестают читать.
      const decidedAt =
        CONFIG.decisions == null ? null : path.join(BASE, CONFIG.decisions);
      const decided =
        decidedAt !== null && existsSync(decidedAt)
          ? readFileSync(decidedAt, "utf8")
          : "";
      frameLaid = laid.length;
      frameOwn = own.length;
      if (laid.length && own.length)
        for (const e of laid.filter((e) => !decided.includes(e.to)))
          frameLitter.push(
            e.to +
              " — приехал семенем каркаса и своим не стал, а в проекте уже " +
              own.length +
              " своих файлов. Переписать под проект либо назвать решением",
          );

      // Вторая сторона: не сам каркас, а ЗАПИСИ семян базы о нём.
      //
      // Каркас в живой проект не кладётся, а семена базы описывают его
      // безусловно: карта несёт таблицу его файлов, реестр тестов — строку про
      // тест корневого компонента, реестр решений — два решения с якорями в
      // него. В живом проекте все они указывают в пустоту с первого прогона.
      //
      // Прежде список того, что снять, стоял в инструкции ПРОЗОЙ и был
      // неполон: он называл два файла базы из трёх. Карту снимали руками три
      // посадки подряд, и инструкция сама же предупреждала, что список
      // закрытый и может отстать. Отстал. Теперь он не список, а замер:
      // адреса каркаса известны карте посадки, и запись, называющая
      // несуществующий адрес каркаса, находится пофайлово и построчно.
      //
      // Признаков два, и одного было мало.
      //
      // Первый: адреса каркаса на диске нет вовсе — запись указывает в пустоту.
      //
      // Второй заведён по дыре: живой проект держит свой корневой компонент
      // РОВНО ПО ТОМУ ЖЕ АДРЕСУ, куда каркас кладёт семя. Существование файла
      // там ничего не говорит о записи — приехавшая строка карты садится на
      // чужой файл как его описание, и никто этого файла не читал. Прежде такая
      // запись проходила молча, а сверка покрытия карты считала файл описанным:
      // замерено посадкой в живой проект — `4` неописанных файла вместо `6`,
      // то есть заниженный на два долг.
      //
      // Различается это дословным совпадением со строкой СЕМЕНИ базы: семена
      // едут вместе с обвязкой, и строку, написанную самим проектом, там не
      // найти. Ложного срабатывания, ради которого стоял первый признак, при
      // этом не возникает: описав файл своими словами, проект выходит из-под
      // сверки той же правкой.
      // Семена берутся ТОЛЬКО из папки базы: сверка ниже перебирает её файлы
      // по именам, и семя с тем же базовым именем, лежащее в корне проекта,
      // молча заслонило бы настоящее. Совпадения сегодня нет, но это свойство
      // нынешней карты, а не правило.
      const seedText = new Map();
      for (const e of seatMap.copy ?? []) {
        const to = path.resolve(REPO, e.to);
        if (norm(path.dirname(to)) !== norm(BASE)) continue;
        const from = shelfAt(e.from);
        if (from === null || !existsSync(from)) continue;
        seedText.set(path.basename(e.to), readFileSync(from, "utf8"));
      }
      const laidTo = new Set(laid.map((e) => e.to));
      if (own.length)
        for (const e of frame) {
          if (laidTo.has(e.to)) continue;
          // База пишет адреса и полностью, и от корня исходников: тест
          // каркаса назван в реестре как `tests/App.test.tsx`, а в карте
          // посадки он `src/tests/App.test.tsx`. Ищутся обе формы.
          //
          // Но короткая форма берётся, ТОЛЬКО пока она остаётся путём. У
          // `src/App.tsx` она вырождается в голое имя файла и совпадает с чем
          // угодно: живой проект держит свой `app/App.tsx`, и запись о нём
          // объявлялась записью о каркасе. Ложное срабатывание, и первое, что
          // оно сделало, — велело снять верную запись карты. Голое имя
          // неоднозначно по построению, и спрашивать по нему нельзя.
          const short = e.to.replace(/^src\//, "");
          const forms = short.includes("/") ? [e.to, short] : [e.to];
          for (const f of readdirSync(BASE)) {
            if (!f.endsWith(".md")) continue;
            const lines = readFileSync(path.join(BASE, f), "utf8").split(
              NEWLINE,
            );
            const covered = markedLines(lines);
            for (let i = 0; i < lines.length; i += 1) {
              if (covered.has(i)) continue;
              // Адрес сверяется ЦЕЛИКОМ, а не вхождением: живой проект держит
              // свой `app/App.tsx`, и вхождением он читался бы как запись о
              // каркасном `src/App.tsx` — ложное срабатывание на здоровом
              // проекте, поймано первым же таким проектом. Хвост `:строка`
              // снимается: реестр решений ссылается якорем с номером.
              const named = [...lines[i].matchAll(/`([^`]+)`/g)].map((m) =>
                // Обратный слэш здесь несёт весь смысл: без него это образец из
                // буквы «d», и хвост номера строки не снимался НИКОГДА. Сверка
                // тогда не могла увидеть ни одной записи, адресующей каркас
                // якорем, — то есть ровно реестр решений, который эта строка и
                // названа обслуживать. Замерено посадкой в живой проект: из двух
                // записей о несуществующем каркасе нашлась одна, голая, а запись
                // с якорем `src/App.tsx:4` прошла молча.
                m[1].replace(/:\d+(-\d+)?$/, ""),
              );
              if (!named.some((one) => forms.includes(one))) continue;
              // Адрес занят своим файлом проекта: тогда запись уличает
              // только дословное совпадение со строкой семени.
              let why =
                " — запись семени о каркасе, которого в этом проекте нет: ";
              if (existsSync(path.join(REPO, e.to))) {
                const seed = seedText.get(f);
                if (seed === undefined) continue;
                if (!seed.split(NEWLINE).includes(lines[i])) continue;
                why =
                  " — запись семени о каркасе, а по адресу лежит свой файл проекта, и он не читан: ";
              }
              {
                frameLitter.push(f + ":" + (i + 1) + why + e.to);
              }
            }
          }
        }
    }
  }
  // Третья сторона: ПРОЗА семян о каркасе.
  //
  // Две стороны выше опознают запись по названному в ней АДРЕСУ каркаса.
  // Абзац «Каркас, приехавший семенами: точка монтирования и корневой
  // компонент» адресов не называет вовсе — и в живом проекте оставался
  // стоять, утверждая заведомо ложное. Обоснования в таблице применимости
  // ссылались на него же.
  //
  // Список такого текста жил прозой в инструкции посадки и в рукописных
  // скриптах — и ровно так отставал: снимали руками, каждый раз заново, а
  // сверка при этом называла одну запись из пяти и молчала о прозе. Свод
  // требует обратного: список, обязанный догонять данные, данными и должен
  // быть. Поэтому текст помечен В САМИХ СЕМЕНАХ парой комментариев разметки
  // — пометка уезжает вместе с семенем и разойтись с текстом не может.
  //
  // Помеченное законно ровно тогда, когда каркас ПОЛОЖЕН. Не положен, а свой
  // код есть — это мусор посадки, и снимает его шаг 4.
  {
    const OPEN = FRAME_OPEN;
    const SHUT = FRAME_SHUT;
    if (frameLaid === 0 && frameOwn > 0 && existsSync(BASE))
      for (const f of readdirSync(BASE)) {
        if (!f.endsWith(".md")) continue;
        const lines = readFileSync(path.join(BASE, f), "utf8").split(NEWLINE);
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].trim() !== OPEN) continue;
          let shut = i + 1;
          while (shut < lines.length && lines[shut].trim() !== SHUT) shut += 1;
          // Блок из одних СТРОК ТАБЛИЦЫ не спрашивается прозой: строки карты
          // и реестров разбираются поадресно веткой выше, а помеченный блок
          // растёт вместе с проектом — новая строка приписывается в конец
          // таблицы и попадает внутрь него. Замерено задачей от разработчика:
          // снять помеченное значило снести собственную карту проекта.
          // Признак тот же, по которому поадресная ветка такой блок берёт:
          // один помощник на обе стороны, и разойтись им нечем.
          if (tableOnly(lines.slice(i + 1, shut))) {
            i = shut;
            continue;
          }
          frameLitter.push(
            f +
              ":" +
              (i + 1) +
              " — текст семени о каркасе, которого в этом проекте нет: строк " +
              (shut - i - 1),
          );
          i = shut;
        }
      }
  }
  checkHead("Предмет из кода назван в своём файле базы", {
    n: subjectsDeclared.length,
    unit: "предметов базы",
  });
  console.log(
    "  файлов с предметом без записи: " +
      baseMute.length +
      debtTail("subjects"),
  );
  debtNote("subjects", baseMute.length);
  for (const g of debtList("subjects", baseMute))
    console.log(
      "    " + g + ". Завести строку: владелец, кто пишет, кто читает",
    );

  // Файл базы о живом коде обязан назвать из него хоть один адрес.
  //
  // Соседняя сверка спрашивает, ушло ли ПРИВЕЗЁННОЕ утверждение о пустоте.
  // Её обходят, написав на его место СВОЁ: «здесь пока нечего описывать».
  // Замерено круговым прогоном стенда — переход заменил пять привезённых
  // записей своими, такими же пустыми, и обе сверки вышли зелёными при
  // готовом компоненте рядом.
  //
  // Спрашивается то же самое, что у предметов базы, и так же слабо:
  // НАЗВАН ЛИ ХОТЬ ОДИН АДРЕС своего кода. Слабо намеренно — судить
  // полноту прозы машине нечем, а назвать адрес нельзя, не прочитав код.
  // Именем считается и путь файла, и его имя без расширения, и имя папки
  // с заглавной: список поведения естественно зовёт узел именем, а не
  // путём. Папки со строчной буквы — `src`, `client` — не в счёт: они
  // попадаются в прозе сами собой и не говорят о прочтении кода.
  // Признак живого кода тот же, что у соседней сверки: СВОЙ файл вне каркаса.
  // По одному лишь наличию файлов судить нельзя — каркас есть у всякого
  // свежепосаженного проекта, и сверка краснела бы на пустом.
  const codeMute = [];
  let codeMuteLooked = 0;
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt)) {
      const declared =
        JSON.parse(readFileSync(mapAt, "utf8")).namesOwnCode ?? [];
      const own = files.filter((f) => !isTest(f));
      const tokens = new Set();
      const GENERIC = new Set(["index", "main", "app", "types", "utils"]);
      for (const f of own) {
        const address = rel(f);
        tokens.add(address);
        const parts = address.split("/");
        const base = (parts[parts.length - 1] ?? "").replace(/.[^.]+$/, "");
        if (base.length > 3 && !GENERIC.has(base.toLowerCase()))
          tokens.add(base);
        const folder = parts[parts.length - 2] ?? "";
        if (folder.length > 3 && /^[A-ZА-Я]/.test(folder)) tokens.add(folder);
      }
      for (const to of declared) {
        const at = path.join(REPO, to);
        if (!existsSync(at)) continue;
        codeMuteLooked += 1;
        if (frameLives) continue;
        const said = readFileSync(at, "utf8");
        let named = false;
        for (const t of tokens)
          if (said.includes(t)) {
            named = true;
            break;
          }
        if (!named)
          codeMute.push(
            to + " — свой код есть, а в файле не назван ни один его адрес",
          );
      }
    }
  }
  checkHead("Файл базы о живом коде назвал его адрес", {
    n: codeMuteLooked,
    unit: "файлов базы, обязанных назвать код",
  });
  console.log("  молчат о своём коде: " + codeMute.length);
  for (const g of codeMute)
    console.log("    " + g + ". Прочитать код и написать, что в нём есть");
  // Раздел планки объявлен по СВОЕМУ замеру, а не словом семени.
  //
  // Таблица применимости приезжает заполненной — под ПУСТОЙ проект, где
  // предмета нет ни у одного раздела. Живой проект наследует её целиком и
  // молча: приговоры инструмент меряет сам, а третью графу — обоснование —
  // не меряет ничто, и она остаётся словом, написанным до того, как код
  // прочитали.
  //
  // Замерено ревизией двух переведённых стендов. Обе базы утверждали
  // «текстов для человека в коде нет» при подписи кнопки и заголовке
  // бегущей строки, «ни промиса, ни таймера, ни отмены» при трёх снятиях
  // подписок, «зависимостей тоже нет» при пяти. Последнее — ложь и на самой
  // полке: семя манифеста везёт `react` и `react-dom`, то есть строка была
  // неверна с первой минуты и ни разу никем не прочитана.
  //
  // Спрашивается самое слабое, что тут проверяемо: ОТЛИЧАЕТСЯ ЛИ обоснование
  // от семенного. Переписать его нельзя, не прочитав код. Переформулировать
  // не читая — можно, и это не ловится ничем; но строка, к которой никто не
  // прикасался, ловится вся.
  const scopeSeeded = [];
  let scopeSeededLooked = 0;
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt) && CONFIG.qualityScope != null) {
      const tableAt = path.join(BASE, CONFIG.qualityScope.table);
      const copy = JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [];
      let seedAt = null;
      for (const e of copy) {
        if (norm(path.join(REPO, e.to)) !== norm(tableAt)) continue;
        seedAt = shelfAt(e.from);
      }
      if (seedAt !== null && existsSync(seedAt) && existsSync(tableAt)) {
        // Строка таблицы: `| X. имя | приговор | обоснование |`.
        // Строка помнит свой НОМЕР: находка называет адрес, и поломка даёт
        // новую строку вывода и там, где все разделы уже объявлены словом
        // семени. Без номера сверка, красная на всём предмете, — обычное
        // состояние живого проекта до перехода, — не могла показать ни одной
        // новой находки, и её рецепт уходил «не туда». Замерено посадкой
        // руками в живой проект.
        const rows = (text) => {
          const out = new Map();
          const lines = text.split(NEWLINE);
          for (let n = 0; n < lines.length; n += 1) {
            const m = /^\|\s*([K-U])\.[^|]*\|([^|]*)\|([^|]*)\|/.exec(lines[n]);
            if (m !== null) out.set(m[1], { said: m[3].trim(), at: n + 1 });
          }
          return out;
        };
        const seeded = rows(readFileSync(seedAt, "utf8"));
        const mine = rows(readFileSync(tableAt, "utf8"));
        for (const [letter, row] of mine) {
          scopeSeededLooked += 1;
          if (frameLives) continue;
          if (seeded.get(letter)?.said !== row.said) continue;
          scopeSeeded.push(
            letter + " (" + CONFIG.qualityScope.table + ":" + row.at + ")",
          );
        }
      }
    }
  }
  checkHead("Раздел планки объявлен по своему замеру", {
    n: scopeSeededLooked,
    unit: "разделов планки в таблице",
  });
  console.log("  объявлены словом семени: " + scopeSeeded.length);
  for (const g of scopeSeeded)
    console.log(
      "    раздел " +
        g +
        " — обоснование приехало семенем и не переписано. Прочитать код и написать, что замерено",
    );
  checkHead("Каркас обвязки не лежит в живом проекте", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  console.log("  семян каркаса при живом коде: " + frameLitter.length);
  for (const g of frameLitter) console.log("    " + g);

  // 45b. Один предмет — один файл настройки.
  //
  // Столкновение семени с проектным файлом посадка ищет ПО ИМЕНИ, а один и тот
  // же предмет живой проект часто держит под другим именем. Тогда столкновения
  // нет, семя ложится рядом, и два файла говорят об одном — по-разному.
  //
  // Замерено на чужой библиотеке дважды. Версия среды: привезённый `.nvmrc`
  // сказал `22`, проектный `.node-version` — `20.11.1`, и какой прочтёт
  // менеджер версий, зависит от того, какой менеджер стоит. Конфиг линтера:
  // привезённый плоский ПЕРЕХВАТИЛ проектный старого формата — не при
  // обновлении, а сразу, — и линтер стал падать на ненайденном пакете вместо
  // разбора кода.
  //
  // Пары «семя → другие его имена» объявлены в карте посадки, а не здесь:
  // список растёт вместе с составом семян, и держать его в инструменте значило
  // бы править инструмент при заведении каждого нового.
  const twinConfigs = [];
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt)) {
      const seatMap = JSON.parse(readFileSync(mapAt, "utf8"));
      for (const e of seatMap.copy ?? []) {
        if (!Array.isArray(e.alsoKnownAs) || !e.alsoKnownAs.length) continue;
        if (!existsSync(path.join(REPO, e.to))) continue;
        for (const other of e.alsoKnownAs)
          if (existsSync(path.join(REPO, other)))
            twinConfigs.push(
              e.to + " и " + other + " — один предмет, два файла настройки",
            );
      }
    }
  }
  checkHead("Запись о пустоте не пережила появление кода", {
    n: emptyLooked,
    unit: "строк в файлах, куда приехала пометка пустоты",
  });
  console.log(
    frameLives
      ? "  своего кода нет: записи о пустоте верны"
      : "  переживших: " + emptyClaims.length,
  );
  for (const one of emptyClaims)
    console.log(
      "    " + one + ". Снять маркер вместе с текстом и написать, что есть",
    );
  for (const one of emptySlots) console.log("    " + one);

  checkHead("Каркас не отстал от семени", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  console.log(
    frameLives
      ? "  расходится с семенем: " + staleFrame.length
      : IDLE_NOTES["Каркас не отстал от семени"],
  );
  for (const one of staleFrame) console.log("    " + one);

  // Якорь семени базы обязан попадать в семя кода.
  //
  // Семя реестра решений несёт якоря в каркас: путь, номер строки, цитата
  // пометки. Каркас правится, семя записи — нет, и якорь показывает мимо.
  // Цена платится не полкой: свежепосаженный проект получает базу, у которой
  // сверка пометок решений красная с первого прогона.
  //
  // Обе половины лежат на полке и правятся руками — сверять их может только
  // прогон. Проверяется попадание: цитата обязана стоять на названной строке
  // названного семени.
  const seedAnchors = [];
  let seedAnchorSaid = null;
  let seedAnchorCount = 0;
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt))
      seedAnchorSaid = "карты посадки рядом нет: полка не раздаётся отсюда";
    else {
      const copy = JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [];
      const seedOf = new Map();
      for (const e of copy) {
        const from0 = shelfAt(e.from);
        if (from0 !== null) seedOf.set(e.to, from0);
      }
      for (const e of copy) {
        const from0 = shelfAt(e.from);
        if (from0 === null || !existsSync(from0)) continue;
        if (!e.to.endsWith(".md")) continue;
        for (const line of readFileSync(from0, "utf8").split(NEWLINE)) {
          const m = /`([^`]+):([0-9]+)`\s+`([^`]+)`/.exec(line);
          if (m === null) continue;
          const [, at, no, quote] = m;
          const target = seedOf.get(at);
          seedAnchorCount += 1;
          if (target === undefined || !existsSync(target)) {
            seedAnchors.push(
              e.from + " → " + at + ": такого семени карта не везёт",
            );
            continue;
          }
          const rows = readFileSync(target, "utf8").split(NEWLINE);
          const row = rows[Number(no) - 1] ?? "";
          if (row.includes(quote)) continue;
          seedAnchors.push(
            e.from +
              " → " +
              at +
              ":" +
              no +
              " — цитаты " +
              barQuoted(quote) +
              " на этой строке нет",
          );
        }
      }
      if (seedAnchors.length === 0 && seedAnchorSaid === null)
        seedAnchorSaid = "якорей проверено: " + seedAnchorCount;
    }
  }
  checkHead("Якоря семени ведут в семя", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  if (seedAnchorSaid !== null) console.log("  " + seedAnchorSaid);
  if (seedAnchors.length) console.log("  мимо семени: " + seedAnchors.length);
  for (const one of seedAnchors)
    console.log("    " + one + ". Править семя записи вместе с семенем кода");
  checkHead("Один предмет — один файл настройки", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  console.log("  предметов с двумя файлами: " + twinConfigs.length);
  for (const g of twinConfigs) console.log("    " + g);

  // 45c. Одноранговая зависимость не продублирована.
  //
  // Библиотека объявляет то, что ждёт от потребителя, одноранговыми
  // зависимостями: React ставит приложение, а не пакет. Слияние манифеста
  // читало только `dependencies`, не нашло их там и дописало — потому что
  // формально их там не было.
  //
  // Замерено на чужой библиотеке: `react` и `react-dom` оказались в обоих
  // списках сразу. Потребитель получил бы вторую копию React, а два React в
  // одном приложении ломают хуки в рантайме — дефект ПОСТАВКИ, которого не
  // видят ни типы, ни тесты, ни линтер.
  const peerDup = [];
  if (CONFIG.manifest != null) {
    const at = path.join(BASE, CONFIG.manifest);
    if (existsSync(at)) {
      const pkg = JSON.parse(readFileSync(at, "utf8"));
      for (const name of Object.keys(pkg.peerDependencies ?? {}))
        if (pkg.dependencies?.[name] !== undefined)
          peerDup.push(
            name + " — объявлен и одноранговым, и обычной зависимостью",
          );
    }
  }
  // 45d. Объявленная цепочка проверок и семя манифеста сходятся.
  //
  // Какие скрипты составляют цепочку, объявлено ДАННЫМИ в карте посадки:
  // по этому списку слияние манифеста решает, что дописывать живому проекту.
  // Прежде список жил прозой инструкции, а слияние шло по семени целиком — и в
  // библиотеку без страницы трижды подряд приезжали скрипты сервера разработки
  // и просмотра собранного, каждый раз снимаемые руками.
  //
  // Данные и семя — два места, и разойтись они могут в обе стороны: звено
  // объявлено, а скрипта под него в семени нет (пустой проект получит цепочку с
  // дырой); либо скрипт цепочки в семени есть, а в списке его нет (живому
  // проекту его не допишут, и звено у него не появится вовсе). Сверяется
  // поэтому В ОБЕ СТОРОНЫ, как у таблицы сверок.
  const chainDrift = [];
  {
    const mapAt = shelfAt("seat/map.json");
    const seedAt = shelfAt("seat/templates/package.json");
    if (
      mapAt !== null &&
      existsSync(mapAt) &&
      seedAt !== null &&
      existsSync(seedAt)
    ) {
      const declared = JSON.parse(readFileSync(mapAt, "utf8")).chainScripts;
      if (Array.isArray(declared)) {
        const seedScripts =
          JSON.parse(readFileSync(seedAt, "utf8")).scripts ?? {};
        const names = declared.map((e) => e.name);
        for (const one of names)
          if (seedScripts[one] === undefined)
            chainDrift.push(one + " — звено объявлено, а скрипта в семени нет");
        // Обратная сторона названа списком исключений, а не догадкой: скрипты
        // каркаса нужны пустому проекту и не нужны живому, и это НЕ дыра.
        const frameScripts = new Set(["dev", "build", "preview"]);
        for (const one of Object.keys(seedScripts))
          if (!names.includes(one) && !frameScripts.has(one))
            chainDrift.push(
              one + " — скрипт в семени есть, а в цепочке не объявлен",
            );
        // Образец опознания обязан узнавать СВОЙ скрипт в семени, и только его.
        // Образец, не узнающий ничего, молча превращает слияние обратно в
        // сопоставление по имени; образец, узнающий лишнее, объявит чужой
        // скрипт звеном. Ни то, ни другое изнутри посадки не видно.
        for (const e of declared) {
          if (e.recognise == null) continue;
          const re = new RegExp(e.recognise);
          const hits = Object.entries(seedScripts)
            .filter(([, body]) => re.test(body))
            .map(([n]) => n);
          if (hits.length !== 1 || hits[0] !== e.name)
            chainDrift.push(
              e.name +
                " — образец опознания находит в семени: " +
                (hits.length ? hits.join(", ") : "ничего"),
            );
        }
      }
    }
  }
  // Вторая сторона: связка проверок зовёт звенья именем менеджера, который
  // объявил ПРОЕКТ. Семя связки написано умолчанием — словом `npm`, — и
  // правило о переходе на другой менеджер говорило только про таблицу
  // проверок в правилах. Про связку не говорило ничего, и она уезжала в
  // проект чужим словом.
  //
  // Цена не в том, что связка не запустится: менеджеры чужие скрипты зовут.
  // Цена в том, что ЧИТАТЬ её инструмент будет именем объявленного менеджера
  // и не увидит в ней ни одного звена — то есть обратная сторона сверки
  // инструментов замолчит навсегда. Замерено на проекте, объявившем yarn.
  if (CONFIG.manifest != null) {
    const at = path.join(BASE, CONFIG.manifest);
    if (existsSync(at)) {
      const body = (JSON.parse(readFileSync(at, "utf8")).scripts ?? {}).check;
      if (typeof body === "string") {
        const alien = /\b(npm|pnpm|yarn|bun)\s+(run\s+[\w:-]+|test\b)/.exec(
          body,
        );
        // Последнее звено связки — СВЕРКА БАЗЫ, и без неё зелёная цепочка
        // не значит ничего из того, что держит обвязка.
        //
        // Живой проект приходит со своей связкой, и правило слияния «тот же
        // скрипт, другое тело — оставить проектный» её сохраняет. Сохраняет
        // вместе с тем, что вызова сверки в ней нет. Замерено на копии
        // настоящего проекта в четыреста файлов: `check` вышел кодом НОЛЬ, а
        // сверка базы тем же заходом — кодом ОДИН. Цепочка зелёная, база
        // красная, и никто об этом не сказал: всё, что проверяет обвязка,
        // молча перестало проверяться.
        if (!/graph\.mjs[^&|]*\bverify\b/.test(body))
          chainDrift.push(
            "связка не зовёт сверку базы: цепочка будет зелёной, не проверив ничего из того, что держит обвязка",
          );
        if (scriptCallsIn(body).length === 0 && alien !== null)
          chainDrift.push(
            "связка зовёт звенья через «" +
              alien[1] +
              "», а проект объявил менеджером «" +
              PACKAGE_MANAGER +
              "»: читать её инструмент будет вторым именем и не увидит ни одного звена",
          );
      }
    }
  }
  checkHead("Цепочка проверок объявлена данными", {
    n: chainDeclared.length,
    unit: "звеньев цепочки",
  });
  console.log("  расхождений списка и семени: " + chainDrift.length);
  for (const g of chainDrift) console.log("    " + g);

  // 45e. Звено цепочки не задвоено в манифесте проекта.
  //
  // Слияние манифеста сопоставляло скрипты ПО ИМЕНИ, и проект, назвавший то же
  // звено иначе, получал близнеца: `types` проекта и привезённый `typecheck` —
  // два скрипта, один компилятор, одна работа, разные вызовы. Правилось руками
  // на каждой посадке и каждый раз записывалось решением; вещь, которую правят
  // руками всякий раз, решением не является — это дефект.
  //
  // Звено опознаётся теперь по тому, что скрипт ЗОВЁТ, а не по его имени, и
  // образцы объявлены в карте посадки. Эта сверка держит результат: двух
  // скриптов на одно звено в манифесте быть не должно. Расходящиеся вызовы
  // одного инструмента — источник вопроса «какой из них прав», и отвечать на
  // него приходится по очереди.
  const chainTwins = [];
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt) && CONFIG.manifest != null) {
      const at = path.join(BASE, CONFIG.manifest);
      const declared = JSON.parse(readFileSync(mapAt, "utf8")).chainScripts;
      if (existsSync(at) && Array.isArray(declared)) {
        const scripts = JSON.parse(readFileSync(at, "utf8")).scripts ?? {};
        for (const e of declared) {
          if (e.recognise == null) continue;
          const re = new RegExp(e.recognise);
          const hits = Object.entries(scripts)
            .filter(([, body]) => re.test(body))
            .map(([n]) => n);
          // Делегирующий корневой скрипт — то же звено, и рядом со своим
          // вызовом инструмента в корне он близнец.
          const handed = delegatedLink(re, scripts);
          if (handed !== null && !hits.includes(handed)) hits.push(handed);
          if (hits.length > 1)
            chainTwins.push(
              e.name + " — одно звено под именами: " + hits.join(", "),
            );
        }
      }
    }
  }
  checkHead("Звено цепочки не задвоено", {
    n: chainDeclared.length,
    unit: "звеньев цепочки",
  });
  console.log("  задвоенных звеньев: " + chainTwins.length);
  for (const g of chainTwins) console.log("    " + g);

  checkHead("Одноранговая зависимость не продублирована", {
    n: chainDeclared.length,
    unit: "звеньев цепочки",
  });
  console.log("  продублировано: " + peerDup.length);
  for (const g of peerDup) console.log("    " + g);

  // Поставка не несёт лишнего: у пакета, который ПУБЛИКУЕТСЯ, каждая обычная
  // зависимость уезжает к каждому потребителю, и держать её вправе только
  // код самого пакета. Зависимость, которую его код не импортирует, — чужой
  // груз в дереве потребителя.
  //
  // Замерено посадкой руками в библиотеку с поверхностью `exports` и React
  // одноранговым: слияние манифеста по букве «дописать недостающие
  // зависимости» положило в её обычные зависимости весь стек приложения и
  // `react-dom` — девять пакетов, которые поставил бы каждый её потребитель.
  // Сверка одноранговых молчала: ни один из девяти не объявлен одноранговым.
  //
  // Публикуется пакет, чей манифест называет поверхность — `exports`,
  // `main`, `module` или `files` — и не объявлен закрытым.
  const shipDead = [];
  let shipLooked = 0;
  if (CONFIG.manifest != null) {
    const at = path.join(BASE, CONFIG.manifest);
    const pkg = readJson(at, {});
    const published =
      pkg.private !== true &&
      ["exports", "main", "module", "files"].some((k) => pkg[k] != null);
    if (published) {
      const imported = new Set();
      for (const specs of specsOf.values())
        for (const one of specs) imported.add(one);
      for (const name of Object.keys(pkg.dependencies ?? {})) {
        shipLooked += 1;
        const used = [...imported].some(
          (s) => s === name || s.startsWith(name + "/"),
        );
        if (!used)
          shipDead.push(
            name +
              " — обычная зависимость пакета, который публикуется, а код пакета её не импортирует: уедет к каждому потребителю. Инструменту разработки место в devDependencies",
          );
      }
    }
  }
  checkHead("Поставка не несёт лишнего", {
    n: shipLooked,
    unit: "обычных зависимостей публикуемого пакета",
  });
  console.log("  не нужны коду пакета: " + shipDead.length);
  for (const g of shipDead) console.log("    " + g);

  // 44-а. Заготовки на полке не попадают под разбор линтера проекта.
  //
  // В папке заготовок лежат файлы с именами настоящих конфигов — конфиг
  // компилятора, манифест, конфиг линтера. Для инструмента, который ищет свой
  // корень по имени файла, это ВТОРОЙ корень проекта, и находит он его сам.
  //
  // Замерено на живом проекте со своим плоским конфигом линта: линтер с
  // типами нашёл два кандидата в корни — сам проект и папку заготовок, — и
  // отказался разбирать ЧТО-ЛИБО. Семнадцать ошибок разбора, звено цепочки
  // легло целиком, и легло на здоровом коде. Своих файлов проекта в этих
  // семнадцати не было ни одного: обвязка сломала линтер одним своим
  // присутствием.
  //
  // Собственный конфиг обвязки папку заготовок исключает с тех пор, как это
  // нашли в первый раз. Но у живого проекта конфиг СВОЙ, и в него это
  // исключение никто не переносил: правило было, а машинной формы у него не
  // было — и на первом же проекте со своим конфигом оно не исполнилось.
  //
  // Чего сверка не видит: она читает объявление глазами текста, а не линтера.
  // Исключение, записанное как-то иначе — отдельным файлом нестандартного
  // имени, вычисленным выражением, — она не узнает и скажет, что его нет.
  // Ложное срабатывание тут дешевле пропуска: цена пропуска замерена и равна
  // всему звену.
  const seedLint = [];
  if (SHELF !== null && CONFIG.toolchain != null) {
    const link = CONFIG.toolchain.find((l) => l.script === "lint");
    const shelfRel = path.relative(REPO, SHELF).split(path.sep).join("/");
    const mustCover = shelfRel + "/seat/templates";
    // Область разбора задаёт СКРИПТ, а не только конфиг. Проект вправе звать
    // линтер по двум своим папкам — тогда до полки он не доходит вовсе, и
    // требовать исключения значит краснеть на здоровом устройстве. Ложное
    // срабатывание тут дороже пропуска: оно учит не читать вывод, и поймано
    // оно было первым же проектом с таким скриптом.
    //
    // Разбор скрипта простой: после имени инструмента берутся лексемы, не
    // начинающиеся с тире и не идущие сразу за такой лексемой — значение ключа
    // не область. Областей нет вовсе — линтер идёт от текущей папки, то есть
    // достаёт до всего.
    const lintArea = () => {
      if (CONFIG.manifest == null) return null;
      const mAt = path.join(BASE, CONFIG.manifest);
      if (!existsSync(mAt)) return null;
      const scripts = JSON.parse(readFileSync(mAt, "utf8")).scripts ?? {};
      const own = linkOwnName("lint", scripts);
      const body = scripts[own ?? "lint"];
      if (typeof body !== "string") return null;
      const parts = body.trim().split(/\s+/).slice(1);
      const areas = [];
      for (let i = 0; i < parts.length; i += 1) {
        if (parts[i].startsWith("-")) continue;
        if (i > 0 && parts[i - 1].startsWith("-")) continue;
        areas.push(parts[i].replace(/^\.\//, ""));
      }
      return areas;
    };

    if (link != null && link.config != null) {
      // Конфиг в силе — не обязательно семенной: у живого проекта он свой и
      // часто под другим именем. Берётся тот, что лежит.
      const names = [link.config];
      const mapAt = shelfAt("seat/map.json");
      if (mapAt !== null && existsSync(mapAt))
        for (const e of JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [])
          if (e.to === link.config) names.push(...(e.alsoKnownAs ?? []));
      const at = names
        .map((n) => path.join(REPO, n))
        .find((one) => existsSync(one));
      if (at !== undefined) {
        let text = readFileSync(at, "utf8");
        const sideCar = path.join(REPO, ".eslintignore");
        if (existsSync(sideCar))
          text += NEWLINE + readFileSync(sideCar, "utf8");
        const covered = literalsOf(text).some((one) =>
          mustCover.startsWith(one.replace(/\/\*\*?$/, "")),
        );
        const areas = lintArea();
        const reaches =
          areas === null ||
          areas.length === 0 ||
          areas.some((one) => one === "." || mustCover.startsWith(one));
        if (!covered && reaches)
          seedLint.push(
            path.relative(REPO, at).split(path.sep).join("/") +
              " — не исключает " +
              mustCover +
              ": линтер с типами найдёт там второй корень проекта и откажется разбирать что-либо",
          );
      }
    }
  }
  checkHead("Заготовки обвязки не разбираются линтом проекта", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  console.log("  расхождений: " + seedLint.length);
  for (const d of seedLint) console.log("    " + d);
  // 44-б. Звено, написанное в манифест, может делать свою работу.
  //
  // Два условия, и оба найдены одной посадкой в монорепозиторий.
  //
  // Порядок слияния манифеста опознаёт звено образцом — по тому, что скрипт
  // зовёт, а не как назван, — но только в первом своём пункте. Третий пункт,
  // «скрипт с тем же именем и другим телом: оставить проектный», по-прежнему
  // смотрел на ИМЯ. Разница видна там, где скрипт с именем звена работы не
  // делает, а делегирует её кому-то ещё.
  //
  // Замерено на монорепозитории. Корневой `lint` там — `npm run lint
  // --workspaces`, а у пакетов под этим именем стоит `echo`. Образец линтера
  // не совпал ни с чем: звена в проекте НЕТ. Но имя было занято, третий пункт
  // сработал по имени, и посадка оставила проектный скрипт — при этом положив
  // в корень привезённый конфиг линта и дописав шесть его пакетов. Итог:
  // звено зелёное, разобрало ноль файлов, конфиг не читает никто, пакеты
  // стоят вхолостую. Свод называет это худшим из возможных состояний.
  //
  // Сверка спрашивает ровно одно и спрашивает задним числом: конфиг звена
  // лежит в проекте — значит, хоть один скрипт манифеста обязан звать его
  // инструмент. Не лежит — звено проекта не касается, и спрашивать не с чего.
  const idleConfig = [];
  if (CONFIG.toolchain != null && CONFIG.manifest != null) {
    const at = path.join(BASE, CONFIG.manifest);
    const scripts = existsSync(at)
      ? (JSON.parse(readFileSync(at, "utf8")).scripts ?? {})
      : {};
    const mapAt = shelfAt("seat/map.json");
    const chain =
      mapAt !== null && existsSync(mapAt)
        ? (JSON.parse(readFileSync(mapAt, "utf8")).chainScripts ?? [])
        : [];
    const idleSaid = new Set();
    // Конфиг звена без предмета, нужный ЖИВОМУ звену, законен: его требует
    // соседняя сверка «Конфиг снятого звена служит живому». Прежде эта
    // сверка требовала звать его инструмент — то есть обе вместе требовали
    // противоположного от одного файла, и проект на обычном JavaScript не
    // мог стать зелёным ни с конфигом компилятора, ни без него. Замерено
    // посадкой руками.
    const livePacks = new Set(
      CONFIG.toolchain
        .filter((one) => linkHasSubject(one.script))
        .flatMap((one) => one.packages ?? []),
    );
    for (const link of CONFIG.toolchain) {
      if (link.config == null) continue;
      if (!existsSync(path.join(REPO, link.config))) continue;
      if (
        !linkHasSubject(link.script) &&
        (link.packages ?? []).some((one) => livePacks.has(one))
      )
        continue;
      const one = chain.find((e) => e.name === link.script);
      if (one === undefined || one.recognise == null) continue;
      const re = new RegExp(one.recognise);
      if (linkCalled(re, scripts)) continue;
      idleSaid.add(link.config);
      idleConfig.push(
        link.config +
          " — конфиг звена «" +
          link.script +
          "» лежит, а инструмент его не зовёт ни один скрипт манифеста",
      );
    }
    // То же спрашивается с ЛЮБОГО семени, которое карта отдаёт звену полем
    // `neededBy`, а не только с конфига. Подготовка тестов и тест помощника
    // стилей написаны под свой раннер; в проект со своим раннером jest они
    // легли, не запускались ничем, а линт краснел на них двадцатью пятью
    // ошибками — пакетов раннера в проекте нет, и типы их не разрешались.
    // Замерено посадкой руками.
    const seatCopy =
      mapAt !== null && existsSync(mapAt)
        ? (JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [])
        : [];
    for (const e of seatCopy) {
      if (e.neededBy == null || idleSaid.has(e.to)) continue;
      if (!existsSync(path.join(REPO, e.to))) continue;
      const one = chain.find((c) => c.name === e.neededBy);
      if (one === undefined || one.recognise == null) continue;
      const re = new RegExp(one.recognise);
      if (linkCalled(re, scripts)) continue;
      idleConfig.push(
        e.to +
          " — семя звена «" +
          e.neededBy +
          "» лежит, а инструмент звена не зовёт ни один скрипт манифеста",
      );
    }

    // Второе условие: ЗВЕНО-СПУТНИК. Оно работает тем же инструментом и той
    // же настройкой, что и звено, за которым следует, и в одиночку ему
    // работать не на чем. Покрытие уехало в корень монорепозитория
    // самостоятельным скриптом — раннера там нет, конфига тоже, — собрало
    // тесты без окружения и дало пять красных на здоровом коде.
    for (const e of chain) {
      if (e.follows == null) continue;
      if (scripts[e.name] == null) continue;
      const master = chain.find((c) => c.name === e.follows);
      if (master === undefined || master.recognise == null) continue;
      const re = new RegExp(master.recognise);
      if (linkCalled(re, scripts)) continue;
      idleConfig.push(
        e.name +
          " — звено-спутник написано, а звена «" +
          e.follows +
          "», за которым оно следует, в проекте нет",
      );
    }
  }
  checkHead("Звену цепочки есть на чём работать", {
    n: chainDeclared.length,
    unit: "звеньев цепочки",
  });
  console.log("  звеньев без опоры: " + idleConfig.length);
  for (const d of idleConfig) console.log("    " + d);
  // 44-в. Каждый пакет семени манифеста принадлежит объявленному звену.
  //
  // Объявление `toolchain` называет, какие пакеты у какого звена, и на нём
  // стоит целое правило: звено неприменимо — его пакеты не ставятся. Но список
  // пакетов был НЕПОЛНЫМ, и неполный выглядел точно как полный: слияние
  // манифеста, не найдя пакета в объявлении, брало его из семени целиком.
  // Объявление было, и не работало.
  //
  // Цена замерена дважды одной посадкой. Конфиг линта столкнулся под другим
  // именем и лёг `.seat`-ом — то есть не действует; четыре его пакета, не
  // названные ни одним звеном, всё равно уехали в манифест и уронили установку
  // неразрешимым деревом. И наоборот: звено покрытия было объявлено цепочкой,
  // написано в манифест каждой посадкой — а пакета, без которого оно не
  // запускается, не было нигде. Оно не работало ни разу и молчало об этом.
  //
  // Сверяется в обе стороны. Пакет семени, не названный ни звеном, ни списком
  // платформы, — забытый. Пакет, названный звеном и отсутствующий в семени, —
  // звено без инструмента.
  const packDrift = [];
  {
    const seedAt = shelfAt("seat/templates/package.json");
    const mapAt = shelfAt("seat/map.json");
    if (
      CONFIG.toolchain != null &&
      seedAt !== null &&
      existsSync(seedAt) &&
      mapAt !== null &&
      existsSync(mapAt)
    ) {
      const seed = JSON.parse(readFileSync(seedAt, "utf8"));
      const seatMapNow = JSON.parse(readFileSync(mapAt, "utf8"));
      const inSeed = new Set([
        ...Object.keys(seed.dependencies ?? {}),
        ...Object.keys(seed.devDependencies ?? {}),
      ]);
      const byLink = new Map();
      for (const l of CONFIG.toolchain)
        for (const p of l.packages ?? [])
          byLink.set(p, (byLink.get(p) ?? []).concat(l.script ?? "звено"));
      const platform = new Set(seatMapNow.platformPackages?.packages ?? []);
      // Второй список — стек приложения: пакеты, не нужные ни звену, ни
      // платформе, привезённые заранее под будущее приложение. Держатся
      // отдельно от платформы, потому что смысл у списков разный: платформа
      // работает с первого дня, стек лежит неиспользованным. Свалить их в
      // один список значило бы сделать описание платформы ложью.
      const stack = new Set(seatMapNow.stackPackages?.packages ?? []);
      // Половин у сверки две, и опоры у них РАЗНЫЕ.
      //
      // Гигиена СЕМЕНИ: каждый пакет семени назван связкой СЕМЕНИ. Она не
      // зависит от того, что проект у себя оставил, и потому ловит пакет,
      // который положили в манифест обвязки и забыли объявить.
      //
      // Здравость ПРОЕКТА: каждый пакет, который проект ДЕРЖИТ, назван
      // связкой ПРОЕКТА. Снять неприменимое звено вместе с пакетами доктрина
      // велит дважды, и карать за это нельзя: пока опора была одна, снявший
      // звено получал красный прогон без выхода. Замерено на проекте, чей
      // конфиг линта лежит в старом формате.
      const seedLinks = (() => {
        const at = shelfAt("seat/templates/graph.config.mjs");
        if (at === null || !existsSync(at)) return null;
        const body = readFileSync(at, "utf8");
        if (!body.includes("toolchain: [")) return null;
        // Читается только то, что семя называет ПАКЕТАМИ. Взять любую
        // строку в кавычках было бы поблажкой: имена шаблонов и сценариев
        // оправдывали бы совпавший с ними пакет.
        const names = new Set();
        let mark = body.indexOf("packages:");
        while (mark >= 0) {
          const end = body.indexOf("]", mark);
          if (end < 0) break;
          const parts = body.slice(mark, end).split('"');
          for (let i = 1; i < parts.length; i += 2) names.add(parts[i]);
          mark = body.indexOf("packages:", end);
        }
        return names.size === 0 ? null : names;
      })();
      const manifestAt = path.join(BASE, "..", "package.json");
      const held = new Set([
        ...Object.keys(readJson(manifestAt, {}).dependencies ?? {}),
        ...Object.keys(readJson(manifestAt, {}).devDependencies ?? {}),
      ]);
      for (const one of inSeed) {
        if (platform.has(one) || stack.has(one)) continue;
        if (seedLinks !== null && !seedLinks.has(one))
          packDrift.push(
            one +
              " — пакет семени не назван ни звеном семени, ни списком платформы, ни стеком",
          );
        else if (held.has(one) && !byLink.has(one))
          packDrift.push(
            one +
              " — проект держит пакет, которого не называет ни одно его звено",
          );
      }
      // Обратная сторона: имя в списке, которого нет в семени. Без неё
      // список копит пакеты, давно выброшенные из манифеста, и перестаёт
      // говорить о том, что действительно приезжает.
      for (const p of stack)
        if (!inSeed.has(p))
          packDrift.push(p + " — назван стеком, а в семени манифеста его нет");
      for (const [p, links] of byLink)
        if (!inSeed.has(p))
          packDrift.push(
            p +
              " — назван звеном «" +
              links.join(", ") +
              "», а в семени манифеста его нет",
          );
    }
  }
  checkHead("Пакеты семени разобраны по звеньям", {
    n: chainDeclared.length,
    unit: "звеньев цепочки",
  });
  console.log("  неразобранных: " + packDrift.length);
  for (const d of packDrift) console.log("    " + d);

  // 44-г. Семя, которое кладут НЕ на посадке, посадкой не положено.
  //
  // Одно семя кладут не при посадке — конфиг мутационного прогона: до первых
  // тестов он бесполезен. Правило жило прозой, а карта посадки, которую
  // инструкция объявляет единственным источником, о нём не говорила ничего — и
  // посадка, работающая по карте, клала его первым же заходом. Правило без
  // машинной формы перестаёт исполняться, не давая признака; здесь свод
  // нарушал сам себя, и нарушал внутри одного файла.
  //
  // Помечено теперь данными, полем `notAtSeating`, и проверяется ПОБАЙТОВО:
  // семя, лежащее ровно тем же, каким приехало, никто не заполнял, значит его
  // положила посадка. Тронутое семя семенем быть перестало — тот же признак,
  // что у сверки каркаса.
  /** Свои тесты проекта — не те, что привезены каркасом.
   *
   * Предмет отложенных семян: до первого СВОЕГО теста конфиг мутационного
   * прогона бесполезен. Считается он двумя сверками сразу — той, что
   * запрещает класть семя раньше срока, и той, что требует положить его,
   * когда срок настал, — и счёт у них обязан быть один: разойдясь, они
   * начали бы противоречить друг другу на одном и том же файле.
   */
  const ownTestExists = (() => {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt)) return false;
    const seedOf = new Map();
    for (const e of JSON.parse(readFileSync(mapAt, "utf8")).copy ?? []) {
      const from0 = shelfAt(e.from);
      if (from0 !== null) seedOf.set(norm(path.join(REPO, e.to)), from0);
    }
    const eol = String.fromCharCode(13) + NEWLINE;
    return files.some((f) => {
      if (!isTest(f)) return false;
      const src = seedOf.get(f);
      if (src === undefined || !existsSync(src)) return true;
      return (
        readFileSync(f, "utf8").split(eol).join(NEWLINE) !==
        readFileSync(src, "utf8").split(eol).join(NEWLINE)
      );
    });
  })();

  const earlySeed = [];
  // Раньше срока — значит ИДЁТ ПОСАДКА, и признак её — флаг настройки.
  //
  // Сверка называется «не положено ПОСАДКОЙ»: пока флаг стоит, отложенное
  // семя в проекте положено ею и рано. Флаг снят — посадка кончилась, семя
  // лежит по чьей-то другой воле, то есть по делу.
  //
  // Прежде признак был «файл лежит и равен семени», без вопроса когда, и
  // запрещал законно лежащее семя сразу после того, как соседняя сверка
  // потребовала его положить. Первая попытка дала обеим сверкам один
  // предмет — свои тесты, — и противоречие ушло, а фальсификация осталась
  // без зацепки: в проекте со своими тестами эту сверку не разбудить ничем.
  if (seatingIsUp()) {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt !== null && existsSync(mapAt))
      for (const e of JSON.parse(readFileSync(mapAt, "utf8")).copy ?? []) {
        if (e.notAtSeating === undefined) continue;
        const there = path.join(REPO, e.to);
        const seedFile = shelfAt(e.from);
        if (!existsSync(there) || seedFile === null || !existsSync(seedFile))
          continue;
        if (readFileSync(there).equals(readFileSync(seedFile)))
          earlySeed.push(e.to + " — " + e.notAtSeating);
      }
  }
  // Семя, столкнувшееся с проектным файлом, лежит рядом как `<имя>.seat`, а
  // слияние объявлено работой фазы 2 — и не проверялось ничем. Забыли —
  // файл лежит вечно, проект остаётся при своём, содержимое обвязки не
  // приезжает совсем, и признака у этого нет: отложенное выглядит сделанным.
  //
  // Пока стоит флаг посадки, лежащее семя законно: фаза 2 ещё не работала.
  // Найдено вопросом разработчика о том, что дальше происходит с таким
  // файлом, — ответа в проекте не было.
  const unmerged = [];
  let seatWalked = 0;
  // Смотрится ВСЕГДА, краснеет только при снятом флаге. Прежде при
  // поднятом флаге сверка не смотрела вовсе: отчёт посадки не называл, что
  // ещё предстоит слить, — ровно тогда, когда это нужнее всего, — а прогон
  // рецепта докладывал промолчавшую сверку как слепую.
  const seatingUp = seatingIsUp();
  {
    const look = (dir) => {
      for (const e of readdirSync(dir)) {
        if (OUT_OF_TREE.has(e)) continue;
        const at = path.join(dir, e);
        if (statSync(at).isDirectory()) look(at);
        else if ((seatWalked += 1) && e.endsWith(".seat"))
          unmerged.push(
            norm(path.relative(REPO, at)).split(path.sep).join("/"),
          );
      }
    };
    look(REPO);
  }
  // Семена кода носят суффикс отложенного, чтобы их не собрал ни раннер
  // тестов, ни разбор кода. Ценой этого форматтер их тоже не видит:
  // расширение ему незнакомо. Семя приезжало неотформатированным, и звено
  // формата краснело в НОВОМ проекте — до единой собственной строки, то есть
  // встречало разработчика на посадке и выглядело дефектом обвязки.
  //
  // Разбор называется явно: по расширению его не вывести, на то и суффикс.
  const roughSeeds = [];
  let seedFmtSaid = null;
  {
    const seedDir = shelfAt("seat/templates");
    if (seedDir === null || !existsSync(seedDir))
      seedFmtSaid = "семян рядом нет: полка не раздаётся из этого проекта";
    else {
      const found = [];
      const look = (dir) => {
        for (const e of readdirSync(dir)) {
          const at = path.join(dir, e);
          if (statSync(at).isDirectory()) look(at);
          else if (e.endsWith(".seed")) found.push(at);
        }
      };
      look(seedDir);
      if (found.length === 0) seedFmtSaid = "семян с суффиксом нет";
      else
        try {
          // Список исключений ПРОЕКТА сюда не допускается: семена лежат в
          // папке обвязки, а проект её из форматтера исключает — её файлы
          // форматирует мастерская. Форматтер, прочитав этот список, молча
          // пропускал каждое семя и отвечал «расходится: 0». Замерено
          // фальсификацией стенда: посаженное неряшливое семя прошло чистым.
          // Путь к несуществующему файлу заменяет список пустым; путь
          // относительный и латиницей — команда идёт через оболочку.
          execFileSync(
            "npx",
            [
              "prettier",
              "--check",
              "--parser",
              "typescript",
              "--ignore-path",
              norm(
                path.relative(
                  path.join(BASE, ".."),
                  path.join(seedDir, ".no-ignore-list"),
                ),
              ),
              ...found,
            ],
            {
              cwd: path.join(BASE, ".."),
              encoding: "utf8",
              shell: true,
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          seedFmtSaid = "семян проверено: " + found.length + ", расходится: 0";
        } catch (e) {
          const out = String(e.stdout ?? "") + String(e.stderr ?? "");
          if (/not (found|recognized)|ENOENT|Cannot find/i.test(out))
            seedFmtSaid =
              "форматтера нет — сверить нечем, и это не поломка: звено формата в проекте может быть неприменимо";
          else
            for (const line of out.split(NEWLINE))
              if (/\.seed\s*$/.test(line))
                roughSeeds.push(line.replace(/^\[[^\]]*\]\s*/, "").trim());
        }
    }
  }
  // Семя настройки не должно называть файл, которого посадка не кладёт.
  //
  // Замерено посадкой в живой проект: слияние конфига сборщика внесло
  // строку с адресом файла подготовки тестов, а сам файл был помечен
  // каркасом и в живой проект не поехал. Раннер упал на запуске — звено
  // тестов оказалось сломано ПОСАДКОЙ, в первый же день.
  //
  // Класс тот же, что у звена и его спутника: две половины одной вещи,
  // разложенные по разным местам, обязаны ехать вместе.
  const seedRefs = [];
  let seedRefSaid = null;
  {
    const seedDir = shelfAt("seat/templates");
    const mapAt = shelfAt("seat/map.json");
    if (seedDir === null || mapAt === null || !existsSync(mapAt))
      seedRefSaid = "карты посадки рядом нет: полка не раздаётся отсюда";
    else {
      // Считается не «есть ли адрес в карте», а «ПОЕДЕТ ли он в живой
      // проект». Настройки сливаются в живой проект всегда, а семя с пометкой
      // каркаса туда не кладётся вовсе — и ровно на этом расхождении звено
      // тестов и сломалось: адрес в карте был, файла в проекте не было.
      const addressed = new Set(
        (JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [])
          .filter(
            (c) =>
              c.onlyWhenEmpty !== true &&
              c.onSubject === undefined &&
              c.onTransition === undefined,
          )
          .map((c) => c.to),
      );
      // Смотрятся семена НАСТРОЕК: они и есть то, что сливается в проект.
      // Семена кода ссылаются друг на друга импортами, и их держит
      // компилятор.
      const configs = [];
      const look = (dir) => {
        for (const e of readdirSync(dir)) {
          const at = path.join(dir, e);
          if (statSync(at).isDirectory()) {
            if (e !== "src" && e !== "docs") look(at);
            continue;
          }
          if (/[.](ts|js|mjs|cjs|json)$/.test(e)) configs.push(at);
        }
      };
      look(seedDir);
      for (const f of configs) {
        const body = readFileSync(f, "utf8");
        for (const m of body.matchAll(/["'](\.\/(?:src|docs)\/[^"']+)["']/g)) {
          const to = m[1].replace(/^\.\//, "");
          if (addressed.has(to)) continue;
          seedRefs.push(
            norm(path.relative(SHELF, f)).split(path.sep).join("/") +
              " называет " +
              m[1] +
              " — такого адреса назначения в карте нет",
          );
        }
      }
      if (seedRefs.length === 0) seedRefSaid = "ссылок мимо карты: 0";
    }
  }
  // Запись о семени, которое НЕ каркас, не лежит внутри пометок каркаса.
  //
  // Пометка стоит на ЗАПИСИ, условие приезда — на СЕМЕНИ, и разъезжаются
  // они молча: семя перестало быть каркасом, запись осталась внутри пометки
  // и снимается вместе с ним. Проект получает файл, о котором посадка сама
  // же не написала. Замерено посадкой в живой проект.
  const wrapped = [];
  let wrapSaid = null;
  {
    const seedDir = shelfAt("seat/templates");
    const mapAt = shelfAt("seat/map.json");
    if (seedDir === null || mapAt === null || !existsSync(mapAt))
      wrapSaid = "карты посадки рядом нет: полка не раздаётся отсюда";
    else {
      const travels = (JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [])
        .filter((c) => c.onlyWhenEmpty !== true)
        .map((c) => c.to);
      for (const name of readdirSync(seedDir)) {
        if (!name.endsWith(".md")) continue;
        const rows = readFileSync(path.join(seedDir, name), "utf8").split(
          /\r?\n/,
        );
        let inside = false;
        for (let i = 0; i < rows.length; i += 1) {
          if (rows[i].trim() === "<!-- КАРКАС -->") {
            inside = true;
            continue;
          }
          if (rows[i].trim() === "<!-- /КАРКАС -->") {
            inside = false;
            continue;
          }
          if (!inside) continue;
          for (const to of travels)
            if (
              rows[i].includes(to) ||
              rows[i].includes(to.replace(/^src\//, ""))
            )
              wrapped.push(
                name +
                  ":" +
                  (i + 1) +
                  " — запись о `" +
                  to +
                  "`, а это не каркас",
              );
        }
      }
      if (wrapped.length === 0) wrapSaid = "записей не по своей пометке: 0";
    }
  }
  checkHead("Запись о семени помечена каркасом вместе с ним", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  if (wrapSaid !== null) console.log("  " + wrapSaid);
  if (wrapped.length)
    console.log("  записей не по своей пометке: " + wrapped.length);
  for (const one of wrapped)
    console.log(
      "    " +
        one +
        " — живой проект снимет пометку вместе с записью и получит файл, о котором посадка не написала",
    );
  // Поля, заведённые обвязкой ПОСЛЕ посадки, до проекта не доезжают: папку
  // обвязки обновляют копированием, а настройку проекта — нет. Молчание тут
  // хуже всего: инструмент читает отсутствующее поле как осознанный отказ.
  const seedFields = [];
  {
    const at = shelfAt("seat/templates/graph.config.mjs");
    if (at !== null && existsSync(at)) {
      const body = readFileSync(at, "utf8");
      // Верхний уровень: строка вида «  имя:» с отступом ровно в два пробела.
      for (const m of body.matchAll(/^ {2}([A-Za-z][\w]*):/gm))
        seedFields.push([m[1], null]);
      // Вложенное в долг: отступ в четыре пробела внутри блока debt.
      const from = body.indexOf("  debt: {");
      if (from >= 0) {
        const to = body.indexOf(NEWLINE + "  },", from);
        for (const m of body
          .slice(from, to)
          .matchAll(/^ {4}([A-Za-z][\w]*):/gm))
          seedFields.push(["debt", m[1]]);
      }
    }
  }
  const fieldGone = [];
  for (const [top, inner] of seedFields) {
    if (inner === null) {
      if (!(top in CONFIG))
        fieldGone.push(
          top +
            " — поле семени, которого у проекта нет. Переписать его из семени вместе с объяснением",
        );
      continue;
    }
    const held = CONFIG[top];
    if (held == null || typeof held !== "object") continue;
    if (!(inner in held))
      fieldGone.push(
        top +
          "." +
          inner +
          " — поле семени, которого у проекта нет. Переписать его из семени вместе с объяснением",
      );
  }
  checkHead("Настройка проекта знает все поля семени", {
    n: seedFields.length,
    unit: "полей семени настройки",
  });
  console.log("  полей нет у проекта: " + fieldGone.length);
  for (const one of fieldGone) console.log("    " + one);

  // Поле семени без объяснения узнают ОШИБКОЙ: пишут значение наугад,
  // получают «настройка задана неверно» и оттуда вычитывают форму. Семя
  // настройки и есть место, где поля объяснены, — у каждого соседа объяснение
  // стоит, и пропуск читается не как пропуск, а как «тут объяснять нечего».
  // Замерено посадкой: поле плана перехода приехало голым, форму его —
  // объект с частями — назвал только текст ошибки инструмента.
  const fieldMute = [];
  {
    const at = shelfAt("seat/templates/graph.config.mjs");
    if (at !== null && existsSync(at)) {
      const rows = readFileSync(at, "utf8").split(NEWLINE);
      for (let i = 0; i < rows.length; i += 1) {
        const m = /^ {2}([A-Za-z][A-Za-z0-9_]*):/.exec(rows[i]);
        if (m === null) continue;
        let up = i - 1;
        while (up >= 0 && rows[up].trim() === "") up -= 1;
        const near = up < 0 ? "" : rows[up].trim();
        const told =
          near.startsWith("*") || near.startsWith("//") || near.endsWith("*/");
        if (!told)
          fieldMute.push(
            m[1] +
              " — поле семени настройки без объяснения: форму его узнают ошибкой инструмента",
          );
      }
      // Обратная сторона: объяснение БЕЗ поля. Блок, за которым сразу идёт
      // другой блок, ни к какому полю не относится — а поле, о котором он,
      // стоит ниже голым либо со вторым, коротким объяснением. Замерено
      // посадкой руками: объяснение списка тестов вне своей папки стояло над
      // полем слоёв компонентов, у самого списка было второе, а в настройке
      // мастерской список не был объяснён вовсе. Сверка выше смотрела только
      // «есть ли над полем объяснение» и не видела ни того, ни другого.
      for (let i = 0; i < rows.length; i += 1) {
        if (!/^ {2}\/\*\*|^ {3}\*/.test(rows[i])) continue;
        if (!rows[i].trimEnd().endsWith("*/")) continue;
        let down = i + 1;
        while (down < rows.length && rows[down].trim() === "") down += 1;
        if (down >= rows.length || !/^ {2}\/\*\*/.test(rows[down])) continue;
        let head = i;
        while (head > 0 && !/^ {2}\/\*\*/.test(rows[head])) head -= 1;
        fieldMute.push(
          "«" +
            rows[head].replace(/^ {2}\/\*\*\s*/, "").slice(0, 60) +
            "…» — объяснение без поля: за ним сразу другое. Поставить над полем, о котором оно",
        );
      }
      // Звено цепочки объясняет себя полем `why`: его печатает сверка
      // инструментов, когда звену чего-то не хватает. Звено мутаций приехало
      // без него, и сверка печатала «зачем: undefined» — объяснение, которого
      // нет, выглядело объяснением. Найдено посадкой руками в проект на
      // `jest`. Спрашивается каждое звено списка `toolchain`.
      const from = rows.findIndex((l) => /^ {2}toolchain:\s*\[/.test(l));
      if (from >= 0) {
        let link = null;
        for (let i = from + 1; i < rows.length; i += 1) {
          if (/^ {2}\]/.test(rows[i])) break;
          if (/^ {4}\{/.test(rows[i])) link = { script: null, why: false };
          const s = /^ {6}script:\s*"([^"]+)"/.exec(rows[i]);
          if (s !== null && link !== null) link.script = s[1];
          if (/^ {6}why:\s*\S/.test(rows[i]) && link !== null) link.why = true;
          if (/^ {4}\},?\s*$/.test(rows[i]) && link !== null) {
            if (!link.why)
              fieldMute.push(
                "toolchain «" +
                  (link.script ?? "звено без имени") +
                  "» — звено без `why`: сверка инструментов напечатает объяснение, которого нет",
              );
            link = null;
          }
        }
      }
    }
  }
  checkHead("Поле семени настройки объяснено", {
    n: seedFields.filter((one) => one[1] === null).length,
    unit: "полей верхнего уровня в семени настройки",
  });
  console.log("  без объяснения: " + fieldMute.length);
  for (const one of fieldMute) console.log("    " + one);
  checkHead("Настройка семени не ссылается на непривезённое", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  if (seedRefSaid !== null) console.log("  " + seedRefSaid);
  if (seedRefs.length) console.log("  ссылок мимо карты: " + seedRefs.length);
  for (const one of seedRefs)
    console.log(
      "    " +
        one +
        " — в проекте настройка будет указывать в пустоту, и звено сломается посадкой",
    );
  checkHead("Семена приезжают отформатированными", {
    n: seedsDeclared.length,
    unit: "семян в карте посадки",
  });
  if (seedFmtSaid !== null) console.log("  " + seedFmtSaid);
  if (roughSeeds.length) console.log("  расходится: " + roughSeeds.length);
  for (const one of roughSeeds)
    console.log(
      "    " +
        one +
        " — в проекте суффикс снимается, и звено формата краснеет в первый же день",
    );
  // Корпус — файлы, осмотренные на суффикс отложенного. Пока он считался
  // семенами карты, прогон печатал «осмотрено 0» над списком из двух
  // непрослитых: найдено больше, чем осмотрено.
  checkHead("Отложенное семя слито", {
    n: seatWalked,
    unit: "файлов проекта под суффикс отложенного",
  });
  console.log("  не слито: " + unmerged.length);
  for (const u of unmerged)
    console.log(
      "    " + u + " — перенести нужное в проектный файл и удалить это",
    );
  if (unmerged.length && seatingUp)
    console.log(
      "  Посадка не закончена — пока это не поломка, а список работы фазы 2.",
    );
  // Обратная сторона соседней сверки: семя, кладущееся НЕ на посадке, обязано
  // лечь, когда его предмет появился.
  //
  // Прежде сторожилась одна сторона — чтобы посадка его не положила, — и на
  // этом всё: момента «предмет появился» не сторожило ничто, и семя не
  // ложилось никогда. Замерено на приложении, написанном с нуля: свои тесты
  // есть, режим долга мутаций печатает готовую команду, а конфига, которым
  // она работает, в проекте нет.
  //
  // Предмет — СВОИ тесты проекта, а не привезённые каркасом: до первого
  // своего теста конфиг и правда бесполезен. Признак свой у файла уже есть —
  // он не равен своему семени побайтово.
  const lateSeeds = [];
  let lateSaid = null;
  {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt))
      lateSaid = "карты посадки рядом нет: полка не раздаётся отсюда";
    else {
      const copy = JSON.parse(readFileSync(mapAt, "utf8")).copy ?? [];
      const deferred = copy.filter((e) => e.notAtSeating !== undefined);
      const ownTest = ownTestExists;
      if (!ownTest)
        lateSaid =
          "своих тестов у проекта нет: предмета у отложенных семян нет";
      else {
        for (const e of deferred)
          if (!existsSync(path.join(REPO, e.to)))
            lateSeeds.push(e.to + " — " + e.notAtSeating);
        if (lateSeeds.length === 0)
          lateSaid = "отложенных семян без предмета: 0";
      }
    }
  }
  checkHead("Отложенное семя положено, когда предмет появился", {
    n: seedsDeferred.length,
    unit: "отложенных семян",
  });
  if (lateSaid !== null) console.log("  " + lateSaid);
  if (lateSeeds.length) console.log("  не положено: " + lateSeeds.length);
  for (const one of lateSeeds)
    console.log(
      "    " + one + ". Предмет появился — положить семя из `seat/templates/`",
    );
  checkHead("Отложенное семя не положено посадкой", {
    n: seedsDeferred.length,
    unit: "отложенных семян",
  });
  console.log("  положенных раньше срока: " + earlySeed.length);
  for (const d of earlySeed) console.log("    " + d);
  // Семя с условием не лежит без своего условия.
  //
  // Условие стоит в карте полем `onlyWith`, и кладёт по нему посадка. Семя,
  // положенное мимо условия, не нужно ни одной строке проекта, а выглядит его
  // кодом: имя, кавычки и раскладка спорят с правилами линта и формата
  // проекта. Замерено посадкой в приложение на Tailwind: помощник слияния карт
  // классов лёг по правилу «в любой проект», и линт покраснел на имени файла.
  // Тронутое семя не спрашивается: проект взял его в работу.
  const idleSeeds = [];
  let idleSeedLooked = 0;
  {
    const seeds = seedOfPath();
    for (const e of seedsDeclared) {
      if (e.onlyWith == null) continue;
      idleSeedLooked += 1;
      if (!SEED_CONDITIONS.has(e.onlyWith)) {
        idleSeeds.push(
          e.to +
            " — условие «" +
            e.onlyWith +
            "» не из словаря: " +
            [...SEED_CONDITIONS.keys()].join(", "),
        );
        continue;
      }
      const at = norm(path.join(REPO_AT, e.to));
      if (!existsSync(at) || seedConditionHolds(e)) continue;
      if (untouchedSeed(at, REPO_AT, seeds))
        idleSeeds.push(
          e.to +
            " — лежит семенем, а условия «" +
            e.onlyWith +
            "» у проекта нет: снять вместе с записями базы о нём",
        );
    }
  }
  checkHead("Семя с условием не лежит без условия", {
    n: idleSeedLooked,
    unit: "семян с условием",
  });
  console.log("  лишних: " + idleSeeds.length);
  for (const one of idleSeeds) console.log("    " + one);
  // 44-бис. Находка посадки закрыта — и закрыта доказуемо.
  //
  // Посадка существует затем, чтобы находить поломки обвязки; чинят их на
  // полке. Пока это держалось перепиской, доказательства не было никакого:
  // отчёт говорил «закоммичено и выложено», а закоммичено ли то самое и всё ли
  // — проверить было нечем. Требование завёл разработчик прямой претензией:
  // «раз что-то там закоммичено — ну значит наверное поправлено; все ли
  // находки, вообще непонятно».
  //
  // Сверка держит реестр с двух сторон, и вторая сторона важнее первой.
  //
  // Прямая: у каждой строки обязан быть коммит, существующий в истории, и
  // обязана быть названа опора — сверка, звено цепочки или прогон рецептов,
  // то есть то, что покраснеет при возврате поломки. Починка без опоры
  // держится вниманием и вернётся; «нечем» законно, но считается долгом и
  // печатается отдельным числом.
  //
  // Обратная: каждый коммит с префиксом `fix:`, начиная с объявленного
  // базового, обязан быть назван хотя бы одной строкой. Прямую сторону обойти
  // легко — не записал строку, и сверять нечего. Обратную обойти можно только
  // не чиня вовсе либо пряча починку под другим префиксом, а это уже не
  // забывчивость.
  //
  // Роняет прогон расхождение, а не открытая находка: открытая — это работа, о
  // которой знают, и счёт её печатается баннером.
  const findingDrift = [];
  let findingsOpen = 0;
  let findingsClosed = 0;
  let findingsUnheld = 0;
  let findingsNote = null;
  if (CONFIG.findings != null) {
    const at = path.join(BASE, CONFIG.findings.file);
    if (!existsSync(at))
      findingDrift.push(
        "реестр объявлен, а файла нет: " + CONFIG.findings.file,
      );
    else {
      // Опорой считается имя сверки, имя звена цепочки или прогон рецептов.
      // Словарь закрытый намеренно: открытый превратил бы графу в место, куда
      // пишут что угодно, и сверка стала бы проверять наличие текста.
      // Измерение обвязки — это сверка, звено цепочки ИЛИ РЕЖИМ инструмента.
      // Режимы здесь забывались, хотя соседняя сверка — про шаги перехода —
      // принимает их давно: два определения одного и того же, и одно неполное.
      // Найдено строкой реестра, закрытой режимом `env`.
      const guards = new Set([...CHECK_SECTIONS, ...toolModes()]);
      guards.add("фальсификация");
      guards.add("нечем");
      // Критерий планки — тоже измерение обвязки, и опорой он законен.
      //
      // Соседняя сверка требует называть предложенное сводом открытой строкой
      // реестра, называющей критерий ёлочками, — а эта тем же критерием в
      // графе опоры отвечала «такой опоры не существует». Два словаря об одном
      // предмете, и один неполный: тот же класс, что прежде был с режимами.
      {
        const live = liveBarCriteria();
        for (const c of live?.all ?? []) guards.add(c.id);
      }
      {
        const mapAt = shelfAt("seat/map.json");
        // Звено опорой называют и его ПРОЕКТНЫМ именем: звено опознаётся по
        // тому, что скрипт зовёт, а не по имени, и строка реестра, назвавшая
        // `unit` вместо семенного `test`, отвергалась как несуществующая опора.
        const pkgAt =
          CONFIG.manifest == null ? null : path.join(BASE, CONFIG.manifest);
        const scripts =
          pkgAt === null ? {} : (readJson(pkgAt, {}).scripts ?? {});
        if (mapAt !== null && existsSync(mapAt))
          for (const e of JSON.parse(readFileSync(mapAt, "utf8"))
            .chainScripts ?? []) {
            guards.add(e.name);
            const own = linkOwnName(e.name, scripts);
            if (own !== null) guards.add(own);
          }
      }

      const rows = readFileSync(at, "utf8").split(NEWLINE);
      const head = rows.findIndex((l) => l.startsWith(CONFIG.findings.heading));
      if (head < 0)
        findingDrift.push(
          "таблицы находок не нашли: " + CONFIG.findings.heading,
        );
      else {
        // История читается один раз и целиком: спрашивать git на каждой строке
        // значило бы звать его сотню раз за прогон, а спрашивать диапазоном —
        // падать там, где базового коммита в этой копии нет.
        //
        // Копия, у которой истории нет (песочница фальсификации заводит свой
        // репозиторий одним коммитом, и так же выглядит мелкий клон), сверить
        // коммиты не может. Это НАЗЫВАЕТСЯ строкой вывода, а не молчится:
        // пропуск половины сверки без признака — ровно тот случай, когда
        // проверка зелена оттого, что ей нечего проверять. Расхождением он не
        // считается: истории нет не по вине реестра.
        let log;
        try {
          log = execFileSync("git", ["log", "--format=%h %s"], {
            cwd: REPO,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).split(NEWLINE);
        } catch {
          log = [];
        }
        const base =
          CONFIG.findings.since == null
            ? -1
            : log.findIndex((l) => l.startsWith(CONFIG.findings.since));
        const range = base < 0 ? null : log.slice(0, base + 1);
        if (range === null)
          findingsNote =
            CONFIG.findings.since == null
              ? "коммит-основание не объявлен — реестр копит находки, починки с историей не сверяются"
              : "базового коммита " +
                "базового коммита " +
                CONFIG.findings.since +
                " в истории этой копии нет — коммиты и непойманные починки не сверены";
        const named = new Set();
        const { rows: findingRows, problem } = tableAfter(rows, head);
        if (problem !== null) findingDrift.push(problem);
        for (const row of findingRows) {
          const cell = row.split("|").map((c) => c.trim());
          const [, num, what, , fixedBy, heldBy, state] = cell;
          if (num === undefined || num === "") continue;
          const say = (t) => findingDrift.push("строка " + num + ": " + t);
          if (!what) say("не сказано, что найдено");
          if (state === "открыта") {
            findingsOpen += 1;
            continue;
          }
          if (state !== "закрыта") {
            say("состояние не «открыта» и не «закрыта»: «" + state + "»");
            continue;
          }
          findingsClosed += 1;
          // Хешей в клетке может быть несколько: одна находка бывает
          // починена двумя коммитами, и второй из них иначе некуда деть —
          // отдельной находкой он не является, а обратный крючок объявит его
          // починкой, о которой реестр молчит. Строгость та же: назвать хотя
          // бы один обязательно, и каждый названный обязан быть в истории.
          const hashes = [
            ...(fixedBy ?? "").matchAll(/`([0-9a-f]{7,40})`/g),
          ].map((m) => m[1]);
          if (hashes.length === 0) say("закрыта, а коммит не назван");
          for (const hash of hashes) {
            named.add(hash);
            if (range !== null && !range.some((l) => l.startsWith(hash)))
              say("коммит " + hash + " в истории не найден");
          }
          const opora = [...(heldBy ?? "").matchAll(/«([^»]+)»/g)].map(
            (m) => m[1],
          );
          if (opora.length === 0) say("закрыта, а чем держится — не сказано");
          for (const o of opora) {
            if (!guards.has(o))
              say("держится на «" + o + "» — такой опоры не существует");
            if (o === "нечем") findingsUnheld += 1;
          }
        }
        // Обратная сторона: починка, о которой реестр молчит.
        for (const line of range ?? []) {
          const m = /^([0-9a-f]{7,40}) fix(\([^)]*\))?: /.exec(line);
          if (m === null) continue;
          if (!named.has(m[1]))
            findingDrift.push(
              "коммит " +
                line.trim() +
                " — починка, не названная ни одной строкой",
            );
        }
      }
    }
  }
  checkHead("Находки закрыты", {
    n: findingsClosed + findingsOpen,
    unit: "строк реестра находок",
  });
  console.log(
    CONFIG.findings == null
      ? "  реестр находок не ведётся: «всё найденное починено» держится памятью"
      : "  закрыто: " +
          findingsClosed +
          ", открыто: " +
          findingsOpen +
          ", держится нечем: " +
          findingsUnheld +
          ", расхождений: " +
          findingDrift.length,
  );
  if (findingsNote !== null) console.log("  " + findingsNote);
  for (const d of findingDrift) console.log("    " + d);

  // 45. План перехода живого проекта не потерялся.
  //
  // Посадка в живой проект заканчивается раньше, чем заканчивается переход:
  // обвязка работает, база на месте, а чужой код ещё не под правилами. Это
  // законно — иначе флаг «посадка не завершена» висел бы неделями, а красный,
  // который перестают читать, перестаёт ловить и всё остальное.
  //
  // Но тогда найденное посадкой живёт только в контексте сессии, а он не
  // переживает ни очистки, ни нового дня. Отсюда файл и отсюда эта печать:
  // счёт открытых шагов выводится КАЖДЫМ прогоном, как долг карты и флаг
  // посадки. Требование заведено разработчиком на разборе первой посадки в
  // живой проект.
  //
  // Роняет прогон только расхождение объявления с диском: план объявлен, а
  // файла нет, либо файл есть, а таблицы шагов в нём не нашли. Сами открытые
  // шаги прогон не роняют — незакрытый переход это работа, а не поломка.
  const transitionDrift = [];
  let transitionSteps = 0;
  if (CONFIG.transition != null) {
    const at = path.join(BASE, CONFIG.transition.file);
    if (!existsSync(at))
      transitionDrift.push(
        "план перехода объявлен, а файла нет: " + CONFIG.transition.file,
      );
    else {
      const rows = readFileSync(at, "utf8").split(NEWLINE);
      const head = rows.findIndex((l) =>
        l.startsWith(CONFIG.transition.heading),
      );
      if (head < 0)
        transitionDrift.push(
          "таблицы шагов не нашли: " + CONFIG.transition.heading,
        );
      else {
        const { rows: stepRows, problem } = tableAfter(rows, head);
        if (problem !== null) transitionDrift.push(problem);
        transitionSteps = stepRows.length;
      }
    }
  }
  // Долг описания — не кнопка «выключить сверку». Объявленное число
  // обязано стоять шагом плана перехода: иначе поле настройки делает ровно
  // то, ради ухода от чего обвязку и ставят — переводит невыполненное из
  // «известно и записано» в «забыто молча», причём с виду законно.
  //
  // Проверяется наличие плана, а не упоминание вида долга в его прозе:
  // искать слово «тесты» в тексте плана значило бы разбирать прозу и
  // краснеть на законной переформулировке. План есть — долг записан там,
  // где его читают; плана нет — долг держится только настройкой, которую
  // не перечитывает никто.
  const debtDeclared = DEBT_KINDS.filter((k) => debtOf(k) > 0);
  const debtTotal = debtDeclared.reduce((n, k) => n + debtOf(k), 0);
  // Долг КОДА планом не держится и после его удаления остаётся законным:
  // держит его открытая строка реестра. Считаются поэтому только виды
  // долга БАЗЫ — иначе проект, закончивший переход и удаливший план,
  // получал «долг держится только настройкой» на долге, который планом
  // держаться и не может. Замерено переходом стенда с русским
  // комментарием в коде: план выполнен и удалён, долг по языку остался.
  const DEBT_BY_WORK_KINDS = new Set(["comments", "tongue"]);
  const debtUnplanned =
    debtDeclared.some((one) => !DEBT_BY_WORK_KINDS.has(one)) &&
    (CONFIG.transition == null || transitionSteps === 0);
  /** Какая сверка гаснет, когда долг этого вида закрыт. Пара «вид долга —
   * сверка» и есть то, чем шаг плана опознаётся: шаг обязан назвать её в графе
   * «чем проверяется», и форма этой графы уже сверяется дословно. */
  //
  // Вид долга, общий нескольким сверкам, опознаётся по имени ЛЮБОЙ из них.
  // Пока долгу комментариев была назначена одна сверка из трёх, проект,
  // у которого красен только длинный комментарий, не мог держать долг
  // честно: строку реестра, называющую именно его находку, сверка не
  // признавала и требовала назвать соседнюю, у него зелёную.
  const DEBT_GUARD = {
    map: ["Покрытие карты"],
    tests: ["Покрытие тестов"],
    decisions: ["Пометки решений"],
    invariants: ["Пометки CONSTRAINT"],
    constants: ["Константы настроек описаны"],
    readme: ["У компонента есть README"],
    subjects: ["Предмет из кода назван в своём файле базы"],
    comments: [
      "Закомментированного кода нет",
      "Комментарий не перерос в прозу",
      "Доля комментариев в файле",
    ],
    tongue: ["Язык внутри корня исходников"],
  };
  // Сверка ГОВОРИЛА «все стоят шагами плана», а проверяла только что план
  // вообще есть. Замерено ревизией результата: стенд объявил долг по языку,
  // шага про язык в плане не было ни одного — и строка прогона утверждала
  // обратное. Утверждение без проверки хуже молчания: на него полагаются.
  // Долг бывает ДВУХ родов, и держатся они разным.
  //
  // Долг БАЗЫ — записей, которых проект не успел завести: строка карты,
  // строка реестра тестов, документ узла. Закрывается он чтением кода и
  // письмом в базу, то есть работой ПЕРЕХОДА, и стоит его шагом.
  //
  // Долг КОДА — свойство самого кода, пришедшего до посадки: русский
  // комментарий внутри корня исходников, прежняя витрина в комментарии.
  // Закрыть его можно только ПРАВКОЙ КОДА, а переход код не трогает —
  // граница проведена одним вопросом и исключений не имеет. Шагом плана
  // такой долг стоять не может, и требовать этого значит требовать
  // невозможного: замерено попыткой перевести стенды под правила — планы
  // несли шаги «перевести комментарий на английский», то есть работу над
  // кодом, записанную в документ о завершении посадки.
  //
  // Держит его ОТКРЫТАЯ СТРОКА РЕЕСТРА: она мозолит глаза каждым прогоном,
  // а чинят её работой, когда до неё дойдут руки.
  const DEBT_BY_WORK = DEBT_BY_WORK_KINDS;
  const debtStepless = [];
  {
    const at =
      CONFIG.transition == null
        ? null
        : path.join(BASE, CONFIG.transition.file);
    const plan = at !== null && existsSync(at) ? readFileSync(at, "utf8") : "";
    const open = openFindings();
    for (const kind of debtDeclared) {
      const guards = DEBT_GUARD[kind];
      if (guards === undefined) continue;
      const named = "«" + guards.join("» либо «") + "»";
      if (DEBT_BY_WORK.has(kind)) {
        if (guards.some((g) => (open.get(g) ?? 0) > 0)) continue;
        debtStepless.push(
          kind +
            " — долг КОДА: закрывается правкой кода, а переход её не делает. Держать его обязана открытая строка реестра, называющая " +
            named,
        );
        continue;
      }
      if (!guards.some((g) => plan.includes("«" + g + "»")))
        debtStepless.push(
          kind + " — шага, закрывающего " + named + ", в плане перехода нет",
        );
    }
  }
  // Баннер перехода печатает сверка базы — но её зовут не на каждой правке, а
  // переход измеряется днями. Между двумя прогонами о нём забывают, и файл
  // плана лежит непрочитанным ровно столько же.
  //
  // Держит это ХУК СРЕДЫ: он зовёт дешёвый режим `transition` при начале
  // сессии и при каждой правке файла проекта. Хук едет в снимке и заводится
  // посадкой — иначе следующий проект получил бы план и забыл о нём на
  // второй день.
  //
  // Сверка нужна потому, что хук снимается одной строкой из настроек среды и
  // после этого молчит: напоминания просто не будет, а признака у этого нет
  // никакого. Спрашивается он только при живом переходе — проекту без плана
  // напоминать не о чем.
  // Переход — ЗАВЕРШЕНИЕ ПОСАДКИ, а не аудит: заполнить базу, настроить
  // инструменты, перенацелить рецепты. Починка чужого кода, рефактор и аудит
  // в план не входят — обвязку ставят затем, чтобы такую работу стало
  // возможно вести потом и по правилам.
  //
  // Признак механический: шаг закрывает ИЗМЕРЕНИЕ обвязки — сверку из
  // закрытого списка либо звено цепочки. Графа «чем проверяется» обязана
  // назвать его. Шаг, закрытие которого обвязке не видно, переходом не
  // является, как бы полезен он ни был, и место ему в отложенном.
  //
  // Прежде графу разрешалось заполнить словами «сверки нет, закрывается
  // чтением», и эта форма проглатывала что угодно. Замерено на посадке в
  // стенд одного компонента: из семи шагов правилами обвязки держались два.
  const stepsAdrift = [];
  if (CONFIG.transition != null) {
    const at = path.join(BASE, CONFIG.transition.file);
    if (existsSync(at)) {
      const rows = readFileSync(at, "utf8").split(NEWLINE);
      const head = rows.findIndex((l) =>
        l.startsWith(CONFIG.transition.heading),
      );
      if (head >= 0) {
        // Словарь измерений: имена сверок и имена звеньев цепочки. Звенья
        // берутся из карты посадки — там они объявлены данными.
        // Измерение обвязки — это сверка, звено цепочки ИЛИ РЕЖИМ инструмента.
        // Режимы забылись при заведении, и шаг «перенацелить рецепты», который
        // закрывается прогоном `falsify`, был объявлен мимо измерения — а он
        // ровно то, чем переход и является.
        const measures = new Set([...CHECK_SECTIONS, ...toolModes()]);
        {
          const mapAt = shelfAt("seat/map.json");
          if (mapAt !== null && existsSync(mapAt))
            for (const e of JSON.parse(readFileSync(mapAt, "utf8"))
              .chainScripts ?? [])
              measures.add(e.name);
        }
        const { rows: stepRows } = tableAfter(rows, head);
        for (const row of stepRows) {
          const cells = row
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
          if (cells.length < 4) continue;
          const proof = cells[3];
          // Названо ли измерение. Имя сверки пишется в кавычках-ёлочках и
          // сверяется целиком; имя звена или режима — в обратных кавычках и
          // внутри КОМАНДЫ, поэтому команда разбирается на слова и целиком
          // сверяется каждое.
          //
          // Прежде здесь стояли `endsWith` и `includes(' ' + x)` при
          // комментарии «ищутся целиком»: комментарий открещивался ровно от
          // того, что код и делал, и `какой-то-test` проходил хвостом слова.
          const words = (text) =>
            text.split(/[^A-Za-z0-9:._-]+/).filter(Boolean);
          const named =
            [...proof.matchAll(/«([^»]+)»/g)].some((m) => measures.has(m[1])) ||
            [...proof.matchAll(/`([^`]+)`/g)].some((m) =>
              words(m[1]).some((w) => measures.has(w)),
            );
          // Сообщение называет и ФОРМУ. Прежде оно называло одну проблему,
          // и заполняющий подбирал форму перебором: имя сверки пишется
          // ёлочками, имя звена или режима — обратными кавычками, и ни семя
          // плана, ни эта строка об этом не говорили.
          if (!named)
            stepsAdrift.push(
              "шаг " +
                cells[0] +
                " не называет измерения обвязки: «" +
                proof +
                "». Сверка пишется ёлочками, звено или режим — обратными кавычками",
            );
        }
      }
    }
  }
  checkHead("Шаги перехода закрывают измерение", {
    n: transitionSteps,
    unit: "шагов плана перехода",
  });
  console.log(
    CONFIG.transition == null
      ? "  перехода нет: проверять нечего"
      : stepsAdrift.length
        ? "  шагов мимо измерения: " + stepsAdrift.length
        : "  каждый шаг называет сверку или звено цепочки",
  );
  for (const a of stepsAdrift) console.log("    " + a);

  const hookOff = [];
  // Адрес берётся у ПОЛКИ, а не из поля `settingsProject`. Поле
  // необязательное: проект вправе поставить `null`, и тогда сверка замолчала
  // бы вместе с ним — при том что хук живёт в настройках среды независимо от
  // того, сверяет их кто-нибудь с полкой или нет.
  if (CONFIG.transition != null) {
    const at = shelfAt("settings.json");
    if (at === null || !existsSync(at))
      hookOff.push("файла разрешений среды нет: напоминание включить нечем");
    else {
      let parsed = null;
      try {
        parsed = JSON.parse(readFileSync(at, "utf8"));
      } catch {
        hookOff.push(
          "файл разрешений не разбирается: " + CONFIG.settingsProject,
        );
      }
      if (parsed !== null) {
        // Ищется ВЫЗОВ РЕЖИМА, а не имя события: событий у среды несколько, и
        // проект вправе выбрать своё. Важно одно — что режим кто-то зовёт.
        const calls = JSON.stringify(parsed.hooks ?? {}).includes(
          "graph.mjs transition",
        );
        if (!calls)
          hookOff.push(
            "переход объявлен, а хук среды режим `transition` не зовёт: напоминания не будет",
          );
      }
    }
  }
  checkHead("Напоминание о переходе включено", {
    n: 1,
    unit: "настройка хука среды",
  });
  console.log(
    CONFIG.transition == null
      ? "  перехода нет: напоминать не о чем"
      : hookOff.length
        ? "  расхождений: " + hookOff.length
        : "  хук среды зовёт режим `transition`: напоминание печатается при правке",
  );
  for (const h of hookOff) console.log("    " + h);

  // Долг — разрешение, выданное НА ВРЕМЯ, и оно обязано сжиматься следом за
  // работой. Переход описывает код, неописанного не остаётся — а поле долга
  // продолжает разрешать потерять ровно столько же, и прогон при этом зелёный.
  // Замерено на семи стендах разом: после перехода все семь несли разрешение
  // потерять шесть файлов карты, документ узла и две записи предметов.
  const debtFat = [];
  for (const [kind, said] of Object.entries(CONFIG.debt ?? {})) {
    if (said == null || said === 0) continue;
    const real = DEBT_REAL.get(kind);
    if (real === undefined) continue;
    if (said > real)
      debtFat.push(
        kind +
          ": объявлено " +
          said +
          ", а неописанного осталось " +
          real +
          ". Уменьшить поле до " +
          real +
          " и снять закрытый шаг из плана перехода",
      );
  }
  checkHead("Объявленный долг не больше фактического", {
    n: DEBT_REAL.size,
    unit: "видов долга, посчитанных прогоном",
  });
  console.log("  разрешено больше, чем нужно: " + debtFat.length);
  for (const one of debtFat) console.log("    " + one);

  checkHead("Объявленный долг назван планом перехода", {
    n: Object.keys(CONFIG.debt ?? {}).length,
    unit: "видов долга",
  });
  console.log(
    debtDeclared.length === 0
      ? "  долга не объявлено: записи обязаны быть полными"
      : debtUnplanned
        ? "  объявлено долга: " +
          debtTotal +
          " по видам " +
          debtDeclared.join(", ") +
          " — а плана перехода нет"
        : debtStepless.length > 0
          ? "  объявлено долга: " +
            debtTotal +
            " по видам " +
            debtDeclared.join(", ") +
            " — а шагов под них нет: " +
            debtStepless.length
          : "  объявлено долга: " +
            debtTotal +
            " по видам " +
            debtDeclared.join(", ") +
            (debtDeclared.every((k) => DEBT_BY_WORK.has(k))
              ? " — все держатся открытыми строками реестра"
              : debtDeclared.some((k) => DEBT_BY_WORK.has(k))
                ? " — все названы: долг базы шагами плана, долг кода открытыми строками реестра"
                : " — все стоят шагами плана"),
  );
  for (const one of debtStepless) console.log("    " + one);
  if (debtUnplanned)
    console.log(
      "    долг держится только настройкой: заполнить `transition` и" +
        " завести план, либо описать записи и обнулить долг",
    );

  checkHead("План перехода не потерялся", {
    n: transitionSteps,
    unit: "шагов плана перехода",
  });
  console.log(
    CONFIG.transition == null
      ? "  перехода нет: проект родился под обвязкой либо переход закончен"
      : transitionDrift.length
        ? "  расхождений: " + transitionDrift.length
        : "  шагов перехода открыто: " +
          transitionSteps +
          " — закрытый шаг из таблицы удаляют; таблица опустела, файл удаляют целиком",
  );
  for (const d of transitionDrift) console.log("    " + d);

  // Переход печатается БАННЕРОМ, а не строкой счёта, и это требование
  // разработчика: «про план мы не должны забывать, пока он не будет выполнен».
  // Строка среди полусотни секций читается ровно до тех пор, пока её не
  // перестают замечать; баннер занимает место и называет адрес файла, чтобы
  // сессия, начавшаяся с чистого контекста, знала, куда смотреть.
  // Открытые находки печатаются БАННЕРОМ по той же причине, что и переход:
  // строка среди полусотни секций читается ровно до тех пор, пока её не
  // перестают замечать.
  if (findingsOpen > 0) {
    console.log("");
    banner("НАХОДКИ ПОСАДКИ НЕ ЗАКРЫТЫ");
    console.log("  Открытых находок: " + findingsOpen + ".");
    console.log("  Реестр: " + CONFIG.findings.file + " — открыть и читать");
    console.log("  оттуда, а не восстанавливать по памяти.");
    console.log("  Закрыли — проставить коммит, опору и состояние.");
  }

  // 46. Форма отчёта посадки не несёт слов обвязки.
  //
  // Правило под самой формой говорит прямо: «Слова обвязки в отчёт не идут —
  // ни одно», и перечисляет их. Машинной формы у правила не было, и форма
  // нарушала его сама: «планка», «семя», «долг» и дважды «сверка» стояли в
  // блоке, объявленном дословным и обязательным. Читатель отчёта видит эти
  // слова впервые — за спиной у него одна прочитанная строчка.
  //
  // Найдено вопросом разработчика: «что за планки? это я знаю, что планка
  // качества, а читатель возможно видит это впервые».
  //
  // Список слов берётся ИЗ САМОГО ПРАВИЛА, а не заводится рядом: вторая копия
  // разошлась бы первой, и разошлась бы молча. Дописали слово в правило —
  // сверка им и спрашивает.
  const reportJargon = [];
  {
    const at = shelfAt("seat/seat.md");
    if (at !== null && existsSync(at)) {
      const lines = readFileSync(at, "utf8").split(NEWLINE);
      const ruleAt = lines.findIndex((l) =>
        l.startsWith("- **Слова обвязки в отчёт не идут"),
      );
      let banned = [];
      if (ruleAt >= 0) {
        let text = "";
        for (let i = ruleAt; i < lines.length; i += 1) {
          if (i > ruleAt && lines[i].startsWith("- **")) break;
          text += lines[i] + " ";
        }
        // Дальше по правилу идут примеры «как писать вместо» — тоже в ёлочках.
        // Границу ставит оборот, которым кончается сам перечень.
        const cut = text.indexOf("— это её внутренние термины");
        banned = [
          ...(cut < 0 ? text : text.slice(0, cut)).matchAll(/«([^»]+)»/g),
        ].map((m) => m[1]);
      }
      // Форма — блок в тройных кавычках, где стоит её первая строка.
      let from = -1;
      let to = -1;
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].startsWith("```")) continue;
        let shut = i + 1;
        while (shut < lines.length && !lines[shut].startsWith("```")) shut += 1;
        if (
          lines.slice(i, shut).some((l) => l.includes("ПОСАДКА НЕ ЗАВЕРШЕНА"))
        ) {
          from = i;
          to = shut;
          break;
        }
        i = shut;
      }
      if (banned.length === 0)
        reportJargon.push(
          "перечень слов в правиле не найден: спрашивать нечем",
        );
      else if (from < 0)
        reportJargon.push("блок формы отчёта не найден: спрашивать не о чем");
      else {
        // Основа слова: русское слово склоняется, и целиком его искать
        // бесполезно. Отсекается ОКОНЧАНИЕ, а не длина: «сверка» даёт «сверк»,
        // «семя» — «сем», «фальсифицировать» — «фальсифицирова».
        //
        // Обрубание до четырёх букв стояло здесь и давало ложное срабатывание:
        // «свер» находилось в слове «сверяет», то есть сверка краснела на
        // обычном русском глаголе. Ложное срабатывание учит не читать вывод.
        const stem = (w) => {
          let h = w.split(" ")[0].toLowerCase();
          h = h.replace(/ь$/, "").replace(/[аяоеыиуюэё]$/, "");
          return h.length > 6 ? h.replace(/т$/, "") : h;
        };
        for (let i = from + 1; i < to; i += 1) {
          const low = lines[i].toLowerCase();
          for (const w of banned) {
            const st = stem(w);
            if (!new RegExp("(^|[^а-яёa-z])" + st).test(low)) continue;
            reportJargon.push(
              rel0(at) + ":" + (i + 1) + " — «" + w + "»: " + lines[i].trim(),
            );
          }
        }
      }
    }
  }
  checkHead("Форма отчёта посадки без слов обвязки", {
    n: 1,
    unit: "форма отчёта посадки",
  });
  console.log("  слов обвязки в форме: " + reportJargon.length);
  for (const r of reportJargon) console.log("    " + r);

  checkHead(
    "Вопросы разработчику без ответа (предупреждение, прогон не роняет)",
    {
      n: questionsSeen,
      unit: "вопросов в списках",
    },
  );
  console.log(
    CONFIG.questions == null
      ? "  список вопросов не заявлен"
      : `  открытых: ${openQuestions.length}` +
          (openQuestions.length
            ? " — назвать КАЖДЫЙ в отчёте, включая заданные не сегодня"
            : ""),
  );
  for (const q of openQuestions) console.log("    " + q);

  // Ни одна сверка не молчит о размере своего корпуса.
  //
  // Правило записано рукой обвязки и относилось к одной сверке: она печатает,
  // СКОЛЬКО проверила, и никогда — сколько должна была; разница между этими
  // двумя числами и есть слепое пятно. Вниманием оно не удержалось дважды:
  // сверка про README и сверка про документы компонента сужали корпус зашитым
  // путём раскладки, в проекте с иной раскладкой не смотрели никуда и печатали
  // ноль. Отличить такой ноль от здоровья было нельзя.
  //
  // Стоит ПОСЛЕДНЕЙ: спрашивается с того, что уже напечатано. Новая сверка,
  // заведённая без довода о корпусе, роняет прогон на первом же запуске.
  // Порча файла, который обвязка пишет сама, прежде роняла прогон сырым
  // стеком, и оставшаяся треть сверок не выполнялась. Теперь чтение
  // защищено, а порча называется — и роняет прогон осмысленно.
  checkHead("Файл, написанный обвязкой, читается", {
    n: SPOILED.length,
    unit: "испорченных файлов",
  });
  console.log("  испорчено: " + SPOILED.length);
  for (const one of SPOILED)
    console.log(
      "    " +
        rel0(one) +
        ". Переписать заново либо удалить: обвязка заведёт его сама",
    );

  // Звено, пришедшее красным, обязано иметь открытую строку реестра. Иначе
  // замер сделан и забыт: базовая линия записывается один раз, а напоминать
  // о непочинённом коде нечему.
  // Имена звеньев цепочки В ЭТОМ проекте: семенное имя и то, под которым
  // проект держит то же звено, — опознанное тем же образцом, что у слияния
  // манифеста. Прежде спрашивались одни семенные имена: звено под своим
  // именем в корпус не входило, и сверка печатала «осмотрено пять» при
  // шести строках. Проект, назвавший по-своему ВСЕ звенья, получил бы
  // ложное «в базовой линии не опознано ни одного» — ровно на верно
  // записанной базовой линии. Замерено посадкой руками в проект со звеном
  // типов `types`.
  const chainLinkNames = () => {
    const mapAt = shelfAt("seat/map.json");
    if (mapAt === null || !existsSync(mapAt)) return [];
    const scripts =
      readJson(path.join(BASE, "..", "package.json"), {}).scripts ?? {};
    const out = new Set();
    for (const one of readJson(mapAt, {}).chainScripts ?? []) {
      out.add(one.name);
      const own = linkOwnName(one.name, scripts);
      if (own !== null) out.add(own);
    }
    return [...out];
  };
  const redUnnamed = [];
  let redLinks = 0;
  {
    // Таблица базовой линии ищется по своей шапке во всей базе: поля под неё
    // нет, а заводить его ради одной сверки значит просить проект объявить
    // то, что и так лежит в семени под известным именем.
    // Спрашивается ЛЮБАЯ строка — и открытая, и закрытая: запись базовой
    // линии есть замер прошлого, и починка звена не должна ронять прогон.
    const open = namedFindings();
    const chainNames = new Set(chainLinkNames());
    // Забор пропускается: строка в нём — ОБРАЗЕЦ формы, а не замер. Пока
    // это не различалось, семя базовой линии показывало форму живой
    // строкой, и свежепосаженный проект получал красное звено, которого
    // никто не мерил, — знание, выведенное из чужого примера.
    const lines = [];
    for (const name of readdirSync(BASE)) {
      if (!name.endsWith(".md")) continue;
      lines.push(
        ...unfenced(readFileSync(path.join(BASE, name), "utf8")).split(NEWLINE),
      );
    }
    {
      for (const line of lines) {
        // Корпус — строки, опознанные КАК строки звена, а не только красные:
        // ноль красных при зелёной цепочке есть здоровье, а ноль опознанных
        // при живых звеньях — слепота, и различать их надо здесь.
        const row = /^\|\s*`([^`]+)`\s*\|\s*\S/.exec(line.trim());
        if (row !== null && chainNames.has(row[1])) redLinks += 1;
        const m = /^\|\s*`([^`]+)`\s*\|\s*красно/.exec(line.trim());
        if (m === null) continue;
        if (m[1] === "verify") continue;
        if ((open.get(m[1]) ?? 0) > 0) continue;
        redUnnamed.push(
          "`" +
            m[1] +
            "` пришло красным, а открытой строки реестра под него нет. Имя звена в строке реестра пишется в ёлочках: «" +
            m[1] +
            "»",
        );
      }
    }
  }
  // Корпус этой сверки — ПРОЗА, которую пишет человек, и форму её до сих пор
  // не называл никто: семя базовой линии даёт свободный абзац. Написанная
  // иначе строка не опознаётся, сверка осматривает ноль и остаётся зелёной —
  // то есть ровно «проверено ноль» неотличимо от «предмета нет», что свод
  // запрещает прямо. Замерено посадкой в пустой проект: базовая линия
  // называла красный формат словом, а не именем звена, и сверка не увидела
  // ни одного звена при трёх живых.
  const chainAlive = (() => {
    const at = path.join(BASE, "..", "package.json");
    const scripts = Object.keys(readJson(at, {}).scripts ?? {});
    return chainLinkNames().filter((one) => scripts.includes(one)).length;
  })();
  // Базовая линия ещё не ЗАПИСАНА — в её разделе стоит подсказка заготовки.
  // Тогда говорить о слепоте рано: незаполненное место называет сверка
  // «Шаблон правил заполнен», и под флагом посадки законно. Слепота — это
  // линия записана, а звено в ней не опознано. Прежде сверка краснела и на
  // незаписанной, и самопроверка снимка, сажающая обвязку в пустую папку
  // без шага 7, не могла пройти ни разу: снимок не собирался вовсе.
  // Замерено сборкой снимка после посадок руками.
  const baselineUnwritten = (() => {
    for (const name of readdirSync(BASE)) {
      if (!name.endsWith(".md")) continue;
      let inBaseline = false;
      for (const line of readFileSync(path.join(BASE, name), "utf8").split(
        NEWLINE,
      )) {
        if (/^##\s/.test(line))
          inBaseline = (CONFIG.baselineSections ?? []).some((one) =>
            line.includes(one),
          );
        else if (inBaseline && /^<[^!]/.test(line.trim())) return true;
      }
    }
    return false;
  })();
  const redBlind = redLinks === 0 && chainAlive > 0 && !baselineUnwritten;
  checkHead("Красное звено названо находкой", {
    n: redLinks,
    unit: "звеньев в базовой линии",
  });
  if (redBlind)
    console.log(
      "    звеньев цепочки у проекта " +
        chainAlive +
        ", а в базовой линии не опознано ни одного: строка звена пишется" +
        " ИМЕНЕМ В ОБРАТНЫХ КАВЫЧКАХ в первой графе, иначе сверка слепа",
    );
  console.log("  без строки реестра: " + redUnnamed.length);
  for (const one of redUnnamed)
    console.log(
      "    " + one + ". Завести строку открытой: чинить это переходом нельзя",
    );

  // «Не мерено» — обещание замерить, и держится оно ничем. Спрашивается не
  // замер, его нельзя сделать в день посадки, а ЗАПИСЬ: открытая строка
  // реестра, которая мозолит глаза, пока замера нет.
  let unmeasured = 0;
  let unmeasuredNamed = true;
  {
    // Реестр находок из корпуса ИСКЛЮЧЁН: он описывает находки, а не ведёт
    // замеры. Строка про то, что цена ярусов когда-то была не мерена,
    // содержит эти же слова — и, будучи ЗАКРЫТОЙ, требовала открытой строки
    // под саму себя. Замерено закрытием находки о цене ярусов: замер
    // сделан, числа записаны, а прогон требовал держать напоминание о
    // работе, которой больше нет.
    const skipBase = CONFIG.findings == null ? null : CONFIG.findings.file;
    for (const name of readdirSync(BASE)) {
      if (!name.endsWith(".md")) continue;
      if (name === skipBase) continue;
      for (const line of readFileSync(path.join(BASE, name), "utf8").split(
        NEWLINE,
      ))
        if (line.includes("не мерено")) unmeasured += 1;
    }
    if (unmeasured > 0)
      unmeasuredNamed =
        (openFindings().get("Незамеренное названо находкой") ?? 0) > 0;
  }
  checkHead("Незамеренное названо находкой", {
    n: unmeasured,
    unit: "записей «не мерено» в базе",
  });
  console.log("  без строки реестра: " + (unmeasuredNamed ? 0 : 1));
  if (!unmeasuredNamed)
    console.log(
      "    замер отложен, а напомнить о нём нечему. Завести строку открытой",
    );

  const mute = [...PRINTED].filter((one) => !LOOKED.has(one));
  const notNumber = [...LOOKED].filter(
    ([, one]) => !Number.isInteger(one.n) || one.n < 0,
  );
  checkHead("Каждая сверка называет свой корпус", {
    n: PRINTED.size,
    unit: "сверок в этом прогоне",
  });
  console.log("  молчат о корпусе: " + (mute.length + notNumber.length));
  for (const one of mute)
    console.log(
      "    " + one + ". Назвать вторым доводом `checkHead`, сколько осмотрено",
    );
  for (const [one, looked] of notNumber)
    console.log(
      "    " +
        one +
        " — корпус назван, но это не число: «" +
        String(looked.n) +
        "». Считать осмотренное, а не брать длину у чужого помощника",
    );
  for (const q of malformedQuestions) console.log("    сломана форма: " + q);

  // Судит НАПЕЧАТАННОЕ, а не перечень имён: перечень старел молча, и сверка,
  // забытая в нём, печатала находки при зелёном прогоне.
  if (printedRed()) process.exitCode = 1;
}
