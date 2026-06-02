import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import PageNav from "@/app/components/PageNav";
import { renderDocMarkdown } from "@/app/lib/doc-markdown";

export const dynamic = "force-static";

export const metadata = {
  title: "/ship — recommended personal shipping command",
};

export default async function ShipPatternPage() {
  const path = join(process.cwd(), "docs", "site-src", "ship-pattern.md");
  let md: string;
  try {
    md = await readFile(path, "utf8");
  } catch {
    notFound();
  }

  return (
    <main className="max-w-[1200px] mx-auto px-8 py-12">
      <PageNav
        current="docs"
        context={{ label: "Ship pattern", parentKey: "dashboard" }}
      />

      <header className="mb-12 border-b border-[color:var(--color-line)] pb-8">
        <div className="flex items-baseline gap-3 text-xs uppercase tracking-[0.15em] text-[color:var(--color-mute)] mb-3">
          <span>Recommended pattern</span>
          <span>·</span>
          <span className="mono">docs/site-src/ship-pattern.md</span>
        </div>
      </header>

      <article className="prose-tip leading-relaxed text-[color:var(--color-text)] space-y-4 max-w-3xl">
        {renderDocMarkdown(md)}
      </article>
    </main>
  );
}
