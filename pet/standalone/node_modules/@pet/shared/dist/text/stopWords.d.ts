/**
 * 共享停用词：社交语感（梗识别）与记忆召回（bigram 相关度）共用一份标准。
 *
 * MEME_STOP_WORDS 是「整词」层面的停用词，用于判断一个短语是不是常见口头语；
 * STOP_BIGRAMS 由它按二字切分而来，并补了一小组高频虚词组合，
 * 供 bigram 召回直接过滤，避免「今天」「我们」「这个」这类组合把分数抬起来。
 */
export declare const MEME_STOP_WORDS: ReadonlySet<string>;
export declare const STOP_BIGRAMS: ReadonlySet<string>;
