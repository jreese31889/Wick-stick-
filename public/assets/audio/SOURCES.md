# Sound Effect Sources — John Stick

All files were sourced **2026-10-02** from CC0 (public-domain dedication) releases that
allow direct download without an account. No game code was changed; these are drop-in assets.
The 12 firearm reports were (re)sliced and dropped in **2026-10-03** for the per-class
gun banks — see “Firearms” below.

**Processing applied to every file:** single-event slice/trim → downmix to mono →
44.1 kHz Ogg Vorbis (quality 5) → peak-normalized to −1 dBFS. All files are 5–22 KB.

CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/ — commercial use OK,
no attribution required (credits kept here for provenance).

---

## Firearms — real recordings

Pack: **The Free Firearm Sound Library** — recorded by Ben Jaszczak, Brian Nelson,
Kevin Heras and Matthew Nanney; preserved on OpenGameArt by **bart**. License: **CC0**.
Source page: https://opengameart.org/content/the-free-firearm-sound-library
(archive: `Prepared SFX Library.7z`; weapon/mic details per the included
`Prepared Master Sheet.csv`). Each class's single shots were sliced on silence
boundaries from the multi-shot studio takes → mono 44.1 kHz → loudnorm (peak −1 dB)
→ Ogg Vorbis q5.

`SoundFX.ts` loads these into four banks — `PISTOL` / `SMG` / `SHOTGUN` / `RIFLE` — and
`playGunReport(kind)` only ever picks from the matching bank, so the classes differ by
what was recorded (no pitch shaping, no synthetic layers).

| File | Original | Recording |
|---|---|---|
| `gun_pistol_shot1.ogg` | `1911/A_42P.wav` | Colt 1911, .45 ACP semi-auto pistol — shot 1, near distance, front of shooter |
| `gun_pistol_shot2.ogg` | `1911/A_42P.wav` | Colt 1911, .45 ACP semi-auto pistol — shot 2 (same take, separate shot) |
| `gun_pistol_shot3.ogg` | `1911/A_34P.wav` | Colt 1911, .45 ACP semi-auto pistol — separate take |
| `gun_smg_shot1.ogg` | `G_31P.wav` | Carl Gustav M45 “Swedish K”, 9 mm SMG — shot 1 |
| `gun_smg_shot2.ogg` | `G_31P.wav` | Carl Gustav M45 “Swedish K”, 9 mm SMG — shot 2 |
| `gun_smg_shot3.ogg` | `G_31P.wav` | Carl Gustav M45 “Swedish K”, 9 mm SMG — shot 3 |
| `gun_shotgun_shot1.ogg` | `N_26P.wav` | Mossberg pump shotgun — shot 1 |
| `gun_shotgun_shot2.ogg` | `N_26P.wav` | Mossberg pump shotgun — shot 2 |
| `gun_shotgun_shot3.ogg` | `K_22P.wav` | Winchester Model 12 shotgun |
| `gun_rifle_shot1.ogg` | `C_28P.wav` | AK-47, 7.62×39 — shot 1 |
| `gun_rifle_shot2.ogg` | `C_28P.wav` | AK-47, 7.62×39 — shot 2 |
| `gun_rifle_shot3.ogg` | `C_28P.wav` | AK-47, 7.62×39 — shot 3 |

Retired **2026-10-03**: `gun_pistol_shot4.ogg` (was `Bersa/F_47P.wav`, Bersa .380 ACP,
same pack) — dropped from the pistol bank when the per-class banks landed, so the
pistol plays the three Colt 1911 slices only. The file itself was removed from the repo.

Pack: **Gun reload sounds** by **SpringySpringo**. License: **CC0**.
Source page: https://opengameart.org/content/gun-reload-sounds

| File | Original | Sound |
|---|---|---|
| `sfx_reload.ogg` | `gunreload1.wav` | Full reload foley (magazine out/in + action clicks) |
| `sfx_gun_cock.ogg` | `shotguncock.wav` | Pump-action cock / slide-rack click-clack (gun handling) |

## Melee & impacts

Pack: **Impact Sounds** by **Kenney** (kenney.nl). License: **CC0** (stated in the pack's `License.txt`).
Source page: https://kenney.nl/assets/impact-sounds

| File | Original | Sound |
|---|---|---|
| `sfx_punch_light.ogg` | `impactPunch_medium_000.ogg` | Light jab / quick punch impact |
| `sfx_punch_heavy.ogg` | `impactPunch_heavy_000.ogg` | Heavy punch impact |
| `sfx_kick.ogg` | `impactSoft_heavy_000.ogg` | Heavy soft-body thud (kick) |
| `sfx_glass.ogg` | `impactGlass_heavy_000.ogg` | Glass shatter / break |

Pack: **Thwack Sounds** by **AntumDeluge**. License: **CC0**.
Source page: https://opengameart.org/content/thwack-sounds

| File | Original | Sound |
|---|---|---|
| `sfx_slam.ogg` | `Vorbis/thwack-02.oga` layered under Kenney `impactSoft_heavy_001.ogg` (both CC0) | Body-slam / takedown thud |

Pack: **Swishes Sound Pack** by **artisticdude**. License: **CC0**.
Source page: https://opengameart.org/content/swishes-sound-pack

| File | Original | Sound |
|---|---|---|
| `sfx_whoosh.ogg` | `swish-9.wav` | Melee swing whiff (stronger) |
| `sfx_whoosh2.ogg` | `swish-1.wav` | Melee swing whiff (shorter) |

Pack: **20 Sword Sound Effects (Attacks and Clashes)** by **StarNinjas**. License: **CC0**.
Source page: https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes

| File | Original | Sound |
|---|---|---|
| `sfx_katana_slash.ogg` | `sword.4.ogg` | Katana/sword slash swing |
| `sfx_block.ogg` | `sword_clash.3.ogg` | Blade block / parry clash (trimmed) |

## Knives, objects, UI

Pack: **RPG Audio** by **Kenney** (kenney.nl). License: **CC0**.
Source page: https://kenney.nl/assets/rpg-audio

| File | Original | Sound |
|---|---|---|
| `sfx_knife_throw.ogg` | `drawKnife2.ogg` | Knife draw/throw shing-whoosh |
| `sfx_knife_stab.ogg` | `knifeSlice.ogg` | Knife slice / stab |
| `sfx_door.ogg` | `doorOpen_2.ogg` | Heavy door opening (long creak-open) |
| `sfx_slide.ogg` | `cloth1.ogg` | Cloth/floor scuff for the slide move |

Pack: **80 CC0 RPG SFX** by **SubspaceAudio**. License: **CC0**.
Source page: https://opengameart.org/content/80-cc0-rpg-sfx

| File | Original | Sound |
|---|---|---|
| `sfx_coin.ogg` | `item_coins_01.ogg` | Coin pickup ding |
