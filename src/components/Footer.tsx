
import { Facebook, Twitter, Instagram, Youtube, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import { CitrusSlice, CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';

const Footer = () => {
  return (
    <footer className="bg-citrus-cream pt-20 pb-10 border-t-4 border-citrus-sage/30 relative overflow-hidden">
      {/* Vintage texture overlay */}
      <div className="absolute inset-0 opacity-[0.015] bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:40px_40px]"></div>
      
      <div className="container mx-auto relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 border-b-3 border-citrus-sage/20 pb-12 mb-10">
          <div className="lg:col-span-2">
            {/* Logo with Citrus Icon - Vintage Style */}
            <div className="flex items-center gap-3 mb-6 group">
              <div className="w-14 h-14 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest/20 flex items-center justify-center shadow-patch relative overflow-hidden">
                {/* Background shine */}
                <div className="absolute inset-0 opacity-20">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(255,255,255,0.3)_0%,_transparent_60%)]"></div>
                </div>
                {/* Citrus Slice */}
                <CitrusSlice className="w-9 h-9 relative z-10 text-citrus-cream" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-varsity font-black text-2xl uppercase text-citrus-forest block leading-none">Citrus</span>
                  <CitrusSparkle className="w-3.5 h-3.5 text-citrus-orange opacity-70" />
                </div>
                <span className="text-xs text-citrus-charcoal font-display tracking-widest uppercase">Sports</span>
              </div>
            </div>
            
            <p className="text-citrus-charcoal mb-8 max-w-sm font-sans leading-relaxed">
              A refreshing take on fantasy sports with <span className="font-bold text-citrus-orange">intuitive design</span> and powerful AI assistance.
            </p>
            
            {/* Social Links with Varsity Style */}
            <div className="flex gap-3">
              <a href="#" className="w-11 h-11 bg-citrus-sage/20 border-2 border-citrus-sage rounded-varsity flex items-center justify-center hover:bg-citrus-sage hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Facebook size={18} className="text-citrus-forest group-hover:text-citrus-cream transition-colors" />
              </a>
              <a href="#" className="w-11 h-11 bg-citrus-peach/20 border-2 border-citrus-peach rounded-varsity flex items-center justify-center hover:bg-citrus-peach hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Twitter size={18} className="text-citrus-forest group-hover:text-citrus-cream transition-colors" />
              </a>
              <a href="#" className="w-11 h-11 bg-citrus-orange/20 border-2 border-citrus-orange rounded-varsity flex items-center justify-center hover:bg-citrus-orange hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Instagram size={18} className="text-citrus-forest group-hover:text-citrus-cream transition-colors" />
              </a>
              <a href="#" className="w-11 h-11 bg-citrus-sage/20 border-2 border-citrus-sage rounded-varsity flex items-center justify-center hover:bg-citrus-sage hover:shadow-patch hover:-translate-y-0.5 transition-all group">
                <Youtube size={18} className="text-citrus-forest group-hover:text-citrus-cream transition-colors" />
              </a>
            </div>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest mb-5 tracking-wide">Product</h4>
            <ul className="space-y-3">
              <li><Link to="/features" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Features</Link></li>
              <li><Link to="/draft-room" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Draft Room</Link></li>
              <li><Link to="/matchup" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Matchups</Link></li>
              <li><Link to="/roster" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Roster</Link></li>
              <li><Link to="/free-agents" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Free Agents</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest mb-5 tracking-wide">Resources</h4>
            <ul className="space-y-3">
              <li><Link to="/news" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Player News</Link></li>
              <li><Link to="/standings" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Standings</Link></li>
              <li><Link to="/gm-office/stormy" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Stormy AI</Link></li>
              <li><a href="mailto:support@citrusfantasy.com" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Contact Support</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest mb-5 tracking-wide">Legal</h4>
            <ul className="space-y-3">
              <li><Link to="/settings" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Account Settings</Link></li>
              <li><a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Privacy Policy</a></li>
              <li><a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Terms of Service</a></li>
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
            <p className="text-citrus-charcoal mb-5 font-sans">Get the latest fantasy sports tips and updates</p>
            <div className="flex gap-3">
              <Input 
                placeholder="Enter your email" 
                className="rounded-xl border-2 border-citrus-sage/40 bg-citrus-cream text-citrus-forest placeholder:text-citrus-charcoal/50 font-sans focus:border-citrus-orange transition-all" 
                type="email" 
              />
              <Button variant="patch" className="whitespace-nowrap">
                Join
              </Button>
            </div>
          </div>
          
          {/* Contact & Copyright */}
          <div className="lg:text-right flex flex-col justify-end">
            <div className="flex lg:justify-end items-center gap-3 mb-4 p-3 bg-citrus-orange/10 border-2 border-citrus-orange rounded-xl lg:inline-flex">
              <Mail size={16} className="text-citrus-orange" />
              <a href="mailto:hello@citrussports.com" className="text-citrus-forest hover:text-citrus-orange transition-colors font-display font-semibold">
                hello@citrussports.com
              </a>
            </div>
            <p className="text-citrus-charcoal text-sm font-sans">
              © {new Date().getFullYear()} CitrusSports. <span className="font-bold">All rights reserved.</span>
            </p>
            <p className="text-citrus-charcoal/60 text-xs font-sans mt-2 flex items-center justify-start lg:justify-end gap-1.5">
              Made with 
              <CitrusSlice className="w-3.5 h-3.5 text-citrus-orange inline-block" />
              by hockey fanatics
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
