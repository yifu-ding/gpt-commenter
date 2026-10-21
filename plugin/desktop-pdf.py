"""Prepare relocatable copies of the installed Homebrew PDF tools and sources.

Never modifies Homebrew. Source archives are checksum-verified and shipped with
the binaries, together with their installed build recipes and our relocation script.
"""
import concurrent.futures
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

TOOLS = ['pdftotext', 'pdftocairo', 'pdftoppm']
SOURCE_CACHE = Path(__file__).resolve().parent.parent / 'releases/pdf-sources'


def dependencies(path):
    path = path.resolve()
    result = []
    for line in subprocess.check_output(['otool', '-L', str(path)], text=True).splitlines()[1:]:
        name = line.strip().split(' (')[0]
        if name.startswith('/usr/lib/') or name.startswith('/System/Library/'):
            continue
        if name.startswith('/opt/homebrew/'):
            target = Path(name)
        elif name.startswith('@rpath/'):
            target = path.parent.parent / 'lib' / name[len('@rpath/'):]
        elif name.startswith('@loader_path/'):
            target = path.parent / name[len('@loader_path/'):]
        else:
            raise RuntimeError(f'Unsupported dependency: {name}')
        if not target.exists():
            raise RuntimeError(f'Missing dependency: {target}')
        result.append((name, target.resolve()))
    return result


def inventory():
    pending = [Path(shutil.which(tool) or '/missing/' + tool).resolve() for tool in TOOLS]
    graph = {}
    while pending:
        path = pending.pop()
        if path in graph:
            continue
        graph[path] = dependencies(path)
        pending.extend(target for _, target in graph[path])
    roots = sorted({Path(*path.parts[:6]) for path in graph})
    records = []
    for root in roots:
        recipe = next((root / '.brew').glob('*.rb'))
        text = recipe.read_text()
        url = re.search(r'^  url "([^"]+)"', text, re.M).group(1)
        sha = re.search(r'^  sha256 "([a-f0-9]{64})"', text, re.M).group(1)
        records.append({'package': recipe.stem, 'version': root.name,
                        'url': url, 'sha256': sha, 'archive': url.rsplit('/', 1)[-1],
                        'recipe': str(recipe), 'root': str(root)})
        # The installed Poppler data is a separate source resource.
        if recipe.stem == 'poppler':
            resource = re.search(r'resource "font-data" do(.*?)\n  end', text, re.S).group(1)
            data_url = re.search(r'url "([^"]+)"', resource).group(1)
            data_sha = re.search(r'sha256 "([a-f0-9]{64})"', resource).group(1)
            records.append({'package': 'poppler-data', 'version': '0.4.12',
                            'url': data_url, 'sha256': data_sha,
                            'archive': data_url.rsplit('/', 1)[-1]})
    return graph, records


def fetch_sources():
    _, records = inventory()
    SOURCE_CACHE.mkdir(parents=True, exist_ok=True)

    def fetch(record):
        target = SOURCE_CACHE / record['archive']
        if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != record['sha256']:
            temporary = target.with_suffix(target.suffix + '.download')
            subprocess.run(['curl', '-fsSL', '--retry', '2', '--connect-timeout', '15',
                            '--max-time', '180', record['url'], '-o', str(temporary)], check=True)
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != record['sha256']:
                raise RuntimeError(f'Source checksum mismatch: {record["package"]}')
            temporary.replace(target)
        print(f'Verified source: {record["package"]}', flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(fetch, records))


