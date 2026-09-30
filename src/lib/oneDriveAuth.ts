import { getOneDriveState, updateOneDriveState } from './oneDriveState'
import { createAuthorizedFetch, parseApiError } from './syncAuth'

const ONEDRIVE_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const ONEDRIVE_API = 'https://graph.microsoft.com/v1.0'
const ONEDRIVE_SCOPE = 'offline_access User.Read Files.ReadWrite.All'
const ONEDRIVE_OAUTH_STORAGE = 'onedrive.oauth'
const ACCESS_TOKEN_REFRESH_BUFFER = 60_000

type TokenPayload = {
  accessToken: string
  expiresAt: number
}

type OneDriveOAuthSession = {
  codeVerifier: string
  state: string
  createdAt: number
}

type OneDriveAccount = {
  id: string
  mail: string | null
  userPrincipalName: string
  displayName: string
}

let memoryToken: TokenPayload | null = null

const encoder = new TextEncoder()

const toBase64Url = (value: ArrayBuffer | Uint8Array) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const createRandomToken = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : toBase64Url(crypto.getRandomValues(new Uint8Array(16)))

const createCodeVerifier = () => toBase64Url(crypto.getRandomValues(new Uint8Array(64)))

const createCodeChallenge = async (verifier: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return toBase64Url(digest)
}

const getOneDriveClientId = async () => {
  const response = await fetch('/api/onedrive/config', { cache: 'no-store' })
  if (!response.ok) throw await parseApiError(response, 'OneDrive sync is not configured.')
  const payload = (await response.json().catch(() => null)) as { clientId?: string } | null
  if (!payload?.clientId) {
    throw new Error('OneDrive authentication API is unavailable. For local development, run npm run dev:cloud and open http://localhost:8788.')
  }
  return payload.clientId
}

const getOneDriveRedirectUri = () => `${window.location.origin}/auth/onedrive/callback`

const saveOAuthSession = (payload: OneDriveOAuthSession) => {
  sessionStorage.setItem(ONEDRIVE_OAUTH_STORAGE, JSON.stringify(payload))
}

const loadOAuthSession = () => {
  const stored = sessionStorage.getItem(ONEDRIVE_OAUTH_STORAGE)
  if (!stored) return null
  try {
    return JSON.parse(stored) as OneDriveOAuthSession
  } catch {
    return null
  }
}

const clearOAuthSession = () => {
  sessionStorage.removeItem(ONEDRIVE_OAUTH_STORAGE)
}

const fetchOneDriveAccount = async (accessToken: string) => {
  const response = await fetch(`${ONEDRIVE_API}/me?$select=id,displayName,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error('Connected, but OneDrive account details could not be loaded.')
  }
  return (await response.json()) as OneDriveAccount
}

export const startOneDriveAuth = async () => {
  const clientId = await getOneDriveClientId()
  const codeVerifier = createCodeVerifier()
  const codeChallenge = await createCodeChallenge(codeVerifier)
  const state = createRandomToken()
  saveOAuthSession({ codeVerifier, state, createdAt: Date.now() })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getOneDriveRedirectUri(),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    scope: ONEDRIVE_SCOPE,
    state,
  })

  window.location.assign(`${ONEDRIVE_AUTH}?${params.toString()}`)
}

const exchangeAuthorizationCode = async (code: string, codeVerifier: string) => {
  const response = await fetch('/api/onedrive/exchange', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest',
    },
    body: JSON.stringify({ code, codeVerifier }),
  })
  if (!response.ok) throw await parseApiError(response, 'OneDrive connect failed.')
  memoryToken = (await response.json()) as TokenPayload
  return memoryToken
}

const completeAuth = async (code: string, returnedState: string | null) => {
  const oauthSession = loadOAuthSession()
  if (!oauthSession || typeof oauthSession.createdAt !== 'number' ||
      typeof oauthSession.codeVerifier !== 'string' || !oauthSession.state ||
      Date.now() - oauthSession.createdAt > 10 * 60_000) {
    throw new Error('OneDrive login expired. Please try again.')
  }
  if (returnedState !== oauthSession.state) {
    throw new Error('OneDrive auth state mismatch.')
  }
  clearOAuthSession()

  const token = await exchangeAuthorizationCode(code, oauthSession.codeVerifier)
  await updateOneDriveState({ connected: true, accountId: null, accountEmail: null, accountName: null,
    lastRemoteRev: null, lastPushedHash: null, lastSyncAt: null })
  try {
    const account = await fetchOneDriveAccount(token.accessToken)
    await updateOneDriveState({
      accountId: account.id,
      accountEmail: account.mail ?? account.userPrincipalName,
      accountName: account.displayName,
    })
  } catch {
    // Account metadata is optional; the OneDrive grant itself is enough to sync.
  }
}

export const getOneDriveAccessToken = async (forceRefresh = false) => {
  if (
    !forceRefresh &&
    memoryToken &&
    Date.now() < memoryToken.expiresAt - ACCESS_TOKEN_REFRESH_BUFFER
  ) {
    return memoryToken.accessToken
  }

  const response = await fetch('/api/onedrive/token', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XmlHttpRequest' },
  })
  if (!response.ok) {
    if (response.status === 401) {
      memoryToken = null
      await updateOneDriveState({ connected: false })
    }
    throw await parseApiError(response, 'OneDrive authorization failed.')
  }
  memoryToken = (await response.json()) as TokenPayload
  return memoryToken.accessToken
}

export const authorizedOneDriveFetch = createAuthorizedFetch(getOneDriveAccessToken)

export const disconnectOneDriveAuth = async () => {
  try {
    await fetch('/api/onedrive/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XmlHttpRequest' },
    }).catch(() => undefined)
  } finally {
    memoryToken = null
  }
}

export const isOneDriveConnected = async () => {
  const state = await getOneDriveState()
  return state.connected
}

let completion: { code: string; state: string | null; promise: Promise<void> } | null = null
export const completeOneDriveAuth = (code: string, state: string | null) => {
  if (completion?.code === code && completion.state === state) return completion.promise
  const promise = completeAuth(code, state)
  completion = { code, state, promise }
  return promise
}
