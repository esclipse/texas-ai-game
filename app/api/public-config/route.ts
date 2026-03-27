import { NextResponse } from "next/server";

import { getLlmConfig, getPublicRoles } from "@/lib/app-config";
import { pickAiActionModelByAi } from "@/lib/llm/fallback";

export async function GET() {
  const { providersForChat, providersForAiAction, routing } = getLlmConfig();
  const chat = providersForChat[0];
  const aiAction = providersForAiAction[0];
  return NextResponse.json({
    public: {
      roles: getPublicRoles(),
    },
    llm: {
      routing,
      active: {
        chat: chat?.id ?? null,
        aiAction: aiAction?.id ?? null,
      },
      models: {
        chat: chat?.models?.chat ?? null,
        default: aiAction?.models?.default ?? null,
        secondary: aiAction?.models?.secondary ?? null,
        perPlayer: aiAction
          ? Object.fromEntries(
              [
                { id: "ai-1", name: "大炮", llmRef: "npc_dapao" },
                { id: "ai-2", name: "小七", llmRef: "npc_xiaoqi" },
                { id: "ai-3", name: "Z哥", llmRef: "npc_zge" },
                { id: "ai-4", name: "幂幂", llmRef: "npc_dongzi" },
                { id: "ai-5", name: "茶茶", llmRef: "npc_chacha" },
              ].map((ai) => [ai.id, pickAiActionModelByAi(aiAction, ai)])
            )
          : {},
      },
    },
  });
}

