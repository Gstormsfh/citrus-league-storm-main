"""Cross-platform bootstrap for data_pipeline package imports.

The data pipeline directory is named 'data-pipeline' (hyphen) for monorepo
consistency, but Python imports use 'data_pipeline' (underscore). This module
registers the package so imports work on all platforms without requiring
symlinks or directory junctions.

Usage — add these lines BEFORE any 'from data_pipeline...' imports:

    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import _bootstrap  # noqa: F401
"""
import sys
import os
import types

_pipeline_dir = os.path.dirname(os.path.abspath(__file__))

if 'data_pipeline' not in sys.modules:
    _mod = types.ModuleType('data_pipeline')
    _mod.__path__ = [_pipeline_dir]
    _mod.__file__ = os.path.join(_pipeline_dir, '__init__.py')
    sys.modules['data_pipeline'] = _mod
