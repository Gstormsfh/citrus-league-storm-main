import { useMemo } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

interface PasswordStrengthProps {
  password: string;
}

export const PasswordStrength = ({ password }: PasswordStrengthProps) => {
  const strength = useMemo(() => {
    if (!password) return { level: 0, label: '', color: '' };

    let score = 0;
    const checks = {
      length: password.length >= 8,
      lowercase: /[a-z]/.test(password),
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^a-zA-Z0-9]/.test(password),
    };

    if (checks.length) score++;
    if (checks.lowercase) score++;
    if (checks.uppercase) score++;
    if (checks.number) score++;
    if (checks.special) score++;

    if (score <= 2) {
      return { level: 1, label: 'Weak', color: 'text-red-500', bgColor: 'bg-red-500' };
    } else if (score <= 3) {
      return { level: 2, label: 'Fair', color: 'text-yellow-500', bgColor: 'bg-yellow-500' };
    } else if (score <= 4) {
      return { level: 3, label: 'Good', color: 'text-blue-500', bgColor: 'bg-blue-500' };
    } else {
      return { level: 4, label: 'Strong', color: 'text-green-500', bgColor: 'bg-green-500' };
    }
  }, [password]);

  const checks = useMemo(() => {
    if (!password) return [];
    return [
      { label: 'At least 8 characters', met: password.length >= 8 },
      { label: 'Contains lowercase letter', met: /[a-z]/.test(password) },
      { label: 'Contains uppercase letter', met: /[A-Z]/.test(password) },
      { label: 'Contains number', met: /[0-9]/.test(password) },
      { label: 'Contains special character', met: /[^a-zA-Z0-9]/.test(password) },
    ];
  }, [password]);

  if (!password) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Password strength:</span>
        <span className={`text-xs font-medium ${strength.color}`}>{strength.label}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${strength.bgColor}`}
          style={{ width: `${(strength.level / 4) * 100}%` }}
        />
      </div>
      <div className="space-y-1 mt-2">
        {checks.map((check, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            {check.met ? (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            ) : (
              <XCircle className="h-3 w-3 text-muted-foreground" />
            )}
            <span className={check.met ? 'text-green-500' : 'text-muted-foreground'}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
