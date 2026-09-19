import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { strictRateLimit } from '../middleware/rateLimit';
import { createUserClient } from '../lib/supabase';
import { ok, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';
import { DraftKitAccessService } from '../services/DraftKitAccessService';
import { DraftKitExportService, DOWNLOADS } from '../services/DraftKitExportService';
import { AuditService } from '../services/AuditService';

export const draftKitPdfRoutes = new Hono<Env>();
draftKitPdfRoutes.use('*',bodyLimit({maxSize:32768}));
draftKitPdfRoutes.get('/offer',async(c)=>{
  let deliveryReady=false;
  try{await new DraftKitExportService().configuration();deliveryReady=true;}catch{/* Fail closed. */}
  // Checkout's /offer owns price and terms. This endpoint only certifies that
  // the download worker has a reviewed edition; it cannot enable sales.
  c.header('Cache-Control','no-store');
  return ok(c,{available:false,deliveryReady,accessUntil:null,updatesUntil:null,termsUrl:null});
});
draftKitPdfRoutes.get('/access',authMiddleware,async(c)=>{
  try{c.header('Cache-Control','private, no-store');return ok(c,await new DraftKitAccessService(createUserClient(c.get('userToken'))).access(c.get('userId')));}
  catch(error){return handleError(c,error,'Could not check download access');}
});
draftKitPdfRoutes.get('/configuration',authMiddleware,async(c)=>{
  try {
    const service=new DraftKitAccessService(createUserClient(c.get('userToken')));
    if(!(await service.access(c.get('userId'))).active)throw AppError.forbidden('Purchase this edition to customize your downloads.');
    c.header('Cache-Control','private, no-store');
    return ok(c,await new DraftKitExportService().configuration());
  } catch(error){return handleError(c,error,'Could not load download settings');}
});
const downloadRequest=z.object({
  format:z.enum(['pdf','tracker','cheatsheet','csv','desk']),league:z.string().trim().min(1).max(64),
  weights:z.object({skater:z.record(z.number().finite().min(-10000).max(10000)),goalie:z.record(z.number().finite().min(-10000).max(10000))}).strict(),
}).strict();
draftKitPdfRoutes.post('/download',authMiddleware,strictRateLimit,async(c)=>{
  try {
    const db=createUserClient(c.get('userToken'));
    const service=new DraftKitAccessService(db);
    if(!(await service.access(c.get('userId'))).active)throw AppError.forbidden('Purchase this edition to download your kit.');
    const body=await c.req.json().catch(()=>{throw AppError.badRequest('Send valid JSON download settings.');});
    const parsed=downloadRequest.safeParse(body);
    if(!parsed.success)throw AppError.badRequest('Check the league name, format and scoring settings.');
    const {format,league,weights}=parsed.data;
    const bytes=await new DraftKitExportService().download(format,league,weights);
    // Recheck after a long render so expiry or a refund during generation does not bypass the gate.
    if(!(await service.access(c.get('userId'))).active)throw AppError.forbidden('Download access has changed. Please refresh your purchase status.');
    await new AuditService(db).log('DATA_EXPORT',null,{action:'draft_kit_download',format,bytes:bytes.length});
    c.header('Cache-Control','private, no-store');
    return ok(c,{filename:DOWNLOADS[format][0],mime:DOWNLOADS[format][1],base64:bytes.toString('base64')});
  } catch(error){return handleError(c,error,'Could not generate download');}
});
