import unittest
from check_player_affiliations import assess

class AffiliationHealthTest(unittest.TestCase):
    def test_known_stale_feed_and_new_conflict(self):
        event = dict(id='e', sequence=1, player_id=1, team_abbrev='MTL', feed_team_at_review='ANA')
        current = [dict(player_id=1, team_abbrev='MTL', current_affiliation=dict(event_id='e', status='affiliated'))]
        self.assertEqual(assess(current, [dict(player_id=1, team_abbrev='ANA')], [event])['status'], 'OK')
        self.assertEqual(assess(current, [dict(player_id=1, team_abbrev='BOS')], [event])['status'], 'FAIL')
        self.assertEqual(assess(current, [dict(player_id=1, team_abbrev='MTL')], [event])['status'], 'OK')
        self.assertEqual(assess([], [], [event])['status'], 'FAIL')

    def test_new_event_supersedes_old_in_any_order(self):
        old = dict(id='old', sequence=1, player_id=1, team_abbrev='ANA', feed_team_at_review='ANA')
        new = dict(id='new', sequence=2, player_id=1, team_abbrev=None, feed_team_at_review='ANA')
        current = [dict(player_id=1, team_abbrev=None, current_affiliation=dict(event_id='new', status='retired'))]
        self.assertEqual(assess(current, [dict(player_id=1, team_abbrev='ANA')], [new, old])['status'], 'OK')

if __name__ == '__main__':
    unittest.main()
