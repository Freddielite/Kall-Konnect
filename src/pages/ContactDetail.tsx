import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useContacts } from '@/hooks/useContacts';
import { useLogCallFlow } from '@/hooks/useLogCallFlow';
import { ContactCard } from '@/components/ContactCard';
import { AddContactDialog } from '@/components/AddContactDialog';
import { RescheduleDialog } from '@/components/RescheduleDialog';
import { TemplateDialog } from '@/components/TemplateDialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TemplateTone } from '@/types/contact';

const formatDateTime = (date: Date) =>
  new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const formatNoteDateTime = (date: Date) =>
  new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { contacts, loading, updateContact, deleteContact, addContact, addCallNote } = useContacts();
  const contact = contacts.find((c) => c.id === id);
  const logCall = useLogCallFlow({ contacts, addCallNote });

  const [editOpen, setEditOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const handleReschedule = (contactId: string, date: Date) => {
    updateContact(contactId, { snoozedUntil: date });
  };

  const handleSaveTone = (contactId: string, tone: TemplateTone) => {
    updateContact(contactId, { templateTone: tone, customTemplate: '' });
  };

  const handleSaveTemplate = (contactId: string, template: string) => {
    updateContact(contactId, { customTemplate: template });
  };

  const handleDelete = (contactId: string) => {
    deleteContact(contactId);
    navigate('/contacts');
  };

  if (loading) {
    return (
      <div className="min-h-screen pb-nav-safe bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading contact...</div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="min-h-screen pb-nav-safe bg-background flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-muted-foreground mb-4">Contact not found.</p>
          <Button onClick={() => navigate('/contacts')} className="rounded-full">
            Back to Contacts
          </Button>
        </div>
      </div>
    );
  }

  // Newest first - matches how the "last call" summary and the history
  // list below both want to read.
  const sortedNotes = [...contact.notes].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const lastCall = sortedNotes[0];

  return (
    <motion.div
      className="min-h-screen pb-nav-safe bg-background"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {/* Header */}
      <div className="gradient-warm header-safe px-6 pb-6 shadow-soft">
        <div className="max-w-lg mx-auto">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 -ml-2 mb-2"
            onClick={() => navigate('/contacts')}
            aria-label="Back to contacts"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-white">{contact.name}</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6 pb-6">
        <ContactCard
          contact={contact}
          onToggleFavorite={(cid) => updateContact(cid, { isFavorite: !contact.isFavorite })}
          onReschedule={() => setRescheduleOpen(true)}
          onEditTemplate={() => setTemplateOpen(true)}
          onEditContact={() => setEditOpen(true)}
          onDeleteContact={handleDelete}
          onLogCallOutside={logCall.openLogCall}
        />

        {/* Last call summary */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Last call</h2>
          {lastCall ? (
            <div>
              <p className="text-foreground font-medium">{formatDateTime(lastCall.date)}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {lastCall.duration != null ? `${lastCall.duration} min` : 'Duration not logged'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No calls logged yet.</p>
          )}
        </Card>

        {/* Call history */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            Call history{sortedNotes.length > 0 ? ` (${sortedNotes.length})` : ''}
          </h2>
          {sortedNotes.length > 0 ? (
            <div className="space-y-3">
              {sortedNotes.map((noteEntry) => (
                <Card key={noteEntry.id} className="p-4">
                  <div className="flex items-center justify-between mb-1 gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {formatNoteDateTime(noteEntry.date)}
                    </p>
                    {noteEntry.duration != null && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {noteEntry.duration} min
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {noteEntry.content}
                  </p>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-5 text-center text-sm text-muted-foreground">
              No notes logged yet. Use the ⋮ menu above to log a call.
            </Card>
          )}
        </div>
      </div>

      <AddContactDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onAddContact={addContact}
        contact={contact}
        onUpdateContact={updateContact}
        contacts={contacts}
      />

      <RescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        contact={contact}
        onReschedule={handleReschedule}
      />

      <TemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        contact={contact}
        onSaveTemplate={handleSaveTemplate}
        onSaveTone={handleSaveTone}
      />

      {/* Log a Call (outside the app) */}
      {logCall.dialogs}
    </motion.div>
  );
}
