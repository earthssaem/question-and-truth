import { FieldValue, type DocumentData, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { randomInt } from 'node:crypto'

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const

type Rank = (typeof RANKS)[number]
type Suit = (typeof SUITS)[number]
type Card = { suit: Suit; rank: Rank }
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

export class GameApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message)
  }
}

function fail(code: string, message: string, status = 400): never {
  throw new GameApiError(code, message, status)
}

export function cleanNickname(value: unknown) {
  const nickname = String(value ?? '').trim().slice(0, 12)
  if (!nickname) fail('invalid-argument', '닉네임을 입력하세요.')
  return nickname
}

export function cleanRoomCode(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) fail('invalid-argument', '올바른 방 코드를 입력하세요.')
  return code
}

export function isValidCardSelection(value: unknown): value is Card[] {
  if (!Array.isArray(value) || value.length !== 8) return false
  if (new Set(value.map((card) => `${card?.suit}-${card?.rank}`)).size !== 8) return false

  const lastBySuit = new Map<Suit, number>()
  for (const card of value) {
    if (!SUITS.includes(card?.suit) || !RANKS.includes(card?.rank)) return false
    const rankIndex = RANKS.indexOf(card.rank)
    const previous = lastBySuit.get(card.suit)
    if (previous !== undefined && rankIndex < previous) return false
    lastBySuit.set(card.suit, rankIndex)
  }
  return true
}

export function isValidTruthGuess(value: unknown): value is Rank[] {
  return Array.isArray(value) && value.length === 8 && value.every((rank) => RANKS.includes(rank))
}

export function shouldWarn(tokens: number) {
  return tokens <= 5
}

export function isValidBetAmount(amount: number, tokens: number) {
  return Number.isInteger(amount) && amount >= 0 && amount <= tokens
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

function makePublicPlayer(uid: string, nickname: string): PublicPlayer {
  return { uid, nickname, warningOn: false, ready: false, confirmed: false, betSubmitted: false }
}

function makePrivatePlayer(): PrivatePlayer {
  return { tokens: 10, cards: [], bet: null, betRound: null }
}

function requireMember(room: DocumentData, uid: string) {
  const player = (room.players as PublicPlayer[]).find((item) => item.uid === uid)
  if (!player) fail('permission-denied', '이 방의 플레이어가 아닙니다.', 403)
  return player
}

function patchPlayer(players: PublicPlayer[], uid: string, patch: Partial<PublicPlayer>) {
  return players.map((player) => player.uid === uid ? { ...player, ...patch } : player)
}

function privateRef(db: Firestore, code: string, uid: string) {
  return db.doc(`rooms/${code}/private/${uid}`)
}

async function readPrivatePlayers(tx: Transaction, db: Firestore, code: string, playerUids: string[]) {
  const refs = playerUids.map((uid) => privateRef(db, code, uid))
  const snapshots = await tx.getAll(...refs)
  const states = new Map<string, PrivatePlayer>()
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) fail('failed-precondition', '플레이어 비공개 상태가 없습니다.')
    states.set(playerUids[index], snapshot.data() as PrivatePlayer)
  })
  return { refs, states }
}

function updateWarnings(players: PublicPlayer[], states: Map<string, PrivatePlayer>, resetBet: boolean) {
  return players.map((player) => ({
    ...player,
    warningOn: shouldWarn(states.get(player.uid)?.tokens ?? 10),
    betSubmitted: resetBet ? false : player.betSubmitted,
  }))
}

function advanceRound(
  tx: Transaction,
  roomRef: DocumentReference,
  room: DocumentData,
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

export async function createRoom(db: Firestore, uid: string, nicknameValue: unknown) {
  const nickname = cleanNickname(nicknameValue)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode()
    const roomRef = db.doc(`rooms/${code}`)
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
    batch.create(privateRef(db, code, uid), makePrivatePlayer())
    try {
      await batch.commit()
      return { code }
    } catch (error) {
      if ((error as { code?: number }).code !== 6) throw error
    }
  }
  fail('resource-exhausted', '방 코드를 만들지 못했습니다. 다시 시도하세요.', 503)
}

export async function joinRoom(db: Firestore, uid: string, codeValue: unknown, nicknameValue: unknown) {
  const code = cleanRoomCode(codeValue)
  const nickname = cleanNickname(nicknameValue)
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    if (!snapshot.exists) fail('not-found', '방을 찾을 수 없습니다.', 404)
    const room = snapshot.data()!
    if ((room.playerUids as string[]).includes(uid)) return
    if ((room.players as PublicPlayer[]).length >= 2 || room.phase !== 'lobby') {
      fail('failed-precondition', '입장할 수 없는 방입니다.')
    }
    tx.create(privateRef(db, code, uid), makePrivatePlayer())
    tx.update(roomRef, {
      players: [...room.players, makePublicPlayer(uid, nickname)],
      playerUids: [...room.playerUids, uid],
      message: '두 플레이어가 입장했습니다.',
    })
  })
  return { ok: true }
}

