import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DarkLayout, HockeyFooter } from '@/components/citrus2';
import { adminApi } from '@/api/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

interface PlatformStats {
  totalUsers: number;
  totalLeagues: number;
  activeDrafts: number;
}

interface HealthCheck {
  status: string;
  version: string;
  uptime: number;
  checks: Record<string, string>;
}

interface PipelineStatus {
  latestGameDate: string | null;
  latestGameUpdate: string | null;
  latestProjectionDate: string | null;
  latestProjectionUpdate: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleString();
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const Admin = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);

  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);

  const [leagues, setLeagues] = useState<any[]>([]);
  const [leagueSearch, setLeagueSearch] = useState('');
  const [leaguePage, setLeaguePage] = useState(1);
  const [leagueTotal, setLeagueTotal] = useState(0);

  const [auditLog, setAuditLog] = useState<any[]>([]);

  const loadDashboard = useCallback(async () => {
    try {
      const [statsRes, pipelineRes, healthRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.getPipelineStatus(),
        adminApi.getHealth(),
      ]);
      setStats(statsRes.data as PlatformStats);
      setPipeline(pipelineRes.data as PipelineStatus);
      setHealth(healthRes as any);
      setAuthorized(true);
    } catch (err: any) {
      if (err.status === 403) {
        toast({ title: 'Access Denied', description: 'Admin privileges required.', variant: 'destructive' });
        navigate('/');
        return;
      }
      toast({ title: 'Error', description: 'Failed to load admin dashboard.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [navigate, toast]);

  useEffect(() => {
    if (user) loadDashboard();
  }, [user, loadDashboard]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await adminApi.getUsers({ page: userPage, limit: 25, search: userSearch || undefined });
      setUsers((res.data || []) as any[]);
      setUserTotal(res.pagination?.total || 0);
    } catch { /* authorized check already passed */ }
  }, [userPage, userSearch]);

  const loadLeagues = useCallback(async () => {
    try {
      const res = await adminApi.getLeagues({ page: leaguePage, limit: 25, search: leagueSearch || undefined });
      setLeagues((res.data || []) as any[]);
      setLeagueTotal(res.pagination?.total || 0);
    } catch { /* silent */ }
  }, [leaguePage, leagueSearch]);

  const loadAuditLog = useCallback(async () => {
    try {
      const res = await adminApi.getAuditLog(100);
      setAuditLog((res.data || []) as any[]);
    } catch { /* silent */ }
  }, []);

  if (loading) {
    return (
      <DarkLayout>


      <Navbar />
      <main className="max-w-[1280px] mx-auto py-12 px-6">
          <div className="text-center font-jbmono text-[12px] tracking-wider uppercase text-white/45">Loading admin panel...</div>
        </main>
      </DarkLayout>
    );
  }

  if (!authorized) return null;

  return (
    <DarkLayout>


      <Navbar />
      <main className="relative max-w-[1280px] mx-auto py-8 px-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-sans font-black text-[2.25rem] tracking-[-0.025em] text-pastel-cream">Admin Dashboard</h1>
          <Badge variant="outline" className="text-xs">
            {health?.status === 'ok' ? 'API Healthy' : 'API Degraded'}
          </Badge>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-white/55">Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.totalUsers?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-white/55">Total Leagues</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.totalLeagues?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-white/55">Active Drafts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.activeDrafts || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-white/55">Server Uptime</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{health?.uptime ? formatUptime(health.uptime) : 'N/A'}</div>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline Health */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Data Pipeline Status</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-white/55">Latest Game Date:</span>{' '}<span className="font-medium">{pipeline?.latestGameDate || 'N/A'}</span></div>
              <div><span className="text-white/55">Game Data Updated:</span>{' '}<span className="font-medium">{formatDate(pipeline?.latestGameUpdate ?? null)}</span></div>
              <div><span className="text-white/55">Latest Projection Date:</span>{' '}<span className="font-medium">{pipeline?.latestProjectionDate || 'N/A'}</span></div>
              <div><span className="text-white/55">Projections Updated:</span>{' '}<span className="font-medium">{formatDate(pipeline?.latestProjectionUpdate ?? null)}</span></div>
            </div>
            {health?.checks && (
              <div className="mt-4 flex gap-2 flex-wrap">
                {Object.entries(health.checks).map(([name, status]) => (
                  <Badge key={name} variant={status === 'ok' ? 'default' : 'destructive'}>{name}: {status}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabs: Users, Leagues, Audit Log */}
        <Tabs defaultValue="users" onValueChange={(val) => {
          if (val === 'users') loadUsers();
          if (val === 'leagues') loadLeagues();
          if (val === 'audit') loadAuditLog();
        }}>
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="leagues">Leagues</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="Search users..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setUserPage(1); loadUsers(); } }} className="max-w-sm" />
              <Button onClick={() => { setUserPage(1); loadUsers(); }} variant="secondary">Search</Button>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Username</TableHead><TableHead>Name</TableHead><TableHead>Joined</TableHead><TableHead>ID</TableHead></TableRow></TableHeader>
              <TableBody>
                {users.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.username || '—'}</TableCell>
                    <TableCell>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</TableCell>
                    <TableCell>{formatDate(u.created_at)}</TableCell>
                    <TableCell className="text-xs text-white/55 font-mono">{u.id?.slice(0, 8)}...</TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-white/55">No users found</TableCell></TableRow>}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between text-sm text-white/55">
              <span>{userTotal} total</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={userPage <= 1} onClick={() => { setUserPage(p => p - 1); loadUsers(); }}>Prev</Button>
                <span className="py-1">Page {userPage}</span>
                <Button size="sm" variant="outline" disabled={users.length < 25} onClick={() => { setUserPage(p => p + 1); loadUsers(); }}>Next</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="leagues" className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="Search leagues..." value={leagueSearch} onChange={(e) => setLeagueSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setLeaguePage(1); loadLeagues(); } }} className="max-w-sm" />
              <Button onClick={() => { setLeaguePage(1); loadLeagues(); }} variant="secondary">Search</Button>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Draft Status</TableHead><TableHead>Created</TableHead><TableHead>ID</TableHead></TableRow></TableHeader>
              <TableBody>
                {leagues.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell><Badge variant={l.draft_status === 'completed' ? 'default' : 'outline'}>{l.draft_status || 'pending'}</Badge></TableCell>
                    <TableCell>{formatDate(l.created_at)}</TableCell>
                    <TableCell className="text-xs text-white/55 font-mono">{l.id?.slice(0, 8)}...</TableCell>
                  </TableRow>
                ))}
                {leagues.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-white/55">No leagues found</TableCell></TableRow>}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between text-sm text-white/55">
              <span>{leagueTotal} total</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={leaguePage <= 1} onClick={() => { setLeaguePage(p => p - 1); loadLeagues(); }}>Prev</Button>
                <span className="py-1">Page {leaguePage}</span>
                <Button size="sm" variant="outline" disabled={leagues.length < 25} onClick={() => { setLeaguePage(p => p + 1); loadLeagues(); }}>Next</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="audit" className="space-y-4">
            <Table>
              <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>User</TableHead><TableHead>Details</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {auditLog.map((entry: any) => (
                  <TableRow key={entry.id}>
                    <TableCell><Badge variant="outline">{entry.event_type}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{entry.user_id?.slice(0, 8) || '—'}...</TableCell>
                    <TableCell className="max-w-xs truncate text-xs">{typeof entry.details === 'object' ? JSON.stringify(entry.details) : entry.details}</TableCell>
                    <TableCell>{formatDate(entry.created_at)}</TableCell>
                  </TableRow>
                ))}
                {auditLog.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-white/55">No audit entries</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
};

export default Admin;
