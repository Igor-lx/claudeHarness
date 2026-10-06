// Конфиг линтера. Кладётся в корень проекта как `eslint.config.mjs` и правок
// при посадке не требует: проектные послабления дописывают, когда появится
// первый случай.
//
// Имя с `.mjs` потому, что файл написан модулем, а под этим именем он модуль
// в любом пакете — и с `"type": "module"` в манифесте, и без. Под `.js` в
// пакете без этого поля среда на каждом прогоне линта печатала
// предупреждение и разбирала файл дважды. Замерено посадкой руками в проект
// на обычном JavaScript.
//
// ЧТО ЭТОТ ФАЙЛ ДЕРЖИТ, а не оформляет:
//
// 1. Линт не форматирует. `eslint-config-prettier` идёт ПОСЛЕДНИМ и гасит все
//    правила, пересекающиеся с форматтером. Без него два инструмента спорят об
//    одних и тех же строках, и правка «под линт» ломает формат, а правка «под
//    формат» ломает линт. Это первая причина, по которой конфиг едет шаблоном:
//    установленный линтер без этой строки создаёт работу, а не убирает.
// 2. Проверка типов включена в линт (`strictTypeChecked` +
//    `projectService`). Правила, которым нужен тип, — единственные, что ловят
//    «плавающий» промис, ненужный `await`, сравнение несравнимого,
//    неисчерпывающий выбор. Без `projectService` они молча не работают:
//    конфиг выглядит настроенным.
// 3. Правила React-хуков включены во ВСЁМ репозитории, включая правила
//    компилятора. Они же защищают от StrictMode и конкурентного рендера,
//    поэтому нужны и там, где компилятор выключен.
// 4. Генерируемые папки исключены. Песочница мутационного прогона держит копию
//    всего дерева: не исключив её, линт проверяет проект дважды и сообщает о
//    файлах, которых никто не писал.
// 5. Правила, решающие форму нарушения критерия планки без суждения: глубина
//    и сложность, магические числа, переприсвоение довода, исчерпывающий
//    выбор, ключ элемента списка, утечка из эффекта, опасная разметка,
//    доступность, повторы. Правило здесь стоит потому,
//    что держит критерий `quality.md` (`J2`: что можно проверить машиной,
//    проверяется машиной); правило, не держащее ни одного критерия, впрок не
//    заводят. Какое правило какой критерий держит, называет матрица
//    `graph.mjs bar-hold`. Пакеты выбраны по совместимости с закреплённым `eslint`:
//    `eslint-plugin-react` и `eslint-plugin-jsx-a11y` его не поддерживают, и их
//    заменяют `@eslint-react/eslint-plugin` и `eslint-plugin-jsx-a11y-x`.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintReact from "@eslint-react/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import sonarjs from "eslint-plugin-sonarjs";
import prettier from "eslint-config-prettier/flat";

// Правила сверх наборов, общие исходникам на TypeScript и на JavaScript: в
// наборе их нет либо они стоят предупреждением, которое цепочку не роняет.
// Пороги — первое приближение, и меняют их решением с записью, а не
// выключением правила.
const OWN = {
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-params": ["error", 4],
  "max-nested-callbacks": ["error", 3],
  "no-param-reassign": "error",
  // Чётность и половина — законные числа; остальное получает имя (`H7`).
  "@typescript-eslint/no-magic-numbers": [
    "error",
    {
      ignore: [-1, 0, 1, 2],
      ignoreEnums: true,
      ignoreNumericLiteralTypes: true,
      ignoreReadonlyClassProperties: true,
      ignoreTypeIndexes: true,
      ignoreArrayIndexes: true,
    },
  ],
  "react-hooks/exhaustive-deps": "error",
  "@eslint-react/web-api-no-leaked-event-listener": "error",
  "@eslint-react/web-api-no-leaked-interval": "error",
  "@eslint-react/web-api-no-leaked-timeout": "error",
  "@eslint-react/web-api-no-leaked-resize-observer": "error",
  "@eslint-react/web-api-no-leaked-intersection-observer": "error",
  "@eslint-react/web-api-no-leaked-fetch": "error",
  "@eslint-react/dom-no-dangerously-set-innerhtml": "error",
  "@eslint-react/dom-no-script-url": "error",
  "@eslint-react/dom-no-unsafe-iframe-sandbox": "error",
  "@eslint-react/dom-no-missing-iframe-sandbox": "error",
  "@eslint-react/dom-no-unsafe-target-blank": "error",
  "@eslint-react/no-unstable-context-value": "error",
  "@eslint-react/no-unstable-default-props": "error",
};

