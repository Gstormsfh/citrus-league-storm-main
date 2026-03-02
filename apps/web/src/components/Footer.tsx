
import { Facebook, Twitter, Instagram, Youtube, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import { CitrusSlice, CitrusSparkle, CitrusLeaf, CitrusLogo } from '@/components/icons/CitrusIcons';
import { useLeague } from '@/contexts/LeagueContext';

const Footer = () => {
  const league = useLeague();
  const activeLeagueId = league?.activeLeagueId ?? null;
  return (
    <footer className="bg-[#D4E8B8] dark:bg-gray-900 pt-20 pb-10 border-t-2 border-citrus-sage/40 dark:border-gray-700 relative overflow-hidden">
      {/* Rich green texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle_at_1px_1px,_rgba(92,124,71,0.5)_1px,_transparent_1px)] bg-[length:40px_40px]"></div>
      
      <div className="container mx-auto relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 border-b-3 border-citrus-sage/20 pb-12 mb-10">
          <div className="lg:col-span-2">
            {/* Logo with Citrus Icon - Vintage Style */}
            <div className="flex items-center gap-3 mb-6 group">
              <div className="w-14 h-14 flex items-center justify-center">
                <CitrusLogo className="w-14 h-14 drop-shadow-md" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-varsity font-black text-2xl uppercase text-citrus-forest block leading-none">Citrus</span>
                  <CitrusSparkle className="w-3.5 h-3.5 text-citrus-orange opacity-70" />
                </div>
                <span className="text-xs text-citrus-charcoal font-display tracking-widest uppercase">Sports</span>
              </div>
            </div>
            
            <p className="text-citrus-forest mb-8 max-w-sm font-sans leading-relaxed">
              Fantasy hockey for people who actually watch hockey. Saturday finishes, live everything, and AI that doesn't give you garbage advice.
            </p>
            
            {/* Social Links with Varsity Style */}
            <div className="flex gap-3">
              <a href="#" aria-label="Facebook" className="w-11 h-11 bg-citrus-sage/20 dark:bg-gray-800 border-2 border-citrus-sage dark:border-gray-600 rounded-varsity flex items-center justify-center hover:bg-citrus-sage hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Facebook size={18} className="text-citrus-forest dark:text-gray-300 group-hover:text-[#E8EED9] transition-colors" />
              </a>
              <a href="#" aria-label="Twitter" className="w-11 h-11 bg-citrus-sage/20 dark:bg-gray-800 border-2 border-citrus-sage dark:border-gray-600 rounded-varsity flex items-center justify-center hover:bg-citrus-sage hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Twitter size={18} className="text-citrus-forest dark:text-gray-300 group-hover:text-[#E8EED9] transition-colors" />
              </a>
              <a href="#" aria-label="Instagram" className="w-11 h-11 bg-citrus-sage/20 dark:bg-gray-800 border-2 border-citrus-sage dark:border-gray-600 rounded-varsity flex items-center justify-center hover:bg-citrus-sage hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Instagram size={18} className="text-citrus-forest dark:text-gray-300 group-hover:text-[#E8EED9] transition-colors" />
              </a>
              <a href="#" aria-label="YouTube" className="w-11 h-11 bg-citrus-sage/20 dark:bg-gray-800 border-2 border-citrus-sage dark:border-gray-600 rounded-varsity flex items-center justify-center hover:bg-citrus-sage hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Youtube size={18} className="text-citrus-forest dark:text-gray-300 group-hover:text-[#E8EED9] transition-colors" />
              </a>
            </div>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest dark:text-gray-200 mb-5 tracking-wide">Product</h4>
            <ul className="space-y-3">
              <li><Link to="/features" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Features</Link></li>
              <li><Link to="/draft-room" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Draft Room</Link></li>
              <li><Link to={activeLeagueId ? `/matchup/${activeLeagueId}` : '/matchup'} className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Matchups</Link></li>
              <li><Link to="/roster" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Roster</Link></li>
              <li><Link to="/free-agents" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Free Agents</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest dark:text-gray-200 mb-5 tracking-wide">Resources</h4>
            <ul className="space-y-3">
              <li><Link to="/news" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Player News</Link></li>
              <li><Link to="/standings" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Standings</Link></li>
              <li><Link to="/gm-office/stormy" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Stormy AI</Link></li>
              <li><a href="mailto:CitrusFantasySports@Gmail.com" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Contact Support</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest dark:text-gray-200 mb-5 tracking-wide">Legal</h4>
            <ul className="space-y-3">
              <li><Link to="/settings" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Account Settings</Link></li>
              <li><Link to="/privacy" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-citrus-forest dark:text-gray-400 hover:text-citrus-sage dark:hover:text-gray-200 transition-colors font-sans">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Newsletter Signup with Citrus Flair */}
          <div className="card-letterman p-6 bg-citrus-sage/10 border-3 border-citrus-sage relative overflow-hidden">
            {/* Decorative citrus leaves */}
            <CitrusLeaf className="absolute top-2 right-2 w-8 h-8 text-citrus-sage opacity-20 rotate-12" />
            <CitrusLeaf className="absolute bottom-2 left-2 w-6 h-6 text-citrus-sage opacity-15 -rotate-45" />
            
            <div className="flex items-center gap-2 mb-3">
              <h4 className="font-varsity text-lg uppercase text-citrus-forest tracking-wide">
                Join The Team
              </h4>
              <CitrusSparkle className="w-4 h-4 text-citrus-orange" />
            </div>
            <p className="text-citrus-forest mb-5 font-sans">Get the latest fantasy sports tips and updates</p>
            <div className="flex gap-3">
              <Input 
                placeholder="Enter your email" 
                className="rounded-xl border-2 border-citrus-sage/40 bg-[#E8EED9]/60 backdrop-blur-sm text-citrus-forest placeholder:text-citrus-charcoal/50 font-sans focus:border-citrus-orange transition-all" 
                type="email" 
              />
              <Button variant="patch" className="whitespace-nowrap">
                Join
              </Button>
            </div>
          </div>
          
          {/* Contact & Copyright */}
          <div className="lg:text-right flex flex-col justify-end">
            <div className="flex lg:justify-end items-center gap-3 mb-4 p-3 bg-citrus-sage/10 border-2 border-citrus-sage rounded-xl lg:inline-flex">
              <Mail size={16} className="text-citrus-sage" />
              <a href="mailto:CitrusFantasySports@Gmail.com" className="text-citrus-forest hover:text-citrus-sage transition-colors font-display font-semibold">
                CitrusFantasySports@Gmail.com
              </a>
            </div>
            <p className="text-citrus-forest text-sm font-sans">
              © {new Date().getFullYear()} CitrusSports. <span className="font-bold">All rights reserved.</span>
            </p>
            <p className="text-citrus-forest/70 text-xs font-sans mt-2 flex items-center justify-start lg:justify-end gap-1.5">
              Made with 
              <CitrusLogo className="w-4 h-4 inline-block" />
              by hockey fanatics
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
