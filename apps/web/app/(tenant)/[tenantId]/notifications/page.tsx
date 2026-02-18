'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useNotifications } from '@/features/notifications/useNotifications';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '@/shared/components/ui';
import { Trash2, Check, CheckCheck } from 'lucide-react';

export default function NotificationsPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const [isRead, setIsRead] = useState<boolean | undefined>(undefined);
  const [skip, setSkip] = useState(0);

  const { notifications, total, unreadCount, loading, error, fetch, markAsRead, markAllAsRead, deleteNotification } =
    useNotifications();

  const { toast } = useToast();
  const take = 50;

  // Fetch notifications on mount and when filters change
  useEffect(() => {
    fetch({ isRead, skip, take });
  }, [isRead, skip, fetch]);

  const handleMarkAsRead = async (id: string, currentRead: boolean) => {
    if (currentRead) return;
    try {
      await markAsRead(id);
      toast('Notification marked as read', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to mark as read', 'error');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead();
      toast('All notifications marked as read', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to mark all as read', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNotification(id);
      toast('Notification deleted', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete notification', 'error');
    }
  };

  const typeColors: Record<string, string> = {
    TICKET_STATUS_CHANGED: 'bg-blue-100 text-blue-900',
    TICKET_COMMENT_ADDED: 'bg-blue-100 text-blue-900',
    SUPPORT_TICKET_CREATED: 'bg-purple-100 text-purple-900',
    SUPPORT_TICKET_STATUS_CHANGED: 'bg-purple-100 text-purple-900',
    USER_INVITED: 'bg-green-100 text-green-900',
    INVITATION_ACCEPTED: 'bg-green-100 text-green-900',
    PAYMENT_RECEIVED: 'bg-emerald-100 text-emerald-900',
    PAYMENT_OVERDUE: 'bg-red-100 text-red-900',
    DOCUMENT_SHARED: 'bg-yellow-100 text-yellow-900',
    BUILDING_ALERT: 'bg-orange-100 text-orange-900',
    OCCUPANT_ASSIGNED: 'bg-cyan-100 text-cyan-900',
    SYSTEM_ALERT: 'bg-gray-100 text-gray-900',
  };

  if (loading && notifications.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error && notifications.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-6">Notifications</h1>
        <ErrorState
          message={error}
          onRetry={() => fetch({ isRead, skip, take })}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-gray-600 mt-2">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All notifications read'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button onClick={handleMarkAllAsRead} variant="secondary" size="sm">
            <CheckCheck size={16} className="mr-2" />
            Mark All Read
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Filter</label>
            <select
              value={isRead === undefined ? '' : String(isRead)}
              onChange={(e) => {
                const val = e.target.value;
                setIsRead(val === '' ? undefined : val === 'true');
                setSkip(0);
              }}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">All Notifications</option>
              <option value="false">Unread Only</option>
              <option value="true">Read Only</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <EmptyState
          title="No notifications"
          description={isRead === false ? 'You have read all notifications' : 'No notifications to display'}
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <Card
              key={notification.id}
              className={`p-4 ${!notification.isRead ? 'bg-blue-50 border-blue-200' : ''}`}
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-gray-900">{notification.title}</h3>
                    <Badge className={typeColors[notification.type] || 'bg-gray-100 text-gray-900'}>
                      {notification.type.replace(/_/g, ' ')}
                    </Badge>
                    {!notification.isRead && (
                      <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{notification.body}</p>
                  <div className="text-xs text-gray-500">
                    {new Date(notification.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 pt-4 border-t flex gap-2">
                {!notification.isRead && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleMarkAsRead(notification.id, notification.isRead)}
                  >
                    <Check size={16} className="mr-1" />
                    Mark as Read
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleDelete(notification.id)}
                >
                  <Trash2 size={16} className="mr-1" />
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination Info */}
      {notifications.length > 0 && (
        <div className="text-sm text-gray-600 text-center py-4">
          Showing {skip + 1} to {Math.min(skip + take, total)} of {total} notifications
        </div>
      )}
    </div>
  );
}
