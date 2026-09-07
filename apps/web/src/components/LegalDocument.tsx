import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter } from '@/components/citrus2';
import { AnalyticsPreference } from '@/components/AnalyticsPreference';
import { interceptExternal } from '@/lib/openExternal';

export function LegalDocument({ html, privacy = false }: { html: string; privacy?: boolean }) {
  // Only checked-in public HTML is accepted here, never user or API content.
  const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';
  return (
    <DarkLayout>
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 pt-24 pb-16">
        {privacy && <AnalyticsPreference />}
        <article className="rounded-xl bg-white text-[#333] p-6 leading-relaxed [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-8 [&_h3]:font-bold [&_h3]:mt-4 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-green-800 [&_a]:underline"
          onClick={(event) => {
            const anchor = (event.target as Element).closest('a');
            const href = anchor?.getAttribute('href');
            if (href && anchor?.target === '_blank' && interceptExternal(href)) event.preventDefault();
          }}
          dangerouslySetInnerHTML={{ __html: body }} />
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
}
