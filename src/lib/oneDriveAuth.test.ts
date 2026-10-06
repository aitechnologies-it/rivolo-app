import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const updateState = vi.hoisted(() => vi.fn())
vi.mock('./oneDriveState', () => ({ updateOneDriveState: updateState, getOneDriveState: vi.fn() }))
beforeEach(() => { vi.resetModules(); sessionStorage.clear(); updateState.mockReset() })
afterEach(() => vi.unstubAllGlobals())
const session = () => sessionStorage.setItem('onedrive.oauth', JSON.stringify({ state: 'expected', codeVerifier: 'verifier', createdAt: Date.now() }))

describe('OneDrive OAuth browser flow', () => {
  it('explains missing OAuth endpoints when a plain Vite server returns HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><html></html>')))
    await expect((await import('./oneDriveAuth')).startOneDriveAuth()).rejects.toThrow('OneDrive authentication API is unavailable')
    expect(sessionStorage.getItem('onedrive.oauth')).toBeNull()
  })

  it('rejects missing, expired, and mismatched OAuth sessions without exchanging a code', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { completeOneDriveAuth } = await import('./oneDriveAuth')
    await expect(completeOneDriveAuth('missing', 'expected')).rejects.toThrow('expired')
    session()
    await expect(completeOneDriveAuth('mismatch', 'wrong')).rejects.toThrow('state mismatch')
    sessionStorage.setItem('onedrive.oauth', JSON.stringify({ state: 'expected', codeVerifier: 'verifier', createdAt: 1 }))
    await expect(completeOneDriveAuth('expired', 'expected')).rejects.toThrow('expired')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates StrictMode callbacks and never stores credentials in browser storage', async () => {
    session()
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ accessToken: 'secret-access', expiresAt: Date.now() + 3600_000 }))
      .mockResolvedValueOnce(Response.json({ id: 'user', displayName: 'Person', mail: 'person@example.com' }))
    vi.stubGlobal('fetch', fetchMock)
    const { completeOneDriveAuth, getOneDriveAccessToken } = await import('./oneDriveAuth')
    await Promise.all([completeOneDriveAuth('code', 'expected'), completeOneDriveAuth('code', 'expected')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sessionStorage.getItem('onedrive.oauth')).toBeNull()
    expect(JSON.stringify(updateState.mock.calls)).not.toContain('secret-access')
    expect(await getOneDriveAccessToken()).toBe('secret-access')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('marks the account disconnected when refresh credentials expire', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'Reconnect OneDrive' }, { status: 401 })))
    await expect((await import('./oneDriveAuth')).getOneDriveAccessToken()).rejects.toThrow('Reconnect OneDrive')
    expect(updateState).toHaveBeenCalledWith({ connected: false })
  })
})
