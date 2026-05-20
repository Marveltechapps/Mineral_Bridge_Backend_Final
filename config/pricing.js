/**
 * Single source of truth: dashboard-confirmed price (confirmedPrice + orderSummary).
 * Set USE_CONFIRMED_PRICE_AUTHORITY=false in .env to restore legacy behavior (no auto
 * confirmedPrice from orderSummary; app should use its own legacy flag too).
 */
function useConfirmedPriceAuthority() {
  return String(process.env.USE_CONFIRMED_PRICE_AUTHORITY || '').toLowerCase() !== 'false';
}

module.exports = { useConfirmedPriceAuthority };
