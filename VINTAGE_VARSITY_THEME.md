# 🏈 Vintage Varsity Theme - CitrusSports

## Overview

The CitrusSports application has been transformed into a nostalgic "Vintage Varsity" themed interface that combines tactile 90s sports textures with a relaxed surfer pastel palette. This creates an interface that feels like a premium physical object rather than a digital screen.

## 🎨 Color Palette

### Core Citrus Colors

The new theme enforces a **NO PURE WHITE/BLACK** rule, using warm, muted tones instead:

```css
citrus-cream: #FFFDF2    /* Warm cotton base - replaces white */
citrus-sage: #AAD1A3     /* Pipi & Apple Green - primary actions */
citrus-peach: #EFCCC6    /* Cream & Romantic Coral - secondary */
citrus-orange: #DF7536   /* Miami Varsity Orange - accents */
citrus-charcoal: #333333 /* Warm soft dark - replaces black */
citrus-forest: #1B3022   /* Deep green text anchor */
```

### Usage Examples

```tsx
// Background colors
<div className="bg-citrus-cream">  // Main backgrounds
<div className="bg-citrus-sage">   // Primary surfaces
<div className="bg-citrus-peach">  // Secondary surfaces

// Text colors
<p className="text-citrus-forest">    // Body text
<p className="text-citrus-charcoal">  // Muted text
<p className="text-citrus-orange">    // Accent text
```

## 🔤 Typography System

### Font Families

Four distinct font stacks create the vintage aesthetic:

1. **Varsity** (`font-varsity`) - Graduate, Alfa Slab One
   - Use for: Main headings (H1, H2), hero sections
   - Character: Bold block lettering from 90s jackets

2. **Script** (`font-script`) - Pacifico, Bangers
   - Use for: Subheadings, decorative elements
   - Character: Surfer script, "Slow Morning Club" vibe

3. **Display** (`font-display`) - Montserrat
   - Use for: H3, H4, buttons, labels
   - Character: Clean, modern readability

4. **Sans** (`font-sans`) - Inter, Montserrat
   - Use for: Body text, paragraphs
   - Character: High readability for stats

### Typography Hierarchy

```tsx
// Varsity headers (uppercase, bold, block lettering)
<h1 className="font-varsity text-4xl uppercase">Champions League</h1>
<h2 className="font-varsity text-2xl uppercase">Team Roster</h2>

// Script accents (decorative, sparingly used)
<span className="font-script text-lg">Fresh Take</span>

// Display text (secondary headers, buttons)
<h3 className="font-display font-bold text-xl">Player Stats</h3>

// Body text (default, readable)
<p className="font-sans text-base">Season statistics and analysis...</p>
```

## 🎯 Component System

### Button Variants

#### Standard Button (Default)
Soft sage background with subtle border:
```tsx
<Button>Click Me</Button>
<Button variant="default">Primary Action</Button>
```

#### Varsity Patch Button
Thick borders with embroidery styling:
```tsx
<Button variant="varsity">Join League</Button>
// Features: 4px border, rounded-varsity, shadow-patch, tactile press
```

#### Orange Patch Button
Bold varsity orange with high contrast:
```tsx
<Button variant="patch">Start Draft</Button>
// Features: Orange background, cream text, charcoal border
```

#### Other Variants
```tsx
<Button variant="outline">Outlined</Button>
<Button variant="secondary">Secondary Action</Button>
<Button variant="ghost">Ghost Button</Button>
<Button variant="link">Text Link</Button>
```

### Card Components

Cards now have a "Letterman" feel with thick borders and soft shadows:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Player Card</CardTitle>
    <CardDescription>Season statistics</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Your content */}
  </CardContent>
  <CardFooter>
    {/* Footer actions */}
  </CardFooter>
</Card>
```

Features:
- 2px sage borders with subtle transparency
- Cream backgrounds (no pure white)
- Hover: Lifts up with enhanced shadow
- Rounded corners (2xl = 1rem)

### Badge Components

Badges feature bold, uppercase styling with thick borders:

```tsx
<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="varsity">Varsity</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="destructive">Alert</Badge>
```

Features:
- 2px borders with rounded-full shape
- Bold, uppercase, tracked text
- Tactile shadow effects
- No pure white/black colors

## 🎪 Utility Classes

### Pre-built Vintage Components

#### Patch Buttons
```tsx
<button className="btn-varsity-patch">
  Citrus Patch
</button>

<button className="btn-varsity-patch-orange">
  Orange Patch
</button>

<button className="btn-varsity-patch-peach">
  Peach Patch
</button>
```

#### Letterman Cards
```tsx
<div className="card-letterman">
  Standard letterman card with hover lift
</div>

<div className="card-letterman-thick">
  Extra thick borders (4px) for emphasis
</div>
```

### Border Radius Tokens
```tsx
rounded-varsity     // 2rem - aggressive rounding for "patch" look
rounded-2xl         // 1rem - card corners
rounded-xl          // 0.75rem - moderate rounding
```

### Shadow Tokens
```tsx
shadow-patch       // Soft tactile lift: 0 4px 0 0
shadow-varsity     // Enhanced depth with dual shadows
```

## 🎨 Migration Guide

### Replacing Old Styles

#### Before (Pure White/Black)
```tsx
<div className="bg-white text-black border-gray-200">
  <h1 className="font-bold">Title</h1>
  <button className="bg-blue-500 text-white">Click</button>
