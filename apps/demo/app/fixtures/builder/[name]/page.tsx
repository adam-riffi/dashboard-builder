import { fixtures } from "../../../../fixtures";
import { FixtureBuilder } from "../fixture-builder";

export const metadata = { title: "Builder fixture", robots: { index: false } };
export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(fixtures).map((name) => ({ name }));

/** The builder on another fixture's recorded answers, such as `lost` (ADR 0011). */
export default async function NamedBuilderFixturePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return (
    <main style={{ maxWidth: 1280 }}>
      <FixtureBuilder name={name} />
    </main>
  );
}
