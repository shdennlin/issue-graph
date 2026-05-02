export function Onboarding() {
  return (
    <div className="onboarding">
      <h1>🌟 Welcome to Issue Graph</h1>
      <p>The backend isn’t configured yet.</p>
      <h3>Steps for Linear</h3>
      <ol>
        <li>Go to Linear → Settings → API</li>
        <li>Click <em>Create Personal API Key</em></li>
        <li>Copy the key into your <code>.env</code>:</li>
      </ol>
      <pre>
{`BACKEND=linear
LINEAR_API_KEY=lin_api_xxx`}
      </pre>
      <p>
        Then restart Docker: <code>docker compose restart</code>
      </p>
      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
        For other backends, see the README.
      </p>
    </div>
  )
}
