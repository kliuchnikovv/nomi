"""Run the full back/ test suite and write a compact result file.

We invoke pytest as a subprocess (so its own collection/import state is clean)
and capture all output to a file, then write a short summary line at the end.
This avoids dumping the entire verbose log to stdout.
"""
from __future__ import annotations

import subprocess
import sys

LOG = "full_test.log"
SUMMARY = "test_summary.txt"

cmd = [sys.executable, "-m", "pytest", "tests/", "-v", "-p", "no:randomly"]
proc = subprocess.run(
    cmd,
    cwd="/workspace/genie-api/back",
    capture_output=True,
    text=True,
    timeout=600,
)

with open(LOG, "w", encoding="utf-8") as fh:
    fh.write(proc.stdout)
    fh.write("\n--- STDERR ---\n")
    fh.write(proc.stderr)

# Extract the tail (last 60 lines) for a compact view.
lines = proc.stdout.splitlines()
tail = "\n".join(lines[-60:])

summary = (
    f"EXIT_CODE={proc.returncode}\n"
    f"STDOUT_LINES={len(lines)}\n"
    f"STDERR_LINES={len(proc.stderr.splitlines())}\n"
    "\n--- TAIL 60 LINES ---\n"
    f"{tail}\n"
)
with open(SUMMARY, "w", encoding="utf-8") as fh:
    fh.write(summary)

print(f"WROTE {LOG} and {SUMMARY}; pytest exit={proc.returncode}")