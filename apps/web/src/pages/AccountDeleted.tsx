import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { interceptExternal } from '@/lib/openExternal';

/** Public: a deleted account must never need to sign back in for next steps. */
export default function AccountDeleted() {
  const { state } = useLocation();
  const confirmed = state?.deleted === true;
  const { signOut } = useAuth();
  const started = useRef(false);
  const [cleanup, setCleanup] = useState<'pending' | 'done' | 'failed'>('pending');
  const finishSignOut = async () => {
    setCleanup('pending');
    try {
      await signOut();
      setCleanup('done');
    } catch {
      setCleanup('failed');
    }
  };
  useEffect(() => {
    if (!confirmed || started.current) return;
    started.current = true;
    // This public route is mounted before SIGNED_OUT fires, so the auth guard
    // cannot replace the confirmation with a login redirect.
    void signOut().then(() => setCleanup('done'), () => setCleanup('failed'));
  }, [confirmed, signOut]);
  return (
    <main className="mx-auto max-w-xl px-6 py-16 space-y-6">
      <h1 className="text-3xl font-bold">{confirmed ? 'Your Citrus account has been deleted' : 'After deleting your Citrus account'}</h1>
      <p>{!confirmed ? 'You can delete your account from Account settings while signed in.'
        : cleanup === 'done' ? 'You are signed out of Citrus.'
          : cleanup === 'pending' ? 'Finishing sign-out on this device…'
            : 'Your account is deleted, but this device could not finish signing out. Retry below.'}</p>
      {confirmed && cleanup === 'failed' && <button className="block underline" onClick={() => void finishSignOut()}>Retry sign-out</button>}
      <h2 className="text-xl font-semibold">If you used Sign in with Apple</h2>
      <p>Also remove Citrus from your Apple Account: open Settings on your iPhone or iPad, tap your name, choose Sign in with Apple, select Citrus, then choose Delete and confirm Stop Using.</p>
      <p>This removes the remaining Apple authorization. Your Citrus account deletion does not depend on completing this step.</p>
      <a className="block underline" href="https://support.apple.com/102571" onClick={(event) => { if (interceptExternal('https://support.apple.com/102571')) event.preventDefault(); }}>Apple’s instructions for managing Sign in with Apple</a>
      <Link className="block underline" to="/auth">Return to sign in</Link>
    </main>
  );
}
