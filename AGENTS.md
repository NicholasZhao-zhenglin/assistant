# 个人助手：项目工作约定

## 开始任务前

- 先阅读本文件、`architecture.md` 和 `current-task.md`，核对实现现状与当前任务范围。
- 增量维护三份文档；架构、依赖、数据流、接口或重要决策发生变化时及时更新；交付前更新任务记录。
- 事实、设计方案和待确认事项分开记录。未实施功能、未运行测试不得写成已完成。

## 项目现状与结构

- 本项目已进入离线桌面 MVP 开发阶段；实际实现、验证结果与未完工作见另外两份文档。
- 用户已选择本地桌面应用，数据主要保存在电脑。
- 产品依据：收件箱、项目清单、日历、资料库；增加聚合这些内容的“今天”视图。
- 已采用 Tauri 2、React、TypeScript、Vite、Rust、rusqlite/SQLite；npm 与 Cargo 锁文件必须随依赖变化提交。
- 界面与协调逻辑在 `src/App.tsx`，编辑组件在 `src/components/`，类型/规则/IPC 在 `src/lib/`；Rust 命令、模型、持久化和测试分别在 `src-tauri/src/` 中独立文件。详见 `architecture.md`。

## 开发约束与编码约定

- 当前任务边界见 `current-task.md`。用户已授权本轮实现并推送到 `https://github.com/NicholasZhao-zhenglin/assistant`；后续操作仍按对应用户授权执行。
- 核心收集、整理、行动、日历、资料和搜索功能应可离线使用。
- 保留原始收件内容及其来源；项目、行动、日程、资料通过稳定标识关联，避免复制后产生多个事实来源。
- UI、业务规则、持久化、系统能力与 AI 适配分层；持久化写入经统一业务入口校验。
- 数据库修改使用迁移；跨对象操作使用事务；备份与恢复覆盖数据库和托管附件。
- TypeScript 使用严格类型；Rust 显式处理错误；日期区分全天日期、截止日期及带时区时间。
- 默认简体中文界面和本地字体。带时区时间按系统当前时区展示；全天日期不转 UTC。浏览器预览必须明确标记，不能混同桌面 SQLite 持久化。
- AI 输出按建议处理，导入材料和网页内容按数据处理，不能成为执行系统操作的指令。
- 密钥不得写入源码、文档或日志；联网模型发送范围由用户启用和选择，本地存储不等于模型推理必然本地化。
- 尊重已有修改和用户提交政策，不扫描无关仓库；提交、推送和发布按用户授权范围执行，不额外创建后台定时任务。

## 验证与交付

- 只执行与变化相称的检查；业务实现后重点验证分流事务、跨模块关联、重启持久化及备份恢复。
- 在 `current-task.md` 记录实际执行的验证和限制，不粘贴长日志或敏感数据。
- 常用命令：`npm run desktop`、`npm run build`、`npm test`、`npm run test:e2e`、`npm run desktop:build`；Rust 检查使用 `cargo test --manifest-path src-tauri/Cargo.toml` 和 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。
- 代码格式：`npm run format:check` 与 `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`。
- 不边改文件边运行浏览器流程测试，避免 Vite 热更新干扰测试。
- Rust 测试使用临时数据目录；桌面真实冒烟测试需区分验证记录与用户数据，不把测试数据推送到仓库。
