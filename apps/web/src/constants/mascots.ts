/**
 * The Citrus Squad — 3D mascot character library.
 *
 * Four hockey-positioned characters that anchor Citrus's brand identity.
 * Use these consistently across the app: Stormy chat avatar, draft-room mascots,
 * league-chat reactions, empty-state illustrations, marketing surfaces.
 *
 * To add new poses or variants, see /docs/mascot-prompts.md for the original
 * Nano Banana prompts so style stays consistent.
 */

export type MascotId = 'stormy' | 'lemon' | 'kiwi' | 'pineapple';

export type MascotPosition = 'Assistant GM' | 'Center' | 'Defenceman' | 'Goaltender';

export interface Mascot {
  id: MascotId;
  name: string;
  position: MascotPosition;
  /** Jersey number, blank for Stormy who's a coach */
  number?: string;
  /** One-line personality blurb */
  tagline: string;
  /** Longer descriptor for feature pages */
  description: string;
  /** Path to the primary 3D portrait (relative to /public) */
  image: string;
}

export const MASCOTS: Record<MascotId, Mascot> = {
  stormy: {
    id: 'stormy',
    name: 'Stormy',
    position: 'Assistant GM',
    tagline: "The narwhal who reads xGF%. Trained on every shift.",
    description:
      "Stormy is the AI assistant GM behind Citrus. Plugged into your roster, scoring, and matchup, she answers in real hockey advanced stats, not boilerplate. Her horn doubles as a hockey stick.",
    image: '/mascots/mascot-stormy.webp',
  },
  lemon: {
    id: 'lemon',
    name: 'Lemon',
    position: 'Center',
    number: '9',
    tagline: 'Top-line center. Always finds the puck on his stick.',
    description:
      "Lemon plays first-line minutes and runs the PP1. Wins faceoffs, finds his wingers, and rips wristers. Sour on the surface, sweet in the slot.",
    image: '/mascots/mascot-lemon.webp',
  },
  kiwi: {
    id: 'kiwi',
    name: 'Kiwi',
    position: 'Defenceman',
    number: '44',
    tagline: 'The analytics-pilled blueliner. Bayesian shrinkage believer.',
    description:
      "Kiwi runs the back end. Quietly dominant, never out of position, knows your zone-entry rates better than you do. Wears reading glasses on the bench.",
    image: '/mascots/mascot-kiwi.webp',
  },
  pineapple: {
    id: 'pineapple',
    name: 'Pineapple',
    position: 'Goaltender',
    tagline: 'Tall, spiky, hard to score on. Captain of the crease.',
    description:
      "Pineapple stands on his head most nights. Big paddle, bigger glove, leaf-crown peeking over the bar. Goalies are weird. He's our weird.",
    image: '/mascots/mascot-pineapple.webp',
  },
};

export const MASCOT_LIST: Mascot[] = [
  MASCOTS.stormy,
  MASCOTS.lemon,
  MASCOTS.kiwi,
  MASCOTS.pineapple,
];
