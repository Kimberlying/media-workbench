import type { MetricSnapshot } from "@/lib/db/types";

// metrics 是每日快照（累计值），复盘取每条帖子最新一天的快照。

const ZERO: MetricSnapshot = { views: 0, likes: 0, comments: 0, shares: 0, follows: 0 };

export function latestByPost<T extends { metrics: (MetricSnapshot & { date: string })[] }>(
  rows: T[],
): (T & { latest: MetricSnapshot })[] {
  return rows.map((row) => {
    const latest = [...row.metrics].sort((a, b) => b.date.localeCompare(a.date))[0];
    return { ...row, latest: latest ?? ZERO };
  });
}

export function summarize(snapshots: MetricSnapshot[]): MetricSnapshot {
  return snapshots.reduce(
    (acc, m) => ({
      views: acc.views + m.views,
      likes: acc.likes + m.likes,
      comments: acc.comments + m.comments,
      shares: acc.shares + m.shares,
      follows: acc.follows + m.follows,
    }),
    ZERO,
  );
}
