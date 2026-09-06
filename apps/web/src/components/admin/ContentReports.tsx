import { useEffect, useState } from 'react';
import { adminApi } from '@/api/admin';
import { userMessage } from '@/lib/userMessage';

interface Report {
  id: string;
  reason: string;
  created_at: string;
  notifications: { message: string } | null;
}

export function ContentReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setBusy(true); setError('');
    try { setReports((await adminApi.getContentReports()).data as Report[]); }
    catch (err) { setError(userMessage(err, 'Reports could not be loaded.')); }
    finally { setBusy(false); }
  };
  useEffect(() => { void reload(); }, []);
  const resolve = async (report: Report, action: 'dismiss' | 'remove' | 'suspend') => {
    if (!window.confirm(action === 'dismiss' ? 'Dismiss this report?' : action === 'suspend'
      ? 'Remove this message for everyone and suspend this sender from league chat?'
      : 'Remove this message for everyone?')) return;
    setBusy(true); setError('');
    try { await adminApi.moderateReport(report.id, action); await reload(); }
    catch (err) { setError(userMessage(err, 'Report was not resolved.')); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4" aria-label="Content reports">
    <p>Review reports promptly, starting with the oldest. Suspension stops new league chat messages.</p>
    <button className="min-h-11 underline" disabled={busy} onClick={() => void reload()}>Refresh reports</button>
    {error && <p role="alert">{error}</p>}
    {!busy && !error && reports.length === 0 && <p>No open reports.</p>}
    {reports.map((report) => <article key={report.id} className="rounded-xl border p-4 space-y-3">
      <p>{new Date(report.created_at).toLocaleString()}</p>
      <p><strong>Reported message:</strong> {report.notifications?.message ?? 'Message no longer available'}</p>
      <p><strong>Concern:</strong> {report.reason}</p>
      <div className="flex flex-wrap gap-4">
        <button className="min-h-11 underline" disabled={busy} onClick={() => void resolve(report, 'remove')}>Remove message</button>
        <button className="min-h-11 underline" disabled={busy} onClick={() => void resolve(report, 'suspend')}>Remove and suspend sender</button>
        <button className="min-h-11 underline" disabled={busy} onClick={() => void resolve(report, 'dismiss')}>Dismiss report</button>
      </div>
    </article>)}
    {reports.length === 100 && <p>Showing the oldest 100 reports. Resolve these and refresh to continue.</p>}
  </section>;
}
