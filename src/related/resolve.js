export async function resolveRelated(source, ctx) {
  const resolved = [];

  for (const id of source.links?.related ?? []) {
    ctx.signal?.throwIfAborted();
    const post = await ctx.yamb.find(id, { signal: ctx.signal });
    ctx.signal?.throwIfAborted();

    if (post?.status === 'published') {
      resolved.push(post.toJSON());
    }
  }

  return resolved;
}
