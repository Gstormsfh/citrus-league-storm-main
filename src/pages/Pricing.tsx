import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";

const Pricing = () => {
  const tiers = [
    {
      name: "Free",
      price: "$0",
      description: "Everything you need to play in a standard league.",
      features: [
        "Unlimited Leagues",
        "Live Scoring",
        "Mobile App Access",
        "Standard Player News",
        "Ad-Supported"
      ],
      buttonText: "Get Started",
      popular: false
    },
    {
      name: "Pro",
      price: "$4.99",
      period: "/month",
      description: "Advanced tools for serious fantasy managers.",
      features: [
        "Everything in Free",
        "Ad-Free Experience",
        "Stormy AI Assistant (Basic)",
        "Advanced Analytics",
        "Trade Analyzer"
      ],
      buttonText: "Upgrade to Pro",
      popular: true
    },
    {
      name: "Commissioner",
      price: "$9.99",
      period: "/month",
      description: "Ultimate control and insights for league leaders.",
      features: [
        "Everything in Pro",
        "Stormy AI (Unlimited)",
        "Commissioner Tools",
        "Custom League Branding",
        "Priority Support"
      ],
      buttonText: "Go Commish",
      popular: false
    }
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 px-4">
        <div className="container mx-auto py-12">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="text-4xl md:text-5xl font-bold mb-6 citrus-gradient-text">
              Simple, Transparent Pricing
            </h1>
            <p className="text-xl text-muted-foreground">
              Choose the plan that's right for your fantasy sports journey.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {tiers.map((tier, index) => (
              <Card 
                key={index} 
                className={`flex flex-col relative ${tier.popular ? 'border-primary shadow-xl scale-105 z-10' : 'border-border shadow-md'}`}
              >
                {tier.popular && (
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-semibold">
                    Most Popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl">{tier.name}</CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                  <div className="mb-6">
                    <span className="text-4xl font-bold">{tier.price}</span>
                    {tier.period && <span className="text-muted-foreground">{tier.period}</span>}
                  </div>
                  <ul className="space-y-3">
                    {tier.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" variant={tier.popular ? "default" : "outline"}>
                    {tier.buttonText}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Pricing;

