-- LinkedIn / Instagram 经 Buffer 发布（kim 2026-10-16 决定，不走各平台官方 API）：
-- 工作台直推 Buffer，或先推到 Telegram，在 TG 里点按钮再推 Buffer

alter type publish_method add value if not exists 'buffer';

-- 账号对应的 Buffer 频道
alter table accounts add column buffer_channel_id text;

-- 交给 Buffer 的图片：公开、稳定的 HTTPS 地址（Buffer 不收文件上传）；Instagram 至少一张
alter table contents add column media_urls text[] not null default '{}';

-- 推到 Telegram 审核的那条消息；TG 回调只认这条消息上的按钮
alter table contents add column telegram_message_id bigint;
