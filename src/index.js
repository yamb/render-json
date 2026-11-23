import { FeedRenderer } from './feed/index.js';
import { JsonRenderer } from './renderer/index.js';

export function json(config = {}) {
  return new JsonRenderer(config);
}

export function feed(config) {
  return new FeedRenderer(config);
}

export { FeedRenderer, JsonRenderer };
