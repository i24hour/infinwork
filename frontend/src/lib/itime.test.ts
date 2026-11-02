import assert from 'node:assert/strict';
import { sanitizeItimeTaskInput } from './validate.ts';
import { computeBaseScore, getScoreAtTime } from './score.ts';

const now = Date.now();

// Regression: GET /api/itime returns `userId`; older clients echo it back on
// every PUT. It must be ignored, not rejected, or pause/resume never persists.
const payload = {
    userId: 'a@example.com',
    createdAt: new Date().toISOString(),
    title: 'Task',
    description: '',
    startTime: now - 60_000,
    pausedElapsed: 60,
    enabled: false,
    completed: false,
    isPublic: true,
    autoResumeAt: now + 30 * 60_000,
    events: [
        { type: 'start', timestamp: now - 60_000 },
        { type: 'pause', timestamp: now },
    ],
    milestones: [
        {
            id: 'm1',
            text: 'first',
            completed: true,
            completedAt: now - 1000,
            createdAt: now - 60_000,
            createdAtElapsed: 10,
        },
    ],
};

const result = sanitizeItimeTaskInput(payload, { requireTitle: false });
assert.equal(result.ok, true, 'payload with userId must be accepted');
if (result.ok) {
    assert.equal('userId' in result.value, false, 'userId must be dropped');
    assert.equal(result.value.autoResumeAt, payload.autoResumeAt, 'future break must be preserved');
    assert.deepEqual(result.value.milestones?.[0], {
        id: 'm1',
        text: 'first',
        completed: true,
        completedAt: now - 1000,
        createdAt: now - 60_000,
        createdAtElapsed: 10,
    });
}

const cleared = sanitizeItimeTaskInput({ autoResumeAt: null }, { requireTitle: false });
assert.equal(cleared.ok, true);
if (cleared.ok) {
    assert.equal(cleared.value.autoResumeAt, null, 'null must clear a scheduled break');
}

// Runtime-cancelled tasks are a safety stop, not a failed task.
const cancelled = [{
    startTime: now - 100 * 3600_000,
    pausedElapsed: 100 * 3600,
    enabled: false,
    completed: false,
    cancelledAt: now,
    events: [
        { type: 'start' as const, timestamp: now - 100 * 3600_000 },
        { type: 'pause' as const, timestamp: now },
    ],
}];
assert.equal(computeBaseScore(cancelled, now), 0, 'cancelled tasks must not create a base score');
assert.equal(getScoreAtTime(cancelled, now), 0, 'a fully active cancelled task has no idle penalty');

console.log('iTime validator + score checks passed');
