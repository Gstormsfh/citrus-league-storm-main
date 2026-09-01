/**
 * InvitePlayersButton — share join code via the OS share sheet, copy,
 * email, or text. Used on pool pages and league dashboards.
 *
 * All link/text construction and send mechanics live in
 * utils/inviteShare — this component only decides which affordances to
 * show: Share leads wherever the OS share sheet exists, and the
 * scheme-based Email / Text buttons are web-only (they are dead inside
 * the native shell).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Copy, Mail, MessageSquare, Share2, X } from 'lucide-react';
import {
  buildInviteLink,
  canSystemShare,
  emailInvite,
  isNativeApp,
  shareInvite,
  smsInvite,
} from '@/utils/inviteShare';

interface InvitePlayersButtonProps {
  joinCode: string;
  leagueName: string;
}

export const InvitePlayersButton = ({ joinCode, leagueName }: InvitePlayersButtonProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const showSystemShare = canSystemShare();
  const showSchemeButtons = !isNativeApp();

  const handleCopyCode = () => {
    navigator.clipboard.writeText(joinCode);
    toast({ title: 'Copied!', description: 'Join code copied to clipboard' });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(buildInviteLink(joinCode));
    toast({ title: 'Copied!', description: 'Invite link copied to clipboard' });
  };

  const handleShare = async () => {
    const result = await shareInvite(leagueName, joinCode);
    if (result === 'copied') {
      toast({ title: 'Invite copied!', description: 'Paste it anywhere to invite friends.' });
    } else if (result === 'failed') {
      toast({ title: 'Could not share', description: 'Use Copy Invite Link instead.' });
    }
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
    <div className="bg-[#1A2A20] rounded-xl border border-citrus-sage/20 shadow-lg p-4 w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-bold text-sm text-pastel-cream">Invite Players</span>
        <button onClick={() => setOpen(false)} className="text-white/55 hover:text-pastel-cream">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Join code */}
      <div className="flex items-center gap-2 mb-3 p-2 bg-white/5 rounded-lg">
        <span className="text-xs font-display text-white/55">Code:</span>
        <Badge variant="outline" className="font-mono text-sm tracking-wider">{joinCode}</Badge>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={handleCopyCode}>
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Actions — Share leads wherever the OS sheet exists */}
      <div className="space-y-1.5">
        {showSystemShare && (
          <Button variant="default" size="sm" className="w-full justify-start gap-2 text-xs" onClick={handleShare}>
            <Share2 className="w-3.5 h-3.5" />
            Share Invite
          </Button>
        )}
        <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={handleCopyLink}>
          <Copy className="w-3.5 h-3.5" />
          Copy Invite Link
        </Button>
        {showSchemeButtons && (
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={() => emailInvite(leagueName, joinCode)}>
            <Mail className="w-3.5 h-3.5" />
            Send via Email
          </Button>
        )}
        {showSchemeButtons && (
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={() => smsInvite(leagueName, joinCode)}>
            <MessageSquare className="w-3.5 h-3.5" />
            Send via Text
          </Button>
        )}
      </div>
    </div>
  );
};
