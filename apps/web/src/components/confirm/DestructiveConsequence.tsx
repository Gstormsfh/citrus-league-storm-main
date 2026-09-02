import { TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { CONFIRM_ICON, CONFIRM_PANEL, CONFIRM_TEXT } from './destructiveConfirm';

/**
 * The one panel every destructive confirmation states its consequence in.
 *
 * The doctrine, the colour choice and the measurements are in
 * `destructiveConfirm.ts`; the short version is that this is a QUESTION and
 * must not be painted like a failure. Red stays on the confirming button.
 *
 * Deliberately NOT `<Alert variant="destructive">`, which is what four of
 * these surfaces used: that component is the error treatment, it is what
 * `ConnectionBanner` and the player-pool load failure wear, and a
 * confirmation borrowing it is the whole defect.
 *
 * NO `role="alert"`. An alert is announced the instant it appears,
 * interrupting whatever the screen reader was saying, which is right for a
 * failure and wrong for a sentence inside a dialog the user just opened and
 * is about to read anyway. Radix already moves focus into the dialog and
 * announces its title and description; this panel is part of that content.
 *
 * A `<div>`, so it must be a SIBLING of `AlertDialogDescription` rather than
 * a child: Radix renders that as a `<p>`, and a div inside a p is invalid
 * markup the browser silently reparents.
 *
 * Where the panel IS the whole description, pass it through Radix's
 * `asChild` instead of adding a second one — the primitive then renders THIS
 * element as the description and wires `aria-describedby` to it. That is why
 * the props are spread onto the root: `asChild` hands the child an `id`.
 */
export function DestructiveConsequence({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(CONFIRM_PANEL, className)}
      data-destructive-confirm="consequence"
    >
      <TriangleAlert className={CONFIRM_ICON} aria-hidden="true" />
      <div className={CONFIRM_TEXT}>{children}</div>
    </div>
  );
}

export default DestructiveConsequence;
