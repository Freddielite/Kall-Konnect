import { Settings as SettingsIcon, Bell, Calendar, Moon, Info, Link as LinkIcon, LogOut, User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePreferences } from '@/hooks/usePreferences';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { Input } from '@/components/ui/input';
import { useTheme } from 'next-themes';
import { useState, useEffect, useCallback } from 'react';
import { errorMessage } from '@/lib/utils';
import { isPushSupported, getPushStatus, enablePush, disablePush, sendTestPush, ensureRegistered, forceResubscribe, type PushStatus } from '@/lib/push';
import type { NotificationCategory } from '@/hooks/usePreferences';
import { SplashScreen } from '@/components/SplashScreen';
import { motion } from 'framer-motion';
import { usePullToRefresh, PullIndicator } from '@/components/PullToRefresh';

/** Mirrors NOTIFICATION_CATEGORIES in server/src/jobs/reminderRules.js and
 * the notifications.type CHECK constraint. Keep the three in sync. */
const NOTIFICATION_CATEGORIES: {
  key: NotificationCategory;
  label: string;
  description: string;
}[] = [
  { key: 'planned_call', label: 'Routine check-ins',
    description: "When someone's due based on how often you want to call them" },
  { key: 'inactivity', label: 'Long silences',
    description: "When it's been much longer than usual since you spoke" },
  { key: 'occasion', label: 'Birthdays & anniversaries',
    description: 'A few days ahead, and on the day itself' },
  { key: 'follow_up', label: 'Unfinished conversations',
    description: 'When your notes suggest a call was left hanging' },
  { key: 'first_call', label: 'New contacts',
    description: "People you've added but never called" },
  { key: 'streak', label: 'Streak milestones',
    description: 'When you hit a run of days keeping in touch' },
];

