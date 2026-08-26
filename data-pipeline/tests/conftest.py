"""
pytest bootstrap for the data-pipeline test suite.

Why this file exists
--------------------
Two test modules import their subject by bare module name:

    test_projection_uncertainty.py   from projection_uncertainty import ...
                                     -> data-pipeline/projections/projection_uncertainty.py
    test_simulate_matchups.py        from simulate_matchups import ...
                                     -> data-pipeline/scoring/simulate_matchups.py

A bare import only resolves when the module's own directory is on sys.path, which
was true if you happened to run pytest from inside that directory and false from
the repo root. Both files therefore failed at COLLECTION time -- not on an
assertion, but on ModuleNotFoundError before a single test ran.

Nobody noticed because data-pipeline/tests had never executed in CI. The pytest
job added on 2026-08-12 was itself unable to run (pytest was not installed); once
that was fixed on 2026-08-13 these two showed up on the very first green run.

_bootstrap.py registers the `data_pipeline` package alias -- the directory is
`data-pipeline` with a hyphen, which is not a legal Python identifier -- but it
deliberately does not touch sys.path for sibling module directories. That is this
file's job, done once for every test in this directory regardless of the working
directory pytest was invoked from.

Verified before adding: no module name in projections/ or scoring/ shadows a
stdlib module or collides across the two directories.
"""
import os
import sys

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_PIPELINE_DIR = os.path.dirname(_TESTS_DIR)

# data-pipeline/ itself resolves `import _bootstrap`, `monitoring.alerting`,
# `projections.calculate_daily_projections` and `data_pipeline.utils.*`.
# The two leaf directories resolve the bare-name imports above.
_SEARCH_PATHS = (
    _PIPELINE_DIR,
    os.path.join(_PIPELINE_DIR, "projections"),
    os.path.join(_PIPELINE_DIR, "scoring"),
)

for _path in _SEARCH_PATHS:
    if os.path.isdir(_path) and _path not in sys.path:
        sys.path.insert(0, _path)

# Registers the data_pipeline package alias. Must follow the sys.path setup above.
import _bootstrap  # noqa: F401,E402
