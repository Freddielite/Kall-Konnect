import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ContactCard } from '@/components/ContactCard';
import { AddContactDialog } from '@/components/AddContactDialog';
import { RescheduleDialog } from '@/components/RescheduleDialog';
import { TemplateDialog } from '@/components/TemplateDialog';
import { useContacts } from '@/hooks/useContacts';
import { useCallAnalytics } from '@/hooks/useCallAnalytics';
import { useLogCallFlow } from '@/hooks/useLogCallFlow';
import { getTemplateForContact, formatTemplate, getFollowUpStarter } from '@/data/templates';
import { Heart, Shuffle, Sparkles, PartyPopper, UserPlus } from 'lucide-react';
import { getUpcomingOccasions } from '@/lib/occasions';
import { useToast } from '@/hooks/use-toast';
import { getDismissedToday, dismissContactToday } from '@/lib/localDismiss';
import { buildFollowUpVocabulary } from '@/lib/noteSignals';
import { computeCallStreak } from '@/lib/streaks';
import { getDashboardGreeting, getEncouragementBanner } from '@/lib/dailyMessages';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { usePostCall } from '@/lib/post-call';
import { usePreferences } from '@/hooks/usePreferences';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Contact, TemplateTone } from '@/types/contact';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { NotificationsBell } from '@/components/NotificationsBell';
import { useAuth } from '@/lib/auth-context';
import { usePullToRefresh, PullIndicator } from '@/components/PullToRefresh';

