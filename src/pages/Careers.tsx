import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, Code, LineChart, Megaphone } from "lucide-react";

const Careers = () => {
  const positions = [
    {
      title: "Senior Frontend Engineer",
      department: "Engineering",
      location: "Remote",
      icon: Code,
      type: "Full-time"
    },
    {
      title: "Data Scientist (AI/ML)",
      department: "Data",
      location: "Remote",
      icon: LineChart,
      type: "Full-time"
    },
    {
      title: "Product Marketing Manager",
      department: "Marketing",
      location: "New York / Remote",
      icon: Megaphone,
      type: "Full-time"
    },
    {
      title: "Product Designer",
      department: "Design",
      location: "Remote",
      icon: Briefcase,
      type: "Contract"
    }
  ];

  return (
    <div className="min-h-screen bg-[#D4E8B8] flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 px-4">
        <div className="container mx-auto max-w-5xl py-12">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold mb-6 citrus-gradient-text">Join the Team</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Help us build the future of fantasy sports. We're looking for passionate individuals to join our growing team.
            </p>
          </div>

          <div className="grid gap-6">
            <h2 className="text-2xl font-bold mb-4">Open Positions</h2>
            {positions.map((job, index) => (
              <Card key={index} className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <job.icon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{job.title}</CardTitle>
                      <p className="text-sm text-muted-foreground">{job.department} • {job.location}</p>
                    </div>
                  </div>
                  <Button variant="outline">Apply Now</Button>
                </CardHeader>
                <CardContent>
                  <div className="mt-2 text-sm font-medium px-2 py-1 bg-secondary inline-block rounded">
                    {job.type}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          <div className="mt-16 text-center">
            <p className="text-muted-foreground">
              Don't see a role that fits? Send your resume to <a href="mailto:careers@citrussports.com" className="text-primary hover:underline">careers@citrussports.com</a>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Careers;

