import { Session } from "./session";

export default function Home() {
  return (
    <main>
      <h1>Acme Shop</h1>
      <p className="muted">Live dashboards on your own orders.</p>
      <Session />
    </main>
  );
}
