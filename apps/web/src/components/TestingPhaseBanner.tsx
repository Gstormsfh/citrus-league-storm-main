// Testing Phase Banner - Prominent banner indicating site is in testing phase
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, AlertCircle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

const TestingPhaseBanner = () => {
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if user has dismissed the banner
    const dismissed = localStorage.getItem('testing_phase_banner_dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem('testing_phase_banner_dismissed', 'true');
  };

  if (isDismissed) return null;

  return (
    <div className="relative w-full bg-gradient-to-r from-citrus-orange/90 via-citrus-orange to-citrus-orange/90 border-b-4 border-citrus-forest shadow-lg z-40">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Left: Icon and Message */}
          <div className="flex items-center gap-3 flex-1">
            <AlertCircle className="w-6 h-6 text-citrus-forest flex-shrink-0" />
            <div className="flex-1">
              <div className="font-varsity font-black text-lg uppercase text-citrus-forest mb-1">
                🚧 Testing Phase - Full Launch Coming Soon
              </div>
              <p className="text-sm text-citrus-forest/90 font-sans">
                Create a test league to experience the platform - we'll fill it with AI teams so you can try the full draft and season experience.
              </p>
            </div>
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link to="/create-league">
              <Button
                size="sm"
                className="bg-citrus-forest hover:bg-citrus-forest/90 text-citrus-cream border-2 border-citrus-forest font-varsity uppercase"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Try Test League
              </Button>
            </Link>
            <button
              onClick={handleDismiss}
              className="p-1 hover:bg-citrus-forest/20 rounded transition-colors"
              aria-label="Dismiss banner"
            >
              <X className="w-5 h-5 text-citrus-forest" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestingPhaseBanner;
