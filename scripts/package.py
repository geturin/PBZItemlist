"""Package public/ only, using portable ZIP names and no private game artifacts."""
from pathlib import Path
import hashlib,json,zipfile

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public'
DIST=ROOT/'dist'
DIST.mkdir(exist_ok=True)
# Keep the previous derived meshes available for source regression only.
# No v2.1 route requests them, and they must never inflate the published site.
files=sorted(p for p in PUBLIC.rglob('*') if p.is_file() and p.relative_to(PUBLIC).parts[:2] != ('data','terrain'))
for path in files:
    assert not path.is_symlink()
    assert path.suffix.lower() not in {'.sav','.pem','.key','.pfx','.uasset','.uexp','.ubulk','.ucas','.utoc','.pak'}
    assert path.name not in {'source.zip','upstream-source.tar.gz'}
    if path.suffix.lower() not in {'.gz','.bin','.glb','.png','.jpg','.webp','.ico','.wasm'}:
        assert path.read_bytes().decode('utf8'), 'Text assets must use UTF-8'
archive=DIST/'PBZItemlist.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for path in files:z.write(path,path.relative_to(PUBLIC).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    names=z.namelist()
    assert not any(name.startswith('data/terrain/') for name in names),'Legacy meshes must not be published'
    normalized={name.casefold() for name in names}
    assert len(normalized)==len(names),'Case-insensitive duplicate ZIP names'
    assert all('\\' not in name and ':' not in name and not name.startswith('/') and '..' not in Path(name).parts for name in names)
    assert all(parent.as_posix().casefold() not in normalized for name in names for parent in Path(name).parents if parent.as_posix()!='.'),'File/directory path conflict'
print(json.dumps({'archive':str(archive),'files':len(files),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
