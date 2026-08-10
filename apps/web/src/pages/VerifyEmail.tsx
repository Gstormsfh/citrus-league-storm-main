import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';
import { DarkLayout, MascotAvatar } from '@/components/citrus2';

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

  // T12P-2 (Entry 39 hostile pass, 2026-08-10): already-verified users
  // hitting this page (stale email link, browser back-nav, bookmark) get
  // sent home instead of stranded on a "Check Your Email" card they no
  // longer need. `email_confirmed_at` guards the rare session-without-
  // confirmation edge — still show the verify card there.
  useEffect(() => {
    if (user?.email_confirmed_at) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const handleResend = async () => {
    if (!email) {
      setError("We don't have your email — sign up again to get a fresh link.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error } = await resendVerificationEmail(email);

      if (error) {
        setError(error.message || "Couldn't send that link — try again in a moment.");
      } else {
        setSuccess(true);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "That resend hit a snag — try again in a moment.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
        <Card className="w-full max-w-md bg-pastel-surface-tile border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <MascotAvatar id="stormy" size="lg" />
            </div>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" aria-hidden="true" />
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
            {/* S-1 Entry 21 P-a fix (2026-08-09): inline warning when we
                have NO email context. Pre-fix the user only saw this
                message AFTER clicking Resend (error state). Surface it
                immediately so they know why the Resend button won't
                help them — signup flow got interrupted; they need to
                start over. */}
            {!email && (
              <Alert className="bg-pastel-orange/15 ring-1 ring-pastel-orange/40 border-0 text-pastel-orange-soft">
                <AlertDescription>
                  We don't have your email on file. Please <a href="/auth" className="underline font-semibold">sign up again</a> to receive a fresh verification link.
                </AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Sending…
                  </>
                ) : success ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Email Sent
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
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
    </DarkLayout>
  );
};

export default VerifyEmail;
