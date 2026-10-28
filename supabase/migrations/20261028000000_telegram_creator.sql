-- Telegram 当输入端 + 技术博主模板：发文字或语音给机器人，写成 X 中文短推、Substack 英文长文、LinkedIn 英文帖。
-- 笔记存在 sources 表（platform = 'telegram'），不用新表；这里只加 Substack 平台。
alter type platform add value if not exists 'substack';
