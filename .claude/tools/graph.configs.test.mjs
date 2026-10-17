import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  BY_LOADER,
  BY_TEXT,
  RUNNER_DEFAULT_INCLUDE,
  globMatcher,
  runnerConfigLoad,
  tsconfigRead,
} from "./graph.configs.mjs";

// Папка внутри пакетов посадки видит её компилятор, сборщик и
// сопоставитель, а git её не видит: тесты в корне посадки, идущие
// параллельно, её конфигов не читают. Папка во временной системы пакетов не
// видит, и ответ идёт запасным путём.
const SEAT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const withPackages = fs.mkdtempSync(
  path.join(SEAT, "node_modules", ".zz-configs-"),
);
const without = fs.mkdtempSync(path.join(os.tmpdir(), "zz-configs-"));
afterAll(() => {
  fs.rmSync(withPackages, { recursive: true, force: true });
  fs.rmSync(without, { recursive: true, force: true });
});
const put = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

describe("конфиг компилятора — компилятором проекта", () => {
  it("`extends` из пакета даёт его опции; без компилятора — разбор текста без них", () => {
    for (const root of [withPackages, without]) {
      put(
        root,
        "node_modules/@zz/strict/package.json",
        '{"name":"@zz/strict"}',
      );
      put(
        root,
        "node_modules/@zz/strict/tsconfig.json",
        '{"compilerOptions":{"strict":true}}',
      );
      put(
        root,
        "tsconfig.json",
        '{\n  // проект\n  "extends": "@zz/strict/tsconfig.json",\n  "compilerOptions": {"noEmit": true}\n}\n',
      );
    }
    const loaded = tsconfigRead(
      path.join(withPackages, "tsconfig.json"),
      withPackages,
    );
    expect(loaded.via).toBe(BY_LOADER);
    expect(loaded.options.strict).toBe(true);
    expect(loaded.options.noEmit).toBe(true);
    const text = tsconfigRead(path.join(without, "tsconfig.json"), without);
    expect(text.via).toBe(BY_TEXT);
    expect(text.options.strict).toBeUndefined();
    expect(text.options.noEmit).toBe(true);
  });

  it("папка вместо файла и ссылки на проекты", () => {
    put(
      withPackages,
      "pkg/a/tsconfig.json",
      '{"compilerOptions":{"strict":true}}',
    );
    put(
      withPackages,
      "pkg/tsconfig.json",
      '{"files":[],"references":[{"path":"./a"}]}',
    );
    const got = tsconfigRead(path.join(withPackages, "pkg"), withPackages);
    expect(got.at).toBe(path.join(withPackages, "pkg", "tsconfig.json"));
    expect(got.references).toEqual([
      path.join(withPackages, "pkg", "a", "tsconfig.json"),
    ]);
    expect(
      tsconfigRead(path.join(withPackages, "nothere"), withPackages),
    ).toBeNull();
  });
});

describe("конфиг раннера — сборщиком проекта", () => {
  const CONFIG = `import { defineConfig, mergeConfig } from "vitest/config";
const shared = { setupFiles: ["./lib/setup.ts"] };
export default defineConfig(() =>
  mergeConfig({}, { test: { ...shared, include: ["./lib/**/*.spec.ts"] } }),
);
`;

  it("функция конфига и слияние вычислены, как их вычислит раннер", async () => {
    put(withPackages, "runner/vite.config.mjs", CONFIG);
    const got = await runnerConfigLoad(
      path.join(withPackages, "runner", "vite.config.mjs"),
      withPackages,
    );
    expect(got.via).toBe(BY_LOADER);
    expect(got.test.include).toEqual(["./lib/**/*.spec.ts"]);
    expect(got.test.setupFiles).toEqual(["./lib/setup.ts"]);
  });

  it("сборщика нет — разбор текста, и секция без пробела узнаётся", async () => {
    put(
      without,
      "vite.config.ts",
      'export default {\n  test:{ include: ["src/**/*.test.ts"], setupFiles: "./src/setup.ts", globals: true },\n};\n',
    );
    const got = await runnerConfigLoad(
      path.join(without, "vite.config.ts"),
      without,
    );
    expect(got.via).toBe(BY_TEXT);
    expect(got.test).toEqual({
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/setup.ts"],
      globals: true,
    });
    expect(
      await runnerConfigLoad(path.join(without, "nothere.ts"), without),
    ).toBeNull();
  });

  it("конфиг, который сборщик не загрузил, назван и прочитан текстом", async () => {
    put(
      withPackages,
      "broken/vite.config.mjs",
      'import "zz-no-such-plugin";\nexport default { test: { include: ["a/**"] } };\n',
    );
    const got = await runnerConfigLoad(
      path.join(withPackages, "broken", "vite.config.mjs"),
      withPackages,
    );
    expect(got.broke).toMatch(/zz-no-such-plugin/);
    expect(got.via).toBe(BY_TEXT);
    expect(got.test.include).toEqual(["a/**"]);
  });
});

describe("образцы путей — сопоставителем раннера", () => {
  it("образец по умолчанию, точка в начале, исключение", () => {
    const m = globMatcher(RUNNER_DEFAULT_INCLUDE, withPackages);
    expect(m.via).toBe(BY_LOADER);
    expect(m("src/a/b.test.tsx")).toBe(true);
    expect(m("src/a/b.spec.mts")).toBe(true);
    expect(m("src/a/b.ts")).toBe(false);
    const dot = globMatcher(["./src/**/*.ts", "!src/skip/**"], withPackages);
    expect(dot("src/x/y.ts")).toBe(true);
    expect(dot("src/skip/y.ts")).toBe(false);
  });

  it("без сопоставителя — запасной разбор звёзд и перечня", () => {
    const m = globMatcher(["./src/**/*.test.{ts,tsx}", "!src/old/**"], without);
    expect(m.via).toBe(BY_TEXT);
    expect(m("src/a/b.test.tsx")).toBe(true);
    expect(m("src/old/b.test.ts")).toBe(false);
    expect(m("lib/b.test.ts")).toBe(false);
  });
});
