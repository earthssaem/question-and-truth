import { getAdminServices } from '../server/firebase-admin.js'
import { executeGameAction, GameApiError } from '../server/game-service.js'

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer (.+)$/i)
  if (!match) throw new GameApiError('unauthenticated', '로그인이 필요합니다.', 401)
  return match[1]
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return json({ error: { code: 'method-not-allowed', message: 'POST 요청만 허용됩니다.' } }, 405)
    }

    try {
      const { auth, db } = getAdminServices()
      let uid: string
      try {
        uid = (await auth.verifyIdToken(bearerToken(request))).uid
      } catch (error) {
        if (error instanceof GameApiError) throw error
        throw new GameApiError('unauthenticated', '인증 정보가 올바르지 않습니다.', 401)
      }
      const body = await request.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new GameApiError('invalid-argument', '요청 형식이 올바르지 않습니다.')
      }
      return json(await executeGameAction(db, uid, body as Record<string, unknown>))
    } catch (error) {
      if (error instanceof GameApiError) {
        return json({ error: { code: error.code, message: error.message } }, error.status)
      }
      console.error(error)
      return json({ error: { code: 'internal', message: '서버 요청을 처리하지 못했습니다.' } }, 500)
    }
  },
}
