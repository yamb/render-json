import assert from 'node:assert/strict';

import pkg from './package.json' with { type: 'json' };

const { feed, json } = await import(pkg.name);

import { blogWith } from './test/fixture.js';

await using blog = await blogWith([], {
  base: 'https://example.test/blog',
  renderers: {
    json: json(),
    feed: feed({ title: 'Example', feed: 'https://example.test/feed.json' })
  }
});

const post = await blog.create({ title: 'Example post', text: '**Body**' });
await post.publish();
const view = await post.render('json');
const rendered = await blog.render('feed', { posts: blog.published });
assert.equal(view.text, '**Body**');
assert.equal(rendered.items[0].id, post.id);
