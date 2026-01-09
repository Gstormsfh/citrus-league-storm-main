# 🏈 Vintage Varsity Quick Start Guide

## 🎨 Color Cheat Sheet

### Use These Instead of White/Black

```tsx
// ❌ AVOID (Pure White/Black)
bg-white text-black border-gray-500

// ✅ USE (Vintage Varsity)
bg-citrus-cream text-citrus-forest border-citrus-sage
```

### Quick Color Reference

| Old Color | New Citrus Color | Tailwind Class |
|-----------|------------------|----------------|
| `bg-white` | Cream | `bg-citrus-cream` |
| `text-black` | Forest | `text-citrus-forest` |
| `text-gray-600` | Charcoal | `text-citrus-charcoal` |
| `bg-green-500` | Sage | `bg-citrus-sage` |
| `bg-orange-500` | Orange | `bg-citrus-orange` |
| `bg-pink-200` | Peach | `bg-citrus-peach` |

## 🔤 Typography Quick Guide

```tsx
// 🏆 Page Titles - Bold Varsity Lettering
<h1 className="font-varsity text-5xl uppercase text-citrus-forest">
  Championship League
</h1>

// 🌊 Accent Subheadings - Surfer Script
<h2 className="font-script text-3xl text-citrus-orange">
  Catch the Wave
</h2>

// 📊 Section Headers - Display Font
<h3 className="font-display font-bold text-2xl text-citrus-forest">
  Player Statistics
</h3>

// 📝 Body Content - Clean Sans
<p className="font-sans text-base text-citrus-forest">
  Regular paragraph text goes here...
</p>

// 🏷️ Labels - Display Font
<label className="font-display font-semibold text-sm text-citrus-charcoal">
  Team Name
</label>
```

## 🎯 Button Quick Reference

```tsx
// 🎪 Varsity Patch - Main Actions
<Button variant="varsity">Join League</Button>

// 🍊 Orange Patch - Primary CTA
<Button variant="patch">Start Draft</Button>

// 🌿 Default Sage - Standard Actions
<Button variant="default">Save Changes</Button>

// 🍑 Secondary Peach - Alternative Actions
<Button variant="secondary">Cancel</Button>

// 👻 Ghost - Tertiary Actions
<Button variant="ghost">More Options</Button>

// 📝 Outline - Low Priority
<Button variant="outline">View Details</Button>

// 🔗 Link - Text Links
<Button variant="link">Learn More</Button>
```

## 🃏 Card Patterns

### Standard Card
```tsx
<Card>
  <CardHeader>
    <CardTitle>Player Profile</CardTitle>
    <CardDescription>Season 2024-2025</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Your content */}
  </CardContent>
  <CardFooter>
    <Button variant="outline">View Stats</Button>
  </CardFooter>
</Card>
```

### Letterman Card (Custom Class)
```tsx
<div className="card-letterman">
  <h3 className="font-varsity uppercase text-lg mb-3">
    Team Roster
  </h3>
  <p className="font-sans text-sm">
    15 Active Players
  </p>
</div>
```

### Thick Border Card
```tsx
<div className="card-letterman-thick">
  <p className="font-display font-bold">
    Featured Content
  </p>
</div>
```

## 🏷️ Badge Examples

```tsx
// Default Sage Badge
<Badge>Active</Badge>

// Secondary Peach Badge
<Badge variant="secondary">Pending</Badge>

// Varsity Orange Badge
<Badge variant="varsity">Live</Badge>

// Outline Badge
<Badge variant="outline">Draft</Badge>

// Alert Badge
<Badge variant="destructive">IR</Badge>
```

## 📐 Layout Patterns

### Hero Section
```tsx
<section className="bg-citrus-cream py-24">
  <div className="container mx-auto px-6">
    <h1 className="font-varsity text-6xl uppercase text-citrus-forest mb-6">
      Fresh Fantasy
    </h1>
    <p className="font-script text-3xl text-citrus-orange mb-8">
      A New Kind of Sports League
    </p>
    <div className="flex gap-4">
      <Button variant="varsity" size="lg">Get Started</Button>
      <Button variant="outline" size="lg">Learn More</Button>
    </div>
  </div>
</section>
```

### Stats Grid
```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
  <Card>
    <CardHeader>
      <CardTitle className="font-varsity uppercase text-sm">
        Goals
      </CardTitle>
    </CardHeader>
    <CardContent>
      <p className="font-display font-bold text-5xl text-citrus-orange">
        42
      </p>
    </CardContent>
  </Card>
  {/* Repeat for other stats */}
</div>
```

### Action Bar
```tsx
<div className="bg-citrus-sage/20 border-2 border-citrus-sage rounded-2xl p-4">
  <div className="flex items-center justify-between">
    <div>
      <h3 className="font-display font-bold text-citrus-forest">
        Draft in Progress
      </h3>
      <p className="text-sm text-citrus-charcoal">Round 3 - Pick 8</p>
    </div>
    <div className="flex gap-3">
      <Badge variant="varsity">Live</Badge>
      <Button variant="varsity">Make Pick</Button>
    </div>
  </div>
</div>
```

