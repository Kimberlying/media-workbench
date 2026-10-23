-- 对标 SnapVee 的多平台改写：加知乎和 Threads。两者都没有开放发布接口，生成后人工发（Threads 以后可以经 Buffer）。

alter type platform add value if not exists 'zhihu';
alter type platform add value if not exists 'threads';
