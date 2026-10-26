/**
 * Farm Box integration service: bridges social media marketing with Farm Box's
 * real produce catalogue, Telugu/English bilingual dictionaries, recipes ("Cook the Harvest"),
 * delivery slots, and 1-click cart link generation.
 *
 * References: /FarmboxBackendOct8th
 */

import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';

export interface FarmBoxItem {
  id: string;
  name: string;
  nameTe: string;
  description: string;
  descriptionTe: string;
  category: 'vegetable' | 'fruit' | 'staple' | 'leafy' | 'gourd' | 'box';
  unit: string;
  priceInr: number;
  inStock: boolean;
  image?: string;
}

export interface FarmBoxRecipe {
  key: string;
  name: string;
  nameTe?: string;
  description: string;
  cuisine: string;
  prepTimeMinutes: number;
  servings: number;
  ingredients: { item: string; qty: string }[];
  basketUrl: string;
}

export interface DeliverySlotInfo {
  available: boolean;
  slots: { id: string; name: string; timing: string; cutoffTime: string }[];
  coverageNotice: string;
  standardLeadHours: number;
}

// Default standard Farm Box curated boxes
export const CURATED_FARM_BOXES = [
  {
    id: 'box_weekly_fresh',
    name: 'Farm Box Weekly Vegetable Basket (8kg)',
    nameTe: 'ఫార్మ్ బాక్స్ వారపు తాజా కూరగాయల బాస్కెట్ (8 కిలోలు)',
    priceInr: 399,
    description: '12 handpicked daily essential vegetables (Tomatoes, Onions, Potatoes, Okra, Brinjals, Leafy Greens, Gourds) harvested this morning.',
    descriptionTe: '12 రకాల రోజువారీ తాజా కూరగాయలు (టమాటాలు, ఉల్లిపాయలు, బంగాళాదుంపలు, లేత బెండకాయ, గుత్తి వంకాయ, పాలకూర, బీరకాయ) - ఈ ఉదయమే సేకరించినవి.',
    badge: 'Best Seller 🥦',
    slug: 'weekly-fresh-box',
  },
  {
    id: 'box_organic_fruits',
    name: 'Farm Box Organic Fruit Basket (4kg)',
    nameTe: 'ఫార్మ్ బాక్స్ ఆర్గానిక్ పండ్ల బుట్ట (4 కిలోలు)',
    priceInr: 499,
    description: 'Fresh seasonal fruits (Papaya, Bananas, Pomegranate, Citrus, Seasonal Berries/Mangoes), naturally ripened with zero carbide.',
    descriptionTe: 'తాజా సీజనల్ పండ్లు (బొప్పాయి, అరటిపండ్లు, దానిమ్మ, బత్తాయి) - రసాయనాలు లేకుండా సహజంగా పండించినవి.',
    badge: 'Naturally Sweet 🍎',
    slug: 'organic-fruit-box',
  },
  {
    id: 'box_greens_detox',
    name: 'Daily Leafy Greens & Salad Detox Box',
    nameTe: 'రోజువారీ తాజా ఆకుకూరలు & సలాడ్ డిటాక్స్ బాక్స్',
    priceInr: 249,
    description: '5 varieties of hydro-washed organic greens: Spinach (Palak), Methi, Amaranth (Thotakura), Coriander, Mint, and crunchy Cucumbers.',
    descriptionTe: '5 రకాల తాజా ఆకుకూరలు: పాలకూర, తోటకూర, మెంతికూర, కొత్తిమీర, పుదీనా మరియు దోసకాయలు.',
    badge: 'Ultra Fresh 🥬',
    slug: 'leafy-greens-box',
  },
  {
    id: 'box_kitchen_combo',
    name: 'Farm Kitchen South Indian Sambar & Curry Kit',
    nameTe: 'ఫార్మ్ కిచెన్ సాంబారు & కూర కిట్',
    priceInr: 299,
    description: 'Exact ingredients for authentic Telangana & Andhra Sambar & Poriyal: Drumsticks, Small Onions, Bottle Gourd, Tomatoes, Curry Leaves.',
    descriptionTe: 'తెలంగాణ & ఆంధ్ర సాంబారు కిట్: మునక్కాయలు, సాంబారు ఉల్లిపాయలు, సొరకాయ, టమాటాలు, కరివేపాకు.',
    badge: 'Recipe Ready 🍲',
    slug: 'sambar-curry-kit',
  },
];

