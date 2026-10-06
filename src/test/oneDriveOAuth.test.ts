// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { oneDriveCookieConfig, type OneDriveOAuthEnv } from '../../functions/_lib/oneDriveOAuth'
import { createTokenCookieHeader, readStoredToken } from '../../functions/_lib/tokenCookie'
import { onRequestPost as exchange } from '../../functions/api/onedrive/exchange'
import { onRequestPost as refresh } from '../../functions/api/onedrive/token'
import { onRequestPost as disconnect } from '../../functions/api/onedrive/disconnect'
import { onRequestGet as config } from '../../functions/api/onedrive/config'

const env: OneDriveOAuthEnv = { ONEDRIVE_CLIENT_ID: 'client', ONEDRIVE_CLIENT_SECRET: 'secret',
  ONEDRIVE_TOKEN_ENCRYPTION_KEY: 'test-only-encryption-key', ONEDRIVE_ALLOWED_ORIGINS: 'https://rivolo.test' }
const request = (route: string, body?: object, cookie?: string) => new Request(`https://rivolo.test/api/onedrive/${route}`, {
  method: 'POST', headers: { Origin: 'https://rivolo.test', 'X-Requested-With': 'XmlHttpRequest',
    'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})
afterEach(() => vi.unstubAllGlobals())

describe('OneDrive OAuth Pages Functions', () => {
  it('returns only public configuration and rejects incomplete setup', async () => {
    const result = await config({ env } as never) as Response
    expect(await result.json()).toEqual({ clientId: 'client' })
    expect((await config({ env: { ...env, ONEDRIVE_CLIENT_SECRET: '' } } as never) as Response).status).toBe(503)
  })

  it('exchanges a PKCE code server-side, keeps the refresh token in an encrypted HttpOnly cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'access', refresh_token: 'private-refresh', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await exchange({ request: request('exchange', { code: 'auth-code', codeVerifier: 'verifier' }), env } as never) as Response
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ accessToken: 'access' })
    const params = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(fetchMock.mock.calls[0][0]).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(params.get('client_secret')).toBe('secret')
    expect(params.get('code_verifier')).toBe('verifier')
    expect(params.get('redirect_uri')).toBe('https://rivolo.test/auth/onedrive/callback')
    const cookie = result.headers.get('Set-Cookie')!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Path=/api/onedrive')
    expect(cookie).not.toContain('private-refresh')
    expect(await readStoredToken(request('token', undefined, cookie.split(';')[0]), oneDriveCookieConfig(env))).toBe('private-refresh')
  })

  it('rotates refresh credentials without returning them to JavaScript', async () => {
    const cookie = await createTokenCookieHeader(request('token'), oneDriveCookieConfig(env), 'old-refresh')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ access_token: 'access', refresh_token: 'rotated-refresh', expires_in: 3600 })))
    const result = await refresh({ request: request('token', undefined, cookie.split(';')[0]), env } as never) as Response
    const payload = await result.json()
    expect(payload).toMatchObject({ accessToken: 'access' })
    expect(JSON.stringify(payload)).not.toContain('refresh')
    const updated = result.headers.get('Set-Cookie')!.split(';')[0]
    expect(await readStoredToken(request('token', undefined, updated), oneDriveCookieConfig(env))).toBe('rotated-refresh')
  })

  it('rejects foreign origins and missing PKCE verifiers', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const foreign = new Request('https://rivolo.test/api/onedrive/exchange', { method: 'POST', headers: { Origin: 'https://other.test', 'X-Requested-With': 'XmlHttpRequest' } })
    expect((await exchange({ request: foreign, env } as never) as Response).status).toBe(403)
    expect((await exchange({ request: request('exchange', { code: 'code' }), env } as never) as Response).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears expired credentials and reports reconnection', async () => {
    const cookie = await createTokenCookieHeader(request('token'), oneDriveCookieConfig(env), 'expired')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 })))
    const result = await refresh({ request: request('token', undefined, cookie.split(';')[0]), env } as never) as Response
    expect(result.status).toBe(401)
    expect(result.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('disconnects by clearing the scoped cookie without touching notes or files', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await disconnect({ request: request('disconnect'), env } as never) as Response
    expect(result.status).toBe(200)
    expect(result.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
