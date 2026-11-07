export interface ExportFileFs {
    writeFile: (file: string, data: string, encoding?: string) => Promise<void>;
    restrictPermissions: (file: string) => Promise<void>;
}
/**
 * 导出写盘的统一收口：先写内容，再收紧权限。
 *
 * 写入失败时不限权：半截文件不会拿到目标权限，调用方也能从 reject 里拿到原始错误。
 * encoding 省略时不传第三参，与 vault:export 老路径的 writeFile(file, data) 参数形态一致。
 */
export declare function writeExportFile(fs: ExportFileFs, file: string, content: string, encoding?: string): Promise<void>;
