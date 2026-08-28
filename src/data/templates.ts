import { ConversationTemplate, TemplateTone } from '@/types/contact';

export const toneLabels: Record<TemplateTone, string> = {
  warm: 'Warm',
  casual: 'Casual',
  friendly: 'Friendly',
};

export const toneDescriptions: Record<TemplateTone, string> = {
  warm: 'Warm and unguarded — for family and the people closest to you',
  casual: 'Casual and familiar — for close friends',
  friendly: 'Friendly but lighter — for colleagues and acquaintances',
};

export const templatesByTone: Record<TemplateTone, string[]> = {
  warm: [
    "Hey, thinking about you today — how's everything?",
    'Miss you, what have you been up to?',
    'Calling to hear your voice, how are you doing?',
  ],
  casual: [
    "Yo, it's been a minute! What's good with you?",
    'Hey stranger, what have you been up to lately?',
    "Was just thinking about you, what's new?",
  ],
  friendly: [
    'Hey! Hope things are going well on your end.',
    "Been a while — how's work treating you?",
    'Wanted to check in and see how you\u2019re doing.',
  ],
};

export const defaultToneForRelationship: Record<
  'family' | 'friend' | 'colleague' | 'acquaintance',
  TemplateTone
> = {
  family: 'warm',
  friend: 'casual',
  colleague: 'friendly',
  acquaintance: 'friendly',
};

export const defaultTemplates: ConversationTemplate[] = (
  Object.keys(templatesByTone) as TemplateTone[]
).flatMap((tone) =>
  templatesByTone[tone].map((template, index) => ({
    id: `${tone}-${index + 1}`,
    tone,
    template,
    isCustom: false,
  }))
);

export function getToneForContact(
  relationship: 'family' | 'friend' | 'colleague' | 'acquaintance',
  templateTone?: TemplateTone
): TemplateTone {
  return templateTone || defaultToneForRelationship[relationship] || 'friendly';
}

export function getTemplateForContact(
  relationship: 'family' | 'friend' | 'colleague' | 'acquaintance',
  customTemplate?: string,
  templateTone?: TemplateTone
): string {
  if (customTemplate) {
    return customTemplate;
  }

  const options = templatesByTone[getToneForContact(relationship, templateTone)];
  return options[Math.floor(Math.random() * options.length)];
}

export function formatTemplate(template: string, name: string): string {
  return template.replace(/\{name\}/g, name);
}

// Used when a contact's most recent note tripped the learned
// follow-up vocabulary (see lib/noteSignals) - swaps the generic
// opener for one that references picking the last conversation back
// up, instead of a fresh check-in.
export const followUpStarters: string[] = [
  "Hey, we got cut short last time - actually free to talk now?",
  "Been thinking about our last chat, got more time for it now?",
  "Let's pick up where we left off last time!",
];

export function getFollowUpStarter(): string {
  return followUpStarters[Math.floor(Math.random() * followUpStarters.length)];
}
