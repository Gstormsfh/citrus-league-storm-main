import { userMessage } from '@/lib/userMessage';
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
    } catch (err: unknown) {
      // S-1 Entry 21 P-c fix (2026-08-09): typed `unknown` instead of
      // `any` (project standard; new code MUST NOT use `any` per
      // CLAUDE.md code standards).
      const message = userMessage(err, 'Failed to update profile');
      setError(message);
      setLoading(false);
    }
  };

  if (checking || !user) {
    return (
      <DarkLayout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-pastel-orange-soft" aria-hidden="true" />
        </div>
      </DarkLayout>
    );
  }

  return (
    <DarkLayout>
      {/* PRESS BOX BELOW lg (PR18 paint sweep, 2026-09-05). The first screen
          a new email signup sees after Auth, re-skinned the same way Auth
          is: one tree, `max-lg:` classes, every id and handler the same
          element on both layers. The desktop keeps the card from lg. */}
      <div className="hidden lg:block"><Navbar /></div>
      <main className="pb-type-phone relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)] max-lg:min-h-screen max-lg:bg-pressbox-surface max-lg:text-pressbox-text max-lg:px-5 max-lg:pt-[calc(2.5rem+env(safe-area-inset-top))] max-lg:pb-app-chrome">
        <Card className="w-full max-w-2xl bg-pastel-surface-tile border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] max-lg:bg-transparent max-lg:border-0 max-lg:ring-0 max-lg:shadow-none max-lg:rounded-none">
          <CardHeader className="space-y-3 text-center max-lg:p-0 max-lg:pb-6">
            <div className="flex justify-center mb-2">
              <MascotAvatar id="stormy" size="lg" />
            </div>
            <CardTitle className="text-2xl font-black text-pastel-cream tracking-[-0.02em] max-lg:font-condensed max-lg:font-extrabold max-lg:text-[28px] max-lg:uppercase max-lg:tracking-[0.02em] max-lg:text-pressbox-text">
              Set up your <span className="text-pastel-orange max-lg:text-pressbox-orange-soft">profile</span>
            </CardTitle>
            <CardDescription className="text-white/60 max-lg:font-barlow max-lg:text-[13px] max-lg:text-pressbox-text/60">
              One last step before puck drop. Name your manager profile
            </CardDescription>
          </CardHeader>
          <CardContent className="max-lg:p-0">
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username" className="max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:uppercase max-lg:text-pressbox-text/55">Username *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground max-lg:top-1/2 max-lg:-translate-y-1/2 max-lg:text-pressbox-text/45" aria-hidden="true" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="your_username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-10 max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:font-barlow max-lg:text-[15px] max-lg:text-pressbox-text max-lg:placeholder:text-pressbox-text/40"
                      required
                      minLength={3}
                      pattern="[a-zA-Z0-9_]+"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground max-lg:font-barlow max-lg:text-[12px] max-lg:text-pressbox-text/50">
                    Letters, numbers, and underscores only. 3+ characters.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:uppercase max-lg:text-pressbox-text/55">First Name</Label>
                    <Input
                      id="firstName"
                      type="text"
                      placeholder="John"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:font-barlow max-lg:text-[15px] max-lg:text-pressbox-text max-lg:placeholder:text-pressbox-text/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:uppercase max-lg:text-pressbox-text/55">Last Name</Label>
                    <Input
                      id="lastName"
                      type="text"
                      placeholder="Smith"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:font-barlow max-lg:text-[15px] max-lg:text-pressbox-text max-lg:placeholder:text-pressbox-text/40"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:uppercase max-lg:text-pressbox-text/55">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground max-lg:top-1/2 max-lg:-translate-y-1/2 max-lg:text-pressbox-text/45" aria-hidden="true" />
                    <Input
                      id="email"
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="pl-10 bg-muted max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:font-barlow max-lg:text-[15px] max-lg:text-pressbox-text max-lg:placeholder:text-pressbox-text/40 max-lg:opacity-60"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground max-lg:font-barlow max-lg:text-[12px] max-lg:text-pressbox-text/50">
                    Email is set from your account
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:uppercase max-lg:text-pressbox-text/55">Phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground max-lg:top-1/2 max-lg:-translate-y-1/2 max-lg:text-pressbox-text/45" aria-hidden="true" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+1 (555) 123-4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-10 max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:font-barlow max-lg:text-[15px] max-lg:text-pressbox-text max-lg:placeholder:text-pressbox-text/40"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location" className="max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:uppercase max-lg:text-pressbox-text/55">Location</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground max-lg:top-1/2 max-lg:-translate-y-1/2 max-lg:text-pressbox-text/45" aria-hidden="true" />
                    <Input
                      id="location"
                      type="text"
                      placeholder="New York, NY"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="pl-10 max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:font-barlow max-lg:text-[15px] max-lg:text-pressbox-text max-lg:placeholder:text-pressbox-text/40"
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full max-lg:h-12 max-lg:rounded-[12px] max-lg:border-0 max-lg:outline-none max-lg:shadow-none max-lg:bg-pressbox-orange max-lg:text-pressbox-orange-ink max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.08em] max-lg:uppercase" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Saving…
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
