import { DarkLayout, HockeyFooter } from '@/components/citrus2';
import Navbar from '@/components/Navbar';

const SECTIONS = [
  {
    n: 1,
    title: 'Acceptance of Terms',
    body: 'By accessing or using Citrus, you agree to be bound by these Terms of Service. If you do not agree, you may not access or use the service.',
  },
  {
    n: 2,
    title: 'Description of Service',
    body: 'Citrus provides a fantasy sports platform that allows users to create leagues, draft players, and compete based on real-world NHL statistics.',
  },
  {
    n: 3,
    title: 'User Accounts',
    body: 'You are responsible for maintaining the confidentiality of your account and password. You agree to accept responsibility for all activities under your account.',
  },
  {
    n: 4,
    title: 'Prohibited Conduct',
    body: 'You agree not to use the service for any unlawful purpose or in any way that interrupts, damages, or impairs the service. This includes transmitting any viruses or malicious code.',
  },
  {
    n: 5,
    title: 'Termination',
    body: 'We reserve the right to terminate or suspend your account at our discretion, without notice, for conduct that violates these Terms or is harmful to other users, us, or third parties.',
  },
  {
    n: 6,
    title: 'Changes to Terms',
    body: 'We reserve the right to modify these terms at any time. We will provide notice of significant changes by posting the new Terms on this page.',
  },
];

export default function Terms() {
  return (
    <DarkLayout>


      <Navbar />      <main className="relative max-w-[820px] mx-auto px-6 pt-16 pb-24">
        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
          Legal
        </div>
        <h1 className="font-sans font-black text-[2.5rem] md:text-[3.25rem] leading-tight tracking-[-0.03em] text-pastel-cream mb-3">
          Terms of Service
        </h1>
        <p className="font-jbmono text-[11px] tracking-wider uppercase text-white/45 mb-12">
          Last updated: November 26, 2025
        </p>

        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.n}>
              <h2 className="font-sans font-bold text-[1.25rem] text-pastel-cream mb-3">
                <span className="text-pastel-orange-soft mr-2">{s.n}.</span>
                {s.title}
              </h2>
              <p className="text-[15px] text-white/70 leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
}
