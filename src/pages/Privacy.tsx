import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 px-4">
        <div className="container mx-auto max-w-3xl py-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-8">Privacy Policy</h1>
          
          <div className="prose dark:prose-invert max-w-none space-y-6">
            <p className="text-sm text-muted-foreground">Last updated: November 26, 2025</p>
            
            <section>
              <h2 className="text-xl font-semibold mb-3">1. Information We Collect</h2>
              <p>
                We collect information you provide directly to us, such as when you create an account, update your profile, 
                create a league, or communicate with us. This may include your name, email address, and payment information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">2. How We Use Your Information</h2>
              <p>
                We use the information we collect to provide, maintain, and improve our services, to process your transactions, 
                to send you technical notices and support messages, and to communicate with you about products, services, offers, 
                and events.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">3. Sharing of Information</h2>
              <p>
                We do not share your personal information with third parties except as described in this policy. We may share 
                information with vendors, consultants, and other service providers who need access to such information to 
                carry out work on our behalf.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">4. Data Security</h2>
              <p>
                We take reasonable measures to help protect information about you from loss, theft, misuse and unauthorized 
                access, disclosure, alteration and destruction.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">5. Contact Us</h2>
              <p>
                If you have any questions about this Privacy Policy, please contact us at privacy@citrussports.com.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Privacy;

