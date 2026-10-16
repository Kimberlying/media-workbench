import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Inngest 每一步是一次请求；Grok 搜 X、长文生成单步可能要一两分钟，放宽到平台允许的 5 分钟
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
