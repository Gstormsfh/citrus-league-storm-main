/**
 * InvitePlayersButton — share join code via copy, email, or SMS
 * Used on pool pages and league dashboards for commissioners.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Copy, Mail, MessageSquare, Share2, X } from 'lucide-react';

interface InvitePlayersButtonProps {
  joinCode: string;
  leagueName: string;
}

export const InvitePlayersButton = ({ joinCode, leagueName }: InvitePlayersButtonProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const inviteLink = `${window.location.origin}/create-league?tab=join&code=${joinCode}`;

  const inviteText = `Join my league "${leagueName}" on Citrus Fantasy Sports!\n\nJoin Code: ${joinCode}\n\n1. Go to: ${inviteLink}\n2. Paste the code and click Join`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(joinCode);
    toast({ title: 'Copied!', description: 'Join code copied to clipboard' });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    toast({ title: 'Copied!', description: 'Invite link copied to clipboard' });
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(`Join ${leagueName} on Citrus Fantasy Sports`);
    const body = encodeURIComponent(inviteText);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const handleSMS = () => {
    const body = encodeURIComponent(inviteText);
    // sms: URI works on both iOS and Android
    window.open(`sms:?body=${body}`, '_blank');
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5 font-display text-xs">
        <Share2 className="w-3.5 h-3.5" />
        Invite Players
      </Button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-citrus-sage/20 shadow-lg p-4 w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-bold text-sm text-citrus-forest">Invite Players</span>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Join code */}
      <div className="flex items-center gap-2 mb-3 p-2 bg-slate-50 rounded-lg">
        <span className="text-xs font-display text-slate-500">Code:</span>
        <Badge variant="outline" className="font-mono text-sm tracking-wider">{joinCode}</Badge>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={handleCopyCode}>
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Actions */}
      <div className="space-y-1.5">
        <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={handleCopyLink}>
          <Copy className="w-3.5 h-3.5" />
          Copy Invite Link
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={handleEmail}>
          <Mail className="w-3.5 h-3.5" />
          Send via Email
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={handleSMS}>
          <MessageSquare className="w-3.5 h-3.5" />
          Send via SMS
        </Button>
      </div>
    </div>
  );
};
