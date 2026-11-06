import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { CONTACTS_QUERY_KEY } from '@/hooks/useContacts';

interface DeletedContact {
  id: string;
  name: string;
  relationship: string;
  deleted_at: string;
  purge_after: string;
}

/** Nested under the contacts key, so any contact change (a delete on
 * another screen, a live update from another device) refreshes it too. */
const DELETED_QUERY_KEY = [...CONTACTS_QUERY_KEY, 'deleted'] as const;

function daysLeft(purgeAfter: string): number {
  return Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - Date.now()) / 86_400_000));
}

/** Contacts deleted in the last 30 days, each with a Restore button. The
 * server keeps them (with their notes) until the window runs out. */
export function RecentlyDeleted() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: deleted = [], isLoading, isError, refetch } = useQuery({
    queryKey: DELETED_QUERY_KEY,
    queryFn: () => api.get<DeletedContact[]>('/contacts/deleted'),
  });

  const restore = useMutation({
    mutationFn: (contact: DeletedContact) => api.post(`/contacts/${contact.id}/restore`),
    onSuccess: (_data, contact) => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      toast({ title: `${contact.name} is back`, description: 'Their notes and dates came back too.' });
    },
    onError: (error) => {
      toast({ title: "Couldn't restore that contact", description: errorMessage(error), variant: 'destructive' });
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Couldn't load deleted contacts.</p>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }
  if (deleted.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing here. Deleted contacts stay restorable for 30 days.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {deleted.map((contact) => {
        const left = daysLeft(contact.purge_after);
        return (
          <li key={contact.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{contact.name}</p>
              <p className="text-xs text-muted-foreground">
                {left === 0 ? 'Removed for good today' : `Removed for good in ${left} day${left === 1 ? '' : 's'}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1.5 shrink-0"
              disabled={restore.isPending}
              onClick={() => restore.mutate(contact)}
              aria-label={`Restore ${contact.name}`}
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
