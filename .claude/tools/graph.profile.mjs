import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  inPlaceKindOf,
  projectFilesOf,
  stackSurveyOf,
} from "./graph.seat.mjs";

/** Сценарий посадки проекта — один ответ на всю обвязку: осмотр стека,
 * посадка и сверка базы спрашивают его здесь. Решено разработчиком
 * `2026-10-30`:
 *
 * - `empty` — пустая папка: кроме обвязки ничего, витрина хостинга либо
 *   свежий шаблон `create vite`;
 * - `familiar` — знакомый проект: каждая ось стека наша, версии и наличие
 *   любые;
 * - `foreign` — чужой: хоть одна ось чужая, манифеста нет при коде, —
 *   обвязка его не подгоняет и называет, чего не видит.
 *
 * Прежде пустоту решала команда посадки, а «наше и чужое» — осмотр стека,
 * каждый своим признаком, и шаблон `create vite` выходил у одного пустым, у
 * другого «нашим, неполным»; монорепозиторий и свой менеджер хуков осмотр
 * считал нашими. Выведено замером корпуса, этап 0 плана трёх сценариев. */
export const SCENARIOS = ["empty", "familiar", "foreign"];

/** Имя сценария для человека. */
export const SCENARIO_NAMES = {
  empty: "пустая папка",
  familiar: "знакомый проект",
  foreign: "чужой проект",
};

const readJson = (at) => {
  try {
    return JSON.parse(readFileSync(at, "utf8"));
  } catch {
    return null;
  }
};

/** Сценарий папки `root` по карте посадки `map` и семени манифеста `seed`.
 * `commits` — сколько коммитов в истории: свежий шаблон узнаётся только
 * без своей истории. `withTools` — оси-инструменты, которые разработчик
 * велел заменить своими: они чужими не считаются. */
/** Чужая ось, которую ставит сам классификатор, а не карта посадки: у
 * проекта нет манифеста. Сверка чужого окружения узнаёт её по этому имени. */
export const NO_MANIFEST_AXIS = "манифест";

export const scenarioOf = ({ root, map, seed, commits = 0, withTools = [] }) => {
  const read = (rel) => {
    const at = path.join(root, rel);
    return existsSync(at) && statSync(at).isFile() ? readFileSync(at, "utf8") : null;
  };
  const entries = readdirSync(root).filter((e) => e !== ".claude" && e !== ".git");
  const kind = inPlaceKindOf(entries, read, commits);
  if (kind.kind !== "живой")
    return { scenario: "empty", kind, survey: null, foreign: [] };
  const manifest = readJson(path.join(root, "package.json"));
  const survey = stackSurveyOf({
    manifest,
    files: projectFilesOf(root),
    axes: map.stackAxes ?? [],
    verified: { ...seed.dependencies, ...seed.devDependencies },
    withTools,
    ui: map.platformPackages?.ui ?? [],
    alternatives: map.platformPackages?.alternatives ?? {},
  });
  const foreign =
    manifest === null
      ? [{ axis: NO_MANIFEST_AXIS, what: "package.json нет", tool: null }, ...survey.foreign]
      : survey.foreign;
  return {
    scenario: foreign.length > 0 ? "foreign" : "familiar",
    kind,
    survey,
    foreign,
  };
};

/** Сценарий папки по полке, которая её сажает: карта и семя манифеста — с
 * полки, история — из git папки. */
export const scenarioByShelf = ({ root, shelf, commits = 0, withTools = [] }) =>
  scenarioOf({
    root,
    map: readJson(path.join(shelf, "seat", "map.json")) ?? {},
    seed: readJson(path.join(shelf, "seat", "templates", "package.json")) ?? {},
    commits,
    withTools,
  });

/** Строки отчёта чужому проекту: чего обвязка не видит и два пути дальше —
 * переставить (заменить чужие инструменты своими, после чего проект
 * знакомый) либо перейти (новая пустая посадка и перенос кода). Переставить
 * можно, только если каждая чужая ось — инструмент. */
export const foreignOffer = (foreign, shelfCall = "node .claude/tools/graph.mjs") => {
  const tools = foreign.filter((f) => f.tool !== null && f.tool !== undefined);
  const restack = tools.length === foreign.length && foreign.length > 0;
  return [
    "Обвязка не подгоняет чужой проект и не исследует его чужие оси:",
    ...foreign.map((f) => "  " + f.axis + ": " + f.what),
    "Всё, что держится этими осями, не проверяется; проверка записей о проекте называет это каждым прогоном.",
    "Два пути, решает разработчик:",
    restack
      ? "  переставить — заменить чужие инструменты своими: " +
        shelfCall +
        " env . --apply --with=" +
        tools.map((f) => f.axis).join(",") +
        "; после этого проект знакомый, и посадку зовут снова"
      : "  переставить нельзя одной командой: чужое здесь не только инструменты (" +
        foreign
          .filter((f) => f.tool === null || f.tool === undefined)
          .map((f) => f.axis)
          .join(", ") +
        ")",
    "  перейти — новая пустая посадка (`" +
      shelfCall +
      " seat .` в пустой папке) и перенос кода в неё",
  ];
};

/** Проекты корпуса и ящики тестов кладут файлы без истории; живой проект
 * свою историю несёт, и счёт коммитов берётся у git. */
export const commitsIn = (root, git) => {
  if (!existsSync(path.join(root, ".git"))) return 0;
  const said = git(["rev-list", "--count", "HEAD"]);
  return Number(said) || 0;
};
