#!/usr/bin/env python3
"""Helper to run the full pytest suite and write a compact summary.

The full -v output is too large for the sandbox tool to return inline, so we
run pytest as a subprocess, save everything to a log file, and print only a
short tail + the summary line.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG = ROOT / "full_test.log"

cmd = [sys.executable, "-m", "pytest", "tests/", "-v", "--no-header", "-p", "no:cacheprovider"]

proc = subprocess.run(
    cmd,
    cwd=str(ROOT),
    capture_output=True,
    text=True,
    timeout=600,
)

out = proc.stdout
err = proc.stderr
LOG.write_text(out + "\n----- STDERR -----\n" + err)

lines = (out + err).splitlines()
tail = "\n".join(lines[-40:])

print("=== PYTEST EXIT CODE:", proc.returncode)
print("=== TAIL (last 40 lines) ===")
print(tail)