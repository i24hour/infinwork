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

import { decodeSnowflakeTimestamp, parsePostsFromFirecrawl } from './scrape.ts';

const decodedDate = decodeSnowflakeTimestamp('2110466250191290408');
assert.ok(decodedDate instanceof Date && !Number.isNaN(decodedDate.getTime()), 'expected valid Snowflake Date');

const sampleJinaMarkdown = `
# Dr. S. Jaishankar
@DrSJaishankar
Posts Posts
*   [![Image 3: @DrSJaishankar](https://pbs.twimg.com/profile_images/123/avatar.jpg)](https://x.com/DrSJaishankar)  [Dr. S. Jaishankar](https://x.com/DrSJaishankar) [@DrSJaishankar](https://x.com/DrSJaishankar) [5m](https://x.com/DrSJaishankar/status/2110466250191290408)   A warm and productive meeting with DPM & FM [@ABZayed](https://x.com/ABZayed) of UAE. Exchanged perspectives on bilateral and global issues in the spirit of our Comprehensive Strategic Partnership.  ![Image 4](https://pbs.twimg.com/media/abc.jpg) [](https://x.com/DrSJaishankar/status/2110466250191290408/photo/1)  [2](https://x.com/compose/post?in_reply_to=2110466250191290408) 6 16 5.7K
*   [![Image 4: @AshwiniVaishnaw](https://pbs.twimg.com/profile_images/123/avatar2.jpg)](https://x.com/DrSJaishnaw) Strengthening Tamil Nadu’s rail connectivity with new Vande Bharat routes! [Video 12](blob:https://x.com/1a975ffa-374a-4df1-b64e-0a29929f2e61)00:00 / 00:43
`;

const parsedJina = parsePostsFromFirecrawl('DrSJaishankar', sampleJinaMarkdown);
assert.equal(parsedJina.length, 1);
assert.equal(parsedJina[0].externalId, 'x:drsjaishankar:2110466250191290408');
assert.match(parsedJina[0].text, /Comprehensive Strategic Partnership/);
assert.doesNotMatch(parsedJina[0].text, /5\.7K/);
assert.ok(parsedJina[0].postedAt instanceof Date);

console.log('rank-politician keyword + Jina parser checks passed');
