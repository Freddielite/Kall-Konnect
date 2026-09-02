import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Preferences {
  notification_frequency: 'daily' | 'weekly' | 'monthly';
  inactivity_days: number;
  notifications_enabled: boolean;
  call_frequency: 'weekly' | 'biweekly' | 'monthly';
  preferred_call_time: 'morning' | 'afternoon' | 'evening' | 'anytime';
  auto_add_calendar_reminders: boolean;
  quiet_day_nudges: boolean;
  notification_categories: NotificationCategories;
}

/** Keys match notifications.type on the server (SCENARIO_TYPES in
 * reminderCopy.js) and the CHECK constraint in migration 006/007. A missing
 * key means enabled, so a preferences row written before a category existed
 * doesn't silently go quiet. */
export type NotificationCategory =
  | 'planned_call' | 'inactivity' | 'occasion' | 'follow_up' | 'first_call' | 'streak';

export type NotificationCategories = Partial<Record<NotificationCategory, boolean>>;

const DEFAULTS: Preferences = {
  notification_frequency: 'daily',
  inactivity_days: 14,
  notifications_enabled: true,
  call_frequency: 'weekly',
  preferred_call_time: 'evening',
  auto_add_calendar_reminders: false,
  quiet_day_nudges: true,
  notification_categories: {
    planned_call: true, inactivity: true, occasion: true,
    follow_up: true, first_call: true, streak: true,
  },
};

export const usePreferences = () => {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const fetchPreferences = useCallback(async () => {
    try {
      const data = await api.get<Partial<Preferences>>('/preferences');
      setPreferences({ ...DEFAULTS, ...data });
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const updatePreferences = async (updates: Partial<Preferences>) => {
    setPreferences((prev) => ({ ...prev, ...updates })); // optimistic
    try {
      await api.patch('/preferences', updates);
    } catch (error) {
      console.error('Error updating preferences:', error);
      fetchPreferences(); // roll back to server truth on failure
    }
  };

  return { preferences, loading, updatePreferences, refresh: fetchPreferences };
};
