import sys
from pathlib import Path


# Ensure `import src.*` works in tests without requiring PYTHONPATH.
BACK_DIR = Path(__file__).resolve().parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

