
import { useEffect, Suspense } from 'react';
import Navbar from '@/components/Navbar';
import TestingPhaseBanner from '@/components/TestingPhaseBanner';
import HeroSection from '@/components/HeroSection';
import FeaturesSection from '@/components/FeaturesSection';
import StormySection from '@/components/StormySection';
import CtaSection from '@/components/CtaSection';
import Footer from '@/components/Footer';
import { AdSpace } from '@/components/AdSpace';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSectionDivider } from '@/components/CitrusSectionDivider';
import { logger } from '@/utils/logger';

const Index = () => {
  // Animation observer setup
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate');
          }
        });
      },
      { threshold: 0.1 }
    );

    const animatedElements = document.querySelectorAll('.animated-element');
    animatedElements.forEach(el => observer.observe(el));

    return () => {
      animatedElements.forEach(el => observer.unobserve(el));
    };
  }, []);

  try {
    return (
      <div className="min-h-screen relative bg-[#D4E8B8] dark:bg-citrus-forest">
        {/* Citrus Background - Floating citrus elements */}
        <CitrusBackground density="medium" animated={true} />
        
        <Suspense fallback={<div>Loading Navbar...</div>}>
          <Navbar />
        </Suspense>
        <main className="pt-[92px] pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <TestingPhaseBanner />
          <Suspense fallback={<div>Loading sections...</div>}>
            <HeroSection />
            <FeaturesSection />
            
            {/* Citrus Divider */}
            <CitrusSectionDivider />
            
            {/* Premium Banner Ad - After Features */}
            <section className="w-full max-w-7xl mx-auto px-4 py-8">
              <AdSpace size="728x90" label="Premier Partner" />
            </section>
            
            <StormySection />
            
            {/* Premium Banner Ad - Before CTA */}
            <section className="w-full max-w-7xl mx-auto px-4 py-8">
              <AdSpace size="728x90" label="Featured Partner" />
            </section>
            
            <CtaSection />
          </Suspense>
        </main>
        <Suspense fallback={<div>Loading Footer...</div>}>
          <Footer />
        </Suspense>
      </div>
    );
  } catch (error) {
    logger.error("❌ Error in Index component:", error);
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Error loading page</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }
};

export default Index;
