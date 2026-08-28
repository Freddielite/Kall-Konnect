import { Contact } from '@/types/contact';

export const mockContacts: Contact[] = [
  {
    id: '1',
    name: 'Mum',
    phone: '+234 801 234 5678',
    relationship: 'family',
    lastCalled: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    callFrequency: 'weekly',
    notes: [
      {
        id: 'n1',
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        content: 'Talked about her garden project. She planted new roses.',
        duration: 25
      }
    ],
    platforms: ['phone', 'whatsapp-audio'],
    priority: 1,
    isFavorite: true,
    birthday: new Date(1965, 4, 15)
  },
  {
    id: '2',
    name: 'Tunde',
    phone: '+234 802 345 6789',
    instagramUsername: 'tunde_style',
    relationship: 'friend',
    lastCalled: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
    callFrequency: 'biweekly',
    notes: [
      {
        id: 'n2',
        date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
        content: 'Discussing his new job opportunity. Seems excited but nervous.',
        duration: 40
      }
    ],
    platforms: ['phone', 'whatsapp-audio', 'instagram-audio'],
    priority: 2,
    isFavorite: true
  },
  {
    id: '3',
    name: 'Sarah',
    phone: '+1 234 567 8900',
    relationship: 'colleague',
    lastCalled: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    callFrequency: 'monthly',
    notes: [],
    platforms: ['phone', 'whatsapp-video'],
    priority: 3,
    isFavorite: false
  },
  {
    id: '4',
    name: 'Dad',
    phone: '+234 803 456 7890',
    relationship: 'family',
    lastCalled: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    callFrequency: 'weekly',
    notes: [
      {
        id: 'n3',
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        content: 'Watched the football match together over the phone. He was happy his team won.',
        duration: 35
      }
    ],
    platforms: ['phone', 'whatsapp-audio'],
    priority: 1,
    isFavorite: true,
    birthday: new Date(1962, 8, 22),
    anniversary: new Date(1990, 6, 10)
  },
  {
    id: '5',
    name: 'Emma',
    snapchatUsername: 'emma_snaps',
    relationship: 'friend',
    lastCalled: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    callFrequency: 'monthly',
    notes: [],
    platforms: ['phone', 'instagram-audio', 'snapchat-audio'],
    priority: 2,
    isFavorite: false
  },
  {
    id: '6',
    name: 'James',
    phone: '+44 20 7946 0958',
    relationship: 'colleague',
    lastCalled: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    callFrequency: 'biweekly',
    notes: [
      {
        id: 'n4',
        date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        content: 'Brainstormed ideas for the new project. He suggested some great approaches.',
        duration: 50
      }
    ],
    platforms: ['phone', 'whatsapp-audio'],
    priority: 3,
    isFavorite: false
  },
  {
    id: '7',
    name: 'Aisha',
    phone: '+234 805 678 9012',
    instagramUsername: 'aisha.visuals',
    snapchatUsername: 'aisha_snaps',
    relationship: 'friend',
    lastCalled: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    callFrequency: 'weekly',
    notes: [],
    platforms: ['phone', 'whatsapp-audio', 'whatsapp-video'],
    priority: 2,
    isFavorite: false
  }
];
