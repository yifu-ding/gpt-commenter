"""Build a self-contained macOS arm64 MCP plugin ZIP and verify its runtime."""
import hashlib
import json
import platform
import shutil
import subprocess
import tempfile
import zipfile
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parent
repo = source.parent
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This package target requires an Apple Silicon Mac.')
node = source / 'node_modules/node/bin/node'
node_version = subprocess.check_output([str(node), '--version'], text=True).strip()
node_license = source / 'licenses' / f'node-{node_version}.txt'
if not node_license.is_file():
    raise SystemExit(f'Missing official runtime license: {node_license}')
manifest = json.loads((source / 'plugin.json').read_text())
version = manifest['version']
output = repo / 'releases' / f'markatlas-{version}-macos-arm64.zip'
output.parent.mkdir(exist_ok=True)
subprocess.run(['npm', 'run', 'build'], cwd=source, check=True)

with tempfile.TemporaryDirectory(prefix='markatlas-package-') as temporary:
    stage = Path(temporary) / manifest['name']
    stage.mkdir()
    for folder in ['dist', 'assets']:
        shutil.copytree(source / folder, stage / folder)
    (stage / 'src').mkdir()
    shutil.copy2(source / 'src/viewer.html', stage / 'src/viewer.html')
    shutil.copy2(source / 'src/clear-history.html', stage / 'src/clear-history.html')
    (stage / 'runtime').mkdir()
    shutil.copy2(node, stage / 'runtime/node')
    shutil.copy2(repo / 'LICENSE', stage / 'LICENSE')
    # Bundle npm packages into the server. createRequire supports CommonJS
    # dependencies inside the ESM bundle; no node_modules are shipped.
    subprocess.run([
        str(node), '-e',
        'require("esbuild").buildSync({entryPoints:["src/server.js"],bundle:true,'
        'platform:"node",format:"esm",banner:{js:'
        + json.dumps('import {createRequire as __markatlasCreateRequire} from "node:module"; const require = __markatlasCreateRequire(import.meta.url);')
        + '},outfile:process.argv[1]})', str(stage / 'dist/server.js'),
    ], cwd=source, check=True)
    manifest.pop('interface', None)
    interface = manifest['extensions']['com.openai']['interface']
    for key in ['logo', 'logoDark', 'composerIcon']:
        interface[key] = interface[key].replace('.svg', '.png')
    (stage / 'plugin.json').write_text(json.dumps(manifest, indent=2) + '\n')
    config = json.loads((source / 'mcp.json').read_text())
    config['mcpServers']['gpt-commenter']['command'] = './runtime/node'
    (stage / 'mcp.json').write_text(json.dumps(config, indent=2) + '\n')
    (stage / 'package.json').write_text(json.dumps({
        'name': manifest['name'], 'version': version, 'private': True,
        'os': ['darwin'], 'cpu': ['arm64'],
        'type': 'module', 'scripts': {'start': './runtime/node dist/server.js'},
    }, indent=2) + '\n')
    (stage / 'README.md').write_text(f'''# MarkAtlas {version} — macOS Apple Silicon

**English** | [简体中文](README.zh-CN.md)

This desktop package includes Node {node_version}, the built MCP server and
viewer, JavaScript dependencies, Poppler PDF tools and libraries, and the compiled native file/folder chooser.
No npm install or build step is needed. Install through your desktop host's
supported local plugin/marketplace flow; extracting the ZIP does not install it.
Keep this directory intact and preserve executable permissions when extracting.

## Additional requirements

- macOS on Apple Silicon (arm64); Intel Macs, Windows, and Linux are not targets.
- A compatible desktop host with MCP Apps and native message/attachment support.
- PDF extraction and rendering use bundled Poppler; no Homebrew installation is needed.
- Background explanations require host MCP sampling or an installed, signed-in
  Codex CLI. Set MARKATLAS_CODEX_PATH if the host cannot find the CLI on PATH.
- Precise LaTeX mapping needs SyncTeX; compilation uses your own LaTeX toolchain.

## Submission status

MarkAtlas has been submitted to OpenAI for review. Public plugin search is not
available yet. If approved and published, MarkAtlas will be available from the
public Plugins Directory. This package is for local installation and testing.

Third-party licenses are in licenses/. Matching PDF component sources and build recipes
are in third-party-sources/pdf/. See LICENSE for MarkAtlas's license.
''')
    (stage / 'README.zh-CN.md').write_text(f'''# MarkAtlas {version} — macOS Apple Silicon

[English](README.md) | **简体中文**

本桌面分发包包含 Node {node_version}、构建好的 MCP 服务和查看器、JavaScript 依赖、
Poppler PDF 工具及其运行库，以及已编译的原生文件与文件夹选择器。
无需安装 npm 或执行构建。请通过桌面宿主支持的本地插件流程安装；仅解压 ZIP 不等于安装插件。
解压时请保持目录完整，并保留可执行文件权限。

## 环境要求

- 仅支持 Apple Silicon（arm64）Mac；不适用于 Intel Mac、Windows 或 Linux。
- 需要支持 MCP Apps 和原生消息及附件的兼容桌面宿主。
- PDF 提取和渲染使用附带的 Poppler，无需安装 Homebrew。
- 后台解释需要宿主 MCP sampling 或已安装并登录的 Codex CLI。
  如果宿主无法从 PATH 找到 CLI，请设置 MARKATLAS_CODEX_PATH。
- 精确的 LaTeX 映射需要 SyncTeX；编译使用你自行安装的 LaTeX 工具链。

## 审核状态

MarkAtlas 已提交 OpenAI 审核，目前尚不支持公共插件搜索。如果审核通过并正式发布，
就可以通过公共插件目录安装。本分发包用于本地安装和测试。

第三方许可证位于 licenses/，对应 PDF 组件源码与构建配方位于 third-party-sources/pdf/。
MarkAtlas 本身的许可证请参阅 LICENSE。
''')
    notices = stage / 'licenses'
    notices.mkdir()
    shutil.copy2(node_license, notices / 'Node.txt')
    shutil.copytree(repo / 'submission/review-fixtures', stage / 'review-fixtures')
    module_spec = importlib.util.spec_from_file_location('desktop_pdf', source / 'desktop-pdf.py')
    pdf = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(pdf)
    print(f'Bundled {pdf.prepare(stage)} PDF executables/libraries, encoding data, sources and notices.', flush=True)
    # Preserve dependency notices for both the server and the bundled viewer.
    for path in sorted((source / 'node_modules').rglob('*')):
        if not path.is_file() or path.is_symlink():
            continue
        if path.name.lower().split('.')[0] not in {'license', 'licence', 'copying', 'notice'}:
            continue
        relative = path.relative_to(source / 'node_modules')
        target = notices / 'npm' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                assert not path.is_symlink(), path
                archive.write(path, path.relative_to(stage).as_posix())
    # Test the final archive after extracting it, rather than the staging tree.
    extracted = Path(temporary) / 'clean-install'
    subprocess.run(['/usr/bin/unzip', '-q', str(output), '-d', str(extracted)], check=True)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert not any(Path(name).parts[0] == 'node_modules' for name in archive.namelist())
    subprocess.run([str(node), str(source / 'package-desktop-check.mjs'), str(extracted)],
                   cwd=Path(temporary), check=True)

digest = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n')
print(f'Verified desktop ZIP: {output} ({output.stat().st_size:,} bytes)')
