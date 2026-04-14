import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "鱼桌 · AI游戏平台 — AI德州扑克 · AI智能对话 · 角色扮演",
  description:
    "鱼桌是一款 AI 驱动的游戏平台，提供 AI 德州扑克对战、AI Agent 智能对话（支持网页搜索、图片生成、视频生成）、以及沉浸式角色扮演体验。",
  keywords: [
    "AI德州扑克",
    "AI对战",
    "德州扑克H5",
    "AI游戏",
    "AI聊天",
    "AI Agent",
    "角色扮演AI",
    "德州扑克在线",
    "AI助手",
    "人工智能游戏",
  ],
  openGraph: {
    title: "鱼桌 · AI游戏平台",
    description: "与 AI 对战德州扑克、调用 Agent 工具、体验角色扮演——全部在一个平台。",
    type: "website",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "鱼桌 · AI游戏平台",
    description: "与 AI 对战德州扑克、调用 Agent 工具、体验角色扮演——全部在一个平台。",
  },
};

const features = [
  {
    icon: "♠️",
    title: "AI 德州扑克",
    desc: "与拥有不同性格和策略的 AI 玩家同桌对战，支持多种难度，随时随地开局。",
    cta: "立即开局",
    href: "/game",
    accent: "from-blue-600 to-blue-800",
    border: "border-blue-700/40",
  },
  {
    icon: "🤖",
    title: "AI Agent 对话",
    desc: "一句话触发工具调用——网页实时搜索、AI 图片/视频生成、Python 代码执行，全流式响应。",
    cta: "开始对话",
    href: "/agent",
    accent: "from-purple-600 to-purple-800",
    border: "border-purple-700/40",
  },
  {
    icon: "🎭",
    title: "角色扮演",
    desc: "选择或自定义 AI 角色，进行沉浸式多角色对话，每个角色都有独特的风格与人格。",
    cta: "选择角色",
    href: "/characters",
    accent: "from-emerald-600 to-emerald-800",
    border: "border-emerald-700/40",
  },
];

const faqs = [
  {
    q: "AI 德州扑克的 AI 强度如何？",
    a: "平台内置多个难度 AI，从新手到硬核策略型均有，每个 AI 角色拥有独立的出牌风格和台词。",
  },
  {
    q: "Agent 对话支持哪些工具？",
    a: "目前支持网页实时搜索（Tavily）、AI 图片生成、AI 视频生成（MiniMax）和 Python 代码执行，后续持续扩展。",
  },
  {
    q: "是否需要注册账号？",
    a: "无需注册即可体验德州扑克和 Agent 对话。登录后可解锁角色扮演、积分和历史记录等功能。",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://www.synthracloud.com/#website",
      name: "鱼桌",
      url: "https://www.synthracloud.com/",
      description: "AI 驱动的游戏平台：AI 德州扑克对战、AI Agent 工具调用、角色扮演",
      inLanguage: "zh-CN",
    },
    {
      "@type": "WebApplication",
      "@id": "https://www.synthracloud.com/game#app",
      name: "AI 德州扑克",
      url: "https://www.synthracloud.com/game",
      applicationCategory: "GameApplication",
      operatingSystem: "Web",
      description: "与拥有不同性格和策略的 AI 玩家同桌对战的德州扑克游戏，支持多种难度。",
      inLanguage: "zh-CN",
      isPartOf: { "@id": "https://www.synthracloud.com/#website" },
    },
    {
      "@type": "WebApplication",
      "@id": "https://www.synthracloud.com/agent#app",
      name: "AI Agent 对话",
      url: "https://www.synthracloud.com/agent",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      description: "AI Agent 智能对话，支持网页搜索、图片生成、视频生成和代码执行。",
      inLanguage: "zh-CN",
      isPartOf: { "@id": "https://www.synthracloud.com/#website" },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-bold text-lg tracking-tight">🐟 鱼桌</span>
        <div className="flex gap-4 text-sm text-gray-400">
          <Link href="/game" className="hover:text-white transition-colors">德州扑克</Link>
          <Link href="/agent" className="hover:text-white transition-colors">Agent</Link>
          <Link href="/characters" className="hover:text-white transition-colors">角色扮演</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-block mb-4 px-3 py-1 rounded-full bg-blue-900/40 border border-blue-700/40 text-blue-300 text-xs font-medium">
          AI 游戏平台
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 bg-gradient-to-br from-white to-gray-400 bg-clip-text text-transparent">
          与 AI 同桌，随时开局
        </h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
          德州扑克 AI 对战、Agent 智能工具调用、沉浸式角色扮演——三种体验，一个平台。
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/game"
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-sm transition-colors"
          >
            ♠️ 开始德州扑克
          </Link>
          <Link
            href="/agent"
            className="px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 font-semibold text-sm transition-colors border border-gray-700"
          >
            🤖 试试 AI Agent
          </Link>
        </div>
      </section>

      {/* Feature cards */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="grid sm:grid-cols-3 gap-5">
          {features.map((f) => (
            <div
              key={f.href}
              className={`rounded-2xl border ${f.border} bg-gray-900/60 p-6 flex flex-col gap-4`}
            >
              <span className="text-3xl">{f.icon}</span>
              <div>
                <h2 className="font-bold text-base mb-1">{f.title}</h2>
                <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
              <Link
                href={f.href}
                className={`mt-auto inline-block text-center px-4 py-2 rounded-lg bg-gradient-to-r ${f.accent} text-sm font-medium hover:opacity-90 transition-opacity`}
              >
                {f.cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ (SEO content) */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
        <h2 className="text-xl font-bold mb-6 text-center text-gray-300">常见问题</h2>
        <div className="space-y-4">
          {faqs.map((item) => (
            <div key={item.q} className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4">
              <h3 className="font-semibold text-sm mb-1">{item.q}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8 text-center text-xs text-gray-600">
        <p>© 2024 鱼桌 · AI 游戏平台 · 关键词：AI德州扑克 / AI对战 / AI Agent / 角色扮演</p>
      </footer>
    </div>
  );
}
