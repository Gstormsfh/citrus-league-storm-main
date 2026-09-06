"""Read-only reconciliation. Never choose a duplicate or copy model probabilities.

CLI input JSON: {"nhl": [...], "raw": [...]}. Each source should be a frozen,
season/population-scoped export. Output includes content hashes for reproducibility.
Exit 2 means quarantine/gaps; exit 0 requires a nonempty bijection with matching
semantics. This gate alone does not establish model or feature lineage.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    allow_nan=False).encode()).hexdigest()


def reconcile(nhl, raw):
    sources = {"nhl": nhl, "raw": raw}
    indices = {name: defaultdict(list) for name in sources}
    quarantine = []
    for name, rows in sources.items():
        for i, row in enumerate(rows):
            gid, eid = row.get("game_id"), row.get("event_id")
            if (type(gid) is not int or type(eid) is not int or eid < 0
                    or len(str(gid)) != 10):
                quarantine.append({"source": name, "row": i, "reason": "invalid_identity"})
                continue
            season = gid // 1000000
            game_type = (gid // 10000) % 100
            if row.get("season") != season or game_type not in (2, 3):
                quarantine.append({"source": name, "row": i, "reason": "season_or_population"})
                continue
            if row.get("period_type") == "SO":
                quarantine.append({"source": name, "row": i, "reason": "shootout"})
                continue
            indices[name][(gid, eid)].append(row)

    matched = []
    for key in sorted(indices["nhl"].keys() | indices["raw"].keys()):
        left, right = indices["nhl"][key], indices["raw"][key]
        record = {"game_id": key[0], "event_id": key[1]}
        if len(left) != 1 or len(right) != 1:
            quarantine.append({**record, "reason": "cardinality", "nhl_count": len(left),
                               "raw_count": len(right)})
            continue
        a, b = left[0], right[0]
        differences = []
        for field, av, bv in (("shooter", a.get("shooter_id"), b.get("player_id")),
                              ("period", a.get("period"), b.get("period")),
                              ("outcome", a.get("is_goal"), b.get("is_goal"))):
            if av is None or bv is None or type(av) != type(bv) or av != bv:
                differences.append(field)
        if differences:
            quarantine.append({**record, "reason": "semantic_conflict", "fields": differences})
        else:
            matched.append(record)
    return {
        "contract": "metric-event-identity-v1",
        "source_sha256": {name: digest(rows) for name, rows in sources.items()},
        "input_rows": {name: len(rows) for name, rows in sources.items()},
        "accepted": bool(matched) and not quarantine,
        "matched": matched,
        "quarantine_counts": dict(Counter(r["reason"] for r in quarantine)),
        "quarantine": quarantine,
        "limitations": ["No feature/model version equivalence is inferred.",
                        "Shot type/time/coordinates require source-specific normalization before promotion."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    data = json.loads(args.snapshot.read_text())
    result = reconcile(data["nhl"], data["raw"])
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0 if result["accepted"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