export default function Dashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0];
  const { contacts, loading, updateContact, addCallNote, addContact, refreshContacts } = useContacts();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { reconnectionSuggestions } = useCallAnalytics(contacts);
  const logCall = useLogCallFlow({ contacts, addCallNote });
  const { openCallLog } = usePostCall();
  const { preferences, loading: preferencesLoading } = usePreferences();
  const navigate = useNavigate();

  // A brand-new account (nothing added, first-run flow never finished or
  // skipped) starts in the welcome flow. Existing users were marked
  // onboarded by migration 016, so this never catches them.
  useEffect(() => {
    if (!loading && !preferencesLoading && contacts.length === 0 && preferences.onboarded_at === null) {
      navigate('/welcome', { replace: true });
    }
  }, [loading, preferencesLoading, contacts.length, preferences.onboarded_at, navigate]);
  const [rescheduleDialog, setRescheduleDialog] = useState<{ open: boolean; contactId: string | null }>({ open: false, contactId: null });
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; contactId: string | null }>({ open: false, contactId: null });
  // "Not now" on a suggestion - local-only, resurfaces tomorrow. See lib/localDismiss.
  const [dismissedToday, setDismissedToday] = useState<Set<string>>(() => getDismissedToday());
  const followUpVocabulary = useMemo(() => buildFollowUpVocabulary(contacts), [contacts]);
  const callStreak = useMemo(() => computeCallStreak(contacts), [contacts]);
  const greeting = getDashboardGreeting(firstName ?? '');

  const handleRefresh = useCallback(async () => {
    await refreshContacts();
    toast({ title: 'Dashboard refreshed' });
  }, [refreshContacts, toast]);

  const { refreshing, pullOffset, handlers } = usePullToRefresh({
    onRefresh: handleRefresh,
    // A dialog scrolls its own content; a downward drag inside one must not
    // be read as a pull on the page behind it.
    disabled: logCall.isOpen || addDialogOpen || rescheduleDialog.open || templateDialog.open,
  });

  const handleUpdateFrequency = (contactId: string, frequency: Contact['callFrequency']) => {
    updateContact(contactId, { callFrequency: frequency });
  };

  const occasions = getUpcomingOccasions(contacts, 3);
  const celebratedIds = new Set(occasions.map(o => o.contact.id));

  const regularSuggestions = reconnectionSuggestions.filter(
    s => !celebratedIds.has(s.contact.id) && !dismissedToday.has(s.contact.id)
  );
  const todayContact = regularSuggestions[0]?.contact;
  const todayContactMeta = regularSuggestions[0];
  const upcomingContacts = regularSuggestions.slice(1, 8).map(s => s.contact);

  const handleDismissSuggestion = (contactId: string) => {
    setDismissedToday(dismissContactToday(contactId));
  };

  // The "how did it go?" prompt on return is app-wide now (lib/post-call),
  // started by ContactCard itself; this only acknowledges the tap.
  const handleCallMade = (_contactId: string, platform: string) => {
    toast({
      title: "Calling...",
      description: `Opening ${platform} - we'll check back in when you're done.`,
    });
  };

  // Tapping a card in the "Upcoming Check-ins" strip logs a note directly
  // without placing a real call, so there's no app-hidden/app-visible cycle
  // to detect - it just opens the note dialog the way calls used to before
  // the visibility-based flow below existed.
  const handleLogCallManually = (contactId: string) => {
    const contact = contacts.find((c) => c.id === contactId);
    if (contact) openCallLog(contact);
  };

  // ⋮ menu "Log a call" - opens the shared date/time-picker -> note flow
  // for a call made outside the app. See useLogCallFlow.


  const handleToggleFavorite = (contactId: string) => {
    const contact = contacts.find(c => c.id === contactId);
    if (contact) {
      updateContact(contactId, { isFavorite: !contact.isFavorite });
      toast({
        title: contact.isFavorite ? "Removed from favorites" : "Added to favorites ⭐",
        description: contact.isFavorite 
          ? `${contact.name} removed from favorites.`
          : `${contact.name} is now a favorite contact.`,
      });
    }
  };

  const handleReschedule = (contactId: string, date: Date) => {
    updateContact(contactId, { snoozedUntil: date });
    toast({
      title: "Contact rescheduled",
      description: "We'll remind you at the scheduled time.",
    });
  };

  const handleSaveTone = (contactId: string, tone: TemplateTone) => {
    updateContact(contactId, { templateTone: tone, customTemplate: '' });
  };

  const handleSaveTemplate = (contactId: string, template: string) => {
    updateContact(contactId, { customTemplate: template });
    toast({
      title: "Template saved",
      description: "Your custom conversation starter has been saved.",
    });
  };

  const getConversationStarter = (contact: Contact, followUpFlagged?: boolean) => {
    if (followUpFlagged && !contact.customTemplate) {
      return getFollowUpStarter();
    }
    const template = getTemplateForContact(contact.relationship, contact.customTemplate, contact.templateTone);
    return formatTemplate(template, contact.name);
  };


  const handleShuffle = () => {
    toast({
      title: "Contacts shuffled",
      description: "Your weekly check-ins have been reorganized.",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen pb-nav-safe flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-muted-foreground">Loading your connections...</div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="min-h-screen gradient-soft pb-nav-safe"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      {...handlers}
    >
      <PullIndicator pullOffset={pullOffset} refreshing={refreshing} />
      {/* Header — same warm gradient bar as Contacts/Stats/Settings, so the
          status bar above it is orange on every screen rather than only three
          of the four. */}
      <div className="gradient-warm header-safe px-6 pb-8 shadow-soft">
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-2">
          {contacts.length === 0 ? (
            <div>
              <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                Hi{firstName ? ` ${firstName}` : ' there'} 👋
              </h1>
              <p className="text-sm text-white/90">
                Stay close to the people who matter.
              </p>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                {greeting.headline}
              </h1>
              <p className="text-sm text-white/90">
                {greeting.subtitle}
              </p>
              {callStreak >= 2 && (
                <p className="text-xs text-white/80 mt-1">
                  🔥 {callStreak}-day streak of staying in touch
                </p>
              )}
            </div>
          )}
          <NotificationsBell className="text-white hover:bg-white/20 hover:text-white" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6">

        {user && !user.emailVerified && (
          <div className="mb-6">
            <EmailVerificationBanner />
          </div>
        )}

        {/* Celebrations within the next 3 days */}
        {occasions.length > 0 && (
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2">
              <PartyPopper className="h-5 w-5 text-accent" />
              <h2 className="text-lg font-semibold text-foreground">Celebrations coming up</h2>
            </div>
            {occasions.map((occasion) => (
              <Card
                key={`${occasion.contact.id}-${occasion.type}-${occasion.label}`}
                className="p-6 shadow-soft border-2 border-accent/40 bg-accent/5"
              >
                <ContactCard
                  contact={occasion.contact}
                  occasion={{ type: occasion.type, label: occasion.label, daysUntil: occasion.daysUntil }}
                  conversationStarter={occasion.message}
                  onCallMade={handleCallMade}
                  onToggleFavorite={handleToggleFavorite}
                  onReschedule={(id) => setRescheduleDialog({ open: true, contactId: id })}
                  onEditTemplate={(id) => setTemplateDialog({ open: true, contactId: id })}
                  onLogCallOutside={logCall.openLogCall}
                />
              </Card>
            ))}
          </div>
        )}

        {/* Today's Main Contact Card */}
        {contacts.length === 0 ? (
          <Card className="p-8 mb-6 text-center shadow-soft border-2">
            <div className="h-14 w-14 mx-auto mb-4 rounded-full gradient-warm flex items-center justify-center">
              <UserPlus className="h-7 w-7 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Let's get you started</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Add the people you want to stay close to, and we'll suggest who to call each day.
            </p>
            <Button className="rounded-full" onClick={() => setAddDialogOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Contact
            </Button>
          </Card>
        ) : todayContact ? (
          <Card className="p-6 mb-6 shadow-soft border-2 bg-card">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="h-5 w-5 text-accent fill-accent" />
              <h2 className="text-lg font-semibold text-foreground">Today's Connection</h2>
            </div>
            <ContactCard
              contact={todayContact}
              conversationStarter={getConversationStarter(todayContact, todayContactMeta?.followUpFlagged)}
              onCallMade={handleCallMade}
              onToggleFavorite={handleToggleFavorite}
              onReschedule={(id) => setRescheduleDialog({ open: true, contactId: id })}
              onEditTemplate={(id) => setTemplateDialog({ open: true, contactId: id })}
              onDismiss={handleDismissSuggestion}
              onLogCallOutside={logCall.openLogCall}
              isLowConfidence={todayContactMeta?.isLowConfidence}
              followUpFlagged={todayContactMeta?.followUpFlagged}
              bestTime={todayContactMeta?.bestTime}
              typicalCallLength={todayContactMeta?.typicalCallLength}
              suggestedFrequency={todayContactMeta?.suggestedFrequency}
              onUpdateFrequency={handleUpdateFrequency}
            />
          </Card>
        ) : (
          <Card className="p-8 mb-6 text-center">
            <Sparkles className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">You're all caught up! 🎉</p>
          </Card>
        )}


        {/* Weekly Check-ins */}
        {upcomingContacts.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-foreground">Upcoming Check-ins</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShuffle}
                className="gap-2"
              >
                <Shuffle className="h-4 w-4" />
                Shuffle
              </Button>
            </div>
            
            <ScrollArea className="w-full whitespace-nowrap rounded-2xl border-2 border-border bg-card p-4">
              <div className="flex gap-4">
                {upcomingContacts.map((contact, index) => {
                  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                  const getInitials = (name: string) => {
                    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                  };
                  
                  return (
                    <Card
                      key={contact.id}
                      className="inline-block w-32 p-4 shadow-soft hover:shadow-warm transition-smooth cursor-pointer flex-shrink-0"
                      onClick={() => handleLogCallManually(contact.id)}
                    >
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-2">{dayNames[index % 7]}</p>
                        <div className="h-10 w-10 mx-auto mb-2 rounded-full gradient-warm flex items-center justify-center text-white font-semibold">
                          {getInitials(contact.name)}
                        </div>
                        <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{contact.relationship}</p>
                      </div>
                    </Card>
                  );
                })}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        )}

        {/* Encouragement */}
        <Card className="p-5 text-center bg-gradient-to-r from-primary/5 to-secondary/5 border-primary/20">
          <p className="text-sm text-foreground font-medium">
            {getEncouragementBanner()}
          </p>
        </Card>
      </div>


      {/* Log a Call (outside the app) - shared with Contacts/ContactDetail, see useLogCallFlow */}
      {logCall.dialogs}

      <AddContactDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAddContact={addContact}
        contacts={contacts}
      />

      {/* Reschedule Dialog */}
      <RescheduleDialog
        open={rescheduleDialog.open}
        onOpenChange={(open) => setRescheduleDialog({ open, contactId: null })}
        contact={contacts.find(c => c.id === rescheduleDialog.contactId) || null}
        onReschedule={handleReschedule}
      />

      {/* Template Dialog */}
      <TemplateDialog
        open={templateDialog.open}
        onOpenChange={(open) => setTemplateDialog({ open, contactId: null })}
        contact={contacts.find(c => c.id === templateDialog.contactId) || null}
        onSaveTemplate={handleSaveTemplate}
        onSaveTone={handleSaveTone}
      />
    </motion.div>
  );
}
