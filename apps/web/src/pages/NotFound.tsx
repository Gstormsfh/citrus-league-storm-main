import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { logger } from '@/utils/logger';
import { DarkLayout, MascotAvatar } from '@/components/citrus2';

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    logger.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <DarkLayout>
      <main className="min-h-screen flex items-center justify-center p-4 pt-24 relative">
        <div className="text-center max-w-md relative z-10">
          <div className="flex justify-center mb-6">
            <MascotAvatar id="pineapple" size="xl" />
          </div>
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
            404 · Sin Bin
          </div>
          <h1 className="font-sans font-black text-[3.5rem] md:text-[4.5rem] leading-none tracking-[-0.03em] text-pastel-cream mb-4">
            Off<span className="text-pastel-orange">sides</span>.
          </h1>
          <p className="text-[15px] text-white/65 leading-relaxed mb-8">
            This page got called for a penalty. Pineapple is making the save,
            but you'll need to head back to find what you're looking for.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center justify-center gap-2 bg-pastel-orange text-[#581E00] text-[14px] font-bold px-6 h-11 rounded-md hover:bg-pastel-orange-soft transition-colors"
            >
              Back to home <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </button>
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center justify-center gap-2 text-pastel-cream text-[14px] font-bold px-5 h-11 rounded-md ring-1 ring-white/15 hover:ring-white/30 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={2.5} /> Go back
            </button>
          </div>
        </div>
      </main>
    </DarkLayout>
  );
};

export default NotFound;
