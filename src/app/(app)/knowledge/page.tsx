import { Card, Empty, PageHeader, buttonClass, inputClass } from "@/components/ui";
import type { KnowledgeType } from "@/lib/db/types";
import { requireSession } from "@/lib/session";
import { addKnowledge, deleteKnowledge } from "../actions";

const TYPE_LABELS: Record<KnowledgeType, string> = {
  tone_guide: "语气指南",
  taboo_words: "禁用词",
  viral_post: "历史爆款",
  brand_material: "资料",
  competitor: "竞品账号",
};

export default async function KnowledgePage() {
  const { supabase } = await requireSession();
  const { data } = await supabase
    .from("knowledge_items")
    .select("id, type, content, created_at")
    .order("created_at", { ascending: false });
  const items = (data ?? []) as { id: string; type: KnowledgeType; content: string }[];

  return (
    <>
      <PageHeader title="知识库" />
      <Card>
        <form action={addKnowledge} className="grid gap-2">
          <select name="type" className={`${inputClass} w-auto`}>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <textarea
            name="content"
            rows={4}
            placeholder="语气指南、禁用词表、表现好的历史内容……文案生成时会自动带上"
            className={inputClass}
          />
          <div>
            <button className={buttonClass}>添加</button>
          </div>
        </form>
      </Card>

      <div className="mt-4 grid gap-3">
        {items.length === 0 ? <Empty>知识库还是空的。</Empty> : null}
        {items.map((item) => (
          <Card key={item.id}>
            <div className="mb-1 flex items-center justify-between text-xs text-muted">
              <span>{TYPE_LABELS[item.type]}</span>
              <form action={deleteKnowledge.bind(null, item.id)}>
                <button className="hover:text-bad">删除</button>
              </form>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{item.content}</pre>
          </Card>
        ))}
      </div>
    </>
  );
}
