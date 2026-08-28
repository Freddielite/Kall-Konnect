export type CallPlatform =
  | 'phone'
  | 'whatsapp'
  | 'instagram'
  | 'snapchat'
  | 'whatsapp-audio'
  | 'whatsapp-video'
  | 'instagram-audio'
  | 'instagram-video'
  | 'snapchat-audio'
  | 'snapchat-video';

export interface SpecialDate {
  id: string;
  label: string;
  date: Date;
}

export interface Contact {
  id: string;
  name: string;
  phone?: string;
  phoneSecondary?: string;
  whatsappPhone?: string;
  avatar?: string;
  relationship: 'family' | 'friend' | 'colleague' | 'acquaintance';
  lastCalled?: Date;
  callFrequency: 'weekly' | 'biweekly' | 'monthly';
  notes: CallNote[];
  platforms: CallPlatform[];
  priority: number;
  isFavorite: boolean;
  birthday?: Date;
  anniversary?: Date;
  specialDates?: SpecialDate[];
  snoozedUntil?: Date;
  customTemplate?: string;
  templateTone?: TemplateTone;
  instagramUsername?: string;
  snapchatUsername?: string;
}

export interface CallNote {
  id: string;
  date: Date;
  content: string;
  duration?: number;
}

export interface WeeklySuggestion {
  day: string;
  contact: Contact;
  conversationStarter: string;
}

export type TemplateTone = 'warm' | 'casual' | 'friendly';

export interface ConversationTemplate {
  id: string;
  tone: TemplateTone;
  template: string;
  isCustom: boolean;
}
