import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { completeOneDriveAuth } from '../lib/oneDriveAuth'
import { useOneDriveStore } from '../store/useOneDriveStore'
import { useSyncStore } from '../store/useSyncStore'

export default function OneDriveCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { loadState: loadOneDriveState } = useOneDriveStore()
  const { setActiveProvider } = useSyncStore()
  const errorParam = searchParams.get('error_description') ?? searchParams.get('error')
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const initialError = errorParam ? `OneDrive auth failed: ${errorParam}` : code ? null : 'Missing OneDrive authorization code.'
  const [status, setStatus] = useState(initialError ? 'OneDrive connection could not be completed.' : 'Connecting to OneDrive...')
  const [error, setError] = useState<string | null>(initialError)

  useEffect(() => {
    if (initialError || !code) {
      return
    }

    void (async () => {
      try {
        await completeOneDriveAuth(code, state)
        await loadOneDriveState()
        await setActiveProvider('onedrive')
        setStatus('OneDrive connected. Redirecting...')
        navigate('/settings', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'OneDrive connect failed.')
      }
    })()
  }, [code, initialError, loadOneDriveState, navigate, setActiveProvider, state])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-600">OneDrive Connect</h2>
      <p className="mt-3 text-sm text-slate-500">{error ?? status}</p>
      {!error && (
        <p className="mt-2 text-xs text-slate-400">You can close this tab if it does not redirect.</p>
      )}
    </section>
  )
}
