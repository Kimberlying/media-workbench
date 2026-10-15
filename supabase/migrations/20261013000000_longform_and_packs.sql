-- 长文与发布包：加公众号平台；内容表存长文标题、公众号贴图、小红书内容包等结构化部分

alter type platform add value if not exists 'wechat';

alter table contents add column pack jsonb;

-- 一条内容最多一条发布记录。后台发布先写一条没有平台 id 的记录占位，
-- 任务重试时占位还在就插不进去，避免同一条内容被重复发出（结果不确定时交给人核对）
create unique index posts_one_per_content on posts (content_id);
