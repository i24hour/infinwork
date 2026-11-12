import assert from 'node:assert/strict';
import { compileStepPlan } from './compile.ts';

const procedure = compileStepPlan(`1. Open the settings page
2. Create a widget key
3. Paste it into the Android widget`);
assert.equal(procedure.kind, 'procedure');
assert.equal(procedure.target, 'Open the settings page → Paste it into the Android widget');
assert.deepEqual(procedure.steps.slice(0, 3), [
    'Open the settings page',
    'Create a widget key',
    'Paste it into the Android widget',
]);

const spoken = compileStepPlan('First write the brief. Then design the screen. Finally ship it.');
assert.equal(spoken.kind, 'procedure');
assert.equal(spoken.target, 'Write the brief → Ship it');
assert.deepEqual(spoken.steps, [
    'Write the brief',
    'Design the screen',
    'Ship it',
]);

const headed = compileStepPlan(`Widget setup
- Create the key
- Paste the key on the phone`);
assert.equal(headed.target, 'Widget setup');
assert.equal(headed.kind, 'procedure');
assert.equal(headed.steps[0], 'Create the key');
assert.equal(headed.steps[1], 'Paste the key on the phone');

const goal = compileStepPlan('Launch a weekly newsletter for infinWORK');
assert.equal(goal.kind, 'work');
assert.equal(goal.target, 'Launch a weekly newsletter for infinWORK');
assert.ok(goal.steps[0].includes('Launch a weekly newsletter for infinWORK'));
assert.equal(goal.steps[goal.steps.length - 1], 'Mark the target complete.');
assert.ok(goal.steps.some((step) => step.startsWith('Draft the whole thing')));

const leadIn = compileStepPlan('I am going to redesign the settings page, then test it on my phone, and then ship it');
assert.equal(leadIn.kind, 'procedure');
assert.equal(leadIn.steps[0], 'Redesign the settings page');
assert.equal(leadIn.steps[1], 'Test it on my phone');
assert.equal(leadIn.steps[2], 'Ship it');

assert.throws(() => compileStepPlan('  '), /Tell the procedure/);

console.log('step plan checks passed');
