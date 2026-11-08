# Eye rig contract

This app proves pupil motion before it calls a character ready. Disabling the gaze control is only what the viewer does when that proof fails. It is not a finished character.

The core repository is not changed here. The other writer owns `products/animind_core` on `feat/animind-core-api`, including `products/animind_core/eyes.py` (the motion mirrored by `lib/eyes.ts`). New generated rigs have to come back in the shape below. This repo then checks them.

## Per supplied view

A view that was not drawn is omitted. Do not invent a 3/4 or a profile.

Layers, RGBA PNG:

- `eye_white`: sclera with no pupil baked in. The current realistic plates still contain the pupil; this app clears that rest position at draw time and does not rewrite the file.
- `iris`: the discs only.
- `eye_socket`: the opening. Opaque pixels (alpha above 32) are the only place the iris may appear. That mask is the occlusion.
- `eyes_half`, `eyes_closed`, brows, visemes, and expressions stay as they are.

`eyeRig` on the view:

- `maxShift`: `[x, y]` canvas pixels at full deflection. `+x` is viewer-right. `+y` is down.
- `irises`: `[[cx, cy, r], ...]` rest positions in canvas pixels.

Limits: the travel actually used is the largest integer shift, starting from at least `[8, 4]` or the published `maxShift`, that keeps at least 75% of the iris alpha inside the socket in both directions. A shift that leaves the mask is not used.

## Ready means a pixel proof

`status: "ready"` on a layered rig is valid only when every supplied face view can do all of this:

- left moves each pupil's centroid left of center
- right moves it right
- up moves it up
- down moves it down
- the five rasters are not the same image
- pixels outside the eye sockets stay put (the head and the canvas do not translate)

A boolean such as `gaze: true` is not that proof. Photo cut-outs (`style: "cutout"`) are jaw rigs, not this contract.

An existing flattened plate can be recovered when two compact eyes can be isolated. That recovery is how the caricature keeps working without a new drawing. A new one-click character is still expected to ship the separate layers. If it does not, `POST /api/characters` leaves it a placeholder.

Applying a paid redraw to the existing packs was not approved and was not run.

## Files in this repo

- `lib/eye-rig.ts` — compose, recovery, travel, and the pixel proof
- `lib/eye-gate.ts` — folder check used before an import is stored as ready
- `lib/png-rgba.ts` — reads the RGBA PNGs for that check
- `lib/accounts/rig.ts` — keeps `eyeRig` when a puppet is loaded
- `lib/accounts/import-character.ts` — holds a new folder at `draft` when the proof fails
- `app/api/characters/route.ts` — holds an unproven one-click rig at `placeholder`
- `lib/engine.ts` — preview render uses the same compose
- `components/avatar-stage.tsx` and `components/composed-character.tsx` — the shared viewer and the movement sheet
- `lib/stage-frame.ts` — full-body frame when a torso or a full plate exists, otherwise the head
- `lib/scenery.ts` — flat-background matte; a failed proof leaves the painted plate
- `lib/sheet.ts` — view, then category, then the states that exist
- `tests/eye-rig.test.ts` — the centroid proof on the existing Einstein files
- `tests/stage.test.ts` — framing, sheet contents, scenery proof, and the control class

## Iris margin

`iris.png` on the realistic pack is a disc on an opaque black rectangle. `composeSeparable` clears only the black that touches the sprite border, then redraws the disc. The pupil stays because the brown iris encloses it. A fractional offset is sampled. The original PNG is not rewritten. Vertical travel on this pack stays 2px because the socket cannot hold more at the coverage limit.

## Framing, sheet, scenery, mouth

The interactive view is first. Full body is the canvas when a torso or a single full plate is already there. Close-up is the head layer, or the eye pair on a plate that has no head layer. Neither framing draws a limb the folder does not contain.

The sheet under the controls uses the same composer. Five gaze cells appear only after the pupils are proved. Emotions and lids appear only when those layers exist. The caricature has no 3/4 views, so the sheet does not show them. Cells share one size, one black ground, and wrap with no empty track.

A scenery control is drawn only when `sceneryMatte` clears a flat border without touching the center. The caricature room does not pass: the shelves are not the wall color, and the suit is close to that wall. The plate stays as painted and the file stays in the pack. The sheet never turns scenery on.

The caricature rest viseme is a dark shape placed below the painted mustache. It is not composited. The smile in `body.png` stays. The viseme files stay.

## Editing one detail

No edit panel is shipped. Deterministic controls already cover gaze, eyelids, emotion, framing, and a scenery toggle when the matte proof passes. They preview in the viewer and do not write a PNG.

A real correction of one region would be a copy of one layer of one view, owned by the account, with the original bytes kept, an in-memory undo, and a save that happens only when the owner asks. The route would have to check that owner the way the library already does. A paid redraw (an image model repairing the mustache, the room, or a side view) is not authorized. It must not run from the preview, and it must not run because a control was opened.
