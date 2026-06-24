const marketData = require('../services/marketData.service');
const cf = require('../services/contrarianFinder.service');

async function scan(req, res, next) {
  const {
    threshold = 25,
    batchSize,
    maxBatches,
    qualityPreset,
  } = req.body || {};

  try {
    const key = marketData.requireFmpKey();
    const { universeSize, scanned, results } = await cf.runScan({
      key,
      batchSize: batchSize ? parseInt(batchSize, 10) : undefined,
      maxBatches: maxBatches ? parseInt(maxBatches, 10) : undefined,
      qualityPreset,
    });
    const candidates = cf.filterCandidates(results, parseInt(threshold, 10) || 25);
    res.json({ universeSize, scanned, threshold: parseInt(threshold, 10) || 25, candidates });
  } catch (err) {
    if (err instanceof marketData.MissingApiKeyError) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
}

module.exports = { scan };
