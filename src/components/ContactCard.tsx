import { Contact } from '@/types/contact';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Phone, Instagram, Star, Clock, Sparkles, Cake, Gift, CalendarHeart, CalendarDays, MoreVertical, Pencil, Trash2, EyeOff } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const frequencyPhrase: Record<Contact['callFrequency'], string> = {
  weekly: 'every week',
  biweekly: 'every 2 weeks',
  monthly: 'every month',
};
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
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

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.297.298-.496.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>
  );
}

function SnapchatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301a.42.42 0 01.17-.028c.07 0 .134.03.18.083.045.053.066.123.057.194a.7.7 0 01-.04.177c-.144.393-.821 1.076-1.54 1.076-.11.016-.22.016-.316-.015-.222-.06-.466-.09-.71-.09-.039.002-.078.005-.116.01-.135.857-.793 1.387-1.502 1.837a.36.36 0 00-.112.077c-.03.031-.044.07-.038.112.006.04.03.075.067.095.323.189.746.348 1.135.475.1.03.196.064.29.102.333.127.624.29.858.496.467.404.703.961.703 1.699-.007.44-.138.837-.385 1.172a2.3 2.3 0 01-.526.49 2.917 2.917 0 01-.765.353c-.283.09-.54.133-.78.14a.62.62 0 00-.38.135c-.132.116-.213.283-.25.512a2.295 2.295 0 01-.097.423c-.118.378-.363.653-.718.812a1.59 1.59 0 01-.655.13c-.214 0-.414-.03-.59-.086a1.54 1.54 0 00-.567-.107c-.24 0-.493.043-.756.13a2.3 2.3 0 00-.607.313 1.982 1.982 0 01-.504.293c-.197.08-.408.12-.627.12-.35 0-.644-.111-.874-.33-.23-.219-.362-.514-.39-.878a.59.59 0 00-.152-.383.62.62 0 00-.39-.178 2.51 2.51 0 01-.787-.185 2.224 2.224 0 01-.556-.358 2.11 2.11 0 01-.524-.74 2.532 2.532 0 01-.192-.99c0-.31.065-.6.194-.867.129-.266.316-.494.559-.68.243-.185.53-.324.86-.413a3.56 3.56 0 01.333-.083c.105-.02.192-.06.255-.118.063-.057.092-.127.084-.207-.006-.08-.05-.15-.127-.208a.31.31 0 00-.175-.062c-.386-.027-.739-.152-1.051-.371a2.28 2.28 0 01-.729-.824c-.156-.289-.262-.602-.315-.932a4.18 4.18 0 01-.03-.42c0-.06.006-.12.018-.178.006-.03.006-.06.002-.09-.004-.03-.015-.057-.032-.08a.274.274 0 00-.111-.08c-.395-.18-.85-.247-1.354-.198-.33.03-.623.135-.87.31-.122.086-.252.16-.39.22a.48.48 0 01-.175.034.37.37 0 01-.265-.108.37.37 0 01-.1-.265c0-.08.025-.156.073-.22.32-.43.81-.72 1.458-.86.38-.079.73-.085 1.012-.02.035.008.07.013.105.013.168 0 .324-.046.466-.138.117-.075.22-.174.305-.293.096-.135.177-.293.243-.47.035-.095.065-.194.09-.297.11-.485.175-1.022.191-1.596.02-.72-.07-1.38-.27-1.964-.46-1.318-1.49-2.04-2.71-2.55C8.2.275 11.006 0 12.206 0z"/>
    </svg>
  );
}


interface ContactCardProps {
  contact: Contact;
  occasion?: { type: 'birthday' | 'anniversary' | 'special'; label: string; daysUntil: number };
  conversationStarter?: string;
  onCallMade?: (contactId: string, platform: string) => void;
  onToggleFavorite?: (contactId: string) => void;
  onReschedule?: (contactId: string) => void;
  onEditTemplate?: (contactId: string) => void;
  onEditContact?: (contactId: string) => void;
  onDeleteContact?: (contactId: string) => void;
  /** Local-only "not now" - skips this suggestion for the rest of today without a server write. */
  onDismiss?: (contactId: string) => void;
  /** Fewer than a few logged calls - the suggested schedule is still a guess, not a learned rhythm. */
  isLowConfidence?: boolean;
  /** Most recent note matched a learned "needs following up on soon" signal. */
  followUpFlagged?: boolean;
  /** Day/time window this contact's calls actually tend to land in, e.g. "weekends evenings". */
  bestTime?: string | null;
  /** Set when the real call rhythm has drifted from contact.callFrequency. */
  suggestedFrequency?: Contact['callFrequency'] | null;
  onUpdateFrequency?: (contactId: string, frequency: Contact['callFrequency']) => void;
}

