#!/usr/bin/env bash
# Posts the eval scoreboard on the pull request, or updates the comment from an earlier run.
# Needs GH_TOKEN (pull-requests: write), PR_NUMBER, REPORT and GITHUB_REPOSITORY.
set -euo pipefail

marker="<!-- ragforge-eval -->"
body="$(mktemp)"
{
  echo "$marker"
  cat "$REPORT"
} > "$body"

ids="$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"$marker\")) | .id")"
existing="${ids%%$'\n'*}"

if [ -n "$existing" ]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" -F "body=@$body" --silent
  echo "Updated comment $existing"
else
  gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" -F "body=@$body" --silent
  echo "Posted a new comment"
fi
