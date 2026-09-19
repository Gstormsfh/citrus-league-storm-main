import type { MiddlewareHandler } from 'hono';
import type { Env } from '../app';

/** Product separation, NOT authentication. JWT, membership and entitlement
 * checks still apply. Origin is not a trustworthy access-control credential.
 * The bundled native client must also exclude these features and links. */
export const websiteDraftKit: MiddlewareHandler<Env> = async (c,next) => {
  const origin=c.req.header('Origin');
  if (origin && ['capacitor://localhost','ionic://localhost','https://localhost'].includes(origin)) {
    c.header('Cache-Control','private, no-store');
    return c.json({error:{code:'NOT_FOUND',message:'Not found'}},404);
  }
  return next();
};
