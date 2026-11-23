import assert from 'node:assert/strict';
import test from 'node:test';

import { RendererInputError } from 'yamb/errors';

import { feed, json } from '../src/index.js';
import { blogWith } from './fixture.js';

for (const base of [
  'https://example.com/',
  'https://example.com/blog',
  'https://example.com/blog/',
  'https://example.com/blog?view=1#section'
]) {
  for (const related of ['summary', 'full']) {
    test(`JSON, Feed, related ${related} and Post.url agree at ${base}`, async (t) => {
      const blog = await blogWith([], {
        base,
        renderers: {
          json: json({ related }),
          feed: feed({ title: 'Feed', feed: 'https://example.com/feed?view=1' })
        }
      });
      t.after(() => blog.close());

      const second = blog.build({ title: 'Second', slug: 'second' });
      await second.publish();
      const post = blog.build({
        title: 'Post',
        slug: 'post',
        text: 'Body',
        links: { related: [second.id] }
      });
      await post.publish();

      const prefix = `https://example.com${new URL(base).pathname === '/' ? '' : '/blog'}`;
      assert.equal(post.url().href, `${prefix}/2026/11/post`);

      const view = await post.render('json');
      assert.equal(view.url, `${prefix}/2026/11/post`);
      assert.equal(view.related[0].url, `${prefix}/2026/11/second`);

      const summary = await blog.render('json', { posts: [post] });
      assert.equal(summary.posts[0].url, view.url);

      const out = await blog.render('feed', { posts: [post] });
      assert.equal(out.items[0].url, view.url);
      assert.equal(out.home_page_url, base);
      assert.equal(out.feed_url, 'https://example.com/feed?view=1');
    });
  }
}

for (const api of ['direct', 'blog']) {
  for (const scope of ['post', 'summary', 'full']) {
    test(`${api} ordinary ${scope} rejects invalid source URI before lookup`, async (t) => {
      const renderer = json();
      const blog = await blogWith([], { renderers: { json: renderer } });
      t.after(() => blog.close());
      blog.storage.find = () => assert.fail('invalid URI reached related lookup');
      const ctx = { yamb: blog, base: new URL('https://example.test/blog'), timeZone: 'UTC' };

      for (const uri of [
        'javascript:alert(1)',
        'https://evil.test/post',
        '../outside',
        '',
        null,
        undefined
      ]) {
        const source = { uri, title: 'Invalid', links: { related: ['target'] } };
        const input = scope === 'post' ? { post: source } : { posts: [source], view: scope };
        const direct =
          scope === 'post'
            ? () => renderer.post(source, ctx)
            : () => renderer.collection(input, ctx);

        await assert.rejects(
          () => (api === 'blog' ? blog.render('json', input) : direct()),
          (error) => error instanceof RendererInputError && error.code === 'YAMB_RENDERER_INPUT'
        );
      }
    });

    test(`${api} ordinary ${scope} keeps canonical publication and draft URLs`, async (t) => {
      const renderer = json();
      const blog = await blogWith([], {
        base: 'https://example.test/blog',
        renderers: { json: renderer }
      });
      t.after(() => blog.close());
      const ctx = { yamb: blog, base: new URL('https://example.test/blog'), timeZone: 'UTC' };

      for (const uri of ['2026/11/source', 'drafts/source']) {
        const source = { uri, title: 'Canonical' };
        const input = scope === 'post' ? { post: source } : { posts: [source], view: scope };
        const direct =
          scope === 'post'
            ? () => renderer.post(source, ctx)
            : () => renderer.collection(input, ctx);
        const result = await (api === 'blog' ? blog.render('json', input) : direct());
        const view = scope === 'post' ? result : result.posts[0];

        assert.equal(view.uri, uri);
        assert.equal(view.url, `https://example.test/blog/${uri}`);
      }
    });
  }
}