export async function setReady(db: Firestore, uid: string, codeValue: unknown, readyValue: unknown) {
  const code = cleanRoomCode(codeValue)
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    const room = snapshot.data()
    if (!room) fail('not-found', '방을 찾을 수 없습니다.', 404)
    requireMember(room, uid)
    if (room.phase !== 'lobby') fail('failed-precondition', '준비 상태를 변경할 수 없는 단계입니다.')
    const players = patchPlayer(room.players as PublicPlayer[], uid, { ready: Boolean(readyValue) })
    const phase = players.length === 2 && players.every((player) => player.ready) ? 'card_selection' : 'lobby'
    tx.update(roomRef, {
      players,
      phase,
      message: phase === 'card_selection' ? '카드 8장을 선택하세요.' : '준비를 기다리는 중입니다.',
    })
  })
  return { ok: true }
}

export async function confirmCards(db: Firestore, uid: string, codeValue: unknown, cardsValue: unknown) {
  const code = cleanRoomCode(codeValue)
  if (!isValidCardSelection(cardsValue)) fail('invalid-argument', '카드 배열이 올바르지 않습니다.')
  const cards = cardsValue
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    const room = snapshot.data()
    if (!room || room.phase !== 'card_selection') fail('failed-precondition', '카드를 확정할 수 없는 단계입니다.')
    const player = requireMember(room, uid)
    if (player.confirmed) return
    const players = patchPlayer(room.players as PublicPlayer[], uid, { confirmed: true })
    const allConfirmed = players.length === 2 && players.every((item) => item.confirmed)
    tx.update(privateRef(db, code, uid), { cards })
    tx.update(roomRef, {
      players,
      phase: allConfirmed ? 'betting' : 'card_selection',
      message: allConfirmed ? '비공개 베팅을 시작합니다.' : '상대가 카드 배치를 확정하고 있습니다.',
    })
  })
  return { ok: true }
}

export async function submitBet(db: Firestore, uid: string, codeValue: unknown, amountValue: unknown) {
  const code = cleanRoomCode(codeValue)
  const amount = typeof amountValue === 'number' ? amountValue : Number.NaN
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const roomSnapshot = await tx.get(roomRef)
    const room = roomSnapshot.data()
    if (!room || room.phase !== 'betting') fail('failed-precondition', '베팅할 수 없는 단계입니다.')
    const player = requireMember(room, uid)
    const ownRef = privateRef(db, code, uid)
    const ownSnapshot = await tx.get(ownRef)
    const ownState = ownSnapshot.data() as PrivatePlayer | undefined
    if (!ownState) fail('failed-precondition', '플레이어 비공개 상태가 없습니다.')
    if (!isValidBetAmount(amount, ownState.tokens)) {
      fail('invalid-argument', '베팅 수치가 올바르지 않습니다.')
    }
    if (player.betSubmitted) {
      if (ownState.betRound === room.round && ownState.bet === amount) return
      fail('already-exists', '이미 이번 라운드에 베팅했습니다.', 409)
    }

    const players = patchPlayer(room.players as PublicPlayer[], uid, { betSubmitted: true })
    if (!players.every((item) => item.betSubmitted)) {
      tx.update(ownRef, { bet: amount, betRound: room.round })
      tx.update(roomRef, { players, message: '상대가 베팅을 완료하기를 기다리고 있습니다.' })
      return
    }

    const otherUid = (room.playerUids as string[]).find((item) => item !== uid)
    if (!otherUid) fail('failed-precondition', '상대 플레이어가 없습니다.')
    const otherRef = privateRef(db, code, otherUid)
    const otherSnapshot = await tx.get(otherRef)
    const otherState = otherSnapshot.data() as PrivatePlayer | undefined
    if (!otherState || otherState.betRound !== room.round || !Number.isInteger(otherState.bet)) {
      fail('failed-precondition', '상대의 베팅 상태가 올바르지 않습니다.')
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

    const refs = (room.playerUids as string[]).map((playerUid) => privateRef(db, code, playerUid))
    if (amount === otherBet) {
      advanceRound(
        tx,
        roomRef,
        { ...room, players },
        refs,
        privateByUid,
        'tie',
        '베팅 동점. 행동 없이 라운드가 종료되어 두 플레이어에게 2 CHIP을 지급했습니다.',
      )
      return
    }

    for (const [index, playerUid] of (room.playerUids as string[]).entries()) {
      const state = privateByUid.get(playerUid)!
      tx.update(refs[index], { tokens: state.tokens, bet: null, betRound: null })
    }
    const winnerUid = amount > otherBet ? uid : otherUid
    tx.update(roomRef, {
      players: updateWarnings(players, privateByUid, false),
      phase: 'action_choice',
      winnerUid,
      action: null,
      result: null,
      message: '행동을 선택할 차례입니다.',
    })
  })
  return { ok: true }
}

