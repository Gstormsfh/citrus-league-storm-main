/**
 * Custom hockey-specific SVG iconography for citrus2.
 *
 * These replace generic lucide icons (Trophy, Activity, Sparkles, etc.) in
 * cards and feature blocks where we want unmistakable hockey identity.
 * Each icon takes `className` for sizing and inherits color via currentColor.
 *
 * Style: 24×24 viewBox, 1.75-2px stroke, rounded caps, sport-coded shapes.
 * License-clean: no NHL marks, no team identifiers — just generic hockey
 * objects.
 */

interface IconProps {
  className?: string;
  strokeWidth?: number;
}

/** Hockey puck — top-down view with edge ridges */
export function PuckIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="13" rx="9" ry="3" />
      <path d="M3 13v3a9 3 0 0 0 18 0v-3" />
      <ellipse cx="12" cy="11" rx="9" ry="3" opacity="0.4" />
    </svg>
  );
}

/** Single hockey stick — angled, ready position */
export function StickIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="4" y1="3" x2="17" y2="16" />
      <path d="M17 16 L21 17 L21 20 L15 20 Z" fill="currentColor" fillOpacity="0.25" />
    </svg>
  );
}

/** Crossed hockey sticks — classic crest mark */
export function CrossedSticksIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="4" y1="20" x2="17" y2="4" />
      <path d="M17 4 L20 4 L20 7 L17 7 Z" fill="currentColor" fillOpacity="0.25" />
      <line x1="20" y1="20" x2="7" y2="4" />
      <path d="M7 4 L4 4 L4 7 L7 7 Z" fill="currentColor" fillOpacity="0.25" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Hockey net / goal — front view */
export function NetIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Posts and crossbar */}
      <path d="M5 20 L5 6 L19 6 L19 20" />
      {/* Mesh diagonals */}
      <line x1="5" y1="6" x2="19" y2="13" opacity="0.4" />
      <line x1="5" y1="9" x2="19" y2="16" opacity="0.4" />
      <line x1="5" y1="12" x2="19" y2="19" opacity="0.4" />
      <line x1="5" y1="15" x2="19" y2="20" opacity="0.4" />
      <line x1="19" y1="6" x2="5" y2="13" opacity="0.4" />
      <line x1="19" y1="9" x2="5" y2="16" opacity="0.4" />
      <line x1="19" y1="12" x2="5" y2="19" opacity="0.4" />
      {/* Goal line */}
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  );
}

/** Stanley Cup silhouette — distinctive shape */
export function CupIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Bowl */}
      <path d="M7 3 L17 3 L17 7 Q17 10 12 10 Q7 10 7 7 Z" fill="currentColor" fillOpacity="0.15" />
      {/* Stem */}
      <line x1="12" y1="10" x2="12" y2="14" />
      {/* Tiered base */}
      <rect x="9" y="14" width="6" height="2" fill="currentColor" fillOpacity="0.15" />
      <rect x="8" y="16" width="8" height="1.5" fill="currentColor" fillOpacity="0.15" />
      <rect x="7" y="17.5" width="10" height="1.5" fill="currentColor" fillOpacity="0.15" />
      <rect x="6" y="19" width="12" height="2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}

/** Faceoff dot circle — center ice or zone */
export function FaceoffIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <line x1="3" y1="9" x2="21" y2="9" opacity="0.5" />
      <line x1="3" y1="15" x2="21" y2="15" opacity="0.5" />
    </svg>
  );
}

/** Hockey helmet / mask — goalie mask shape */
export function MaskIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 9 Q5 4 12 4 Q19 4 19 9 L19 16 Q19 20 12 20 Q5 20 5 16 Z" />
      <line x1="8" y1="11" x2="16" y2="11" opacity="0.5" />
      <line x1="8" y1="14" x2="16" y2="14" opacity="0.5" />
      <line x1="10" y1="8" x2="10" y2="17" opacity="0.5" />
      <line x1="14" y1="8" x2="14" y2="17" opacity="0.5" />
    </svg>
  );
}

/** Scoreboard — boxy display with two slots */
export function ScoreboardIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <text x="7" y="14" fontSize="6" fill="currentColor" fontWeight="bold" textAnchor="middle">3</text>
      <text x="17" y="14" fontSize="6" fill="currentColor" fontWeight="bold" textAnchor="middle">2</text>
      <line x1="12" y1="3" x2="12" y2="6" opacity="0.5" />
      <line x1="9" y1="20" x2="15" y2="20" opacity="0.5" />
    </svg>
  );
}

