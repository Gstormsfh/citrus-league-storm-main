import { Link, useLocation } from 'react-router-dom';
import { interceptExternal } from '@/lib/openExternal';

/** Public: a deleted account must never need to sign back in for next steps. */
export default function AccountDeleted() {
  const { state } = useLocation();
  const confirmed = state?.deleted === true;
  return (
    <main className="mx-auto max-w-xl px-6 py-16 space-y-6">
      <h1 className="text-3xl font-bold">{confirmed ? 'Your Citrus account has been deleted' : 'After deleting your Citrus account'}</h1>
      <p>{confirmed ? 'You are signed out of Citrus.' : 'You can delete your account from Account settings while signed in.'}</p>
      <h2 className="text-xl font-semibold">If you used Sign in with Apple</h2>
      <p>Also remove Citrus from your Apple Account: open Settings on your iPhone or iPad, tap your name, choose Sign in with Apple, select Citrus, then choose Delete and confirm Stop Using.</p>
      <p>This removes the remaining Apple authorization. Your Citrus account deletion does not depend on completing this step.</p>
      <a className="block underline" href="https://support.apple.com/102571" onClick={(event) => { if (interceptExternal('https://support.apple.com/102571')) event.preventDefault(); }}>Apple’s instructions for managing Sign in with Apple</a>
      <Link className="block underline" to="/auth">Return to sign in</Link>
    </main>
  );
}
