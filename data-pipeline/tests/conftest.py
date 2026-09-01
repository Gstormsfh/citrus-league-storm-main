"""
pytest bootstrap for the data-pipeline test suite.

This file does two things, both of which must happen before pytest imports the
first test module: plant placeholder Supabase credentials (section 1) and put
the pipeline's module directories on sys.path (section 2).

1. Placeholder credentials (added 2026-09-01)
---------------------------------------------
Several pipeline modules raise at IMPORT time when VITE_SUPABASE_URL or
SUPABASE_SERVICE_ROLE_KEY is absent (monitoring/check_data_freshness.py:75,
projections/run_daily_projections.py:88, and half a dozen more). Any test that
imports one of them therefore fails at COLLECTION in a sandbox with no
credentials, and because pytest collects every module before running anything,
one such module aborts the whole run: `pytest tests/` with no env exited with
"Interrupted: 1 error during collection" on test_freshness_exit_contract.py.

Before this file planted them, the suite only collected when
test_projection_logic.py happened to be imported first -- it sets the same
placeholders at module level -- which is why the failure depended on which files
you named on the command line. Three other modules (test_goalie_start_probability,
test_nightly_ros_rebuild, test_skater_calibration) each carry their own
set-then-restore block for the same reason. Doing it once here, before any test
module is imported, makes the order irrelevant.

Two properties are load-bearing:

  * `setdefault`, never assignment. CI exports the real secrets before python
    starts, so the placeholders are inert there and the live tests run for real.
  * The VALUES are the ones test_nhl_season_year_parity.py recognises as
    placeholders ("test.supabase.co" in the URL, key starting "test-key"). Its
    live tests skip on them instead of trying to resolve a fake host over the
    network. If you change these values, change that guard in the same commit.

The placeholders are process-wide and stay set. That is deliberate and no wider
than before: test_projection_logic.py has leaked the same URL (and a key with the
same "test-key" prefix) into every full run since 2026-03-08, and collection
finishes before any test runs, so nothing at run time sees anything new. Anything
that genuinely needs a live service carries @pytest.mark.network (see
pytest.ini); sandboxes run `pytest -m "not network"`.

2. sys.path
-----------
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

# Section 1 -- must precede every import of pipeline code, including the
# _bootstrap import at the bottom of this file. See the module docstring for
# why these exact values and why setdefault.
os.environ.setdefault("VITE_SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key-placeholder")

# Section 2 -- sys.path.
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
