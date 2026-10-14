import assert from 'node:assert/strict';
import { classifyPost } from './score.ts';

const vaishnawTopics = ['railway', 'rail', 'it', 'telecom', 'vande bharat'];
const petroleumTopics = ['petroleum', 'oil', 'gas', 'fuel'];
const justiceTopics = ['social justice', 'sc', 'st', 'obc'];

const withPost = classifyPost('Met with the team to discuss the budget with stakeholders today.', vaishnawTopics);
assert.equal(withPost.category, 'related', `expected related, got ${withPost.category}: ${withPost.scoreReason}`);

const trailPost = classifyPost('The trail of this cricket match was the talk of the town today.', vaishnawTopics);
assert.notEqual(trailPost.category, 'on_portfolio', trailPost.scoreReason);

const railPost = classifyPost('Flagged off a new vande bharat train from the station this morning.', vaishnawTopics);
assert.equal(railPost.category, 'on_portfolio', railPost.scoreReason);

const oilPost = classifyPost('Reduced domestic oil and gas prices for household fuel this week.', petroleumTopics);
assert.equal(oilPost.category, 'on_portfolio', oilPost.scoreReason);

const gasolinePost = classifyPost('Watched a movie and shared a viral reel with friends tonight.', petroleumTopics);
assert.notEqual(gasolinePost.category, 'on_portfolio', gasolinePost.scoreReason);

const scPost = classifyPost('We will discuss the last scheme for social justice and obc welfare.', justiceTopics);
assert.equal(scPost.category, 'on_portfolio', scPost.scoreReason);
assert.match(scPost.scoreReason, /social justice|obc/);
assert.doesNotMatch(scPost.scoreReason, /\bsc\b/);

const hindiPost = classifyPost('जलवायु परिवर्तन पर एक सामान्य बैठक हुई आज शाम को।', ['जल']);
assert.notEqual(hindiPost.category, 'on_portfolio', hindiPost.scoreReason);

console.log('rank-politician keyword checks passed');
