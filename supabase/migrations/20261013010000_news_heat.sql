-- 固定信源带热度分（点赞、星数等），选题时参考
alter table news_items add column if not exists heat integer not null default 0;
