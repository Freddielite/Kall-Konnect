import { StatsCard } from '@/components/StatsCard';
import { motion } from 'framer-motion';
import { useContacts } from '@/hooks/useContacts';
import { BarChart3, Phone, Users, TrendingUp, Calendar, Heart, Flame, Cake } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

const DAY_MS = 1000 * 60 * 60 * 24;

export default function Stats() {
  const navigate = useNavigate();
  const { contacts, loading } = useContacts();

  const totalContacts = contacts.length;

  // All logged calls (call notes) across contacts
  const allCalls = contacts.flatMap((c) =>
    (c.notes || []).map((n) => ({ contact: c, date: new Date(n.date) }))
  );

  const now = Date.now();
  const callsThisWeek = allCalls.filter((c) => now - c.date.getTime() <= 7 * DAY_MS).length;
  const callsThisMonth = allCalls.filter((c) => now - c.date.getTime() <= 30 * DAY_MS).length;
  const totalCalls = allCalls.length;
  const avgCallsPerWeek = Math.round((callsThisMonth / (30 / 7)) * 10) / 10;

  // Current streak: consecutive days (ending today or yesterday) with at least one call
  const callDays = new Set(allCalls.map((c) => new Date(c.date).toDateString()));
  let currentStreak = 0;
  const startOffset = callDays.has(new Date().toDateString()) ? 0 : 1;
  if (callDays.has(new Date(now - startOffset * DAY_MS).toDateString())) {
    let offset = startOffset;
    while (callDays.has(new Date(now - offset * DAY_MS).toDateString())) {
      currentStreak++;
      offset++;
    }
  }

  const getDaysUntil = (date: Date) => {
    const today = new Date();
    const d = new Date(date);
    const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    return Math.ceil((thisYear.getTime() - new Date(today.toDateString()).getTime()) / DAY_MS);
  };

  const upcomingBirthdays = contacts
    .filter((c) => c.birthday && getDaysUntil(c.birthday) >= 0 && getDaysUntil(c.birthday) <= 30)
    .sort((a, b) => getDaysUntil(a.birthday!) - getDaysUntil(b.birthday!));

  const relationshipCounts = {
    family: contacts.filter((c) => c.relationship === 'family').length,
    friend: contacts.filter((c) => c.relationship === 'friend').length,
    colleague: contacts.filter((c) => c.relationship === 'colleague').length,
    acquaintance: contacts.filter((c) => c.relationship === 'acquaintance').length,
  };

  // Most contacted = most logged calls
  const topContacts = [...contacts]
    .map((c) => ({ contact: c, calls: (c.notes || []).length }))
    .filter((c) => c.calls > 0)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 3);

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <motion.div
      className="min-h-screen pb-24 bg-background"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {/* Header */}
      <div className="gradient-warm p-6 pb-8 shadow-soft">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="h-8 w-8 text-white" />
            <h1 className="text-3xl font-bold text-white">Your Stats</h1>
          </div>
          <p className="text-white/90 text-sm">Track your relationship journey</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6">
        {loading ? (
          <div className="py-16 text-center text-muted-foreground animate-pulse">Loading your stats...</div>
        ) : totalCalls === 0 ? (
          <Card className="p-8 text-center shadow-soft border-2">
            <div className="h-14 w-14 mx-auto mb-4 rounded-full gradient-warm flex items-center justify-center">
              <Phone className="h-7 w-7 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">No calls logged yet</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Your stats will show up here once you start making calls — add a few contacts and
              check in with someone today.
            </p>
            <Button className="rounded-full" onClick={() => navigate('/contacts')}>
              Go to Contacts
            </Button>
          </Card>
        ) : (
          <>
            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <StatsCard title="This Week" value={callsThisWeek} subtitle="calls made" icon={Phone} variant="success" />
              <StatsCard title="This Month" value={callsThisMonth} subtitle="calls made" icon={Calendar} variant="accent" />
              <StatsCard title="Total Contacts" value={totalContacts} subtitle="in your network" icon={Users} variant="default" />
              <StatsCard title="Weekly Average" value={avgCallsPerWeek} subtitle="calls per week" icon={TrendingUp} variant="success" />
            </div>

            {/* Current Streak */}
            <Card className="p-6 mb-6 shadow-soft border-2 bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Flame className="h-6 w-6 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Current Streak</h3>
                </div>
                <span className="text-3xl font-bold text-primary">{currentStreak}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {currentStreak > 1
                  ? `${currentStreak} days in a row of staying connected. Keep it going! 🔥`
                  : currentStreak === 1
                    ? 'You called someone today — that’s a streak started! 🔥'
                    : 'Make a call today to start a new streak.'}
              </p>
            </Card>

            {/* Upcoming Birthdays */}
            {upcomingBirthdays.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Cake className="h-5 w-5 text-accent" />
                  <h3 className="text-lg font-semibold text-foreground">Upcoming Birthdays</h3>
                </div>
                <div className="space-y-3">
                  {upcomingBirthdays.map((contact) => {
                    const birthday = new Date(contact.birthday!);
                    const daysUntil = getDaysUntil(contact.birthday!);

                    return (
                      <Card key={contact.id} className="p-4 shadow-soft border-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10 border-2 border-primary/20">
                              <AvatarFallback className="gradient-warm text-white font-semibold text-sm">
                                {getInitials(contact.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold text-foreground">{contact.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {birthday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                              </p>
                            </div>
                          </div>
                          <Badge variant="default" className="bg-accent">
                            {daysUntil === 0 ? 'Today!' : `${daysUntil}d`}
                          </Badge>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Relationship Breakdown */}
            {totalContacts > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Network Breakdown</h3>
                <Card className="p-6 shadow-soft border-2">
                  <div className="space-y-4">
                    {(
                      [
                        ['Family', relationshipCounts.family],
                        ['Friends', relationshipCounts.friend],
                        ['Colleagues', relationshipCounts.colleague],
                        ['Acquaintances', relationshipCounts.acquaintance],
                      ] as const
                    ).map(([label, count]) => (
                      <div key={label}>
                        <div className="flex justify-between mb-2">
                          <span className="text-sm font-medium text-foreground">{label}</span>
                          <span className="text-sm text-muted-foreground">{count} contacts</span>
                        </div>
                        <Progress value={(count / totalContacts) * 100} className="h-2" />
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* Encouragement Card */}
            <Card className="p-6 mb-6 shadow-soft border-2 bg-accent/5 border-accent/20">
              <div className="flex items-center gap-3 mb-3">
                <Heart className="h-6 w-6 text-accent" />
                <h3 className="text-lg font-semibold text-foreground">You're Amazing!</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                You've made <span className="font-bold text-accent">{callsThisWeek}</span> calls this week.
                Every conversation strengthens your relationships. Keep up the wonderful work! 💙
              </p>
            </Card>

            {/* Top Contacts */}
            {topContacts.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Most Contacted</h3>
                <div className="space-y-3">
                  {topContacts.map(({ contact, calls }, index) => (
                    <Card key={contact.id} className="p-4 shadow-soft border-2 transition-smooth hover:shadow-warm">
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <Avatar className="h-12 w-12 border-2 border-primary/20">
                            <AvatarFallback className="gradient-warm text-white font-semibold">
                              {getInitials(contact.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold border-2 border-background">
                            {index + 1}
                          </div>
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-foreground">{contact.name}</p>
                          <p className="text-sm text-muted-foreground capitalize">{contact.relationship}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-foreground">{calls} {calls === 1 ? 'call' : 'calls'}</p>
                          {contact.lastCalled && (
                            <p className="text-xs text-muted-foreground">
                              {Math.floor((now - new Date(contact.lastCalled).getTime()) / DAY_MS)}d ago
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Fun Fact */}
            <Card className="p-6 shadow-soft border-2 bg-secondary/5 border-secondary/20">
              <h3 className="text-lg font-semibold text-foreground mb-2">Did you know?</h3>
              <p className="text-sm text-muted-foreground">
                Regular phone conversations have been shown to reduce stress and strengthen emotional bonds.
                You're not just making calls—you're building a healthier, happier life! 🌟
              </p>
            </Card>
          </>
        )}
      </div>
    </motion.div>
  );
}
