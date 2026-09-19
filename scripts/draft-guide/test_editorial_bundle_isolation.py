import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from board_reads import load_board_reads
from player_stories import load_season_context
from reader_value import watchlist_notes,player_spotlights

ROOT=Path(os.environ.get('CITRUS_DRAFT_KIT_TEST_FIXTURES',Path(__file__).parent))

class EditorialBundleIsolationTests(unittest.TestCase):
    def test_selected_bundle_requires_its_own_deployment_and_revision(self):
        if not os.environ.get('CITRUS_DRAFT_KIT_TEST_FIXTURES'):
            self.skipTest('Private editorial acceptance requires CITRUS_DRAFT_KIT_TEST_FIXTURES')
        data=json.loads((ROOT/'review-inputs/guide-data.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            deployment=root/'deployment-research.json'
            deployment.write_text('{"test":"independent reviewed deployment"}')
            for filename,loader in [('board-reads.json',load_board_reads),('player-season-context.json',load_season_context)]:
                bundle=json.loads((ROOT/filename).read_text())
                bundle['canonicalRevision']='new-reviewed-revision'
                bundle['deploymentSha256']=hashlib.sha256(deployment.read_bytes()).hexdigest()
                path=root/filename;path.write_text(json.dumps(bundle))
                loaded=loader(data['players'],'new-reviewed-revision',path,deployment_path=deployment)
                self.assertTrue(loaded)
                with self.assertRaisesRegex(ValueError,'review'):
                    loader(data['players'],'old-revision',path,deployment_path=deployment)
                # A clean checkout deliberately has no private default bundle.
                # Either a missing bundle or a mismatched one must fail closed.
                with self.assertRaises((ValueError,FileNotFoundError)):
                    loader(data['players'],'new-reviewed-revision',path)

    def test_missing_selected_files_never_fall_back_to_the_default_edition(self):
        with tempfile.TemporaryDirectory() as directory:
            for loader in (watchlist_notes,player_spotlights):
                with self.assertRaises(FileNotFoundError):loader([],Path(directory))

if __name__=='__main__':unittest.main()
