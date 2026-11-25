# yamb-render-json

[![npm version][npm-image]][npm-url] [![Build status][github-actions-image]][github-actions-url] [![Coverage status][coveralls-image]][coveralls-url] [![Dependency status][libraries-image]][libraries-url]

Export [Yamb](https://github.com/yamb/yamb) posts and collections as source JSON views or JSON Feed 1.1 objects.

For GitHub Packages, route the `@yamb` scope to `https://npm.pkg.github.com` and install `@yamb/render-json`.

## Quick start

Requires Node.js 26.13 or later and `yamb` 1.1.0 or later. Direct rendering needs no storage.

```bash
pnpm add yamb yamb-render-json
```

```js
import { feed, json } from 'yamb-render-json';

const source = {
  id: 'hello',
  uri: '2026/11/hello',
  title: 'Hello',
  text: '**Hello**, world.',
  status: 'published',
  publishedAt: '2026-11-12T09:00:00Z',
  updatedAt: '2026-11-12T09:00:00Z'
};

const ctx = {
  base: new URL('https://example.com/blog'),
  timeZone: 'UTC'
};

const renderer = json();

const post = await renderer.post(source, ctx);
const collection = await renderer.collection(
  {
    posts: [source],
    view: 'full'
  },
  ctx
);

console.log(
  JSON.stringify({
    post,
    collection
  })
);

const news = feed({
  title: 'My blog',
  feed: 'https://example.com/blog/feed.json'
});

const result = await news.collection(
  {
    posts: [source]
  },
  ctx
);

console.log(JSON.stringify(result));
```

## Reference

- [Source views and related-post settings](api/readme.md#source-json)
- [JSON Feed configuration and content](api/readme.md#json-feed-11)
- [Yamb core reference](https://github.com/yamb/yamb#reference) for renderer registration and context

## Author

[Alexey Simonenko](https://simonenko.xyz)

## License

MIT. See `LICENSE`.

[npm-image]: https://img.shields.io/npm/v/yamb-render-json?style=flat
[npm-url]: https://www.npmjs.com/package/yamb-render-json
[github-actions-image]: https://github.com/yamb/render-json/actions/workflows/ci.yml/badge.svg
[github-actions-url]: https://github.com/yamb/render-json/actions/workflows/ci.yml
[coveralls-image]: https://coveralls.io/repos/github/yamb/render-json/badge.svg
[coveralls-url]: https://coveralls.io/github/yamb/render-json
[libraries-image]: https://img.shields.io/librariesio/release/npm/yamb-render-json?style=flat
[libraries-url]: https://libraries.io/npm/yamb-render-json
