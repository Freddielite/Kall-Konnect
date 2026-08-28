import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Contact, CallPlatform, SpecialDate } from '@/types/contact';
import { Plus, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { toLocalDateString } from '@/lib/utils';
import { learnedToneForRelationship } from '@/lib/toneLearning';

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddContact: (contact: Contact) => void;
  contact?: Contact | null;
  onUpdateContact?: (id: string, updates: Partial<Contact>) => void;
  /** Existing contacts, used to learn a preferred tone per relationship type (see lib/toneLearning). */
  contacts?: Contact[];
}

const toDateInput = (date?: Date) => (date ? toLocalDateString(new Date(date)) : '');

type SimplePlatform = 'phone' | 'whatsapp' | 'instagram' | 'snapchat';

const platformOptions: { value: SimplePlatform; label: string; usernameLabel?: string }[] = [
  { value: 'phone', label: 'Phone Call' },
  { value: 'whatsapp', label: 'WhatsApp Call' },
  { value: 'instagram', label: 'Instagram Call', usernameLabel: 'Instagram username' },
  { value: 'snapchat', label: 'Snapchat Call', usernameLabel: 'Snapchat username' },
];

export function AddContactDialog({ open, onOpenChange, onAddContact, contact, onUpdateContact, contacts = [] }: AddContactDialogProps) {
  const isEditing = !!contact;
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [phones, setPhones] = useState<string[]>(['']);
  const [whatsappIndex, setWhatsappIndex] = useState(0);
  const [instagramUsername, setInstagramUsername] = useState('');
  const [snapchatUsername, setSnapchatUsername] = useState('');
  const [relationship, setRelationship] = useState<'family' | 'friend' | 'colleague' | 'acquaintance'>('friend');
  const [callFrequency, setCallFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [platforms, setPlatforms] = useState<SimplePlatform[]>(['phone']);
  const [birthday, setBirthday] = useState('');
  const [anniversary, setAnniversary] = useState('');
  const [specialDates, setSpecialDates] = useState<{ label: string; date: string }[]>([]);
  const [errors, setErrors] = useState<{ name?: string; phones?: (string | undefined)[] }>({});

  useEffect(() => {
    if (!open) return;
    if (contact) {
      setName(contact.name);
      const list = [contact.phone || ''];
      if (contact.phoneSecondary) list.push(contact.phoneSecondary);
      setPhones(list);
      const wa = contact.whatsappPhone?.trim();
      setWhatsappIndex(wa && list[1] && wa === list[1].trim() ? 1 : 0);
      setInstagramUsername(contact.instagramUsername || '');
      setSnapchatUsername(contact.snapchatUsername || '');
      setRelationship(contact.relationship);
      setCallFrequency(contact.callFrequency);
      const simple = Array.from(
        new Set(
          (contact.platforms || [])
            .map((p) => String(p).split('-')[0] as SimplePlatform)
            .filter((p) => ['phone', 'whatsapp', 'instagram', 'snapchat'].includes(p))
        )
      );
      setPlatforms(simple.length ? simple : ['phone']);
      setBirthday(toDateInput(contact.birthday));
      setAnniversary(toDateInput(contact.anniversary));
      setSpecialDates(
        (contact.specialDates || []).map((sd) => ({ label: sd.label, date: toDateInput(sd.date) }))
      );
      setErrors({});
    } else {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact?.id]);

  const togglePlatform = (platform: SimplePlatform) => {
    setPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  const resetForm = () => {
    setName('');
    setPhones(['']);
    setWhatsappIndex(0);
    setInstagramUsername('');
    setSnapchatUsername('');
    setRelationship('friend');
    setCallFrequency('weekly');
    setPlatforms(['phone']);
    setBirthday('');
    setAnniversary('');
    setSpecialDates([]);
    setErrors({});
  };

  const updatePhone = (index: number, value: string) => {
    setPhones(prev => prev.map((p, i) => (i === index ? value : p)));
    if (errors.phones) setErrors(prev => ({ ...prev, phones: undefined }));
  };

  const addPhoneField = () => {
    if (phones.length < 2) setPhones(prev => [...prev, '']);
  };

  const removePhoneField = (index: number) => {
    setPhones(prev => prev.filter((_, i) => i !== index));
    if (whatsappIndex >= phones.length - 1) setWhatsappIndex(0);
  };

  const handleWhatsappToggle = (index: number) => {
    setWhatsappIndex(prev => (prev === index ? 0 : index));
  };

  const handleSubmit = () => {
    const nextErrors: { name?: string; phones?: (string | undefined)[] } = {};
    if (!name.trim()) nextErrors.name = 'Please enter a name.';
    const phoneErrors = phones.map((value, index) => {
      const trimmed = value.trim();
      if (!trimmed) return index === 0 ? 'Please enter a phone number.' : 'Please enter a phone number or remove this field.';
      if (!/^\+\d[\d\s-]{6,}$/.test(trimmed)) return 'Use the country code format, e.g. +234 801 234 5678.';
      return undefined;
    });
    if (phoneErrors.some(Boolean)) nextErrors.phones = phoneErrors;
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.phones) return;

    if (platforms.length === 0) {
      toast({
        title: 'Platform required',
        description: 'Please select at least one call platform.',
        variant: 'destructive',
      });
      return;
    }

    const trimmedInstagram = instagramUsername.trim().replace(/^@/, '');
    const trimmedSnapchat = snapchatUsername.trim().replace(/^@/, '');
    const primaryPhone = phones[0].trim();
    const secondaryPhone = phones[1]?.trim();
    const whatsappPhone = phones[whatsappIndex]?.trim() || primaryPhone;

    const payload = {
      name: name.trim(),
      phone: primaryPhone,
      phoneSecondary: secondaryPhone || undefined,
      whatsappPhone: platforms.includes('whatsapp') ? whatsappPhone : undefined,
      instagramUsername: platforms.includes('instagram') ? trimmedInstagram || undefined : undefined,
      snapchatUsername: platforms.includes('snapchat') ? trimmedSnapchat || undefined : undefined,
      relationship,
      callFrequency,
      platforms: platforms as CallPlatform[],
      notes: contact?.notes ?? [],
      priority: contact?.priority ?? 2,
      isFavorite: contact?.isFavorite ?? false,
      birthday: birthday ? new Date(`${birthday}T00:00:00`) : undefined,
      anniversary: anniversary ? new Date(`${anniversary}T00:00:00`) : undefined,
      specialDates: specialDates
        .filter(sd => sd.label.trim() && sd.date)
        .map((sd, index): SpecialDate => ({
          id: `${Date.now()}-${index}`,
          label: sd.label.trim(),
          date: new Date(`${sd.date}T00:00:00`),
        })),
      // Preserve an explicit tone the user already picked when editing;
      // for a brand-new contact, quietly pre-select whatever tone the
      // user tends to actually pick for this relationship type instead
      // of always falling back to the one-size-fits-all default.
      templateTone: isEditing
        ? contact?.templateTone
        : learnedToneForRelationship(contacts, relationship) ?? undefined,
    };

    if (isEditing && contact && onUpdateContact) {
      onUpdateContact(contact.id, payload);
      toast({
        title: 'Contact updated',
        description: `${payload.name}'s details have been saved.`,
      });
    } else {
      onAddContact({ id: Date.now().toString(), ...payload } as Contact);
      resetForm();
      toast({
        title: 'Contact added! 🎉',
        description: `${payload.name} has been added to your contacts.`,
      });
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Contact' : 'Add New Contact'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update this contact\u2019s details' : 'Add someone new to your relationship network'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              placeholder="Enter contact name"
              value={name}
              aria-invalid={!!errors.name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
              }}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Phone Numbers *</Label>
              {phones.length < 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 rounded-full"
                  onClick={addPhoneField}
                >
                  <Plus className="h-4 w-4" />
                  Add another number
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {phones.map((value, index) => (
                <div key={index} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={`+1 234 567 8900${index === 0 ? '' : ' (optional)'}`}
                      value={value}
                      aria-invalid={!!(errors.phones?.[index])}
                      onChange={(e) => updatePhone(index, e.target.value)}
                      className="flex-1"
                    />
                    {phones.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove phone number"
                        onClick={() => removePhoneField(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pl-1">
                    <Checkbox
                      id={`whatsapp-${index}`}
                      checked={whatsappIndex === index}
                      onCheckedChange={() => handleWhatsappToggle(index)}
                    />
                    <label htmlFor={`whatsapp-${index}`} className="text-xs text-muted-foreground cursor-pointer">
                      Use for WhatsApp
                    </label>
                  </div>
                  {errors.phones?.[index] && <p className="text-sm text-destructive">{errors.phones[index]}</p>}
                </div>
              ))}
            </div>
            {phones.length > 1 && (
              <p className="text-xs text-muted-foreground">
                The first number is used for regular calls. Toggle which number to use for WhatsApp.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="relationship">Relationship</Label>
            <Select value={relationship} onValueChange={(value: any) => setRelationship(value)}>
              <SelectTrigger id="relationship">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="family">Family</SelectItem>
                <SelectItem value="friend">Friend</SelectItem>
                <SelectItem value="colleague">Colleague</SelectItem>
                <SelectItem value="acquaintance">Acquaintance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="frequency">Call Frequency</Label>
            <Select value={callFrequency} onValueChange={(value: any) => setCallFrequency(value)}>
              <SelectTrigger id="frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Bi-weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="birthday">Birthday (optional)</Label>
              <Input
                id="birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="anniversary">Anniversary (optional)</Label>
              <Input
                id="anniversary"
                type="date"
                value={anniversary}
                onChange={(e) => setAnniversary(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Special dates (optional)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 rounded-full"
                onClick={() => setSpecialDates(prev => [...prev, { label: '', date: '' }])}
              >
                <Plus className="h-4 w-4" />
                Add date
              </Button>
            </div>
            {specialDates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                e.g. "Work anniversary" or "First met day"
              </p>
            )}
            {specialDates.map((sd, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`special-label-${index}`} className="text-xs text-muted-foreground">
                    Label
                  </Label>
                  <Input
                    id={`special-label-${index}`}
                    placeholder="Work anniversary"
                    value={sd.label}
                    onChange={(e) =>
                      setSpecialDates(prev =>
                        prev.map((item, i) => (i === index ? { ...item, label: e.target.value } : item))
                      )
                    }
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`special-date-${index}`} className="text-xs text-muted-foreground">
                    Date
                  </Label>
                  <Input
                    id={`special-date-${index}`}
                    type="date"
                    value={sd.date}
                    onChange={(e) =>
                      setSpecialDates(prev =>
                        prev.map((item, i) => (i === index ? { ...item, date: e.target.value } : item))
                      )
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove special date"
                  onClick={() => setSpecialDates(prev => prev.filter((_, i) => i !== index))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <Label>Call Platforms *</Label>
            <div className="space-y-3">
              {platformOptions.map(({ value, label, usernameLabel }) => {
                const selected = platforms.includes(value);
                return (
                  <div key={value} className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={value}
                        checked={selected}
                        onCheckedChange={() => togglePlatform(value)}
                      />
                      <label htmlFor={value} className="text-sm font-medium leading-none cursor-pointer">
                        {label}
                      </label>
                    </div>
                    {selected && usernameLabel && (
                      <div className="ml-6 space-y-1">
                        <Label htmlFor={`${value}-username`} className="text-xs text-muted-foreground">
                          {usernameLabel}
                        </Label>
                        <Input
                          id={`${value}-username`}
                          placeholder="username"
                          value={value === 'instagram' ? instagramUsername : snapchatUsername}
                          onChange={(e) =>
                            value === 'instagram'
                              ? setInstagramUsername(e.target.value)
                              : setSnapchatUsername(e.target.value)
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {isEditing ? 'Save Changes' : 'Add Contact'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
