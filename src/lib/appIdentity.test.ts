import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { APP_IDENTITY_STORAGE_KEY, createAppIdentityBootstrap } from './appIdentity'

const makePage = (url: string) => new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url,
  runScripts: 'outside-only',
})

describe('app identity before React loads', () => {
  it.each([
    ['https://rivolo.aitlab.it/settings', 'rivolo', 'ait', 'Rivolo x AIT', '/manifest-ait.webmanifest'],
    ['https://rivolo.app/', 'ait', 'rivolo', 'Rivolo', '/manifest.webmanifest'],
    ['http://localhost:5201/', 'ait', 'ait', 'Rivolo x AIT', '/manifest-ait.webmanifest'],
  ] as const)('boots %s with its intended identity', (url, configured, identity, title, manifest) => {
    const page = makePage(url)
    try {
      page.window.eval(createAppIdentityBootstrap(configured))
      expect(page.window.document.documentElement.dataset.appIdentity).toBe(identity)
      expect(page.window.document.title).toBe(title)
      expect(page.window.document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe(manifest)
      expect(page.window.document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
        identity === 'ait' ? '/icons/ait-180.png' : '/apple-touch-icon.png',
      )
    } finally {
      page.window.close()
    }
  })

  it('keeps a deliberate local override when an installed app opens its launch URL', () => {
    const page = makePage('https://rivolo.aitlab.it/?identity=ait')
    try {
      page.window.localStorage.setItem(APP_IDENTITY_STORAGE_KEY, 'rivolo')
      page.window.eval(createAppIdentityBootstrap('ait'))
      expect(page.window.document.title).toBe('Rivolo')
      expect(page.window.localStorage.getItem(APP_IDENTITY_STORAGE_KEY)).toBe('rivolo')
    } finally {
      page.window.close()
    }
  })

  it('carries the installed look into fresh storage and keeps it on subsequent launches', () => {
    const page = makePage('https://rivolo.app/?identity=ait')
    try {
      page.window.eval(createAppIdentityBootstrap('rivolo'))
      expect(page.window.localStorage.getItem(APP_IDENTITY_STORAGE_KEY)).toBe('ait')
      page.window.history.replaceState(null, '', '/')
      page.window.eval(createAppIdentityBootstrap('rivolo'))
      expect(page.window.document.title).toBe('Rivolo x AIT')
    } finally {
      page.window.close()
    }
  })

  it('boots the company identity even when browser storage is blocked', () => {
    const page = makePage('https://rivolo.aitlab.it/?identity=ait')
    try {
      Object.defineProperty(page.window, 'localStorage', { get: () => { throw new Error('Blocked') } })
      expect(() => page.window.eval(createAppIdentityBootstrap('rivolo'))).not.toThrow()
      expect(page.window.document.title).toBe('Rivolo x AIT')
      expect(page.window.document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('Rivolo AIT')
    } finally {
      page.window.close()
    }
  })

  it('ignores invalid preferences and launch parameters', () => {
    const page = makePage('https://rivolo.aitlab.it/?identity=other')
    try {
      page.window.localStorage.setItem(APP_IDENTITY_STORAGE_KEY, 'other')
      page.window.eval(createAppIdentityBootstrap('rivolo'))
      expect(page.window.document.documentElement.dataset.appIdentity).toBe('ait')
    } finally {
      page.window.close()
    }
  })
})
