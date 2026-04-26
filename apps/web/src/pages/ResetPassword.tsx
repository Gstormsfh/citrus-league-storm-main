import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { DarkLayout } from '@/components/citrus2';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { updatePassword } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    // Check if we have a password reset token in the URL
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');

    if (accessToken && type === 'recovery') {
      setHasToken(true);
    } else {
      // Check query params as fallback
      const token = searchParams.get('token');
      if (token) {
        setHasToken(true);
      } else {
        setError('Invalid or expired reset link. Please request a new password reset.');
      }
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { error } = await updatePassword(password);

      if (error) {
        setError(error.message || 'Failed to update password. The link may have expired.');
      } else {
        setSuccess(true);
        setTimeout(() => {
          navigate('/auth');
        }, 2000);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Password Reset Successful
            </CardTitle>
            <CardDescription>Your password has been updated successfully.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription>Redirecting to sign in...</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasToken) {
    return (
      <DarkLayout>
        <Navbar />
        <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
          <Card className="w-full max-w-md bg-[#1A2A20] border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-pastel-cream">
                <XCircle className="h-5 w-5 text-pastel-orange" />
                Invalid Reset Link
              </CardTitle>
              <CardDescription className="text-white/60">{error || 'This password reset link is invalid or has expired.'}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/auth')} className="w-full bg-pastel-orange text-white hover:bg-pastel-orange-deep">
                Return to Sign In
              </Button>
            </CardContent>
          </Card>
        </main>
      </DarkLayout>
    );
  }

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
        <Card className="w-full max-w-md bg-[#1A2A20] border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-pastel-cream">Reset Your Password</CardTitle>
            <CardDescription className="text-white/60">Enter your new password below</CardDescription>
          </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  minLength={8}
                />
              </div>
              {password && <PasswordStrength password={password} />}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating password...

              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      </main>
    </DarkLayout>
  );
};

export default ResetPassword;
