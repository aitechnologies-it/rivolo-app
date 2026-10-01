import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ settings: new Map<string, unknown>(), importMd: vi.fn(), exportMd: vi.fn() }))
vi.mock('./settingsRepository', () => ({
  getJsonSetting: async (key: string) => mocks.settings.get(key) ?? null,
  setJsonSetting: async (key: string, value: unknown) => { mocks.settings.set(key, structuredClone(value)) },
}))
vi.mock('./importExport', () => ({ importMarkdownToDb: mocks.importMd, exportMarkdownFromDb: mocks.exportMd }))
vi.mock('./oneDriveAuth', () => ({
  authorizedOneDriveFetch: (url: string, init?: RequestInit) => fetch(url, init),
  disconnectOneDriveAuth: vi.fn(),
}))

const item = (eTag = 'v1') => ({ id: 'shared-file', name: 'notes.md', eTag, file: {},
  parentReference: { driveId: 'owner-drive' }, '@microsoft.graph.downloadUrl': 'https://download.example/notes' })
const rev = '/drives/owner-drive/items/shared-file:v1'
const json = (body: unknown, status = 200) => Response.json(body, { status })
const initial = { connected: true, filePath: 'https://1drv.ms/u/s!shared', lastRemoteRev: rev,
  localDirty: true, localRevision: 1, lastPushedHash: null, mergeBaseContent: null }
const content = '<!-- day:2026-09-24 -->\nThursday\n---\n\nCaffè ☕'

beforeEach(() => {
  vi.resetModules()
  mocks.settings.clear()
  mocks.settings.set('onedrive.state', { ...initial })
  mocks.importMd.mockReset().mockResolvedValue({ imported: 1, warnings: [] })
  mocks.exportMd.mockReset().mockResolvedValue(content)
})
afterEach(() => vi.unstubAllGlobals())

