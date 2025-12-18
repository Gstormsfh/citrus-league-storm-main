
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';

const podcastEpisodes = [
  {
    id: 1,
    title: "Inside the Draft Room: Expert Strategies",
    description: "Our experts break down their strategies for fantasy drafts this season.",
    coverImage: "https://images.unsplash.com/photo-1610945265064-0e34e5d9545d?q=80&w=600&auto=format&fit=crop",
    duration: "42:15",
    date: "April 3, 2025"
  },
  {
    id: 2,
    title: "Waiver Wire Warriors: Week 10 Pickups",
    description: "Which players should you target on the waiver wire this week?",
    coverImage: "https://images.unsplash.com/photo-1589903308904-1010c2294adc?q=80&w=600&auto=format&fit=crop",
    duration: "39:48",
    date: "March 30, 2025"
  },
  {
    id: 3,
    title: "Start 'Em, Sit 'Em: Week 9 Breakdown",
    description: "Our weekly analysis of which players to start and which to bench.",
    coverImage: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?q=80&w=600&auto=format&fit=crop",
    duration: "45:22",
    date: "March 27, 2025"
  },
  {
    id: 4,
    title: "Deep Dives: Uncovering Hidden Value",
    description: "We analyze overlooked players who could provide significant fantasy value.",
    coverImage: "https://images.unsplash.com/photo-1549451371-64aa98a6f660?q=80&w=600&auto=format&fit=crop",
    duration: "51:07",
    date: "March 23, 2025"
  }
];

