# 字段命名

依 create-indicator-name 的规则检查：新增自有字段使用小写 snake_case，布尔使用 is_ 前缀，名称长度不超过 63 字符。同一含义复用词根；Chrome API、Manifest 与 CDP 规定的字段保持官方命名。

| 字段 | 含义 |
| --- | --- |
| tool_id / tool_name / tool_desc / tool_url / tool_keywords | 工具稳定标识（网址）、名称、说明、网址、搜索关键词 |
| site_name | 来源站点 |
| favorite_tool_ids / recent_tool_ids | 收藏与最近使用的工具标识列表 |
| session_list / session_id / session_name | 会话列表、标识、名称 |
| saved_at / created_at / exported_at | ISO 保存时间、毫秒创建时间、ISO 导出时间 |
| tab_list / tab_url / tab_title / tab_index / window_id | 标签列表、网址、标题、顺序、原窗口标识 |
| is_pinned / is_group_collapsed / is_archived / is_ignore_tracking | 是否固定、组是否折叠、是否归档、是否忽略追踪参数 |
| group_key / group_name / group_color | 标签组归属、名称、颜色 |
| saved_tab_list / saved_id / collection_name / note_text | 保存页面列表、标识、收藏夹、备注 |
| settings_data / theme_name / tab_view | 设置、主题、标签视图 |
| backup_version / backup_data | 备份格式版本与数据 |
| action_type / action_data / is_success / result_data / error_text | 扩展内部消息类型、参数、成功状态、结果、错误信息 |
| menu_id / menu_name / menu_context / target_url | 右键菜单标识、名称、触发上下文、目标网址 |
| input_text / image_url / image_data | 一次性交接文字、图片网址、截图数据 |
| restored_cnt / skipped_cnt | 恢复与跳过数量 |
| tab_ids / tab_cnt / window_cnt / pinned_cnt / is_collapsed | 验收输出中的标签列表、数量与状态 |
| browser_version / extension_id / verified_at / passed_checks / page_errors | 验收浏览器版本、扩展标识、时间、检查与错误列表 |
| page_url / error_stack / is_tab_discarded / is_web_tab_debugged | 验收诊断输出；后两者为布尔验收报告字段，不作业务存储 |

name、id 等沿用通用字段语义，cnt 表达数量。本项目不生成金融指标或 Tangram 指标编码。
