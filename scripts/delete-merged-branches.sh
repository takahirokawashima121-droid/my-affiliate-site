#!/usr/bin/env bash
# main に取り込み済みのブランチを一覧にし、MODE=delete のときは消す（.github/workflows/delete-merged-branches.yml から実行）
#
# 消さないもの:
#   - main（BASE）
#   - 開いている PR のブランチ（OPEN_PR_BRANCHES に1行1本で渡す）
#   - main の最新のコミットと同じところを指しているブランチ（作ったばかりで、まだ何もコミットしていない可能性がある）
#   - main に入っていないコミットがあるブランチ（取り込み済みではない）
#
# 環境変数:
#   MODE              list（一覧を出すだけ。既定）/ delete（実際に消す）
#   BASE              取り込み先のブランチ（既定 main）
#   REMOTE            リモート名（既定 origin）
#   OPEN_PR_BRANCHES  開いている PR のブランチ名（改行区切り）
#   GITHUB_STEP_SUMMARY があれば、結果の表をそこにも書く
set -euo pipefail

MODE="${MODE:-list}"
BASE="${BASE:-main}"
REMOTE="${REMOTE:-origin}"
OPEN_PR_BRANCHES="${OPEN_PR_BRANCHES:-}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ "$MODE" != list ] && [ "$MODE" != delete ]; then
  echo "MODE は list か delete にしてください（今: $MODE）" >&2
  exit 1
fi

git fetch "$REMOTE" --prune --quiet
base_sha=$(git rev-parse "refs/remotes/$REMOTE/$BASE")

is_open_pr() {
  printf '%s\n' "$OPEN_PR_BRANCHES" | grep -Fxq -- "$1"
}

merged=()
rows=()
while IFS=$'\t' read -r ref date; do
  branch="${ref#refs/remotes/$REMOTE/}"
  [ "$branch" = HEAD ] && continue
  sha=$(git rev-parse "$ref")
  if [ "$branch" = "$BASE" ]; then
    reason="残す（$BASE）"
  elif is_open_pr "$branch"; then
    reason="残す（開いている PR のブランチ）"
  elif [ "$sha" = "$base_sha" ]; then
    reason="残す（$BASE の最新と同じ。作ったばかりの可能性）"
  elif git merge-base --is-ancestor "$sha" "$base_sha"; then
    reason="取り込み済み"
    merged+=("$branch")
  else
    ahead=$(git rev-list --count "$base_sha..$sha")
    reason="残す（$BASE に入っていないコミットが${ahead}個）"
  fi
  rows+=("| \`$branch\` | $date | $reason |")
done < <(git for-each-ref --format=$'%(refname)\t%(committerdate:short)' "refs/remotes/$REMOTE/")

{
  if [ "$MODE" = delete ]; then echo "## 取り込み済みのブランチを消す"; else echo "## 取り込み済みのブランチの一覧（消していません）"; fi
  echo
  echo "取り込み済み: ${#merged[@]}本"
  echo
  echo "| ブランチ | 最後のコミット | 判定 |"
  echo "|---|---|---|"
  printf '%s\n' "${rows[@]}"
  echo
} | tee -a "$SUMMARY"

if [ "$MODE" = list ] || [ "${#merged[@]}" -eq 0 ]; then
  exit 0
fi

failed=0
for branch in "${merged[@]}"; do
  if git push "$REMOTE" --delete "$branch" --quiet; then
    echo "- 消した: \`$branch\`" | tee -a "$SUMMARY"
  else
    echo "- 消せなかった: \`$branch\`" | tee -a "$SUMMARY"
    failed=1
  fi
done
exit "$failed"
