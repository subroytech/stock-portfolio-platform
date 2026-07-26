import env from '../config/env';

export class AnalysisServiceError extends Error {}

// Small fetch-with-timeout wrapper for the Python analysis-service, mirroring
// marketData.service.ts's fmpGet shape (AbortController + finally-cleared
// timeout) but without any FMP-specific error mapping — nothing FMP-shaped
// to distinguish when talking to our own internal service.
export async function checkHealth(): Promise<{ status: string }> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${env.analysisServiceUrl}/health`, { signal: controller.signal });
    if (!res.ok) throw new AnalysisServiceError(`Analysis service returned HTTP ${res.status}`);
    return (await res.json()) as { status: string };
  } catch (err) {
    if (err instanceof AnalysisServiceError) throw err;
    throw new AnalysisServiceError('Analysis service unavailable.');
  } finally {
    clearTimeout(tid);
  }
}
