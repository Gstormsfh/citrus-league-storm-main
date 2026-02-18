import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#D4E8B8] p-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold text-[#2E7D32] mb-2 font-[Bangers]">404</div>
        <h1 className="text-2xl font-semibold text-gray-800 mb-2">
          Offsides!
        </h1>
        <p className="text-gray-600 mb-6">
          Looks like this page got called for a penalty. Let's get you back in the game.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            onClick={() => navigate("/")}
            className="bg-[#2E7D32] hover:bg-[#1B5E20] text-white"
          >
            Back to Home
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
          >
            Go Back
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
