import assert from 'node:assert/strict';
import { allTasksAreHidden } from './task-visibility.ts';

assert.equal(allTasksAreHidden([], false), false);
assert.equal(allTasksAreHidden([], true), true);
assert.equal(allTasksAreHidden([{ isPublic: true }, { isPublic: false }], false), false);
assert.equal(allTasksAreHidden([{ isPublic: undefined }, { isPublic: false }], false), false);
assert.equal(allTasksAreHidden([{ isPublic: false }, { isPublic: false }], false), true);

console.log('task visibility checks passed');
