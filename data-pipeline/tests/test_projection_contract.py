"""Regression checks for local export units, identity and crease coverage."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "draftkit"))
from projection_contract import (ContractError, RoleContext, audit_crease,
                                 exact_identity_index, project_counts,
                                 resolve_identity, skater_from_override,
                                 skater_from_workbook)


class ProjectionContractTests(unittest.TestCase):
    def args(self, **changes):
        values = dict(player_id="123", team="VAN", baseline_gp=78, gp_used=78,
                      provenance="MANUAL", source="supplied workbook",
                      override_reason="Retained supplied qualitative adjustment",
                      role_context=RoleContext(
                          not_conditioned_reason="Input export has no role features"))
        values.update(changes)
        return values

    def test_legacy_season_counts_are_not_multiplied_by_gp(self):
        projection = skater_from_override(rates_per_game={"G": 8.5, "A": 32},
                                          **self.args())
        self.assertAlmostEqual(project_counts(projection)["G"], 8.5)
        self.assertAlmostEqual(project_counts(projection)["A"], 32)

    def test_new_volume_applied_once_and_roster_probability_kept_separate(self):
        projection = skater_from_workbook(season_counts={"G": 12, "A": 13},
                                          **self.args(baseline_gp=68, gp_used=34,
                                                      roster_probability=0.4))
        self.assertEqual(project_counts(projection), {"G": 6.0, "A": 6.5})
        self.assertEqual(projection.roster_probability, 0.4)
        self.assertEqual(projection.provenance, "MANUAL")
        self.assertFalse(projection.role_context.conditioned)

    def test_missing_or_zero_basis_never_infers_a_rate(self):
        args = self.args()
        del args["baseline_gp"]
        with self.assertRaisesRegex(ContractError, "baseline_gp required"):
            skater_from_override(rates_per_game={"G": 12}, **args)
        for baseline in (0, -1, None, float("nan")):
            with self.subTest(baseline=baseline), self.assertRaises(ContractError):
                skater_from_workbook(season_counts={"G": 0},
                                     **self.args(baseline_gp=baseline))

    def test_intentional_model_83_ceiling_is_preserved(self):
        model = skater_from_workbook(season_counts={"G": 40},
                                     **self.args(provenance="MODEL", gp_used=83,
                                                 baseline_gp=83))
        self.assertEqual(model.gp_used, 83)
        self.assertEqual(project_counts(model)["G"], 40)
        with self.assertRaisesRegex(ContractError, "intentional 83 ceiling"):
            skater_from_workbook(season_counts={"G": 40},
                                 **self.args(provenance="MODEL", gp_used=84))
        manual = skater_from_workbook(season_counts={"G": 40},
                                      **self.args(gp_used=84))
        self.assertEqual(manual.gp_used, 84)

    def test_ambiguous_inputs_rejected(self):
        for changes in ({"roster_probability": 40}, {"gp_used": 85},
                        {"override_reason": None}, {"provenance": "UNKNOWN"}):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                skater_from_workbook(season_counts={"G": 12}, **self.args(**changes))
        with self.assertRaises(ContractError):
            RoleContext()
        with self.assertRaises(ContractError):
            RoleContext(conditioned=True, power_play_unit="PP1")

    def test_exact_identity_only_and_id_name_agreement(self):
        index = exact_identity_index([{"player_id": "1", "name": "Bradly Nadeau"}])
        self.assertEqual(resolve_identity(index, name="Bradly Nadeau"), "1")
        with self.assertRaises(ContractError):
            resolve_identity(index, name="Bradley Nadeau")
        with self.assertRaises(ContractError):
            resolve_identity(index, player_id="1", name="Bradley Nadeau")
        for rows in ([{"player_id": "1", "name": "A"},
                      {"player_id": "1", "name": "B"}],
                     [{"player_id": "1", "name": "A"},
                      {"player_id": "2", "name": "A"}]):
            with self.assertRaises(ContractError):
                exact_identity_index(rows)

    def test_missing_crease_forecasts_even_when_team_starts_balance(self):
        audit = audit_crease([
            {"team": "VAN", "player_id": "1", "starts": 60},
            {"team": "VAN", "player_id": "2", "starts": 19},
            {"team": "VAN", "player_id": "3", "starts": 5},
        ], ["1"], {"VAN": 84})
        self.assertFalse(audit["ok"])
        self.assertEqual(audit["team_starts"], {"VAN": 84})
        self.assertEqual(audit["missing_projected_starts"], 24)
        self.assertEqual(audit["issues"], [{"code": "MISSING_GOALIE_PROJECTIONS",
                                         "count": 2, "starts": 24}])

    def test_conservation_checks_all_scheduled_teams_and_duplicate_rows(self):
        row = {"team": "VAN", "player_id": "1", "starts": 82}
        audit = audit_crease([row], ["1"], {"VAN": 84, "ANA": 84})
        self.assertEqual(len(audit["issues"]), 2)
        self.assertEqual(audit["team_starts"]["ANA"], 0)
        with self.assertRaisesRegex(ContractError, "Duplicate crease"):
            audit_crease([row, row], ["1"], {"VAN": 84})
        row["starts"] = 84
        self.assertTrue(audit_crease([row], ["1"], {"VAN": 84})["ok"])


if __name__ == "__main__":
    unittest.main()