export default tseslint.config(
  {
    // Сборка, покрытие, зависимости, статика — не авторский код. Сюда же
    // добавляют папки инструментов, порождающих копии дерева.
    ignores: [
      // ПАПКА ОБВЯЗКИ ЦЕЛИКОМ: это не код проекта.
      //
      // В ней лежат заготовки, доктрина и сам инструмент базы знаний. Проект
      // их не писал и править не может: находки линтера по ним — шум, который
      // приучает не читать вывод. Прежде исключались только семена, и когда
      // разбор научился видеть обычный JavaScript, линтер проекта пошёл по
      // инструменту обвязки и покраснел на его стиле. Замерено посадкой в
      // проект без TypeScript.
      //
      // Мастерская обвязки — исключение, и оно естественное: там инструмент
      // и есть продукт, а её собственный конфиг живёт отдельным файлом.
      ".claude",
      // Образцы пишутся С ДВУМЯ ЗВЁЗДОЧКАМИ, а не голым именем: голое имя
      // линтер сверяет с путём ОТ КОРНЯ конфига и находит только папку
      // верхнего уровня. Проект, чья сборка кладёт вывод глубже — скажем,
      // сборщик с `root: "client"` кладёт его в `client/dist`, — получал
      // линт по собственному бандлу: замерено посадкой стенда с двумя
      // деревьями, `1901` находка в одном сжатом файле.
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/public/**",
      "**/.stryker-tmp/**",
      // Песочница фальсификации: копия дерева, живёт минуты, соседний линт её разбирал.
      "**/.проба-сверок/**",
      "**/reports/**",
    ],
  },

  // Исходники, полки и тесты: линт с типами.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    // Конфиги сборки в корне исключены ОТСЮДА и разобраны ниже без типов.
    // Проект компилятора у живого репозитория обычно накрывает `src` и
    // только его, а конфиг лежит в корне: под образец он попадает, в проект
    // — нет, и служба роняет разбор ошибкой `not found by the project
    // service`. Замерено вторым кругом проб: звено линта было красным во
    // всех семи посаженных проектах на файле, которого никто не писал.
    ignores: ["*.config.{ts,mts,cts}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat["recommended-latest"],
      eslintReact.configs["strict-type-checked"],
      jsxA11y.configs.recommended,
      sonarjs.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      ...OWN,
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@eslint-react/no-unused-props": "error",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ИСХОДНИКИ НА ОБЫЧНОМ JAVASCRIPT.
  //
  // Умолчание обвязки — TypeScript, но живой проект на обычном JavaScript
  // существует, и обвязку в него сажают так же. Пока блока не было, такой
  // проект линтером НЕ РАЗБИРАЛСЯ вовсе: файлы с расширением jsx не подходили
  // ни под один образец, а файлы js попадали в блок оснастки — с глобальными
  // именами узла вместо браузера и без правил хуков. Звено оставалось зелёным,
  // разобрав четыре файла самой обвязки и ни одного файла проекта. Замерено
  // посадкой в проект без TypeScript.
  //
  // Правила БЕЗ ТИПОВ, и это не упущение: разбор с типами требует, чтобы файл
  // входил в проект компилятора, а здесь компилятора может не быть вовсе.
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    ignores: ["*.config.{js,mjs,cjs}", "eslint.config.mjs"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strict,
      reactHooks.configs.flat["recommended-latest"],
      eslintReact.configs.strict,
      jsxA11y.configs.recommended,
      sonarjs.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      ...OWN,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // ПРАВИЛА, КОТОРЫЕ УЖЕ ДЕРЖИТ ДРУГОЙ ДЕРЖАТЕЛЬ. Второй держатель того же
  // печатал бы одно нарушение дважды, а выход, который повторяется, перестают
  // читать.
  {
    rules: {
      // Маркеры отложенной работы держит сверка «Найденное — исправлено, а не
      // отложено»: она отличает маркер от его имени в обратных кавычках и
      // ведёт долг живого кода. Sonar краснел на описании маркера.
      "sonarjs/todo-tag": "off",
      "sonarjs/fixme-tag": "off",
      // Правила компилятора React держит `react-hooks`, официальная
      // реализация; набор `@eslint-react` несёт их копии.
      "@eslint-react/rules-of-hooks": "off",
      "@eslint-react/exhaustive-deps": "off",
      "@eslint-react/purity": "off",
      "@eslint-react/set-state-in-effect": "off",
      "@eslint-react/set-state-in-render": "off",
      "@eslint-react/static-components": "off",
      "@eslint-react/no-nested-component-definitions": "off",
      "@eslint-react/use-memo": "off",
      "@eslint-react/error-boundaries": "off",
      "@eslint-react/unsupported-syntax": "off",
      // Копии в наборе sonar: то же нарушение держит правило ядра,
      // `typescript-eslint`, `react-hooks` либо `@eslint-react`. Каждая пара
      // проверена посадкой: одно нарушение — две строки.
      "sonarjs/no-unused-vars": "off",
      "sonarjs/unused-import": "off",
      "sonarjs/no-dead-store": "off",
      "sonarjs/deprecation": "off",
      "sonarjs/no-array-delete": "off",
      "sonarjs/no-control-regex": "off",
      "sonarjs/no-empty-character-class": "off",
      "sonarjs/no-invalid-regexp": "off",
      "sonarjs/no-misleading-character-class": "off",
      "sonarjs/no-regex-spaces": "off",
      "sonarjs/no-fallthrough": "off",
      "sonarjs/no-useless-catch": "off",
      "sonarjs/no-hook-setter-in-body": "off",
      "sonarjs/jsx-no-leaked-render": "off",
    },
  },

  // Оснастка на Node: конфиги сборки и разовые скрипты в корне. Узкий образец,
  // а не «все js»: широкий забирал себе исходники проекта на JavaScript.
  {
    files: [
      "*.config.{js,mjs,cjs}",
      "*.config.{ts,mts,cts}",
      "eslint.config.mjs",
      "scripts/**/*.{js,mjs,ts}",
    ],
    // БЕЗ ТИПОВ, и по той же причине, что у исходников на обычном
    // JavaScript: файл не входит в проект компилятора, и правила, которым
    // нужен тип, разобрать его не могут. Набор `recommended` при этом
    // обязателен — без него разборщик TypeScript не подключается вовсе, и
    // конфиг сборки на `.ts` падает уже на синтаксисе.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },

  // ПОСЛАБЛЕНИЯ ДЛЯ ТЕСТОВ — единственные, что едут шаблоном, потому что
  // описывают устройство тестов, а не вкус проекта. Каждое с причиной на
  // месте: правило проекта требует объяснять точечное выключение там же, где
  // оно стоит.
  //
  // `act` возвращает thenable только в async-скоупе, поэтому помощники
  // объявляют `async` без `await` внутри — это требование API, а не оплошность.
  {
    files: ["**/tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: { "@typescript-eslint/require-await": "off" },
  },

  // Фикстуры живут на модульном уровне и переприсваиваются между случаями, а
  // ref тест читает и подменяет по своему праву. Оба правила описывают код
  // компонентов, а не тестов.
  {
    files: ["**/tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: {
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
    },
  },

  // Ожидаемое в тесте пишется литералом: `J13` требует знать его независимо
  // от проверяемого кода, а имя константы тянуло бы его из кода.
  {
    files: ["**/tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },

  // ПРОЕКТНЫХ ПОСЛАБЛЕНИЙ НЕТ: кода в проекте ещё нет, и гасить нечего.
  //
  // Заводятся по одному блоку на случай, каждое с причиной в комментарии рядом.
  // Гасить правило файлами или целыми папками без причины нельзя: выключение, о
  // котором никто не помнит, читается как здоровье. Состав таких блоков
  // сверяется в обе стороны с полем настройки, и оба направления роняют прогон:
  // выключение без записи и запись без выключения.

  // Гасит всё, что пересекается с форматтером. Обязан быть последним.
  prettier,
);
