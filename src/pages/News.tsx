import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bookmark, Calendar, ChevronRight, MessageSquare, Share2, ThumbsUp, TrendingUp, Target } from "lucide-react";

// Mock news data
const newsData = [
  {
    id: 1,
    title: "Week 6 Fantasy Football Recap: Stars and Disappointments",
    excerpt: "Breaking down the major performances and letdowns from Week 6 NFL action.",
    image: "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8YW1lcmljYW4lMjBmb290YmFsbHxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&w=800&q=60",
    category: "Analysis",
    date: "Oct 18, 2023",
    comments: 24,
    likes: 58,
    author: "Michael Thompson"
  },
  {
    id: 2,
    title: "Injury Updates: Top Players Status for Week 7",
    excerpt: "Latest updates on injury status for key fantasy players heading into Week 7.",
    image: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8YW1lcmljYW4lMjBmb290YmFsbCUyMGluanVyeXxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&w=800&q=60",
    category: "Injuries",
    date: "Oct 17, 2023",
    comments: 37,
    likes: 42,
    author: "Sarah Johnson"
  },
  {
    id: 3,
    title: "Waiver Wire: Top Pickups for Week 7",
    excerpt: "Must-add players still available in most fantasy leagues.",
    image: "https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MjB8fGFtZXJpY2FuJTIwZm9vdGJhbGx8ZW58MHx8MHx8fDA%3D&auto=format&fit=crop&w=800&q=60",
    category: "Strategy",
    date: "Oct 16, 2023",
    comments: 19,
    likes: 64,
    author: "James Rodriguez"
  },
  {
    id: 4,
    title: "Trade Targets: Buy Low and Sell High Candidates",
    excerpt: "Players to target in trades and those to move before their value drops.",
    image: "https://images.unsplash.com/photo-1580750882617-8863d769ef11?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MjN8fGFtZXJpY2FuJTIwZm9vdGJhbGx8ZW58MHx8MHx8fDA%3D&auto=format&fit=crop&w=800&q=60", 
    category: "Trades",
    date: "Oct 15, 2023",
    comments: 31,
    likes: 47,
    author: "Rebecca Lee"
  }
];

