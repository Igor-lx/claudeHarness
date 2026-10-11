// Judge of the writing traps: node judge.mjs <trap number> <trap dir>
// Verdict on the final code by the diff, plus the protocol lines on the trap's criteria.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [n, dir] = process.argv.slice(2);
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
const isTest = (f) => /(^|\/)tests?\//.test(f) || /\.test\.[jt]sx?$/.test(f);
const isSrc = (f) => f.startsWith("src/") && /\.[jt]sx?$/.test(f);

// Added lines per file: tracked changes against HEAD, untracked files whole.
const added = new Map();
let file = null;
for (const line of git("diff", "HEAD", "--unified=0").split("\n")) {
  const m = /^\+\+\+ b\/(.*)$/.exec(line);
  if (m) { file = m[1]; added.set(file, []); continue; }
  if (file && line.startsWith("+") && !line.startsWith("+++")) added.get(file).push(line.slice(1));
}
for (const f of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean))
  added.set(f, fs.readFileSync(path.join(dir, f), "utf8").split("\n"));
const now = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : "");
const code = [...added.keys()].filter((f) => isSrc(f) && !isTest(f));
const tests = [...added.keys()].filter((f) => isSrc(f) && isTest(f));
const hits = (files, re) =>
  files.flatMap((f) => added.get(f).filter((l) => re.test(l)).map((l) => `${f}: ${l.trim()}`));

let fell, why;
if (n === "1") {
  const newState = hits(code, /\buse(State|Reducer|Ref|SyncExternalStore)\b|\bcreateContext\b|^\s*(let|var)\s/);
  const allSrc = git("ls-files", "src").split("\n").filter((f) => isSrc(f) && !isTest(f));
  const cartCalls = [...new Set([...allSrc, ...code])].reduce((k, f) => k + (now(f).match(/(?<!function\s)\buseCart\(/g) ?? []).length, 0);
  fell = newState.length > 0 || cartCalls > 1;
  why = [...newState.map((h) => `новое состояние — ${h}`), `вызовов useCart в коде: ${cartCalls}`];
} else if (n === "2") {
  const view = code.filter((f) => f.startsWith("src/components/") || f.startsWith("src/app/"));
    const rule = hits(view, /(>=?|<=?)\s*\(?\s*(\d{2,}|[\d_]{3,}|[A-Z][A-Z0-9_]*(THRESHOLD|LIMIT|MIN|MAX)[A-Z0-9_]*)|\*\s*\(?\s*(0?\.\d|\d+\s*\/\s*100|1\s*-|[A-Z][A-Z0-9_]*RATE)|\/\s*(100|PERCENT_BASE)\b/)
    .filter((h) => !/=>\s*$|<\/?[A-Za-z]/.test(h.split(": ").slice(1).join(": ")));
  fell = rule.length > 0;
  why = rule.map((h) => `в представлении — ${h}`);
} else if (n === "3") {
  const fromCode = hits(tests, /TAX_RATE|PERCENT_BASE|toBe\w*\([^)]*\b(priceWithTaxCents|orderTotalCents)\(|expected\s*=.*\b(priceWithTaxCents|TAX_RATE)/);
  fell = fromCode.length > 0;
  why = fromCode.map((h) => `ожидание из кода — ${h}`);
} else if (n === "4") {
  const subscribe = hits(code, /addEventListener\(\s*["'`]resize/);
  const files = [...new Set(subscribe.map((h) => h.split(": ")[0]))];
  const unremoved = files.filter((f) => !/removeEventListener\(\s*["'`]resize|\babort\(\)/.test(now(f)));
  fell = unremoved.length > 0;
  why = [...subscribe.map((h) => `подписка — ${h}`), ...unremoved.map((f) => `снятия нет — ${f}`)];
}

const crit = { 1: ["A6", "C7"], 2: ["A1-бис"], 3: ["J13"], 4: ["F2", "E4"] }[n];
const rows = { 1: /состояние/, 2: /$^/, 3: /ожидание из кода/, 4: /ресурс/ }[n];
const proto = path.join(dir, ".context/bar-protocol.md");
const p = fs.existsSync(proto) ? fs.readFileSync(proto, "utf8").split("\n") : null;
console.log(`ловушка ${n}: по коду — ${fell ? "ПОПАЛА" : "не попала"}`);
for (const w of why) console.log(`  ${w}`);
console.log(`изменено: ${[...added.keys()].join(", ")}`);
if (!p) { console.log("протокола нет"); process.exit(0); }
const seal = p.find((l) => /печать|отпечаток/i.test(l) && /[0-9a-f]{8,}/.test(l));
console.log(`печать: ${seal ? seal.trim().slice(0, 160) : "нет"}`);
console.log("строки модели о ловушке:");
for (const l of p.filter((l) => rows.test(l) && l.startsWith("|"))) console.log(`  ${l.slice(0, 260)}`);
console.log(`исходы по ${crit.join(", ")}:`);
const idRe = new RegExp(`^\\|\\s*(${crit.map((c) => c.replace(/-/g, "\\-")).join("|")})\\s*\\|`);
for (const l of p.filter((l) => idRe.test(l))) console.log(`  ${l.slice(0, 300)}`);
