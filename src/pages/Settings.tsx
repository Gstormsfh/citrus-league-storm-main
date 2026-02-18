import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Loader2, User, Mail, Lock, Trash2, ExternalLink, Shield, FileText, Download } from 'lucide-react';
import { logger } from '@/utils/logger';

const Settings = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  if (!user) {
    navigate('/auth');
    return null;
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    setChangePasswordLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setMessage({ type: 'success', text: 'Password updated successfully!' });
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: unknown) {
      logger.error('Password change error:', error);
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to update password'
      });
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const handleExportData = async () => {
    setExportLoading(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.rpc('export_user_data');
      if (error) throw error;

      const result = data as Record<string, unknown>;
      if (result && result.success === false) {
        throw new Error((result.error as string) || 'Export failed');
      }

      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `citrus-fantasy-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setMessage({ type: 'success', text: 'Your data has been exported successfully.' });
    } catch (error: unknown) {
      logger.error('Data export error:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to export data. Please try again.'
      });
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') {
      setMessage({ type: 'error', text: 'Please type DELETE to confirm' });
      return;
    }

    setDeleteAccountLoading(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.rpc('delete_user_account');
      if (error) throw error;

      const result = data as Record<string, unknown>;
      if (result && result.success === false) {
        throw new Error((result.error as string) || 'Deletion failed');
      }

      await signOut();
      navigate('/auth?message=account-deleted');
    } catch (error: unknown) {
      logger.error('Account deletion error:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to delete account. Please contact support.'
      });
      setDeleteAccountLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-green-50 to-emerald-50">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Settings</h1>
        </div>
      </div>
      <main className="w-full lg:pt-20 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          <div className="max-w-4xl mx-auto px-2 lg:px-6">
            <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Account Settings</h1>
          <p className="text-gray-600">Manage your account, security, and preferences</p>
        </div>

        {message && (
          <Alert className={`mb-6 ${message.type === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <AlertDescription className={message.type === 'success' ? 'text-green-800' : 'text-red-800'}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Account Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Account Information
            </CardTitle>
            <CardDescription>Your account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm text-gray-600">Email Address</Label>
              <div className="flex items-center gap-2 mt-1">
                <Mail className="h-4 w-4 text-gray-400" />
                <span className="text-base font-medium">{user.email}</span>
              </div>
            </div>
            <div>
              <Label className="text-sm text-gray-600">User ID</Label>
              <div className="flex items-center gap-2 mt-1">
                <Shield className="h-4 w-4 text-gray-400" />
                <span className="text-base font-mono text-xs text-gray-500">{user.id}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Change Password
            </CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Enter new password (min 6 characters)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={changePasswordLoading}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={changePasswordLoading}
                  className="mt-1"
                />
              </div>
              <Button 
                type="submit" 
                disabled={changePasswordLoading || !newPassword || !confirmPassword}
                className="w-full sm:w-auto"
              >
                {changePasswordLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Password'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Legal & Privacy */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Legal & Privacy
            </CardTitle>
            <CardDescription>Review our policies and terms</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <a 
              href="/privacy-policy.html" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors group"
            >
              <span className="font-medium text-gray-900 group-hover:text-green-700">Privacy Policy</span>
              <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-green-700" />
            </a>
            <Separator />
            <a 
              href="/terms-of-service.html" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors group"
            >
              <span className="font-medium text-gray-900 group-hover:text-green-700">Terms of Service</span>
              <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-green-700" />
            </a>
          </CardContent>
        </Card>

        {/* Data Export (GDPR/CCPA) */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Your Data
            </CardTitle>
            <CardDescription>Export a copy of all your data</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              Download a JSON file containing all your account data, including your profile, teams, leagues, transactions, and draft history.
            </p>
            <Button
              variant="outline"
              onClick={handleExportData}
              disabled={exportLoading}
              className="w-full sm:w-auto"
            >
              {exportLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export My Data
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Delete Account */}
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <Trash2 className="h-5 w-5" />
              Delete Account
            </CardTitle>
            <CardDescription className="text-red-600">
              Permanently delete your account and all associated data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-white p-4 rounded-lg border border-red-200">
              <h4 className="font-semibold text-red-900 mb-2">This action cannot be undone</h4>
              <ul className="text-sm text-red-700 space-y-1 ml-4 list-disc">
                <li>Your account and authentication credentials will be permanently deleted</li>
                <li>All your fantasy teams and league data will be removed</li>
                <li>If you're a league commissioner, your leagues may be orphaned</li>
                <li>Your draft history and transactions will be anonymized</li>
                <li>This process cannot be reversed</li>
              </ul>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete My Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-4">
                    <p>
                      This will permanently delete your account and all associated data. 
                      This action cannot be undone.
                    </p>
                    <div>
                      <Label htmlFor="deleteConfirmation" className="text-sm font-medium">
                        Type <span className="font-bold text-red-600">DELETE</span> to confirm:
                      </Label>
                      <Input
                        id="deleteConfirmation"
                        value={deleteConfirmation}
                        onChange={(e) => setDeleteConfirmation(e.target.value)}
                        placeholder="DELETE"
                        className="mt-2"
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setDeleteConfirmation('')}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmation !== 'DELETE' || deleteAccountLoading}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {deleteAccountLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      'Delete Account'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-sm text-gray-600">
          <p>Need help? Contact us at <a href="mailto:CitrusFantasySports@Gmail.com" className="text-green-700 hover:underline">CitrusFantasySports@Gmail.com</a></p>
        </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Settings;
