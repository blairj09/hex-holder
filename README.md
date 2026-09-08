# Hex Sticker Holder

Hex Sticker Holder is a browser tool and a parametric CAD model for printable hex sticker holders.

Use the browser tool to set the holder size, add lid artwork, inspect the model, and download STL files.
Use the Python model to create STEP and STL files from the command line.

[Open the browser tool](https://hex-sticker-holder.james-m-blair09.chatgpt.site)

## Repository layout

| Path | Purpose |
| --- | --- |
| `web-customizer/` | The browser tool. It creates models and STL files in the browser. |
| `hex_sticker_holder.py` | The Build123d command-line model. |
| `hex-sticker-holder.scad` | The source OpenSCAD model. |

## Use the browser tool

The browser tool needs Node.js 22.13 or later.

```sh
cd web-customizer
npm ci
npm run dev
```

Open the local address that the development server shows.

Use these commands before you publish a change:

```sh
npm run lint
npm run test:model
npm run build
```

## Lid artwork

You can choose an SVG from the logo browser or upload your own SVG.

- Catalog logos remove their badge background. The tool simplifies dense artwork for a reliable 0.2 mm print modifier.
- Uploaded SVG files keep every filled contour. The tool converts the artwork to black.
- In the assembled preview, select the artwork to show its controls. Drag it to move it. Use a corner to scale it. Use the round handle to rotate it.
- Press Delete or Backspace to remove selected artwork.

The STL download includes the holder and, when artwork is present, an aligned 0.2 mm lid modifier.

## Use the Build123d model

The command-line model needs Python 3.10 through 3.13 and [uv](https://docs.astral.sh/uv/).

```sh
uv sync
uv run python hex_sticker_holder.py
```

The command writes body and lid STEP and STL files to `build/`.

Set the holder size with these options:

```sh
uv run python hex_sticker_holder.py --void-width 50 --void-depth 35 --part body
```

Use `--emboss` for raised honeycomb. Use `--no-texture` for a smooth holder.

Run the following command for all options:

```sh
uv run python hex_sticker_holder.py --help
```

## License

This repository does not include a license. Get permission before you reuse its code or design files.
