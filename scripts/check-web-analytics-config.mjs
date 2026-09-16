// Production campaign reporting must not silently compile analytics out.
export function missingAnalyticsConfig(env) {
  return ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_MEASUREMENT_ID']
    .filter(key => typeof env[key] !== 'string' || !env[key].trim());
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const missing = missingAnalyticsConfig(process.env);
  if (missing.length) {
    console.error('Campaign analytics build blocked. Configure these variable names from the verified Firebase web app SDK settings:', missing.join(', '));
    process.exitCode = 1;
  }
}
