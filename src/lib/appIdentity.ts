export type AppIdentity = 'rivolo' | 'ait'

export const APP_IDENTITY_STORAGE_KEY = 'rivolo.appearance.identity'

export const appIdentities = {
  rivolo: {
    label: 'Rivolo',
    name: 'Rivolo',
    shortName: 'Rivolo',
    description: 'Your daily stream.',
    icon: '/apple-touch-icon.png',
    favicon: '/favicon.ico',
    faviconType: 'image/x-icon',
    manifest: '/manifest.webmanifest',
    source: 'https://github.com/diegobit/rivolo-app',
  },
  ait: {
    label: 'AIT',
    name: 'Rivolo x AIT',
    shortName: 'Rivolo AIT',
    description: 'Your team’s daily stream.',
    icon: '/icons/ait-180.png',
    favicon: '/favicon.ico',
    faviconType: 'image/x-icon',
    manifest: '/manifest-ait.webmanifest',
    source: 'https://github.com/aitechnologies-it/rivolo-app',
  },
} as const

export const isAppIdentity = (value: unknown): value is AppIdentity =>
  value === 'rivolo' || value === 'ait'

type IdentityBootstrapOptions = {
  identities: typeof appIdentities
  storageKey: string
  defaultIdentity: AppIdentity
  identity?: AppIdentity
  persist?: boolean
}

// Keep this function self-contained: Vite also runs its serialized form in the
// document head, before React loads or Safari reads the installation metadata.
export function initializeAppIdentity(options: IdentityBootstrapOptions): AppIdentity {
  const validIdentity = (value: unknown): value is AppIdentity =>
    value === 'rivolo' || value === 'ait'

  let storedIdentity: string | null = null
  try {
    storedIdentity = window.localStorage.getItem(options.storageKey)
  } catch {
    // Branding still works when browser storage is unavailable.
  }

  const launchIdentity = new URLSearchParams(window.location.search).get('identity')
  const hostname = window.location.hostname
  const defaultIdentity = hostname === 'rivolo.aitlab.it'
    ? 'ait'
    : hostname === 'rivolo.app'
      ? 'rivolo'
      : options.defaultIdentity
  const identity = options.identity ?? (
    validIdentity(storedIdentity) ? storedIdentity
      : validIdentity(launchIdentity) ? launchIdentity
        : defaultIdentity
  )
  const brand = options.identities[identity]

  if (options.persist || (!validIdentity(storedIdentity) && validIdentity(launchIdentity))) {
    try {
      window.localStorage.setItem(options.storageKey, identity)
    } catch {
      // The current session can still use the selected identity.
    }
  }

  document.documentElement.dataset.appIdentity = identity
  document.documentElement.dataset.appDefaultIdentity = options.defaultIdentity
  document.title = brand.name

  const setLink = (rel: string, href: string, type?: string) => {
    let link = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`)
    if (!link) {
      link = document.createElement('link')
      link.rel = rel
      document.head.append(link)
    }
    link.setAttribute('href', href)
    if (type) link.type = type
  }
  setLink('icon', brand.favicon, brand.faviconType)
  setLink('apple-touch-icon', brand.icon)
  setLink('manifest', brand.manifest)

  let titleMeta = document.querySelector<HTMLMetaElement>("meta[name='apple-mobile-web-app-title']")
  if (!titleMeta) {
    titleMeta = document.createElement('meta')
    titleMeta.name = 'apple-mobile-web-app-title'
    document.head.append(titleMeta)
  }
  titleMeta.content = brand.shortName
  return identity
}

const getIdentityOptions = (): IdentityBootstrapOptions => {
  const configured = typeof document === 'undefined'
    ? null
    : document.documentElement.dataset.appDefaultIdentity
  return {
    identities: appIdentities,
    storageKey: APP_IDENTITY_STORAGE_KEY,
    defaultIdentity: isAppIdentity(configured) ? configured : 'rivolo',
  }
}

export const getInitialAppIdentity = (): AppIdentity => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 'rivolo'
  const bootIdentity = document.documentElement.dataset.appIdentity
  return isAppIdentity(bootIdentity) ? bootIdentity : initializeAppIdentity(getIdentityOptions())
}

export const syncAppIdentity = (identity: AppIdentity) =>
  initializeAppIdentity({ ...getIdentityOptions(), identity, persist: true })

export const createAppIdentityBootstrap = (defaultIdentity: AppIdentity) =>
  `(${initializeAppIdentity.toString()})(${JSON.stringify({
    identities: appIdentities,
    storageKey: APP_IDENTITY_STORAGE_KEY,
    defaultIdentity,
  })});`
