-- 配图存在 Supabase Storage 的公开桶里：Buffer 只收公开的 https 图片链接。
-- 只有后台（service role）往里写；公开读，链接里带随机 id，不可猜。
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
