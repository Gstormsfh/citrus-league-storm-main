/** Renders the real DraftRoomV2 at a phone viewport with the transport stubbed. */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../src/pressboxFonts';
import '../src/index.css';
import { CitrusToaster } from '../src/components/notifications/CitrusToaster';
import DraftRoomV2 from '../src/pages/DraftRoomV2';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={['/draft/harness-league']}>
      <Routes>
        <Route path="/draft/:leagueId" element={<DraftRoomV2 />} />
      </Routes>
    </MemoryRouter>
    <CitrusToaster />
  </QueryClientProvider>,
);