export async function chooseAction(db: Firestore, uid: string, codeValue: unknown, actionValue: unknown) {
  const code = cleanRoomCode(codeValue)
  const action = String(actionValue)
  if (action !== 'QUESTION' && action !== 'TRUTH') fail('invalid-argument', '행동이 올바르지 않습니다.')
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const snapshot = await tx.get(roomRef)
    const room = snapshot.data()
    if (!room) fail('not-found', '방을 찾을 수 없습니다.', 404)
    requireMember(room, uid)
    if (room.winnerUid === uid && room.action === action && room.phase === action.toLowerCase()) return
    if (room.winnerUid !== uid || room.phase !== 'action_choice') {
      fail('permission-denied', '행동을 선택할 차례가 아닙니다.', 403)
    }
    tx.update(roomRef, {
      phase: action.toLowerCase(),
      action,
      message: action === 'QUESTION' ? '상대에게 직접 질문하세요.' : '상대 카드의 값과 순서를 선언하세요.',
    })
  })
  return { ok: true }
}

export async function finishQuestion(db: Firestore, uid: string, codeValue: unknown) {
  const code = cleanRoomCode(codeValue)
  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const roomSnapshot = await tx.get(roomRef)
    const room = roomSnapshot.data()
    if (!room) fail('not-found', '방을 찾을 수 없습니다.', 404)
    requireMember(room, uid)
    if (room.winnerUid !== uid || room.phase !== 'question') {
      fail('permission-denied', '질문을 완료할 수 없는 상태입니다.', 403)
    }
    const { refs, states } = await readPrivatePlayers(tx, db, code, room.playerUids as string[])
    advanceRound(tx, roomRef, room, refs, states, null, '질문이 완료되어 다음 라운드를 시작합니다.')
  })
  return { ok: true }
}

export async function submitTruth(db: Firestore, uid: string, codeValue: unknown, guessValue: unknown) {
  const code = cleanRoomCode(codeValue)
  if (!isValidTruthGuess(guessValue)) fail('invalid-argument', '선언이 올바르지 않습니다.')
  const guess = guessValue
  let correct = false

  await db.runTransaction(async (tx) => {
    const roomRef = db.doc(`rooms/${code}`)
    const roomSnapshot = await tx.get(roomRef)
    const room = roomSnapshot.data()
    if (!room) fail('not-found', '방을 찾을 수 없습니다.', 404)
    requireMember(room, uid)
    if (room.phase === 'game_over' && room.winnerUid === uid && room.result === 'truth') {
      correct = true
      return
    }
    if (room.winnerUid !== uid || room.phase !== 'truth') {
      fail('permission-denied', 'TRUTH를 선언할 수 없는 상태입니다.', 403)
    }
    const { refs, states } = await readPrivatePlayers(tx, db, code, room.playerUids as string[])
    const opponentUid = (room.playerUids as string[]).find((item) => item !== uid)
    if (!opponentUid) fail('failed-precondition', '상대 플레이어가 없습니다.')
    const cards = states.get(opponentUid)!.cards
    correct = cards.length === 8 && cards.every((card, index) => card.rank === guess[index])

    if (correct) {
      tx.update(roomRef, {
        phase: 'game_over',
        result: 'truth',
        message: '정답입니다. 게임이 종료되었습니다.',
      })
      return
    }
    advanceRound(tx, roomRef, room, refs, states, 'false', 'FALSE. 진실 선언에 실패해 다음 라운드를 시작합니다.')
  })
  return { correct }
}

export async function executeGameAction(db: Firestore, uid: string, payload: Record<string, unknown>) {
  switch (payload.action) {
    case 'createRoom': return createRoom(db, uid, payload.nickname)
    case 'joinRoom': return joinRoom(db, uid, payload.code, payload.nickname)
    case 'setReady': return setReady(db, uid, payload.code, payload.ready)
    case 'confirmCards': return confirmCards(db, uid, payload.code, payload.cards)
    case 'submitBet': return submitBet(db, uid, payload.code, payload.amount)
    case 'chooseAction': return chooseAction(db, uid, payload.code, payload.choice)
    case 'finishQuestion': return finishQuestion(db, uid, payload.code)
    case 'submitTruth': return submitTruth(db, uid, payload.code, payload.guess)
    default: fail('invalid-argument', '지원하지 않는 요청입니다.')
  }
}
