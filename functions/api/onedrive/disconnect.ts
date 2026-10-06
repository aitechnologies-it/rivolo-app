import {
  oneDriveAllowedOrigins,
  oneDriveCookieConfig,
  type OneDriveOAuthEnv,
} from '../../_lib/oneDriveOAuth'
import {
  clearTokenCookieHeader,
  jsonResponse,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<OneDriveOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, oneDriveAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const config = oneDriveCookieConfig(env)

  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearTokenCookieHeader(request, config),
  })
}
