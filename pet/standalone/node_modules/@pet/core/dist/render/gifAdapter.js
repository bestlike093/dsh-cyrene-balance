import { createImageAdapter } from './imageAdapter.js';
/** GIF 沿用 img 元素的原生动画能力，不需要额外的解码器。 */
export function createGifAdapter(options = {}) {
    return createImageAdapter({ ...options, kind: 'gif' });
}
