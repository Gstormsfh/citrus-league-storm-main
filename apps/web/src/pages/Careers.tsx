import { ArrowRight, Briefcase, Code, LineChart, Megaphone } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter, SectionHeader } from '@/components/citrus2';

const POSITIONS = [
  { title: 'Senior Frontend Engineer', department: 'Engineering', location: 'Remote', icon: Code, type: 'Full-time' },
  { title: 'Data Scientist (AI/ML)', department: 'Data', location: 'Remote', icon: LineChart, type: 'Full-time' },
  { title: 'Product Marketing Manager', department: 'Marketing', location: 'New York / Remote', icon: Megaphone, type: 'Full-time' },
  { title: 'Product Designer', department: 'Design', location: 'Remote', icon: Briefcase, type: 'Contract' },
];

export default function Careers() {
  return (
    <DarkLayout>


      <Navbar />
      <main className="relative max-w-[1100px] mx-auto px-6 pt-16 pb-24">
        <div className="text-center mb-12">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
            Careers
          </div>
          <h1 className="font-sans font-black text-[3rem] md:text-[4.25rem] leading-tight tracking-[-0.03em] text-pastel-cream mb-5">
            Join the <span className="text-pastel-orange">team</span>.
          </h1>
          <p className="text-[16px] text-white/65 max-w-xl mx-auto leading-relaxed">
            Help us build the most accurate fantasy hockey platform on the planet. We're looking
            for hockey heads who care about projections, design, and great product.
          </p>
        </div>

        <SectionHeader eyebrow="Open Positions" title="Where we're hiring." />
        <div className="space-y-3">
          {POSITIONS.map((job) => (
            <article
              key={job.title}
              className="bg-[#1A2A20] border border-white/10 rounded-2xl p-5 flex items-center gap-5 flex-wrap hover:border-pastel-orange/40 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-pastel-orange/15 ring-1 ring-pastel-orange/30 flex items-center justify-center text-pastel-orange-soft flex-shrink-0">
                <job.icon className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-sans font-bold text-[16px] text-pastel-cream mb-1">{job.title}</h3>
                <div className="flex items-center gap-2 font-jbmono text-[10px] tracking-wider uppercase text-white/45">
                  <span>{job.department}</span>
                  <span className="text-white/20">·</span>
                  <span>{job.location}</span>
                  <span className="text-white/20">·</span>
                  <span className="text-pastel-sage-soft">{job.type}</span>
                </div>
              </div>
              <button className="inline-flex items-center gap-1.5 text-[13px] font-bold text-pastel-cream hover:text-pastel-orange-soft transition-colors px-4 h-10 rounded-md ring-1 ring-white/15 hover:ring-white/30">
                Apply <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            </article>
          ))}
        </div>

        <div className="mt-12 text-center font-jbmono text-[12px] text-white/55">
          Don't see a role that fits? Send a resume to{' '}
          <a href="mailto:careers@citrussports.com" className="text-pastel-orange-soft hover:text-pastel-orange transition-colors">
            careers@citrussports.com
          </a>
        </div>
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
}
