/**
 * The collection on the rack. Edit, reorder or swap designs here — everything
 * else (rack, modal, labels, counter) is driven by this array.
 *
 * - `garment`   picks the generated 3D silhouette and hanger ('tee' | 'shorts').
 * - `color`     is the fabric colour behind the print.
 * - `image`     is a transparent PNG/SVG/JPG in /public.
 * - `placement` decides where the image lands on the garment:
 *     'chest'  — centred chest print (tees)
 *     'leg'    — small mark on the wearer's right leg (shorts)
 *     'full'   — covers the whole front panel (all-over prints)
 *     'mockup' — the image *is* the garment: a front-facing product shot on a
 *                transparent background. Its outline becomes the 3D silhouette.
 * - `url`       optional product page; otherwise "See availability" emails the studio.
 */
export type GarmentKind = 'tee' | 'shorts'
export type PrintPlacement = 'chest' | 'leg' | 'full' | 'mockup'

export interface Product {
  id: string
  name: string
  label: string
  garment: GarmentKind
  color: string
  image: string
  placement: PrintPlacement
  url?: string
}

export const products: Product[] = [
  {
    id: 'green-white-green',
    name: 'Green White Green Tee',
    label: 'White',
    garment: 'tee',
    color: '#f4f3ef',
    image: '/merch/green-white-green.png',
    placement: 'chest'
  },
  {
    id: 'sixty-six',
    name: 'Sixty-Six Tee',
    label: 'Forest',
    garment: 'tee',
    color: '#1f5a3d',
    image: '/merch/sixty-six.png',
    placement: 'chest'
  },
  {
    id: 'aso-oke-shorts',
    name: 'Aso-Oke Stripe Shorts',
    label: 'Woven Multi',
    garment: 'shorts',
    color: '#efe6d2',
    image: '/merch/aso-oke.png',
    placement: 'full'
  },
  {
    id: 'eko-skyline',
    name: 'Èkó Skyline Tee',
    label: 'Black',
    garment: 'tee',
    color: '#1b1b1d',
    image: '/merch/eko-skyline.png',
    placement: 'chest'
  },
  {
    id: 'adire-tee',
    name: 'Adire Indigo Tee',
    label: 'Indigo',
    garment: 'tee',
    color: '#2a3560',
    image: '/merch/adire-tee.png',
    placement: 'full'
  },
  {
    id: 'naija-66-shorts',
    name: 'Naija 66 Shorts',
    label: 'Kelly Green',
    garment: 'shorts',
    color: '#0f7a47',
    image: '/merch/naija-66-badge.png',
    placement: 'leg'
  },
  {
    id: 'confluence',
    name: 'Confluence Tee',
    label: 'Cream',
    garment: 'tee',
    color: '#ece4d0',
    image: '/merch/confluence.png',
    placement: 'chest'
  },
  {
    id: 'oniko-shorts',
    name: 'Oniko Tie-Dye Shorts',
    label: 'Indigo',
    garment: 'shorts',
    color: '#263058',
    image: '/merch/oniko.png',
    placement: 'full'
  },
  {
    id: 'jollof-social-club',
    name: 'Jollof Social Club Tee',
    label: 'Bone',
    garment: 'tee',
    color: '#f2efe8',
    image: '/merch/jollof-social-club.png',
    placement: 'chest'
  },
  {
    id: 'lagos-linen-shorts',
    name: 'Lagos Linen Shorts',
    label: 'Sand',
    garment: 'shorts',
    color: '#d8c7a6',
    image: '/merch/linen-mark.png',
    placement: 'leg'
  }
]
