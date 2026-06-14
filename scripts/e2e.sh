#!/usr/bin/env bash
# Run the end-to-end regression suite against a stub-brain stack.
#
#   scripts/e2e.sh              # build + up the stack, run tests, tear down
#   E2E_NO_COMPOSE=1 scripts/e2e.sh   # run against an already-running stack
#
# The conftest owns compose bring-up/tear-down; this script just ensures the
# Python deps are present and invokes pytest from the repo root.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PYTHON="${PYTHON:-python3}"

echo "[e2e] installing harness deps"
"$PYTHON" -m pip install -q -r e2e/requirements.txt

echo "[e2e] running pytest e2e/"
"$PYTHON" -m pytest e2e/ -v "$@"
