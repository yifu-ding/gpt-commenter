# MarkAtlas-插件体验改动（Oct 23）

**1. Markdown 体验优化**

- Markdown 编辑底层使用 CodeMirror 6，局部预览由 MarkAtlas 扩展实现。使用 CodeMirror 语言包、legacy modes 与 Highlight.js 扩展语言覆盖，统一采用 GitHub 浅色语法配色。
- 代码高亮支持：覆盖 Python、JSON、CSS、JavaScript/TypeScript、HTML、Java、C/C++、Rust、SQL、Shell、YAML、Go、Ruby、Swift、Lua、PowerShell 等常用语言；不自行维护各语言关键字规则。
- 行距与表格间距修改：调整正文行距、段落与列表间距；修正表格行的列宽一致性，表格单元格内内容过多则换行处理
- 支持properties：渲染文档开头的 YAML frontmatter 为 Obsidian 风格 Properties 区域，支持 title、aliases、tags、cssclasses、created 等属性；Edit 中可回到 YAML 编辑，保留源码。异常 YAML 不伪装成有效属性。
- 主题色选择：Markdown 强调文字、表头及界面激活态采用宿主可提供的语义主题色；取不到有效主题色时回退蓝色。
- 表格换行和列宽自动计算：表格在 Preview / Edit、Readable / Full Width 下均自动换行，不再要求横向拖动滚动条；按整表内容计算列宽，短内容列收窄、长内容列加宽，两种模式使用同一列宽规则。
- 多级列表对齐： Checkbox 随字号和行高缩放，避免底部截断；bullet points 与 Checkbox 的文字起点统一。列表每级缩进加大为 2em（约四个英文半角字符宽），嵌套层级使用细竖线辅助对齐。
- 快捷键：选中文字后，`Command/Ctrl+B` 加粗，`Command/Ctrl+I` 斜体。输入 `$` 包裹为行内公式；连续输入两次 `=` 包裹为高亮。
- 按下 tab 等于一次缩进（4 spaces）

**2. PDF 与文档导航**

- PDF 隐藏 Readable / Full Width 控件；其他适用文档继续使用宽度切换
- PDF 增加大纲功能：在大纲区域或大纲按钮上均可打开菜单。位置记忆在本地。大纲可拖动边缘调整宽度并记忆
- 大纲下方的缩略图功能：缩略图按可见范围加载，并限制渲染并发；加载时显示 Loading…，失败时显示 Preview unavailable，避免破损图片占位。
- 打开或关闭右侧边栏时保留 PDF 画布位置、缩放和横向滚动。

**3. 文件树**

- 文件树支持把文件拖到项目内另一目录或根目录，实际移动磁盘文件；禁止覆盖同名目标并检查路径边界。移动后更新打开路径、历史与批注记录。当前不支持拖动整个文件夹，也不自动改写文档内相对链接。
- Reveal in Finder 在 Finder 中显示并选中目标文件或目录。
- 文件选择器加载延迟优化：原生文件选择器直接启动辅助程序，避免先等待文档渲染/保存；实际离开旧文件前仍检查保存状态。云盘或系统目录加载延迟仍可能存在。
- 在未打开项目或文件时展示“最近项目列表”，保存在浏览器本地存储，最多十个，显示目录名。点击后直接打开最对应的项目。
- 新按钮
    - Collapse all folders 收起所有展开目录，刷新后保留收起状态；图标为上下箭头向中间收拢
    - Locate 展开当前文件的祖先目录并滚动定位，必要时清除挡住目标的过滤条件，不做折叠
    - 文件排序
- `Command/Ctrl+O` 在 MarkAtlas 页面收到按键时，优先触发插件自己的 Open folder 按钮，选择目录作为项目根路径
- 初始未连接工作区时，不再显示 “No workspace folder was shared by the app. Use Open folder to connect a local folder.”，其他真实打开错误继续显示。
- 取消打开5000个文件个数上限

**4. 双文件布局**
- 双文件模式去掉第二面板多余标签栏，文件名旁提供关闭按钮；共用一套居中的 Comments 列表、底部操作和浮窗。点击批注时在最后活动面板中打开对应文件并定位，另一面板保持不变。
- 文件右键可选 Open on right / Open on bottom，同时显示两个文件；分隔线可拖动，文件标题可拖到不同边缘换位。
- 两个面板独立编辑、滚动和预览；关闭主面板时可将另一文件提升为主面板。只支持两份文件，不递归创建更多面板。
- 双文件布局共享一个Comment列表。

**5. 搜索功能**

- Command/Ctrl+F启动搜索栏
- 项目搜索同时匹配文件名和正文，文件名结果优先，使用小号灰色 Filename match / Content match 分组标题；各组最多 100 条。支持文件掩码（如 `*.md`）、方向键选择和 Enter 打开。文件名结果正常打开文件，正文结果跳到对应源码行；PDF、Office 和图片等二进制文件可按文件名匹配，不直接作为文本扫描。使用 `Command/Ctrl+F` 或对应项目搜索快捷键，替代独立 Find in File 浮框。

