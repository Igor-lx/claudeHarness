#!/usr/bin/env bash
# Среда для посадки: Node.js и npm проверенной связки, git.
# Ставит без вопроса — решение разработчика `2026-10-23`, `seat/seat.md`, шаг 0.
# Ключ --plan печатает, что сделал бы, и ничего не ставит.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
seed="$here/templates/graph.config.mjs"
plan=0
[ "${1:-}" = "--plan" ] && plan=1

verified() {
  sed -n '/verifiedVersions: {/,/}/p' "$seed" |
    sed -n "s/^[[:space:]]*\"\{0,1\}$1\"\{0,1\}:[[:space:]]*\"\([^\"]*\)\".*/\1/p" |
    head -n 1
}

# Истина, когда версия $1 ниже $2; приставка `v` и хвост `-pre` не в счёт.
ver_lt() {
  local IFS=. i x y
  local -a a b
  read -r -a a <<<"${1#v}"
  read -r -a b <<<"${2#v}"
  for i in 0 1 2; do
    x="${a[i]:-0}"
    y="${b[i]:-0}"
    x="${x%%[!0-9]*}"
    y="${y%%[!0-9]*}"
    ((10#${x:-0} < 10#${y:-0})) && return 0
    ((10#${x:-0} > 10#${y:-0})) && return 1
  done
  return 1
}

version_of() {
  command -v "$1" >/dev/null 2>&1 || return 1
  "$1" --version 2>/dev/null | head -n 1 | sed 's/^[^0-9]*//'
}

say() { printf '  %s\n' "$*"; }
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
orig_path="$PATH"
# Обновление npm с выводом в журнал: на сбое печатается его конец, а не одно «не встал».
npm_up() {
  npm install -g "npm@$npm_need" >"$log" 2>&1
}
fail() {
  printf '\n%s\n' "$*"
  exit 1
}

node_need="$(verified node)"
npm_need="$(verified npm)"
[ -n "$node_need" ] && [ -n "$npm_need" ] ||
  fail "Проверенная связка не прочитана из $seed: ставить нечего сверять."

case "$(uname -s)" in
Linux) os=linux ;;
Darwin) os=darwin ;;
MINGW* | MSYS* | CYGWIN*) os=win ;;
*) os=unknown ;;
esac
case "$(uname -m)" in
x86_64 | amd64) arch=x64 ;;
arm64 | aarch64) arch=arm64 ;;
*) arch=unknown ;;
esac

root="${CLAUDE_HARNESS_HOME:-$HOME/.claude-harness}"
name="node-v$node_need-$os-$arch"
dest="$root/$name"
if [ "$os" = win ]; then bin="$dest"; else bin="$dest/bin"; fi
dist="${CLAUDE_HARNESS_NODE_DIST:-https://nodejs.org/dist}/v$node_need"

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2"
  else
    return 1
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

install_node() {
  [ "$os" != unknown ] && [ "$arch" != unknown ] ||
    fail "Система $(uname -s) $(uname -m) не опознана: Node.js $node_need ставят с nodejs.org руками."
  if [ -x "$bin/node" ] || [ -x "$bin/node.exe" ]; then return 0; fi
  local file tmp want got
  if [ "$os" = win ]; then file="$name.zip"; else file="$name.tar.gz"; fi
  tmp="$(mktemp -d)"
  fetch "$dist/$file" "$tmp/$file" && fetch "$dist/SHASUMS256.txt" "$tmp/SHASUMS256.txt" ||
    fail "Архив $dist/$file не скачан: нужна сеть до nodejs.org."
  want="$(grep "  $file\$" "$tmp/SHASUMS256.txt" | cut -d ' ' -f 1)"
  got="$(sha256_of "$tmp/$file")"
  [ -n "$want" ] && [ "$want" = "$got" ] ||
    fail "Контрольная сумма $file не сошлась с SHASUMS256.txt: архив не ставится."
  mkdir -p "$root"
  if [ "$os" = win ]; then
    powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '$(cygpath -w "$tmp/$file")' -DestinationPath '$(cygpath -w "$root")' -Force" ||
      fail "Архив $file не распакован."
  else
    tar -xzf "$tmp/$file" -C "$root" || fail "Архив $file не распакован."
  fi
  rm -rf "$tmp"
}

# Новые окна терминала и перезапущенный Claude Code видят Node.js сами.
persist_path() {
  local mark="# claude-harness: Node.js"
  if [ "$os" = win ]; then
    local w
    w="$(cygpath -w "$bin")"
    powershell.exe -NoProfile -Command "\$b='$w'; \$p=[Environment]::GetEnvironmentVariable('Path','User'); \$k=@(\$p -split ';' | Where-Object { \$_ -and \$_ -notlike '*\\.claude-harness\\node-*' }); [Environment]::SetEnvironmentVariable('Path', ((@(\$b) + \$k) -join ';'), 'User')" ||
      fail "Путь к Node.js не записан в PATH пользователя."
    return 0
  fi
  local rc files=("$HOME/.profile")
  [ -f "$HOME/.bashrc" ] && files+=("$HOME/.bashrc")
  [ -f "$HOME/.zshrc" ] && files+=("$HOME/.zshrc")
  [ "$os" = darwin ] && files+=("$HOME/.zprofile")
  for rc in "${files[@]}"; do
    touch "$rc"
    { grep -v "$mark" "$rc" || true; } >"$rc.claude-harness"
    mv "$rc.claude-harness" "$rc"
    printf 'export PATH="%s:$PATH"  %s %s\n' "$bin" "$mark" "$node_need" >>"$rc"
  done
  # Папка запускаемых файлов пользователя уже в PATH — Claude Code и его хуки видят Node.js без перезапуска.
  local own="$HOME/.local/bin" one
  case ":$PATH:" in *":$own:"*) ;; *) return 0 ;; esac
  for one in node npm npx; do
    if [ -e "$own/$one" ] && ! readlink "$own/$one" | grep -q "\.claude-harness/node-"; then continue; fi
    ln -sf "$bin/$one" "$own/$one"
  done
}

