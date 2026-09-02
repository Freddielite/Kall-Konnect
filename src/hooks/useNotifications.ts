import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';

export interface AppNotification {
  id: string;
  contact_id: string | null;
  title: string;
  message: string;
  type: 'planned_call' | 'inactivity' | 'occasion' | 'follow_up' | 'first_call' | 'streak' | 'nudge';
  scheduled_for: string;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<AppNotification[]>('/notifications');
      setNotifications(data || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useRealtime((event) => {
    if (event.type === 'notifications') fetchNotifications();
  });

  const markAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch (error) {
      console.error('Error marking notification read:', error);
      fetchNotifications();
    }
  };

  const markAllAsRead = async () => {
    const hadUnread = notifications.some((n) => !n.read_at);
    if (!hadUnread) return;
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    try {
      await api.post('/notifications/read-all');
    } catch (error) {
      console.error('Error marking all notifications read:', error);
      fetchNotifications();
    }
  };

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return { notifications, loading, unreadCount, markAsRead, markAllAsRead, refresh: fetchNotifications };
}
