import assert from 'node:assert/strict';
import { createWidgetToken, hashWidgetToken, isWidgetToken } from './widget-token.ts';
import { buildWidgetSnapshot, elapsedStateAt, focusTodaySeconds, istDayStart } from './widget-snapshot.ts';

const issued = createWidgetToken();
assert.equal(isWidgetToken(issued.token), true);
assert.equal(isWidgetToken('inw_not-a-key'), false);
assert.equal(isWidgetToken(''), false);
assert.equal(hashWidgetToken(issued.token), issued.hash);
assert.equal(issued.hash.length, 64);
assert.equal(issued.prefix, `${issued.token.slice(0, 8)}…`);

const now = Date.UTC(2026, 10, 11, 8, 0, 0);
const todayStart = istDayStart(now);

const running = elapsedStateAt({
    title: 'Ship the widget',
    enabled: true,
    completed: false,
    pausedElapsed: 0,
    events: [
        { type: 'start', timestamp: now - 90 * 60 * 1000 },
        { type: 'pause', timestamp: now - 60 * 60 * 1000 },
        { type: 'start', timestamp: now - 10 * 60 * 1000 },
    ],
}, now);
assert.equal(running.running, true);
assert.equal(running.elapsedSeconds, 40 * 60);
assert.equal(running.segmentStartedAt, now - 10 * 60 * 1000);

const paused = elapsedStateAt({
    title: 'Paused',
    enabled: false,
    events: [
        { type: 'start', timestamp: now - 30 * 60 * 1000 },
        { type: 'pause', timestamp: now - 10 * 60 * 1000 },
    ],
}, now);
assert.equal(paused.running, false);
assert.equal(paused.elapsedSeconds, 20 * 60);

const focus = focusTodaySeconds([
    {
        enabled: true,
        events: [{ type: 'start', timestamp: todayStart - 30 * 60 * 1000 }],
    },
], now);
assert.equal(focus, Math.floor((now - todayStart) / 1000));

const snapshot = buildWidgetSnapshot({
    username: 'priyanshu',
    now,
    points: 10,
    tasks: [
        {
            title: 'Ship the widget',
            enabled: true,
            completed: false,
            events: [{ type: 'start', timestamp: now - 5 * 60 * 1000 }],
        },
        {
            title: 'Done',
            enabled: false,
            completed: true,
            completedAt: now - 60 * 1000,
            events: [
                { type: 'start', timestamp: now - 20 * 60 * 1000 },
                { type: 'complete', timestamp: now - 60 * 1000 },
            ],
        },
    ],
});
assert.equal(snapshot.username, 'priyanshu');
assert.equal(snapshot.runningCount, 1);
assert.equal(snapshot.running[0].title, 'Ship the widget');
assert.equal(snapshot.running[0].elapsedSeconds, 5 * 60);
assert.equal(snapshot.updatedAtMs, now);
assert.equal(typeof snapshot.score, 'number');

console.log('widget snapshot checks passed');
