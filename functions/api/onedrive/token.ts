import {
  oneDriveAllowedOrigins,
  oneDriveCookieConfig,
  refreshOneDriveAccessToken,
  toPublicOneDriveError,
  type OneDriveOAuthEnv,
} from '../../_lib/oneDriveOAuth'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<OneDriveOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, oneDriveAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const config = oneDriveCookieConfig(env)
  const refreshToken = await readStoredToken(request, config)
  if (!refreshToken) {
    return jsonResponse({ code: 'AUTH_REQUIRED', message: 'Connect OneDrive to sync.' }, 401, {
      'Set-Cookie': clearTokenCookieHeader(request, config),
    })
  }

  try {
    const token = await refreshOneDriveAccessToken(refreshToken, env)
    // Microsoft rotates refresh tokens. Persist the replacement in the encrypted cookie.
    const nextRefreshToken = token.refresh_token ?? refreshToken
    return jsonResponse(
      {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      },
      200,
      { 'Set-Cookie': await createTokenCookieHeader(request, config, nextRefreshToken) },
    )
  } catch (error) {
    const publicError = toPublicOneDriveError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401 ? { 'Set-Cookie': clearTokenCookieHeader(request, config) } : {}),
    })
  }
}
