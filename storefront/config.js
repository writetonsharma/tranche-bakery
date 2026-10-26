// User-approved live preview: enable only on the exact HTTPS production origins.
// Local/preview domains remain off. Tests may inject a config before page scripts.
// Emergency UI rollback: replace the enabled expression below with false.
window.TRANCHE_STOREFRONT ??= Object.freeze({
	enabled: ['https://www.tranchebakery.in', 'https://tranchebakery.in'].includes(window.location?.origin),
	checkoutEnabled: ['https://www.tranchebakery.in', 'https://tranchebakery.in'].includes(window.location?.origin) // User-approved real checkout; set false for checkout-only rollback.
});