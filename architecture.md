# 个人助手架构

更新日期：2026-10-20。产品名“栖序”，版本 `0.1.1`。

## 当前实际状态

已实现本地桌面 MVP 的业务代码、浏览器预览适配、自动化测试和 CI 模板。用户已授权开发并推送至指定 GitHub 仓库。真实构建、测试和推送结果以 `current-task.md` 为准。

技术栈：Tauri 2、React 19、TypeScript、Vite、Rust、rusqlite（内置 SQLite）、ZIP 与 SHA-256。JavaScript 和 Rust 依赖均有锁文件。

## 产品边界

| 区域 | 已实现职责 |
| --- | --- |
| 今天 | 今日重点、全部/等待/完成行动、今日日程、未来七天及已逾期截止事项。聚合记录，不复制事实数据。 |
| 收件箱 | 接收文字、链接、文件；整理为一个或多个结果；已整理原文只读；支持归档恢复。 |
| 项目清单 | 完成标准、状态、截止日期、行动进度、缺少下一步提示；详情关联行动、资料和日程。 |
| 日历 | 月视图、全天日期承诺、起止时间、跨日事件、截止标记；普通行动不自动占用时间。 |
| 资料库 | 笔记、链接、代码片段、托管附件；关联项目/行动；搜索标题、正文和标签。 |
| 每周回顾 | 本地统计最近七天完成行动、缺少下一步、逾期和等待；行动/日程归档恢复。 |
| 设置 | 数据位置、备份导出与恢复、快捷键说明及当前功能边界。 |

独立行动允许不关联项目。项目只在用户明确操作时完成；已完成、等待和归档行动不算可执行下一步。

## 当前代码结构

```text
src/
  App.tsx                  页面、应用状态、列表与项目详情、系统事件协调
  components/Editor.tsx    通用编辑、收件分流、附件选择、原始收件只读查看
  components/FolderImport.tsx HTML 目录扫描预览、批量选择和增量收录
  components/Modal.tsx     原生 dialog，焦点管理与关闭
  lib/model.ts             领域类型、日期/搜索/下一步规则
  lib/api.ts               桌面 IPC 与明确标记的浏览器预览适配
  lib/model.test.ts        日期、跨日、搜索、项目下一步测试
  styles.css               响应式界面和本地字体
src-tauri/
  src/lib.rs               Tauri 命令、菜单栏、全局快捷键、单实例及窗口生命周期
  src/model.rs             持久化对象和集中数据校验
  src/folder_import.rs     HTML 标题解析、静态资源收集、去重更新与打开缓存
  src/storage.rs           SQLite 事务、附件复制、备份和恢复
  src/tests.rs             数据完整性和恢复测试（临时数据目录）
  migrations/001_initial.sql 数据库版本 1
  capabilities/default.json 本地窗口与显式文件对话框权限
  tauri.conf.json          桌面打包、窗口和 CSP
  icons/                   从 assets/icon.svg 生成的应用图标
assets/                    图标源文件与浏览器预览截图
tests/workflow.spec.ts    浏览器端到端工作流与布局验证
.github/ci-template.yml   前端与 macOS Rust/构建检查模板（未自动启用）
```

最初方案中的 `features/commands/domain/integrations` 多目录拆分尚未逐项建立，当前按上列较少文件组织。后续功能增长时再拆分页面与系统集成，保持业务规则和存储边界。

## 数据模型与存储

目前采用统一 `Entry` 类型，通过 `kind` 区分 inbox、project、action、event、resource。稳定 UUID 是跨模块关联依据。

- 通用字段：标题、正文、状态、归档标记、标签、创建/更新时间。
- 关联：可选 `projectId`、`actionId`、`sourceId`；附件 UUID 列表。
- 行动：`isNext`、`focused`、`due`；状态 todo/waiting/done。
- 项目：正文作为完成标准；状态 active/paused/done。
- 日程：`allDay` + 全天 `due`，或 RFC 3339 `start`/`end`。时间点按当前系统时区展示，未另外保存命名时区；全天日期不转 UTC。
- Attachment：UUID、原始文件名、字节数、SHA-256。文件存于应用数据目录下 `attachments/<UUID>/<原文件名>`。

SQLite `entries` 表以 id 为主键，kind/project_id 建索引，项目关联有延迟外键约束；完整对象保存在 JSON 字段。`attachments` 表保存附件元数据。不是每种实体一张表的完全规范化结构。

当前通过读取全量快照、集中校验后事务写回，保证 MVP 的一致性。适用于个人规模数据；记录增长后应改为增量写入及数据库搜索。SQLite 启用 WAL、外键和 busy timeout，通过 `user_version` 管理迁移。

生产数据路径由操作系统应用数据目录决定，macOS 为 `~/Library/Application Support/com.nicholas.assistant/`；不进入源码仓库。浏览器预览明确显示提示，使用独立 localStorage，仅为界面开发与端到端测试服务。

## 接口与主要数据流

