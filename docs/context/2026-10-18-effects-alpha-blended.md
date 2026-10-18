# Effects alpha blended; SPHERE shapes are camera domes

Date: 2026-10-18 · Agent: Claude Code · Commit: Effects blend as the original renderer: alpha, not additive; SPHERE shapes are domes

## Why
User compared original screenshots: heroism tints Drake blue and Torch Light shows a white flare; ours looked similar but differed in transparency.

## Decisions and evidence
- gfx_d3d.dll sets only SRCALPHA / INVSRCALPHA (and DESTCOLOR / ZERO for lightmaps); stage 0 modulates texture × vertex colour and alpha (executable-analysis §20.2 "Blending").
  - Every effects.stg flash, level glow sprite (Flickerslow / Flare), holy wrath / revelation ring and lightning strip is now NormalBlending. Before, they were additive.
  - This supersedes the "drawn additive" line of 2026-10-18-torch-fire-and-glow-sprites.md.
- SPHERE shapes are camera-facing unit domes (0x004AE480 / 0x004AE7F0), not balls. They are drawn as their sprite pulled their radius toward the camera (`domeBeforeRender`). So heroism's blue covers the body, as in the original.
- Shape colours are converted as sRGB, not linear. The `alphaTest` 0.05 is gone: it cut weak alphas such as heroism's 25/255.
- Torch cast sound checked: 315 / 314 / 313 play their whole length (4.3 s measured at level 3). No second sound in the code: the release's 0x00468F40(500) is a HUD timer. The torch light's flare is the LIGHT_CAST effect rising from 6 ft. Lights (list 0x584FE8) only light model vertices (0x00467EB7); they draw no flare.

## Deviations from the original
- The dome is approximated by a sprite moved toward the camera, not a 3-D dome.

## Not done / not decoded
- Soul drinker's line and snap freeze's glow (stand-ins) stay additive.
- Torch sound "incomplete" (user report): no cause found in code or playback; needs a recording or description.

## How to verify
- `spells-server` + `spells-client`, guest: cast `heroism`, then `torch_light`. Drake turns blue under the domes and a white flare rises above him.
