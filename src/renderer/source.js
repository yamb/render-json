import { RendererInputError } from '#core/errors';
import { TextSchema, UriSchema } from '#core/schemas';

export function validateSource(post) {
  if (!post || typeof post.title !== 'string') {
    throw new RendererInputError('input must be PostData', {
      details: { receivedType: post === null ? 'null' : typeof post }
    });
  }

  const uri = UriSchema.safeParse(post.uri);

  if (!uri.success) {
    throw new RendererInputError('invalid post URI', { details: { issues: uri.error.issues } });
  }
}

export function snapshotSource(post) {
  validateSource(post);
  const { text, ...metadata } = post;

  if (text !== undefined) {
    const result = TextSchema.safeParse(text);

    if (!result.success) {
      throw new RendererInputError('invalid post text', {
        details: { issues: result.error.issues }
      });
    }
  }

  return { ...structuredClone(metadata), text };
}
