-- 长文与发布包：加公众号平台；内容表存长文标题、公众号贴图、小红书内容包等结构化部分

alter type platform add value if not exists 'wechat';

alter table contents add column pack jsonb;
