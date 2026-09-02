"""
CONFIDENCE LABEL VOCABULARY (2026-09-01).

Three writers put a badge word into projections: the Python nightly
(projection_uncertainty.confidence_label_for), the SQL rebuild
(rebuild_player_projected_stats) and — as readers — the web UI, which
compares `=== 'High'` / `=== 'Medium'`. The SQL rebuild wrote lowercase
labels, so every SQL-built row rendered as the orange Low badge. This pins
the vocabulary across the two writers so it cannot drift again.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401,E402

from projections.projection_uncertainty import confidence_label_for  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATION = os.path.join(
    REPO, "supabase", "migrations",
    "20260901230000_projected_stats_confidence_label_case.sql",
)

VOCAB = {"High", "Medium", "Low"}


def test_python_labels_are_the_capitalised_vocabulary():
    seen = {confidence_label_for(c) for c in (0.0, 0.05, 0.34, 0.35, 0.59, 0.60, 0.99)}
    assert seen == VOCAB


def test_sql_rebuild_writes_the_same_vocabulary():
    src = open(MIGRATION, encoding="utf-8").read()
    body = src.split("$function$")[1]  # the function body only, not comments
    labels = set(re.findall(r"then '([A-Za-z]+)'\s*(?:\n|$| )", body))
    # every label the CASE emits is in the vocabulary, and the two lowercase
    # forms that produced the bug are gone
    assert labels <= VOCAB, labels
    assert "'unknown'" not in body
    assert "'high'" not in body and "'low'" not in body and "'medium'" not in body
