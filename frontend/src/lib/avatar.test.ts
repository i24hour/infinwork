import assert from 'node:assert/strict';
import { avatarUrlFor, decodeDataImage, isDataImage, resolveAvatar } from './avatar';

const png = 'data:image/png;base64,iVBORw0KGgo=';

assert.equal(isDataImage(png), true);
assert.equal(isDataImage('https://example.com/a.png'), false);
assert.equal(isDataImage(undefined), false);

// Stored data URLs become a small cacheable URL; the version tracks the content.
assert.equal(resolveAvatar({ _id: 'abc', image: png }), avatarUrlFor('abc', png.length));
assert.equal(resolveAvatar({ _id: 'abc', image: png + 'AAAA' }), avatarUrlFor('abc', png.length + 4));

// Remote avatars and missing images pass through.
assert.equal(resolveAvatar({ _id: 'abc', image: 'https://lh3.googleusercontent.com/x' }), 'https://lh3.googleusercontent.com/x');
assert.equal(resolveAvatar({ _id: 'abc' }), null);
assert.equal(resolveAvatar({ _id: 'abc', image: '' }), null);

// Documents projected inside MongoDB carry flags instead of the image.
assert.equal(resolveAvatar({ _id: 'abc', image: null as never, __avatarData: true, __avatarVersion: 42 }), '/api/avatar/abc?v=42');

// The avatar route only serves real image data URLs.
const decoded = decodeDataImage(png);
assert.equal(decoded?.mime, 'image/png');
assert.equal(decoded?.bytes.length, 8);
assert.equal(decodeDataImage('data:image/svg+xml;base64,PHN2Zz4='), null);
assert.equal(decodeDataImage('data:text/html;base64,PGI+'), null);
assert.equal(decodeDataImage('nope'), null);
assert.equal(decodeDataImage('data:image/jpg;base64,AAAA')?.mime, 'image/jpeg');

console.log('avatar tests passed');
