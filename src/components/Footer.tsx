
import { Facebook, Twitter, Instagram, Youtube, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-citrus-cream pt-20 pb-10 border-t-4 border-citrus-sage/30 relative overflow-hidden">
      {/* Vintage texture overlay */}
      <div className="absolute inset-0 opacity-[0.015] bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:40px_40px]"></div>
      
      <div className="container mx-auto relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 border-b-3 border-citrus-sage/20 pb-12 mb-10">
          <div className="lg:col-span-2">
            {/* Logo with Vintage Style */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-14 h-14 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest/20 flex items-center justify-center shadow-patch">
                <span className="text-citrus-cream font-varsity text-xl font-black">CS</span>
              </div>
              <div>
                <span className="font-varsity font-black text-2xl uppercase text-citrus-forest block leading-none">Citrus</span>
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
              <li><Link to="/standings" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Leagues</Link></li>
              <li><Link to="/free-agents" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Players</Link></li>
              <li><Link to="/gm-office/stormy" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Stormy AI</Link></li>
              <li><Link to="/pricing" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Pricing</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest mb-5 tracking-wide">Resources</h4>
            <ul className="space-y-3">
              <li><Link to="/blog" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Blog</Link></li>
              <li><Link to="/podcasts" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Podcasts</Link></li>
              <li><Link to="/guides" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Strategy Guides</Link></li>
              <li><Link to="/news" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Player News</Link></li>
              <li><Link to="/contact" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Support</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-base uppercase text-citrus-forest mb-5 tracking-wide">Company</h4>
            <ul className="space-y-3">
              <li><Link to="/about" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">About Us</Link></li>
              <li><Link to="/careers" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Careers</Link></li>
              <li><Link to="/contact" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Contact</Link></li>
              <li><Link to="/privacy" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-citrus-charcoal hover:text-citrus-orange transition-colors font-sans">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Newsletter Signup */}
          <div className="card-letterman p-6 bg-citrus-sage/10 border-3 border-citrus-sage">
            <h4 className="font-varsity text-lg uppercase text-citrus-forest mb-3 tracking-wide">
              Join The Team
            </h4>
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
            <p className="text-citrus-charcoal/60 text-xs font-sans mt-2">
              Made with 🍊 by hockey fanatics
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
