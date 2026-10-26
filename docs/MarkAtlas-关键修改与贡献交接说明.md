# MarkAtlas 关键修改与贡献交接说明

**1、交互优化**
1. 选中时保留原生选区，临时高亮用CSS highlight API，不插入/绘制文字高亮元素，因此无需重新解析和渲染。
2. 重复选区事件合并处理。
3. 悬浮框避开侧边栏，避免重叠。
4. 聚焦输入框时禁止自动滚动。
5. 切换到编辑模式时保留阅读位置作为输入焦点。
6. 文件冲突验证，文件元数据变化不会误报为文件内容冲突。
7. 自动保存复用编辑器实例，保留输入焦点、光标和撤销历史。

**2、评论隔离**

1. 评论队列按绝对根路径分开保存在浏览器本地存储中
2. 评论列表、数量统计、发送和 Cancel all 都只作用于当前项目的根目录
3. 切换根目录后，其他项目的评论不会显示；切回原项目后，其评论会恢复
4. 没有根目录的独立文件使用独立文件队列，不与已选项目队列混合

**3、查看与编辑模式**

1. Markdown：Preview 为只读渲染；Source 可编辑源码；Edit 可编辑的渲染。
2. HTML：Preview 显示网页；Source 可编辑源码；集成鼠标拖框功能。
3. Python、JSON 等代码文件：只有可编辑 Source。PDF、图片、Word 保留各自适用的预览与保护逻辑。
4. 自动保存串行处理；出现磁盘写入冲突时保留本地草稿，仍允许切换文件。

**4、支持 HTML 网页审阅**

1. HTML 网页采用本地 Web Server；预览页面留在 MarkAtlas 内，使用隔离 iframe，网页无变化时不会重新加载。
2. 选中文字可以批注；动态文字无法精确映射时，标为网页视觉/元素引用，不冒充准确源码选区。
3. 集成鼠标拖框功能：支持鼠标拖框批注，保存裁剪截图、区域位置和可获取的文字；评论请求和解释请求都支持带图。批注时不携带截图数据（避免图片数据反复传输）。
4. 截图采用本地打包的 html-to-image。

**5、主界面新增功能**

1. Find in File 功能，重复点击会关闭，打开时清空旧查询；输入框风格与 Filter files 对齐。
2. Comment 和 Explanation 均使用 Command/Ctrl+Enter 提交，Enter 换行
3. Explanation 支持附加说明（可选）。
4. Comment 快捷键 C， 仅在非编辑预览模式中作为批注快捷键；编辑/源码模式不显示该提示，不截获普通 C 输入。
5. 点击评论定位原文，点击原文定位评论。
6. Readable / Full Width 控制正文宽度。

**6、文件树优化**

1. 文件树按钮点击右键菜单可更换位置。
2. 文件树上方眼睛按钮：隐藏或显示隐藏文件和文件夹。
3. 文件在文件树中支持拖拽更换文件所属路径，同名冲突提示、comment记录跟随。
4. 文件前进/后退历史（左上角）。

**7、界面外观优化**
1. 工具栏除 Request edits 外改为图标及英文悬停提示。 
2. 加入双链、嵌入、callout、任务状态、等号高亮、脚注、标签、公式和 Mermaid 等支持。
3. Checkbox 可切换任务状态，支持种类见下；标签可用于文件内搜索；支持图片宽度和内部资源解析。
4. 主题样式基于 [Obsidian Blue Topaz](https://github.com/PKM-er/Blue-Topaz_Obsidian-css) 修改。开源时，应在 **MarkAtlas 自己的开源仓库 README.md** 中设置“第三方组件与致谢”小节说明来源。
   - 上游 [README](https://github.com/PKM-er/Blue-Topaz_Obsidian-css#readme) 明确提出：分发全部或部分代码时，在相关 CSS 文件和 README.md 中加入其指定的来源与致谢声明，注明 Blue Topaz，并致谢 [WhyI（whyt-byte）](https://github.com/whyt-byte) 和 [pkmer.cn](https://pkmer.cn)。落地时应复制上游指定声明到这两处；CSS 中可放在文件头注释内。
   - 根据上游 [MIT 许可证](https://github.com/PKM-er/Blue-Topaz_Obsidian-css/blob/master/LICENSE)，分发相关代码时须保留版权声明 `Copyright (c) 2020 whyt-byte` 和许可声明。建议在 MarkAtlas 仓库的 `licenses/Blue-Topaz-LICENSE.txt` 中保存完整上游许可证文本，并从 README 链接；发布包中也应随附该文件。

**8、Checkbox 任务状态支持**
- [ ] 待办
- [/] 进行中/未完成
- [x] 完成
- [-] 取消
- [>] 转发
- [<] 排期
- [?] 问题
- [!] 重要
- [*] 星标
- ["] 引用
- [l] 位置 location
- [b] 书签 bookmark
- [i] 信息 info
- [S] 储蓄 save
- [I] 想法 idea
- [p] 优点
- [c] 缺点
- [f] 火急
- [k] 关键
- [w] 胜利
- [u] 上升
- [d] 下降
- [D] draft PR
- [P] open PR
- [M] merged PR

