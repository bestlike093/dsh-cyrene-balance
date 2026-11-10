/**
 * 字段注册示例
 *
 * ⚠️ 本文件是「骨架可供 E2 复用」的示范（V2.2 16.4.5），
 *    交付时必须显式标注这一句，否则 E2 开工时会重搭一套设置界面。
 *
 * 示范三类：
 *   1. 表现层字段（主题 / 字体 / 风格）—— 校验器**从 core 导入，不在 ui 重写**
 *   2. 只读降级态 —— 能力不可用时的展示
 *   3. 凭据槽位（kind: 'key'）—— E2 将注册，骨架只给槽位，不实现凭据逻辑
 */
import { SettingsRegistryV1 } from './registry.js';
export declare function createRegistry(): SettingsRegistryV1;
