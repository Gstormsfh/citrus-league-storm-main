"""Read-only pure-function reproduction; never import legacy utility or models."""
import ast
from pathlib import Path

import pandas as pd


def main():
    root = Path(__file__).resolve().parents[2]
    source = root / "scripts/utilities/calculate_goalie_rebound_control.py"
    tree = ast.parse(source.read_text())
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                    and n.name == "identify_saves_and_rebounds")
    namespace = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
    rows = [
        (1, 100, 10), (1, 90, 10), (2, 100, 20), (2, 99, 20),
    ]
    frame = pd.DataFrame([
        {"game_id": game, "period": 1, "time_remaining_seconds": clock,
         "shot_was_on_goal": True, "is_goal": 0, "event_owner_team_id": team}
        for game, clock, team in rows
    ])
    result = namespace["identify_saves_and_rebounds"](frame)
    actual = result.index[result["rebound_after_save"]].tolist()
    print({"expected_rebound_rows": [3], "actual_rebound_rows": actual})
    assert actual == [1], "Legacy defect no longer reproduces; inspect changed source"
    print("REPRODUCED: second-game rebound assigned to first-game row")


if __name__ == "__main__":
    main()
