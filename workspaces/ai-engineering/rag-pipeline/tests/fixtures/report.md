# Default Report

This file is loaded by `POST /ingest` when no `sourcePath` is provided. It
exists so the test suite can exercise the documented default behavior.

## Default Section

The default ingest path should resolve `report.md` directly inside the
configured `allowedDocumentRoot`, not inside a nested `sample-documents/`
subdirectory.
