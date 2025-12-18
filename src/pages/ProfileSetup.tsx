import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, User, Mail, Phone, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const ProfileSetup = () => {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    // Always allow profile setup if username starts with 'user_' (auto-generated)
    // OR if profile doesn't exist yet
    if (profile?.username && !profile.username.startsWith('user_')) {
      // User already has a proper username, redirect to home
      navigate('/');
      return;
    }

    // If user has auto-generated username or no profile, allow them to set it up
    setChecking(false);
  }, [user, profile, navigate]);

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
      const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 = no rows found (which is fine)
        // Other errors might indicate table doesn't exist
        if (checkError.message?.includes('relation') || checkError.message?.includes('does not exist')) {
          throw new Error('Database not set up. Please run the Supabase migrations first.');
        }
        throw checkError;
      }

      if (existing) {
        setError('Username is already taken');
        setLoading(false);
        return;
      }

      // First, save the username (required field that definitely exists)
      const { error: usernameError } = await supabase
        .from('profiles')
        .upsert({
          id: user!.id,
          username: username.trim(),
        });

      if (usernameError) {
        throw usernameError;
      }

      // Then try to update optional fields if they exist
      // We'll do this in a separate call to avoid errors if columns don't exist
      const optionalFields: any = {};
      if (firstName.trim()) optionalFields.first_name = firstName.trim();
      if (lastName.trim()) optionalFields.last_name = lastName.trim();
      if (phone.trim()) optionalFields.phone = phone.trim();
      if (location.trim()) optionalFields.location = location.trim();

      // Only update optional fields if we have any to save
      if (Object.keys(optionalFields).length > 0) {
        const { error: optionalError } = await supabase
          .from('profiles')
          .update(optionalFields)
          .eq('id', user!.id);

        // Don't throw on optional field errors - they can be added later
        if (optionalError) {
          console.warn('Some optional fields could not be saved:', optionalError.message);
        }
      }

      // Success - refresh profile and redirect
      await refreshProfile();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
      setLoading(false);
    }
  };

  if (checking || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/20">
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">Set Up Your Profile</CardTitle>
            <CardDescription className="text-center">
              Complete your profile to get started
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
    </div>
  );
};

export default ProfileSetup;

