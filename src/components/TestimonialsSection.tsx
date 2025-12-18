
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';

const testimonials = [
  {
    name: "Michael Johnson",
    role: "Fantasy Football Veteran",
    image: "https://randomuser.me/api/portraits/men/32.jpg",
    content: "Switching to CitrusSports was the best decision for our league. The interface is clean, the stats are comprehensive, and Stormy has saved my season multiple times with spot-on advice.",
    rating: 5
  },
  {
    name: "Sarah Williams",
    role: "League Commissioner",
    image: "https://randomuser.me/api/portraits/women/44.jpg",
    content: "As a commissioner, I love how easy CitrusSports makes it to manage my leagues. The customization options are endless, and the vibrant design makes fantasy sports fun again!",
    rating: 5
  },
  {
    name: "David Chen",
    role: "First-time Fantasy Player",
    image: "https://randomuser.me/api/portraits/men/67.jpg",
    content: "I'm new to fantasy sports, but Stormy made it easy to understand strategies and make competitive moves. The UI is intuitive and the colors make everything pop!",
    rating: 4
  },
  {
    name: "Emma Rodriguez",
    role: "Basketball Fantasy Manager",
    image: "https://randomuser.me/api/portraits/women/23.jpg",
    content: "The analytics tools on CitrusSports are second to none. I can dive deep into player stats while enjoying a beautiful interface that doesn't strain my eyes like other platforms.",
    rating: 5
  },
];

const TestimonialsSection = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const testimonialsRef = useRef<HTMLDivElement>(null);

  const nextTestimonial = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setActiveIndex((prev) => (prev + 1) % testimonials.length);
    setTimeout(() => setIsAnimating(false), 500);
  };

  const prevTestimonial = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setActiveIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
    setTimeout(() => setIsAnimating(false), 500);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      nextTestimonial();
    }, 6000);

    return () => clearInterval(interval);
  }, [isAnimating]);

  return (
    <section className="section-padding bg-white" ref={testimonialsRef}>
      <div className="container mx-auto">
        <div className="text-center mb-16 animated-element animate">
          <h6 className="text-primary font-semibold mb-3">TESTIMONIALS</h6>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">What Our Players Say</h2>
          <p className="text-foreground/70 max-w-2xl mx-auto">
            Join thousands of satisfied fantasy sports enthusiasts who have made the switch to CitrusSports.
          </p>
        </div>

        <div className="relative max-w-4xl mx-auto">
          <div className="overflow-hidden">
            <div 
              className={`flex transition-transform duration-500 ease-in-out`}
              style={{ transform: `translateX(-${activeIndex * 100}%)` }}
            >
              {testimonials.map((testimonial, index) => (
                <div 
                  key={index} 
                  className="min-w-full px-4"
                >
                  <div className="bg-citrus-cream rounded-2xl p-8 shadow-lg">
                    <div className="flex items-center mb-6">
                      {[...Array(5)].map((_, i) => (
                        <Star 
                          key={i} 
                          size={18} 
                          className={i < testimonial.rating ? "fill-citrus-yellow text-citrus-yellow" : "text-gray-300"} 
                        />
                      ))}
                    </div>
                    <p className="text-lg mb-8">"{testimonial.content}"</p>
                    <div className="flex items-center">
                      <img 
                        src={testimonial.image} 
                        alt={testimonial.name}
                        className="w-12 h-12 rounded-full object-cover mr-4"
                      />
                      <div>
                        <h4 className="font-bold">{testimonial.name}</h4>
                        <p className="text-sm text-foreground/70">{testimonial.role}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="flex justify-center mt-8 gap-2">
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full"
              onClick={prevTestimonial}
            >
              <ChevronLeft size={18} />
            </Button>
            <div className="flex gap-2">
              {testimonials.map((_, index) => (
                <button 
                  key={index}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    activeIndex === index ? 'bg-primary' : 'bg-gray-300'
                  }`}
                  onClick={() => setActiveIndex(index)}
                />
              ))}
            </div>
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full"
              onClick={nextTestimonial}
            >
              <ChevronRight size={18} />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