const Podcasts = () => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-10 animated-element">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 vibrant-gradient-2 bg-clip-text text-transparent">
              CitrusSports Podcasts
            </h1>
            <p className="text-lg text-muted-foreground">
              Expert analysis, interviews, and advice for your fantasy sports journey
            </p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
            <div className="lg:col-span-2">
              <Card className="overflow-hidden animated-element">
                <div className="relative h-64 md:h-80">
                  <img 
                    src="https://images.unsplash.com/photo-1598327105666-5b89351aff97?q=80&w=2000&auto=format&fit=crop" 
                    alt="Featured Podcast" 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex flex-col justify-end p-6">
                    <span className="bg-[hsl(var(--vibrant-orange))] text-white text-xs font-medium px-2.5 py-1 rounded-full mb-2 inline-block w-fit">
                      FEATURED EPISODE
                    </span>
                    <h2 className="text-white text-2xl md:text-3xl font-bold mb-2">
                      Championship Mindset: Winning Strategies
                    </h2>
                    <p className="text-white/80 mb-4 line-clamp-2">
                      Join our hosts as they discuss championship-winning strategies with three-time fantasy champion Marcus Johnson.
                    </p>
                    <div className="flex items-center text-white/90">
                      <Button variant="ghost" className="rounded-full bg-white/20 hover:bg-white/30 text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mr-2">
                          <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                        </svg>
                        Play Episode
                      </Button>
                      <span className="ml-4 text-sm">56:24 mins</span>
                      <span className="ml-4 text-sm">April 5, 2025</span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
            
            <div className="lg:col-span-1">
              <Card className="h-full flex flex-col animated-element">
                <CardContent className="flex-1 p-6">
                  <h3 className="text-xl font-bold mb-4">Subscribe to Our Podcast</h3>
                  <p className="text-muted-foreground mb-6">
                    Get the latest episodes delivered directly to your favorite podcast platform.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z"></path>
                        <path d="M12 9c-1.654 0-3 1.346-3 3s1.346 3 3 3 3-1.346 3-3-1.346-3-3-3zm0 4c-.551 0-1-.449-1-1s.449-1 1-1 1 .449 1 1-.449 1-1 1z"></path>
                        <path d="M16.332 8.027c-1.684-1.517-4.381-1.517-6.663 0-2.283 1.518-2.283 3.969 0 5.486.841.758 1.888 1.137 2.934 1.137s2.094-.379 2.935-1.137c1.682-1.517 1.682-3.969-.001-5.486zm-1.332 4.065c-.668.602-1.75.602-3 0-.75-.677-.75-1.45 0-2.127.375-.338.875-.511 1.375-.511s1 .173 1.375.511c.751.677.751 1.45.25 2.127z"></path>
                      </svg>
                      Apple
                    </Button>
                    <Button variant="outline" className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm5 14.586a.997.997 0 0 1-1.414 0L12 13l-3.586 3.586a.997.997 0 0 1-1.414 0 .999.999 0 0 1 0-1.414L10.586 12 7 8.414a.999.999 0 1 1 1.414-1.414L12 10.586l3.586-3.586a.999.999 0 1 1 1.414 1.414L13.414 12l3.586 3.586a.999.999 0 0 1 0 1.414z"></path>
                      </svg>
                      Spotify
                    </Button>
                    <Button variant="outline" className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12.849 24c.14 0 .258-.117.258-.256V0.256a.255.255 0 0 0-.258-.256H4.731a.255.255 0 0 0-.258.256v23.488c0 .14.117.256.258.256h8.118zm7.32-10.663a.52.52 0 0 0 .3-.101.518.518 0 0 0 .199-.4c0-.19-.198-.321-.397-.321h-4.16v-1.43h4.16c.198 0 .397-.133.397-.322a.518.518 0 0 0-.199-.4.516.516 0 0 0-.299-.102h-4.16V8.993h4.16c.2 0 .399-.131.399-.321a.52.52 0 0 0-.2-.401.516.516 0 0 0-.299-.101h-4.559a.518.518 0 0 0-.499.5v5.184c0 .268.23.5.5.5h4.558v.002z"></path>
                      </svg>
                      Google
                    </Button>
                    <Button variant="outline" className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.633 7.997c.013.175.013.349.013.523 0 5.325-4.053 11.461-11.46 11.461-2.282 0-4.402-.661-6.186-1.809.324.037.636.05.973.05a8.07 8.07 0 0 0 5.001-1.721 4.036 4.036 0 0 1-3.767-2.793c.249.037.499.062.761.062.361 0 .724-.05 1.061-.137a4.027 4.027 0 0 1-3.23-3.953v-.05c.537.299 1.16.486 1.82.511a4.022 4.022 0 0 1-1.796-3.354c0-.748.199-1.434.548-2.032a11.457 11.457 0 0 0 8.306 4.215c-.062-.3-.1-.611-.1-.923a4.026 4.026 0 0 1 4.028-4.028c1.16 0 2.207.486 2.943 1.272a7.957 7.957 0 0 0 2.556-.973 4.02 4.02 0 0 1-1.771 2.22 8.073 8.073 0 0 0 2.319-.624 8.645 8.645 0 0 1-2.019 2.083z"></path>
                      </svg>
                      RSS Feed
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          
          <h2 className="text-2xl font-bold mb-6 animated-element">Latest Episodes</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            {podcastEpisodes.map((episode) => (
              <Card key={episode.id} className="flex overflow-hidden animated-element hover:shadow-lg transition-shadow">
                <div className="w-1/3">
                  <img 
                    src={episode.coverImage} 
                    alt={episode.title} 
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="w-2/3">
                  <CardContent className="p-4">
                    <h3 className="text-lg font-bold mb-2 line-clamp-1">{episode.title}</h3>
                    <p className="text-muted-foreground text-sm mb-3 line-clamp-2">{episode.description}</p>
                    <div className="flex text-xs text-muted-foreground">
                      <span>{episode.duration}</span>
                      <span className="mx-2">•</span>
                      <span>{episode.date}</span>
                    </div>
                  </CardContent>
                  <CardFooter className="p-4 pt-0">
                    <Button size="sm" variant="ghost" className="gap-2 text-[hsl(var(--vibrant-orange))]">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                      </svg>
                      Play
                    </Button>
                  </CardFooter>
                </div>
              </Card>
            ))}
          </div>
          
          <div className="text-center animated-element">
            <Button className="btn-vibrant-orange">View All Episodes</Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Podcasts;
