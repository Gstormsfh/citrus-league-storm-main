/**
 * STORMY, THE PHONE (PR10n, 2026-09-04)
 *
 * No artboard. A chat is a list that grows from the bottom and a composer
 * that stays put, so this borrows the shapes the app already has for both:
 * the note card for what Stormy says, the tile for what you said, the chip
 * for a starter question, the chat bar's geometry for the composer. The
 * page owns the transcript, the quota and the send; this lays them out.
 *
 * WHAT IS NOT HERE. The 09-01 settings tab had three switches wired to
 * nothing (proactive hints, trade alerts, personality), an "Upgrade to
 * Unlimited" button with no handler, and a meter that reset to 0/15 on
 * every reload while the server counted a rolling week. None of that is
 * drawn: a control that does nothing is a lie told in chrome. The ABOUT
 * pane says what Stormy sees and what the allowance is, and clears the
 * transcript -- the one setting that was ever real.
 */
import { useState, type RefObject } from 'react';
import { Loader2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BOTTOMNAV_H } from '@/components/pressbox/chromeMetrics';
import { PB_TYPE, PressBoxSegmented } from '@/components/pressbox';
import { PressBoxSettingGroup, PressBoxSettingRow } from '@/components/pressbox/Settings';

export interface StormyPhoneMessage {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
}

