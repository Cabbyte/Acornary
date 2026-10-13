"""Build two snapshot-importable Skills. Does not install or publish them."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
out = root / 'output' / 'intake-skills'
out.mkdir(parents=True, exist_ok=True)
for name in ('acornary-intake', 'acornary-catalog-governance'):
    source = root / 'plugin' / 'skills' / name / 'SKILL.md'
    with ZipFile(out / f'{name}-v1.zip', 'w', ZIP_DEFLATED) as archive:
        archive.write(source, f'{name}/SKILL.md')
    print(out / f'{name}-v1.zip')
