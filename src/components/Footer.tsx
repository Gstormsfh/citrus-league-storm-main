
import { Facebook, Twitter, Instagram, Youtube, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-white pt-16 pb-8">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 border-b border-gray-200 pb-12 mb-8">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <span className="text-white font-bold text-lg">CS</span>
              </div>
              <span className="font-display font-bold text-xl">CitrusSports</span>
            </div>
            <p className="text-foreground/70 mb-6 max-w-sm">
              A refreshing take on fantasy sports with intuitive design and powerful AI assistance.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-8 h-8 bg-foreground/5 rounded-full flex items-center justify-center hover:bg-primary/10 transition-colors group">
                <Facebook size={16} className="text-foreground/70 group-hover:text-primary" />
              </a>
              <a href="#" className="w-8 h-8 bg-foreground/5 rounded-full flex items-center justify-center hover:bg-primary/10 transition-colors group">
                <Twitter size={16} className="text-foreground/70 group-hover:text-primary" />
              </a>
              <a href="#" className="w-8 h-8 bg-foreground/5 rounded-full flex items-center justify-center hover:bg-primary/10 transition-colors group">
                <Instagram size={16} className="text-foreground/70 group-hover:text-primary" />
              </a>
              <a href="#" className="w-8 h-8 bg-foreground/5 rounded-full flex items-center justify-center hover:bg-primary/10 transition-colors group">
                <Youtube size={16} className="text-foreground/70 group-hover:text-primary" />
              </a>
            </div>
          </div>
          
          <div>
            <h4 className="font-bold text-lg mb-4">Product</h4>
            <ul className="space-y-3">
              <li><Link to="/features" className="text-foreground/70 hover:text-primary transition-colors">Features</Link></li>
              <li><Link to="/standings" className="text-foreground/70 hover:text-primary transition-colors">Leagues</Link></li>
              <li><Link to="/free-agents" className="text-foreground/70 hover:text-primary transition-colors">Players</Link></li>
              <li><Link to="/gm-office/stormy" className="text-foreground/70 hover:text-primary transition-colors">Stormy AI</Link></li>
              <li><Link to="/pricing" className="text-foreground/70 hover:text-primary transition-colors">Pricing</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-lg mb-4">Resources</h4>
            <ul className="space-y-3">
              <li><Link to="/blog" className="text-foreground/70 hover:text-primary transition-colors">Blog</Link></li>
              <li><Link to="/podcasts" className="text-foreground/70 hover:text-primary transition-colors">Podcasts</Link></li>
              <li><Link to="/guides" className="text-foreground/70 hover:text-primary transition-colors">Strategy Guides</Link></li>
              <li><Link to="/news" className="text-foreground/70 hover:text-primary transition-colors">Player News</Link></li>
              <li><Link to="/contact" className="text-foreground/70 hover:text-primary transition-colors">Support</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-lg mb-4">Company</h4>
            <ul className="space-y-3">
              <li><Link to="/about" className="text-foreground/70 hover:text-primary transition-colors">About Us</Link></li>
              <li><Link to="/careers" className="text-foreground/70 hover:text-primary transition-colors">Careers</Link></li>
              <li><Link to="/contact" className="text-foreground/70 hover:text-primary transition-colors">Contact</Link></li>
              <li><Link to="/privacy" className="text-foreground/70 hover:text-primary transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-foreground/70 hover:text-primary transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h4 className="font-bold text-lg mb-4">Subscribe to our newsletter</h4>
            <p className="text-foreground/70 mb-4">Get the latest fantasy sports tips and updates</p>
            <div className="flex gap-2">
              <Input 
                placeholder="Enter your email" 
                className="rounded-full" 
                type="email" 
              />
              <Button>Subscribe</Button>
            </div>
          </div>
          
          <div className="lg:text-right">
            <div className="flex lg:justify-end items-center gap-3 text-sm mb-2">
              <Mail size={14} className="text-foreground/70" />
              <a href="mailto:hello@citrussports.com" className="text-foreground/70 hover:text-primary transition-colors">
                hello@citrussports.com
              </a>
            </div>
            <p className="text-foreground/50 text-sm">
              © {new Date().getFullYear()} CitrusSports. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
