import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Preferences {
  notification_frequency: 'daily' | 'weekly' | 'monthly';
  inactivity_days: number;
  notifications_enabled: boolean;
  call_frequency: 'weekly' | 'biweekly' | 'monthly';
  preferred_call_time: 'morning' | 'afternoon' | 'evening' | 'anytime';
  auto_add_calendar_reminders: boolean;
}

const DEFAULTS: Preferences = {
  notification_frequency: 'daily',
  inactivity_days: 14,
  notifications_enabled: true,
  call_frequency: 'weekly',
  preferred_call_time: 'evening',
  auto_add_calendar_reminders: false,
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
