# The UI chrome is licensed art, and it is not in this repo

Skippidy Skip's interface is skinned with **"GUI - Casual Blue"** by
[LayerLab](https://layerlab.itch.io/gui-vertical-casual), bought under their
standard asset licence: we may use it in the team's products, but we may not
redistribute the raw files. The team's copy lives in the private
[ai-asylum/casual-blue-ui](https://github.com/ai-asylum/casual-blue-ui) repo,
whose own NOTICE says plainly that the art must not be copied into a public
repository.

**This repository is public.** So `public/cb/` is git-ignored and no LayerLab
PNG is committed here. Shipping the built game is fine — that is a product, and
a product is what the licence is for.

## Getting the chrome

```sh
git clone git@github.com:ai-asylum/casual-blue-ui.git ../casual-blue-ui
npm run cb:sync
```

`scripts/sync-cb.mjs` copies the ~70 sprites the game actually uses into
`public/cb/` and regenerates `src/cb/manifest.js` and `src/cb/cb.css`. Set
`CB_KIT` if your clone is somewhere else.

Those two generated files **are** committed, on purpose. They hold ids, pixel
sizes, slice insets and urls — numbers we wrote about the art, not the art —
so a clone without kit access still installs, builds and diffs normally. It
just renders untextured chrome until someone runs the sync. `npm test` says so
rather than leaving you to wonder.

## Rules the art needs to look right

Both come from the kit and are easy to break by accident:

- **Never scale-transform a nine-slice.** It re-rasterises and hairline seams
  appear along the joins. Animate a wrapper with `translate`/`opacity` instead.
- **Never render a sprite above 0.5× its source size.** The pack is drawn for a
  720-wide canvas against a 360-wide stage; above that it goes soft.

Nine-slices stretch their middle at any size, so panels and buttons can still be
as fluid as the layout wants — it is only fixed-size sprites (icons) that the
0.5× ceiling actually constrains.

## Fonts

[Lilita One](https://fonts.google.com/specimen/Lilita+One) (the pack's own
display face) and Baloo 2, both OFL, both from Google Fonts.
