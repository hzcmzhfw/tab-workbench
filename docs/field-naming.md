# 字段命名

依 create-indicator-name 的规则检查：新增自有字段使用小写 snake_case，布尔使用 is_ 前缀，最长不足 63 字符。Chrome API 和 Manifest 规定的字段保持官方命名。

| 字段 | 含义 |
| --- | --- |
| tool_id / tool_name / tool_desc / tool_url | 工具标识、名称、说明、网址 |
| site_name | 来源站点 |
| favorite_tool_ids | 收藏工具标识列表 |
| session_list / session_id / session_name | 会话列表、标识、名称 |
| saved_at | 保存时间，ISO 8601 |
| tab_list / tab_url / tab_title / is_pinned | 标签列表、网址、标题、是否固定 |
| handoff_text / handoff_url / handoff_image / handoff_target | 临时交接文字、图片网址、截图、目标工具网址 |

name、id 等沿用通用字段语义；扩展业务词属于可读英文描述，不生成 Tangram 金融指标编码。
