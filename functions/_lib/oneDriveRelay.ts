import { jsonResponse } from './tokenCookie'

// A configured external binding can still be unavailable when its Worker has
// not been started locally or deployed. Keep this distinct from Graph access.
export async function relayFetch(channel: DurableObjectStub, path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await channel.fetch(`https://channel${path}`, init)
    if (response.status >= 500) throw response
    return response
  } catch {
    throw jsonResponse({ message: 'OneDrive relay and migration registry are unavailable. Locally, restart npm run dev:cloud to start Pages and its Worker together.' }, 503)
  }
}
