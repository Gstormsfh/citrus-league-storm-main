// Generate only the canonical SQL scorer from the same JSON imported by ScoringCalculator.
import {readFileSync,writeFileSync} from 'node:fs';
const path='supabase/migrations/20260912073240_canonical_projection_materialization.sql';
const stats=JSON.parse(readFileSync('packages/shared/src/constants/scoringDefaults.json','utf8')).stats;
const terms=group=>stats.filter(s=>s.group===group).map(s=>`coalesce((p_counts->>'${s.key}')::numeric,0)*(${s.points})`).join(' + ');
const generated=`CREATE FUNCTION public.canonical_default_points(p_counts jsonb,p_goalie boolean) RETURNS numeric\nLANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT CASE WHEN p_goalie THEN\n${terms('goalie')}\nELSE\n${terms('skater')}\nEND $$;`;
const existing=readFileSync(path,'utf8');
const next=existing.replace(/CREATE FUNCTION public\.canonical_default_points[\s\S]*?END \$\$;/,()=>generated);
if(process.argv.includes('--check')){if(next!==existing)throw new Error('Canonical SQL scoring is stale; run node scripts/gen-canonical-scoring.mjs');}
else writeFileSync(path,next);
