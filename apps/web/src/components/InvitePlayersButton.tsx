/**
 * InvitePlayersButton — share join code via copy, email, or SMS
 * Used on pool pages and league dashboards for commissioners.
 */
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Copy, Mail, MessageSquare, Share2, X, Smartphone } from 'lucide-react';

interface InvitePlayersButtonProps {
  joinCode: string;
  leagueName: string;
}

export const InvitePlayersButton = ({ joinCode, leagueName }: InvitePlayersButtonProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Detect mobile/tablet via touch support + screen width
    const checkMobile = () => {
      setIsMobile(
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.innerWidth < 768
      );
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Wrap in /auth?redirect= so signed-out invitees go through auth,
  // then land back on the join page (with code pre-filled + auto-submit).
  // Signed-in users skip the auth step entirely.
  const joinPath = `/create-league?tab=join&code=${joinCode}`;
  const inviteLink = `${window.location.origin}/auth?redirect=${encodeURIComponent(joinPath)}`;

  const inviteText = `Join my league "${leagueName}" on Citrus Fantasy Sports!\n\nJoin Code: ${joinCode}\n\nJoin here: ${inviteLink}`;

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
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleSMS = () => {
    const body = encodeURIComponent(inviteText);
    // iOS requires sms:&body= while Android uses sms:?body=
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const separator = isIOS ? '&' : '?';
    window.location.href = `sms:${separator}body=${body}`;
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: `Join ${leagueName} on Citrus Fantasy Sports`,
        text: inviteText,
        url: inviteLink,
      });
    } catch {
      // User cancelled or share failed — fall back to copy
      handleCopyLink();
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
        {isMobile && (
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={handleSMS}>
            <MessageSquare className="w-3.5 h-3.5" />
            Send via SMS
          </Button>
        )}
        {isMobile && typeof navigator.share === 'function' && (
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={handleNativeShare}>
            <Smartphone className="w-3.5 h-3.5" />
            Share...
          </Button>
        )}
      </div>
    </div>
  );
};
