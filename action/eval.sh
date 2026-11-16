#!/usr/bin/env bash
# Runs `ragforge eval` for the GitHub Action (action.yml). Inputs arrive as INPUT_* variables.
# Writes the scoreboard to the job summary, sets the step outputs, and exits with the eval's exit code.
set -uo pipefail

out_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
markdown="$out_dir/ragforge-eval.md"
json="$out_dir/ragforge-eval.json"
rm -f "$markdown" "$json"

args=(eval)
while IFS= read -r doc; do
  doc="${doc%$'\r'}"
  if [ -n "${doc// /}" ]; then args+=(--docs "$doc"); fi
done <<< "${INPUT_DOCS:-}"

add() { if [ -n "$2" ]; then args+=("$1" "$2"); fi; }
add --questions-file "${INPUT_QUESTIONS_FILE:-}"
add --compare "${INPUT_COMPARE:-}"
add --fail-on-drop "${INPUT_FAIL_ON_DROP:-}"
add --provider "${INPUT_PROVIDER:-}"
add --embeddings "${INPUT_EMBEDDINGS:-}"
add --techniques "${INPUT_TECHNIQUES:-}"
if [ -n "${INPUT_ARGS:-}" ]; then
  read -r -a extra <<< "$INPUT_ARGS"
  if [ "${#extra[@]}" -gt 0 ]; then args+=("${extra[@]}"); fi
fi
args+=(--markdown "$markdown" --json "$json")

packages=(-p "ragforge@${INPUT_VERSION:-latest}")
if [ -n "${INPUT_PACKAGES:-}" ]; then
  read -r -a more <<< "$INPUT_PACKAGES"
  if [ "${#more[@]}" -gt 0 ]; then
    for package in "${more[@]}"; do packages+=(-p "$package"); done
  fi
fi

echo "ragforge ${args[*]}"
npx --yes "${packages[@]}" ragforge "${args[@]}"
code=$?

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    if [ "$code" -eq 0 ]; then echo "passed=true"; else echo "passed=false"; fi
    if [ -f "$markdown" ]; then echo "markdown=$markdown"; fi
    if [ -f "$json" ]; then echo "json=$json"; fi
  } >> "$GITHUB_OUTPUT"
fi
if [ -f "$markdown" ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat "$markdown" >> "$GITHUB_STEP_SUMMARY"
fi

exit "$code"
