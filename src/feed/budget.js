import { Buffer } from 'node:buffer';

import { RendererInputError } from '#core/errors';

export function budget(bytes) {
  let size = 0;

  function check(length) {
    if (length > bytes - size) {
      throw new RendererInputError('feed output exceeds bytes');
    }
  }

  return {
    check,
    add(value, separator = 0) {
      const length = Buffer.byteLength(JSON.stringify(value)) + separator;
      check(length);
      size += length;
    }
  };
}
