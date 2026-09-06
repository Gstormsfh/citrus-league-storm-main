from acquisition.collect_observations import capture_game
from acquisition import collect_observations as collector
import json
import signal
import pytest
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


def terminal_health(capsys):
    messages = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return next(message for message in reversed(messages) if message['event'] == 'official_observation.health')


def setup_collection(monkeypatch):
    monkeypatch.setattr(collector, 'load_request', lambda: lambda *args, **kwargs: Response())
    monkeypatch.setattr(collector.time, 'sleep', lambda seconds: None)


@pytest.mark.parametrize('error', [ImportError('secret dependency path'), SystemExit(7)])
def test_import_failure_emits_failed_health_and_nonzero(tmp_path, monkeypatch, capsys, error):
    def fail():
        raise error
    monkeypatch.setattr(collector, 'load_request', fail)
    output = tmp_path / 'receipts'
    assert collector.collect([2025020001], output) == 2
    health = terminal_health(capsys)
    assert health['status'] == 'failed' and health['observed'] == 0
    assert health['failures'][0]['phase'] == 'import_request'
    assert health['health_persisted'] is True
    assert json.loads((output / 'health.json').read_text())['status'] == 'failed'
    assert 'secret' not in str(health)


def test_unexpected_capture_exception_preserves_prior_receipts_and_reports_gap(tmp_path, monkeypatch, capsys):
    setup_collection(monkeypatch)
    first = capture_game(2025020001, lambda *args, **kwargs: Response(), lambda: '2026-01-01T00:00:00Z')
    def capture(gid, request):
        if gid == 2025020001:
            return first
        raise RuntimeError('secret capture failure')
    monkeypatch.setattr(collector, 'capture_game', capture)
    output = tmp_path / 'receipts'
    assert collector.collect([2025020001, 2025020002], output) == 2
    assert json.loads((output / '2025020001.json').read_text()) == json.loads(json.dumps(first))
    health = terminal_health(capsys)
    assert health['observed'] == 1 and health['expected'] == 2
    assert health['failures'][0] == {'phase': 'capture_receipt', 'game_id': 2025020002, 'reason': 'RuntimeError'}


def test_receipt_write_failure_never_exposes_partial_json_and_stdout_survives_disk_failure(tmp_path, monkeypatch, capsys):
    setup_collection(monkeypatch)
    def disk_full(self, *args, **kwargs):
        raise OSError('secret disk path')
    monkeypatch.setattr(collector.Path, 'open', disk_full)
    output = tmp_path / 'receipts'
    assert collector.collect([2025020001], output) == 2
    health = terminal_health(capsys)
    assert health['observed'] == 0 and not health['health_persisted']
    assert [failure['phase'] for failure in health['failures']] == ['persist_receipt', 'persist_health']
    assert not list(output.glob('*.json'))
    assert 'secret' not in str(health)


def test_health_write_failure_changes_success_to_failed(tmp_path, monkeypatch, capsys):
    setup_collection(monkeypatch)
    original = collector.write_receipt
    def write(path, value):
        if path.name == 'health.json':
            raise OSError('full disk')
        return original(path, value)
    monkeypatch.setattr(collector, 'write_receipt', write)
    output = tmp_path / 'receipts'
    assert collector.collect([2025020001], output) == 2
    health = terminal_health(capsys)
    assert health['observed'] == 1 and health['status'] == 'failed'
    assert health['failures'][0]['phase'] == 'persist_health'


def test_interrupt_writes_failed_health_and_restores_signal_handlers(tmp_path, monkeypatch, capsys):
    setup_collection(monkeypatch)
    old = signal.getsignal(signal.SIGTERM)
    def interrupt(seconds):
        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
    monkeypatch.setattr(collector.time, 'sleep', interrupt)
    assert collector.collect([2025020001, 2025020002], tmp_path / 'receipts') == 2
    health = terminal_health(capsys)
    assert health['interrupted'] and health['observed'] == 1
    assert signal.getsignal(signal.SIGTERM) == old


def test_existing_output_is_not_overwritten_and_manifest_failure_is_reported(tmp_path, monkeypatch, capsys):
    existing = tmp_path / 'existing'
    existing.mkdir()
    marker = existing / 'health.json'
    marker.write_text('previous immutable evidence')
    assert collector.collect([2025020001], existing) == 2
    assert terminal_health(capsys)['failures'][0]['phase'] == 'create_output'
    assert marker.read_text() == 'previous immutable evidence'
    monkeypatch.setattr(collector.sys, 'argv', ['collect', str(tmp_path / 'missing-manifest'), str(tmp_path / 'new')])
    assert collector.main() == 2
    health = terminal_health(capsys)
    assert health['expected'] is None and health['failures'][0]['phase'] == 'read_manifest'


def test_success_preserves_captured_payload_and_hashes(tmp_path, monkeypatch, capsys):
    setup_collection(monkeypatch)
    output = tmp_path / 'receipts'
    assert collector.collect([2025020001], output) == 0
    saved = json.loads((output / '2025020001.json').read_text())
    from acquisition.event_observation_service import prepare_observation
    assert saved['prepared'] == list(prepare_observation(saved['prepared'][0]['payload']['pbp'], saved['observed_at']))
    health = terminal_health(capsys)
    assert health['status'] == 'complete' and health['health_persisted']
    assert not list(output.glob('*.pending'))
