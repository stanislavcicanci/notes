'use client'

export default function Error({ error, reset }) {
  return (
    <div style={{ padding: 20, fontFamily: 'monospace', fontSize: 12 }}>
      <h2>Eroare!</h2>
      <pre style={{ whiteSpace: 'pre-wrap', color: 'red' }}>
        {error?.message}
        {'\n\n'}
        {error?.stack}
      </pre>
      <button onClick={() => reset()}>Reîncearcă</button>
    </div>
  )
}