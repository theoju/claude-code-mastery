// Pure-ESM port of the satisfiedWhen DSL evaluator. Canonical implementation
// shared between scripts/run-assessment.mjs and the Next.js dashboard
// (app/lib/assessment.ts re-exports from here as a 1-line passthrough).
//
// Grammar (mirrors app/data/rubric.json $schema comment):
//   path                — truthy (non-null, non-zero, non-empty-string; "0"/"false" also falsy)
//   !path                — falsy
//   path>=N / <=N / >N / <N — numeric comparison
//   path=v / path=v|w|x  — equals (or equals one of)
//   path!=v              — not equals
//   path~regex           — array-of-strings element matches regex (i flag)
//   A & B                — AND of two or more atoms

function readPath(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) return acc[key];
    return undefined;
  }, obj);
}

function isTruthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string")
    return v.length > 0 && v !== "0" && v.toLowerCase() !== "false";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function evaluateAtomic(expr, signals) {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("!"))
    return !evaluateAtomic(trimmed.slice(1), signals);
  // Array-regex (~): RHS is regex, matched case-insensitively against each
  // element of the (string-array) LHS. Returns false for non-array LHS or
  // unparseable regex — never throws.
  const arrMatch = trimmed.match(/^(.+?)~(.+)$/);
  if (arrMatch) {
    const path = arrMatch[1].trim();
    const rhs = arrMatch[2].trim();
    const value = readPath(signals, path);
    if (!Array.isArray(value)) return false;
    let re;
    try {
      re = new RegExp(rhs, "i");
    } catch {
      return false;
    }
    return value.some((el) => typeof el === "string" && re.test(el));
  }
  // Order matters: longer operators first so ">=" doesn't match as ">".
  const cmpMatch = trimmed.match(/^(.+?)(>=|<=|!=|=|>|<)(.+)$/);
  if (cmpMatch) {
    const path = cmpMatch[1].trim();
    const op = cmpMatch[2];
    const rhs = cmpMatch[3].trim();
    const value = readPath(signals, path);
    if (op === "=" || op === "!=") {
      const literals = rhs.split("|").map((s) => s.trim());
      const hit = literals.some((lit) => String(value) === lit);
      return op === "=" ? hit : !hit;
    }
    const num = typeof value === "number" ? value : Number(value);
    const rhsNum = Number(rhs);
    if (Number.isNaN(num) || Number.isNaN(rhsNum)) return false;
    switch (op) {
      case ">":
        return num > rhsNum;
      case ">=":
        return num >= rhsNum;
      case "<":
        return num < rhsNum;
      case "<=":
        return num <= rhsNum;
      default:
        return false;
    }
  }
  // No operator → truthy check on the path.
  return isTruthy(readPath(signals, trimmed));
}

export function evaluatePredicate(expr, signals) {
  if (!expr || !expr.trim()) return false;
  const atoms = expr
    .split("&")
    .map((s) => s.trim())
    .filter(Boolean);
  if (atoms.length === 0) return false;
  return atoms.every((atom) => evaluateAtomic(atom, signals));
}
