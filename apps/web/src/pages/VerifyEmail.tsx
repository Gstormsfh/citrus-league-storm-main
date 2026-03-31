import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';

const VerifyEmail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { resendVerificationEmail, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefer email from navigation state (set during signup before session exists),
  // fall back to the authenticated user's email if they're already signed in.
  const email = (location.state as { email?: string } | null)?.email || user?.email || '';

  const handleResend = async () => {
    if (!email) {
      setError('No email address found. Please sign up again.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error } = await resendVerificationEmail(email);

      if (error) {
        setError(error.message || 'Failed to send verification email. Please try again.');
      } else {
        setSuccess(true);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/20">
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold">Check Your Email</CardTitle>
            <CardDescription>
              {email ? (
                <>We've sent a verification link to <strong className="text-foreground">{email}</strong></>
              ) : (
                'We\'ve sent you a verification link'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {success && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Verification email sent! Check your inbox and click the link to verify your account.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2 text-center">
              <p className="text-sm text-muted-foreground">
                Click the verification link in the email to activate your Citrus Fantasy Sports account. The link expires after 24 hours.
              </p>
              <p className="text-sm text-muted-foreground">
                Didn't receive it? Check your spam folder or click below to resend.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                onClick={handleResend}
                disabled={loading || success}
                variant="outline"
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : success ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Email Sent
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Resend Verification Email
                  </>
                )}
              </Button>

              <Button
                variant="ghost"
                onClick={() => navigate('/auth')}
                className="w-full"
              >
                Back to Sign In
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default VerifyEmail;
