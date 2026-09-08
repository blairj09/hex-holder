# Hex Sticker Holder

Hex Sticker Holder creates printable STL files for hex sticker holders in your browser.

## Start

The app needs Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

Open the local address that the development server shows.

## Commands

```sh
npm run lint
npm run test:model
npm run build
```

## Lid artwork

You can choose an SVG from the logo browser or upload your own SVG.

- Catalog logos remove their badge background. The app simplifies dense artwork for a reliable 0.2 mm print modifier.
- Uploaded SVG files keep every filled contour. The app converts the artwork to black.
- In the assembled preview, select the artwork to show its controls. Drag it to move it. Use a corner to scale it. Use the round handle to rotate it.
- Press Delete or Backspace to remove selected artwork.

The STL download includes the holder and an aligned 0.2 mm lid modifier when artwork is present.

## License

This repository does not include a license. Get permission before you reuse its code or design files.
