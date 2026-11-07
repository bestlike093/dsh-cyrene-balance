import type { ModelAdapter } from './adapterRegistry.js';
import type { ImageLike } from './imageAdapter.js';
export interface SpriteAdapterOptions {
    readonly createImage?: () => ImageLike;
    readonly defaultAction?: string;
}
export declare function createSpriteAdapter(options?: SpriteAdapterOptions): ModelAdapter;
