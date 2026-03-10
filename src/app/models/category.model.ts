/**
 * Predefined expense categories
 * These are global/shared across all users
 */
export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  keywords: string[]; // Keywords for AI classification hints
}

/**
 * Default categories for receipt classification
 */
export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'groceries',
    name: 'Groceries',
    icon: '🛒',
    color: '#10b981',
    keywords: ['grocery', 'supermarket', 'whole foods', 'trader joe', 'kroger', 'aldi', 'publix', 'safeway', 'piggly wiggly', 'food lion', 'h-e-b', 'heb', 'wegmans', 'sprouts', 'market basket']
  },
  {
    id: 'restaurants',
    name: 'Restaurants & Dining',
    icon: '🍽️',
    color: '#f59e0b',
    keywords: ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonalds', 'uber eats', 'doordash', 'grubhub', 'chipotle', 'chick-fil-a', 'wendy', 'burger king', 'subway', 'pizza', 'taco bell', 'panera', 'dunkin', 'bakery', 'deli', 'sushi', 'bistro', 'grill', 'kitchen']
  },
  {
    id: 'shopping',
    name: 'Shopping',
    icon: '🛍️',
    color: '#06b6d4',
    keywords: ['amazon', 'target', 'walmart', 'costco', 'best buy', 'retail', 'dollar tree', 'dollar general', 'five below', 'marshalls', 'tj maxx', 'ross', 'ikea', 'wayfair', 'etsy', 'ebay']
  },
  {
    id: 'transportation',
    name: 'Transportation',
    icon: '🚗',
    color: '#3b82f6',
    keywords: ['uber', 'lyft', 'parking', 'transit', 'metro', 'bus', 'toll', 'taxi', 'cab', 'rideshare', 'train', 'amtrak']
  },
  {
    id: 'gas_fuel',
    name: 'Gas & Fuel',
    icon: '⛽',
    color: '#a855f7',
    keywords: ['gas', 'fuel', 'shell', 'chevron', 'exxon', 'mobil', 'bp', 'valero', 'marathon', 'citgo', 'sunoco', 'speedway', 'racetrac', 'quiktrip', 'wawa', 'sheetz', 'circle k', '7-eleven', 'gasoline', 'diesel', 'gallon']
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    icon: '🎬',
    color: '#f43f5e',
    keywords: ['movie', 'netflix', 'spotify', 'gaming', 'concert', 'amc', 'regal', 'hulu', 'disney+', 'hbo', 'theater', 'theatre', 'museum', 'zoo', 'bowling', 'arcade', 'cinema', 'ticket']
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: '📱',
    color: '#8b5cf6',
    keywords: ['subscription', 'monthly', 'recurring', 'membership', 'adobe', 'microsoft 365', 'google one', 'dropbox', 'icloud', 'premium', 'autopay']
  },
  {
    id: 'utilities',
    name: 'Utilities & Bills',
    icon: '💡',
    color: '#14b8a6',
    keywords: ['electric', 'water', 'internet', 'phone', 'utility', 'gas bill', 'sewage', 'trash', 'at&t', 'verizon', 't-mobile', 'comcast', 'xfinity', 'spectrum', 'power', 'energy', 'cable', 'broadband']
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    icon: '🏥',
    color: '#ef4444',
    keywords: ['pharmacy', 'doctor', 'hospital', 'cvs', 'walgreens', 'rite aid', 'medical', 'dental', 'vision', 'clinic', 'urgent care', 'prescription', 'copay', 'therapy']
  },
  {
    id: 'travel',
    name: 'Travel & Hotels',
    icon: '✈️',
    color: '#0ea5e9',
    keywords: ['hotel', 'flight', 'airline', 'airbnb', 'booking', 'marriott', 'hilton', 'hyatt', 'motel', 'resort', 'vrbo', 'expedia', 'delta', 'united', 'southwest', 'cruise']
  },
  {
    id: 'education',
    name: 'Education',
    icon: '📚',
    color: '#f97316',
    keywords: ['school', 'university', 'college', 'tuition', 'textbook', 'course', 'udemy', 'coursera', 'skillshare', 'training', 'seminar', 'workshop', 'academy']
  },
  {
    id: 'personal',
    name: 'Personal Care',
    icon: '💆',
    color: '#fb7185',
    keywords: ['salon', 'barber', 'spa', 'massage', 'nail', 'hair', 'beauty', 'cosmetic', 'skincare', 'sephora', 'ulta', 'waxing', 'facial', 'grooming']
  },
  {
    id: 'home_garden',
    name: 'Home & Garden',
    icon: '🏠',
    color: '#84cc16',
    keywords: ['home depot', 'lowes', 'menards', 'ace hardware', 'hardware', 'lumber', 'plumbing', 'nursery', 'garden center', 'landscaping', 'paint', 'flooring', 'renovation', 'repair']
  },
  {
    id: 'clothing',
    name: 'Clothing & Apparel',
    icon: '👗',
    color: '#e879f9',
    keywords: ['nike', 'adidas', 'gap', 'old navy', 'h&m', 'zara', 'uniqlo', 'nordstrom', 'macy', 'jcpenney', 'kohl', 'lululemon', 'foot locker', 'shoes', 'apparel', 'clothing', 'fashion']
  },
  {
    id: 'gifts_donations',
    name: 'Gifts & Donations',
    icon: '🎁',
    color: '#f472b6',
    keywords: ['gift', 'donation', 'charity', 'church', 'tithe', 'nonprofit', 'goodwill', 'hallmark', 'florist', 'bouquet']
  },
  {
    id: 'pets',
    name: 'Pets',
    icon: '🐾',
    color: '#fb923c',
    keywords: ['pet', 'petsmart', 'petco', 'veterinarian', 'vet', 'animal hospital', 'dog', 'cat', 'chewy', 'groomer', 'kennel']
  },
  {
    id: 'fitness',
    name: 'Fitness & Sports',
    icon: '💪',
    color: '#22d3ee',
    keywords: ['gym', 'fitness', 'crossfit', 'planet fitness', 'la fitness', 'orangetheory', 'equinox', 'ymca', 'peloton', 'sporting goods', 'rei', 'yoga studio', 'martial arts']
  },
  {
    id: 'other',
    name: 'Other',
    icon: '📦',
    color: '#64748b',
    keywords: []
  }
];

/**
 * Get category by ID
 */
export function getCategoryById(id: string): Category | undefined {
  return DEFAULT_CATEGORIES.find(c => c.id === id);
}

/**
 * Get category by name (case-insensitive)
 */
export function getCategoryByName(name: string): Category | undefined {
  const lowerName = name.toLowerCase();
  return DEFAULT_CATEGORIES.find(c => c.name.toLowerCase() === lowerName);
}


