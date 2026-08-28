import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UploadCloud, Search } from 'lucide-react';
import { Contact, CallPlatform } from '@/types/contact';
import { useToast } from '@/hooks/use-toast';
import { parseVCardFile, ParsedVCardContact } from '@/lib/vcard';

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportContacts: (contacts: Contact[]) => void;
}

type Step = 'input' | 'select' | 'categorize';

// Cap the number of contacts a single import can carry through to categorize/save.
// A phone export can have hundreds of entries; this keeps the app responsive.
const MAX_SELECTABLE = 500;

export function ImportContactsDialog({ open, onOpenChange, onImportContacts }: ImportContactsDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('input');
  const [contactsInput, setContactsInput] = useState('');
  const [parsedContacts, setParsedContacts] = useState<ParsedVCardContact[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [isParsingFile, setIsParsingFile] = useState(false);

  const [relationship, setRelationship] = useState<'family' | 'friend' | 'colleague' | 'acquaintance'>('friend');
  const [platforms, setPlatforms] = useState<CallPlatform[]>(['phone']);

  const platformOptions: { value: CallPlatform; label: string }[] = [
    { value: 'phone', label: 'Phone Call' },
    { value: 'whatsapp', label: 'WhatsApp Call' },
    { value: 'instagram', label: 'Instagram Call' },
    { value: 'snapchat', label: 'Snapchat Call' },
  ];

  const resetAll = () => {
    setStep('input');
    setContactsInput('');
    setParsedContacts([]);
    setSelected(new Set());
    setSearch('');
    setRelationship('friend');
    setPlatforms(['phone']);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const togglePlatform = (platform: CallPlatform) => {
    setPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  const goToSelect = (contacts: ParsedVCardContact[]) => {
    if (contacts.length === 0) {
      toast({
        title: "No contacts found",
        description: "We couldn't find any contacts to import there.",
        variant: "destructive"
      });
      return;
    }
    const capped = contacts.slice(0, MAX_SELECTABLE);
    if (contacts.length > MAX_SELECTABLE) {
      toast({
        title: "Large file trimmed",
        description: `Found ${contacts.length} contacts — showing the first ${MAX_SELECTABLE}.`,
      });
    }
    setParsedContacts(capped);
    setSelected(new Set(capped.map((_, i) => i))); // default: all selected
    setSearch('');
    setStep('select');
  };

  const handleFileChosen = async (file: File) => {
    setIsParsingFile(true);
    try {
      const text = await file.text();
      const parsed = parseVCardFile(text);
      goToSelect(parsed);
    } catch (err) {
      toast({
        title: "Couldn't read that file",
        description: "Make sure it's a valid .vcf contacts export.",
        variant: "destructive"
      });
    } finally {
      setIsParsingFile(false);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileChosen(file);
  };

  const parseManualContacts = () => {
    if (!contactsInput.trim()) {
      toast({
        title: "Input required",
        description: "Please enter contact names (one per line).",
        variant: "destructive"
      });
      return;
    }

    const lines = contactsInput.trim().split('\n');
    const contacts: ParsedVCardContact[] = lines
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const parts = trimmed.split(',').map(p => p.trim());
        return { name: parts[0], phone: parts[1] || undefined };
      })
      .filter((c): c is ParsedVCardContact => !!c && !!c.name);

    goToSelect(contacts);
  };

  const toggleSelected = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const filteredIndexes = parsedContacts
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q);
    })
    .map(({ i }) => i);

  const selectAllFiltered = () => {
    setSelected(prev => {
      const next = new Set(prev);
      filteredIndexes.forEach(i => next.add(i));
      return next;
    });
  };

  const deselectAllFiltered = () => {
    setSelected(prev => {
      const next = new Set(prev);
      filteredIndexes.forEach(i => next.delete(i));
      return next;
    });
  };

  const goToCategorize = () => {
    if (selected.size === 0) {
      toast({
        title: "No contacts selected",
        description: "Select at least one contact to continue.",
        variant: "destructive"
      });
      return;
    }
    setStep('categorize');
  };

  const handleImport = () => {
    if (platforms.length === 0) {
      toast({
        title: "Platform required",
        description: "Please select at least one call platform.",
        variant: "destructive"
      });
      return;
    }

    const chosen = parsedContacts.filter((_, i) => selected.has(i));

    const newContacts: Contact[] = chosen.map(contact => ({
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: contact.name,
      phone: contact.phone,
      avatar: contact.avatar,
      relationship,
      callFrequency: 'weekly',
      platforms,
      notes: [],
      priority: 2,
      isFavorite: false
    }));

    onImportContacts(newContacts);

    toast({
      title: "Contacts imported! 🎉",
      description: `Successfully imported ${newContacts.length} contact${newContacts.length === 1 ? '' : 's'}.`,
    });

    resetAll();
    onOpenChange(false);
  };

  const handleBackToSelect = () => setStep('select');
  const handleBackToInput = () => setStep('input');

  const titles: Record<Step, string> = {
    input: 'Import Contacts',
    select: 'Choose Contacts',
    categorize: 'Categorize Contacts',
  };

  const descriptions: Record<Step, string> = {
    input: 'Import from a contacts file exported by your phone, or enter names manually.',
    select: `Found ${parsedContacts.length} contact${parsedContacts.length === 1 ? '' : 's'} — pick which ones to bring in.`,
    categorize: `Categorize ${selected.size} contact${selected.size === 1 ? '' : 's'}`,
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAll(); onOpenChange(o); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titles[step]}</DialogTitle>
          <DialogDescription>{descriptions[step]}</DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <Tabs defaultValue="file" className="pt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">From Phone</TabsTrigger>
              <TabsTrigger value="manual">Type Manually</TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-4 pt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".vcf,.vcard,text/vcard,text/x-vcard"
                className="hidden"
                onChange={onFileInputChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isParsingFile}
                className="w-full border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-2 text-center hover:bg-muted/50 transition-colors disabled:opacity-60"
              >
                <UploadCloud className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {isParsingFile ? 'Reading file…' : 'Tap to choose a contacts file'}
                </span>
                <span className="text-xs text-muted-foreground">.vcf file exported from your phone</span>
              </button>

              <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded-md p-3">
                <p className="font-medium text-foreground">How to export contacts:</p>
                <p><span className="font-medium">iPhone:</span> Contacts app → select contacts → Share → Save as .vcf, or export all via iCloud.com → Contacts → select all → Export vCard.</p>
                <p><span className="font-medium">Android:</span> Contacts app → Fix &amp; Manage → Export → to .vcf file.</p>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="contacts">Enter Contacts</Label>
                <Textarea
                  id="contacts"
                  placeholder="John Doe&#10;Jane Smith, +1234567890&#10;Bob Johnson"
                  value={contactsInput}
                  onChange={(e) => setContactsInput(e.target.value)}
                  className="min-h-[200px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Format: Name or Name, Phone Number (one per line)
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={parseManualContacts}>Next</Button>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {step === 'select' && (
          <div className="space-y-3 pt-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{selected.size} of {parsedContacts.length} selected</span>
              <div className="flex gap-3">
                <button className="text-primary font-medium" onClick={selectAllFiltered}>Select all</button>
                <button className="text-primary font-medium" onClick={deselectAllFiltered}>Deselect all</button>
              </div>
            </div>

            <ScrollArea className="h-[280px] border rounded-md">
              <div className="p-1">
                {filteredIndexes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No matches.</p>
                )}
                {filteredIndexes.map(i => {
                  const c = parsedContacts[i];
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleSelected(i)}
                    >
                      <Checkbox checked={selected.has(i)} onCheckedChange={() => toggleSelected(i)} />
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={c.avatar} alt={c.name} />
                        <AvatarFallback className="text-xs">
                          {c.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        {c.phone && <p className="text-xs text-muted-foreground truncate">{c.phone}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex gap-2 justify-between pt-2">
              <Button variant="outline" onClick={handleBackToInput}>Back</Button>
              <Button onClick={goToCategorize}>
                Continue with {selected.size}
              </Button>
            </div>
          </div>
        )}

        {step === 'categorize' && (
          <div className="space-y-4 pt-4">
            <div className="p-3 bg-muted rounded-md max-h-24 overflow-y-auto">
              <p className="text-sm font-medium mb-1">Contacts to import:</p>
              <p className="text-xs text-muted-foreground">
                {parsedContacts.filter((_, i) => selected.has(i)).map(c => c.name).join(', ')}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Relationship</Label>
              <RadioGroup value={relationship} onValueChange={(value: any) => setRelationship(value)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="family" id="family" />
                  <Label htmlFor="family" className="cursor-pointer font-normal">Family</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="friend" id="friend" />
                  <Label htmlFor="friend" className="cursor-pointer font-normal">Friend</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="colleague" id="colleague" />
                  <Label htmlFor="colleague" className="cursor-pointer font-normal">Colleague</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="acquaintance" id="acquaintance" />
                  <Label htmlFor="acquaintance" className="cursor-pointer font-normal">Acquaintance</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Call Platforms *</Label>
              <div className="grid grid-cols-2 gap-3">
                {platformOptions.map(({ value, label }) => (
                  <div key={value} className="flex items-center space-x-2">
                    <Checkbox
                      id={value}
                      checked={platforms.includes(value)}
                      onCheckedChange={() => togglePlatform(value)}
                    />
                    <label
                      htmlFor={value}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-between pt-4">
              <Button variant="outline" onClick={handleBackToSelect}>Back</Button>
              <Button onClick={handleImport}>
                Import {selected.size} Contact{selected.size === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
