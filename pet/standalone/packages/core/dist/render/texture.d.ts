/**
 * Live2D 清单里的纹理定位。
 *
 * 【保留 · 前期不实现 · 依赖 E4/E8】
 * 纯解析逻辑本身在运行，也有回归测试；但「用真实 Cubism 4 模型跑通端到端加载」
 * 从未发生过（裁定见 13.27）。E4/E8 到位前，这里只保证字段路径正确，
 * 不代表 Live2D 渲染路径可用。
 *
 * 两种清单格式都要读：Cubism 4 的 `FileReferences.Textures`，旧自检用的扁平 `textures`。
 * 路径只取文件名并统一大小写 —— Windows 清单里常见反斜杠分隔。
 *
 * 放在 core 而不是 renderer.mjs：这是纯函数，不该和 window/canvas 绑在一起，
 * 否则只能靠真机手测，C1 这类回归会一直缺测试。
 */
export interface TextureManifestSource {
    text(): Promise<string>;
}
export interface NamedFile {
    name: string;
}
export declare function findFirstTexture<T extends NamedFile>(modelFile: TextureManifestSource, files: readonly T[]): Promise<T | null>;
