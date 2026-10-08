from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
(root/'dist').mkdir(exist_ok=True)
with ZipFile(root/'dist/tab-workbench-0.1.0.zip','w',ZIP_DEFLATED) as archive:
 for path in (root/'extension').rglob('*'):
  if path.is_file(): archive.write(path,path.relative_to(root/'extension'))
print(root/'dist/tab-workbench-0.1.0.zip')
