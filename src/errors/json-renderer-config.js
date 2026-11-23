import { YambError } from '#core/errors';

export class JsonRendererConfigError extends YambError {
  static code = 'YAMB_JSON_RENDERER_CONFIG';
}
