/**
 * Studio details shown in the header, ticker and side panels.
 */
export const site = {
  brand: {
    lines: ['Naija', 'Threads'] as const,
    name: 'Naija Threads'
  },
  description: 'Naija Threads — the Nigeria @ 66 independence capsule. Heavyweight tees in green, white and green.',
  contact: {
    portfolio: { label: 'iamibrahim.xyz', url: 'https://iamibrahim.xyz' },
    x: { handle: 'ibrahimijai', url: 'https://x.com/ibrahimijai' }
  },
  /** Optional shop link used by "See availability" on the rack. Leave empty to send people to X instead. */
  shopUrl: '',
  ticker: [
    'New designs daily',
    'Subscribe to our newsletter',
    'Happy 66th, Nigeria'
  ],
  /** 3D garment models (CC BY 4.0) — attribution is required wherever the site is shared. */
  modelCredits: [
    { work: 'Basic T-Shirt', url: 'https://sketchfab.com/3d-models/basic-t-shirt-71bdf5940b5d41b8b46628a615e9b0ed', author: 'MadeByYeshe', authorUrl: 'https://sketchfab.com/MadeByYeshe' }
  ],
  about: {
    title: 'About the studio',
    paragraphs: [
      'Naija Threads is a small print studio making everyday clothes with a Nigerian accent — heavyweight tees printed in Lagos.',
      'The Nigeria @ 66 capsule marks sixty-six years of independence, from 1 October 1960 to today. It borrows from the things we grew up around: the green-white-green, adire cloth dyed in Abeokuta, the Lagos skyline, the Niger and Benue meeting at Lokoja, and a pot of party jollof on a Sunday.',
      'Every piece is printed to order in small runs, so availability changes week to week. Ask about a design and we will tell you what is on the rail.'
    ]
  }
}

/** Where "See availability" goes: the product's own page, the shop, or a DM on X. */
export function availabilityHref(url?: string) {
  return url || site.shopUrl || site.contact.x.url
}
