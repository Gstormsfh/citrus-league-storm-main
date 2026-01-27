import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Zap, Shield, Users, Trophy } from "lucide-react";
import { Narwhal } from "@/components/icons/Narwhal";

const Features = () => {
  const features = [
    {
      icon: Narwhal,
      title: "Stormy AI Assistant",
      description: "Data-driven draft advice, trade analysis, and lineup optimization powered by advanced AI and industry-leading projections."
    },
    {
      icon: Zap,
      title: "Live Scoring Updates",
      description: "Real-time scoring updates with live stats and advanced metrics during games."
    },
    {
      icon: Users,
      title: "League Customization",
      description: "Deep customization options for scoring, rosters, and playoffs to match your league's style."
    },
    {
      icon: Shield,
      title: "Secure & Reliable",
      description: "Enterprise-grade security ensures your league data and personal information are always safe."
    },
    {
      icon: Trophy,
      title: "Dynasty Support",
      description: "Built-in tools for keeper and dynasty leagues, including future draft pick trading."
    },
    {
      icon: CheckCircle,
      title: "Draft Tools",
      description: "Mock drafts, cheat sheets, and player rankings to help you build a championship team."
    }
  ];

  return (
    <div className="min-h-screen bg-[#D4E8B8] flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 px-4">
        <div className="container mx-auto py-12">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="text-4xl md:text-5xl font-bold mb-6 citrus-gradient-text">
              Platform Features
            </h1>
            <p className="text-xl text-muted-foreground">
              Professional-grade analytics and data-driven insights for competitive fantasy hockey managers.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <Card key={index} className="card-citrus border-none shadow-lg">
                <CardHeader>
                  <feature.icon className="w-12 h-12 text-primary mb-4" />
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Features;

