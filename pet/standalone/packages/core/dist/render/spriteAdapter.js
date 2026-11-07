/**
 * 帧序列适配器（B2-5 接线）。
 *
 * 把已经解析好的 `SpriteSheet` 交给 `SpriteModel`。
 * 描述从 `AdapterContext.spriteSheet` 进来，适配器本身无状态 ——
 * 注册一次即可，换素材时只换 create 的入参，不必重新注册。
 *
 * ⛔ 不要退化成「把整张 sheet 当图片平铺」：那会让 H1 看起来像播放驱动坏了。
 */
import { ErrorCode, PetError } from '@pet/shared';
import { SpriteModel } from './spriteModel.js';
export function createSpriteAdapter(options = {}) {
    return {
        kind: 'sprite',
        create(context) {
            const sheet = context.spriteSheet;
            if (sheet === undefined) {
                throw new PetError(ErrorCode.INVALID_ARGUMENT, 'sprite 适配器缺少 spriteSheet 描述');
            }
            return new SpriteModel({ id: context.id, profile: context.profile, dpr: context.dpr }, { sheet, createImage: options.createImage, defaultAction: options.defaultAction });
        }
    };
}
