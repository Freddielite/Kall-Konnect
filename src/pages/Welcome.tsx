import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bell, Check, Download, Heart, Star, Sun, Sunset, Moon, Clock, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AddContactDialog } from '@/components/AddContactDialog';
import { ImportContactsDialog } from '@/components/ImportContactsDialog';
import { useContacts } from '@/hooks/useContacts';
import { usePreferences } from '@/hooks/usePreferences';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { enablePush, getPushStatus, type PushStatus } from '@/lib/push';
import type { Contact } from '@/types/contact';

/** Most people have a handful they really mean to keep up with; starring
 * more than this dilutes what "favorite" means to the reminder picker. */
const MAX_FAVORITES = 5;

type CallTime = 'morning' | 'afternoon' | 'evening' | 'anytime';
const CALL_TIMES: { value: CallTime; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'morning', label: 'Morning', hint: 'Reminder at 8am', icon: Sun },
  { value: 'afternoon', label: 'Afternoon', hint: 'Reminder at 12pm', icon: Clock },
  { value: 'evening', label: 'Evening', hint: 'Reminder at 5pm', icon: Sunset },
  { value: 'anytime', label: 'Anytime', hint: 'Reminder at 9am', icon: Moon },
];

const STEPS = ['People', 'Who matters', 'Call time', 'Reminders'] as const;

/**
 * First-run flow, shown once to a new account with no contacts (see the
 * redirect in Dashboard). Four short steps, each skippable, ending with
 * the first reminder already scheduled. Finishing or skipping records
 * user_preferences.onboarded_at so it never shows again.
 */