def prepare(stage):
    graph, records = inventory()
    base = stage / 'runtime/pdf'
    (base / 'bin').mkdir(parents=True)
    (base / 'lib').mkdir()
    notices = stage / 'licenses/pdf'
    sources = stage / 'third-party-sources/pdf'
    notices.mkdir(parents=True)
    sources.mkdir(parents=True)
    names = {}
    for path in graph:
        if path.name in names and names[path.name] != path:
            raise RuntimeError(f'Duplicate library basename: {path.name}')
        names[path.name] = path
    destinations = {path: base / ('bin' if path.name in TOOLS else 'lib') / path.name for path in graph}
    for path, destination in destinations.items():
        shutil.copy2(path, destination)
        destination.chmod(0o755)
    for path, destination in destinations.items():
        for old, target in graph[path]:
            new = '@loader_path/' + ('../lib/' if path.name in TOOLS else '') + target.name
            subprocess.run(['install_name_tool', '-change', old, new, str(destination)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if path.name not in TOOLS:
            subprocess.run(['install_name_tool', '-id', '@loader_path/' + path.name, str(destination)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    poppler = next(Path(record['root']) for record in records if record['package'] == 'poppler')
    shutil.copytree(poppler / 'share/poppler', base / 'share/poppler')
    # Poppler embeds its data directory rather than honoring an environment
    # override. Keep the binary length unchanged and run the child in base/.
    old = str(poppler / 'share/poppler').encode()
    library = destinations[next(path for path in graph if path.name.startswith('libpoppler.'))]
    data = library.read_bytes()
    if old not in data:
        raise RuntimeError('Poppler data-directory constant was not found')
    library.write_bytes(data.replace(old + b'\0', b'share/poppler' + b'\0' * (len(old) + 1 - len(b'share/poppler'))))
    for destination in destinations.values():
        subprocess.run(['codesign', '--force', '--sign', '-', str(destination)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _, dependency in dependencies(destination):
            if not dependency.is_relative_to(base.resolve()):
                raise RuntimeError(f'Nonportable dependency: {dependency}')
    (base / 'fonts.conf').write_text('''<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><dir>/System/Library/Fonts</dir><dir>/Library/Fonts</dir>
<dir prefix="xdg">fonts</dir><cachedir prefix="xdg">fontconfig</cachedir></fontconfig>
''')
    for record in records:
        archive = SOURCE_CACHE / record['archive']
        if not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest() != record['sha256']:
            raise RuntimeError('Fetch matching PDF sources first: python3 plugin/desktop-pdf.py --fetch-sources')
        shutil.copy2(archive, sources / archive.name)
        if 'recipe' not in record:
            continue
        shutil.copy2(record['recipe'], sources / Path(record['recipe']).name)
        root = Path(record['root'])
        for path in root.rglob('*'):
            if path.is_file() and path.name.lower().split('.')[0] in {'license', 'licence', 'copying', 'copyright', 'notice', 'authors'}:
                target = notices / record['package'] / path.relative_to(root)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
    public = [{k: v for k, v in record.items() if k not in {'root', 'recipe'}} for record in records]
    (sources / 'sources.json').write_text(json.dumps(public, indent=2) + '\n')
    shutil.copy2(__file__, sources / 'desktop-pdf.py')
    (sources / 'README.md').write_text('''# PDF component sources and build information

These archives match the installed Homebrew versions used for this package;
SHA-256 values and origin URLs are in sources.json. Installed Homebrew recipes
record their source build options. Source archives include their license texts.
Binary notices are also under licenses/pdf/. The MarkAtlas MIT license does not
replace the licenses of Poppler or its dependencies.

The relocation script desktop-pdf.py copies the installed binaries, rewrites
Mach-O library references to contained @loader_path references, changes Poppler's
embedded data directory from the installed Homebrew path to share/poppler with
NUL padding, copies encoding data, and applies local ad-hoc signatures. MarkAtlas
runs the PDF subprocess in runtime/pdf/ with its bundled fontconfig file.
No publisher signing identity or Apple notarization is provided by ad-hoc signing.

To reproduce: build/install the recorded package versions using their matching
recipes and upstream sources on macOS arm64, then run the MarkAtlas desktop
packaging script. The bundled recipes identify additional build dependencies.
Do not substitute different versions without regenerating sources and notices.
''')
    return len(graph)


if __name__ == '__main__':
    if sys.argv[1:] == ['--fetch-sources']:
        fetch_sources()
    else:
        raise SystemExit('Usage: python3 plugin/desktop-pdf.py --fetch-sources')
