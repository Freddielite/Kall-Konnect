import { ContactCard } from '@/components/ContactCard';
import { motion, AnimatePresence } from 'framer-motion';
import { AddContactDialog } from '@/components/AddContactDialog';
import { ImportContactsDialog } from '@/components/ImportContactsDialog';
import { RescheduleDialog } from '@/components/RescheduleDialog';
import { TemplateDialog } from '@/components/TemplateDialog';
import { useContacts } from '@/hooks/useContacts';
import { Users, Search, Plus, Star, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useState, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Contact, TemplateTone } from '@/types/contact';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const relationshipBadgeClass = (relationship: string) => {
  switch (relationship) {
    case 'family':
      return 'bg-family text-family-foreground';
    case 'friend':
      return 'bg-friend text-friend-foreground';
    case 'colleague':
      return 'bg-colleague text-colleague-foreground';
    case 'acquaintance':
      return 'bg-acquaintance text-acquaintance-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export default function Contacts() {
  const { toast } = useToast();
  const { contacts, loading, addContact, updateContact, deleteContact, refreshContacts } = useContacts();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRelationship, setFilterRelationship] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [rescheduleDialog, setRescheduleDialog] = useState<{ open: boolean; contactId: string | null }>({ open: false, contactId: null });
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; contactId: string | null }>({ open: false, contactId: null });
  const [refreshing, setRefreshing] = useState(false);

  // Pull-to-refresh state
  const touchStartY = useRef(0);
  const pullDistance = useRef(0);
  const [pullOffset, setPullOffset] = useState(0);
  const isPulling = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const MIN_REFRESH_SPIN_MS = 600;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const started = Date.now();
    await refreshContacts();
    const elapsed = Date.now() - started;
    if (elapsed < MIN_REFRESH_SPIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REFRESH_SPIN_MS - elapsed));
    }
    setRefreshing(false);
    toast({ title: 'Contacts refreshed' });
  }, [refreshContacts, toast]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollTop = scrollContainerRef.current?.scrollTop ?? window.scrollY;
    if (scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    } else {
      isPulling.current = false;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      pullDistance.current = Math.min(delta * 0.5, 80);
      setPullOffset(pullDistance.current);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isPulling.current && pullDistance.current >= 60) {
      handleRefresh();
    }
    isPulling.current = false;
    pullDistance.current = 0;
    setPullOffset(0);
  }, [handleRefresh]);

  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = contact.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = !filterRelationship || contact.relationship === filterRelationship;
    const matchesFavorite = !showFavoritesOnly || contact.isFavorite;
    return matchesSearch && matchesFilter && matchesFavorite;
  });

  const handleAddContact = (newContact: Contact) => {
    addContact(newContact);
  };

  const handleImportContacts = (newContacts: Contact[]) => {
    newContacts.forEach(contact => addContact(contact));
  };

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
  };

  const handleSaveTone = (contactId: string, tone: TemplateTone) => {
    updateContact(contactId, { templateTone: tone, customTemplate: '' });
  };

  const handleSaveTemplate = (contactId: string, template: string) => {
    updateContact(contactId, { customTemplate: template });
  };

  const relationships = ['family', 'friend', 'colleague', 'acquaintance'];

  if (loading) {
    return (
      <div className="min-h-screen pb-24 bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-muted-foreground">Loading contacts...</div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="min-h-screen pb-24 bg-background"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      ref={scrollContainerRef}
    >
      {/* Pull-to-refresh indicator */}
      {(pullOffset > 0 || refreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-smooth"
          style={{ height: refreshing ? 48 : pullOffset }}
        >
          <RefreshCw
            className={cn(
              'h-5 w-5 text-muted-foreground transition-transform',
              (refreshing || pullOffset >= 60) && 'animate-spin text-primary'
            )}
            style={{ transform: refreshing ? undefined : `rotate(${pullOffset * 3}deg)` }}
          />
        </div>
      )}
      {/* Header */}
      <div className="gradient-warm p-6 pb-8 shadow-soft">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-8 w-8 text-white" />
            <h1 className="text-3xl font-bold text-white">Your Contacts</h1>
          </div>
          <p className="text-white/90 text-sm">All the wonderful people in your life</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6">
        {/* Add Contact Buttons */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Button 
            onClick={() => setAddDialogOpen(true)}
            variant="secondary"
            className="gap-2 h-12 rounded-2xl"
          >
            <Plus className="h-5 w-5" />
            Add Contact
          </Button>
          <Button 
            onClick={() => setImportDialogOpen(true)}
            variant="secondary"
            className="gap-2 h-12 rounded-2xl"
          >
            <Users className="h-5 w-5" />
            Import Contacts
          </Button>
        </div>

        {/* Search and Filter */}
        <div className="mb-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 rounded-2xl border-2 pr-12"
            />
            <div className="absolute right-1.5 top-1/2 h-9 w-9 -translate-y-1/2 overflow-hidden rounded-full">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh contacts"
                onClick={handleRefresh}
                disabled={refreshing}
                tapTransition={{ type: 'spring', stiffness: 500, damping: 50 }}
                className="h-9 w-9 rounded-full"
              >
                <RefreshCw className={cn('h-4 w-4 text-muted-foreground', refreshing && 'animate-spin')} />
              </Button>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Badge
              variant={!showFavoritesOnly && filterRelationship === null ? "default" : "outline"}
              className="cursor-pointer capitalize px-4 py-2 rounded-full"
              onClick={() => {
                setFilterRelationship(null);
                setShowFavoritesOnly(false);
              }}
            >
              All
            </Badge>
            <Badge
              variant={showFavoritesOnly ? "default" : "outline"}
              className="cursor-pointer capitalize px-4 py-2 rounded-full gap-1"
              onClick={() => {
                setShowFavoritesOnly(!showFavoritesOnly);
                setFilterRelationship(null);
              }}
            >
              <Star className="h-3 w-3" />
              Favorites
            </Badge>
            {relationships.map(rel => (
              <Badge
                key={rel}
                variant={filterRelationship === rel ? "default" : "outline"}
                className={cn(
                  "cursor-pointer capitalize px-4 py-2 rounded-full",
                  filterRelationship === rel && relationshipBadgeClass(rel)
                )}
                onClick={() => {
                  setFilterRelationship(rel);
                  setShowFavoritesOnly(false);
                }}
              >
                {rel}
              </Badge>
            ))}
          </div>
        </div>

        {/* Contact List */}
        <div className="space-y-4 pb-6">
          <AnimatePresence initial={false}>
            {filteredContacts.length > 0 ? (
              filteredContacts.map(contact => (
                <motion.div
                  key={contact.id}
                  layout
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                >
                  <ContactCard 
                    contact={contact}
                    onToggleFavorite={handleToggleFavorite}
                    onReschedule={(id) => setRescheduleDialog({ open: true, contactId: id })}
                    onEditTemplate={(id) => setTemplateDialog({ open: true, contactId: id })}
                    onEditContact={(id) => setEditContactId(id)}
                    onDeleteContact={(id) => deleteContact(id)}
                  />
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No contacts found</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AddContactDialog 
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAddContact={handleAddContact}
        contacts={contacts}
      />

      <AddContactDialog
        open={!!editContactId}
        onOpenChange={(open) => !open && setEditContactId(null)}
        onAddContact={handleAddContact}
        contact={contacts.find(c => c.id === editContactId) || null}
        onUpdateContact={updateContact}
        contacts={contacts}
      />

      <ImportContactsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportContacts={handleImportContacts}
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
