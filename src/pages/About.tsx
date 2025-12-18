import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const About = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 px-4">
        <div className="container mx-auto max-w-4xl py-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-8 citrus-gradient-text">About CitrusSports</h1>
          
          <div className="prose dark:prose-invert max-w-none space-y-8 text-lg text-muted-foreground">
            <p>
              CitrusSports was born from a simple frustration: fantasy sports platforms were stuck in the past. 
              Clunky interfaces, outdated stats, and a lack of innovation made managing leagues a chore rather than a joy.
            </p>
            
            <p>
              We set out to build a platform that puts the user experience first. By combining modern design principles 
              with powerful AI technology, we're redefining how fantasy sports are played.
            </p>

            <h2 className="text-2xl font-bold text-foreground mt-12 mb-4">Our Mission</h2>
            <p>
              To create the most immersive, intuitive, and intelligent fantasy sports experience on the planet. 
              We believe that fantasy sports should be accessible to everyone, from the casual fan to the hardcore data analyst.
            </p>

            <h2 className="text-2xl font-bold text-foreground mt-12 mb-4">The Team</h2>
            <p>
              We are a passionate team of sports fans, developers, and designers based in sunny places. 
              We eat, sleep, and breathe fantasy sports, and we're dedicated to building the tools we want to use ourselves.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;

