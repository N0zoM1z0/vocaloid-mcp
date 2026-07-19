#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[a-z0-9][a-z0-9._-]{0,95}$ ]]; then
  echo "Usage: scripts/run-intent-first-agent-benchmark.sh <stable-lowercase-run-id>" >&2
  exit 2
fi

run_id=$1
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
run_relative="build/benchmarks/${run_id}"
run_directory="${repo_root}/${run_relative}"
prompt_path="${run_directory}/prompt.txt"
client_jsonl="${run_directory}/codex.jsonl"
client_stderr="${run_directory}/codex.stderr.log"
raw_trace="${run_directory}/raw.trace.json"
final_trace="${run_directory}/final.trace.json"
manifest_path="${run_directory}/${run_id}.song.json"
result_path="${run_directory}/result.json"

if [[ -e $run_directory ]]; then
  echo "Run directory already exists; choose a new run ID: ${run_directory}" >&2
  exit 2
fi
mkdir -p "$run_directory"

cd "$repo_root"
npm run build --silent
node scripts/render-intent-first-prompt.mjs "--run-id=${run_id}" > "$prompt_path"

set +e
codex exec \
  --ignore-user-config \
  --ignore-rules \
  --ephemeral \
  --skip-git-repo-check \
  --sandbox read-only \
  --json \
  -C "$run_directory" \
  -c 'mcp_servers.vocaloid.command="node"' \
  -c "mcp_servers.vocaloid.args=[\"${repo_root}/scripts/intent-first-mcp-proxy.mjs\"]" \
  -c "mcp_servers.vocaloid.env={INTENT_FIRST_TRACE_PATH=\"${run_relative}/raw.trace.json\",INTENT_FIRST_BENCHMARK_ID=\"withheld-answer-anchor-v1\",INTENT_FIRST_SESSION_ID=\"${run_id}\"}" \
  - < "$prompt_path" > "$client_jsonl" 2> "$client_stderr"
codex_status=$?
set -e

if [[ ! -f $raw_trace ]]; then
  echo "The MCP proxy did not finalize ${raw_trace}; inspect ${client_stderr}." >&2
  exit 1
fi

set +e
node scripts/finalize-intent-first-trace.mjs \
  "--trace=${raw_trace}" \
  "--client-transcript=${client_jsonl}" \
  "--output=${final_trace}"
audit_status=$?
set -e

if [[ -f $manifest_path && -f $final_trace ]]; then
  set +e
  node scripts/evaluate-intent-first-benchmark.mjs \
    "--manifest=${manifest_path}" \
    "--trace=${final_trace}" \
    "--output=${result_path}"
  evaluation_status=$?
  set -e
else
  evaluation_status=1
  echo "No benchmark manifest/final trace is available for evaluation." >&2
fi

if [[ $codex_status -ne 0 || $audit_status -ne 0 || $evaluation_status -ne 0 ]]; then
  exit 1
fi
