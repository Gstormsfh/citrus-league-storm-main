import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook that enforces a minimum display time for loading screens.
 * This prevents the jarring "flash" effect when content loads too quickly.
 * 
 * @param isLoading - The actual loading state from your data fetching
 * @param minimumMs - Minimum time in milliseconds to show loading screen (default: 800ms)
 * @returns A loading state that stays true until both: content is loaded AND minimum time has elapsed
 * 
 * @example
 * const actualLoading = useSomeDataFetch();
 * const displayLoading = useMinimumLoadingTime(actualLoading, 800);
 * 
 * return displayLoading ? <LoadingScreen /> : <Content />;
 */
export function useMinimumLoadingTime(isLoading: boolean, minimumMs: number = 800): boolean {
  const [displayLoading, setDisplayLoading] = useState(isLoading);
  const startTimeRef = useRef<number | null>(isLoading ? Date.now() : null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isLoading) {
      // Loading just started - record start time and show loading immediately
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
      setDisplayLoading(true);
      
      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      // Loading finished - but we need to ensure minimum display time
      if (startTimeRef.current === null) {
        // Edge case: loading was already false when hook initialized
        setDisplayLoading(false);
        return;
      }

      const elapsed = Date.now() - startTimeRef.current;
      const remaining = minimumMs - elapsed;

      if (remaining > 0) {
        // Not enough time has passed - wait for the remainder
        timeoutRef.current = setTimeout(() => {
          setDisplayLoading(false);
          startTimeRef.current = null;
          timeoutRef.current = null;
        }, remaining);
      } else {
        // Minimum time has already elapsed - hide immediately
        setDisplayLoading(false);
        startTimeRef.current = null;
      }
    }

    // Cleanup on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isLoading, minimumMs]);

  return displayLoading;
}

