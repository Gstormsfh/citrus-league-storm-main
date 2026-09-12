#!/usr/bin/env python3
"""Operator-driven first activation/recovery. No default host or credentials.
Activation saves/fsyncs a private external backup before COMMIT. Recovery fails
closed on source CAS, protected data, schema, database or calendar changes.
"""
import argparse,hashlib,json,os,subprocess,uuid,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent

def run_transaction(command,request_json,operation,before_commit=None,rollback=False):
    errors=tempfile.TemporaryFile(mode='w+t')
    def error_text():
        errors.seek(0);return errors.read()[-8000:]
    proc=subprocess.Popen(command+['-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,text=True)
    delimiter='$request_'+uuid.uuid4().hex+'$'
    sql="BEGIN ISOLATION LEVEL READ COMMITTED;SET LOCAL client_min_messages='warning';CREATE TEMP TABLE recovery_request(payload jsonb) ON COMMIT DROP;INSERT INTO recovery_request VALUES("+delimiter+request_json+delimiter+'::jsonb);'
    sql+=(HERE/'context.sql').read_text()+(HERE/(operation+'.sql')).read_text()+"\nSELECT 'CANONICAL_RELEASE_READY';\n"
    try:
        proc.stdin.write(sql);proc.stdin.flush()
        last_json=None
        while True:
            line=proc.stdout.readline()
            if not line:raise RuntimeError('Database rejected transaction: '+error_text())
            if line.strip()=='CANONICAL_RELEASE_READY':break
            if line.startswith('{'):last_json=line.strip()
        if last_json is None:raise RuntimeError('Missing database result; refusing commit')
        if before_commit:before_commit(last_json)
        proc.stdin.write('ROLLBACK;\n' if rollback else 'COMMIT;\n');proc.stdin.close()
        output=proc.stdout.read();error=error_text();status=proc.wait()
        if status:raise RuntimeError('Commit outcome requires inspection using saved bundle: '+error+output)
        return json.loads(last_json)
    finally:
        if proc.poll() is None:
            # EOF/termination closes the session and rolls back an open transaction.
            proc.kill();proc.wait()
        errors.close()

def save_bundle(path,raw):
    envelope={'format':'citrus.first-publication-envelope.v1','sha256':hashlib.sha256(raw.encode()).hexdigest(),'bundle_json':raw}
    data=(json.dumps(envelope,ensure_ascii=False)+'\n').encode()
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'wb') as handle:handle.write(data);handle.flush();os.fsync(handle.fileno())
    descriptor=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(descriptor)
    finally:os.close(descriptor)

def load_bundle(path):
    e=json.loads(path.read_text());raw=e['bundle_json']
    if e.get('format')!='citrus.first-publication-envelope.v1' or hashlib.sha256(raw.encode()).hexdigest()!=e.get('sha256'):raise ValueError('Recovery envelope content hash mismatch')
    return raw

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('operation',choices=['activate','restore']);p.add_argument('--psql-command-json',required=True,help='Explicit JSON argv, e.g. ["psql","service=release"]. Prefer pg_service.conf; do not put passwords in argv.');p.add_argument('--bundle',type=Path,required=True);p.add_argument('--season',type=int);p.add_argument('--run-id');p.add_argument('--revision');a=p.parse_args()
    command=json.loads(a.psql_command_json)
    if not isinstance(command,list) or not command or not all(isinstance(x,str) for x in command):p.error('Explicit psql argv required')
    if a.operation=='activate':
        if not all([a.season,a.run_id,a.revision]):p.error('Activation requires season, run-id and exact reviewed revision')
        request=json.dumps({'season':a.season,'run_id':a.run_id,'revision':a.revision})
        result=run_transaction(command,request,'activate',lambda raw:save_bundle(a.bundle,raw))
        print(json.dumps({'committed':True,'bundle':str(a.bundle),'request':result['request'],'post_hashes':result['post_hashes']}))
    else:
        result=run_transaction(command,load_bundle(a.bundle),'restore');print(json.dumps({'committed':True,**result}))
if __name__=='__main__':main()