// Delivery slots in Farm Box's service regions
export const DELIVERY_SLOTS = [
  { id: 'slot_morning', name: 'Morning Harvest Slot', timing: '06:00 AM - 09:00 AM', cutoffTime: 'Order before 10:00 PM previous night' },
  { id: 'slot_afternoon', name: 'Afternoon Slot', timing: '12:00 PM - 03:00 PM', cutoffTime: 'Order before 09:00 AM same day' },
  { id: 'slot_evening', name: 'Evening Dinner Slot', timing: '05:00 PM - 08:00 PM', cutoffTime: 'Order before 02:00 PM same day' },
];

export class FarmboxService {
  private static cachedCatalog: FarmBoxItem[] | null = null;
  private static cachedTeluguDict: Map<string, [string, string]> | null = null;

  /**
   * Loads the bilingual produce catalog dictionary from FarmboxBackendOct8th if available,
   * falling back to embedded core produce items.
   */
  private static loadDictionaries() {
    if (this.cachedTeluguDict) return;

    this.cachedTeluguDict = new Map();
    const possiblePaths = [
      '/Users/apple/Downloads/bharatharvestupgradesep19th/FarmboxBackendOct8th/data/i18n/catalog/te.json',
      path.resolve(process.cwd(), '../FarmboxBackendOct8th/data/i18n/catalog/te.json'),
    ];

    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8');
          const data = JSON.parse(raw);
          if (data && typeof data.p === 'object') {
            for (const [key, val] of Object.entries(data.p)) {
              if (Array.isArray(val) && val.length >= 2) {
                this.cachedTeluguDict.set(key, [val[0], val[1]]);
              }
            }
            console.log(`[FarmboxService] Loaded ${this.cachedTeluguDict.size} Telugu produce translations from ${p}`);
            break;
          }
        }
      } catch (e: any) {
        console.warn(`[FarmboxService] Could not load ${p}:`, e.message);
      }
    }
  }

  /**
   * Get all active produce items with bilingual English + Telugu titles and cooking descriptions
   */
  static getCatalog(): FarmBoxItem[] {
    if (this.cachedCatalog) return this.cachedCatalog;
    this.loadDictionaries();

    const baseItems: { id: string; enName: string; enDesc: string; cat: FarmBoxItem['category']; unit: string; price: number }[] = [
      { id: 'VEG-TOMATO', enName: 'Farm Fresh Tomatoes', enDesc: 'Daily farm fresh tomatoes for curries, dal, rasam and salads.', cat: 'vegetable', unit: '1 kg', price: 34 },
      { id: 'VEG-OKRA', enName: 'Tender Ladyfinger / Bhendi', enDesc: 'Crisp tender okra for fry, sambar and stuffed curries.', cat: 'vegetable', unit: '500g', price: 28 },
      { id: 'VEG-BRINJAL', enName: 'Brinjal / Gutti Vankaya', enDesc: 'Small purple brinjals ideal for stuffed gutti vankaya curry and sambar.', cat: 'vegetable', unit: '500g', price: 30 },
      { id: 'VEG-LEAF-SPINACH', enName: 'Organic Spinach / Palak', enDesc: 'Tender green leaves for palak dal, palak paneer and smoothies.', cat: 'leafy', unit: '250g', price: 20 },
      { id: 'VEG-LEAF-AMARANTH', enName: 'Fresh Thotakura (Amaranth)', enDesc: 'Traditional red and green amaranth leaves for hearty Telangana dal and stir fry.', cat: 'leafy', unit: '250g', price: 22 },
      { id: 'VEG-LEAF-METHI', enName: 'Fresh Methi (Fenugreek)', enDesc: 'Fragrant fenugreek leaves for methi paratha, aloo methi and pappu.', cat: 'leafy', unit: '250g', price: 25 },
      { id: 'VEG-BOTTLE-GOURD', enName: 'Bottle Gourd (Sorakaya)', enDesc: 'Tender light bottle gourd for dal, kootu, halwa and morning detox juice.', cat: 'gourd', unit: '1 pc (700g)', price: 32 },
      { id: 'VEG-RIDGE-GOURD', enName: 'Ridge Gourd (Beerakaya)', enDesc: 'Crisp ridge gourd for curry and traditional spicy beerakaya thotakura/chutney.', cat: 'gourd', unit: '500g', price: 35 },
      { id: 'VEG-IVY-GOURD', enName: 'Ivy Gourd (Dondakaya)', enDesc: 'Crispy tindora/dondakaya for crunchy peanut fry and pachadi.', cat: 'vegetable', unit: '500g', price: 30 },
      { id: 'VEG-ALLIUM-ONION', enName: 'Country Red Onions', enDesc: 'Pungent fresh red onions, essential kitchen base.', cat: 'vegetable', unit: '1 kg', price: 38 },
      { id: 'VEG-GREEN-CHILLIES', enName: 'Spicy Green Chillies', enDesc: 'Piquant fresh green chillies for tempering and chutneys.', cat: 'vegetable', unit: '100g', price: 12 },
      { id: 'FRU-BANANA-ROBUSTA', enName: 'Robusta Golden Bananas', enDesc: 'Naturally ripened sweet potassium-rich bananas.', cat: 'fruit', unit: '6 pcs', price: 45 },
      { id: 'FRU-PAPAYA', enName: 'Red Lady Sweet Papaya', enDesc: 'Tree-ripened sweet digestive papaya.', cat: 'fruit', unit: '1 pc (1kg)', price: 60 },
      { id: 'FRU-POMEGRANATE', enName: 'Ruby Red Pomegranate', enDesc: 'Juicy antioxidant-rich pomegranate pearls.', cat: 'fruit', unit: '500g', price: 95 },
    ];

    const catalog: FarmBoxItem[] = baseItems.map((b) => {
      const te = this.cachedTeluguDict?.get(b.id);
      return {
        id: b.id,
        name: b.enName,
        nameTe: te?.[0] || b.enName,
        description: b.enDesc,
        descriptionTe: te?.[1] || b.enDesc,
        category: b.cat,
        unit: b.unit,
        priceInr: b.price,
        inStock: true,
      };
    });

    this.cachedCatalog = catalog;
    return catalog;
  }

  /**
   * Search produce by name, keyword, or Telugu string
   */
  static searchProduce(query: string): FarmBoxItem[] {
    const q = query.trim().toLowerCase();
    const catalog = this.getCatalog();
    return catalog.filter((item) =>
      item.name.toLowerCase().includes(q) ||
      item.nameTe.includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.descriptionTe.includes(q) ||
      item.category.includes(q as any)
    );
  }

  /**
   * Returns curated vegetable and fruit boxes
   */
  static getBoxes() {
    return CURATED_FARM_BOXES;
  }

  static getCuratedBoxes() {
    return CURATED_FARM_BOXES;
  }

  /**
   * Returns "Cook the Harvest" recipe recommendations
   */
  static getRecipes(): FarmBoxRecipe[] {
    return [
      {
        key: 'telangana-gutti-vankaya',
        name: 'Gutti Vankaya Kura (Stuffed Brinjal Curry)',
        nameTe: 'గుత్తి వంకాయ కూర (తెలంగాణ స్టైల్)',
        description: 'Iconic Andhra & Telangana stuffed brinjal curry cooked in peanut, sesame and coconut masala.',
        cuisine: 'Telangana',
        prepTimeMinutes: 30,
        servings: 4,
        ingredients: [
          { item: 'Small Purple Brinjals (వంకాయలు)', qty: '500g' },
          { item: 'Red Onions (ఉల్లిపాయలు)', qty: '2 pcs' },
          { item: 'Roasted Peanuts & White Sesame', qty: '50g' },
          { item: 'Curry Leaves & Green Chillies', qty: 'Bunch' },
        ],
        basketUrl: `${this.getWebstoreUrl()}/recipes/telangana-gutti-vankaya?add_basket=1`,
      },
      {
        key: 'beerakaya-pesara-pappu',
        name: 'Beerakaya Pesara Pappu (Ridge Gourd Moong Dal)',
        nameTe: 'బీరకాయ పెసరపప్పు',
        description: 'Cooling, light and nutritious comfort dal made with farm-fresh ridge gourd and yellow moong.',
        cuisine: 'Andhra',
        prepTimeMinutes: 20,
        servings: 3,
        ingredients: [
          { item: 'Tender Ridge Gourd (బీరకాయ)', qty: '500g' },
          { item: 'Yellow Moong Dal (పెసరపప్పు)', qty: '150g' },
          { item: 'Green Chillies & Mustard Seeds', qty: 'to taste' },
        ],
        basketUrl: `${this.getWebstoreUrl()}/recipes/beerakaya-pesara-pappu?add_basket=1`,
      },
      {
        key: 'palakura-pappu',
        name: 'Palakura Pappu (Spinach Dal)',
        nameTe: 'పాలకూర పప్పు',
        description: 'Classic Telugu everyday spinach dal with garlic and red chilli tadka.',
        cuisine: 'South Indian',
        prepTimeMinutes: 25,
        servings: 4,
        ingredients: [
          { item: 'Fresh Organic Spinach (పాలకూర)', qty: '2 bunches' },
          { item: 'Toor Dal (కందిపప్పు)', qty: '200g' },
          { item: 'Garlic & Cumin', qty: 'to taste' },
        ],
        basketUrl: `${this.getWebstoreUrl()}/recipes/palakura-pappu?add_basket=1`,
      },
    ];
  }

  /**
   * Returns delivery slots and service notice
   */
  static getDeliverySlotsInfo(pincode?: string): DeliverySlotInfo {
    return {
      available: true,
      slots: DELIVERY_SLOTS,
      coverageNotice: pincode
        ? `Delivering to Pincode ${pincode} with same-day morning and evening farm-fresh slots.`
        : 'Delivering across Hyderabad, Secunderabad, Gachibowli, Madhapur, Hitec City, Jubilee Hills, and surrounding clusters within 12 hours of harvest.',
      standardLeadHours: 12,
    };
  }

  /**
   * Generates a direct checkout or cart link that customer can tap in DM or WhatsApp
   */
  static generateCartLink(boxIdOrItems: string | { id: string; qty: number }[] | any, ref = 'social_dm'): string {
    const base = this.getWebstoreUrl();
    if (typeof boxIdOrItems === 'string') {
      return `${base}/order?box=${encodeURIComponent(boxIdOrItems)}&ref=${encodeURIComponent(ref)}`;
    }
    if (Array.isArray(boxIdOrItems)) {
      const serialized = boxIdOrItems.map((i) => `${i.id || i.itemId}:${i.qty || i.quantity || 1}`).join(',');
      return `${base}/cart?items=${encodeURIComponent(serialized)}&ref=${encodeURIComponent(ref)}`;
    }
    return `${base}/cart?ref=${encodeURIComponent(ref)}`;
  }

  static generateOrderLink(boxIdOrItems: any, ref = 'social_dm'): string {
    return this.generateCartLink(boxIdOrItems, ref);
  }

  static getWebstoreUrl(): string {
    return process.env.FARMBOX_WEB_URL || 'https://farmbox.bharatharvest.com';
  }
}
