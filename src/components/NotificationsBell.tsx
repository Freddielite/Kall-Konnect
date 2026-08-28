import { Bell, PhoneMissed, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

export function NotificationsBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-10 w-10 rounded-full" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-auto py-1 text-xs" onClick={markAllAsRead}>
              Mark all read
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="divide-y">
              {notifications.map((n) => {
                const Icon = n.type === 'inactivity' ? PhoneMissed : Clock;
                return (
                  <button
                    key={n.id}
                    onClick={() => !n.read_at && markAsRead(n.id)}
                    className={cn(
                      'w-full text-left p-3 flex gap-3 transition-smooth hover:bg-muted',
                      !n.read_at && 'bg-accent/5'
                    )}
                  >
                    <Icon className="h-4 w-4 mt-0.5 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <p className={cn('text-sm text-foreground', !n.read_at && 'font-semibold')}>{n.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(n.scheduled_for), { addSuffix: true })}
                      </p>
                    </div>
                    {!n.read_at && <span className="h-2 w-2 mt-1.5 rounded-full bg-accent shrink-0" />}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
