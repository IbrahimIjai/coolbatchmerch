# Naija Threads — Nigeria @ 66 rack

An interactive clothing-rack portfolio for a Nigeria @ 66 independence capsule:
heavyweight tees hanging side-on along a chrome rail, built
with Nuxt, Nuxt UI and Three.js.

- **Hover** a piece and a hand turns its hanger to face you; only the pieces it
  bumps slide aside. Its name appears beneath it.
- **Click** to open it larger. It gives a full 360° twirl on its hanger; drag
  to spin it yourself, arrows (or ← →) to browse, Esc to close.
- **Drag** a piece to move it: the hook lifts off the rail, you carry it in
  front of the others, and it is lowered back where you let go. Neighbours shuffle
  along just enough to make room, and stay where they were pushed. On touch,
  press and hold to pick a piece up; swipe to pan the rail.
- **Brush** the cursor through the rail and the fabric moves like it would
  under a hand.

## Run it

```bash
bun install
bun run dev        # http://localhost:3000
```

| Script | |
| --- | --- |
| `bun run dev` | Development server |
| `bun run build` / `bun run preview` | Production build and local preview |
| `bun run lint` / `bun run typecheck` | ESLint and vue-tsc |
| `bun run render:artwork` | Re-export print artwork from `design/artwork.html` (needs Chrome) |

## Change the collection

Everything on the rack comes from **`app/data/products.ts`**:

```ts
{
  id: 'sixty-six-tee',
  name: 'Sixty-Six Tee',
  label: 'Black',
  garment: 'tee',               // the 3D garment model
  color: '#161618',             // fabric colour
  image: '/merch/sixty-six.png',// transparent print artwork in /public
  placement: 'chest',           // 'chest' | 'pocket' | 'full' (all-over)
  url: 'https://…'              // optional product page for "See availability"
}
```

Studio name, contact details, ticker text and About copy live in
**`app/data/site.ts`**. Without a `url`, "See availability" emails the studio.

Print artwork is authored in `design/artwork.html` (SVG + Google Fonts) and
exported to `public/merch` with `bun run render:artwork`. Any transparent PNG or
SVG works as a print — drop it in `public/merch` and point a product at it.

## How the garments work

The garments are built from a real 3D clothing model (`public/models`), reshaped in the
browser to hang on a hanger: the torso is widened to lie flat, front and back
pressed into two thin layers (held apart only where the hanger fills the
shoulders), turned-under hems tucked inside, the sleeves swung down and the
shoulders fitted over a wooden hanger. Fabric colours and prints are projected
onto the front and back, with a cotton sheen and a fine knit texture. The
models' own wrinkle maps are not used — they describe a shirt worn on a body —
folds come from the cloth simulation instead. Adding another garment type means
adding a model to `public/models` and an entry to `SOURCES` in
`app/lib/three/garment.ts`.

Motion is simulated, not keyframed:

- **Hangers** are damped pendulums hanging from their hooks (real-scale gravity,
  ~1.4 s period). Sliding, carrying, bumping and turning all drive the swing.
- **The rail** resolves collisions in one dimension: each piece takes up only
  the room its current angle needs, so a turned or newly hung piece pushes its
  immediate neighbours and nothing further unless they touch.
- **Fabric** is a position-based cloth sim (Verlet + distance constraints)
  pinned along the shoulders. Its rest shape includes natural hanging folds, so
  folds are real geometry that trails, twists and resettles (a quick hover turn
  leaves the hem ~8 cm behind). Tethers stop cotton sagging under its own
  weight; bending links keep folds smooth. The detailed mesh is deformed on the
  GPU, and settled cloth sleeps, riding along with its hanger until disturbed.

| File | |
| --- | --- |
| `app/lib/three/garment.ts` | Loads and reshapes the models; paints fabric and prints |
| `app/lib/three/cloth.ts` | Cloth solver and GPU binding |
| `app/lib/three/rack.ts` | The rail: pendulum hangers, collisions, hover, drag, brushing |
| `app/lib/three/viewer.ts` | The overlay viewer: twirl, spin, slide between pieces |
| `app/lib/three/assets.ts` | Shared materials and the `HangingGarment` (hanger + cloth) |
| `app/lib/three/hardware.ts` / `stage.ts` | Rail, hangers, lights, renderer |
| `app/components/*` | Header, ticker, rack, overlay, About/Contact panels |

Three.js only runs in the browser (`.client.vue` components, loaded lazily).
Without WebGL the rack falls back to flat garment cut-outs, and reduced-motion
settings calm the swaying. Every piece is also reachable from the keyboard.

## Credits

3D model, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) — re-posed,
simulated and re-textured (details in `public/models/CREDITS.md`):

- “[Basic T-Shirt](https://sketchfab.com/3d-models/basic-t-shirt-71bdf5940b5d41b8b46628a615e9b0ed)” by [MadeByYeshe](https://sketchfab.com/MadeByYeshe)

The attribution also appears in the site's About panel, which CC BY requires
wherever the site is shared.
