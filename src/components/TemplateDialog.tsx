import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Contact, TemplateTone } from '@/types/contact';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Save } from 'lucide-react';
import { templatesByTone, toneLabels, toneDescriptions, getToneForContact } from '@/data/templates';
import { cn } from '@/lib/utils';

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onSaveTemplate: (contactId: string, template: string) => void;
  onSaveTone?: (contactId: string, tone: TemplateTone) => void;
}

const tones: TemplateTone[] = ['warm', 'casual', 'friendly'];

export function TemplateDialog({ open, onOpenChange, contact, onSaveTemplate, onSaveTone }: TemplateDialogProps) {
  const { toast } = useToast();
  const [customTemplate, setCustomTemplate] = useState('');
  const [selectedTone, setSelectedTone] = useState<TemplateTone>('friendly');

  useEffect(() => {
    if (contact && open) {
      setSelectedTone(getToneForContact(contact.relationship, contact.templateTone));
      setCustomTemplate(contact.customTemplate || '');
    }
  }, [contact, open]);

  if (!contact) return null;

  const handleSelectTone = (tone: TemplateTone) => {
    setSelectedTone(tone);
    onSaveTone?.(contact.id, tone);
    toast({
      title: `${toneLabels[tone]} tone set`,
      description: `${contact.name}'s conversation starters will sound ${toneLabels[tone].toLowerCase()}.`,
    });
  };

  const handleUseTemplate = (template: string) => {
    onSaveTemplate(contact.id, template);
    toast({
      title: 'Starter saved ✨',
      description: `We'll suggest this when you call ${contact.name}.`,
    });
    onOpenChange(false);
  };

  const handleSaveCustomTemplate = () => {
    if (!customTemplate.trim()) {
      toast({
        title: 'Template required',
        description: 'Please enter a conversation starter.',
        variant: 'destructive',
      });
      return;
    }
    onSaveTemplate(contact.id, customTemplate.trim());
    toast({
      title: 'Template saved! ✨',
      description: `Custom starter saved for ${contact.name}.`,
    });
    onOpenChange(false);
  };

  const handleClearCustom = () => {
    setCustomTemplate('');
    onSaveTemplate(contact.id, '');
    toast({
      title: 'Back to suggestions',
      description: `${contact.name} will use the ${toneLabels[selectedTone].toLowerCase()} tone starters.`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conversation tone for {contact.name}</DialogTitle>
          <DialogDescription>
            Pick a default tone, then choose the opener that sounds most like you
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Tone picker */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Default tone</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {tones.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => handleSelectTone(tone)}
                  className={cn(
                    'rounded-2xl border-2 p-3 text-left transition-smooth',
                    selectedTone === tone
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card hover:bg-muted'
                  )}
                >
                  <p className="text-sm font-semibold text-foreground">{toneLabels[tone]}</p>
                  <p className="text-xs text-muted-foreground">{toneDescriptions[tone]}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Tone variants */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <p className="text-sm font-medium text-foreground">
                {toneLabels[selectedTone]} openers
              </p>
            </div>
            <div className="space-y-2">
              {templatesByTone[selectedTone].map((template) => (
                <div
                  key={template}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleUseTemplate(template)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUseTemplate(template)}
                  className={cn(
                    'p-3 rounded-xl bg-muted hover:bg-accent/10 transition-smooth cursor-pointer',
                    contact.customTemplate === template && 'ring-2 ring-primary'
                  )}
                >
                  <p className="text-sm text-foreground">“{template}”</p>
                </div>
              ))}
            </div>
          </div>

          {/* Custom */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Save className="h-4 w-4 text-primary" />
              <Label htmlFor="custom-template" className="text-sm font-medium">
                Or write your own
              </Label>
            </div>
            <Textarea
              id="custom-template"
              placeholder="Say it the way you actually would out loud…"
              value={customTemplate}
              onChange={(e) => setCustomTemplate(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Tip: use {'{name}'} where you'd say their name
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            {contact.customTemplate && (
              <Button variant="ghost" onClick={handleClearCustom}>
                Use suggestions instead
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={handleSaveCustomTemplate} disabled={!customTemplate.trim()} className="gap-2">
              <Save className="h-4 w-4" />
              Save starter
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
