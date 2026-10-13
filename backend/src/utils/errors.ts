// Shared across data-fetch services that can't tell FMP simply has no data
// for a symbol apart from any other failure — thrown when a required
// profile/quote call comes back empty, so the controller can map it to a
// clean 404 instead of the undifferentiated 500 a generic Error would get
// from the global errorHandler.
export class InvalidTickerError extends Error {}
