// Шаблон плоского конфига линтера. Кладётся в корень проекта как
// `eslint.config.js`; всё, что помечено <...>, заполняется под проект.
//
// ЧТО ЭТОТ ФАЙЛ ДЕРЖИТ, а не оформляет:
//
// 1. Линт не форматирует. `eslint-config-prettier` идёт ПОСЛЕДНИМ и гасит все
//    правила, пересекающиеся с форматтером. Без него два инструмента спорят об
//    одних и тех же строках, и правка «под линт» ломает формат, а правка «под
//    формат» ломает линт. Это первая причина, по которой конфиг едет шаблоном:
//    установленный линтер без этой строки создаёт работу, а не убирает.
// 2. Проверка типов включена в линт (`recommendedTypeChecked` +
//    `projectService`). Правила, которым нужен тип, — единственные, что ловят
//    «плавающий» промис, ненужный `await`, сравнение несравнимого. Без
//    `projectService` они молча не работают: конфиг выглядит настроенным.
// 3. Правила React-хуков включены во ВСЁМ репозитории, включая правила
//    компилятора. Они же защищают от StrictMode и конкурентного рендера,
//    поэтому нужны и там, где компилятор выключен.
// 4. Генерируемые папки исключены. Песочница мутационного прогона держит копию
//    всего дерева: не исключив её, линт проверяет проект дважды и сообщает о
//    файлах, которых никто не писал.
//
// ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО: списка «наших» правил. Правило заводят по факту —
// когда дефект уже прошёл мимо, — а не впрок; свод качества лежит в
// `quality.md` и линтом не заменяется.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier/flat";

export default tseslint.config(
  {
    // Сборка, покрытие, зависимости, статика — не авторский код. Сюда же
    // добавляют папки инструментов, порождающих копии дерева.
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      "public",
      ".stryker-tmp",
      "reports",
    ],
  },

  // Исходники, полки и тесты: линт с типами.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat["recommended-latest"],
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

  // Оснастка на Node вне проектов TypeScript: конфиги сборки, разовые скрипты.
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
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
    files: ["**/tests/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/require-await": "off" },
  },

  // Фикстуры живут на модульном уровне и переприсваиваются между случаями, а
  // ref тест читает и подменяет намеренно. Оба правила описывают код
  // компонентов, а не тестов.
  {
    files: ["**/tests/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
    },
  },

  // <ПРОЕКТНЫЕ ПОСЛАБЛЕНИЯ — по одному блоку на случай, каждое с причиной в
  // комментарии рядом. Гасить правило файлами или целыми папками без причины
  // нельзя: выключение, о котором никто не помнит, читается как здоровье.
  // Состав таких блоков сверяется с таблицей в базе знаний в обе стороны.>

  // Гасит всё, что пересекается с форматтером. Обязан быть последним.
  prettier,
);
