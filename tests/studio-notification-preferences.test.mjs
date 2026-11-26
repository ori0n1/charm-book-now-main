import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  disabledNotificationKinds,
  isRecipientNotificationCategoryDisabled,
  notificationCategoryForKind,
  notificationRecipientRole,
} from '../src/lib/studio-notification-preferences.ts';

test('one preference covers each related studio event without affecting other categories', () => {
  assert.deepEqual(disabledNotificationKinds(['payments']).sort(), [
    'payment_confirmed', 'payment_failed', 'refund_request', 'withdrawal_requested',
  ].sort());
  assert.deepEqual(disabledNotificationKinds(['pending']).sort(), [
    'attendance_confirmation', 'attendance_summary', 'critical_request',
  ].sort());
  assert.equal(notificationCategoryForKind('new_appointment'), 'new_appointments');
  assert.equal(notificationCategoryForKind('appointment_rescheduled'), 'reschedules');
  assert.equal(notificationCategoryForKind('appointment_cancelled'), 'cancellations');
  assert.equal(notificationCategoryForKind('future_studio_kind'), 'other');
});

test('owner preferences take priority when the recipient also has a staff role', () => {
  assert.equal(notificationRecipientRole(['staff', 'studio_owner']), 'studio_owner');
  assert.equal(notificationRecipientRole(['manager', 'saas_owner']), 'saas_owner');
  assert.equal(notificationRecipientRole(['staff']), 'staff');
});

test('push delivery checks only the owner recipient and selected category', async () => {
  const calls = [];
  const db = { from(table) {
    calls.push(['table', table]);
    return {
      select(column) { calls.push(['select', column]); return this; },
      eq(column, value) { calls.push([column, value]); return this; },
      async maybeSingle() { return { data: { enabled: false }, error: null }; },
    };
  } };
  const input = { studioId: 'studio-a', userId: 'owner-a', kind: 'new_appointment', role: 'studio_owner' };
  assert.equal(await isRecipientNotificationCategoryDisabled(db, input), true);
  assert.deepEqual(calls, [
    ['table', 'studio_notification_preferences'], ['select', 'enabled'],
    ['studio_id', 'studio-a'], ['user_id', 'owner-a'], ['category', 'new_appointments'],
  ]);
  calls.length = 0;
  assert.equal(await isRecipientNotificationCategoryDisabled(db, { ...input, role: 'staff' }), false);
  assert.deepEqual(calls, []);
});
