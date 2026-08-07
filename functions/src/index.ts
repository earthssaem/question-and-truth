import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

initializeApp()
const db = getFirestore()
const region = 'asia-northeast3'
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const suits = ['spades', 'hearts', 'diamonds', 'clubs']

type PublicPlayer = {
  uid: string
  nickname: string
  warningOn: boolean
  ready: boolean
  confirmed: boolean
  betSubmitted: boolean
}

type PrivatePlayer = {
  tokens: number
  cards: Card[]
  bet: number | null
  betRound: number | null
}

type Card = { suit: string; rank: string }

function uidOf(request: { auth?: { uid: string } }) {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.')
  return request.auth.uid
}

function cleanNickname(value: unknown) {
  const nickname = String(value ?? '').trim().slice(0, 12)
  if (!nickname) throw new HttpsError('invalid-argument', '닉네임을 입력하세요.')
  return nickname
}

function cleanCode(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpsError('invalid-argument', '올바른 방 코드를 입력하세요.')
  return code
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

function makePublicPlayer(uid: string, nickname: string): PublicPlayer {
  return { uid, nickname, warningOn: false, ready: false, confirmed: false, betSubmitted: false }
}

function makePrivatePlayer(): PrivatePlayer {
  return { tokens: 10, cards: [], bet: null, betRound: null }
}

function requireMember(room: FirebaseFirestore.DocumentData, uid: string) {
  const player = (room.players as PublicPlayer[]).find((item) => item.uid === uid)
  if (!player) throw new HttpsError('permission-denied', '이 방의 플레이어가 아닙니다.')
  return player
}

function patchPlayer(players: PublicPlayer[], uid: string, patch: Partial<PublicPlayer>) {
  return players.map((player) => player.uid === uid ? { ...player, ...patch } : player)
}

function validCards(value: unknown): value is Card[] {
  if (!Array.isArray(value) || value.length !== 8) return false
  if (new Set(value.map((card) => `${card?.suit}-${card?.rank}`)).size !== 8) return false
  const lastBySuit = new Map<string, number>()
  for (const card of value) {
    if (!suits.includes(card?.suit) || !ranks.includes(card?.rank)) return false
    const rankIndex = ranks.indexOf(card.rank)
    const previous = lastBySuit.get(card.suit)
    if (previous !== undefined && rankIndex < previous) return false
    lastBySuit.set(card.suit, rankIndex)
  }
  return true
}

function privateRef(code: string, uid: string) {
  return db.doc(`rooms/${code}/private/${uid}`)
}

async function readPrivatePlayers(tx: Transaction, code: string, playerUids: string[]) {
  const refs = playerUids.map((uid) => privateRef(code, uid))
  const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)))
  const states = new Map<string, PrivatePlayer>()
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) throw new HttpsError('failed-precondition', '플레이어 비공개 상태가 없습니다.')
    states.set(playerUids[index], snapshot.data() as PrivatePlayer)
  })
  return { refs, states }
}

function updateWarnings(players: PublicPlayer[], states: Map<string, PrivatePlayer>, resetBet: boolean) {
  return players.map((player) => ({
    ...player,
    warningOn: (states.get(player.uid)?.tokens ?? 10) <= 5,
    betSubmitted: resetBet ? false : player.betSubmitted,
  }))
}

function advanceRound(
  tx: Transaction,
  roomRef: DocumentReference,
  room: FirebaseFirestore.DocumentData,
  refs: DocumentReference[],
  states: Map<string, PrivatePlayer>,
  result: 'false' | 'tie' | null,
  message: string,
) {
  if (Number(room.settledRound ?? 0) >= Number(room.round)) return false

  for (const [index, uid] of (room.playerUids as string[]).entries()) {
    const current = states.get(uid)!
    const tokens = current.tokens + 2
    states.set(uid, { ...current, tokens, bet: null, betRound: null })
    tx.update(refs[index], { tokens, bet: null, betRound: null })
  }

  tx.update(roomRef, {
    phase: 'betting',
    round: Number(room.round) + 1,
    settledRound: Number(room.round),
    players: updateWarnings(room.players as PublicPlayer[], states, true),
    winnerUid: null,
    action: null,
    result,
    message,
  })
  return true
}

