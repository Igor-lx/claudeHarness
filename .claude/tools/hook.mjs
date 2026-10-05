import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Обёртка хуков среды. Хук зовёт её, она — режим инструмента дочерним
// процессом с тем же вводом и теми же доводами. Среда держит ход и вызов
// только кодом `2`, а упавший инструмент отдаёт `1`, и хук, снятый по сроку,
// не держит ничего: без обёртки отказ инструмента кончал ход без свода и
// пропускал коммит мимо стража, не оставляя следа. Ни от `graph.mjs`, ни от
// настройки проекта обёртка не зависит: сломанные, они и есть её предмет.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "graph.mjs");
const ROOT = path.join(HERE, "..", "..");
/** Сколько ждать режим, в секундах. Среда снимает хук по своему сроку —
 * `600` с по умолчанию, — и снятый хук хода не держит: зависание обязана
 * назвать обёртка раньше среды. */
const LIMIT_S = 120;

const args = process.argv.slice(2);
const isStop = args[0] === "stop" && args.includes("--hook");
const isGuard = args[0] === "guard" && args.includes("--hook");
/** Чем проверить руками: тот же режим без ключа хука. */
const byHand =
  "node .claude/tools/graph.mjs " +
  args.filter((a) => a !== "--hook").join(" ");

let input = "";
if (!process.stdin.isTTY)
  try {
    input = readFileSync(0, "utf8");
  } catch {
    // Ввода нет: режим получит пустой и решит по рабочему дереву сам.
  }
let said = {};
try {
  said = JSON.parse(input) ?? {};
} catch {
  // Ввод не JSON: повтор узнаётся без номера запроса, команда стража пуста.
}

/** Запись клапана конца хода: какой запрос уже получил отказ «инструмент не
 * отработал». Лежит в папке git, как состояние режима `stop`; без git — во
 * временной папке, своей на каждый проект. */
const recordAt = () => {
  try {
    const dir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.join(path.resolve(ROOT, dir), "claude-harness-hook.json");
  } catch {
    const tag = createHash("sha1")
      .update(path.resolve(ROOT))
      .digest("hex")
      .slice(0, 12);
    return path.join(tmpdir(), "claude-harness-hook-" + tag + ".json");
  }
};

/** Что сломалось — одной строкой: строка ошибки из вывода, а не стек. */
const whyFailed = (run) => {
  if (run.error?.code === "ETIMEDOUT") return "не ответил за " + LIMIT_S + " с";
  if (run.error !== undefined) return "процесс: " + run.error.message;
  if (run.status === null) return "снят сигналом " + run.signal;
  const lines = (run.stderr + "\n" + run.stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const line =
    lines.find((l) => /^[A-Za-z]*Error\b/.test(l)) ?? lines[0] ?? "без вывода";
  return "код " + run.status + ": " + line.slice(0, 200);
};

const run = spawnSync(process.execPath, [TOOL, ...args], {
  input,
  encoding: "utf8",
  timeout: LIMIT_S * 1000,
  maxBuffer: 64 * 1024 * 1024,
});

if (run.error === undefined && (run.status === 0 || run.status === 2)) {
  // Инструмент отработал: отказ, записанный клапаном, больше ни о чём.
  if (isStop)
    try {
      rmSync(recordAt(), { force: true });
    } catch {
      // Не снялась — следующий отказ в том же запросе пропустит ход сразу.
    }
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  process.exitCode = run.status;
} else if (isStop) {
  const why = whyFailed(run);
  const turn = String(said.prompt_id ?? said.session_id ?? "");
  const at = recordAt();
  let seen = null;
  try {
    seen = JSON.parse(readFileSync(at, "utf8"));
  } catch {
    // Записи нет либо она испорчена: отказа в этом запросе ещё не было.
  }
  let unwritten = "";
  if (seen?.turn !== turn)
    try {
      writeFileSync(
        at,
        JSON.stringify({ turn, at: new Date().toISOString(), why }) + "\n",
      );
    } catch (e) {
      unwritten = e.message;
    }
  if (seen?.turn !== turn && unwritten === "") {
    process.stderr.write(
      "Обвязка: ворота конца хода не проверены — инструмент не отработал: " +
        why +
        ".\n" +
        "Ход не кончается: правка кода могла остаться без свода. Причина — в выводе `" +
        byHand +
        "` из корня проекта: починить; не чинится — сказать разработчику, что ворота конца хода не работают.\n",
    );
    process.exitCode = 2;
  } else {
    // Второй отказ в том же запросе — ход кончается, иначе петля без конца.
    // Без записи клапана держать ход нельзя по той же причине.
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          "Обвязка: ворота конца хода не отработали" +
          (unwritten === "" ? " второй раз за запрос" : "") +
          " (" +
          why +
          (unwritten === "" ? "" : "; запись клапана не легла: " + unwritten) +
          ") — ход кончается без проверки свода. Причина — в выводе `" +
          byHand +
          "`.",
      }) + "\n",
    );
  }
} else if (isGuard) {
  // Мимо стража идут только команды git: коммит мимо ворот проверить нечем,
  // и его решает человек. Прочие команды стражу не предмет.
  const command = String(said.tool_input?.command ?? "");
  if (/\bgit\b/.test(command))
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason:
            "Обвязка: страж обхода ворот не отработал (" +
            whyFailed(run) +
            ") — коммит мимо ворот проверить нечем, поэтому команда git ждёт подтверждения.",
        },
      }) + "\n",
    );
} else {
  // Начало сессии и напоминание держать нечего — их отказ называется
  // человеку и агенту: строку человеку часть событий отбрасывает.
  const text =
    "Обвязка: хук `" +
    args.join(" ") +
    "` не отработал — " +
    whyFailed(run) +
    ". Причина — в выводе `" +
    byHand +
    "`.";
  const out = { systemMessage: text };
  if (typeof said.hook_event_name === "string")
    out.hookSpecificOutput = {
      hookEventName: said.hook_event_name,
      additionalContext: text,
    };
  process.stdout.write(JSON.stringify(out) + "\n");
}
