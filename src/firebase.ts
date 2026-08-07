import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { doc, getFirestore, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import type { Action, Card, Phase, Rank } from './game'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseEnabled = Boolean(config.apiKey && config.projectId && config.appId)
const app = firebaseEnabled ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
const db = app ? getFirestore(app) : null
const functions = app ? getFunctions(app, 'asia-northeast3') : null

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
  if (auth.currentUser) return auth.currentUser
  await signInAnonymously(auth)
  return await new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) { stop(); resolve(user) }
    }, reject)
  })
}

async function call<TInput, TOutput>(name: string, data: TInput): Promise<TOutput> {
  if (!functions) throw new Error('Firebase가 연결되지 않았습니다.')
  const result = await httpsCallable<TInput, TOutput>(functions, name)(data)
  return result.data
}

export const createOnlineRoom = (nickname: string) => call<{ nickname: string }, { code: string }>('createRoom', { nickname })
export const joinOnlineRoom = (code: string, nickname: string) => call('joinRoom', { code, nickname })
export const setOnlineReady = (code: string, ready: boolean) => call('setReady', { code, ready })
export const confirmOnlineCards = (code: string, cards: Card[]) => call('confirmCards', { code, cards })
export const submitOnlineBet = (code: string, amount: number) => call('submitBet', { code, amount })
export const chooseOnlineAction = (code: string, action: Action) => call('chooseAction', { code, action })
export const finishOnlineQuestion = (code: string) => call('finishQuestion', { code })
export const submitOnlineTruth = (code: string, guess: Rank[]) => call('submitTruth', { code, guess })

export function watchOnlineRoom(code: string, onRoom: (room: OnlineRoom) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined
  return onSnapshot(doc(db, 'rooms', code), (snapshot) => {
    if (snapshot.exists()) onRoom(snapshot.data() as OnlineRoom)
  }, onError)
}

export function watchMyState(code: string, uid: string, onState: (state: OnlinePrivateState) => void) {
  if (!db) return () => undefined
  return onSnapshot(doc(db, 'rooms', code, 'private', uid), (snapshot) => {
    if (!snapshot.exists()) return
    const data = snapshot.data()
    onState({ cards: (data.cards ?? []) as Card[], tokens: Number(data.tokens ?? 10) })
  })
}
