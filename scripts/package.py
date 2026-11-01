"""Package public/ only, using portable ZIP names and no private game artifacts."""
from pathlib import Path
import hashlib,json,zipfile

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public'
DIST=ROOT/'dist'
DIST.mkdir(exist_ok=True)
files=sorted(p for p in PUBLIC.rglob('*') if p.is_file())
for path in files:
    assert not path.is_symlink()
    assert path.suffix.lower() not in {'.sav','.pem','.key','.pfx','.uasset','.uexp','.ubulk','.ucas','.utoc','.pak'}
    assert path.name not in {'source.zip','upstream-source.tar.gz'}
    assert path.read_bytes().decode('utf8'), 'This distribution uses text files, including embedded WASM JS'
archive=DIST/'PBZItemlist.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for path in files:z.write(path,path.relative_to(PUBLIC).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert all('\\' not in name and not name.startswith('/') and '..' not in Path(name).parts for name in z.namelist())
print(json.dumps({'archive':str(archive),'files':len(files),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
