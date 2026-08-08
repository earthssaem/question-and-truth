import { describe, expect, it } from 'vitest'
import { readApiResponse } from './firebase'

describe('API response parsing', () => {
  it('JSON 오류 메시지를 그대로 전달한다', async () => {
    const response = Response.json({ error: { message: '인증 정보가 올바르지 않습니다.' } }, { status: 401 })
    await expect(readApiResponse(response)).rejects.toThrow('인증 정보가 올바르지 않습니다.')
  })

  it('JSON이 아닌 서버 오류도 상태 코드와 함께 안전하게 처리한다', async () => {
    const response = new Response('<!doctype html><h1>Function crashed</h1>', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(readApiResponse(response)).rejects.toThrow('서버 요청에 실패했습니다. (500 Internal Server Error)')
  })

  it('정상 JSON 응답을 반환한다', async () => {
    const response = Response.json({ ok: true })
    await expect(readApiResponse<{ ok: boolean }>(response)).resolves.toEqual({ ok: true })
  })
})
