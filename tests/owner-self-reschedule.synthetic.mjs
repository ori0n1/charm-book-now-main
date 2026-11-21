import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOwnerSelfReschedule, ownerSelfRescheduleIds, projectOwnerBell } from '../src/lib/owner-self-reschedule.server.ts';

const studioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherStudioId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const appointmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherOwnerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const createdAt = '2030-10-30T10:00:00.123Z';
const oldStart = '2030-10-31T10:00:00Z';
const newStart = '2030-10-31T11:00:00Z';
const staffA = '11111111-1111-4111-8111-111111111111';
const staffB = '22222222-2222-4222-8222-222222222222';
const notice = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', studio_id: studioId,
  appointment_id: appointmentId, kind: 'appointment_rescheduled', created_at: createdAt,
  payload: { appointment_id: appointmentId, starts_at: newStart, staff_id: staffA } };
const event = { studio_id: studioId, appointment_id: appointmentId, created_at: createdAt,
  actor_id: ownerId, operation: 'move', previous_state: { startsAt: oldStart, staffId: staffA },
  next_state: { startsAt: newStart, staffId: staffA } };

test('only the audited owner loses their own reschedule in history and unread projection', () => {
  assert.deepEqual([...ownerSelfRescheduleIds([notice], [event], ownerId, 'studio_owner')], [notice.id]);
  assert.deepEqual([...ownerSelfRescheduleIds([notice], [event], ownerId, 'saas_owner')], [notice.id]);
  assert.equal(ownerSelfRescheduleIds([notice], [event], otherOwnerId, 'studio_owner').size, 0);
  assert.equal(ownerSelfRescheduleIds([notice], [event], ownerId, 'staff').size, 0);
  assert.equal(ownerSelfRescheduleIds([notice], [event], ownerId, 'client').size, 0);
  assert.equal(ownerSelfRescheduleIds([notice], [{ ...event, actor_id: otherOwnerId }], ownerId, 'studio_owner').size, 0);
});

test('unread count excludes a self event even beyond the 100 visible history entries', () => {
  const other = { id: otherOwnerId };
  const hidden = new Set([notice.id]);
  assert.deepEqual(projectOwnerBell([notice, other], [notice], 2, hidden),
    { items: [other], unreadCount: 1 });
  assert.deepEqual(projectOwnerBell([other], [notice], 2, hidden),
    { items: [other], unreadCount: 1 });
});

test('cross-professional drag is excluded; unrelated events and studios remain visible', () => {
  const sameTimeNotice = { ...notice, payload: { ...notice.payload, starts_at: oldStart, staff_id: staffB } };
  const changedStaff = { ...event, operation: 'duration',
    next_state: { startsAt: oldStart, staffId: staffB } };
  assert.equal(ownerSelfRescheduleIds([sameTimeNotice], [changedStaff], ownerId, 'studio_owner').size, 1);
  for (const different of [
    { ...event, studio_id: otherStudioId },
    { ...event, created_at: '2030-10-30T10:00:01Z' },
    { ...event, next_state: { startsAt: oldStart, staffId: staffA } },
    { ...event, operation: 'cancel' },
  ]) assert.equal(ownerSelfRescheduleIds([notice], [different], ownerId, 'studio_owner').size, 0);
  assert.equal(ownerSelfRescheduleIds([{ ...notice, kind: 'appointment_cancelled' }], [event], ownerId, 'studio_owner').size, 0);
  assert.equal(ownerSelfRescheduleIds([{ ...notice, payload: { ...notice.payload, appointment_id: otherStudioId } }],
    [event], ownerId, 'studio_owner').size, 0);
  assert.equal(ownerSelfRescheduleIds([notice], [event, event], ownerId, 'studio_owner').size, 0);
});

function database(rows) {
  return { from(table) {
    let selected = rows[table] ?? [];
    const query = {
      select() { return query; },
      eq(key, value) { selected = selected.filter((row) => row[key] === value); return query; },
      in(key, values) { selected = selected.filter((row) => values.includes(row[key])); return query; },
      order() { return query; },
      range(first, last) { return Promise.resolve({ data: selected.slice(first, last + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: selected[0] ?? null, error: null }); },
    };
    return query;
  } };
}

test('push and bell use the persisted notification and audited actor', async () => {
  const db = database({ studio_notifications: [notice], appointment_schedule_events: [event] });
  const input = { studioId, notificationId: notice.id, appointmentId, startsAt: newStart,
    recipientId: ownerId, recipientRole: 'studio_owner' };
  assert.equal(await isOwnerSelfReschedule(db, input), true);
  assert.equal(await isOwnerSelfReschedule(db, { ...input, recipientId: otherOwnerId }), false);
  assert.equal(await isOwnerSelfReschedule(db, { ...input, recipientRole: 'staff' }), false);
  const staffNotice = { ...notice, payload: { ...notice.payload, starts_at: oldStart, staff_id: staffB } };
  const staffEvent = { ...event, operation: 'duration',
    next_state: { startsAt: oldStart, staffId: staffB } };
  assert.equal(await isOwnerSelfReschedule(database({ studio_notifications: [staffNotice],
    appointment_schedule_events: [staffEvent] }), { ...input, startsAt: oldStart }), true);
});
