
import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
/*
 * THE WHOLE BODY OF THIS PAGE WAS INVISIBLE.
 *
 * Both cards carried `animated-element`, which is `opacity: 0` until an
 * IntersectionObserver adds `.animate`. Only Profile.tsx and Standings.tsx
 * install that observer; Contact never did. So the form, the message box, the
 * send button and the email address all rendered, laid out, occupied 846px of
 * the page — and painted nothing. Between the header and the footer there was
 * a screenful of empty green.
 *
 * Reported from an iPhone as "contact page gets off". It was not a layout bug.
 *
 * The class is simply gone from here: a contact form does not need to fade in,
 * and it certainly does not need to depend on a scroll observer to exist. The
 * class itself is also now fail-visible (see index.css) so this cannot happen
 * silently to the next page that uses it.
 */
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { DarkLayout, HockeyFooter } from '@/components/citrus2';

const Contact = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const plainBody = `Name: ${formData.name}\nEmail: ${formData.email}\n\n${formData.message}`;

    // NATIVE SCHEME FIX (2026-09-01): the iOS shell silently drops
    // mailto: navigations, so the form's send button did nothing in the
    // app. In the shell, hand the composed message to the OS share sheet
    // (Mail is one tap away), with the clipboard as the fallback; the
    // web keeps its mail-client handoff.
    let isNativeShell = false;
    try {
      isNativeShell = Capacitor.isNativePlatform();
    } catch {
      isNativeShell = false;
    }

    if (isNativeShell) {
      const shareText = `To: CitrusFantasySports@Gmail.com\nSubject: [Citrus Support] ${formData.subject}\n\n${plainBody}`;
      let delivered = false;
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: '[Citrus Support] ' + formData.subject, text: shareText });
          delivered = true;
          toast({
            title: 'Message ready to send',
            description: 'Address it to CitrusFantasySports@Gmail.com',
          });
        } catch {
          // Sheet dismissed or refused — fall through to the clipboard.
        }
      }
      if (!delivered) {
        try {
          await navigator.clipboard.writeText(shareText);
          toast({
            title: 'Message copied',
            description: 'Paste it into any email to CitrusFantasySports@Gmail.com',
          });
        } catch {
          toast({
            title: 'Email us directly',
            description: 'CitrusFantasySports@Gmail.com',
          });
        }
      }
      setIsSubmitting(false);
      setFormData({ name: '', email: '', subject: '', message: '' });
      return;
    }

    // Web: build the mailto link with form data and open the mail client.
    const subject = encodeURIComponent(`[Citrus Support] ${formData.subject}`);
    const body = encodeURIComponent(plainBody);
    window.location.href = `mailto:CitrusFantasySports@Gmail.com?subject=${subject}&body=${body}`;

    setTimeout(() => {
      setIsSubmitting(false);
      toast({
        title: "Opening your email client",
        description: "If your email client didn't open, please email us directly at CitrusFantasySports@Gmail.com",
        variant: "default"
      });
      setFormData({
        name: '',
        email: '',
        subject: '',
        message: ''
      });
    }, 1000);
  };

  return (
    <DarkLayout>


      <Navbar />
      <main className="relative max-w-[1100px] mx-auto px-6 pt-16 pb-24">
        <div className="text-center mb-12">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
            Contact
          </div>
          <h1 className="font-sans font-black text-[3rem] md:text-[4rem] leading-tight tracking-[-0.03em] text-pastel-cream mb-4">
            Get in <span className="text-pastel-orange">touch</span>.
          </h1>
          <p className="text-[16px] text-white/65 max-w-xl mx-auto leading-relaxed">
            Questions, feedback, or just want to chirp at us? Drop a line. We read every message.
          </p>
        </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            <div className="md:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Send a Message</CardTitle>
                  <CardDescription>
                    Fill out the form below and we'll get back to you as soon as possible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label htmlFor="name" className="block text-sm font-medium">
                          Your Name
                        </label>
                        <Input
                          id="name"
                          name="name"
                          placeholder="John Doe"
                          value={formData.name}
                          onChange={handleChange}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="email" className="block text-sm font-medium">
                          Email Address
                        </label>
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          placeholder="john.doe@example.com"
                          value={formData.email}
                          onChange={handleChange}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="subject" className="block text-sm font-medium">
                        Subject
                      </label>
                      <Input
                        id="subject"
                        name="subject"
                        placeholder="How can we help you?"
                        value={formData.subject}
                        onChange={handleChange}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="message" className="block text-sm font-medium">
                        Your Message
                      </label>
                      <Textarea
                        id="message"
                        name="message"
                        placeholder="Type your message here..."
                        value={formData.message}
                        onChange={handleChange}
                        required
                        className="min-h-32"
                      />
                    </div>

                    <Button
                      type="submit"
                      className="btn-vibrant-orange w-full sm:w-auto"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Sending...' : 'Send Message'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-primary">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium">Email</h3>
                      <a href="mailto:CitrusFantasySports@Gmail.com" className="text-muted-foreground hover:text-primary transition-colors">
                        CitrusFantasySports@Gmail.com
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-primary">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium">Response Time</h3>
                      <p className="text-muted-foreground">Within 48 hours</p>
                      <p className="text-muted-foreground text-xs">Mon-Fri, excluding holidays</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
        </div>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
};

export default Contact;
