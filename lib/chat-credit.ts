/** 登录用户每次调用 /api/chat 消耗的 credit（与 DB RPC 默认一致） */
export const CHAT_CREDIT_COST = 10;
/** 每个自然日（Asia/Shanghai）刷新到的 credit 上限 */
export const DAILY_CREDIT_CAP = 200;
