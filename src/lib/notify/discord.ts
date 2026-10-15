import type { Digest, DigestPost } from "@/lib/radar/daily";

// Discord 频道 Webhook 推送，格式沿用 kim 原来的 push_notify.py：一张热度前 5 的卡片，再每条推文一张卡片。

const BLURPLE = 0x5865f2;
const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join("")}…` : s);

export function discordMessages(digest: Digest, posts: DigestPost[]) {
  const messages: object[] = [
    {
      content: `**每日 AI 资讯雷达 · ${digest.day}**`,
      embeds: [
        {
          title: "今日热度 TOP 5",
          color: BLURPLE,
          fields: digest.top.map((n, i) => ({
            name: clip(`${i + 1}. ${n.title}`, 256),
            value: clip(`${n.heat ? `热度 ${n.heat} · ` : ""}\`${n.source}\`\n${n.summary}\n[原文](${n.url})`, 1024),
          })),
        },
      ],
    },
  ];
  posts.forEach((p, i) =>
    messages.push({
      embeds: [
        {
          title: clip(`今日推文 ${i + 1}/${posts.length}：${p.news.title}`, 256),
          url: p.news.url,
          color: BLURPLE,
          description: clip(`@${p.handle}\n\`\`\`text\n${p.body}\n\`\`\`\n草稿已在工作台「内容」里`, 4096),
        },
      ],
    }),
  );
  return messages;
}

/** 逐条发送；失败只记日志，不影响当天的资讯和草稿 */
export async function sendDiscord(webhookUrl: string, messages: object[], doFetch: typeof fetch = fetch) {
  let sent = 0;
  for (const message of messages) {
    const res = await doFetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (res.ok) sent++;
    else console.error(`Discord 推送失败 ${res.status}：${await res.text()}`);
  }
  return sent;
}
