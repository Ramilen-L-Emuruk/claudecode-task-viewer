#!/bin/bash
# Claude Code ステータスライン スクリプト

input=$(cat)

# --- 入力値の取得（python3 で JSON パース）---
model=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('model',{}).get('display_name','Claude'))" 2>/dev/null)
effort=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('effort',{}).get('level',''))" 2>/dev/null)
used_pct=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('context_window',{}).get('used_percentage'); print(v if v is not None else '')" 2>/dev/null)
used_tokens=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('context_window',{}).get('total_input_tokens'); print(v if v is not None else '')" 2>/dev/null)
ctx_size=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('context_window',{}).get('context_window_size'); print(v if v is not None else '')" 2>/dev/null)
cwd=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('workspace',{}).get('current_dir') or d.get('cwd',''))" 2>/dev/null)

# --- Git 情報 ---
git_branch=""
git_dirty=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git_branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
    if [ -n "$git_branch" ]; then
        git_out=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)
        [ -n "$git_out" ] && git_dirty="*"
    fi
fi

# --- ANSI カラー ---
CY=$'\033[36m'
YL=$'\033[33m'
GR=$'\033[32m'
RD=$'\033[31m'
MG=$'\033[35m'
DM=$'\033[2m'
RS=$'\033[0m'

# --- トークン数を k 単位でフォーマット（例: 90123 -> 90k）---
fmt_k() {
    local n="$1"
    if [ -z "$n" ] || [ "$n" = "null" ]; then echo ""; return; fi
    if [ "$n" -ge 1000 ] 2>/dev/null; then
        printf '%dk' "$(( n / 1000 ))"
    else
        echo "$n"
    fi
}

# --- 組み立て ---

# Part 1: モデル名 [工数]
if [ -n "$effort" ]; then
    out="${CY}${model}${RS} ${YL}[${effort}]${RS}"
else
    out="${CY}${model}${RS}"
fi

# Part 2: コンテキスト使用率（使用量/上限）
if [ -n "$used_pct" ]; then
    used_int=$(printf '%.0f' "$used_pct")
    if [ "$used_int" -ge 80 ]; then cc="$RD"
    elif [ "$used_int" -ge 50 ]; then cc="$YL"
    else cc="$GR"; fi

    u=$(fmt_k "$used_tokens")
    s=$(fmt_k "$ctx_size")
    if [ -n "$u" ] && [ -n "$s" ]; then
        ctx_str="${cc}${used_int}%${RS} ${DM}(${u}/${s})${RS}"
    else
        ctx_str="${cc}${used_int}%${RS}"
    fi
    out="${out}  ${DM}|${RS}  ctx: ${ctx_str}"
fi

# Part 3: Git ブランチ（変更あれば * を付加）
if [ -n "$git_branch" ]; then
    out="${out}  ${DM}|${RS}  ${MG}${git_branch}${git_dirty}${RS}"
fi

printf '%b\n' "$out"
