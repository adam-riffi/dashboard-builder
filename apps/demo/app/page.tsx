import { Session } from "./session";
import { TryIt } from "./try-it";

export default function Home() {
  return (
    <main>
      <h1>Acme Shop</h1>
      <p className="muted">Live dashboards on your own orders.</p>
      <TryIt />
      <Session />
    </main>
  );
}
