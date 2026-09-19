import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from photo_rights import photo_receipt, require_documented_basis, ROOT


class PhotoRightsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.assets=Path(self.temp.name);(self.assets/'headshots').mkdir()
        self.path=self.assets/'headshots/1.png';self.path.write_bytes(b'fixture portrait')
        self.sha=hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.portraits={'1':dict(file='1.png',status='downloaded',sha256=self.sha,url='https://example.org/1.png')}
        self.image=dict(asset=str(self.path),kind='player-portrait',playerId='1',subject='Test Player',sha256=self.sha,url='https://example.org/1.png',page=4)
        self.registry=dict(reviewedAt='2026-09-15',scope='test',publicLicences={},notIncluded=['Other rights'])

    def receipt(self,images=None):
        return photo_receipt(images or [self.image],self.registry,self.portraits,self.assets)

    def test_credit_and_download_status_do_not_establish_permission(self):
        self.registry['articleCredits']={'1':{'credit':'Photographer / Agency'}}
        r=self.receipt()
        self.assertEqual(r['assets'][0]['credit'],'Photographer / Agency')
        self.assertFalse(r['photoCopyrightBasisComplete'])
        self.assertFalse(r['publicationApproved'])
        with self.assertRaisesRegex(ValueError,'1 assets'):require_documented_basis(r)

    def test_multiple_placements_are_not_multiple_licences(self):
        second=dict(self.image,page=9)
        r=self.receipt([self.image,second])
        self.assertEqual(r['summary']['uniquePhotos'],1)
        self.assertEqual(r['summary']['placements'],2)
        self.assertEqual([u['page'] for u in r['assets'][0]['uses']],[4,9])

    def test_changed_photo_cannot_inherit_evidence(self):
        self.path.write_bytes(b'replacement')
        with self.assertRaisesRegex(ValueError,'hash mismatch'):self.receipt()

    def test_changed_url_cannot_inherit_evidence(self):
        self.image['url']='https://example.org/someone-else.png'
        with self.assertRaisesRegex(ValueError,'source mismatch'):self.receipt()

    def test_repeated_placement_cannot_hide_a_different_image(self):
        altered=dict(self.image,page=9,sha256='different')
        with self.assertRaisesRegex(ValueError,'Repeated photo placement'):
            self.receipt([self.image,altered])

    def test_unknown_supplied_pdf_image_stays_pending(self):
        r=self.receipt([dict(asset=1,subject='Supplied image',page=5)])
        self.assertEqual(r['summary']['permissionPending'],1)

    def test_public_licence_checks_bytes_and_keeps_advertising_separate(self):
        (self.assets/'mcdavid.jpg').write_bytes(b'public-licence-test-fixture')
        registry=copy.deepcopy(self.registry)
        registry['publicLicences']={'mcdavid.jpg':dict(
            sha256=hashlib.sha256((self.assets/'mcdavid.jpg').read_bytes()).hexdigest(),
            sourcePage='https://example.org/photo',originalSource='https://example.org/photo.jpg',
            creator='Test photographer',title='Test fixture',licence='CC BY-SA 2.0',
            licenceUrl='https://creativecommons.org/licenses/by-sa/2.0/',changes='Resized',
            evidence='Synthetic test fixture, not a rights claim',conditions=['Attribution'],
            advertisingApproval='not_assessed')}
        r=photo_receipt([dict(asset='mcdavid.jpg',subject='Connor McDavid',page=1)],registry,{},self.assets)
        self.assertTrue(r['photoCopyrightBasisComplete'])
        self.assertFalse(r['publicationApproved'])
        self.assertEqual(r['assets'][0]['uses'][0]['purpose'],'editorial_cover')
        self.assertEqual(r['assets'][0]['advertisingApproval'],'not_assessed')
        require_documented_basis(r)
        registry['publicLicences']['mcdavid.jpg']['sha256']='bad'
        with self.assertRaisesRegex(ValueError,'hash mismatch'):
            photo_receipt([dict(asset='mcdavid.jpg',subject='Connor McDavid',page=1)],registry,{},self.assets)

    def test_receipt_does_not_mutate_inputs(self):
        original=copy.deepcopy([self.image,self.registry,self.portraits])
        self.receipt()
        self.assertEqual(original,[self.image,self.registry,self.portraits])
