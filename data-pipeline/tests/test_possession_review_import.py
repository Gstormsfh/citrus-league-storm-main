import copy
import json
import tempfile
import unittest
from pathlib import Path

from projections.possession_review_import import validate_export, import_file


class ReviewImportTests(unittest.TestCase):
    def setUp(self):
        self.manifest = dict(pack_id='fixture', clips=[dict(game_id=1, event_id=2,
            directory='clip', video_sha256='video', players=[dict(player_id=3)],
            frames=[dict(file='frame.png', sha256='frame', video_pts_seconds=1.25)])])
        self.row = dict(game_id=1, event_id=2, frame_file='clip/frame.png',
            video_sha256='video', frame_sha256='frame', video_seconds=1.25,
            reviewer='Reviewer', evidence_note='Visible stick contact', state='controlled',
            player_id=3, model_suggestion_shown=False,
            review_status='single_reviewer_unadjudicated', training_eligible=False)
        self.export = dict(schema_version=1, pack_id='fixture', observations=[self.row],
                           training_eligible=False, production_eligible=False)

    def test_import_preserves_uncertainty_and_non_play(self):
        for state in ('controlled', 'no_control', 'uncertain', 'not_play'):
            with self.subTest(state=state):
                self.row.update(state=state, player_id=3 if state == 'controlled' else None)
                result = validate_export(self.manifest, self.export)
                self.assertEqual(result['observations'][0]['state'], state)
                self.assertFalse(result['training_eligible'])
                self.assertEqual(result['summary']['remaining_samples'], 0)

    def test_rejects_bad_provenance_and_label_fields(self):
        for field, value in [('game_id', 4), ('event_id', 4), ('frame_file', '../frame.png'),
            ('video_sha256', 'bad'), ('frame_sha256', 'bad'), ('video_seconds', 1.26),
            ('video_seconds', float('nan')), ('video_seconds', True), ('reviewer', ' '),
            ('evidence_note', ''), ('player_id', 4), ('player_id', True), ('state', 'guess'),
            ('model_suggestion_shown', True), ('review_status', 'adjudicated'),
            ('training_eligible', True)]:
            with self.subTest(field=field, value=value):
                export = copy.deepcopy(self.export)
                export['observations'][0][field] = value
                with self.assertRaises(ValueError):
                    validate_export(self.manifest, export)

    def test_duplicate_reviewer_is_rejected(self):
        self.export['observations'].append(dict(self.row, reviewer=' reviewer '))
        with self.assertRaises(ValueError):
            validate_export(self.manifest, self.export)

    def test_pack_and_promotion_rejected(self):
        for field, value in [('pack_id', 'other'), ('schema_version', 2),
                             ('training_eligible', True), ('production_eligible', True)]:
            export = dict(self.export, **{field: value})
            with self.assertRaises(ValueError):
                validate_export(self.manifest, export)

    def test_partial_and_injected_fields(self):
        self.row.update(replay_frame=900, target=1, alignment_status='verified')
        result = validate_export(self.manifest, self.export)
        self.assertNotIn('replay_frame', result['observations'][0])
        self.assertEqual(result['alignment_status'], 'unverified')
        self.export['observations'] = []
        self.assertEqual(validate_export(self.manifest, self.export)['summary']['remaining_samples'], 1)

    def test_non_control_cannot_have_owner(self):
        self.row['state'] = 'uncertain'
        with self.assertRaises(ValueError):
            validate_export(self.manifest, self.export)

    def test_original_is_preserved_and_output_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, export, output = root/'manifest.json', root/'export.json', root/'imported'
            manifest.write_text(json.dumps(self.manifest))
            export.write_text(json.dumps(self.export))
            import_file(manifest, export, output)
            self.assertEqual((output/'original-export.json').read_bytes(), export.read_bytes())
            with self.assertRaises(FileExistsError):
                import_file(manifest, export, output)
