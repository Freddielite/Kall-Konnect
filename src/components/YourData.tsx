import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

/** Settings > Your Data: download everything, or delete the account. */
export function YourData() {
  const { user, deleteAccount } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmValue, setConfirmValue] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Google-only accounts have no password; they confirm by typing the email.
  const usesPassword = user?.hasPassword !== false;

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.get<unknown>('/account/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kall-konnect-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({ title: 'Your data is downloading' });
    } catch (err) {
      toast({ title: "Couldn't export your data", description: errorMessage(err), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const openDelete = () => {
    setConfirmValue('');
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(usesPassword ? { password: confirmValue } : { email: confirmValue });
      setDeleteOpen(false);
      toast({ title: 'Your account has been deleted', description: 'Everything in it is gone. Take care.' });
      navigate('/auth', { replace: true });
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="space-y-5">
        <div>
          <p className="font-medium text-foreground">Download my data</p>
          <p className="text-sm text-muted-foreground mt-1 mb-3">
            Your contacts, call notes, dates, reminders and settings, as one file.
          </p>
          <Button variant="outline" className="w-full rounded-xl gap-2" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? 'Preparing…' : 'Download my data'}
          </Button>
        </div>
        <div className="border-t border-border pt-5">
          <p className="font-medium text-foreground">Delete my account</p>
          <p className="text-sm text-muted-foreground mt-1 mb-3">
            Permanently removes your account and everything in it. This can't be undone.
          </p>
          <Button
            variant="outline"
            className="w-full rounded-xl border-2 border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={openDelete}
          >
            Delete my account
          </Button>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(open) => { if (!deleting) setDeleteOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your contacts, call notes, reminders and settings will be deleted straight away, on every
              device. Download your data first if you might want it.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => { e.preventDefault(); if (confirmValue) void handleDelete(); }}
          >
            <Label htmlFor="delete-confirm">
              {usesPassword ? 'Enter your password to confirm' : `Type ${user?.email ?? 'your email'} to confirm`}
            </Label>
            <Input
              id="delete-confirm"
              type={usesPassword ? 'password' : 'email'}
              autoComplete={usesPassword ? 'current-password' : 'off'}
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              aria-invalid={deleteError ? true : undefined}
              aria-describedby={deleteError ? 'delete-error' : undefined}
            />
            {deleteError && <p id="delete-error" className="text-sm text-destructive">{deleteError}</p>}
            <DialogFooter className="gap-2 pt-3 sm:gap-0">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                Keep my account
              </Button>
              <Button type="submit" variant="destructive" className="rounded-xl" disabled={!confirmValue || deleting}>
                {deleting ? 'Deleting…' : 'Delete everything'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
