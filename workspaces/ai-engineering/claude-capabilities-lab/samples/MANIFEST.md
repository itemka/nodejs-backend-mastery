# Sample Asset Manifest

Committed fixtures for the capability-lab scenarios. The files are real PNG, PDF, CSV, and text payloads — agents should consult this manifest **before** opening any binary, PDF, image, large CSV, or generated output in this workspace, and prefer passing paths to the scenario CLI documented in [../README.md](../README.md) over loading the bytes into context.

## Files

| Path                  | Type       | ~Size             | Purpose / When To Open                                                                                                             |
| --------------------- | ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `data/streaming.csv`  | CSV        | 25 KB (501 lines) | Streaming-churn dataset for the Files API upload scenarios (`files upload`, `files chat`). Open only to verify the column schema.  |
| `documents/earth.pdf` | PDF        | 866 KB            | PDF fixture for `cache`, `citations`, `pdf`, and document-vision scenarios. Pass the path to the scenario CLI — do not Read it.    |
| `images/prop1.png`    | PNG image  | 710 KB            | Property photo used by vision and multimodal scenarios.                                                                            |
| `images/prop2.png`    | PNG image  | 712 KB            | Property photo used by vision and multimodal scenarios.                                                                            |
| `images/prop3.png`    | PNG image  | 716 KB            | Property photo used by vision and multimodal scenarios.                                                                            |
| `images/prop4.png`    | PNG image  | 1.2 MB            | Property photo used by vision and multimodal scenarios (largest sample image).                                                     |
| `images/prop5.png`    | PNG image  | 648 KB            | Property photo used by vision and multimodal scenarios.                                                                            |
| `images/prop6.png`    | PNG image  | 687 KB            | Property photo used by vision and multimodal scenarios.                                                                            |
| `images/prop7.png`    | PNG image  | 724 KB            | Property photo used by vision and multimodal scenarios.                                                                            |
| `text/temp.txt`       | UTF-8 text | 25 KB (549 lines) | Long prompt fixture used by citations and text-document scenarios. Snippet-read with `offset` / `limit` when inspection is needed. |

Combined sample payload: roughly 6.5 MB across 10 files. Treat the whole directory as on-demand context.

## Agent Guidance

- Inspect this manifest before opening any file under `samples/`. If the task only needs a path, do not load the bytes.
- Keep these files in place — they are valid project fixtures referenced from [../README.md](../README.md) and [../tests](../tests).
- Generated outputs under [../outputs](../outputs) are gitignored and should also be left unread by default.
- When replacing a fixture with a personal asset (per [../README.md](../README.md)), update the matching row in this manifest so size and purpose stay accurate.