export function ContactCard({ contact, occasion, conversationStarter, onCallMade, onToggleFavorite, onReschedule, onEditTemplate, onEditContact, onDeleteContact, onDismiss, isLowConfidence, followUpFlagged, bestTime, suggestedFrequency, onUpdateFrequency }: ContactCardProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const OccasionIcon = occasion?.type === 'birthday' ? Gift : occasion?.type === 'anniversary' ? CalendarHeart : CalendarDays;
  const occasionWhen = occasion
    ? occasion.daysUntil === 0 ? 'today' : occasion.daysUntil === 1 ? 'tomorrow' : `in ${occasion.daysUntil} days`
    : '';

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const daysSinceLastCall = contact.lastCalled 
    ? Math.floor((Date.now() - contact.lastCalled.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const normalizePhoneForWhatsApp = (phone: string) => {
    return phone.replace(/[\s\-+]/g, '');
  };

  const openLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handlePhoneCall = () => {
    if (!contact.phone) return;
    openLink(`tel:${contact.phone.trim()}`);
    onCallMade?.(contact.id, 'phone');
  };

  const handleWhatsApp = () => {
    const waPhone = contact.whatsappPhone || contact.phone;
    if (!waPhone) return;
    const normalized = normalizePhoneForWhatsApp(waPhone);
    if (!normalized) return;
    openLink(`https://wa.me/${normalized}`);
    onCallMade?.(contact.id, 'whatsapp');
  };

  const handleInstagram = () => {
    if (!contact.instagramUsername) return;
    const username = contact.instagramUsername.trim().replace(/^@/, '');
    if (!username) return;
    openLink(`https://instagram.com/${username}`);
    onCallMade?.(contact.id, 'instagram');
  };

  const handleSnapchat = () => {
    if (!contact.snapchatUsername) return;
    const username = contact.snapchatUsername.trim().replace(/^@/, '');
    if (!username) return;
    openLink(`https://snapchat.com/add/${username}`);
    onCallMade?.(contact.id, 'snapchat');
  };

  const isUpcomingBirthday = () => {
    if (!contact.birthday) return false;
    const today = new Date();
    const birthday = new Date(contact.birthday);
    const thisYearBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
    const daysUntil = Math.ceil((thisYearBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil >= 0 && daysUntil <= 7;
  };

  return (
    <Card className="p-5 shadow-soft hover:shadow-warm transition-smooth border-2">
      <div className="flex items-start gap-4 mb-4">
        <Avatar className="h-14 w-14 border-2 border-primary/20">
          <AvatarFallback className="gradient-warm text-white font-semibold text-lg">
            {getInitials(contact.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-foreground">{contact.name}</h3>
            {contact.isFavorite && (
              <Star className="h-4 w-4 fill-accent text-accent" />
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge className={cn("text-xs capitalize", relationshipBadgeClass(contact.relationship))}>
              {contact.relationship}
            </Badge>
            {daysSinceLastCall !== null && (
              <Badge variant="outline" className="text-xs">
                {daysSinceLastCall === 0 ? 'Today' : `${daysSinceLastCall}d ago`}
              </Badge>
            )}
            {occasion && (
              <Badge className="text-xs gap-1 bg-accent text-accent-foreground">
                <OccasionIcon className="h-3 w-3" />
                {occasion.label} {occasionWhen}
              </Badge>
            )}
            {!occasion && isUpcomingBirthday() && (
              <Badge variant="default" className="text-xs gap-1 bg-accent">
                <Cake className="h-3 w-3" />
                Birthday Soon!
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onToggleFavorite && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={contact.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={() => onToggleFavorite(contact.id)}
              className="h-8 w-8"
            >
              <Star className={`h-5 w-5 ${contact.isFavorite ? 'fill-accent text-accent' : 'text-muted-foreground'}`} />
            </Button>
          )}
          {(onEditContact || onDeleteContact || onDismiss) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options">
                  <MoreVertical className="h-5 w-5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onDismiss && (
                  <DropdownMenuItem onClick={() => onDismiss(contact.id)} className="gap-2">
                    <EyeOff className="h-4 w-4" />
                    Not now
                  </DropdownMenuItem>
                )}
                {onDismiss && (onEditContact || onDeleteContact) && <DropdownMenuSeparator />}
                {onEditContact && (
                  <DropdownMenuItem onClick={() => onEditContact(contact.id)} className="gap-2">
                    <Pencil className="h-4 w-4" />
                    Edit Contact
                  </DropdownMenuItem>
                )}
                {onDeleteContact && (
                  <DropdownMenuItem
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Contact
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <AlertDialogContent className="max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {contact.name}?</AlertDialogTitle>
              <AlertDialogDescription>You'll have a few seconds to undo this after confirming.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onDeleteContact?.(contact.id)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {conversationStarter && (
        <div className="mb-4 p-3 bg-muted rounded-xl">
          <p className="text-sm text-muted-foreground italic">"{conversationStarter}"</p>
        </div>
      )}

      {contact.notes.length > 0 && (
        <div className="mb-4 p-3 bg-accent/10 rounded-xl border border-accent/20">
          <p className="text-sm text-foreground">
            <span className="font-medium">Last chat: </span>
            {contact.notes[0].content}
          </p>
          {followUpFlagged && (
            <p className="text-xs text-accent-foreground/80 mt-1.5 font-medium">
              Sounds like this one's worth following up on sooner
            </p>
          )}
        </div>
      )}

      {isLowConfidence && (
        <p className="text-xs text-muted-foreground mb-3">
          Still learning your rhythm with {contact.name.split(' ')[0]} - schedule will settle in after a few more calls
        </p>
      )}

      {bestTime && (
        <p className="text-xs text-muted-foreground mb-3">
          You usually reach {contact.name.split(' ')[0]} best on {bestTime}
        </p>
      )}

      {suggestedFrequency && onUpdateFrequency && (
        <div className="flex items-center justify-between gap-3 mb-3 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          <span>You've actually been checking in {frequencyPhrase[suggestedFrequency]} lately</span>
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2 shrink-0"
            onClick={() => onUpdateFrequency(contact.id, suggestedFrequency)}
          >
            Update?
          </button>
        </div>
      )}

      {/* Action Buttons for Reschedule/Template */}
      {(onReschedule || onEditTemplate) && (
        <div className="flex gap-2 mb-4">
          {onReschedule && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full gap-2 flex-1"
              onClick={() => onReschedule(contact.id)}
            >
              <Clock className="h-4 w-4" />
              Reschedule
            </Button>
          )}
          {onEditTemplate && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full gap-2 flex-1"
              onClick={() => onEditTemplate(contact.id)}
            >
              <Sparkles className="h-4 w-4" />
              Templates
            </Button>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {contact.phone && (
          <Button 
            size="sm" 
            className="rounded-full gap-2"
            onClick={handlePhoneCall}
          >
            <Phone className="h-4 w-4" />
            Call
          </Button>
        )}
        {(contact.whatsappPhone || contact.phone) && contact.platforms?.some(p => String(p).split('-')[0] === 'whatsapp') && (
          <Button
            size="sm"
            className="rounded-full gap-2 bg-whatsapp text-whatsapp-foreground hover:bg-whatsapp/90"
            onClick={handleWhatsApp}
          >
            <WhatsAppIcon className="h-4 w-4" />
            WhatsApp Call
          </Button>
        )}
        {contact.instagramUsername && contact.platforms?.some(p => String(p).split('-')[0] === 'instagram') && (
          <Button
            size="sm"
            className="rounded-full gap-2 gradient-instagram text-instagram-foreground hover:opacity-90"
            onClick={handleInstagram}
          >
            <Instagram className="h-4 w-4" />
            Instagram Call
          </Button>
        )}
        {contact.snapchatUsername && contact.platforms?.some(p => String(p).split('-')[0] === 'snapchat') && (
          <Button
            size="sm"
            className="rounded-full gap-2 bg-snapchat text-snapchat-foreground hover:bg-snapchat/90"
            onClick={handleSnapchat}
          >
            <SnapchatIcon className="h-4 w-4" />
            Snapchat Call
          </Button>
        )}
      </div>
    </Card>
  );
}
