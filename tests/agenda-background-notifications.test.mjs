import assert from 'node:assert/strict';
import test from 'node:test';
import { deferRequestBackground, withRequestBackground } from '../src/lib/request-background.server.ts';

test('schedule mutation may respond while notifications finish under waitUntil', async () => {
  const tasks = [];
  let finish;
  const notification = new Promise((resolve) => { finish = resolve; });
  let notificationFinished = false;
  notification.then(() => { notificationFinished = true; });
  const result = await withRequestBackground({ waitUntil(promise) { tasks.push(promise); } }, async () => {
    assert.equal(deferRequestBackground(notification), true);
    return { changed: true };
  });
  assert.equal(result.changed, true);
  assert.equal(notificationFinished, false);
  assert.equal(tasks.length, 1);
  finish();
  await tasks[0];
  assert.equal(notificationFinished, true);
  assert.equal(deferRequestBackground(Promise.resolve()), false);
});
