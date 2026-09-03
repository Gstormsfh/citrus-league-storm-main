/**
 * The ONLY module that imports @sentry/react.
 *
 * config.ts loads this file lazily (`await import('./sdk')`) so the SDK stays
 * out of the eager bundle. It re-exports NAMED bindings on purpose: a dynamic
 * import of the package itself (`await import('@sentry/react')`) hands Rollup
 * a namespace object whose every property might be read at runtime, so nothing
 * in it can be tree-shaken. That is how replayIntegration, feedbackIntegration,
 * browserTracingIntegration and replayCanvas ended up in the vendor-sentry
 * chunk even though config.ts passes `integrations: []` and never calls them.
 *
 * With only these bindings exported, Rollup follows just their dependency
 * graph (every @sentry/* package declares "sideEffects": false), so the lazy
 * chunk carries what init/captureException/setUser need and nothing else.
 *
 * Add a binding here when config.ts needs another Sentry API. Never widen this
 * back to `export * from '@sentry/react'`; that is the namespace problem again.
 */
export { init, captureException, setUser } from '@sentry/react';