export const createRoom = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const nickname = cleanNickname(request.data.nickname)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode()
    const roomRef = db.doc(`rooms/${code}`)
    if ((await roomRef.get()).exists) continue

    const batch = db.batch()
    batch.create(roomRef, {
      code,
      phase: 'lobby',
      round: 1,
      settledRound: 0,
      players: [makePublicPlayer(uid, nickname)],
      playerUids: [uid],
      winnerUid: null,
      action: null,
      result: null,
      message: '상대를 기다리는 중입니다.',
      createdAt: FieldValue.serverTimestamp(),
    })
    batch.create(privateRef(code, uid), makePrivatePlayer())
    await batch.commit()
    return { code }
  }
  throw new HttpsError('resource-exhausted', '방 코드를 만들지 못했습니다. 다시 시도하세요.')
})

export const joinRoom = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const code = cleanCode(request.data.code)
  const nickname = cleanNickname(request.data.nickname)
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    if (!snapshot.exists) throw new HttpsError('not-found', '방을 찾을 수 없습니다.')
    const room = snapshot.data()!
    if (room.playerUids.includes(uid)) return
    if (room.players.length >= 2 || room.phase !== 'lobby') throw new HttpsError('failed-precondition', '입장할 수 없는 방입니다.')
    tx.create(privateRef(code, uid), makePrivatePlayer())
    tx.update(roomRef, {
      players: [...room.players, makePublicPlayer(uid, nickname)],
      playerUids: [...room.playerUids, uid],
      message: '두 플레이어가 입장했습니다.',
    })
  })
  return { ok: true }
})

export const setReady = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const code = cleanCode(request.data.code)
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    const room = snapshot.data()
    if (!room) throw new HttpsError('not-found', '방을 찾을 수 없습니다.')
    requireMember(room, uid)
    if (room.phase !== 'lobby') throw new HttpsError('failed-precondition', '준비 상태를 변경할 수 없습니다.')
    const players = patchPlayer(room.players, uid, { ready: Boolean(request.data.ready) })
    const phase = players.length === 2 && players.every((player) => player.ready) ? 'card_selection' : 'lobby'
    tx.update(roomRef, { players, phase, message: phase === 'card_selection' ? '카드 8장을 선택하세요.' : '준비를 기다리는 중입니다.' })
  })
  return { ok: true }
})

export const confirmCards = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const code = cleanCode(request.data.code)
  const cards = request.data.cards
  if (!validCards(cards)) throw new HttpsError('invalid-argument', '카드 배열이 올바르지 않습니다.')
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    const room = snapshot.data()
    if (!room || room.phase !== 'card_selection') throw new HttpsError('failed-precondition', '카드를 확정할 수 없는 단계입니다.')
    const player = requireMember(room, uid)
    if (player.confirmed) throw new HttpsError('already-exists', '이미 카드 배치를 확정했습니다.')
    const players = patchPlayer(room.players, uid, { confirmed: true })
    const allConfirmed = players.length === 2 && players.every((item) => item.confirmed)
    tx.update(privateRef(code, uid), { cards })
    tx.update(roomRef, {
      players,
      phase: allConfirmed ? 'betting' : 'card_selection',
      message: allConfirmed ? '비공개 베팅을 시작합니다.' : '상대가 카드 배치를 확정하고 있습니다.',
    })
  })
  return { ok: true }
})

