from acquisition.collect_observations import capture_game
from tests.test_canonical_events import game, shot


class Response:
    def raise_for_status(self):
        pass

    def json(self):
        return game([shot()])


def test_official_acquisition_boundary_pins_game_and_real_observation_time():
    calls = []
    def request(url, **kwargs):
        calls.append((url, kwargs))
        return Response()
    receipt = capture_game(2025020001, request, lambda: '2026-01-01T00:00:00Z')
    assert receipt['status'] == 'complete'
    assert receipt['prepared'][0]['observed_at'] == '2026-01-01T00:00:00+00:00'
    assert calls[0][0].endswith('/2025020001/play-by-play')
    assert capture_game(2025020002, request)['status'] == 'unavailable'


def test_failure_receipt_does_not_leak_exception_secrets_or_claim_empty_complete():
    def request(*args, **kwargs):
        raise RuntimeError('secret proxy password')
    receipt = capture_game(2025020001, request)
    assert receipt['status'] == 'unavailable' and receipt['reason'] == 'RuntimeError'
    assert 'secret' not in str(receipt) and 'prepared' not in receipt