/** Hockey calendar — week view with puck accent */
export function SlateIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="3" x2="9" y2="7" />
      <line x1="15" y1="3" x2="15" y2="7" />
      {/* Saturday highlighted with puck */}
      <ellipse cx="17.5" cy="15" rx="2" ry="0.7" fill="currentColor" fillOpacity="0.6" />
      <path d="M15.5 15 v1.5 a2 0.7 0 0 0 4 0 v-1.5" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

/** xG model / stat chart — line with dots */
export function XGModelIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 17 L8 11 L13 14 L18 7 L21 9" />
      <circle cx="8" cy="11" r="1.5" fill="currentColor" />
      <circle cx="13" cy="14" r="1.5" fill="currentColor" />
      <circle cx="18" cy="7" r="1.5" fill="currentColor" />
      <line x1="3" y1="20" x2="21" y2="20" opacity="0.5" />
      <line x1="3" y1="3" x2="3" y2="20" opacity="0.5" />
    </svg>
  );
}

/** Live shift / lightning + puck */
export function ShiftIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M13 2 L4 14 L11 14 L9 22 L20 9 L13 9 Z" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}

/** Range bar / Monte Carlo viz — three bars */
export function RangeIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Floor / Median / Ceiling bars */}
      <line x1="3" y1="7" x2="21" y2="7" opacity="0.4" />
      <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth={strokeWidth + 1.5} />
      <circle cx="9" cy="7" r="2" fill="currentColor" />
      <line x1="3" y1="12" x2="21" y2="12" opacity="0.4" />
      <line x1="8" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth={strokeWidth + 1.5} />
      <circle cx="13" cy="12" r="2" fill="currentColor" />
      <line x1="3" y1="17" x2="21" y2="17" opacity="0.4" />
      <line x1="5" y1="17" x2="11" y2="17" stroke="currentColor" strokeWidth={strokeWidth + 1.5} />
      <circle cx="7" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

/** Bracket — playoff structure */
export function BracketIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Round 1 — left */}
      <line x1="3" y1="5" x2="6" y2="5" />
      <line x1="3" y1="9" x2="6" y2="9" />
      <line x1="6" y1="5" x2="6" y2="9" />
      <line x1="6" y1="7" x2="9" y2="7" />
      <line x1="3" y1="15" x2="6" y2="15" />
      <line x1="3" y1="19" x2="6" y2="19" />
      <line x1="6" y1="15" x2="6" y2="19" />
      <line x1="6" y1="17" x2="9" y2="17" />
      {/* Round 2 — left */}
      <line x1="9" y1="7" x2="9" y2="17" />
      <line x1="9" y1="12" x2="12" y2="12" />
      {/* Cup — center */}
      <circle cx="13.5" cy="12" r="1.5" fill="currentColor" />
      {/* Round 2 — right */}
      <line x1="15" y1="12" x2="18" y2="12" />
      <line x1="18" y1="7" x2="18" y2="17" />
      {/* Round 1 — right */}
      <line x1="18" y1="7" x2="21" y2="7" opacity="0.5" />
      <line x1="18" y1="17" x2="21" y2="17" opacity="0.5" />
    </svg>
  );
}

/** Survivor — single skate / lone surviving figure */
export function SurvivorIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Skate boot */}
      <path d="M5 14 L5 17 Q5 19 7 19 L17 19 Q19 19 19 17 L19 16 L11 16 L11 13 L9 13 Q5 13 5 14 Z" fill="currentColor" fillOpacity="0.2" />
      {/* Blade */}
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth={strokeWidth + 0.5} />
      {/* Laces */}
      <line x1="9" y1="14" x2="14" y2="14" opacity="0.6" />
      <line x1="10" y1="16" x2="13" y2="16" opacity="0.4" />
    </svg>
  );
}

/** Pickem — pointing finger / select */
export function PickemIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="6" width="8" height="6" rx="1" />
      <line x1="5" y1="9" x2="9" y2="9" opacity="0.5" />
      <rect x="13" y="6" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.2" />
      <path d="M16 9 L17 10 L19 8" strokeWidth={strokeWidth + 0.5} />
      <rect x="3" y="14" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.2" />
      <path d="M5 17 L6 18 L8 16" strokeWidth={strokeWidth + 0.5} />
      <rect x="13" y="14" width="8" height="6" rx="1" />
      <line x1="15" y1="17" x2="19" y2="17" opacity="0.5" />
    </svg>
  );
}

/** Snake draft — winding S-shape */
export function DraftIcon({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 5 L20 5 Q22 5 22 7 Q22 9 20 9 L6 9 Q4 9 4 11 Q4 13 6 13 L20 13 Q22 13 22 15 Q22 17 20 17 L4 17" />
      <circle cx="20" cy="5" r="1.5" fill="currentColor" />
      <circle cx="4" cy="17" r="1.5" fill="currentColor" />
    </svg>
  );
}