export default function Settings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { preferences, loading, updatePreferences, refresh: refreshPreferences } = usePreferences();
  const googleCalendar = useGoogleCalendar();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, setTheme } = useTheme();
  const { logout, user, updateDisplayName } = useAuth();
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFadeOut, setSignOutFadeOut] = useState(false);

  useEffect(() => {
    if (user?.displayName) setNameDraft(user.displayName);
  }, [user?.displayName]);

  // Both independent sources this page reads from. Run together rather than
  // in sequence so the spinner reflects the slower of the two, not their sum.
  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshPreferences(), googleCalendar.refresh()]);
    toast({ title: 'Settings refreshed' });
  }, [refreshPreferences, googleCalendar, toast]);

  const { refreshing, pullOffset, handlers } = usePullToRefresh({
    onRefresh: handleRefresh,
    // The sign-out splash covers the screen; a pull behind it would be
    // invisible and would refetch data on the way out the door.
    disabled: signingOut,
  });

  useEffect(() => {
    const result = searchParams.get('calendar');
    if (!result) return;
    if (result === 'connected') {
      toast({ title: 'Google Calendar connected', description: 'Reminders will now be added to your calendar automatically.' });
      googleCalendar.refresh();
    } else if (result === 'denied') {
      toast({ title: 'Google Calendar not connected', description: "You didn't grant calendar access, so nothing changed.", variant: 'destructive' });
    } else if (result === 'error') {
      toast({ title: "Couldn't connect Google Calendar", description: 'Something went wrong during setup. Please try again.', variant: 'destructive' });
    }
    // Clean the URL so refreshing the page doesn't re-fire the toast.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('calendar');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === user?.displayName) return;
    setNameSaving(true);
    try {
      await updateDisplayName(trimmed);
      toast({ title: 'Name updated' });
    } catch (error: unknown) {
      toast({ title: 'Could not update name', description: errorMessage(error), variant: 'destructive' });
    } finally {
      setNameSaving(false);
    }
  };

  // Read-only status check. Runs on mount and after any change; it cannot
  // prompt or subscribe, so it is safe to call whenever.
  const refreshPushStatus = useCallback(async () => {
    if (!isPushSupported()) return setPushStatus('unsupported');
    const status = await getPushStatus();
    setPushStatus(status);
    // Repairs the browser/server split described in ensureRegistered().
    // Silent and prompt-free; only runs once permission is granted.
    if (status === 'subscribed') await ensureRegistered().catch(() => {});
  }, []);

  useEffect(() => {
    void refreshPushStatus();
  }, [refreshPushStatus]);

  // The single subscribe path in the app, called straight from onClick so the
  // permission request lands inside the tap's activation window.
  const handleEnablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      await enablePush();
      toast({ title: 'Reminders on', description: 'This device will now receive notifications.' });
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Could not turn on reminders.');
    } finally {
      setPushBusy(false);
      await refreshPushStatus();
    }
  };

  const handleResubscribe = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      await forceResubscribe();
      toast({ title: 'Device re-registered', description: 'Try the test notification again.' });
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Could not re-register this device.');
    } finally {
      setPushBusy(false);
      await refreshPushStatus();
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      await disablePush();
    } finally {
      setPushBusy(false);
      await refreshPushStatus();
    }
  };

  const handleTestPush = async () => {
    setTestingPush(true);
    try {
      const result = await sendTestPush();
      toast({
        title: result.ok ? 'Test notification sent' : "Test notification didn't send",
        description: result.message,
        variant: result.ok ? undefined : 'destructive',
      });
    } finally {
      setTestingPush(false);
    }
  };

  // Purely the account-level preference. It no longer subscribes: conflating
  // "generate reminders for me" with "this device is registered" is what let
  // the old UI show reminders as on while nothing could receive them.
  const handleNotificationsToggle = (checked: boolean) => {
    updatePreferences({ notifications_enabled: checked });
  };

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
      // Let the splash sit a moment before fading into the login page.
      setTimeout(() => setSignOutFadeOut(true), 900);
      setTimeout(() => navigate('/auth'), 1400);
    } catch (error: unknown) {
      setSigningOut(false);
      toast({
        title: "Error signing out",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {signingOut && <SplashScreen fadeOut={signOutFadeOut} />}
      <motion.div
        className="min-h-screen pb-nav-safe bg-gradient-soft"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        {...handlers}
      >
      <PullIndicator pullOffset={pullOffset} refreshing={refreshing} />
      {/* Header */}
      <div className="gradient-warm header-safe px-6 pb-8 shadow-soft">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <SettingsIcon className="h-8 w-8 text-white" />
            <h1 className="text-3xl font-bold text-white">Settings</h1>
          </div>
          <p className="text-white/90 text-sm">Customize your experience</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6">
        {/* Account */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Account
          </h3>
          <Card className="p-5 shadow-soft border-2 space-y-3">
            <div>
              <Label htmlFor="display-name">Display Name</Label>
              <p className="text-sm text-muted-foreground mb-2">This is how the app greets you.</p>
              <div className="flex gap-2">
                <Input
                  id="display-name"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Your name"
                />
                <Button
                  onClick={handleSaveName}
                  disabled={nameSaving || !nameDraft.trim() || nameDraft.trim() === user?.displayName}
                >
                  {nameSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
            {user?.email && <p className="text-sm text-muted-foreground">{user.email}</p>}
          </Card>
        </div>

        {/* Notifications */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notifications
          </h3>
          <Card className="p-5 shadow-soft border-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="notifications-enabled" className="flex-1">
                  <div>
                    <p className="font-medium">Enable Notifications</p>
                    <p className="text-sm text-muted-foreground">Receive scheduled reminders</p>
                  </div>
                </Label>
                <Switch
                  id="notifications-enabled"
                  checked={preferences.notifications_enabled}
                  onCheckedChange={handleNotificationsToggle}
                  disabled={loading}
                />
              </div>
              
              {preferences.notifications_enabled && pushStatus && pushStatus !== 'subscribed' && (
                <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3">
                  {pushStatus === 'unsupported' && (
                    <p className="text-sm text-muted-foreground">
                      This browser can't receive push notifications.
                    </p>
                  )}

                  {pushStatus === 'needs-install' && (
                    <p className="text-sm text-muted-foreground">
                      On iPhone, install the app first: tap Share, then Add to
                      Home Screen, and open it from there.
                    </p>
                  )}

                  {pushStatus === 'denied' && (
                    <>
                      <p className="text-sm font-medium mb-1">Notifications are blocked</p>
                      <p className="text-sm text-muted-foreground">
                        Your browser won't ask again on its own. Open this site's
                        settings in Chrome, set Notifications to Allow, then
                        reopen the app.
                      </p>
                    </>
                  )}

                  {pushStatus === 'not-subscribed' && (
                    <>
                      <p className="text-sm font-medium mb-1">
                        This device isn't receiving reminders yet
                      </p>
                      <p className="text-sm text-muted-foreground mb-3">
                        Your phone will ask permission — choose Allow.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-xl"
                        onClick={handleEnablePush}
                        disabled={pushBusy}
                      >
                        {pushBusy ? 'Turning on…' : 'Turn on reminders'}
                      </Button>
                    </>
                  )}

                  {pushError && <p className="text-sm text-destructive mt-2">{pushError}</p>}
                </div>
              )}

              {preferences.notifications_enabled && pushStatus === 'subscribed' && (
                <div className="rounded-xl border border-dashed p-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    This device is receiving reminders.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={handleTestPush}
                    disabled={testingPush}
                  >
                    {testingPush ? 'Sending…' : 'Send a test notification'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl ml-2"
                    onClick={handleResubscribe}
                    disabled={pushBusy}
                  >
                    {pushBusy ? 'Re-registering…' : 'Re-register'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl mt-2 w-full"
                    onClick={handleDisablePush}
                    disabled={pushBusy}
                  >
                    Turn off on this device
                  </Button>
                  {pushError && <p className="text-sm text-destructive mt-2">{pushError}</p>}
                </div>
              )}

              <div>
                <Label className="mb-2 block">Notification Frequency</Label>
                <Select
                  value={preferences.notification_frequency}
                  onValueChange={(value: 'daily' | 'weekly' | 'monthly') =>
                    updatePreferences({ notification_frequency: value })
                  }
                  disabled={loading}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  How often you get a reminder. Each one names a single person
                  to call. Birthdays and anniversaries always come through.
                </p>
              </div>

              <div className="pt-1">
                <p className="font-medium mb-1">What to notify me about</p>
                <p className="text-sm text-muted-foreground mb-3">
                  Turn off any kind you don't want. Reminders still respect the
                  frequency above.
                </p>
                <div className="space-y-3">
                  {NOTIFICATION_CATEGORIES.map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <Label htmlFor={`cat-${key}`} className="flex-1">
                        <div>
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                      </Label>
                      <Switch
                        id={`cat-${key}`}
                        checked={preferences.notification_categories?.[key] !== false}
                        onCheckedChange={(checked) =>
                          updatePreferences({
                            notification_categories: {
                              ...preferences.notification_categories,
                              [key]: checked,
                            },
                          })
                        }
                        disabled={loading || !preferences.notifications_enabled}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="quiet-day-nudges" className="flex-1">
                  <div>
                    <p className="font-medium">Nudge me on quiet days</p>
                    <p className="text-sm text-muted-foreground">
                      Send a short note even when nobody's due, so the daily
                      rhythm doesn't have gaps
                    </p>
                  </div>
                </Label>
                <Switch
                  id="quiet-day-nudges"
                  checked={preferences.quiet_day_nudges}
                  onCheckedChange={(checked) => updatePreferences({ quiet_day_nudges: checked })}
                  disabled={loading || !preferences.notifications_enabled}
                />
              </div>

              <div>
                <Label htmlFor="inactivity-days" className="mb-2 block">
                  Inactivity Alert Threshold (days)
                </Label>
                <Input
                  id="inactivity-days"
                  type="number"
                  min="1"
                  max="365"
                  value={preferences.inactivity_days}
                  onChange={(e) =>
                    updatePreferences({ inactivity_days: parseInt(e.target.value) || 14 })
                  }
                  disabled={loading}
                  className="rounded-xl"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Past this many days a contact counts as a long silence, which
                  changes how the reminder about them is worded
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Call Preferences */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Call Preferences
          </h3>
          <Card className="p-5 shadow-soft border-2">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Default Call Frequency</Label>
                <Select
                  value={preferences.call_frequency}
                  onValueChange={(value: 'weekly' | 'biweekly' | 'monthly') =>
                    updatePreferences({ call_frequency: value })
                  }
                  disabled={loading}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Preferred Call Time</Label>
                <Select
                  value={preferences.preferred_call_time}
                  onValueChange={(value: 'morning' | 'afternoon' | 'evening' | 'anytime') =>
                    updatePreferences({ preferred_call_time: value })
                  }
                  disabled={loading}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">Morning (8am - 12pm)</SelectItem>
                    <SelectItem value="afternoon">Afternoon (12pm - 5pm)</SelectItem>
                    <SelectItem value="evening">Evening (5pm - 9pm)</SelectItem>
                    <SelectItem value="anytime">Anytime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        </div>

        {/* Calendar Integration */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-primary" />
            Calendar Integration
          </h3>
          <Card className="p-5 shadow-soft border-2">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-4">
                  Sync birthdays, anniversaries, and reminders with your calendar
                </p>
              </div>
              <div className="space-y-3">
                {googleCalendar.status.connected ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border-2 p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Calendar className="h-5 w-5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Google Calendar connected</p>
                        {googleCalendar.status.email && (
                          <p className="text-xs text-muted-foreground truncate">{googleCalendar.status.email}</p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await googleCalendar.disconnect();
                        toast({ title: 'Google Calendar disconnected' });
                      }}
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-3 h-12 rounded-xl"
                    onClick={googleCalendar.connect}
                  >
                    <Calendar className="h-5 w-5" />
                    <span>Connect Google Calendar</span>
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between pt-2">
                <Label htmlFor="auto-add-reminders" className="flex-1">
                  <div>
                    <p className="font-medium text-sm">Auto-add call reminders</p>
                    <p className="text-xs text-muted-foreground">Add scheduled calls to calendar</p>
                  </div>
                </Label>
                <Switch
                  id="auto-add-reminders"
                  checked={preferences.auto_add_calendar_reminders}
                  onCheckedChange={(checked) =>
                    updatePreferences({ auto_add_calendar_reminders: checked })
                  }
                  disabled={loading}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Appearance */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Moon className="h-5 w-5 text-primary" />
            Appearance
          </h3>
          <Card className="p-5 shadow-soft border-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="dark-mode" className="flex-1">
                <div>
                  <p className="font-medium">Dark Mode</p>
                  <p className="text-sm text-muted-foreground">Switch to dark theme</p>
                </div>
              </Label>
              <Switch
                id="dark-mode"
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
            </div>
          </Card>
        </div>

        {/* About */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            About
          </h3>
          <Card className="p-5 shadow-soft border-2">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Version</p>
                <p className="text-foreground">1.0.0</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Made with</p>
                <p className="text-foreground">💙 for better relationships</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Encouragement */}
        <Card className="p-6 shadow-soft border-2 bg-accent/5 border-accent/20 mb-6">
          <p className="text-center text-sm text-foreground">
            Remember: A 5-minute call can make someone's day. Keep being awesome! ✨
          </p>
        </Card>

        {/* Logout Button */}
        <Button
          variant="outline"
          className="w-full gap-2 h-12 rounded-2xl border-2 border-destructive/20 text-destructive hover:bg-destructive/10 mb-6"
          onClick={handleLogout}
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </Button>
      </div>
    </motion.div>
    </>
  );
}
