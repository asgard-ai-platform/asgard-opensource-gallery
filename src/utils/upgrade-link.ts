// Maps an `upgrade_to` product name (as stored in YAML data files) to the
// correct outbound URL on asgard-ai.com.
//
// Products in ONLINE_UPGRADE_PRODUCTS have a dedicated product page at
// /products/{lowercase}. Everything else falls back to the products listing
// page (e.g. products that have not yet launched
// such as "Asgard"). When a new product launches, add its name to
// ONLINE_UPGRADE_PRODUCTS.

const ONLINE_UPGRADE_PRODUCTS = new Set([
  'Heimdall',
  'Mimir',
  'Sindri',
  'Odin',
]);

export interface UpgradeLink {
  href: string;
  hasDedicatedPage: boolean;
}

export function getUpgradeLink(productName: string): UpgradeLink {
  if (ONLINE_UPGRADE_PRODUCTS.has(productName)) {
    return {
      href: `https://asgard-ai.com/products/${productName.toLowerCase()}`,
      hasDedicatedPage: true,
    };
  }
  return {
    href: 'https://asgard-ai.com/products',
    hasDedicatedPage: false,
  };
}
