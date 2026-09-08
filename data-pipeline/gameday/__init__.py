"""Citrus Game Day Suite — puzzle generators.

One rule: everything in this package runs on a schedule, ahead of time, and
writes an immutable dated JSON artifact per game per day. Nothing here is
ever called at request time. The web app renders what these jobs emit.

Entry point: `python -m data_pipeline.gameday.emit --help`.
"""

GENERATOR_VERSION = "1.0.0"
SCHEMA_VERSION = 1
