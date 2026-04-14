"use client";

import type { UserMessage, AssistantMessage } from "@/lib/agent/types";

export function UserBubble({ msg }: { msg: UserMessage }) {
  return (
    <div className="flex justify-end px-4 my-2">
      <div className="max-w-xl rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap break-words">
        {msg.content}
      </div>
    </div>
  );
}

export function AssistantBubble({
  msg,
  streaming,
}: {
  msg: AssistantMessage;
  streaming?: boolean;
}) {
  return (
    <div className="flex justify-start px-4 my-2">
      <div className="max-w-xl rounded-2xl rounded-tl-sm bg-gray-700 px-4 py-2.5 text-sm text-gray-100 whitespace-pre-wrap break-words">
        {msg.content}
        {streaming && (
          <span className="inline-block w-1.5 h-4 bg-gray-300 ml-0.5 align-middle animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
