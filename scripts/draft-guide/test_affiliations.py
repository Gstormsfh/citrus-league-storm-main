"""Affiliation presentation cannot change scoring or rewrite source scenarios."""
from copy import deepcopy
import unittest
from affiliations import SCHEMA, attach, presentation, fingerprint, context, validate
from import_canonical import convert
from scoring import calculate
from test_canonical_import import fixtures


def snapshot():
    return {'schema_version': SCHEMA, 'as_of': '2026-09-13', 'players': {
        '1': {'status': 'affiliated', 'team': 'MTL', 'authority': 'official_transaction',
              'as_of': '2026-09-12', 'source_urls': ['https://example.org/transaction'],
              'reason': 'Synthetic test signing', 'event_id': 'test-1'}}}


class AffiliationTests(unittest.TestCase):
    def test_display_does_not_change_any_scoring_or_team_slot_input(self):
        canonical, editorial = fixtures()
        data = convert(canonical, editorial, canonical['revision'])
        before = deepcopy(data)
        bound = attach(data, snapshot())
        original = calculate(data, data['weights'])
        actual = presentation(bound, calculate(bound, bound['weights']))
        self.assertEqual(data, before)
        self.assertEqual(bound['players'], data['players'])
        self.assertEqual(bound['teams'], data['teams'])
        for prior, current in zip(original['players'], actual['players']):
            for key in prior:
                self.assertEqual(current[key], prior[key], key)
        player = next(p for p in actual['players'] if p['key'] == 'canonical:1')
        self.assertEqual(player['displayTeam'], 'MTL')
        self.assertEqual(player['team'], 'ANA')
        self.assertEqual(player['projectionTeam'], 'ANA')
        self.assertIn('Projection club: ANA', context(player))
        omitted = next(p for p in actual['players'] if p['key'] == 'canonical:2')
        self.assertEqual(omitted['displayTeam'], 'Unreviewed')
        self.assertIsNone(omitted['fantasyPoints'])

    def test_zero_forecast_and_distinct_non_club_states(self):
        data = {'players': []}
        scored = {'players': [{'key': 'canonical:1', 'team': 'ANA', 'fantasyPoints': 0, 'games': 0}]}
        labels = set()
        for status in ('free_agent', 'retired', 'non_nhl', 'unknown'):
            s = snapshot(); s['players']['1'].update(status=status, team=None)
            out = presentation(attach(data, s), scored)['players'][0]
            labels.add(out['displayTeam'])
            self.assertEqual((out['games'], out['fantasyPoints']), (0, 0))
        self.assertEqual(len(labels), 4)

    def test_binding_tampering_and_invalid_teams_fail_closed(self):
        s = snapshot(); bound = attach({}, s)
        bound['affiliationOverlay']['players']['1']['team'] = 'TOR'
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            presentation(bound, {'players': []})
        for status, team in [('affiliated', None), ('retired', 'MTL')]:
            s = snapshot(); s['players']['1'].update(status=status, team=team)
            with self.assertRaises(ValueError): validate(s)
        s = snapshot(); s['players']['1']['as_of'] = '2026-09-14'
        with self.assertRaises(ValueError): validate(s)

    def test_order_independent_fingerprint_includes_evidence(self):
        s = snapshot(); self.assertEqual(fingerprint(s), fingerprint(dict(reversed(list(s.items())))))
        changed = deepcopy(s); changed['players']['1']['reason'] += ' revised'
        self.assertNotEqual(fingerprint(s), fingerprint(changed))

    def test_fallback_and_organization_contract(self):
        s = snapshot()
        row = s['players']['1']
        row.update(authority='nhl_roster_feed', event_id=None, source_urls=[],
                   recorded_at=None, organization=None, as_of=None, reason=None)
        validate(s)
        row['authority'] = 'unrecognized'
        with self.assertRaises(ValueError): validate(s)
        row.update(authority='official_transaction', event_id='test-1',
                   as_of='2026-09-12', reason='Synthetic reviewed event',
                   source_urls=['https://example.org/transaction'], status='non_nhl',
                   team=None, organization='Synthetic AHL club')
        player = presentation(attach({}, s), {'players': [
            {'key': 'canonical:1', 'team': 'ANA'}]})['players'][0]
        self.assertIn('Non-NHL / Synthetic AHL club', context(player))
        changed = deepcopy(s)
        changed['players']['1']['recorded_at'] = '2026-09-13T12:00:00Z'
        self.assertNotEqual(fingerprint(s), fingerprint(changed))


if __name__ == '__main__':
    unittest.main()
