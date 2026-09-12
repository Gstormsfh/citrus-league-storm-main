"""Integration checks for the Python/Node guide scoring boundary.

Run with CITRUS_NODE pointing to Node 22.18+ when it is not on PATH:
    python3 -m unittest discover -s scripts/draft-guide -p test_scoring.py -v
"""
import copy
import json
from pathlib import Path
import unittest

from scoring import calculate

ROOT = Path(__file__).resolve().parent


class GuideScoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'workbook-data.json').read_text())
        cls.baseline = calculate(cls.data, cls.data['weights'])

    def weights(self, value=0):
        return {group: dict.fromkeys(categories, value)
                for group, categories in self.data['weights'].items()}

    def fixture(self, specifications):
        players = []
        for index, (position, goals, assists) in enumerate(specifications):
            players.append(dict(
                key=f'test:{index}', name=f'Player {index}', position=position,
                isGoalie=False, baseGames=10, games=20,
                stats={'goals': goals, 'assists': assists},
                rosterProbability=0.25,
            ))
        return {'weights': copy.deepcopy(self.data['weights']), 'players': players}

    def test_baseline_matches_every_source_cached_score_and_rank(self):
        source = {p['key']: p for p in self.data['players']}
        self.assertEqual(len(self.baseline['players']), len(source))
        for scored in self.baseline['players']:
            with self.subTest(player=scored['name']):
                original = source[scored['key']]
                self.assertAlmostEqual(scored['fantasyPoints'], original['sourceFantasyPoints'], places=7)
                # Cached Excel ranks split two floating-point-equivalent ties.
                # Normalize only those ties to the documented competition rank.
                tied_cache_rank = min(
                    p['sourceRank'] for p in source.values()
                    if p['isGoalie'] == original['isGoalie']
                    and abs(p['sourceFantasyPoints'] - original['sourceFantasyPoints']) < 1e-9
                )
                self.assertEqual(scored['rank'], tied_cache_rank)

    def test_custom_weights_score_every_category_and_reorder(self):
        weights = self.weights()
        for group in weights:
            for index, key in enumerate(weights[group]):
                weights[group][key] = (index + 1) * (-0.7 if index % 2 else 1.3)
        scored = calculate(self.data, weights)['players']
        self.assertNotEqual([p['key'] for p in scored], [p['key'] for p in self.baseline['players']])
        for p in scored:
            group = 'goalie' if p['isGoalie'] else 'skater'
            expected = sum(value * weights[group][key] for key, value in p['stats'].items())
            expected *= p['games'] / p['baseGames'] if p['baseGames'] else 0
            with self.subTest(player=p['name']):
                self.assertAlmostEqual(p['fantasyPoints'], expected, places=7)
                self.assertAlmostEqual(sum(c['points'] for c in p['contributions']), expected, places=7)
                self.assertAlmostEqual(p['pointsPerGame'], expected / p['games'] if p['games'] else 0, places=7)
                if p['rosterProbability'] is None:
                    self.assertIsNone(p['adjustedPoints'])
                else:
                    self.assertAlmostEqual(p['adjustedPoints'], expected * p['rosterProbability'], places=7)
        for goalie in (False, True):
            values = [p['fantasyPoints'] for p in scored if p['isGoalie'] == goalie]
            self.assertEqual(values, sorted(values, reverse=True))

    def test_reweighting_preserves_all_source_fields_and_input(self):
        before = copy.deepcopy(self.data)
        scored = calculate(self.data, self.weights(-1))['players']
        self.assertEqual(before, self.data)
        original = {p['key']: p for p in before['players']}
        for p in scored:
            for key, value in original[p['key']].items():
                with self.subTest(player=p['name'], field=key):
                    self.assertEqual(p[key], value)

    def test_zero_weights_give_tied_rank_one_in_each_cohort(self):
        for p in calculate(self.data, self.weights())['players']:
            self.assertEqual(p['fantasyPoints'], 0)
            self.assertEqual(p['rank'], 1)
            self.assertEqual(p['positionRank'], 1)

    def test_negative_weights_reverse_order_without_clamping(self):
        data = self.fixture([('C', 3, 0), ('C', 1, 0)])
        weights = self.weights()
        weights['skater']['goals'] = -2
        scored = calculate(data, weights)['players']
        self.assertEqual([p['name'] for p in scored], ['Player 1', 'Player 0'])
        self.assertEqual([p['fantasyPoints'] for p in scored], [-4, -12])

    def test_competition_ranks_and_position_ranks_skip_ties(self):
        data = self.fixture([('C', 5, 0), ('D', 5, 0), ('C', 5, 0), ('C', 3, 0), ('D', 2, 0)])
        weights = self.weights()
        weights['skater']['goals'] = 1
        scored = calculate(data, weights)['players']
        self.assertEqual([p['name'] for p in scored], [p['name'] for p in data['players']])
        self.assertEqual([p['rank'] for p in scored], [1, 1, 1, 4, 5])
        self.assertEqual([p['positionRank'] for p in scored], [1, 1, 1, 3, 2])

    def test_zero_games_and_zero_base_games_remain_finite(self):
        data = self.fixture([('C', 5, 0), ('C', 3, 0)])
        data['players'][0]['games'] = 0
        data['players'][1]['baseGames'] = 0
        for p in calculate(data, self.data['weights'])['players']:
            self.assertEqual(p['fantasyPoints'], 0)
            self.assertEqual(p['pointsPerGame'], 0)
            self.assertEqual(p['adjustedPoints'], 0)

    def test_missing_invalid_and_unsupported_settings_fail(self):
        bad_settings = []
        for group in ('skater', 'goalie'):
            missing_group = self.weights()
            del missing_group[group]
            bad_settings.append((f'missing {group}', missing_group))
            for key in self.data['weights'][group]:
                missing = self.weights()
                del missing[group][key]
                bad_settings.append((f'missing {group}.{key}', missing))
            for value in (None, '1', True, float('nan'), float('inf'), -float('inf')):
                invalid = self.weights()
                invalid[group][next(iter(invalid[group]))] = value
                bad_settings.append((f'invalid {group} {value!r}', invalid))
            for key in ('unsupported_category', '__proto__', 'constructor', 'toString'):
                unsupported = self.weights()
                unsupported[group][key] = 1
                bad_settings.append((f'unsupported {group}.{key}', unsupported))
        for label, weights in bad_settings:
            with self.subTest(settings=label):
                with self.assertRaises(ValueError):
                    calculate(self.data, weights)


if __name__ == '__main__':
    unittest.main()
