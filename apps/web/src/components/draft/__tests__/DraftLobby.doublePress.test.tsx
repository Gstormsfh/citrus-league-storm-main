// T7 Entry 8 (2026-08-08 21:55Z) — DraftLobby double-press protection
// render test. Guards the sole button-level gate that prevents a second
// Start-Draft click from firing while the first is still in flight.
//
// Contract locked here:
//   disabled={isStartingDraft || ...existing-conditions} on ALL four
//   Start-Draft-family buttons rendered by DraftLobby:
//     1. hasExistingDraft + commissioner    → "Continue Draft"
//     2. isDraftQueued  + commissioner      → "Start Draft Now" (queued)
//     3. default (new)  + commissioner      → "Start Draft Now" (impromptu)
//     4. hasExistingDraft + !commissioner   → "Join Draft Room"
//
// If a silent refactor drops the isStartingDraft term from the disabled
// prop on any of these buttons, this test fails immediately. The
// double-press protection lives entirely in this one prop — protection
// is invisible in the JSX diff but load-bearing in prod, so the test
// is the durable ledger of that contract.
//
// Positive control at the end: with isStartingDraft=false, the same
// button IS clickable — proves the tests aren't just watching a
// permanently-disabled button.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DraftLobby } from '../DraftLobby';

// Minimal Team shape matching DraftLobby's local interface (line 39-45
// of DraftLobby.tsx). Not exported from DraftLobby, so mirrored here.
type LobbyTeam = {
  id: string;
  name: string;
  owner: string;
  color: string;
  picks: unknown[];
};

const mkTeams = (n: number): LobbyTeam[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `team-${i + 1}`,
    name: `Team ${i + 1}`,
    owner: `Owner ${i + 1}`,
    color: '#000000',
    picks: [],
  }));

// Render helper — DraftLobby uses useNavigate, so MemoryRouter is
// required. useToast is standalone (no provider).
const renderLobby = (props: Partial<React.ComponentProps<typeof DraftLobby>>) =>
  render(
    <MemoryRouter>
      <DraftLobby
        teams={mkTeams(12)}
        onStartDraft={vi.fn()}
        isCommissioner={true}
        {...props}
      />
    </MemoryRouter>,
  );

beforeEach(() => {
  cleanup();
});

describe('DraftLobby — isStartingDraft double-press protection (T7 Entry 8)', () => {
  it('BRANCH 1: hasExistingDraft + commissioner → "Continue Draft" is disabled + click does NOT fire onStartDraft', async () => {
    const onStartDraft = vi.fn();
    renderLobby({
      isCommissioner: true,
      hasExistingDraft: true,
      isStartingDraft: true,
      onStartDraft,
    });

    // Button label switches to "Starting…" while pending — locate by
    // that label to prove the pending affordance also lands.
    const btn = screen.getByRole('button', { name: /starting/i });
    expect(btn).toBeDisabled();

    // Even if user-event tries, the click should not invoke the handler
    // because the button is disabled (RTL's userEvent respects DOM
    // disabled semantics + won't fire click on disabled elements).
    // fireEvent.click dispatches a real click event to the element; the
    // browser + React honor `disabled` and suppress the onClick handler.
    // If a silent refactor drops isStartingDraft from the disabled expr,
    // the button becomes enabled + this fires + onStartDraft is called.
    fireEvent.click(btn);
    expect(onStartDraft).not.toHaveBeenCalled();
  });

  it('BRANCH 2: isDraftQueued + commissioner → "Start Draft Now" (queued) is disabled + click blocked', async () => {
    const onStartDraft = vi.fn();
    renderLobby({
      isCommissioner: true,
      isDraftQueued: true,
      hasExistingDraft: false,
      isStartingDraft: true,
      onStartDraft,
    });

    const btn = screen.getByRole('button', { name: /starting/i });
    expect(btn).toBeDisabled();

    // fireEvent.click dispatches a real click event to the element; the
    // browser + React honor `disabled` and suppress the onClick handler.
    // If a silent refactor drops isStartingDraft from the disabled expr,
    // the button becomes enabled + this fires + onStartDraft is called.
    fireEvent.click(btn);
    expect(onStartDraft).not.toHaveBeenCalled();
  });

  it('BRANCH 3: default + commissioner → "Start Draft Now" (impromptu) is disabled + click blocked', async () => {
    const onStartDraft = vi.fn();
    renderLobby({
      isCommissioner: true,
      isDraftQueued: false,
      hasExistingDraft: false,
      isStartingDraft: true,
      onStartDraft,
      // teams=12 (default), so teams.length < 4 term is FALSE — the
      // ONLY thing disabling this button is isStartingDraft. If the
      // isStartingDraft term were removed from the disabled expression,
      // this test would fail (button enabled, click fires handler).
    });

    const btn = screen.getByRole('button', { name: /starting/i });
    expect(btn).toBeDisabled();

    // fireEvent.click dispatches a real click event to the element; the
    // browser + React honor `disabled` and suppress the onClick handler.
    // If a silent refactor drops isStartingDraft from the disabled expr,
    // the button becomes enabled + this fires + onStartDraft is called.
    fireEvent.click(btn);
    expect(onStartDraft).not.toHaveBeenCalled();
  });

  it('BRANCH 4: hasExistingDraft + non-commissioner → "Join Draft Room" is disabled + click blocked', async () => {
    // Non-commissioner branch. DraftLobby renders the else branch of
    // the isCommissioner ternary (DraftLobby.tsx:1002+), which
    // includes the Join Draft Room card when hasExistingDraft=true.
    const onStartDraft = vi.fn();
    renderLobby({
      isCommissioner: false,
      hasExistingDraft: true,
      isStartingDraft: true,
      onStartDraft,
    });

    // Label switches to "Joining…" for the rejoin branch.
    const btn = screen.getByRole('button', { name: /joining/i });
    expect(btn).toBeDisabled();

    // fireEvent.click dispatches a real click event to the element; the
    // browser + React honor `disabled` and suppress the onClick handler.
    // If a silent refactor drops isStartingDraft from the disabled expr,
    // the button becomes enabled + this fires + onStartDraft is called.
    fireEvent.click(btn);
    expect(onStartDraft).not.toHaveBeenCalled();
  });
});

describe('DraftLobby — positive control (isStartingDraft=false enables click)', () => {
  it('BRANCH 3 without isStartingDraft: click DOES fire onStartDraft (proves the assertion is real)', async () => {
    const onStartDraft = vi.fn();
    renderLobby({
      isCommissioner: true,
      isDraftQueued: false,
      hasExistingDraft: false,
      isStartingDraft: false, // ← the ONLY difference vs BRANCH 3 test
      onStartDraft,
    });

    // Now label is the resting state.
    const btn = screen.getByRole('button', { name: /start draft now/i });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    expect(onStartDraft).toHaveBeenCalledTimes(1);
  });
});
