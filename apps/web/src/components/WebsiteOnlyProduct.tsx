import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isNativeShell } from '@/lib/nativeAuth';

/** Website purchase pages are allowed in every browser width, never in a native shell. */
export function WebsiteOnlyProduct({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_NATIVE === '1' || isNativeShell()) return <Navigate to="/" replace />;
  return <>{children}</>;
}
