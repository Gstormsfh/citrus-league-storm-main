/** Mobile harness — the Roster page's real tab bar, real classes, real primitives. */
import { createRoot } from 'react-dom/client';
import '../src/pressboxFonts';
import '../src/index.css';
import { Tabs, TabsList, TabsTrigger } from '../src/components/ui/tabs';

function App() {
  return (
    <div className="p-4 bg-[#0E1A12] min-h-screen">
      <Tabs defaultValue="roster" className="space-y-4">
        <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl overflow-hidden">
        <TabsList className="w-full p-0 bg-transparent border-b border-white/10 rounded-none gap-0 h-auto justify-start overflow-x-auto sm:overflow-x-visible">
        <TabsTrigger value="roster" className="flex-none shrink-0 px-3 sm:flex-1 sm:px-0 py-4 rounded-none font-jbmono text-[11px] tracking-[0.12em] sm:tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors">Roster</TabsTrigger>
        <TabsTrigger value="stats" className="flex-none shrink-0 px-3 sm:flex-1 sm:px-0 py-4 rounded-none font-jbmono text-[11px] tracking-[0.12em] sm:tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors"><span className="sm:hidden">Stats</span><span className="hidden sm:inline">Team Stats</span></TabsTrigger>
        <TabsTrigger value="trends" className="flex-none shrink-0 px-3 sm:flex-1 sm:px-0 py-4 rounded-none font-jbmono text-[11px] tracking-[0.12em] sm:tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors"><span className="sm:hidden">Trends</span><span className="hidden sm:inline">Trends &amp; Analytics</span></TabsTrigger>
        <TabsTrigger value="transactions" className="flex-none shrink-0 px-3 sm:flex-1 sm:px-0 py-4 rounded-none font-jbmono text-[11px] tracking-[0.12em] sm:tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors">Transactions</TabsTrigger>
        </TabsList>
        </div>
      </Tabs>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
