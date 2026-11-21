import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOwnerSelfReschedule } from '../src/lib/owner-self-reschedule.server.ts';

const studioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherStudioId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const appointmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const professionalId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const createdAt = '2030-10-30T10:00:00.123Z';
const oldStart = '2030-10-31T10:00:00Z';
const newStart = '2030-10-31T11:00:00Z';
const notice = { studioId, notificationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  appointmentId, startsAt: newStart, recipientId: ownerId, recipientRole: 'studio_owner' };

function database({ actorId = ownerId, operation = 'move', eventStart = newStart,
  eventCreatedAt = createdAt, notificationStudioId = studioId,
  notificationKind = 'appointment_rescheduled' } = {}) {
  const rows = {
    studio_notifications: [{ id: notice.notificationId, studio_id: notificationStudioId,
      kind: notificationKind, created_at: createdAt }],
    appointment_schedule_events: [{ studio_id: studioId, appointment_id: appointmentId,
      created_at: eventCreatedAt, actor_id: actorId, operation,
      previous_state: { startsAt: oldStart }, next_state: { startsAt: eventStart } }],
  };
  return { from(table) {
    let selected = rows[table];
    const query = {
      select() { return query; },
      eq(key, value) { selected = selected.filter((row) => row[key] === value); return query; },
      in(key, values) { selected = selected.filter((row) => values.includes(row[key])); return query; },
      limit(count) { return Promise.resolve({ data: selected.slice(0, count), error: null }); },
      maybeSingle() { return Promise.resolve({ data: selected[0] ?? null, error: null }); },
    };
    return query;
  } };
}

test('only the authenticated owner who moved the same appointment loses their studio push', async () => {
  assert.equal(await isOwnerSelfReschedule(database(), notice), true);
  assert.equal(await isOwnerSelfReschedule(database(), { ...notice, recipientRole: 'saas_owner' }), true);
  assert.equal(await isOwnerSelfReschedule(database(), { ...notice, recipientId: professionalId,
    recipientRole: 'studio_owner' }), false);
  assert.equal(await isOwnerSelfReschedule(database(), { ...notice, recipientId: professionalId,
    recipientRole: 'staff' }), false);
  assert.equal(await isOwnerSelfReschedule(database(), { ...notice, recipientRole: 'client' }), false);
  assert.equal(await isOwnerSelfReschedule(database({ actorId: professionalId }), notice), false);
});

test('other studio, unrelated event, later event and other notification kinds remain deliverable', async () => {
  assert.equal(await isOwnerSelfReschedule(database({ notificationStudioId: otherStudioId }), notice), false);
  assert.equal(await isOwnerSelfReschedule(database({ eventCreatedAt: '2030-10-30T10:00:01Z' }), notice), false);
  assert.equal(await isOwnerSelfReschedule(database({ eventStart: oldStart }), notice), false);
  assert.equal(await isOwnerSelfReschedule(database({ operation: 'duration' }), notice), false);
  assert.equal(await isOwnerSelfReschedule(database({ notificationKind: 'appointment_cancelled' }), notice), false);
});
