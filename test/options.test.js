import assert from 'node:assert/strict';
import test from 'node:test';

import { blogWith } from './fixture.js';

test('JSON export owns empty options independently', async (t) => {
  const blog = await blogWith();
  t.after(() => blog.close());

  const post = await blog.create({ title: 'Options' });
  const { json } = await import('@meritt/yamb-render-json');
  const result = await json().collection(
    { posts: [post.toJSON()], view: 'full' },
    {
      yamb: blog,
      timeZone: 'UTC',
      base: new URL('https://example.com/')
    }
  );

  assert.deepEqual(result.posts[0].options, {});

  result.posts[0].options.homepage = true;
  assert.deepEqual(post.options, {});
});
