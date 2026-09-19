import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { createUserClient, supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ok, handleError } from '../lib/responses';
import { DraftKitAccessService } from '../services/DraftKitAccessService';
import { ExternalDraftGatewayService, type ExternalDraftRequest } from '../services/ExternalDraftGatewayService';
import { AuditService } from '../services/AuditService';

const requestSchema=z.object({
  platform:z.enum(['yahoo','espn']),leagueId:z.string().min(1).max(30),season:z.number().int().min(2000).max(2100),
  credentials:z.object({espnS2:z.string().min(20).max(4000).regex(/^[^\r\n;]+$/),swid:z.string().regex(/^\{[0-9a-fA-F-]{36}\}$/)}).strict().optional(),
}).strict().refine(v=>v.platform==='yahoo'?/^\d{1,6}\.l\.[1-9]\d{0,11}$/.test(v.leagueId)&&!v.credentials:/^[1-9]\d{0,11}$/.test(v.leagueId));
const enabled=(platform:'yahoo'|'espn')=>process.env[`DRAFT_KIT_${platform.toUpperCase()}_SYNC_ENABLED`]==='true';
export const draftKitExternalRoutes=new Hono<Env>();
draftKitExternalRoutes.use('*',bodyLimit({maxSize:8192}));
draftKitExternalRoutes.use('*',authMiddleware);
draftKitExternalRoutes.use('*',rateLimitMiddleware({name:'external-draft',maxRequests:600,maxUserRequests:12,windowMs:60000}));
draftKitExternalRoutes.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
draftKitExternalRoutes.get('/capabilities',c=>ok(c,{yahoo:enabled('yahoo'),espn:enabled('espn'),pollAfterMs:15000}));
for(const action of ['open','snapshot'] as const)draftKitExternalRoutes.post('/'+action,async c=>{
  try {
    const parsed=requestSchema.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw AppError.badRequest('Check the platform, league ID and season.');
    if(!enabled(parsed.data.platform))throw AppError.serviceUnavailable('This external draft connection has not completed live verification yet.');
    const db=createUserClient(c.get('userToken')),userId=c.get('userId');
    const access=new DraftKitAccessService(db);
    if(!(await access.access(userId)).active)throw AppError.forbidden('An active draft kit is required.');
    const result=await new ExternalDraftGatewayService(db,supabaseAdmin)[action](userId,parsed.data as ExternalDraftRequest);
    if(!(await access.access(userId)).active)throw AppError.forbidden('Your draft-kit access has changed.');
    if(action==='open')await new AuditService(db).log('DATA_EXPORT',null,{action:'external_draft_open',platform:parsed.data.platform,season:parsed.data.season});
    return ok(c,result);
  } catch(error) {
    // Provider errors must never echo their request, credentials or raw body.
    return handleError(c,error instanceof AppError?error:AppError.badGateway('The draft source could not be reached. Existing picks have not been cleared.'),'Could not read external draft');
  }
});
