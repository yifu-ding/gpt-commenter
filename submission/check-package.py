"""Check the actual upload ZIP. Passing structure is not portal approval."""
import json
import struct
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse

archive = Path(sys.argv[1])
issues = []
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    names = set(z.namelist())
    m = json.loads(z.read('plugin.json'))
    e = m['extensions']['com.openai']
    i = e['interface']
    assert m['$schema'] == 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
    assert 'interface' not in m and '.app.json' not in names
    assert m.get('apps') is None and e.get('apps') is None
    for key, limit in [('displayName',30),('shortDescription',30),('longDescription',4000),('developerName',80)]:
        assert isinstance(i[key], str) and 0 < len(i[key]) <= limit, key
    assert i['category'] == 'Productivity'
    for key in ['websiteURL','supportURL','privacyPolicyURL','termsOfServiceURL']:
        url = urlparse(i[key])
        assert url.scheme == 'https' and url.hostname and not url.username and len(i[key]) <= 1024, key
    for key in ['logo','composerIcon','logoDark']:
        data = z.read(i[key].removeprefix('./'))
        assert data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) <= 5*1024*1024, key
        width, height = struct.unpack('>II', data[16:24])
        assert width == height and width >= (256 if key != 'composerIcon' else 48), key
    review = e['review']
    cases = review['test_cases']
    assert len(cases['positive']) == 5 and len(cases['negative']) == 3
    for group, items in cases.items():
        for case in items:
            for field in ['description','prompt'] + (['tools_triggered','expected_behavior'] if group == 'positive' else []):
                assert isinstance(case[field],str) and case[field].strip(), field
    assert review['commerce'] is False
    assert e['publication']['countries'] == [], 'Worldwide availability must remain unrestricted'
    assert e['publication']['release_notes'].strip()
    assert json.loads(z.read('mcp.json'))['mcpServers']['gpt-commenter']['command'] == './runtime/node'
    for name in ['runtime/node','runtime/pdf/bin/pdftotext','runtime/pdf/bin/pdftocairo','runtime/pdf/bin/pdftoppm','review-fixtures/review.pdf','third-party-sources/pdf/sources.json']:
        assert name in names, name
    if not review.get('demo_recording_url'):
        issues.append('Missing verified demo recording URL')
    print(json.dumps({'archive':str(archive),'archive_bytes':archive.stat().st_size,
                      'structural_checks':'passed','submission_ready':False,
                      'remaining_package_items':issues,
                      'external_checks':['Verify public listing and fixture URLs after publishing',
                        'Run 5 positive and 3 negative review cases in the exact installed host version',
                        'Verify publisher identity and local-MCP organization allowlisting',
                        'Complete portal validation, scans and authorized developer attestations']},indent=2))
if '--require-ready' in sys.argv and issues:
    raise SystemExit(1)
