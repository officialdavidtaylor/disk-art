"""Independent filesystem verification. pip install pycdlib first."""
import io
import os
import sys
import pycdlib

path = sys.argv[1]
iso = pycdlib.PyCdlib()
iso.open(path)
assert iso.pvd.volume_identifier.rstrip() == b"DVD_ART"
assert iso.pvd.space_size * 2048 == os.path.getsize(path)
files = []
for _, _, names in iso.walk(iso_path="/"):
    files.extend(names)
assert sorted(files) == ["README.TXT;1", "WEBSITE.URL;1"], files
for name in files:
    output = io.BytesIO()
    iso.get_file_from_iso_fp(output, iso_path="/" + name)
    assert b"https://dvd-art.emfsoft.com" in output.getvalue()
    print(name, len(output.getvalue()), "bytes: OK")
iso.close()
print("ISO9660 volume and all readable files verified.")
