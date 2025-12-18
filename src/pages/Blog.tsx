
import { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Sample blog posts data
const blogPosts = [
  {
    id: 1,
    title: "Top 10 Draft Strategies for the Upcoming Season",
    excerpt: "Learn the most effective draft strategies to give your team the edge this fantasy season...",
    image: "https://images.unsplash.com/photo-1566577134770-3d85bb3a9cc4?q=80&w=800&auto=format&fit=crop",
    category: "Draft Strategy",
    date: "April 2, 2025",
    author: "Alex Johnson",
    tags: ["draft", "strategy"]
  },
  {
    id: 2,
    title: "Analyzing Player Performance: The Metrics That Matter",
    excerpt: "Discover which statistics actually predict future success and which ones are just noise...",
    image: "https://images.unsplash.com/photo-1569591159212-b02ea8a9f239?q=80&w=800&auto=format&fit=crop",
    category: "Analytics",
    date: "March 28, 2025",
    author: "Samantha Lee",
    tags: ["analytics", "performance"]
  },
  {
    id: 3,
    title: "Injury Report Updates: What You Need to Know This Week",
    excerpt: "Stay ahead of the competition with the latest injury updates and how they affect your roster decisions...",
    image: "https://images.unsplash.com/photo-1617777938240-9a1d8e3ba07c?q=80&w=800&auto=format&fit=crop",
    category: "Injuries",
    date: "March 25, 2025",
    author: "Carlos Rodriguez",
    tags: ["injuries", "updates"]
  },
  {
    id: 4,
    title: "Free Agent Watch: Hidden Gems on the Waiver Wire",
    excerpt: "Explore undervalued players that could provide a significant boost to your team's performance...",
    image: "https://images.unsplash.com/photo-1575361204480-aadea25e6e68?q=80&w=800&auto=format&fit=crop",
    category: "Free Agents",
    date: "March 20, 2025",
    author: "Taylor Kim",
    tags: ["free agents", "waiver wire"]
  },
  {
    id: 5,
    title: "Mid-Season Strategy Adjustments Every GM Should Consider",
    excerpt: "Fine-tune your approach as the season progresses with these expert recommendations...",
    image: "https://images.unsplash.com/photo-1562519819-016930be069d?q=80&w=800&auto=format&fit=crop",
    category: "Strategy",
    date: "March 15, 2025",
    author: "Morgan Williams",
    tags: ["strategy", "mid-season"]
  },
  {
    id: 6,
    title: "The Psychology of Fantasy Sports: Mental Game Tips",
    excerpt: "Explore the psychological aspects of fantasy sports management and how to maintain your edge...",
    image: "https://images.unsplash.com/photo-1577471488278-16eec37ffcc2?q=80&w=800&auto=format&fit=crop",
    category: "Psychology",
    date: "March 10, 2025",
    author: "Jordan Patel",
    tags: ["mental game", "psychology"]
  }
];

const categories = ["All", "Draft Strategy", "Analytics", "Injuries", "Free Agents", "Strategy", "Psychology"];

const Blog = () => {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  
  const filteredPosts = blogPosts.filter(post => {
    // Filter by category
    if (activeCategory !== "All" && post.category !== activeCategory) {
      return false;
    }
    
    // Filter by search term
    if (searchTerm && !post.title.toLowerCase().includes(searchTerm.toLowerCase()) && 
        !post.excerpt.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    
    return true;
  });
  
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-10 animated-element">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 vibrant-gradient-1 bg-clip-text text-transparent">
              CitrusSports Blog
            </h1>
            <p className="text-lg text-muted-foreground">
              Expert insights, tips, and analysis to take your fantasy game to the next level
            </p>
          </div>
          
          <div className="mb-8 max-w-4xl mx-auto animated-element">
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <Input 
                placeholder="Search articles..." 
                className="pl-10" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div className="mb-8 animated-element">
            <Tabs defaultValue="All" className="w-full" onValueChange={setActiveCategory}>
              <TabsList className="mb-4 w-full h-auto flex flex-wrap justify-center gap-2 bg-transparent">
                {categories.map((category) => (
                  <TabsTrigger 
                    key={category}
                    value={category}
                    className="data-[state=active]:bg-primary data-[state=active]:text-white px-4 py-2 rounded-full"
                  >
                    {category}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-10">
            {filteredPosts.map((post, index) => (
              <Card key={post.id} className={`overflow-hidden animated-element card-hover`}>
                <div className="h-48 overflow-hidden">
                  <img 
                    src={post.image} 
                    alt={post.title} 
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                </div>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-1 bg-[hsl(var(--vibrant-orange))/10] text-[hsl(var(--vibrant-orange))] text-xs rounded-full">
                      {post.category}
                    </span>
                    <span className="text-xs text-muted-foreground">{post.date}</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">{post.title}</h3>
                  <p className="text-muted-foreground mb-4">{post.excerpt}</p>
                </CardContent>
                <CardFooter className="px-6 pb-6 pt-0 flex justify-between items-center">
                  <div className="text-sm text-muted-foreground">By {post.author}</div>
                  <Button variant="link" className="p-0 text-[hsl(var(--vibrant-purple))]">
                    Read More →
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
          
          <div className="flex justify-center animated-element">
            <Button className="btn-vibrant-peach">
              Load More Articles
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Blog;
