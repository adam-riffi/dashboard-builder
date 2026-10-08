import { FixtureBuilder } from "./fixture-builder";

export const metadata = { title: "Builder fixture", robots: { index: false } };

/** The builder on recorded answers, for the M5 tests (no database, no sign-in). */
export default function BuilderFixturePage() {
  return (
    <main style={{ maxWidth: 1280 }}>
      <FixtureBuilder />
    </main>
  );
}
