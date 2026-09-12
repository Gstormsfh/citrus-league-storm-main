"""Align relevant snapshot columns with the pinned read-only production catalog export."""
import json,subprocess,sys
from pathlib import Path
container=sys.argv[1]
query="select json_agg(x) from (select c.relname table_name,a.attname column_name,format_type(a.atttypid,a.atttypmod) data_type from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped) x"
local=json.loads(subprocess.check_output(['docker','exec',container,'psql','-U','postgres','-d','postgres','-Atc',query],text=True))
by={(r['table_name'],r['column_name']):r for r in local}
prod=json.loads(Path(__file__).with_name('production-columns-20260912.json').read_text())
statements=[]
for r in prod:
 key=(r['table_name'],r['column_name']);prefix=f'ALTER TABLE public."{key[0]}"'
 if key not in by:
  statements.append(f'{prefix} ADD COLUMN "{key[1]}" {r["data_type"]}'+(f' DEFAULT {r["default_expression"]}' if r['default_expression'] is not None else '')+(' NOT NULL' if r['not_null'] else '')+';')
 elif by[key]['data_type']!=r['data_type']:
  statements.append(f'{prefix} ALTER COLUMN "{key[1]}" TYPE {r["data_type"]};')
print('\n'.join(statements))
