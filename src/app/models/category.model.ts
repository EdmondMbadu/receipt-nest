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
    color: '#10b981', // emerald-500
    keywords: ['grocery', 'supermarket', 'food', 'produce', 'whole foods', 'trader joe', 'kroger', 'safeway', 'albertsons']
  },
  {
    id: 'restaurants',
    name: 'Restaurants',
    icon: '🍽️',
    color: '#f59e0b', // amber-500
    keywords: ['restaurant', 'cafe', 'coffee', 'dining', 'starbucks', 'mcdonalds', 'chipotle', 'uber eats', 'doordash', 'grubhub']
  },
  {
    id: 'shopping',
    name: 'Shopping',
    icon: '🛍️',
    color: '#06b6d4', // cyan-500
    keywords: ['retail', 'store', 'amazon', 'target', 'walmart', 'costco', 'best buy', 'clothing', 'apparel']
  },
  {
    id: 'transportation',
    name: 'Transportation',
    icon: '🚗',
    color: '#3b82f6', // blue-500
    keywords: ['gas', 'fuel', 'uber', 'lyft', 'taxi', 'parking', 'toll', 'transit', 'metro', 'bus']
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    icon: '🎬',
    color: '#f43f5e', // rose-500
    keywords: ['movie', 'theater', 'concert', 'netflix', 'spotify', 'gaming', 'music', 'streaming']
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: '📱',
    color: '#3b82f6', // blue-500
    keywords: ['subscription', 'monthly', 'recurring', 'membership', 'spotify', 'netflix', 'adobe', 'microsoft']
  },
  {
    id: 'utilities',
    name: 'Utilities',
    icon: '💡',
    color: '#14b8a6', // teal-500
    keywords: ['electric', 'water', 'gas', 'internet', 'phone', 'utility', 'bill', 'power']
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    icon: '🏥',
    color: '#ef4444', // red-500
    keywords: ['pharmacy', 'doctor', 'hospital', 'medical', 'cvs', 'walgreens', 'prescription', 'health']
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: '✈️',
    color: '#0ea5e9', // sky-500
    keywords: ['hotel', 'flight', 'airline', 'airbnb', 'booking', 'travel', 'vacation', 'trip']
  },
  {
    id: 'education',
    name: 'Education',
    icon: '📚',
    color: '#f97316', // orange-500
    keywords: ['book', 'course', 'school', 'university', 'training', 'udemy', 'coursera', 'education']
  },
  {
    id: 'personal',
    name: 'Personal Care',
    icon: '💆',
    color: '#fb7185', // rose-400
    keywords: ['salon', 'spa', 'haircut', 'beauty', 'cosmetics', 'gym', 'fitness']
  },
  {
    id: 'other',
    name: 'Other',
    icon: '📦',
    color: '#64748b', // slate-500
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


