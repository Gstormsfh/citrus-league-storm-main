import { Navigate } from 'react-router-dom';

/**
 * Settings page now consolidated into Profile → Settings tab.
 * This component redirects for backwards compatibility.
 */
const Settings = () => {
  return <Navigate to="/profile?tab=settings" replace />;
};

export default Settings;
