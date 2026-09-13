import { useCallback, useRef, useState } from 'react';

/** null is an intentional Full Week selection after initialization. */
export function useMatchupDateSelection() {
  const [selectedDate, setDate] = useState<string | null>(null);
  const initialized = useRef(false);
  const selectDate = useCallback((date: string | null) => {
    initialized.current = true;
    setDate(date);
  }, []);
  const initializeDate = useCallback((date: string | null) => {
    if (initialized.current || !date) return;
    initialized.current = true;
    setDate(date);
  }, []);
  const resetDate = useCallback(() => {
    initialized.current = false;
    setDate(null);
  }, []);
  return { selectedDate, selectDate, initializeDate, resetDate };
}
