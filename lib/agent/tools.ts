// lib/agent/tools.ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const agentTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for up-to-date information. Use for current events, facts, or anything requiring real-time data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image from a text description. Returns a URL.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed image description in English" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_video",
      description:
        "Generate a short video from a text description. Returns a URL. Takes longer than image generation.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed video description in English" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_code",
      description:
        "Execute Python code and return stdout/stderr. Use for calculations, data processing, or code examples.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Python code to execute" },
          language: {
            type: "string",
            enum: ["python"],
            description: "Programming language (only python supported)",
          },
        },
        required: ["code", "language"],
      },
    },
  },
];
