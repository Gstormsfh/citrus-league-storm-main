# Green & Cream App-Wide Redesign

## Overview
Transform the entire app to use green and cream as primary colors, with orange only as highlights for special emphasis. Minimize black, charcoal, and other colors. Create a fresh, clean, citrus-focused aesthetic.

## Color Philosophy
- **Primary**: Green (citrus-sage and variations)
- **Secondary**: Cream (citrus-cream)
- **Accent/Highlight**: Orange (citrus-orange) - used sparingly
- **Minimize**: Black, charcoal, peach, heavy dark colors

## Phase 1: Update Color System Foundation

### 1.1 Tailwind Config Updates
**File:** `tailwind.config.ts`
- Keep citrus color palette but adjust usage philosophy
- Update default background to green-tinted cream
- Consider adding new green shades: `citrus-green-light`, `citrus-green-medium`, `citrus-green-dark`
- Ensure `citrus-sage` (#789561) is prominent

### 1.2 Global CSS Updates  
**File:** `src/index.css`
- Update CSS variables for backgrounds to favor green/cream
- Adjust `--background` to green-tinted cream
- Update `--foreground` to use green instead of forest (dark green instead of black)
- Update `--primary` to emphasize green
- Adjust `--muted` to use lighter green

## Phase 2: Marketing Components (Homepage)

### 2.1 HeroSection
**File:** `src/components/HeroSection.tsx`
- Background: Strong green gradient (e.g., `from-[#A5D6A7] via-[#C8E6C9] to-citrus-cream`)
- Keep orange only for: CTA buttons, small accent elements, pulsing badge
- Text: Use green for headers instead of forest/black
- Cards: Cream backgrounds with green borders

### 2.2 FeaturesSection  
**File:** `src/components/FeaturesSection.tsx`
- Background: Green-to-cream gradient
- Feature cards: Cream with green borders/icons
- Icons: Green backgrounds, not orange
- Remove "Learn more" hover indicators (lines 160-165)
- Change orange icon backgrounds to green

### 2.3 CtaSection
**File:** `src/components/CtaSection.tsx`
- Background: Rich green gradient (keep current but enhance)
- Primary button: Keep cream with orange text (this is a good use of orange highlight)
- Secondary button: Green with cream text
- Badge: Green/cream, orange only for icon

### 2.4 StormySection
**File:** `src/components/StormySection.tsx`
- Background: Green-to-cream gradient (replace `citrus-green-light`/`citrus-yellow-light`)
- Chat interface: Cream background, green accents
- Remove yellow/peach tints

### 2.5 Footer
**File:** `src/components/Footer.tsx`
- Background: Cream with subtle green tint
- Links: Green hover states (not orange)
- Buttons: Green primary
- Social icons: Green backgrounds

## Phase 3: Navigation & Global UI

### 3.1 Navbar
**File:** `src/components/Navbar.tsx`
- Background: Cream with green accents
- Logo: Green/cream (minimize orange)
- Links: Green hover states
- Active states: Green backgrounds

### 3.2 Button Variants
**File:** `src/components/ui/button.tsx`
- Update "varsity" variant: Green primary with cream text
- Update "patch" variant: Cream with green borders
- Update "outline" variant: Green borders on cream
- Keep orange only for special "highlight" or "danger" states

## Phase 4: App Pages (Dashboard, Roster, etc.)

### 4.1 Background Updates for All Pages
**Files:** All files in `src/pages/`
- Replace `bg-background` with green-tinted backgrounds
- Replace `bg-citrus-cream` with slightly green-tinted cream
- Use gradients: `from-[#E8F5E3] to-citrus-cream` or `from-citrus-sage/10 to-citrus-cream`

### 4.2 GM Office
**File:** `src/pages/GMOffice.tsx`
- Background: Green-tinted cream gradient
- Sidebar: Green accents
- Cards: Cream with green borders
- Headlines: Green, not orange (unless urgent)

### 4.3 Draft Room
**File:** `src/pages/DraftRoom.tsx`
- Background: Green gradient
- Player cards: Cream backgrounds
- Borders: Green
- Minimize orange except for "on the clock" indicators

### 4.4 Roster Management
**Files:** `src/pages/Roster.tsx`, `src/pages/FreeAgents.tsx`, `src/pages/WaiverWire.tsx`
- Backgrounds: Green-cream gradients
- Player cards: Cream with green accents
- Status indicators: Green for active, orange only for alerts
- Table headers: Green backgrounds

### 4.5 Matchup & Standings
**Files:** `src/pages/Matchup.tsx`, `src/pages/Standings.tsx`
- Backgrounds: Green gradients
- Team cards: Cream with green borders
- Score displays: Green primary, orange for highlights
- Charts/graphs: Green primary colors

### 4.6 Team Analytics
**File:** `src/pages/TeamAnalytics.tsx`
- Background: Green gradient
- Cards: Cream backgrounds
- Charts: Green color schemes
- Minimize orange usage

### 4.7 Settings & Profile
**Files:** `src/pages/Settings.tsx`, `src/pages/ProfileSetup.tsx`
- Backgrounds: Cream with green tints
- Form elements: Cream with green borders
- Buttons: Green primary

### 4.8 Auth Pages
**Files:** `src/pages/Auth.tsx`, `src/pages/AuthCallback.tsx`, `src/pages/VerifyEmail.tsx`, `src/pages/ResetPassword.tsx`
- Backgrounds: Green-cream gradients
- Forms: Cream with green accents
- Buttons: Green primary, orange highlights

### 4.9 Static Pages
**Files:** `src/pages/About.tsx`, `src/pages/Features.tsx`, `src/pages/Pricing.tsx`, `src/pages/Terms.tsx`, `src/pages/Privacy.tsx`
- Backgrounds: Green-cream gradients
- Headers: Green
- Cards: Cream with green borders

## Phase 5: Component Library Updates

### 5.1 Card Components
**Files:** Various card components
- Default background: Cream
- Borders: Green (not charcoal/black)
- Headers: Green text
- Hover states: Subtle green glow

### 5.2 GM Office Components
**Files:** `src/components/gm-office/*.tsx`
- Headlines banner: Green backgrounds (not orange)
- Intelligence cards: Cream with green accents
- Team intel: Green color scheme

### 5.3 Draft Components  
**Files:** `src/components/draft/*.tsx`
- Player cards: Cream backgrounds
- Borders: Green
- Status indicators: Green, orange only for "on clock"

## Phase 6: Icon & Badge Updates

### 6.1 Status Badges
- Active/Live: Green (not orange)
- Alerts/Urgent: Orange (only for true alerts)
- Neutral: Cream with green borders

### 6.2 Logo & Branding
- Emphasize green in logo gradients
- Minimize orange in non-CTA contexts

## Implementation Strategy

### Priority Order
1. **High Priority**: Marketing (Hero, Features, CTA, Footer) + Navbar
2. **Medium Priority**: Main app pages (Dashboard, Roster, Matchup, Standings)
3. **Lower Priority**: Settings, static pages, admin tools

### Color Replacement Rules
- `bg-citrus-orange` → `bg-citrus-sage` (except for highlights)
- `text-citrus-orange` → `text-citrus-forest` or `text-citrus-sage`
- `border-citrus-orange` → `border-citrus-sage`
- `bg-citrus-charcoal` → `bg-citrus-forest` or `bg-citrus-sage`
- `bg-citrus-peach` → `bg-citrus-cream` or `bg-citrus-sage/10`
- Heavy dark colors → Green tints

### Orange Usage (Reserved For)
- Primary CTA buttons (text color on cream background)
- Critical alerts/notifications
- "On the clock" indicators in draft
- Special badges (e.g., "New", "Hot")
- Small accent icons
- Link hover states (optional)

### Testing Checklist
- Verify text contrast/readability
- Check button states (hover, active, disabled)
- Ensure green doesn't overwhelm
- Orange highlights actually "pop"
- Cream provides good canvas

## Estimated Files to Update
- 6 marketing components
- 1 navbar
- 2 button components
- 28 page components
- 15+ small components
- 2 config files

Total: ~50+ files

## Visual Guidelines
- Green should feel fresh and natural (not neon or overwhelming)
- Cream should be warm and inviting (not stark white)
- Orange should make you look (used strategically for important actions)
- Overall feel: Clean, fresh, citrus-inspired, modern yet vintage