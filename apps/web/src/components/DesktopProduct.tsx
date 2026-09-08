import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isNativeShell } from '@/lib/nativeAuth';

/** Unreleased purchase products are excluded from native apps and phone web. */
export function DesktopProduct({ children, route = false }: { children: ReactNode; route?: boolean }) {
  const mobile = useIsMobile();
  if (import.meta.env.VITE_NATIVE === '1' || isNativeShell() || mobile) return route ? <Navigate to="/" replace /> : null;
  return <>{children}</>;
}
