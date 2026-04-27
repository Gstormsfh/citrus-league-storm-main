import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, User, Mail, Phone, MapPin } from 'lucide-react';
import { accountApi } from '@/api/account';
import { DarkLayout, MascotAvatar } from '@/components/citrus2';

const ProfileSetup = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Wait for auth + profile to finish loading before deciding
    if (authLoading || profileLoading) return;

    if (!user) {
      navigate('/auth');
      return;
    }

    // Only redirect if profile is complete (has proper username)
    if (profile?.username && !profile.username.startsWith('user_')) {
      // User already has a proper username, redirect to home
      navigate('/');
      return;
    }

    // If user has auto-generated username or no profile, allow them to set it up
    setChecking(false);
  }, [user, profile, authLoading, profileLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores');
      return;
    }

    setLoading(true);

    try {
      // Check if username is already taken
      const { data: availability } = await accountApi.checkUsername(username);

      if (!availability.available) {
        setError('Username is already taken');
        setLoading(false);
        return;
      }

      // Save the username along with any optional fields in a single call
      const profileFields: Record<string, string> = {
        username: username.trim(),
      };
      if (firstName.trim()) profileFields.first_name = firstName.trim();
      if (lastName.trim()) profileFields.last_name = lastName.trim();
      if (phone.trim()) profileFields.phone = phone.trim();
      if (location.trim()) profileFields.location = location.trim();

      // Set display_name from first/last name if provided
      const displayParts = [firstName.trim(), lastName.trim()].filter(Boolean);
      if (displayParts.length > 0) {
        profileFields.display_name = displayParts.join(' ');
      }

      // mutateAsync triggers optimistic update + background refetch
      await updateProfile.mutateAsync(profileFields);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
      setLoading(false);
    }
  };

  if (checking || !user) {
    return (
      <DarkLayout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-pastel-orange-soft" />
        </div>
      </DarkLayout>
    );
  }

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
        <Card className="w-full max-w-2xl bg-[#1A2A20] border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <CardHeader className="space-y-3 text-center">
            <div className="flex justify-center mb-2">
              <MascotAvatar id="stormy" size="lg" />
            </div>
            <CardTitle className="text-2xl font-black text-pastel-cream tracking-[-0.02em]">
              Set up your <span className="text-pastel-orange">profile</span>
            </CardTitle>
            <CardDescription className="text-white/60">
              One last step before puck drop — name your manager profile
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="your_username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-10"
                      required
                      minLength={3}
                      pattern="[a-zA-Z0-9_]+"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Letters, numbers, and underscores only. 3+ characters.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      type="text"
                      placeholder="John"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      type="text"
                      placeholder="Smith"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="pl-10 bg-muted"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Email is set from your account
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+1 (555) 123-4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="location"
                      type="text"
                      placeholder="New York, NY"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Complete Setup'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </DarkLayout>
  );
};

export default ProfileSetup;
