// Buffer 的 GraphQL 接口（https://api.buffer.com，个人 API key，Bearer 鉴权）。
// 动作沿用 tweet-buffer-workflow：存草稿 / 进入队列 / 队列置顶 / 现在发送。
// https://developers.buffer.com/guides/posts-and-scheduling.html

export type BufferAction = "draft" | "queue" | "top" | "now";

export const BUFFER_ACTIONS: Record<BufferAction, string> = {
  draft: "存草稿",
  queue: "进入队列",
  top: "队列置顶",
  now: "现在发送",
};

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
}

/** Buffer 明确拒绝了这次请求，确定什么都没建出来，可以改了再发 */
export class BufferRejected extends Error {}

const ENDPOINT = "https://api.buffer.com";

// 存草稿也要带 mode；队列置顶 = shareNext，现在发送 = shareNow
const MODE: Record<BufferAction, string> = {
  draft: "addToQueue",
  queue: "addToQueue",
  top: "shareNext",
  now: "shareNow",
};

/** 队列满了的报错：进入队列时改存草稿，不丢内容（tweet-buffer-workflow 的规则） */
const QUEUE_FULL = /limit|full|capacity|上限|已满/i;

export class BufferClient {
  constructor(
    private readonly apiKey: string,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  private async request<T>(query: string): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query }),
      });
    } catch (err) {
      // 网络中断：请求可能已经到了 Buffer，结果不确定
      throw new Error(`连不上 Buffer：${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 401 || res.status === 403) throw new BufferRejected(`Buffer 拒绝了 API key（${res.status}）`);
    if (!res.ok) throw new Error(`Buffer 返回 ${res.status}：${await res.text()}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    // 查询本身不合法时 Buffer 不会执行它
    if (body.errors?.length && !body.data) throw new BufferRejected(body.errors.map((e) => e.message).join("；"));
    if (!body.data) throw new Error("Buffer 没有返回数据");
    return body.data;
  }

  async channels(): Promise<BufferChannel[]> {
    const { account } = await this.request<{ account: { organizations: { id: string }[] } }>(
      "query { account { organizations { id } } }",
    );
    const out: BufferChannel[] = [];
    for (const org of account.organizations) {
      const { channels } = await this.request<{ channels: BufferChannel[] }>(
        `query { channels(input: { organizationId: ${JSON.stringify(org.id)} }) { id name service } }`,
      );
      out.push(...channels);
    }
    return out;
  }

  /** 建一条 Buffer 帖子。进入队列碰到队列已满时改存草稿，fellBackToDraft 为 true */
  async createPost(input: {
    channelId: string;
    text: string;
    action: BufferAction;
    imageUrls?: string[];
  }): Promise<{ postId: string; fellBackToDraft: boolean }> {
    try {
      return { postId: await this.create(input, input.action === "draft"), fellBackToDraft: false };
    } catch (err) {
      if (input.action === "queue" && err instanceof BufferRejected && QUEUE_FULL.test(err.message)) {
        return { postId: await this.create(input, true), fellBackToDraft: true };
      }
      throw err;
    }
  }

  private async create(
    input: { channelId: string; text: string; action: BufferAction; imageUrls?: string[] },
    saveToDraft: boolean,
  ): Promise<string> {
    const assets = (input.imageUrls ?? []).map((url) => `{ image: { url: ${JSON.stringify(url)} } }`);
    const fields = [
      `text: ${JSON.stringify(input.text)}`,
      `channelId: ${JSON.stringify(input.channelId)}`,
      "schedulingType: automatic",
      `mode: ${MODE[input.action]}`,
      ...(saveToDraft ? ["saveToDraft: true"] : []),
      ...(assets.length ? [`assets: [${assets.join(", ")}]`] : []),
    ];
    const { createPost } = await this.request<{
      createPost: { post?: { id: string }; message?: string };
    }>(
      `mutation { createPost(input: { ${fields.join(", ")} }) { ` +
        "... on PostActionSuccess { post { id } } ... on MutationError { message } } }",
    );
    if (createPost.post?.id) return createPost.post.id;
    throw new BufferRejected(createPost.message ?? "Buffer 没有建出帖子");
  }
}
