import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { Contact, CallNote } from '@/types/contact';
import { toast } from 'sonner';
import { toLocalDateString, parseLocalDate, errorMessage } from '@/lib/utils';

interface ContactRow {
  id: string; name: string; phone: string | null; phone_secondary: string | null;
  whatsapp_phone: string | null; avatar: string | null; relationship: string;
  last_called: string | null; call_frequency: string; platforms: unknown[];
  priority: number; is_favorite: boolean; birthday: string | null; anniversary: string | null;
  snoozed_until: string | null; custom_template: string | null; template_tone: string | null;
  instagram_username: string | null; snapchat_username: string | null;
}
interface CallNoteRow { id: string; contact_id: string; content: string; duration: number | null; created_at: string; }
interface SpecialDateRow { id: string; contact_id: string; label: string; date: string; }

const UNDO_WINDOW_MS = 5000;

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  // Contacts optimistically hidden after delete, pending the undo window.
  const pendingDeletes = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const fetchContacts = useCallback(async () => {
    try {
      const [contactsData, notesData, specialDatesData] = await Promise.all([
        api.get<ContactRow[]>('/contacts'),
        api.get<CallNoteRow[]>('/call-notes'),
        api.get<SpecialDateRow[]>('/special-dates'),
      ]);

      const transformedContacts: Contact[] = (contactsData || []).map((contact) => {
        const contactNotes: CallNote[] = (notesData || [])
          .filter((note) => note.contact_id === contact.id)
          .map((note) => ({
            id: note.id,
            date: new Date(note.created_at),
            content: note.content,
            duration: note.duration ?? undefined,
          }));

        return {
          id: contact.id,
          name: contact.name,
          phone: contact.phone || undefined,
          phoneSecondary: contact.phone_secondary || undefined,
          whatsappPhone: contact.whatsapp_phone || undefined,
          avatar: contact.avatar || undefined,
          relationship: contact.relationship as 'family' | 'friend' | 'colleague' | 'acquaintance',
          lastCalled: contact.last_called ? new Date(contact.last_called) : undefined,
          callFrequency: contact.call_frequency as 'weekly' | 'biweekly' | 'monthly',
          notes: contactNotes,
          platforms: contact.platforms as Contact['platforms'],
          priority: contact.priority,
          isFavorite: contact.is_favorite,
          birthday: contact.birthday ? parseLocalDate(contact.birthday) : undefined,
          anniversary: contact.anniversary ? parseLocalDate(contact.anniversary) : undefined,
          specialDates: (specialDatesData || [])
            .filter((sd) => sd.contact_id === contact.id)
            .map((sd) => ({ id: sd.id, label: sd.label, date: parseLocalDate(sd.date) })),
          snoozedUntil: contact.snoozed_until ? new Date(contact.snoozed_until) : undefined,
          customTemplate: contact.custom_template || undefined,
          templateTone: (contact.template_tone as Contact['templateTone']) || undefined,
          instagramUsername: contact.instagram_username || undefined,
          snapchatUsername: contact.snapchat_username || undefined,
        };
      });

      // Don't let a refetch (e.g. a realtime ping) resurrect a contact that's
      // still sitting in its undo window on this client.
      setContacts(transformedContacts.filter((c) => !pendingDeletes.current.has(c.id)));
    } catch (error: unknown) {
      toast.error('Failed to load contacts: ' + errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Replaces the old Supabase Realtime channel — the server pings us over
  // WebSocket whenever contacts/notes/special dates change, and we refetch.
  useRealtime((event) => {
    if (event.type === 'contacts') fetchContacts();
  });

  // Flush any pending deletes on unmount instead of silently dropping them.
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      pending.forEach((timeoutId, id) => {
        clearTimeout(timeoutId);
        api.delete(`/contacts/${id}`).catch(() => {});
      });
    };
  }, []);

  const addContact = async (contact: Omit<Contact, 'id' | 'notes'>) => {
    try {
      const inserted = await api.post<{ id: string }>('/contacts', {
        name: contact.name,
        phone: contact.phone,
        phone_secondary: contact.phoneSecondary || null,
        whatsapp_phone: contact.whatsappPhone || null,
        avatar: contact.avatar,
        relationship: contact.relationship,
        last_called: contact.lastCalled?.toISOString(),
        call_frequency: contact.callFrequency,
        platforms: contact.platforms,
        priority: contact.priority,
        is_favorite: contact.isFavorite,
        birthday: contact.birthday ? toLocalDateString(contact.birthday) : undefined,
        anniversary: contact.anniversary ? toLocalDateString(contact.anniversary) : undefined,
        snoozed_until: contact.snoozedUntil?.toISOString(),
        custom_template: contact.customTemplate,
        template_tone: contact.templateTone || null,
        instagram_username: contact.instagramUsername?.trim() || null,
        snapchat_username: contact.snapchatUsername?.trim() || null,
      });

      const specialDates = (contact.specialDates || []).filter((sd) => sd.label?.trim() && sd.date);
      if (inserted && specialDates.length > 0) {
        await api.put(`/contacts/${inserted.id}/special-dates`, {
          dates: specialDates.map((sd) => ({ label: sd.label.trim(), date: toLocalDateString(new Date(sd.date)) })),
        });
      }

      toast.success('Contact added successfully!');
      fetchContacts();
    } catch (error: unknown) {
      toast.error('Failed to add contact: ' + errorMessage(error));
    }
  };

  const updateContact = async (id: string, updates: Partial<Contact>) => {
    try {
      const dbUpdates: Record<string, unknown> = {};

      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.phoneSecondary !== undefined) dbUpdates.phone_secondary = updates.phoneSecondary || null;
      if (updates.whatsappPhone !== undefined) dbUpdates.whatsapp_phone = updates.whatsappPhone || null;
      if (updates.relationship !== undefined) dbUpdates.relationship = updates.relationship;
      if (updates.lastCalled !== undefined) dbUpdates.last_called = updates.lastCalled?.toISOString();
      if (updates.callFrequency !== undefined) dbUpdates.call_frequency = updates.callFrequency;
      if (updates.platforms !== undefined) dbUpdates.platforms = updates.platforms;
      if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
      if (updates.isFavorite !== undefined) dbUpdates.is_favorite = updates.isFavorite;
      if (updates.birthday !== undefined) dbUpdates.birthday = updates.birthday ? toLocalDateString(updates.birthday) : null;
      if (updates.anniversary !== undefined) dbUpdates.anniversary = updates.anniversary ? toLocalDateString(updates.anniversary) : null;
      if (updates.snoozedUntil !== undefined) dbUpdates.snoozed_until = updates.snoozedUntil?.toISOString();
      if (updates.customTemplate !== undefined) dbUpdates.custom_template = updates.customTemplate || null;
      if (updates.templateTone !== undefined) dbUpdates.template_tone = updates.templateTone || null;
      if (updates.instagramUsername !== undefined) dbUpdates.instagram_username = updates.instagramUsername?.trim() || null;
      if (updates.snapchatUsername !== undefined) dbUpdates.snapchat_username = updates.snapchatUsername?.trim() || null;

      if (Object.keys(dbUpdates).length > 0) {
        await api.patch(`/contacts/${id}`, dbUpdates);
      }

      if (updates.specialDates !== undefined) {
        const specialDates = (updates.specialDates || []).filter((sd) => sd.label?.trim() && sd.date);
        await api.put(`/contacts/${id}/special-dates`, {
          dates: specialDates.map((sd) => ({ label: sd.label.trim(), date: toLocalDateString(new Date(sd.date)) })),
        });
      }

      fetchContacts();
    } catch (error: unknown) {
      toast.error('Failed to update contact: ' + errorMessage(error));
    }
  };

  const deleteContact = (id: string) => {
    const contact = contacts.find((c) => c.id === id);
    if (!contact) return;

    // A delete already pending for this contact (e.g. double tap) — ignore.
    if (pendingDeletes.current.has(id)) return;

    // Optimistically hide it immediately; the actual API call is deferred
    // until the undo window closes.
    setContacts((prev) => prev.filter((c) => c.id !== id));

    const commit = async () => {
      pendingDeletes.current.delete(id);
      try {
        await api.delete(`/contacts/${id}`);
      } catch (error: unknown) {
        toast.error('Failed to delete contact: ' + errorMessage(error));
        fetchContacts(); // resync — the optimistic removal was wrong
      }
    };

    const timeoutId = setTimeout(commit, UNDO_WINDOW_MS);
    pendingDeletes.current.set(id, timeoutId);

    toast(`${contact.name} deleted`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const pending = pendingDeletes.current.get(id);
          if (pending) {
            clearTimeout(pending);
            pendingDeletes.current.delete(id);
          }
          setContacts((prev) =>
            prev.some((c) => c.id === id) ? prev : [...prev, contact]
          );
        },
      },
    });
  };

  const addCallNote = async (contactId: string, note: Omit<CallNote, 'id'>) => {
    try {
      await api.post('/call-notes', {
        contact_id: contactId,
        content: note.content,
        duration: note.duration,
      });

      // Update last_called timestamp
      await updateContact(contactId, { lastCalled: new Date() });
    } catch (error: unknown) {
      toast.error('Failed to add call note: ' + errorMessage(error));
    }
  };

  return {
    contacts,
    loading,
    addContact,
    updateContact,
    deleteContact,
    addCallNote,
    refreshContacts: fetchContacts,
  };
}
