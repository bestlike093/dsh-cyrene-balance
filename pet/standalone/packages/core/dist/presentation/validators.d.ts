/**
 * 表现层白名单校验器（S7-d）。
 *
 * 纯函数：同步、不读文件、不做 IO —— 这是它能边输入边调用的前提。
 * 字体魔数校验不在这里，它在 `register()` 的异步路径里（要读文件头）。
 *
 * 每个函数都收集完全部错误再返回，不在第一条错误处短路。
 */
import type { FieldErrorV1, FontSourceV1, StyleTokensV1, ThemeTokensV1, ValidationResultV1 } from '@pet/shared';
export declare function validateColor(field: string, value: string): FieldErrorV1[];
export declare function validateFontFamily(field: string, value: string): FieldErrorV1[];
export declare function validateFontWeight(field: string, value: number): FieldErrorV1[];
export declare function validateCssValue(field: string, value: string): FieldErrorV1[];
export declare function validateAssetRef(field: string, value: string): FieldErrorV1[];
export declare function validateThemeTokens(value: ThemeTokensV1): ValidationResultV1;
export declare function validateStyleTokens(value: StyleTokensV1): ValidationResultV1;
export declare function validateFontSource(value: FontSourceV1): ValidationResultV1;
