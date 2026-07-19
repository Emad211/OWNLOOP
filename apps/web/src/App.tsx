import { APP_NAME, BOOTSTRAP_LABEL } from "@ownloop/contracts";

export function App() {
  return (
    <main>
      <p className="label">{BOOTSTRAP_LABEL}</p>
      <h1>{APP_NAME}</h1>
      <p>Local development workspace is ready.</p>
    </main>
  );
}
