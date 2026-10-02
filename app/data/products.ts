/**
 * The collection on the rack. Edit, reorder or swap designs here — everything
 * else (rack, overlay, labels, counter) is driven by this array.
 *
 * - `garment`   picks the 3D garment model (currently 'tee').
 * - `color`     is the fabric colour.
 * - `image`     is the print artwork: a transparent PNG/SVG in /public.
 * - `placement` decides where the artwork is printed:
 *     'chest'  — centred front print
 *     'pocket' — small mark on the wearer's left chest
 *     'full'   — all-over print covering the whole garment
 * - `url`       optional product page; otherwise "See availability" emails the studio.
 */
export type GarmentKind = 'tee'
export type PrintPlacement = 'chest' | 'pocket' | 'full'

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

const WHITE = '#f5f4f0'
const BLACK = '#1c1c1e'

export const products: Product[] = [
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
    id: 'naija-threads-tee',
    name: 'Naija Threads Tee',
    label: 'Black',
    garment: 'tee',
    color: BLACK,
    image: '/merch/script-mark-cream.png',
    placement: 'pocket'
  },
  {
    id: 'green-white-green',
    name: 'Green White Green Tee',
    label: 'White',
    garment: 'tee',
    color: WHITE,
    image: '/merch/green-white-green.png',
    placement: 'chest'
  },
  {
    id: 'eko-skyline-tee',
    name: 'Èkó Skyline Tee',
    label: 'Black',
    garment: 'tee',
    color: BLACK,
    image: '/merch/eko-skyline.png',
    placement: 'chest'
  },
  {
    id: 'naija-threads-tee-green',
    name: 'Naija Threads Tee',
    label: 'Green',
    garment: 'tee',
    color: '#0f6b41',
    image: '/merch/script-mark-cream.png',
    placement: 'pocket'
  },
  {
    id: 'sixty-six-tee',
    name: 'Sixty-Six Tee',
    label: 'Black',
    garment: 'tee',
    color: '#161618',
    image: '/merch/sixty-six.png',
    placement: 'chest'
  },
  {
    id: 'confluence-tee',
    name: 'Confluence Tee',
    label: 'White',
    garment: 'tee',
    color: WHITE,
    image: '/merch/confluence.png',
    placement: 'chest'
  },
  {
    id: 'jollof-social-club',
    name: 'Jollof Social Club Tee',
    label: 'White',
    garment: 'tee',
    color: WHITE,
    image: '/merch/jollof-social-club.png',
    placement: 'chest'
  },
  {
    id: 'naija-since-1960-tee',
    name: 'Naija Since 1960 Tee',
    label: 'Forest',
    garment: 'tee',
    color: '#1e4d36',
    image: '/merch/naija-crewneck.png',
    placement: 'chest'
  },
  {
    id: 'since-1960-pocket-tee',
    name: 'Since 1960 Pocket Tee',
    label: 'Heather Grey',
    garment: 'tee',
    color: '#8d8f93',
    image: '/merch/since-1960.png',
    placement: 'pocket'
  }
]
