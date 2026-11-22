-- 素材：上传本地音视频文件转写。文件存在私有桶 sources 里，路径第一段是组织 id（{org_id}/{随机名}.mp3），
-- 浏览器用登录用户身份直传，存储策略按组织隔离；转写时后台生成临时下载链接交给 Supadata。
-- 单个文件上限 50MB（Supabase 免费档的上限；升 Pro 后可以把这里和 src/lib/sources/upload.ts 一起调大）。

alter table sources add column storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', false, 52428800, array['audio/*', 'video/*'])
on conflict (id) do nothing;

create or replace function storage_org(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(object_name, '/', 1)::uuid
  end;
$$;

create policy "members read sources files" on storage.objects
  for select to authenticated
  using (bucket_id = 'sources' and is_org_member(storage_org(name)));

create policy "editors upload sources files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sources'
    and has_org_role(storage_org(name), array['owner', 'editor']::member_role[])
  );

create policy "editors delete sources files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sources'
    and has_org_role(storage_org(name), array['owner', 'editor']::member_role[])
  );
