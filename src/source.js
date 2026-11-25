import { RendererInputError } from '#core/errors';
import { CoverSchema, InstantSchema, LinksSchema, TextSchema, UriSchema } from '#core/schemas';

export function parse(schema, value, message) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RendererInputError(message, { details: { issues: result.error.issues } });
  }

  return result.data;
}

function parseDate(post, key) {
  if (post[key] !== undefined) {
    parse(InstantSchema, post[key], `invalid post ${key}`);
  }
}

export function inputPosts(input) {
  const posts = input?.posts;

  if (
    !posts ||
    (typeof posts[Symbol.asyncIterator] !== 'function' &&
      typeof posts[Symbol.iterator] !== 'function')
  ) {
    throw new RendererInputError('input.posts must be iterable or async iterable');
  }

  return posts;
}

export function clone(post) {
  if (!post || typeof post !== 'object') {
    return post;
  }

  const data = Object.fromEntries(
    Object.entries(post).map(([key, value]) => [
      key,
      value instanceof Temporal.Instant ? value.toString() : value
    ])
  );

  return structuredClone(data);
}

export function validateSource(post) {
  if (!post || typeof post.title !== 'string') {
    throw new RendererInputError('input must be PostData', {
      details: { receivedType: post === null ? 'null' : typeof post }
    });
  }

  parse(UriSchema, post.uri, 'invalid post URI');
  parseDate(post, 'publishedAt');

  return post;
}

export function snapshotSource(post) {
  validateSource(post);
  parseDate(post, 'createdAt');
  parseDate(post, 'updatedAt');

  if (post.text !== undefined) {
    parse(TextSchema, post.text, 'invalid post text');
  }

  if (post.links !== undefined) {
    parse(LinksSchema, post.links, 'invalid post links');
  }

  const cover = parse(CoverSchema, post.cover === undefined ? {} : post.cover, 'invalid cover');
  const { text, ...metadata } = post;

  return { ...clone(metadata), text, cover };
}
