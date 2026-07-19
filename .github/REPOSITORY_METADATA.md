# GitHub repository metadata

This file is the local review source for the public repository settings. Apply it only after the owner approves publication.

## Recommended repository settings

- **Name:** `vocaloid-mcp`
- **Visibility:** Public
- **Default branch:** `main`
- **About:** `An agent-native MCP for composing, tuning, rendering, mixing, and auditing native VOCALOID3/4 projects — built just for fun.`
- **Website:** none
- **Issues:** enabled
- **Discussions:** optional; useful if the repository attracts music/agent workflow experiments
- **Wiki:** disabled; durable documentation belongs in `notes/` and `blogs/`
- **Projects:** disabled initially
- **License:** no license selected; default copyright applies unless the owner adds one before publication

## Recommended topics

```text
vocaloid
vocaloid3
vsqx
mcp
model-context-protocol
ai-agents
music-production
computer-music
generative-music
audio-engineering
typescript
codex
```

## Publication gate

Before creating or pushing the public repository:

1. obtain explicit owner approval of the final diff, commit list, README, blogs, and release tag;
2. confirm whether to keep the current no-license/default-copyright state or add a source-code/documentation license;
3. verify that `artifacts/songs/`, `artifacts/evals/`, and `build/` are absent from the Git index;
4. run the full test suite and a tracked-file secret/path scan;
5. confirm that no voicebank data, activation data, local corpus files, final WAVs, or transient Editor artifacts are tracked;
6. create the public repository without auto-generating a README, license, or `.gitignore` that would conflict with this tree;
7. push `main` and the approved annotated release tag.

No GitHub repository creation, metadata write, push, release, or publication is authorized merely by this file.
