import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  disabledNotificationKinds,
  notificationCategoryForKind,
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
