/**
 * TWO RED THINGS THAT ARE NOT THE SAME THING (2026-09-02).
 *
 * The app had one red vocabulary and used it for two opposite meanings:
 *
 *   ERROR       something went wrong. It has already happened, you did not
 *               choose it, and the app is telling you about it.
 *               "Couldn't load the player list." "Drop Didn't Take."
 *
 *   CONFIRM     nothing has happened. You asked for something permanent and
 *               the app is asking you to confirm it. It is a QUESTION, and
 *               the answer might be no.
 *               "This will permanently delete the bracket."
 *
 * Painted identically, the second reads as the first. A manager who opens
 * "Reset Bracket" and is met with a red panel and a warning triangle has
 * been told, in the only language the interface has, that their bracket is
 * already gone. Six surfaces did this: the bracket reset, the lobby's
 * Remove Team dialog, both Delete Draft dialogs and the generic draft-room
 * confirm, and the account-deletion dialog, whose panel was red-on-red
 * before the user had typed a character.
 *
 * THE RULE, and it is one sentence:
 *
 *   RED BELONGS TO THE BUTTON YOU ARE ABOUT TO PRESS, NOT TO THE PANEL
 *   THAT ASKS.
 *
 * That is also where the platforms put it. Apple's HIG destructive alert is
 * a plain sheet with one red button; Material 3's dialog is a neutral
 * surface whose confirming action may take the error colour; GitHub's
 * delete-repository modal is white with a red button inside a red-outlined
 * region. In every one of them the red marks the ACTION, and the surface
 * stays calm, because the surface is a question.
 *
 * So this module owns the CONFIRMATION treatment and nothing else. The
 * error treatment is unchanged and stays where it is: `<Alert
 * variant="destructive">`, `text-destructive`, `fantasy-grapefruit-red`,
 * `role="alert"`, and the `kind: 'error'` toast in `notificationKind.ts`.
 * Two treatments, two meanings, and a guard
 * (`__tests__/destructiveConfirmGuard.test.ts`) that keeps each on its own
 * side.
 *
 * WHY CAUTION IS ORANGE HERE. `notificationKind.ts` already divides this
 * palette the same way and measured it on the same #1A2A20 tile: `attention`
 * is `pastel-orange` (#FF6B1A, 5.30:1) and `bad` is `fantasy-grapefruit-red`
 * (#FF6F80, 5.66:1). A pending destructive action is attention, not bad
 * — nothing is broken yet. Reusing that split means the app has one
 * colour-to-meaning map rather than two, and the pill, the toast icon and
 * this panel all agree about what orange means.
 *
 * A `.ts` module rather than exports from the component beside it, for the
 * reason `notificationKind.ts`, `positionChip.ts` and `phoneRowScale.ts`
 * already give: a file that exports both a component and plain values
 * breaks react-refresh.
 *
 * SIZE, SHAPE AND COLOUR ONLY. No copy. What a given action will destroy is
 * the call site's to say, and it should say it in plain words at the call
 * site where a reviewer can read it next to the handler that does it.
 */

/**
 * The panel that states what is about to happen, above the buttons.
 *
 * Tinted, ringed, and NOT red: it is the same orange the notification
 * system uses for "attention". Deliberately quieter than
 * `bg-destructive/15 border-destructive/40`, which is what the error banner
 * wears.
 */
export const CONFIRM_PANEL =
  'flex items-start gap-2.5 rounded-lg bg-pastel-orange/10 ring-1 ring-pastel-orange/30 px-3 py-2.5';

/**
 * The leading glyph. `TriangleAlert` (caution), never `CircleAlert` — the
 * circle is the error icon in `notificationKind.KIND_ICON` and reusing it
 * here would put the failure mark on a question.
 */
export const CONFIRM_ICON = 'h-4 w-4 shrink-0 mt-0.5 text-pastel-orange';

/**
 * The consequence sentence. Cream at 70% rather than a colour: the panel's
 * tint already carries the tone, and coloured body copy on a tinted panel
 * is how "this is serious" turns into "this is broken".
 */
export const CONFIRM_TEXT = 'text-sm leading-relaxed text-white/70';

/**
 * A destructive dialog's TITLE. Cream, like every other dialog title in the
 * app.
 *
 * This is the smallest change in the file and the one that mattered most:
 * `DialogTitle className="text-destructive"` over "Remove Team" is the app
 * announcing a failure in the first line the user reads.
 */
export const CONFIRM_TITLE = 'flex items-center gap-2 text-pastel-cream';

/**
 * The ring on a destructive dialog's own surface, where one is wanted.
 * Caution, not error. Optional: most confirmations need no ring at all, and
 * `AlertDialogContent`'s default border is fine.
 */
export const CONFIRM_SURFACE_RING = 'ring-1 ring-pastel-orange/30';

/**
 * The confirming BUTTON, which is the one thing here that is red.
 *
 * Spelled out as a constant so the doctrine is visible from the module that
 * states it, and so the guard can check that a confirmation which drops the
 * red panel has not also dropped the red button. `bg-destructive` is the
 * same token `<Button variant="destructive">` uses; call sites that can use
 * the variant should use the variant.
 */
export const CONFIRM_ACTION_BUTTON =
  'bg-destructive text-destructive-foreground hover:bg-destructive/90';
