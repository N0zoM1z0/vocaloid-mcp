# Final VSQX delivery projects

Each project here has the same basename as its QC-passed final WAV in
`../songs/`. The style-evaluation runner publishes a pair only after verifying
the current manifest artifacts, source SHA-256 values, and any pre-existing
targets. A same-name file with different bytes is never overwritten.

Repository policy: this `artifacts/vsqxs/` directory is intentionally eligible
for Git tracking and publication. The sibling `artifacts/songs/` directory is
local-only, ignored in its entirety, and must not be published with the repo.

| Final project | Manifest source revision | Composition SHA-256 | VSQX SHA-256 | Bytes |
| --- | ---: | --- | --- | ---: |
| `hanairo-biyori-wa-rock-ia-rocks-final.vsqx` | 16 | `03c7bbbaff9de2ca2d1ce19d282f6a86c99afc4a181ca5204e40e455fdd6db4f` | `81e9ad994d87d05658f520a95a56fceedecfcb2466dbed9e724bb0399e5bc153` | 383,831 |
| `hibana-kouro-ia-rocks-j-rock-final.vsqx` | 19 | `40a34c0310e57e7280ab5d37c7f35d14b33d89e7f44bb4eebf1bbcacd86458c6` | `e3edbac8b4752b74c577c20aeb7c7e3d8b021166d218f74c41335d51d0f80c9d` | 204,646 |
| `natsu-no-yoru-ia-rocks-dream-pop-final.vsqx` | 19 | `6c4e9cff8f3d37d6e23fae300416356ed775d3c7893194637bd594422305115b` | `7d08bd7761b98dde8b887ed83a2ee59a9427eb61d19bd575fbb1164ef4e7466e` | 193,720 |

These VSQX files preserve the current vocal composition, IA_ROCKS binding,
native tuning, vocal mixer state, and the backing WAV reference used at build
time. VSQX does not embed referenced audio. On this workstation the backing
artifacts remain under `../evals/` at the paths recorded in each project and
canonical manifest.

The final WAV is subsequently assembled from isolated vocal/instrument stems
and processed through the manifest's reproducible mix/master chain. Therefore
opening the VSQX proves and exposes the native score, but the VSQX alone is not
a container for the final WAV's downstream stem effects and mastering.