</div>
```

#### After (Vintage Varsity)
```tsx
<div className="bg-citrus-cream text-citrus-forest border-citrus-sage">
  <h1 className="font-varsity uppercase">Title</h1>
  <button className="btn-varsity-patch">Click</button>
</div>
```

### Typography Updates

#### Before
```tsx
<h1 className="text-3xl font-bold">Heading</h1>
<p className="text-gray-600">Description</p>
```

#### After
```tsx
<h1 className="font-varsity text-3xl uppercase text-citrus-forest">Heading</h1>
<p className="font-sans text-citrus-charcoal">Description</p>
```

### Button Updates

#### Before
```tsx
<button className="px-4 py-2 bg-blue-500 text-white rounded">
  Action
</button>
```

#### After
```tsx
<Button variant="varsity">Action</Button>
// Or for custom styling:
<button className="btn-varsity-patch">Action</button>
```

## 🎯 Design Principles

### 1. No Pure White or Black
- **Background**: Use `bg-citrus-cream` (#FFFDF2) instead of white
- **Text**: Use `text-citrus-forest` (#1B3022) instead of black
- **Borders**: Use `border-citrus-sage` with transparency

### 2. Tactile Depth
- All interactive elements should have borders (2px minimum)
- Use `shadow-patch` for subtle lift effect
- Active states should translate Y (press down effect)

### 3. Rounded Corners
- Cards: `rounded-2xl` (1rem)
- Buttons: `rounded-2xl` or `rounded-varsity` (2rem)
- Badges: `rounded-full`

### 4. Typography Weight
- Varsity headers should be **bold and uppercase**
- Body text uses medium weight (500-600) for cream backgrounds
- Never use font weights below 400

### 5. Hover Interactions
- Cards: Lift up (`-translate-y-1`) with enhanced shadow
- Buttons: Press down (`translate-y-0.5`) with shadow reduction
- Links: Color shift to orange with underline

## 🚀 Quick Start Examples

### Hero Section
```tsx
<section className="bg-citrus-cream py-20">
  <div className="container mx-auto">
    <h1 className="font-varsity text-6xl uppercase text-citrus-forest mb-4">
      Fresh Fantasy
    </h1>
    <p className="font-script text-2xl text-citrus-orange mb-8">
      A Citrus Sports Experience
    </p>
    <Button variant="varsity" size="lg">
      Join Now
    </Button>
  </div>
</section>
```

### Stats Card
```tsx
<Card className="hover:shadow-varsity">
  <CardHeader>
    <CardTitle className="font-varsity uppercase">
      Season Stats
    </CardTitle>
    <CardDescription>2024-2025 Regular Season</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="grid grid-cols-3 gap-4">
      <div>
        <p className="font-display font-bold text-3xl text-citrus-orange">127</p>
        <p className="text-sm text-citrus-charcoal">Points</p>
      </div>
      {/* More stats */}
    </div>
  </CardContent>
  <CardFooter>
    <Button variant="outline" size="sm">View Details</Button>
  </CardFooter>
</Card>
```

### Action Bar
```tsx
<div className="flex gap-3 items-center">
  <Button variant="varsity">
    Draft Players
  </Button>
  <Button variant="patch">
    Start Game
  </Button>
  <Button variant="outline">
    View Rules
  </Button>
  <Badge variant="varsity">Live</Badge>
</div>
```

## 📦 What Changed

### Files Modified

1. **tailwind.config.ts**
   - Added `citrus` color palette
   - Added `font-varsity` and `font-script` font families
   - Added `rounded-varsity` border radius
   - Added `shadow-patch` and `shadow-varsity` shadows

2. **src/index.css**
   - Updated CSS variables to use warm tones (no white/black)
   - Added vintage varsity component classes
   - Updated base typography hierarchy
   - Added Google Fonts import

3. **src/components/ui/button.tsx**
   - Added `varsity` and `patch` button variants
   - Updated all variants with vintage styling
   - Changed to `rounded-2xl` default
   - Added tactile press animations

4. **src/components/ui/card.tsx**
   - Updated Card with 2px sage borders
   - Added hover lift effect
   - Updated CardTitle with bold display font
   - Changed to `rounded-2xl`

5. **src/components/ui/badge.tsx**
   - Added `varsity` badge variant
   - Updated all variants with 2px borders
   - Made text bold, uppercase, tracked
   - Added shadow effects

## 🎨 Color Reference Card

```
╔══════════════════════════════════════════════╗
║  VINTAGE VARSITY CITRUS PALETTE              ║
╠══════════════════════════════════════════════╣
║  🌾 Cream   │ #FFFDF2 │ Backgrounds          ║
║  🌿 Sage    │ #AAD1A3 │ Primary Actions      ║
║  🍑 Peach   │ #EFCCC6 │ Secondary Surfaces   ║
║  🍊 Orange  │ #DF7536 │ Varsity Accents      ║
║  ⚫ Charcoal│ #333333 │ Muted Text           ║
║  🌲 Forest  │ #1B3022 │ Body Text            ║
╚══════════════════════════════════════════════╝
```

## 🏆 Best Practices

1. **Always use citrus colors** - Never use pure `#FFFFFF` or `#000000`
2. **Minimum 2px borders** on interactive elements for tactile feel
3. **Use varsity font sparingly** - Headers only, not body text
4. **Rounded corners everywhere** - Minimum `rounded-xl` (0.75rem)
5. **Add press animations** to buttons with `translate-y`
6. **Layer shadows** for depth using `shadow-patch` or `shadow-varsity`

---

**Made with 🍊 by the CitrusSports Team**

