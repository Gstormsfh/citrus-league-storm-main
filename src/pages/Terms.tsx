import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 px-4">
        <div className="container mx-auto max-w-3xl py-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-8">Terms of Service</h1>
          
          <div className="prose dark:prose-invert max-w-none space-y-6">
            <p className="text-sm text-muted-foreground">Last updated: November 26, 2025</p>
            
            <section>
              <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing or using CitrusSports, you agree to be bound by these Terms of Service. If you do not agree 
                to these terms, you may not access or use the service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
              <p>
                CitrusSports provides a fantasy sports platform that allows users to create leagues, draft players, 
                and compete against other users based on real-world sports statistics.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">3. User Accounts</h2>
              <p>
                You are responsible for maintaining the confidentiality of your account and password. You agree to accept 
                responsibility for all activities that occur under your account.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">4. Prohibited Conduct</h2>
              <p>
                You agree not to use the service for any unlawful purpose or in any way that interrupts, damages, or 
                impairs the service. This includes transmitting any viruses or other malicious code.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">5. Termination</h2>
              <p>
                We reserve the right to terminate or suspend your account and access to the service at our sole discretion, 
                without notice, for conduct that we believe violates these Terms of Service or is harmful to other users, 
                us, or third parties, or for any other reason.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">6. Changes to Terms</h2>
              <p>
                We reserve the right to modify these terms at any time. We will provide notice of any significant changes 
                by posting the new Terms of Service on this page.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Terms;

