#!/usr/bin/env bash
# Usage: test/integration/run.sh <scratch-dir>   — runs the suite in an isolated VS Code profile.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="${1:?scratch dir}"
rm -rf "$TMP/ud" "$TMP/ext"; mkdir -p "$TMP/ud" "$TMP/ext"
code --user-data-dir "$TMP/ud" --extensions-dir "$TMP/ext" --disable-extensions --new-window \
  --extensionDevelopmentPath="$ROOT" --extensionTestsPath="$ROOT/test/integration/suite.js" --wait || true
# `code --wait` always exits 0, so read the verdict from the logs.
if grep -rqs "\[it\] ALL PASSED" "$TMP/ud/logs"; then echo "INTEGRATION: ALL PASSED"; grep -rh "\[it\]" "$TMP/ud/logs" | sed 's/.*\[it\]/[it]/'; exit 0; fi
echo "INTEGRATION: FAILED"; grep -rh "\[it\]\|AssertionError\|Error:" "$TMP/ud/logs" | head -30; exit 1
