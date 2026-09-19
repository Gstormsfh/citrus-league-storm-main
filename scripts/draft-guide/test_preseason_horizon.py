import copy
import unittest
from customer_data import require_preseason_horizon

def fixture():
    return dict(canonicalRevision='a'*64,schedule={'A':84},edition=dict(kind='effective_runtime',
        horizon='remaining_season',asOf='2026-09-18',runtimeRevision='a'*64),
        players=[dict(team='A',forecastStatus='projected',games=76,canonicalExposure={'used':76},
            canonicalRemaining=dict(used=76,actual_gp=0,team_games=84,as_of='2026-09-18'))])

class PreseasonHorizonTests(unittest.TestCase):
    def test_preseason_refresh_is_allowed_without_relabelling_or_reverting_rates(self):
        data=fixture();before=copy.deepcopy(data)
        require_preseason_horizon(data)
        self.assertEqual(data,before)

    def test_explicit_organization_prior_is_not_fabricated_zero_participation(self):
        data=fixture();data['players'][0]['canonicalRemaining'].update(actual_gp=None,
            method='organization_prior_remaining',participation_semantics='not_used_by_prior')
        require_preseason_horizon(data)
        self.assertIsNone(data['players'][0]['canonicalRemaining']['actual_gp'])

    def test_missing_evidence_or_inseason_inputs_cannot_enter_preseason_downloads(self):
        for bad in ('played','short_schedule','missing_remaining','null_actual','wrong_day','changed_exposure','boolean_zero','missing_team','wrong_revision'):
            with self.subTest(bad=bad):
                data=fixture();p=data['players'][0];r=p['canonicalRemaining']
                if bad=='played':r['actual_gp']=1
                if bad=='short_schedule':r['team_games']=83
                if bad=='missing_remaining':del p['canonicalRemaining']
                if bad=='null_actual':r['actual_gp']=None
                if bad=='wrong_day':r['as_of']='2026-09-17'
                if bad=='changed_exposure':p['games']=75
                if bad=='boolean_zero':r['actual_gp']=False
                if bad=='missing_team':data['schedule']['B']=84
                if bad=='wrong_revision':data['edition']['runtimeRevision']='b'*64
                with self.assertRaises(ValueError):require_preseason_horizon(data)

if __name__=='__main__':unittest.main()
