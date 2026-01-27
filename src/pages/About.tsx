import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const About = () => {
  return (
    <div className="min-h-screen bg-[#D4E8B8] flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 px-4">
        <div className="container mx-auto max-w-4xl py-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-8 citrus-gradient-text">About CitrusSports</h1>
          
          <div className="prose dark:prose-invert max-w-none space-y-8 text-lg text-muted-foreground">
            <p>
              We built Citrus because every other fantasy hockey platform feels like it was designed by people who don't actually watch hockey. 
              Laggy live scoring. Terrible projections. Sunday finishes when nobody plays. We got tired of it.
            </p>
            
            <p>
              So we made something better. Saturday finishes when the entire league is playing. AI that actually understands hockey context. 
              Post-game writeups for every player so you know why your sleeper pick got 0.2 points. A clean interface that doesn't make you feel like you're using AOL.
            </p>

            <h2 className="text-2xl font-bold text-foreground mt-12 mb-4">Why Saturday?</h2>
            <p>
              Because that's when hockey happens. 12 games. Maximum chaos. Your matchup is decided when it actually matters, 
              not on Sunday morning when 3 teams are playing and your opponent already won. Saturday night is peak hockey. 
              Your fantasy week should end then too.
            </p>

            <h2 className="text-2xl font-bold text-foreground mt-12 mb-4">Built Different</h2>
            <p>
              We're not trying to be Yahoo or ESPN. We're building the platform we actually want to use. 
              Fast. Clean. Smart. No ads cluttering your dashboard. No features you'll never touch. 
              Just the tools you need to dominate your league and talk trash in the group chat.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;

