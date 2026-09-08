import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Report a team name, league name or profile (2026-09-08, App Store Guideline 1.2).
 * Writes to `content_reports` (RLS: users insert their own reports; migration
 * 20260212300000). Names are filtered at write time by the API and a database
 * trigger; this is the human backstop for what the filter cannot know.
 */
export type ReportableContentType = 'team_name' | 'league_name' | 'user_profile';

export interface ReportableItem {
  id: string;
  type: ReportableContentType;
  text: string;
}

const REASONS: Array<{ value: 'offensive' | 'inappropriate' | 'harassment' | 'spam' | 'other'; label: string }> = [
  { value: 'offensive', label: 'Offensive or hateful' },
  { value: 'inappropriate', label: 'Inappropriate' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam or impersonation' },
  { value: 'other', label: 'Something else' },
];

export function ReportContentDialog({ items, triggerClassName }: { items: ReportableItem[]; triggerClassName?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState<string>(items[0]?.id ?? '');
  const [reason, setReason] = useState<(typeof REASONS)[number]['value']>('offensive');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const reporterId = auth.user?.id;
    if (!reporterId) {
      setBusy(false);
      toast({ title: 'Sign in to report', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('content_reports').insert({
      reporter_id: reporterId,
      content_type: item.type,
      content_id: item.id,
      content_text: item.text,
      reason,
      details: details.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: 'Could not send the report', description: 'Please try again in a moment.', variant: 'destructive' });
      return;
    }
    setOpen(false);
    setDetails('');
    toast({ title: 'Report sent', description: 'Thanks — we review every report.' });
  };

  if (!items.length) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn('font-plex text-[11px] uppercase tracking-[0.12em] text-pressbox-text/50 underline-offset-4 hover:underline', triggerClassName)}
        >
          Report a name
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Report a name</DialogTitle>
          <DialogDescription>Tell us which name and why. Reports are private and reviewed by Citrus.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="block mb-1 text-pressbox-text/70">Name</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-full rounded-md bg-black/20 border border-white/10 px-2 py-2 text-sm">
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.text}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block mb-1 text-pressbox-text/70">Reason</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="w-full rounded-md bg-black/20 border border-white/10 px-2 py-2 text-sm">
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block mb-1 text-pressbox-text/70">Details (optional)</span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value.slice(0, 500))} rows={3} className="w-full rounded-md bg-black/20 border border-white/10 px-2 py-2 text-sm" />
          </label>
        </div>
        <DialogFooter>
          <button type="button" onClick={submit} disabled={busy} className="rounded-md bg-pressbox-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReportContentDialog;
