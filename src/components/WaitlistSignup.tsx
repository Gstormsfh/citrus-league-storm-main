// Waitlist Signup Component - Email collection form
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WaitlistService } from '@/services/WaitlistService';
import { CheckCircle, Loader2, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WaitlistSignupProps {
  source?: string;
  variant?: 'default' | 'compact' | 'inline';
  className?: string;
}

const WaitlistSignup = ({ source = 'landing_page', variant = 'default', className }: WaitlistSignupProps) => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      setStatus('error');
      setMessage('Please enter your email address');
      return;
    }

    setStatus('loading');
    setMessage('');

    const result = await WaitlistService.addToWaitlist(email.trim(), source);
    
    if (result.success) {
      setStatus('success');
      setMessage(result.message);
      setEmail(''); // Clear email on success
      // Reset success message after 5 seconds
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 5000);
    } else {
      setStatus('error');
      setMessage(result.message);
    }
  };

  const isCompact = variant === 'compact';
  const isInline = variant === 'inline';

  if (isInline) {
    return (
      <form onSubmit={handleSubmit} className={cn('flex gap-2', className)}>
        <Input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'loading' || status === 'success'}
          className="flex-1 min-w-[200px]"
        />
        <Button
          type="submit"
          disabled={status === 'loading' || status === 'success'}
          size="default"
        >
          {status === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : status === 'success' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            'Join Waitlist'
          )}
        </Button>
        {message && (
          <div className={cn(
            'absolute top-full left-0 right-0 mt-2 text-sm',
            status === 'success' ? 'text-citrus-sage' : 'text-citrus-orange'
          )}>
            {message}
          </div>
        )}
      </form>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      <form onSubmit={handleSubmit} className={cn(
        'flex flex-col gap-3',
        isCompact ? 'gap-2' : 'gap-4'
      )}>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === 'loading' || status === 'success'}
            className={cn(
              'flex-1',
              isCompact ? 'text-sm' : ''
            )}
          />
          <Button
            type="submit"
            disabled={status === 'loading' || status === 'success'}
            size={isCompact ? 'default' : 'lg'}
            className={cn(
              'whitespace-nowrap',
              isCompact ? '' : 'sm:w-auto'
            )}
          >
            {status === 'loading' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Adding...
              </>
            ) : status === 'success' ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Added!
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Join Waitlist
              </>
            )}
          </Button>
        </div>
        
        {message && (
          <div className={cn(
            'text-sm font-medium',
            status === 'success' ? 'text-citrus-sage' : 'text-citrus-orange'
          )}>
            {message}
          </div>
        )}
      </form>
    </div>
  );
};

export default WaitlistSignup;