export const submitBet = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const code = cleanCode(request.data.code)
  const amount = Number(request.data.amount)
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const roomSnapshot = await tx.get(roomRef)
    const room = roomSnapshot.data()
    if (!room || room.phase !== 'betting') throw new HttpsError('failed-precondition', '베팅할 수 없는 단계입니다.')
    const player = requireMember(room, uid)
    if (player.betSubmitted) throw new HttpsError('already-exists', '이미 이번 라운드에 베팅했습니다.')

    const ownRef = privateRef(code, uid)
    const ownSnapshot = await tx.get(ownRef)
    const ownState = ownSnapshot.data() as PrivatePlayer | undefined
    if (!ownState) throw new HttpsError('failed-precondition', '플레이어 비공개 상태가 없습니다.')
    if (!Number.isInteger(amount) || amount < 1 || amount > ownState.tokens) throw new HttpsError('invalid-argument', '베팅 수치가 올바르지 않습니다.')

    const players = patchPlayer(room.players, uid, { betSubmitted: true })
    if (!players.every((item) => item.betSubmitted)) {
      tx.update(ownRef, { bet: amount, betRound: room.round })
      tx.update(roomRef, { players, message: '상대가 베팅을 완료했습니다.' })
      return
    }

    const otherUid = (room.playerUids as string[]).find((item) => item !== uid)!
    const otherRef = privateRef(code, otherUid)
    const otherSnapshot = await tx.get(otherRef)
    const otherState = otherSnapshot.data() as PrivatePlayer | undefined
    if (!otherState || otherState.betRound !== room.round || !Number.isInteger(otherState.bet)) {
      throw new HttpsError('failed-precondition', '상대의 베팅 상태가 올바르지 않습니다.')
    }
    const otherBet = otherState.bet as number

    const privateByUid = new Map<string, PrivatePlayer>([
      [uid, { ...ownState, bet: amount, betRound: room.round }],
      [otherUid, otherState],
    ])
    const betByUid = new Map<string, number>([[uid, amount], [otherUid, otherBet]])
    for (const playerUid of room.playerUids as string[]) {
      const state = privateByUid.get(playerUid)!
      privateByUid.set(playerUid, { ...state, tokens: state.tokens - betByUid.get(playerUid)! })
    }

    const refs = (room.playerUids as string[]).map((playerUid) => privateRef(code, playerUid))
    if (amount === otherBet) {
      const tieRoom = { ...room, players }
      advanceRound(tx, roomRef, tieRoom, refs, privateByUid, 'tie', '베팅이 동점입니다. 행동 없이 다음 라운드를 시작합니다.')
      return
    }

    for (const [index, playerUid] of (room.playerUids as string[]).entries()) {
      const state = privateByUid.get(playerUid)!
      tx.update(refs[index], { tokens: state.tokens, bet: null, betRound: null })
    }
    const winnerUid = amount > otherBet ? uid : otherUid
    const winner = players.find((item) => item.uid === winnerUid)!
    tx.update(roomRef, {
      players: updateWarnings(players, privateByUid, false),
      phase: 'action_choice',
      winnerUid,
      action: null,
      result: null,
      message: `${winner.nickname}의 차례입니다.`,
    })
  })
  return { ok: true }
})

export const chooseAction = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const code = cleanCode(request.data.code)
  const action = String(request.data.action)
  if (!['QUESTION', 'TRUTH'].includes(action)) throw new HttpsError('invalid-argument', '행동이 올바르지 않습니다.')
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    const room = snapshot.data()
    if (!room || room.winnerUid !== uid || room.phase !== 'action_choice') throw new HttpsError('permission-denied', '행동권이 없습니다.')
    tx.update(roomRef, {
      phase: action.toLowerCase(),
      action,
      message: action === 'QUESTION' ? '상대에게 직접 질문하세요.' : '카드 배열을 선언하세요.',
    })
  })
  return { ok: true }
})

export const finishQuestion = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const code = cleanCode(request.data.code)
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const roomSnapshot = await tx.get(roomRef)
    const room = roomSnapshot.data()
    if (!room || room.winnerUid !== uid || room.phase !== 'question') throw new HttpsError('permission-denied', '질문을 완료할 수 없습니다.')
    const { refs, states } = await readPrivatePlayers(tx, code, room.playerUids)
    advanceRound(tx, roomRef, room, refs, states, null, '질문이 완료되었습니다. 다음 라운드를 시작합니다.')
  })
  return { ok: true }
})

export const submitTruth = onCall({ region }, async (request) => {
  const uid = uidOf(request)
  const code = cleanCode(request.data.code)
  const guess = request.data.guess
  if (!Array.isArray(guess) || guess.length !== 8 || guess.some((rank) => !ranks.includes(rank))) {
    throw new HttpsError('invalid-argument', '선언이 올바르지 않습니다.')
  }

  let correct = false
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const roomSnapshot = await tx.get(roomRef)
    const room = roomSnapshot.data()
    if (!room || room.winnerUid !== uid || room.phase !== 'truth') throw new HttpsError('permission-denied', '선언할 수 없습니다.')
    const { refs, states } = await readPrivatePlayers(tx, code, room.playerUids)
    const opponentUid = (room.playerUids as string[]).find((item) => item !== uid)!
    const cards = states.get(opponentUid)!.cards
    correct = cards.length === 8 && cards.every((card, index) => card.rank === guess[index])

    if (correct) {
      tx.update(roomRef, { phase: 'game_over', result: 'truth', message: '정답입니다. 게임이 종료되었습니다.' })
      return
    }
    advanceRound(tx, roomRef, room, refs, states, 'false', 'FALSE. 진실 선언에 실패해 다음 라운드를 시작합니다.')
  })
  return { correct }
})