git_command() {
  case "$os" in
  win) echo "winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements" ;;
  darwin)
    if command -v brew >/dev/null 2>&1; then echo "brew install git"; else echo "xcode-select --install"; fi
    ;;
  linux)
    local sudo="" pm
    [ "$(id -u)" = 0 ] || sudo="sudo "
    for pm in apt-get dnf yum pacman zypper apk; do
      command -v "$pm" >/dev/null 2>&1 || continue
      case "$pm" in
      apt-get) echo "${sudo}apt-get update && ${sudo}apt-get install -y git" ;;
      pacman) echo "${sudo}pacman -S --noconfirm git" ;;
      apk) echo "${sudo}apk add git" ;;
      *) echo "${sudo}$pm install -y git" ;;
      esac
      return 0
    done
    echo ""
    ;;
  *) echo "" ;;
  esac
}

echo "=== Среда для посадки ==="
done_lines=()
todo=0

node_have="$(version_of node || true)"
use_own=0
if [ -z "$node_have" ] || ver_lt "$node_have" "$node_need"; then
  use_own=1
fi
if [ "$use_own" = 0 ]; then
  npm_have="$(version_of npm || true)"
else
  npm_have=""
fi

if [ "$plan" = 1 ]; then
  if [ "$use_own" = 1 ]; then
    say "node: ${node_have:-нет} — поставить $node_need из $dist/$name в $dest"
    say "npm: поднять до $npm_need в той же папке"
    todo=1
  elif [ -z "$npm_have" ] || ver_lt "$npm_have" "$npm_need"; then
    say "node: $node_have — годится"
    say "npm: ${npm_have:-нет} — поднять до $npm_need"
    todo=1
  else
    say "node: $node_have — годится"
    say "npm: $npm_have — годится"
  fi
  if command -v git >/dev/null 2>&1; then
    say "git: $(version_of git) — годится"
  else
    how="$(git_command)"
    say "git: нет — поставить: ${how:-руками, установщик этой системы не опознан}"
    todo=1
  fi
  [ "$todo" = 0 ] && say "ставить нечего"
  exit 0
fi

if [ "$use_own" = 1 ]; then
  install_node
  persist_path
  export PATH="$bin:$PATH"
  done_lines+=("node: ${node_have:-не было} → $node_need, папка $dest")
fi
npm_have="$(version_of npm || true)"
if [ -z "$npm_have" ] || ver_lt "$npm_have" "$npm_need"; then
  if ! npm_up; then
    # Системный npm без прав на запись: свой Node.js со своим npm.
    [ "$use_own" = 1 ] && fail "npm $npm_need не встал в $dest: $(tail -n 5 "$log")"
    install_node
    persist_path
    export PATH="$bin:$PATH"
    use_own=1
    done_lines+=("node: $node_have → $node_need, папка $dest: системный npm не поднимается без прав администратора")
    npm_up || fail "npm $npm_need не встал в $dest: $(tail -n 5 "$log")"
  fi
  done_lines+=("npm: ${npm_have:-не было} → $(version_of npm)")
fi

if ! command -v git >/dev/null 2>&1; then
  how="$(git_command)"
  [ -n "$how" ] || fail "git нет, и установщик этой системы не опознан: git ставят руками."
  if [ "$os" = linux ] && [ "$(id -u)" != 0 ]; then
    run="${how//sudo /sudo -n }"
  else
    run="$how"
  fi
  if ! bash -c "$run" >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
    fail "git не поставился без вмешательства человека. Выполнить в терминале: $how — и позвать посадку снова."
  fi
  done_lines+=("git: не было → $(version_of git)")
fi

if [ "${#done_lines[@]}" = 0 ]; then
  say "ставить нечего: node $(version_of node), npm $(version_of npm), git $(version_of git)"
  exit 0
fi
for one in "${done_lines[@]}"; do say "$one"; done
# Виден ли свой Node.js сразу — по факту: какой node находит PATH, с которым загрузчик позвали.
if [ "$use_own" = 1 ] && [ "$(PATH="$orig_path" version_of node || true)" = "$node_need" ]; then
  say "Node.js $node_need виден сразу, этой сессии и её хукам"
  say "откат: удалить папку $dest, ссылки node, npm, npx на неё в $HOME/.local/bin и строки «claude-harness» в файлах настройки оболочки"
elif [ "$use_own" = 1 ]; then
  say "в этой сессии команды зовут с PATH=\"$bin:\$PATH\"; новые окна терминала и перезапущенный Claude Code видят Node.js сами"
  say "откат: удалить папку $dest, ссылки на неё в $HOME/.local/bin, если легли, и строки «claude-harness» в файлах настройки оболочки либо в PATH пользователя"
fi
exit 0
