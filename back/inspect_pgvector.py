
import inspect
import sys
from agno.vectordb.pgvector import PgVector

try:
    print("PgVector location:", inspect.getfile(PgVector))
    print("PgVector.upsert signature:", inspect.signature(PgVector.upsert))
    print("PgVector.upsert doc:", PgVector.upsert.__doc__)
except Exception as e:
    print("Error inspecting PgVector:", e)