export default function Welcome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0];
  const { contacts, addContact, importContacts, updateContact } = useContacts();
  const { preferences, updatePreferences } = usePreferences();
  const [step, setStep] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (step === 3) getPushStatus().then(setPushStatus).catch(() => setPushStatus('unsupported'));
  }, [step]);

  const favorites = contacts.filter((c) => c.isFavorite);

  const finish = async () => {
    setFinishing(true);
    await api.post('/preferences/onboarded').catch(() => {});
    navigate('/', { replace: true });
  };

  const toggleFavorite = (c: Contact) => {
    if (!c.isFavorite && favorites.length >= MAX_FAVORITES) return;
    updateContact(c.id, { isFavorite: !c.isFavorite });
  };

  const turnOnReminders = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      await enablePush();
      if (!preferences.notifications_enabled) await updatePreferences({ notifications_enabled: true });
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Could not turn on reminders.');
    } finally {
      setPushBusy(false);
      setPushStatus(await getPushStatus().catch(() => 'unsupported' as PushStatus));
    }
  };

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : void finish());

  return (
    <div className="min-h-screen gradient-soft" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="gradient-warm header-safe px-6 pb-8 shadow-soft">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="h-7 w-7 text-white" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-white">Welcome{firstName ? `, ${firstName}` : ''}</h1>
          </div>
          <p className="text-white/90 text-sm">A few quick steps and your first reminder is set.</p>
          <ol className="flex gap-1.5 mt-5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= step ? 'bg-white' : 'bg-white/30')}
                aria-current={i === step ? 'step' : undefined}
              >
                <span className="sr-only">{label}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6 pb-10">
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
          {step === 0 && (
            <Card className="p-6 shadow-soft border-2 space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Who do you want to stay close to?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Family, old friends, the colleague you always mean to call. Start with a few; you can add more any time.
                </p>
              </div>
              <div className="grid gap-2">
                <Button className="w-full h-12 rounded-xl gap-2" onClick={() => setImportOpen(true)}>
                  <Download className="h-5 w-5" aria-hidden="true" />
                  Import from your phone
                </Button>
                <Button variant="outline" className="w-full h-12 rounded-xl gap-2" onClick={() => setAddOpen(true)}>
                  <UserPlus className="h-5 w-5" aria-hidden="true" />
                  Add someone
                </Button>
              </div>
              {contacts.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">
                    {contacts.length} {contacts.length === 1 ? 'person' : 'people'} added
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {contacts.slice(0, 12).map((c) => (
                      <li key={c.id} className="rounded-full bg-primary/10 text-foreground text-sm px-3 py-1">{c.name}</li>
                    ))}
                    {contacts.length > 12 && (
                      <li className="rounded-full bg-muted text-muted-foreground text-sm px-3 py-1">+{contacts.length - 12} more</li>
                    )}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {step === 1 && (
            <Card className="p-6 shadow-soft border-2 space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Who matters most?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Star up to {MAX_FAVORITES}. They'll come up more often. Set how often you'd like to talk to each.
                </p>
              </div>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add a few people first, or skip this for now.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {contacts.slice(0, 30).map((c) => {
                    const atLimit = !c.isFavorite && favorites.length >= MAX_FAVORITES;
                    return (
                      <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <button
                          type="button"
                          onClick={() => toggleFavorite(c)}
                          disabled={atLimit}
                          aria-pressed={c.isFavorite}
                          aria-label={c.isFavorite ? `Unstar ${c.name}` : `Star ${c.name}`}
                          // No hover fill: accent is the same orange as a filled
                          // star (invisible together), and touch screens leave
                          // :hover stuck on after a tap.
                          className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center disabled:opacity-40"
                        >
                          <Star className={cn('h-5 w-5', c.isFavorite ? 'fill-primary text-primary' : 'text-muted-foreground')} />
                        </button>
                        <span className="flex-1 min-w-0 text-sm leading-snug text-foreground break-words">{c.name}</span>
                        <Select
                          value={c.callFrequency}
                          onValueChange={(v) => updateContact(c.id, { callFrequency: v as Contact['callFrequency'] })}
                        >
                          <SelectTrigger className="w-[104px] shrink-0 rounded-xl" aria-label={`How often to call ${c.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="biweekly">2 weeks</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {step === 2 && (
            <Card className="p-6 shadow-soft border-2 space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">When do you like to call?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Your daily reminder arrives at the start of this window, in your own time zone.
                </p>
              </div>
              <div role="radiogroup" aria-label="Preferred call time" className="grid grid-cols-2 gap-2">
                {CALL_TIMES.map(({ value, label, hint, icon: Icon }) => {
                  const selected = preferences.preferred_call_time === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => updatePreferences({ preferred_call_time: value })}
                      className={cn(
                        'rounded-xl border-2 p-4 text-left transition-colors',
                        selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/40'
                      )}
                    >
                      <Icon className={cn('h-5 w-5 mb-2', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                      <p className="font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {step === 3 && (
            <Card className="p-6 shadow-soft border-2 space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Get a gentle nudge</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  One reminder a day naming one person, never a pile of alerts. You can change this any time in Settings.
                </p>
              </div>
              {pushStatus === 'subscribed' ? (
                <p className="flex items-center gap-2 text-sm text-foreground">
                  <Check className="h-5 w-5 text-primary" aria-hidden="true" />
                  Reminders are on for this device.
                </p>
              ) : pushStatus === 'needs-install' ? (
                <p className="text-sm text-muted-foreground">
                  On iPhone, install the app first: tap Share, then Add to Home Screen, and open it from there.
                </p>
              ) : pushStatus === 'denied' ? (
                <p className="text-sm text-muted-foreground">
                  Notifications are blocked for this site. Allow them in your browser's site settings, then turn
                  reminders on in Settings.
                </p>
              ) : pushStatus === 'unsupported' ? (
                <p className="text-sm text-muted-foreground">
                  This browser can't show notifications. Reminders still appear in the app's bell.
                </p>
              ) : (
                <Button className="w-full h-12 rounded-xl gap-2" onClick={turnOnReminders} disabled={pushBusy || pushStatus === null}>
                  <Bell className="h-5 w-5" aria-hidden="true" />
                  {pushBusy ? 'Turning on…' : 'Turn on reminders'}
                </Button>
              )}
              {pushError && <p className="text-sm text-destructive">{pushError}</p>}
            </Card>
          )}
        </motion.div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button
            variant="ghost"
            className="rounded-full"
            onClick={() => (step === 0 ? void finish() : setStep(step - 1))}
            disabled={finishing}
          >
            {step === 0 ? 'Skip setup' : 'Back'}
          </Button>
          <Button
            className="rounded-full"
            onClick={next}
            // The later steps are about the people added here.
            disabled={finishing || (step === 0 && contacts.length === 0)}
          >
            {step === STEPS.length - 1 ? (finishing ? 'Finishing…' : 'Finish') : 'Continue'}
          </Button>
        </div>
      </div>

      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} onAddContact={(c) => addContact(c)} contacts={contacts} />
      <ImportContactsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportContacts={(list) => void importContacts(list)}
      />
    </div>
  );
}
