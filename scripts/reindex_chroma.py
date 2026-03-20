from __future__ import annotations

import sys

from core.database import list_events_batch
from core.vector_store import is_available, reset_collection, upsert_events


def main() -> int:
    if not is_available():
        print("ChromaDB is not available. Install dependencies and try again.")
        return 1
    reset_collection()
    batch_size = 1000
    offset = 0
    total = 0
    while True:
        batch = list_events_batch(offset=offset, limit=batch_size)
        if not batch:
            break
        upsert_events(batch)
        total += len(batch)
        offset += len(batch)
        print(f"Indexed {total} events...")
    print(f"Done. Indexed {total} events.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

