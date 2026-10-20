# Lightmap gain: what the executable does (×1; brightness is a gamma ramp)

Date: 2026-10-20 · Agent: Claude Code · Commit: Lightmap gain read from the renderer: ×1 at default brightness, the ×2 kept for the user to decide

## Why
Fidelity stand-in: the ×2 lightmap gain was set by eye.

## Decisions and evidence
- gfx_d3d.dll:
  - The two-pass lightmap blend is SRCBLEND DESTCOLOR (9), DESTBLEND ZERO (1) at 0x1000498C.
  - The dual-texture path sets stage 1 COLOROP MODULATE (4), args TEXTURE × CURRENT
    (0x10004355–0x10004390). No MODULATE2X anywhere (SetTextureStageState = vtable +0xA0).
  - Lightmap texels are copied raw (rep movsd, 0x10007BD1) into the LM surfaces.
- The only brightening is **the Brightness option** (string 1705):
  - `0x42D250(b)`: γ = clamp(2b + 0.5, 0.5, 2.5); the ramp is ramp[i] = (i/256)^(1/γ) × 65536,
    sent to `GFXDLL_SetGammaNormalized` (DLL 0x100017A0, SetGammaRamp on R, G and B alike).
  - The default b = 0.25 (0x4A20AB) gives γ = 1, the identity. The user's
    `Gamers/latest.cfg` (brightness float at byte 17) holds 0.25.
  - So the original draws ×1 as configured. Brightness 1 gives out = in^0.4, about ×2 on dark
    values, which is close to the ×2 we draw.

## Deviations from the original
- `LIGHTMAP_GAIN = 2` stays, approved by the user by eye, until they decide. The faithful
  alternative is ×1 plus a Brightness option that applies the same ramp (a post-process power
  curve).

## How to verify
- Disassemble the DLL with capstone at the addresses above (SetRenderState = vtable +0x58).