Tauri IPC 命令：`get_snapshot`、`save_entry`、`triage_item`、`import_attachment`、`open_attachment`、`open_link`、`create_backup`、`restore_backup`、`data_directory`、`scan_html_folder`、`import_html_files`。界面不直接执行 SQL。

1. 快捷键、菜单栏或页面记录 → 保存 pending Inbox Entry。
2. 整理对话框选择行动/项目/日程/资料，可同时创建项目首个行动、原文资料与全天日期承诺。
3. Rust 校验目标、关联与时间 → 同一事务写入目标并标记 source 为 processed → 界面更新；重复整理被拒绝，失败时收件保持 pending。
4. 已整理原始收件的标题、正文、附件关联受后端保护；后续编辑操作针对结果记录。归档不破坏来源与项目关联。
5. 完成行动 → 更新状态 → 今天、项目进度和回顾重新聚合。
6. 文件选择/拖入 → 复制到应用目录并计算 SHA-256 → 记录引用；原文件移动不影响托管副本。单文件上限 25 MB。

全局快捷键为 `CommandOrControl+Shift+Space`。关闭窗口隐藏到菜单栏，菜单“退出栖序”才退出进程；单实例插件避免多个进程同时操作同一工作空间。快捷键冲突只影响该快捷键，菜单入口仍可用。

## 备份、恢复与可靠性

备份为 `.assistant-backup` ZIP：带格式名/版本的 JSON 清单 + UUID 命名的附件内容。清单与数据库记录在同一进程互斥锁下读取，形成一致性逻辑快照；不是简单复制运行中的 SQLite 文件。

- 导出先核对附件大小及 SHA-256；写临时文件后重命名完成。
- 清单上限 16 MB，导出附件合计上限 480 MB；导入压缩文件/总解压附件上限 512 MB。
- 导入先验证格式、实体、引用和所有附件校验值；不直接解压不可信路径。
- 替换前保存 `before-restore.assistant-backup`。附件重新分配 UUID，避免失败恢复覆盖当前附件；最后事务替换数据库记录。
- 归档可恢复；暂不执行附件垃圾回收，取消编辑或移除关联可能留下未引用的托管附件。
- 备份未加密。没有后台自动备份、云上传或账户同步。

## 尚未实施

- AI 模型适配、自然语言抽取、语义检索和 AI 简报；当前每周回顾为本地规则汇总。
- 外部日历集成、系统通知、退出后提醒、手机同步及其他操作系统验证。
- OCR、附件正文全文搜索、自动附件清理、加密备份和自动更新。
- 大型数据库增量写入、附件流式备份、命名时区管理。

后续 AI 必须作为可选适配层：输入材料是数据，输出是可修改建议；核心流程离线可用。云端模型会接收用户选择的内容，密钥应进入系统凭据存储。

## 参考

- [Tauri 前端配置](https://v2.tauri.app/start/frontend/)
- [Tauri 架构](https://v2.tauri.app/concept/architecture/)
- [Tauri 全局快捷键](https://v2.tauri.app/plugin/global-shortcut/)
- [SQLite 适用场景](https://www.sqlite.org/whentouse.html)

官方文档于 2026-10-13 查阅。当前验证证据见 `current-task.md`。

## HTML 文件夹收录（0.1.1）

- 资料库的“从文件夹收录”提供目录选择、生成页面默认目录、再次扫描与勾选导入。上次扫描目录仅保存在本机 UI 偏好中；没有后台监听或定时扫描。
- 仅枚举目录顶层 HTML/HTM，最多 1000 份。scraper 解析 UTF-8 标题及静态资源引用；URL 解析与 CSS url/@import 提取只读取目录内本地依赖，不执行脚本或联网。符号链接不能逃逸页面目录；缺失资源、非 UTF-8、base 地址和绝对本地资源路径显示为失败项。
- 每个页面及依赖打包成一个 ZIP 托管附件；附件 `entryPoint` 指定 HTML 入口。打开时核验哈希与归档路径、大小，解压到独立 `html-cache/<UUID>` 后交给系统浏览器。页面包最多 500 文件、总原始大小和压缩包各不超过 25 MB；打开缓存暂未自动清理。
- Entry 可选 `fileSource` 保存规范来源路径、内容指纹和导入附件 UUID；Attachment 可选 `entryPoint`。Serde 默认值兼容旧数据库/备份，无表结构变更。旧版应用不能读取包含新增字段的记录，不应降级。
- 内容指纹覆盖 HTML 与依赖内容；同批/跨次重复跳过，同路径内容变化标为更新。更新默认不勾选，保留用户标题、备注、标签、项目/行动关联、归档状态及其他附件，仅替换导入附件引用。旧托管附件保留，不自动回收。
- 导入前重新读文件与预览指纹比较，整个所选批次一次事务提交，失败清理本次新写的文件。来源元数据随完整备份保存；恢复时重映射其附件 UUID。
- 当前不复制 HTML 中跳转到其他本地页面的导航链接、不推断 JavaScript 模块及动态加载依赖；外部资源仍需网络。搜索覆盖卡片标题/备注/标签，不包含 HTML 正文。