**6. Git changes 统计**

- 当前目录属于本地 Git 工作区时显示增删行数，无需 GitHub 连接或远程仓库配置。
- 以 HEAD 为基准统计暂存与未暂存修改的净变化，避免重复累计；支持未跟踪文本文件和无首次提交的仓库。
- 文件和目录显示变化，顶部显示汇总；删除文件保留灰色不可打开的条目。二进制或超限未跟踪文件使用 M 提示，不伪造行数。
- 新增为绿色、删除为红色，统计右对齐；大数字使用小写 k，如 `+1.2k`、`-8k`，悬停及无障碍标签保留精确数字。
- Git 查询有超时与输出限制；非 Git 项目、Git 不可用或查询失败不阻断普通浏览。
- 排序支持 Name (A–Z)、Name (Z–A)、Modified (newest first)、Modified (oldest first)、File type；Folders first 独立开关。
- 使用自然数字名称顺序；目录修改时间考虑子项。排序设置保存在本地存储。
- 排序菜单与文件树位置菜单使用协调的小字号英文样式；已验证菜单为 12 px、常规字重。
- 保存后延迟刷新树统计，重新打开文件树或回到窗口时也刷新。

**7. 项目内存储**

打开项目根目录后，主体数据存放在：

```text
项目根目录/
└── .markatlas/
    ├── project.json
    └── <文档标识的 SHA-256>.document.json
```

- `project.json` 保存项目批注队列、截图、工作草稿及磁盘基线。
- `*.document.json` 保存文档工作版本、批注锚点、原文快照和修改检查点。
- 不同根目录分别读写，侧栏、统计、发送和清空操作均限定当前项目；同名文件不会混用批注。
- 浏览器本地存储保留为快速恢复层；全局数据目录仍保留批注 ID 的查找索引，供聊天中的解析工具使用。
- 未连接真实根目录的临时文件继续使用原有缓存，不猜测项目路径。
- 元数据使用临时文件加原子替换写入；拒绝 `.markatlas` 符号链接，内部数据不进入普通文件树与相关源码扫描。
- 尚未开发记忆功能，后续可参考OpenWOLF之类的开源Skill。

**8. 样式优化**

- 工具栏多数操作使用图标加英文悬停提示，Request edits 保留文字；空状态也避免 Preview 文本挤出图标区域。
- 文件树、Comments 等可切换按钮在打开时显示主题色，关闭后恢复中性颜色；Preview / Edit / Source 模式按钮始终显示主题色。
- Explanation 失败时展示 Codex 返回的实际错误，包括额度耗尽、重置时间等可用信息，并以红色展示；不再把所有失败笼统解释为登录或模型访问问题。
- Comments 右侧栏支持拖动左边缘调宽，并记忆宽度；支持方向键、Home / End 调整。
- 顶部路径按完整路径段适配宽度，优先保留文件名；窄窗口提供文件名换行回退，恢复宽度后重新布局。
- 正文使用独立滚动区域，顶栏不随正文惯性滚动；侧栏与正文分别占位。
- Edit和source模式去掉编辑器外框。

**9. 新增快捷键**

- `Command/Ctrl + /` 在 Markdown Preview → Edit → Source 三种模式之间轮换，覆盖Codex原生快捷键
- `Command/Ctrl + O` 打开文件夹作为项目路径，覆盖Codex原生快捷键
- 在markdown内：`Command/Ctrl+B` 加粗，`Command/Ctrl+I` 斜体。输入 `$` 包裹为行内公式；连续输入两次 `=` 包裹为高亮。

**10. 主要代码与测试入口**

| 范围 | 主要文件 |
| --- | --- |
| Markdown 解析、主题与实时编辑 | `src/markdown.js`、`src/live-markdown.js`、`src/table-layout.js`、`src/editor.js`、`src/markdown-shortcuts.js`、`build-theme.mjs`、`assets/obsidian/` |
| HTML 网页与区域审阅 | `src/html-preview.js`、`src/html-canvas-runtime.js`、`src/web-preview.js` |
| 项目存储与发送 | `src/review-store.js`、`src/project-state.js`、`src/prepare-review-batch.js`、`src/review-batch.js` |
| PDF、Word 与大纲 | `src/pdf-viewer.js`、`src/pdf-navigation.js`、`src/document-navigation.js`、`src/word-viewer.js` |
| 导航、分屏与文件树 | `src/native-navigation.js`、`src/breadcrumb-layout.js`、`src/split-view.js`、`src/pane-bridge.js`、`src/file-menu.js`、`src/workspace.js` |
| Git 与排序 | `src/git-tree.js`、`src/tree-preferences.js` |
| 界面集成 | `src/viewer.js`、`src/viewer.html`、`src/server.js` |

