// Phase 4.5 chunk 11g.5b — vitest setup file.
//
// Extends vitest's `expect` with `@testing-library/jest-dom`
// matchers (toHaveClass, toBeInTheDocument, etc.) and registers
// automatic cleanup after each React Testing Library render so
// component tests don't leak DOM between tests.

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