describe('OneDrive shared file sync', () => {
  it('resolves the sharing link, updates the owner drive, and uses UTF-8 byte ranges without forwarding auth', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(item()))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockResolvedValueOnce(json(item('v2'), 201))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToOneDrive } = await import('./oneDrive')
    expect(await pushToOneDrive()).toEqual({ status: 'pushed' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/shares\/u![A-Za-z0-9_-]+\/driveItem$/)
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toBe('redeemSharingLink')
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/drives/owner-drive/items/shared-file/createUploadSession')
    expect(fetchMock.mock.calls[1][1].headers['If-Match']).toBe('v1')
    const upload = fetchMock.mock.calls[2][1]
    const uploadedText = new TextDecoder().decode(upload.body)
    expect(uploadedText).toContain(content)
    const length = new TextEncoder().encode(uploadedText).length
    expect(upload.headers['Content-Range']).toBe(`bytes 0-${length - 1}/${length}`)
    expect(upload.headers.Authorization).toBeUndefined()
    const { getOneDriveState } = await import('./oneDriveState')
    expect(await getOneDriveState()).toMatchObject({ localDirty: false, lastRemoteRev: rev.replace('v1', 'v2') })
  })

  it('creates a missing own-drive file with conflictBehavior fail', async () => {
    mocks.settings.set('onedrive.state', { ...initial, filePath: '/rivolo-notes.md', lastRemoteRev: null })
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockResolvedValueOnce(json(item(), 201))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pushToOneDrive()).toEqual({ status: 'pushed' })
    expect(fetchMock.mock.calls[1][0]).toContain('/me/drive/root:/rivolo-notes.md:/createUploadSession')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).item['@microsoft.graph.conflictBehavior']).toBe('fail')
  })

  it.each([409, 412])('retains local edits on upload conflict %s', async (status) => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => init?.method === 'POST' ? json({}, status) : json(item()))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pushToOneDrive()).toEqual({ status: 'blocked', reason: 'remote_changed' })
    expect(mocks.settings.get('onedrive.state')).toMatchObject({ localDirty: true, lastRemoteRev: rev })
  })

  it('merges a newer remote notebook before uploading and refreshes local content', async () => {
    mocks.settings.set('onedrive.state', { ...initial, mergeBaseContent: content })
    mocks.exportMd.mockResolvedValue(`${content}\n\nAlice new`)
    const remoteContent = `${content}\n\nBob new`
    const fetchMock = vi.fn().mockResolvedValueOnce(json(item('v2')))
      .mockResolvedValueOnce(new Response(remoteContent))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockResolvedValueOnce(json(item('v3'), 200))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pushToOneDrive()).toEqual({ status: 'pushed', localUpdated: true })
    expect(fetchMock.mock.calls[2][1].headers['If-Match']).toBe('v2')
    const uploaded = new TextDecoder().decode(fetchMock.mock.calls[3][1].body)
    expect(uploaded).toContain('Bob new\n\nAlice new')
    expect(mocks.importMd).toHaveBeenCalledWith(uploaded, expect.objectContaining({ allowDeletedDays: true }))
    expect(mocks.settings.get('onedrive.state')).toMatchObject({ localDirty: false, mergeBaseContent: uploaded })
  })

  it('keeps old clients safe when a changed remote notebook has no merge base yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(item('v2'))))
    expect(await (await import('./oneDrive')).pushToOneDrive()).toEqual({ status: 'blocked', reason: 'remote_changed' })
  })

  it('re-downloads and merges again when another writer changes the file before upload', async () => {
    mocks.settings.set('onedrive.state', { ...initial, mergeBaseContent: content })
    mocks.exportMd.mockResolvedValue(`${content}\n\nAlice`)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(item('v2')))
      .mockResolvedValueOnce(new Response(`${content}\n\nBob`))
      .mockResolvedValueOnce(json({}, 412))
      .mockResolvedValueOnce(json(item('v3')))
      .mockResolvedValueOnce(new Response(`${content}\n\nBob\n\nCarol`))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockResolvedValueOnce(json(item('v4')))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pushToOneDrive()).toMatchObject({ status: 'pushed', localUpdated: true })
    expect(new TextDecoder().decode(fetchMock.mock.calls[6][1].body)).toContain('Bob\n\nCarol\n\nAlice')
  })

  it('preserves typing during a merged upload and includes it in the next merge without duplicating additions', async () => {
    mocks.settings.set('onedrive.state', { ...initial, mergeBaseContent: content })
    mocks.exportMd.mockResolvedValue(`${content}\n\nAlice`)
    let merged = ''
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(item('v2')))
      .mockResolvedValueOnce(new Response(`${content}\n\nBob`))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockImplementationOnce(async (_url, init) => {
        merged = new TextDecoder().decode(init.body)
        await (await import('./oneDriveState')).markOneDriveLocalDirty()
        mocks.exportMd.mockResolvedValue(`${content}\n\nAlice\n\nAlice later`)
        return json(item('v3'))
      })
    vi.stubGlobal('fetch', fetchMock)
    const { pushToOneDrive } = await import('./oneDrive')
    expect(await pushToOneDrive()).toMatchObject({ status: 'pushed', attention: expect.any(String) })
    expect(mocks.importMd).not.toHaveBeenCalled()
    expect(mocks.settings.get('onedrive.state')).toMatchObject({ localDirty: true, mergeBaseContent: expect.stringContaining(`${content}\n\nAlice`) })
    fetchMock.mockResolvedValueOnce(json(item('v3')))
      .mockResolvedValueOnce(new Response(merged))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockResolvedValueOnce(json(item('v4')))
    expect(await pushToOneDrive()).toMatchObject({ status: 'pushed', localUpdated: true })
    const next = new TextDecoder().decode(fetchMock.mock.calls[7][1].body)
    expect(next).toContain('Bob\n\nAlice\n\nAlice later')
    expect(next.match(/Bob/g)).toHaveLength(1)
    expect(mocks.settings.get('onedrive.state')).toMatchObject({ localDirty: false, mergeBaseContent: next })
  })

  it('never overwrites an existing untracked shared file on a normal push', async () => {
    mocks.settings.set('onedrive.state', { ...initial, lastRemoteRev: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(item())))
    expect(await (await import('./oneDrive')).pushToOneDrive()).toEqual({ status: 'blocked', reason: 'remote_changed' })
  })

  it('allows an explicit force push to replace the remote notebook', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(item('v2')))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockResolvedValueOnce(json(item('v3'), 200))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pushToOneDrive(true)).toEqual({ status: 'pushed' })
    expect(fetchMock.mock.calls[1][1].headers['If-Match']).toBe('v2')
  })

  it('preserves edits made while uploading as dirty', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(item()))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session' }))
      .mockImplementationOnce(async () => {
        await (await import('./oneDriveState')).markOneDriveLocalDirty()
        return json(item('v2'))
      })
    vi.stubGlobal('fetch', fetchMock)
    await (await import('./oneDrive')).pushToOneDrive()
    expect(mocks.settings.get('onedrive.state')).toMatchObject({ localDirty: true, localRevision: 2 })
  })

  it('does not replace dirty notes on ordinary pull', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pullFromOneDrive()).toEqual({ status: 'noop' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pulls a shared file via its preauthorized download URL and marks other providers stale', async () => {
    mocks.settings.set('onedrive.state', { ...initial, localDirty: false })
    const fetchMock = vi.fn().mockResolvedValueOnce(json(item('v2'))).mockResolvedValueOnce(new Response(content))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pullFromOneDrive()).toEqual({ status: 'pulled' })
    expect(fetchMock.mock.calls[1]).toEqual(['https://download.example/notes', { cache: 'no-store' }])
    expect(mocks.importMd).toHaveBeenCalledWith(content, expect.objectContaining({ replace: true, markDirty: false, allowUnsafeImport: undefined, allowDeletedDays: true, beforeReplace: expect.any(Function) }))
    expect(mocks.settings.get('onedrive.state')).toMatchObject({ localDirty: false })
    expect(mocks.settings.get('dropbox.state')).toMatchObject({ localDirty: true })
    expect(mocks.settings.get('google-drive.state')).toMatchObject({ localDirty: true })
  })

  it('does not download an unchanged remote notebook', async () => {
    mocks.settings.set('onedrive.state', { ...initial, localDirty: false, mergeBaseContent: content })
    const fetchMock = vi.fn().mockResolvedValueOnce(json(item()))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await import('./oneDrive')).pullFromOneDrive()).toEqual({ status: 'noop' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.importMd).not.toHaveBeenCalled()
  })

  it('waits for pending editor drafts before downloading', async () => {
    mocks.settings.set('onedrive.state', { ...initial, localDirty: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const unregister = (await import('./pendingEditorSaves')).registerPendingEditorSaves(() => ['2026-09-24'])
    try {
      expect(await (await import('./oneDrive')).pullFromOneDrive()).toEqual({ status: 'noop' })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { unregister() }
  })

  it('detects typing during download before the debounced save reaches the database', async () => {
    mocks.settings.set('onedrive.state', { ...initial, localDirty: false })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(item('v2'))).mockImplementationOnce(async () => {
      (await import('./pendingEditorSaves')).noteEditorChange()
      return new Response(content)
    }))
    await expect((await import('./oneDrive')).pullFromOneDrive()).rejects.toThrow('Notes changed during download')
    expect(mocks.importMd).not.toHaveBeenCalled()
  })

  it('rechecks edits after backup creation and before replacing notes', async () => {
    mocks.settings.set('onedrive.state', { ...initial, localDirty: false })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(item('v2'))).mockResolvedValueOnce(new Response(content)))
    mocks.importMd.mockImplementationOnce(async (_content, options) => {
      (await import('./pendingEditorSaves')).noteEditorChange()
      await options.beforeReplace()
    })
    await expect((await import('./oneDrive')).pullFromOneDrive()).rejects.toThrow('Notes changed during download')
    expect(mocks.settings.get('onedrive.state')).toMatchObject({ lastRemoteRev: rev })
  })

  it('honors Retry-After before issuing another metadata request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToOneDrive } = await import('./oneDrive')
    await expect(pushToOneDrive()).rejects.toThrow('OneDrive is busy')
    await expect(pushToOneDrive()).rejects.toThrow('OneDrive is busy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts a pull if the user edits while the download is running', async () => {
    mocks.settings.set('onedrive.state', { ...initial, localDirty: false })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(item('v2'))).mockImplementationOnce(async () => {
      await (await import('./oneDriveState')).markOneDriveLocalDirty()
      return new Response(content)
    }))
    await expect((await import('./oneDrive')).pullFromOneDrive()).rejects.toThrow('Notes changed during download')
    expect(mocks.importMd).not.toHaveBeenCalled()
  })

  it('preserves sync state when import safety rejects the remote file', async () => {
    mocks.importMd.mockRejectedValue(new Error('Unsafe import'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(item('v2'))).mockResolvedValueOnce(new Response('invalid')))
    await expect((await import('./oneDrive')).pullFromOneDrive({ force: true })).rejects.toThrow('Unsafe import')
    expect(mocks.settings.get('onedrive.state')).toEqual(initial)
  })

  it.each([403, 404])('keeps local notes when a shared link becomes inaccessible (%s)', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, status)))
    await expect((await import('./oneDrive')).pushToOneDrive(true)).rejects.toThrow('OneDrive')
    expect(mocks.settings.get('onedrive.state')).toEqual(initial)
    expect(mocks.importMd).not.toHaveBeenCalled()
  })

  it('rejects folders and invalid targets', async () => {
    const { validateOneDriveTarget, pushToOneDrive } = await import('./oneDrive')
    for (const target of ['/notes.txt', '/../notes.md', '/a//b.md', 'http://1drv.ms/file', '/a?.md']) {
      expect(() => validateOneDriveTarget(target)).toThrow()
    }
    expect(validateOneDriveTarget('')).toBe('/rivolo-notes.md')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...item(), file: undefined })))
    await expect(pushToOneDrive()).rejects.toThrow('not a folder')
  })
})