export interface StormyStarter {
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface StormyPhoneProps {
  messages: StormyPhoneMessage[];
  isLoading: boolean;
  inputValue: string;
  onInputChange: (next: string) => void;
  onSend: () => void;
  /** The four starter questions; drawn while the transcript is still short. */
  starters: StormyStarter[];
  onStarter: (label: string) => void;
  /** Where the transcript scrolls; the page pins it to the bottom on change. */
  scrollRef: RefObject<HTMLDivElement>;
  /** The app header, rendered by the page so the header guard sees it. */
  header: React.ReactNode;
  /** `What I see` -- the honest capability line for the calendar. */
  seesLine: string;
  weeklyLimit: number;
  onClearHistory: () => void;
  banner?: React.ReactNode;
  className?: string;
}

const STORMY_AVATAR = '/mascots/mascot-stormy.webp';

export function StormyPhone({
  messages,
  isLoading,
  inputValue,
  onInputChange,
  onSend,
  starters,
  onStarter,
  scrollRef,
  header,
  seesLine,
  weeklyLimit,
  onClearHistory,
  banner,
  className,
}: StormyPhoneProps) {
  const [pane, setPane] = useState<'chat' | 'about'>('chat');
  const [confirmClear, setConfirmClear] = useState(false);
  const canSend = inputValue.trim().length > 0 && !isLoading;

  return (
    /* The layer owns the viewport above the nav: header, control, the
       transcript (which is the only thing that scrolls), the composer. A
       chat with a page scroll puts the composer under the keyboard or off
       the bottom; a column that fills the room puts it where a thumb is. */
    <div
      className={cn(
        PB_TYPE,
        'lg:hidden fixed inset-x-0 top-0 flex flex-col bg-pressbox-surface text-pressbox-text pt-[env(safe-area-inset-top)]',
        className,
      )}
      style={{ bottom: `calc(${BOTTOMNAV_H}px + env(safe-area-inset-bottom))` }}
      data-testid="stormy-phone"
    >
      {header}
      <div className="px-3.5 pt-1">
        {banner && <div className="mb-3">{banner}</div>}
        <PressBoxSegmented
          label="Stormy view"
          segments={[
            { key: 'chat', label: 'CHAT' },
            { key: 'about', label: 'ABOUT' },
          ]}
          activeKey={pane}
          onSelect={(k) => setPane(k as 'chat' | 'about')}
        />
      </div>

      {pane === 'chat' ? (
        <>
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 mt-2 border-t border-white/[0.06] px-3.5 pt-3 overflow-y-auto overscroll-contain"
            data-testid="stormy-transcript"
          >
            <ol className="space-y-3">
              {messages.map((m) =>
                m.sender === 'user' ? (
                  <li key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[12px] rounded-tr-[4px] bg-pressbox-tile-high border border-white/[0.08] px-3 py-2">
                      <p className="font-plex font-semibold text-[9px] tracking-[0.12em] text-pressbox-text/45">YOU</p>
                      <p className="mt-0.5 whitespace-pre-wrap font-barlow text-[14px] leading-[1.45] text-pressbox-text">{m.text}</p>
                    </div>
                  </li>
                ) : (
                  <li key={m.id} className="flex gap-2.5">
                    <img src={STORMY_AVATAR} alt="" className="mt-1 w-[30px] h-[30px] flex-none rounded-full object-cover" />
                    <div className="min-w-0 max-w-[85%] rounded-[12px] rounded-tl-[4px] bg-pressbox-tile border border-white/[0.08] px-3 py-2">
                      <p className="font-plex font-semibold text-[9px] tracking-[0.12em] text-pressbox-orange-soft">STORMY</p>
                      <p className="mt-0.5 whitespace-pre-wrap font-barlow text-[14px] leading-[1.45] text-pressbox-text/90">{m.text}</p>
                    </div>
                  </li>
                ),
              )}
              {isLoading && (
                <li className="flex gap-2.5" aria-live="polite">
                  <img src={STORMY_AVATAR} alt="" className="mt-1 w-[30px] h-[30px] flex-none rounded-full object-cover" />
                  <div className="rounded-[12px] rounded-tl-[4px] bg-pressbox-tile border border-white/[0.08] px-3 py-2.5 flex items-center gap-2">
                    <span className="flex gap-1" aria-hidden="true">
                      <span className="w-1.5 h-1.5 rounded-full bg-pressbox-orange-soft animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-pressbox-orange-soft animate-bounce" style={{ animationDelay: '120ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-pressbox-orange-soft animate-bounce" style={{ animationDelay: '240ms' }} />
                    </span>
                    <span className="font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/55">Reading the league…</span>
                  </div>
                </li>
              )}
            </ol>

            {messages.length <= 2 && (
              <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Starter questions">
                {starters.map(({ label, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onStarter(label)}
                    className="focus-citrus inline-flex items-center gap-1.5 rounded-full bg-pressbox-tile border border-white/10 px-2.5 py-1.5 font-plex font-semibold text-[10px] tracking-[0.06em] uppercase text-pressbox-text/70"
                  >
                    <Icon className="w-3 h-3 text-pressbox-orange-soft" strokeWidth={2} />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-4 mb-2 text-center font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40">
              Stormy can make mistakes · check the stats that matter
            </p>
          </div>

          {/* The composer takes the chat bar's slot: the bar stands down on
              this route (it would open a second Stormy over the first). */}
          <form
            className="flex-none h-[60px] bg-pressbox-surface border-t border-white/[0.08] flex items-center gap-2 px-3"
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="Ask Stormy…"
              disabled={isLoading}
              aria-label="Message Stormy"
              className="focus-citrus flex-1 h-10 min-w-0 rounded-[10px] bg-pressbox-tile border border-white/[0.08] px-3 font-barlow text-[14px] text-pressbox-text placeholder:text-pressbox-text/40 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              className="focus-citrus w-10 h-10 flex-none rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink flex items-center justify-center disabled:opacity-40"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pt-4 pb-6" data-testid="stormy-about">
          <div className="flex items-center gap-3">
            <img src={STORMY_AVATAR} alt="" className="w-12 h-12 flex-none rounded-full object-cover" />
            <div className="min-w-0">
              <p className="font-condensed font-extrabold text-[22px] uppercase tracking-[0.02em] leading-none">Stormy</p>
              <p className="mt-1 font-plex font-medium text-[9px] tracking-[0.12em] uppercase text-pressbox-text/45">Powered by Claude</p>
            </div>
          </div>

          <PressBoxSettingGroup className="mt-5" label="WHAT I SEE">
            <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3.5 py-3">
              <p className="font-barlow text-[13px] leading-[1.45] text-pressbox-text/85">{seesLine}</p>
            </div>
          </PressBoxSettingGroup>

          <PressBoxSettingGroup className="mt-4" label="HOW TO ASK">
            <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3.5 py-3 space-y-1.5">
              {[
                'Be specific: "Should I bench Makar on a back-to-back?"',
                'Name the league situation if it matters',
                'Ask follow-ups; the thread keeps its context',
              ].map((line) => (
                <p key={line} className="flex gap-2 font-barlow text-[13px] leading-[1.45] text-pressbox-text/85">
                  <span className="text-pressbox-orange-soft" aria-hidden="true">▸</span>
                  {line}
                </p>
              ))}
            </div>
          </PressBoxSettingGroup>

          <PressBoxSettingGroup className="mt-4" label="ALLOWANCE">
            <PressBoxSettingRow label="Questions" help="A rolling seven days" value={`${weeklyLimit} a week`} last />
          </PressBoxSettingGroup>

          <PressBoxSettingGroup className="mt-4" label="TRANSCRIPT">
            {confirmClear ? (
              <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3.5 py-3">
                <p className="font-barlow text-[13px] text-pressbox-text/85">Clear this conversation on this device?</p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClearHistory();
                      setConfirmClear(false);
                      setPane('chat');
                    }}
                    className="focus-citrus flex-1 h-10 rounded-[10px] bg-pressbox-grapefruit/[0.18] border border-pressbox-grapefruit/40 font-condensed font-bold text-[14px] uppercase tracking-[0.06em] text-pressbox-grapefruit-text"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="focus-citrus flex-1 h-10 rounded-[10px] border border-white/[0.12] font-condensed font-bold text-[14px] uppercase tracking-[0.06em] text-pressbox-text/80"
                  >
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <PressBoxSettingRow
                label="Clear chat history"
                help="Stored on this device only"
                value="Clear"
                onPress={() => setConfirmClear(true)}
                last
              />
            )}
          </PressBoxSettingGroup>
        </div>
      )}
    </div>
  );
}

export default StormyPhone;
