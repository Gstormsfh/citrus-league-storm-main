import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Wrench } from "lucide-react";

const News = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <div className="pt-24 flex-grow">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-2xl mx-auto text-center">
            <Card className="p-12">
              <CardContent className="flex flex-col items-center gap-6">
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                  <Wrench className="h-10 w-10 text-muted-foreground" />
                </div>
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold mb-4">Work in Progress</h1>
                  <p className="text-muted-foreground text-lg">
                    The News section is currently under development. Check back soon for the latest fantasy hockey news, analysis, and insights!
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      
      <Footer />
    </div>
  );
};

export default News;
