# League Switching and Hooks Error Fix

## Issue
When switching between leagues, the app showed the error:
```
Error: Rendered fewer hooks than expected. This may be caused by an accidental early return statement.
```

This error occurred because components were unmounting and remounting during league switches, causing React hooks to be called in a different order or count.

## Root Causes

### 1. Delayed State Reset in LeagueContext
**File**: `src/contexts/LeagueContext.tsx`

The `setActiveLeagueId` function used a 500ms `setTimeout` delay before resetting `isChangingLeague`:

```typescript
// OLD CODE (❌ Caused hooks error)
setTimeout(() => {
  setIsChangingLeague(false);
}, 500);
```

This meant:
- User clicks to switch leagues
- `isChangingLeague` is set to `true`
- Components see this flag and return early (unmount)
- After 500ms, flag resets to `false`
- Components remount
- **Hook order/count mismatch causes error**

### 2. Component Unmounting in Roster.tsx
**File**: `src/pages/Roster.tsx`

The Roster component had an early return that unmounted the entire component during league switching:

```typescript
// OLD CODE (❌ Caused hooks to be skipped)
if (isChangingLeague || (leagueLoading && userLeagueState === 'active-user')) {
  return <LoadingScreen message="Loading roster..." />;
}
```

This violated React's Rules of Hooks because the component would:
1. First render: Call all hooks, then return JSX
2. League switch starts: Call all hooks, then return early with LoadingScreen
3. League switch completes: Call all hooks, then return JSX
4. **Hooks count/order inconsistency causes error**

### 3. Variable Definition Order in LeagueDashboard.tsx
**File**: `src/pages/LeagueDashboard.tsx`

The `isCommissioner` variable was defined AFTER the `handleProcessWaivers` function that used it, creating a hooks ordering issue during rerenders.

## Fixes Applied

### Fix 1: Instant State Reset (LeagueContext.tsx)
**Changed**: Replace `setTimeout` with `requestAnimationFrame`

```typescript
// NEW CODE (✅ Immediate reset)
requestAnimationFrame(() => {
  setIsChangingLeague(false);
});
```

**Why it works**:
- `requestAnimationFrame` executes on the next browser frame (~16ms)
- State updates are batched properly
- Components don't unmount/remount
- No hooks ordering issues

### Fix 2: Loading Overlay Instead of Unmount (Roster.tsx)
**Changed**: Show overlay instead of early return

```typescript
// NEW CODE (✅ Component stays mounted)
const showLoadingOverlay = isChangingLeague || (leagueLoading && userLeagueState === 'active-user');

return (
  <div className="min-h-screen ...">
    {/* Loading overlay - component stays mounted */}
    {showLoadingOverlay && (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] ...">
        <div className="text-center">
          <div className="animate-spin ..."></div>
          <p>Switching leagues...</p>
        </div>
      </div>
    )}
    {/* Rest of component - ALWAYS rendered */}
    ...
  </div>
);
```

**Why it works**:
- Component never unmounts
- All hooks are called on every render
- Loading state is just a visual overlay
- No hooks order/count changes

### Fix 3: Variable Definition Order (LeagueDashboard.tsx)
**Changed**: Move `isCommissioner` before functions that use it

```typescript
// NEW CODE (✅ Correct order)
const isCommissioner = league?.commissioner_id === user?.id;

const handleProcessWaivers = async () => {
  if (!leagueId || !user || !isCommissioner) return;
  // ... rest of function
};
```

**Why it works**:
- Variables are defined before they're referenced
- No timing issues during rerenders
- Hook order is consistent

## Files Modified

1. **`src/contexts/LeagueContext.tsx`**
   - Changed `setTimeout(500ms)` to `requestAnimationFrame()`
   - Instant state reset prevents component unmounting

2. **`src/pages/Roster.tsx`**
   - Removed early return during league switching
   - Added loading overlay that doesn't unmount component
   - All hooks now called on every render

3. **`src/pages/LeagueDashboard.tsx`**
   - Moved `isCommissioner` definition before `handleProcessWaivers`
   - Fixed variable reference order

## Result

- **League switching is now seamless**: No page unmount, just a smooth overlay
- **No more hooks errors**: Component stays mounted, hooks called consistently
- **Better UX**: Faster transition with visual feedback
- **Multiple leagues**: Users can switch between 2+ leagues without issues

## Testing

To verify the fix:
1. Create/join 2+ leagues
2. Navigate to Roster tab
3. Switch between leagues using the league dropdown
4. Verify:
   - No "Rendered fewer hooks" error in console
   - Smooth transition with loading overlay
   - Roster data updates correctly
   - No page flash or unmounting

## Technical Notes

**React Rules of Hooks**:
- Hooks must be called in the same order on every render
- Hooks cannot be called conditionally before a return
- Early returns must come AFTER all hooks are defined

**Our Solution**:
- Keep components mounted during state transitions
- Use visual overlays instead of conditional rendering
- Ensure state resets happen immediately, not after delays
