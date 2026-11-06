# Dashboard analytics

The authenticated Dashboard reads `GET /api/v1/analytics/dashboard`. All deal and invoice queries are scoped to the signed-in user's workspace and selected currency. Records created by different employees in the same workspace contribute once each. No exchange-rate conversion is performed.

Pipeline value is the sum of New Lead, Negotiation and In Progress deal amounts. Win rate is `paid deals / (paid deals + archived lost deals) × 100`; archived cancelled deals are excluded. Average deal size is the average amount of paid deals. Win rate and average return `null` when their denominators are zero.

Revenue sums paid invoice totals by `paid_at`, never paid deal amounts. The monthly view contains the latest 12 calendar months; the quarterly view contains the latest eight calendar quarters, including zero rows. `start` is inclusive, `end` exclusive. Both are calculated in Django's configured timezone. Pipeline and deal KPIs are all-time values; revenue covers the displayed chart window.

The API returns Decimal monetary strings. The chart converts these strings to JavaScript numbers only for geometry; card values and tooltip labels use the server's exact strings. Supported currencies and precision match the invoice API. The current system does not include FX conversion, forecasts, or cash-flow accounting.
