# Hex sticker holder — Build123d edition

`hex_sticker_holder.py` is a parametric Build123d translation of the supplied
OpenSCAD model.  It generates the same two printable solids: a textured body
with a chamfered internal pocket and snap groove, plus a flanged lid with a
tapered, beaded plug.

Use [UV](https://docs.astral.sh/uv/) to create the project environment and
export the default model:

```sh
uv sync
uv run python hex_sticker_holder.py
```

This writes `hex-sticker-holder-body.step`, `hex-sticker-holder-body.stl`,
`hex-sticker-holder-lid.step`, and `hex-sticker-holder-lid.stl` in `build/`.
The default void is 46 mm flat-to-flat and 30 mm deep.  These are the two
dimensions that control the design; the shell, lid, texture, chamfers, and
snap fit retain their source-model proportions.

```sh
# Change the core dimensions and export just the body
uv run python hex_sticker_holder.py --void-width 50 --void-depth 35 --part body

# Raised honeycomb instead of engraved honeycomb
uv run python hex_sticker_holder.py --emboss

# A clean, untextured holder
uv run python hex_sticker_holder.py --no-texture
```

Use `--part both_exploded` to export one combined STEP/STL assembly with the
lid positioned above the body.  Run `uv run python hex_sticker_holder.py
--help` for the complete command line interface.

## Browser customizer

`web-customizer/` contains a local, browser-only configurator. One parametric
Three.js mesh powers both the rotatable live model and direct binary STL export,
so updates and downloads do not require OpenSCAD, Python, a server-side CAD
process, or WebAssembly. Sticker capacity is selectable in 25, 50, 75, or 100
sticker increments, using 0.25 mm of stack space per sticker. The complete lid
stays 6 mm tall at every capacity: a 1.6 mm flange plus a 4.4 mm plug. The body
adds that fixed 4.4 mm intrusion above the selected sticker space.

```sh
cd web-customizer
npm run dev
```

Run `npm run test:model` to smoke-test the default and boundary configurations,
including watertight component meshes and binary STL structure.
