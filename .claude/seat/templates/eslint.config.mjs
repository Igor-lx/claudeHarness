// Почему настройки линта такие — `.claude/seat/eslint.config-why.md`.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintReact from "@eslint-react/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import sonarjs from "eslint-plugin-sonarjs";
import prettier from "eslint-config-prettier/flat";

// Пороги меняют решением с записью, а не выключением правила.
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
    ignores: [
      // Обвязка — не код проекта: в её заготовках линт находит второй корень.
      ".claude",
      // Образцы с `**/`: голое имя ловит лишь папку верхнего уровня.
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/public/**",
      "**/.stryker-tmp/**",
      "**/.проба-сверок/**",
      "**/reports/**",
    ],
  },

  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    // Конфиги корня вне проекта компилятора: их разбирает блок оснастки ниже.
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

  // Эти правила держит другой держатель: одно нарушение не печатается дважды.
  {
    rules: {
      // Маркеры держит сверка «Найденное — исправлено, а не отложено».
      "sonarjs/todo-tag": "off",
      "sonarjs/fixme-tag": "off",
      // Правила компилятора React держит официальная `react-hooks`.
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
      // Копии sonar: то же держат ядро, `typescript-eslint`, `react-hooks`
      // либо `@eslint-react`.
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

  // Без типов: файл вне проекта компилятора; набор `typescript-eslint`
  // подключает разборщик `.ts`.
  {
    files: [
      "*.config.{js,mjs,cjs}",
      "*.config.{ts,mts,cts}",
      "eslint.config.mjs",
      "scripts/**/*.{js,mjs,ts}",
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },

  // `act` отдаёт thenable лишь в async: помощники теста — `async` без `await`.
  {
    files: ["**/tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: { "@typescript-eslint/require-await": "off" },
  },

  // Оба правила — о коде компонентов; фикстуры и ref тест меняет по праву.
  {
    files: ["**/tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: {
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
    },
  },

  // Ожидаемое в тесте — литералом (`J13`): имя константы тянуло бы его из кода.
  {
    files: ["**/tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },

  // Своё послабление — блоком с причиной рядом и парой в поле `lintConfigOff`.

  // Гасит всё, что пересекается с форматтером. Обязан быть последним.
  prettier,
);
