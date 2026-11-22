-- 同一平台多个账号 + 在工作台里换模型、贴 key。
-- 1) Telegram 笔记默认给每个有档案的账号都写一份；可以按账号关掉。
-- 2) 每个账号可以另选写稿模型（空着用「模型」页的写稿模型）。
alter table accounts add column if not exists telegram_enabled boolean not null default true;
alter table accounts add column if not exists model text;

-- 3) 模型厂商的 API key：AES-256-GCM 加密（和平台令牌同一把 TOKEN_ENCRYPTION_KEY），
--    只有 service role 能读写（开 RLS、不加任何策略），页面上只显示最后 4 位。
create table if not exists model_keys (
  org_id uuid not null references orgs (id) on delete cascade,
  provider text not null check (provider in ('gemini', 'anthropic', 'openai', 'xai', 'openrouter')),
  ciphertext text not null,
  hint text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);
alter table model_keys enable row level security;
