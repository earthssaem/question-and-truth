import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, setPersistence, signInAnonymously, type User } from 'firebase/auth'
import { doc, getFirestore, onSnapshot } from 'firebase/firestore'
import type { Action, Card, Phase, Rank } from './game'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseEnabled = Object.values(config).every(Boolean)
const app = firebaseEnabled ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
const db = app ? getFirestore(app) : null

export interface OnlinePlayer {
  uid: string
  nickname: string
  warningOn: boolean
  ready: boolean
  confirmed: boolean
  betSubmitted: boolean
}

export interface OnlineRoom {
  code: string
  phase: Phase
  round: number
  players: OnlinePlayer[]
  winnerUid: string | null
  action: Action | null
  result: 'truth' | 'false' | 'tie' | null
  message: string
}

export interface OnlinePrivateState {
  cards: Card[]
  tokens: number
}

export async function ensureAnonymousUser(): Promise<User> {
  if (!auth) throw new Error('Firebase 환경 변수가 설정되지 않았습니다.')
  await setPersistence(auth, browserLocalPersistence)
  await auth.authStateReady()
  if (auth.currentUser) return auth.currentUser
  return (await signInAnonymously(auth)).user
}

async function call<TOutput>(action: string, data: Record<string, unknown>): Promise<TOutput> {
  const user = await ensureAnonymousUser()
  const response = await fetch('/api/game', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...data }),
  })
  return readApiResponse<TOutput>(response)
}

export async function readApiResponse<TOutput>(response: Response): Promise<TOutput> {
  const contentType = response.headers.get('content-type') ?? ''
  let payload: unknown

  if (contentType.includes('application/json')) {
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
  } else {
    payload = await response.text()
  }

  if (!response.ok) {
    const jsonMessage = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { message?: unknown } }).error?.message
      : null
    const textMessage = typeof payload === 'string' && !/<(?:!doctype|html)/i.test(payload)
      ? payload.trim().slice(0, 300)
      : ''
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    throw new Error(typeof jsonMessage === 'string' && jsonMessage.trim()
      ? jsonMessage
      : textMessage || `서버 요청에 실패했습니다. (${status})`)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('서버 응답 형식이 올바르지 않습니다.')
  }
  return payload as TOutput
}

export const createOnlineRoom = (nickname: string) => call<{ code: string }>('createRoom', { nickname })
export const joinOnlineRoom = (code: string, nickname: string) => call<{ ok: true }>('joinRoom', { code, nickname })
export const setOnlineReady = (code: string, ready: boolean) => call<{ ok: true }>('setReady', { code, ready })
export const confirmOnlineCards = (code: string, cards: Card[]) => call<{ ok: true }>('confirmCards', { code, cards })
export const submitOnlineBet = (code: string, amount: number) => call<{ ok: true }>('submitBet', { code, amount })
export const chooseOnlineAction = (code: string, action: Action) => call<{ ok: true }>('chooseAction', { code, choice: action })
export const finishOnlineQuestion = (code: string) => call<{ ok: true }>('finishQuestion', { code })
export const submitOnlineTruth = (code: string, guess: Rank[]) => call<{ correct: boolean }>('submitTruth', { code, guess })

export function watchOnlineRoom(code: string, onRoom: (room: OnlineRoom) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined
  return onSnapshot(doc(db, 'rooms', code), (snapshot) => {
    if (!snapshot.exists()) {
      onError(new Error('방을 찾을 수 없습니다.'))
      return
    }
    onRoom(snapshot.data() as OnlineRoom)
  }, onError)
}

export function watchMyState(
  code: string,
  uid: string,
  onState: (state: OnlinePrivateState) => void,
  onError: (error: Error) => void,
) {
  if (!db) return () => undefined
  return onSnapshot(doc(db, 'rooms', code, 'private', uid), (snapshot) => {
    if (!snapshot.exists()) return
    const data = snapshot.data()
    onState({ cards: (data.cards ?? []) as Card[], tokens: Number(data.tokens ?? 10) })
  }, onError)
}