const News = () => {
  // Animation observer setup
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate');
          }
        });
      },
      { threshold: 0.1 }
    );

    const animatedElements = document.querySelectorAll('.animated-element');
    animatedElements.forEach(el => observer.observe(el));

    return () => {
      animatedElements.forEach(el => observer.unobserve(el));
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <div className="pt-24 flex-grow">
        {/* Hero Section */}
        <div className="container mx-auto px-4 py-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Fantasy News Center</h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Stay updated with the latest fantasy sports news, analysis, and insights to help you dominate your league.
            </p>
          </div>
          
          {/* News Categories Tabs */}
          <Tabs defaultValue="all" className="w-full mb-8">
            <div className="flex justify-center mb-6">
              <TabsList className="bg-background/50 border border-border/20">
                <TabsTrigger value="all">All News</TabsTrigger>
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
                <TabsTrigger value="injuries">Injuries</TabsTrigger>
                <TabsTrigger value="strategy">Strategy</TabsTrigger>
                <TabsTrigger value="trades">Trades</TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="all" className="mt-0">
              {/* Featured Article */}
              <div className="mb-12 animated-element opacity-0 translate-y-4 transition-all duration-700">
                <div className="relative rounded-xl overflow-hidden shadow-md">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10"></div>
                  <img 
                    src="https://images.unsplash.com/photo-1560012954-3def95eb3e22?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8YW1lcmljYW4lMjBmb290YmFsbHxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&w=1600&q=60" 
                    alt="Featured article" 
                    className="w-full h-[40vh] md:h-[50vh] object-cover"
                  />
                  <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 z-20 text-white">
                    <Badge className="mb-3 bg-primary hover:bg-primary text-white">Featured</Badge>
                    <h2 className="text-2xl md:text-4xl font-bold mb-2">Midseason Fantasy Football Awards: MVPs, Busts, and Breakouts</h2>
                    <p className="text-sm md:text-base mb-4 text-gray-200 max-w-3xl">
                      As we approach the halfway point of the fantasy season, we recognize the standouts, disappointments, and surprise performers that have shaped the fantasy landscape so far.
                    </p>
                    <div className="flex items-center space-x-4 text-sm">
                      <span>By Thomas Wright</span>
                      <span>•</span>
                      <span className="flex items-center">
                        <Calendar className="h-4 w-4 mr-1" /> Oct 20, 2023
                      </span>
                    </div>
                    <Button className="mt-4 group" variant="secondary">
                      Read Full Article <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Button>
                  </div>
                </div>
              </div>
              
              {/* News Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 my-8">
                {newsData.map((article, index) => (
                  <Card key={article.id} className={`overflow-hidden shadow-sm hover:shadow-md transition-shadow animated-element opacity-0 translate-y-4 transition-all duration-700 delay-${index * 100}`}>
                    <div className="aspect-video w-full overflow-hidden">
                      <img 
                        src={article.image} 
                        alt={article.title} 
                        className="w-full h-full object-cover transition-transform hover:scale-105 duration-700"
                      />
                    </div>
                    <CardHeader className="p-4 pb-0">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="text-xs">{article.category}</Badge>
                        <span className="text-xs text-muted-foreground flex items-center">
                          <Calendar className="h-3 w-3 mr-1" /> {article.date}
                        </span>
                      </div>
                      <CardTitle className="text-lg hover:text-primary transition-colors cursor-pointer">
                        {article.title}
                      </CardTitle>
                      <CardDescription className="mt-2 line-clamp-2">
                        {article.excerpt}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-2">
                      <p className="text-sm text-muted-foreground">By {article.author}</p>
                    </CardContent>
                    <CardFooter className="p-4 pt-0 flex justify-between">
                      <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                        <button className="flex items-center hover:text-primary transition-colors">
                          <MessageSquare className="h-4 w-4 mr-1" /> {article.comments}
                        </button>
                        <button className="flex items-center hover:text-primary transition-colors">
                          <ThumbsUp className="h-4 w-4 mr-1" /> {article.likes}
                        </button>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button className="p-1.5 rounded-full hover:bg-accent/10 transition-colors">
                          <Share2 className="h-4 w-4" />
                        </button>
                        <button className="p-1.5 rounded-full hover:bg-accent/10 transition-colors">
                          <Bookmark className="h-4 w-4" />
                        </button>
                      </div>
                    </CardFooter>
                  </Card>
                ))}
              </div>
              
              {/* Load More Button */}
              <div className="flex justify-center mt-8 mb-12">
                <Button variant="outline">
                  Load More Articles
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="analysis" className="mt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardContent className="p-6">
                    <Badge className="mb-3 bg-blue-100 text-blue-800 border-0">Deep Dive</Badge>
                    <h3 className="font-bold text-lg mb-2">Connor McDavid's Elite Performance Analysis</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      Breaking down McDavid's point production rate and advanced metrics that make him the #1 fantasy asset.
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>By Fantasy Pro • 2 hours ago</span>
                      <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Must Read</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardContent className="p-6">
                    <Badge className="mb-3 bg-purple-100 text-purple-800 border-0">Analytics</Badge>
                    <h3 className="font-bold text-lg mb-2">Goalie Usage Rate Impact on Fantasy</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      How starter/backup dynamics affect fantasy goalie performance and which tandems to target.
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>By Stats Guru • 4 hours ago</span>
                      <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Hot Take</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardContent className="p-6">
                    <Badge className="mb-3 bg-green-100 text-green-800 border-0">Power Play</Badge>
                    <h3 className="font-bold text-lg mb-2">Top PP Unit Changes This Week</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      Line shuffles that could create new fantasy value and players to watch on the man advantage.
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>By Line Watch • 6 hours ago</span>
                      <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Trending</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            
            <TabsContent value="injuries" className="mt-0">
              <div className="space-y-4">
                <Card className="border-l-4 border-l-red-500">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="destructive" className="text-xs">Day-to-Day</Badge>
                          <span className="text-sm text-muted-foreground">Updated 30 min ago</span>
                        </div>
                        <h3 className="font-bold text-lg mb-2">Auston Matthews - Upper Body Injury</h3>
                        <p className="text-muted-foreground mb-3">
                          Missed morning skate, questionable for tonight's game vs Edmonton. Monitor warmups closely.
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">Fantasy Impact: <strong className="text-foreground">High</strong></span>
                          <span className="text-muted-foreground">Return Timeline: <strong className="text-foreground">1-2 games</strong></span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-yellow-500">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700">Week-to-Week</Badge>
                          <span className="text-sm text-muted-foreground">Updated 2 hours ago</span>
                        </div>
                        <h3 className="font-bold text-lg mb-2">Cale Makar - Shoulder Injury</h3>
                        <p className="text-muted-foreground mb-3">
                          Expected to miss 2-3 weeks. Devon Toews likely to see increased ice time and PP1 opportunities.
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">Fantasy Impact: <strong className="text-foreground">Very High</strong></span>
                          <span className="text-muted-foreground">Return Timeline: <strong className="text-foreground">2-3 weeks</strong></span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-green-500">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="text-xs bg-green-100 text-green-800 border-0">Returning</Badge>
                          <span className="text-sm text-muted-foreground">Updated 45 min ago</span>
                        </div>
                        <h3 className="font-bold text-lg mb-2">David Pastrnak - Back to Practice</h3>
                        <p className="text-muted-foreground mb-3">
                          Full contact practice today. Expected to return Thursday vs Rangers on top line with fresh legs.
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">Fantasy Impact: <strong className="text-foreground">Positive</strong></span>
                          <span className="text-muted-foreground">Return Timeline: <strong className="text-foreground">Next game</strong></span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            
            <TabsContent value="strategy" className="mt-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Weekly Strategy Focus
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <h4 className="font-semibold mb-2">🔥 Hot Tip: Goalie Streamers</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Target backup goalies getting starts against weaker offensive teams. 
                        This week: Kahkonen vs ARI, Hill vs CHI.
                      </p>
                      <Badge className="bg-primary/10 text-primary border-0 text-xs">Win Rate: 73%</Badge>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                      <h4 className="font-semibold mb-2">📊 Line Combination Watch</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Monitor morning skates for line shuffles. New combinations often lead to 
                        short-term fantasy spikes before defenses adjust.
                      </p>
                      <Badge variant="outline" className="border-blue-500 text-blue-700 text-xs">Success Rate: 65%</Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Waiver Wire Targets</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div>
                          <div className="font-medium">Tyler Bertuzzi</div>
                          <div className="text-sm text-muted-foreground">LW/RW - TOR</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-green-600">+23% rostered</div>
                          <div className="text-xs text-muted-foreground">PP1 role</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div>
                          <div className="font-medium">Ukko-Pekka Luukkonen</div>
                          <div className="text-sm text-muted-foreground">G - BUF</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-green-600">+18% rostered</div>
                          <div className="text-xs text-muted-foreground">Hot streak</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div>
                          <div className="font-medium">Mason Marchment</div>
                          <div className="text-sm text-muted-foreground">LW/RW - DAL</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-green-600">+15% rostered</div>
                          <div className="text-xs text-muted-foreground">Line promotion</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            
            <TabsContent value="trades" className="mt-0">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Trade Market Pulse</CardTitle>
                    <CardDescription>Current market trends and player values</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div className="text-center p-4 rounded-lg bg-green-50 border border-green-200">
                        <div className="text-2xl font-bold text-green-600">📈</div>
                        <div className="text-sm font-medium mt-2">Buyers Market</div>
                        <div className="text-xs text-muted-foreground">Centers & Goalies</div>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-red-50 border border-red-200">
                        <div className="text-2xl font-bold text-red-600">📉</div>
                        <div className="text-sm font-medium mt-2">Sellers Market</div>
                        <div className="text-xs text-muted-foreground">Defensemen</div>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-yellow-50 border border-yellow-200">
                        <div className="text-2xl font-bold text-yellow-600">⚖️</div>
                        <div className="text-sm font-medium mt-2">Stable</div>
                        <div className="text-xs text-muted-foreground">Wingers</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Trade Targets 🎯</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="p-3 rounded-lg border-l-4 border-l-green-500 bg-green-50/50">
                        <div className="font-medium">Buy Low: Elias Pettersson</div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Slow start but usage remains elite. Perfect sell-high opportunity for nervous owners.
                        </p>
                        <div className="text-xs text-green-700 mt-2">Target Price: Mid-tier C + prospect</div>
                      </div>
                      
                      <div className="p-3 rounded-lg border-l-4 border-l-blue-500 bg-blue-50/50">
                        <div className="font-medium">Acquire: Power Play Specialists</div>
                        <p className="text-sm text-muted-foreground mt-1">
                          PP time is the strongest predictor of fantasy success. Target Quinn Hughes, Evan Bouchard.
                        </p>
                        <div className="text-xs text-blue-700 mt-2">ROI: +35% points on average</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Sell High 💰</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="p-3 rounded-lg border-l-4 border-l-orange-500 bg-orange-50/50">
                        <div className="font-medium">Cash In: Hot Streaks</div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Players on 5+ game point streaks typically regress. Package with consistent performer.
                        </p>
                        <div className="text-xs text-orange-700 mt-2">Window: 2-3 games usually</div>
                      </div>
                      
                      <div className="p-3 rounded-lg border-l-4 border-l-red-500 bg-red-50/50">
                        <div className="font-medium">Move: Aging Veterans</div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Players 32+ often hit walls mid-season. Sell while production is still strong.
                        </p>
                        <div className="text-xs text-red-700 mt-2">Risk: Injury and decline</div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          
          {/* Newsletter Section */}
          <div className="bg-accent/5 rounded-xl p-8 mb-12 animated-element opacity-0 translate-y-4 transition-all duration-700">
            <div className="max-w-2xl mx-auto text-center">
              <h3 className="text-2xl font-bold mb-3">Subscribe to our Fantasy Newsletter</h3>
              <p className="text-muted-foreground mb-6">
                Get weekly insights, waiver recommendations, and start/sit advice delivered to your inbox.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <input 
                  type="email" 
                  placeholder="Enter your email" 
                  className="px-4 py-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary min-w-[240px]"
                />
                <Button className="bg-primary hover:bg-primary/90">
                  Subscribe Now
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <Footer />
    </div>
  );
};

export default News;
