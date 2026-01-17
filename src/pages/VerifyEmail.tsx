import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';

const VerifyEmail = () => {
  const navigate = useNavigate();
  const { resendVerificationEmail, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = user?.email || '';

  const handleResend = async () => {
    if (!email) {
      setError('No email address found. Please sign in again.');
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6" />
            Verify Your Email
          </CardTitle>
          <CardDescription>
            We've sent a verification email to <strong>{email}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {success && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Verification email sent! Please check your inbox and click the link to verify your account.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Click the verification link in the email to activate your account. The link will expire after 24 hours.
            </p>
            <p className="text-sm text-muted-foreground">
              Didn't receive the email? Check your spam folder or click below to resend.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              onClick={handleResend}
              disabled={loading || success}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Resend Verification Email
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={() => navigate('/auth')}
              className="w-full"
            >
              Back to Sign In
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default VerifyEmail;
