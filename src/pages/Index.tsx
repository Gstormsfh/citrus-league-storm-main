
import { useEffect, Suspense } from 'react';
import Navbar from '../components/Navbar';
import HeroSection from '../components/HeroSection';
import FeaturesSection from '../components/FeaturesSection';
import StormySection from '../components/StormySection';
import TestimonialsSection from '../components/TestimonialsSection';
import CtaSection from '../components/CtaSection';
import Footer from '../components/Footer';

const Index = () => {
  console.log("✅ Index component rendering");
  
  // Animation observer setup
  useEffect(() => {
    console.log("✅ Index useEffect running");
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

  // Add a timeout to detect if component is stuck
  useEffect(() => {
    const timer = setTimeout(() => {
      console.warn("⚠️ Index component has been mounted for 5 seconds");
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  try {
    return (
      <div className="min-h-screen">
        <Suspense fallback={<div>Loading Navbar...</div>}>
          <Navbar />
        </Suspense>
        <main>
          <Suspense fallback={<div>Loading sections...</div>}>
            <HeroSection />
            <FeaturesSection />
            <StormySection />
            <TestimonialsSection />
            <CtaSection />
          </Suspense>
        </main>
        <Suspense fallback={<div>Loading Footer...</div>}>
          <Footer />
        </Suspense>
      </div>
    );
  } catch (error) {
    console.error("❌ Error in Index component:", error);
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Error loading page</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }
};

export default Index;
