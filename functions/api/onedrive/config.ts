import { type OneDriveOAuthEnv } from '../../_lib/oneDriveOAuth'
import { jsonResponse } from '../../_lib/tokenCookie'

export const onRequestGet: PagesFunction<OneDriveOAuthEnv> = async ({ env }) => {
  if (!env.ONEDRIVE_CLIENT_SECRET || !env.ONEDRIVE_CLIENT_ID || !env.ONEDRIVE_TOKEN_ENCRYPTION_KEY) {
    return jsonResponse({ code: 'NOT_CONFIGURED', message: 'OneDrive sync is not configured.' }, 503)
  }
  return jsonResponse({ clientId: env.ONEDRIVE_CLIENT_ID })
}
