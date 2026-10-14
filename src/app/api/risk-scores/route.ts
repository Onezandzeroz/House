import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { createTrustService } from "@/server/services/trust-service";
import { computeRiskScore, applyPositionOverlay, type DeFiPositionType } from "@/server/domain/risk-scoring";
import { setCompositeCategory } from "@/server/domain/bankroll";
import { collectMarketDataBatch } from "@/server/lib/market-data-collector";

/**
 * GET /api/risk-scores — returns the composite risk score breakdown for
 * every asset in the trust's portfolio.
 *
 * This endpoint:
 *   1. Fetches the portfolio to discover which assets the trust holds.
 *   2. Collects market data (volatility, market cap, liquidity) for each
 *      asset in parallel (cached 1h in market-data-collector).
 *   3. Computes the composite risk score (0-100) with per-dimension
 *      breakdown + drivers + hard-rule overrides.
 *   4. Updates the composite category cache in bankroll.ts so the sync
 *      `categorizeAsset` benefits from the fresh scores.
 *   5. Returns the full breakdown for UI explainability.
 *
 * Auth: session required (trust isolation). force-dynamic.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const service = createTrustService();
    const current = await service.getCurrentTrust(auth.userId);
    if (!current.ok) {
      return NextResponse.json(
        { error: current.error.code, message: current.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!current.value) {
      return NextResponse.json(
        { error: "no-trust" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // 1. Fetch the portfolio to discover held assets
    const portfolio = await service.getPortfolio(current.value.id);
    if (!portfolio.ok) {
      return NextResponse.json(
        { error: portfolio.error.code, message: portfolio.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    // 2. Collect the unique asset IDs from the portfolio
    const assetIds = new Set<string>();
    for (const sleeve of portfolio.value.sleeves) {
      for (const asset of sleeve.assets) {
        assetIds.add(asset.assetId);
      }
    }

    // 3. Collect DeFi metadata from positions (positionType + protocol)
    //    We need this to apply the DeFi strategy overlay.
    const defiPositions: Array<{ assetId: string; positionType: string; protocol: string | null }> = [];
    // current.value IS a TrustWithRelations (includes books→positions)
    const book = current.value.books[0];
    if (book) {
      for (const p of book.positions) {
        if (p.positionType && p.protocol) {
          defiPositions.push({
            assetId: p.assetId,
            positionType: p.positionType,
            protocol: p.protocol,
          });
        }
      }
    }

    // 4. Collect market data for all assets in parallel (cached 1h)
    const assetIdArray = Array.from(assetIds);
    const marketDataMap = await collectMarketDataBatch(assetIdArray);

    // 5. Compute composite scores
    const scores = assetIdArray.map((assetId) => {
      const data = marketDataMap[assetId.toLowerCase()] ?? null;
      const baseScore = computeRiskScore(assetId, data);

      // Update the composite category cache so the sync categorizeAsset
      // benefits from the fresh score on the next portfolio fetch.
      setCompositeCategory(assetId, baseScore.category);

      // Apply DeFi overlay if this asset has a DeFi position
      const defi = defiPositions.find(
        (d) => d.assetId.toLowerCase() === assetId.toLowerCase(),
      );
      let overlay = null;
      if (defi) {
        overlay = applyPositionOverlay(
          baseScore,
          defi.positionType as DeFiPositionType,
          defi.protocol,
        );
        // Update the cache with the overlaid category
        setCompositeCategory(assetId, overlay.category);
      }

      return {
        assetId,
        score: baseScore.score,
        category: overlay ? overlay.category : baseScore.category,
        baseCategory: baseScore.category,
        confidence: baseScore.confidence,
        drivers: baseScore.drivers,
        dimensions: baseScore.dimensions,
        overrides: baseScore.overrides,
        stablecoinType: baseScore.stablecoinType,
        computedAt: baseScore.computedAt,
        defiOverlay: overlay
          ? {
              adjustment: overlay.scoreAdjustment,
              reason: overlay.reason,
              baseCategory: baseScore.category,
              adjustedCategory: overlay.category,
            }
          : null,
      };
    });

    // 6. Summary
    const summary = {
      totalAssets: scores.length,
      highConfidence: scores.filter((s) => s.confidence === "high").length,
      partialConfidence: scores.filter((s) => s.confidence === "medium").length,
      degradedConfidence: scores.filter((s) => s.confidence === "low").length,
    };

    return NextResponse.json(
      { scores, summary },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "risk-scores-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
