"""Build a load-unpacked/store-upload ZIP with manifest.json at its root."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'extension/manifest.json').read_text())['version']
(root / 'dist').mkdir(exist_ok=True)
output = root / 'dist' / f'tab-workbench-{version}.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted((root / 'extension').rglob('*')):
        if path.is_file() and not path.name.startswith('.'):
            archive.write(path, path.relative_to(root / 'extension'))
with ZipFile(output) as archive:
    assert 'manifest.json' in archive.namelist()
    assert archive.testzip() is None
print(output)
