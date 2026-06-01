// rank-next-actions.mjs
// Filters and ranks rubric.nextActions for the /self-assessment skill,
// /methodology overview, and any future consumer that needs a top-N list.
// Called once by scripts/run-assessment.mjs; output is written to
// app/data/assessment.json under `rankedNextActions`.

import { evaluatePredicate } from "./predicate.mjs";

function axisOrder(a) {
  return a === "platform" ? 0 : a === "execution" ? 1 : 2;
}

/**
 * @param rubric         The parsed rubric object ({ dimensions: [...] }).
 * @param scoreMap       Map<dimId, { score, executionScore }>.
 * @param signalsSummary Flat object — passed verbatim to evaluatePredicate.
 * @param limit          Maximum entries to return (default 10).
 * @returns Array of ranked entries, sorted by tie-breaking rule.
 */
export function rankNextActions(rubric, scoreMap, signalsSummary, limit = 10) {
  const ranked = [];
  for (const dim of rubric.dimensions || []) {
    const scored = scoreMap.get(dim.id);
    if (!scored) continue;
    const weight = dim.weight ?? 1;
    const pDeficit = Math.max(0, 100 - scored.score);
    const xDeficit =
      scored.executionScore == null
        ? 0
        : Math.max(0, 100 - scored.executionScore);
    for (const na of dim.nextActions || []) {
      if (!na.action) continue; // malformed; skip silently
      if (
        na.satisfiedWhen &&
        evaluatePredicate(na.satisfiedWhen, signalsSummary)
      )
        continue;
      const axis = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
      const deficit = axis === "execution" ? xDeficit : pDeficit;
      const rank = weight * deficit;
      ranked.push({
        dimId: dim.id,
        actionId: na.id,
        axis,
        weight,
        deficit,
        rank,
        action: na.action,
        effort: na.effort,
        borisTip: na.borisTip,
        satisfiedWhen: na.satisfiedWhen ?? null,
      });
    }
  }
  ranked.sort(
    (a, b) =>
      b.rank - a.rank ||
      axisOrder(a.axis) - axisOrder(b.axis) ||
      b.weight - a.weight ||
      a.dimId.localeCompare(b.dimId) ||
      a.actionId.localeCompare(b.actionId),
  );
  return ranked.slice(0, limit);
}
