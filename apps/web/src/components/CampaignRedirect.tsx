import { Navigate, useLocation, useParams } from 'react-router-dom';

/** Also resolve campaign links when an installed worker serves the SPA shell. */
export function CampaignRedirect() {
  const { handle } = useParams();
  const { search } = useLocation();
  const query = new URLSearchParams(search);
  if (handle && /^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(handle)) {
    query.set('ref', handle.toLowerCase());
  }
  const suffix = query.toString();
  return <Navigate replace to={suffix ? `/?${suffix}` : '/'} />;
}
