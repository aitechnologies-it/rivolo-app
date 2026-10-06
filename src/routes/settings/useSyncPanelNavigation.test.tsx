import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useSyncPanelNavigation } from './useSyncPanelNavigation'

describe('sync notification navigation', () => {
  it('waits for settings to load, selects OneDrive from the link, and allows subsequent manual choices', () => {
    const { result, rerender } = renderHook(({ ready }) => useSyncPanelNavigation('dropbox', ready), {
      initialProps: { ready: false },
      wrapper: ({ children }) => <MemoryRouter initialEntries={['/settings?syncProvider=onedrive#settings-sync']}>{children}</MemoryRouter>,
    })
    expect(result.current.openRequest).toBe(0)
    rerender({ ready: true })
    expect(result.current.provider).toBe('onedrive')
    expect(result.current.openRequest).toBe(1)
    act(() => result.current.selectProvider('google-drive'))
    expect(result.current.provider).toBe('google-drive')
    act(() => result.current.openPanel('onedrive'))
    expect(result.current.provider).toBe('onedrive')
    expect(result.current.openRequest).toBe(2)
  })

  it('opens the active provider for legacy links', () => {
    const { result } = renderHook(() => useSyncPanelNavigation('onedrive', true), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={['/settings#settings-sync']}>{children}</MemoryRouter>,
    })
    expect(result.current.provider).toBe('onedrive')
    expect(result.current.openRequest).toBe(1)
  })
})
