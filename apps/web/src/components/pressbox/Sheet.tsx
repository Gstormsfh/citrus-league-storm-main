/**
 * THE PRESS BOX SHEET (2026-09-04).
 *
 * Two shapes, one primitive. `full` is a screen: it covers the viewport
 * from the status bar down and slides in from the right, the way a pushed
 * screen does on the phone, because the header it carries starts with `‹`
 * and a back chevron on something that faded in over the page is a lie
 * about where you are. `bottom` is a picker: it rises from the foot of the
 * screen, sits on a scrim, and closes on the scrim, a swipe of the escape
 * key, or a choice.
 *
 * Radix underneath for the parts a hand-rolled overlay gets wrong — focus
 * moves into the sheet and back out, the page behind stops scrolling, the
 * escape key closes it — but not the shadcn DialogContent wrapper, whose
 * centred-modal transform and animation classes fight every other position.
 * The sheet composes `DialogPrimitive.Content` directly with only the
 * classes each shape needs.
 *
 * `z-sheet`, from the scale in `styles/zLayers.ts` — "the modal sheets",
 * above `overlay` (100) so a sheet opened from the league menu lands on top
 * of it; `zLayerScaleGuard` fails any fixed element on a name the scale
 * does not define.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read by screen readers; the sheet draws its own visible header. */
  title: string;
  shape?: 'full' | 'bottom';
  children: React.ReactNode;
  className?: string;
}

export function PressBoxSheet({ open, onOpenChange, title, shape = 'full', children, className }: PressBoxSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-sheet bg-black/60',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            PB_TYPE,
            'fixed z-sheet flex flex-col bg-pressbox-surface text-pressbox-text outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out duration-200',
            shape === 'full'
              ? cn(
                  'inset-0 pt-[env(safe-area-inset-top)]',
                  'data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full',
                )
              : cn(
                  'inset-x-0 bottom-0 max-h-[85vh] rounded-t-[16px] border-t border-white/[0.08]',
                  'pb-[max(env(safe-area-inset-bottom),16px)]',
                  'data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full',
                ),
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default PressBoxSheet;