## 🎨 Common Patterns

### Player Card
```tsx
<Card className="hover:shadow-varsity cursor-pointer">
  <CardContent className="pt-6">
    <div className="flex items-start gap-4">
      <div className="w-16 h-16 rounded-full bg-citrus-sage border-4 border-citrus-forest">
        {/* Player avatar */}
      </div>
      <div className="flex-1">
        <h4 className="font-display font-bold text-lg text-citrus-forest">
          Connor McDavid
        </h4>
        <p className="text-sm text-citrus-charcoal">EDM • C</p>
        <div className="flex gap-2 mt-2">
          <Badge variant="secondary">97 PTS</Badge>
          <Badge variant="outline">1st Line</Badge>
        </div>
      </div>
    </div>
  </CardContent>
</Card>
```

### Team Header
```tsx
<div className="bg-citrus-peach border-4 border-citrus-orange rounded-varsity p-6 shadow-varsity">
  <div className="flex items-center justify-between">
    <div>
      <h2 className="font-varsity text-3xl uppercase text-citrus-forest mb-2">
        Citrus Crushers
      </h2>
      <p className="font-display text-citrus-charcoal">
        League Champions • 2024
      </p>
    </div>
    <Badge variant="varsity" className="text-lg px-4 py-2">
      12-3-1
    </Badge>
  </div>
</div>
```

### Navigation
```tsx
<nav className="bg-citrus-cream border-b-2 border-citrus-sage">
  <div className="container mx-auto px-6 py-4">
    <div className="flex items-center justify-between">
      <h1 className="font-varsity text-2xl uppercase text-citrus-orange">
        CitrusSports
      </h1>
      <div className="flex gap-6">
        <button className="nav-button active">Home</button>
        <button className="nav-button">Roster</button>
        <button className="nav-button">Stats</button>
        <button className="nav-button">League</button>
      </div>
      <Button variant="varsity">Sign In</Button>
    </div>
  </div>
</nav>
```

## 🎯 Design Dos and Don'ts

### ✅ DO

- Use `bg-citrus-cream` for main backgrounds
- Add `border-2` minimum on interactive elements
- Use `rounded-2xl` or `rounded-varsity` for tactile feel
- Apply `shadow-patch` for subtle depth
- Use `font-varsity` for main headings (uppercase)
- Add `hover:-translate-y-1` to cards
- Add `active:translate-y-0.5` to buttons

### ❌ DON'T

- Use `bg-white` or `bg-black` (use citrus colors)
- Use thin 1px borders (minimum 2px)
- Use `rounded-sm` or `rounded-md` (too small)
- Overuse varsity font (headings only)
- Use pure gray colors (use citrus-charcoal)
- Skip hover/active states
- Use default button styles without variants

## 🔧 Find & Replace Patterns

If migrating existing code:

```bash
# Find pure white backgrounds
bg-white → bg-citrus-cream

# Find black text
text-black → text-citrus-forest

# Find gray text
text-gray-600 → text-citrus-charcoal
text-gray-500 → text-citrus-charcoal

# Find small rounded corners
rounded-lg → rounded-2xl
rounded-md → rounded-xl

# Find thin borders
border → border-2
```

## 📱 Responsive Example

```tsx
<div className="container mx-auto px-4 sm:px-6 lg:px-8">
  <h1 className="font-varsity text-3xl sm:text-4xl lg:text-6xl uppercase text-citrus-forest">
    Responsive Title
  </h1>
  
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
    <Card>
      <CardContent className="p-4 md:p-6">
        {/* Responsive padding */}
      </CardContent>
    </Card>
  </div>
  
  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-6">
    <Button variant="varsity" className="w-full sm:w-auto">
      Mobile First
    </Button>
    <Button variant="outline" className="w-full sm:w-auto">
      Responsive
    </Button>
  </div>
</div>
```

## 🎨 Color Combinations

### Sage Primary
```tsx
<Button className="bg-citrus-sage text-citrus-forest border-2 border-citrus-forest/30">
  Sage Action
</Button>
```

### Orange Accent
```tsx
<Button className="bg-citrus-orange text-citrus-cream border-2 border-citrus-charcoal">
  Orange CTA
</Button>
```

### Peach Secondary
```tsx
<Button className="bg-citrus-peach text-citrus-forest border-2 border-citrus-sage">
  Peach Alternative
</Button>
```

### Cream + Forest (High Contrast)
```tsx
<div className="bg-citrus-cream text-citrus-forest border-2 border-citrus-forest">
  High contrast content
</div>
```

---

## 🚀 Ready to Go!

Start using these patterns in your components. Remember:

1. **No pure white or black** - always use citrus colors
2. **Thick borders** (2px minimum) for tactile feel
3. **Varsity font** for impact headers only
4. **Rounded corners** everywhere (2xl default)
5. **Add animations** to interactive elements

Happy building! 🍊🏈

