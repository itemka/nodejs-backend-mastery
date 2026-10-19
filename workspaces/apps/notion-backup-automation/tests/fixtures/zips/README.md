# ZIP Fixtures

Archives for the ZIP verifier and transfer tests. They are shaped like the Phase 0 export (one
top folder `Export-<uuid>/`, pages named `<title> <32 hex>.md`, deflate, no directory entries,
the UTF-8 flag on non-ASCII names), but hold only made-up text. No real export data is in them.

| File                         | Made with                                                                                         | Expected verdict                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `notion-export.zip`          | Python `zipfile`, script below                                                                    | Valid, 4 files                                      |
| `with-directories.zip`       | Info-ZIP `zip -X -r` over the same tree (directory entries, no UTF-8 flag)                        | Valid, 4 files; directory entries are not counted   |
| `data-descriptors.zip`       | Info-ZIP `zip -X -D -fd -r`: every entry has flag bit 3, like Notion's real ZIP                   | Valid, 4 files                                      |
| `crc-mismatch.zip`           | The script's stored (uncompressed) variant, then one data byte changed (`perl`)                   | Invalid: an entry fails its CRC-32 check            |
| `directory-crc-mismatch.zip` | The script: a file plus a directory entry that carries data, then one byte of it changed (`perl`) | Invalid: the directory entry fails its CRC-32 check |
| `truncated.zip`              | `head -c 1024 notion-export.zip`                                                                  | Invalid: no end-of-central-directory record         |
| `empty.zip`                  | The script: an archive with no entries (22 bytes)                                                 | Invalid: no files                                   |
| `path-traversal.zip`         | The script: a second entry named `../outside.md`                                                  | Invalid: yauzl rejects the entry name               |
| `encrypted.zip`              | Info-ZIP `zip -X -D -P fixture-only` (ZipCrypto)                                                  | Invalid: encrypted entry                            |

The password `fixture-only` protects nothing; it exists only to set the encryption flag.

## Recreating Them

On macOS (Info-ZIP 3.0, Python 3.9, Perl 5), from an empty working directory. Python's
`zipfile` output is byte-for-byte reproducible; the Info-ZIP archives depend on the file times
(set by `touch`), and `encrypted.zip` also on its random encryption header.

```python
# make.py
import zipfile

ROOT = 'Export-00000000-0000-4000-8000-000000000001'
PAGE = f'{ROOT}/Dashboard 0123456789abcdef0123456789abcdef'
LONG = 'A line of a long page, repeated so that the entry spans several read chunks.\n' * 3000
FILES = [
    (f'{PAGE}.md', '# Dashboard\n\nFixture page for the ZIP verifier tests.\n'),
    (f'{PAGE}/Заметки 11111111111111111111111111111111.md', '# Заметки\n\nA page whose name is not ASCII.\n'),
    (f'{PAGE}/Tasks 22222222222222222222222222222222.csv', 'Name,Status\nWrite tests,Done\nShip,Not started\n'),
    (f'{PAGE}/Long page 33333333333333333333333333333333.md', LONG),
]

def write(path, files, method):
    with zipfile.ZipFile(path, 'w') as archive:
        for name, text in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 1, 20, 54, 8))
            info.compress_type = method
            info.external_attr = 0o644 << 16
            archive.writestr(info, text.encode())

write('notion-export.zip', FILES, zipfile.ZIP_DEFLATED)
write('crc-mismatch.zip', FILES[:3], zipfile.ZIP_STORED)
write('empty.zip', [], zipfile.ZIP_STORED)
write('path-traversal.zip', [FILES[0], ('../outside.md', 'Outside the export folder.\n')], zipfile.ZIP_DEFLATED)
write('directory-crc-mismatch.zip', [FILES[0], (f'{PAGE}/', 'A directory entry that carries data.\n')], zipfile.ZIP_STORED)
```

```sh
python3 -I make.py
perl -0777 -pi -e 's/Fixture page/Fixtur3 page/' crc-mismatch.zip
perl -0777 -pi -e 's/carries data/carries dat4/' directory-crc-mismatch.zip
head -c 1024 notion-export.zip > truncated.zip

# The same four files as a directory tree, for Info-ZIP.
export TZ=UTC
root=Export-00000000-0000-4000-8000-000000000001
page="$root/Dashboard 0123456789abcdef0123456789abcdef"
mkdir -p "$page"
printf '# Dashboard\n\nFixture page for the ZIP verifier tests.\n' > "$page.md"
printf '# Заметки\n\nA page whose name is not ASCII.\n' > "$page/Заметки 11111111111111111111111111111111.md"
printf 'Name,Status\nWrite tests,Done\nShip,Not started\n' > "$page/Tasks 22222222222222222222222222222222.csv"
yes 'A line of a long page, repeated so that the entry spans several read chunks.' | head -n 3000 \
  > "$page/Long page 33333333333333333333333333333333.md"
find . -exec touch -t 202610012054.08 {} +
zip -q -X -r with-directories.zip "$root"
zip -q -X -D -fd -r data-descriptors.zip "$root"
zip -q -X -D -P fixture-only encrypted.zip "$page.md"
```

`unzip -t` confirms the three valid archives and reports the CRC errors in `crc-mismatch.zip` and
`directory-crc-mismatch.zip`; it accepts `path-traversal.zip`, whose name only an extracting
reader would refuse.
