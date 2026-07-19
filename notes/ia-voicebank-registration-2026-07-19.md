# IA voicebank registration and identity verification

Date: 2026-07-19

## Reported symptom

The local VVD scanner listed both IA (`BLRGDDR4M3WM2LC6`) and IA_ROCKS
(`BDREB7P2KTWKYDC5`), while VOCALOID3 Editor exposed only IA_ROCKS.

File discovery was not sufficient evidence. Both voicebank directories already
contained VVD, DDI, and large DDB files, and both had `INSTALLED=1` registry
entries. The differentiating evidence was the 32-bit VOCALOID3 VOICE3
registration: IA's activation-time marker was initially all zero while
IA_ROCKS had a non-zero marker. The IA entry later changed to a non-zero marker,
and IA appeared in Editor. No repository script, bundled activation executable,
registry token copying, or license bypass was used by this investigation.

## False-positive probe discovered

An old readiness cache had marked IA and IA_ROCKS verified even though their
one-note probe WAVs had exactly the same SHA-256. A non-silent render alone
therefore did not prove singer identity; it could accept silent substitution or
fallback.

The probe now adds two bounded guards:

1. inspect only the presence of the 32-bit installed/path/activation-time/key
   markers before launching Editor, without returning marker values;
2. reject a render as `voice identity unverified` when a different component on
   the same Editor/helper fingerprint has an exactly identical probe WAV digest.

An absent registry tool yields `indeterminate` rather than inventing an
activation conclusion. Only explicit missing/incomplete registration blocks the
render early.

## Current real-Editor evidence

After IA appeared in Editor, both voices were force-probed through the original
VOCALOID3 Editor with the same locked Japanese phoneme, pitch, duration, and
export path:

| Voice | Status | Duration | WAV SHA-256 |
|---|---|---:|---|
| IA | verified | 4.017052 s | `d0a764f138f3ecbd3e344a56232c4183a3fb03cb55dfebdd39295f0ae2a96f81` |
| IA_ROCKS | verified | 4.017052 s | `cfd5cf73c3f58c5fff51da9756775480a992fa9239df2b6d2f313f4bffa1c444` |

The distinct digests, together with non-silent real-Editor export and active
registry markers, support that IA is now actually selected rather than falling
back to IA_ROCKS. The first immediate IA_ROCKS control attempt hit an Editor
teardown race (`wait_for_editor`); after terminating the lingering process, the
isolated retry passed. This remains a separate lifecycle issue and does not
change either voicebank result.

Discovery now also lists `IA_Alpha_TypeC_trial` with component
`BMMK9E86G4RPWMB3`. Its VVD and all bounded registry markers are active, so it
is the third visible singer. Two isolated render attempts reached the legacy
Save dialog without a singer-unavailable warning, but both failed at the known
`set_save_filename` UI Automation boundary before a WAV was committed. Its
current status is therefore **registration active, render identity
inconclusive**—not unavailable and not verified. Do not select the trial bank
for unattended production until a clean probe produces a distinct digest.

## If the symptom returns

Do not copy another singer's registry values and do not use untrusted activation
tools. Check VVD metadata, the 32-bit VOICE3 entry, and the legitimate installer
or license-manager state separately; then force-probe both IA and IA_ROCKS and
require non-silent, distinct output digests.
