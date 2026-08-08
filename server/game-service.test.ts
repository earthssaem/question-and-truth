import { describe, expect, it } from 'vitest'
import { cleanRoomCode, isValidBetAmount, isValidCardSelection, isValidTruthGuess, joinRoom, leaveRoom, planRoomExit, shouldWarn } from './game-service'

const player = (uid: string, slot: 0 | 1, ready = true) => ({
  uid,
  nickname: uid,
  slot,
  warningOn: false,
  ready,
  confirmed: false,
  betSubmitted: false,
})

const room = (phase = 'lobby') => ({
  phase,
  round: 3,
  settledRound: 2,
  players: [player('p1', 0), player('p2', 1)],
  playerUids: ['p1', 'p2'],
  leftUids: [],
})

function mockFirestore(roomData: Record<string, unknown>) {
  type Operation = { type: 'update' | 'delete' | 'create'; path: string; data?: Record<string, unknown> }
  const operations: Operation[] = []
  const transaction = {
    get: async () => ({ exists: true, data: () => roomData }),
    update: (ref: { path: string }, data: Record<string, unknown>) => operations.push({ type: 'update', path: ref.path, data }),
    delete: (ref: { path: string }) => operations.push({ type: 'delete', path: ref.path }),
    create: (ref: { path: string }, data: Record<string, unknown>) => operations.push({ type: 'create', path: ref.path, data }),
  }
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction),
  }
  return { db: db as unknown as Parameters<typeof leaveRoom>[0], operations }
}

describe('trusted backend validation', () => {
  it('방 코드는 정규화하고 잘못된 입력은 거부한다', () => {
    expect(cleanRoomCode(' ab12cd ')).toBe('AB12CD')
    expect(() => cleanRoomCode('ABC')).toThrow('올바른 방 코드')
  })

  it('카드 8장과 같은 무늬 오름차순 규칙을 검증한다', () => {
    const cards = [
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: '2' },
      { suit: 'spades', rank: '3' },
      { suit: 'diamonds', rank: '4' },
      { suit: 'clubs', rank: '5' },
      { suit: 'hearts', rank: '6' },
      { suit: 'diamonds', rank: '7' },
      { suit: 'clubs', rank: '8' },
    ]
    expect(isValidCardSelection(cards)).toBe(true)
    expect(isValidCardSelection([cards[2], cards[1], cards[0], ...cards.slice(3)])).toBe(false)
  })

  it('TRUTH는 정확히 8개의 카드 값만 허용한다', () => {
    expect(isValidTruthGuess(['A', '2', '3', '4', '5', '6', '7', 'K'])).toBe(true)
    expect(isValidTruthGuess(['A', '2'])).toBe(false)
    expect(isValidTruthGuess(['A', '2', '3', '4', '5', '6', '7', 'X'])).toBe(false)
  })

  it('경고등에는 칩 임계값만 공개한다', () => {
    expect(shouldWarn(5)).toBe(true)
    expect(shouldWarn(6)).toBe(false)
  })

  it('서버는 0부터 현재 보유 칩까지만 베팅으로 허용한다', () => {
    expect(isValidBetAmount(0, 0)).toBe(true)
    expect(isValidBetAmount(0, 7)).toBe(true)
    expect(isValidBetAmount(7, 7)).toBe(true)
    expect(isValidBetAmount(8, 7)).toBe(false)
    expect(isValidBetAmount(-1, 7)).toBe(false)
    expect(isValidBetAmount(1.5, 7)).toBe(false)
    expect(isValidBetAmount(Number.NaN, 7)).toBe(false)
  })

  it('LOBBY에서 PLAYER 2가 나가면 PLAYER 1 슬롯과 ready 초기화를 유지한다', () => {
    const plan = planRoomExit(room(), 'p2')
    expect(plan.kind).toBe('leave_lobby')
    if (plan.kind !== 'leave_lobby') return
    expect(plan.players).toEqual([{ ...player('p1', 0), ready: false }])
    expect(plan.playerUids).toEqual(['p1'])
    expect(plan.closed).toBe(false)
  })

  it('LOBBY에서 PLAYER 1이 나가도 남은 플레이어는 PLAYER 2 슬롯을 유지한다', () => {
    const plan = planRoomExit(room(), 'p1')
    expect(plan.kind).toBe('leave_lobby')
    if (plan.kind !== 'leave_lobby') return
    expect(plan.players[0].uid).toBe('p2')
    expect(plan.players[0].slot).toBe(1)
  })

  it('LOBBY에서 마지막 플레이어가 나가면 방을 closed 처리한다', () => {
    const soloRoom = { ...room(), players: [player('p1', 0)], playerUids: ['p1'] }
    const plan = planRoomExit(soloRoom, 'p1')
    expect(plan.kind).toBe('leave_lobby')
    if (plan.kind !== 'leave_lobby') return
    expect(plan.players).toEqual([])
    expect(plan.closed).toBe(true)
  })

  it('LOBBY 퇴장 transaction은 떠난 플레이어의 private 문서를 삭제한다', async () => {
    const { db, operations } = mockFirestore(room())
    const result = await leaveRoom(db, 'p2', 'ABC123')
    expect(result.outcome).toBe('left_lobby')
    expect(operations).toContainEqual({ type: 'delete', path: 'rooms/ABC123/private/p2' })
    const update = operations.find((operation) => operation.type === 'update')?.data
    expect(update).toMatchObject({
      playerUids: ['p1'],
      closed: false,
    })
    expect(update).not.toHaveProperty('phase')
  })

  it('게임 진행 중 나가기는 정산 없이 game_cancelled와 endedByUid만 기록한다', async () => {
    const gameRoom = room('question')
    const { db, operations } = mockFirestore(gameRoom)
    const result = await leaveRoom(db, 'p1', 'ABC123')
    const update = operations.find((operation) => operation.type === 'update')?.data

    expect(result.outcome).toBe('cancelled_game')
    expect(update).toMatchObject({ phase: 'game_cancelled', endedByUid: 'p1', winnerUid: null })
    expect(update).not.toHaveProperty('round')
    expect(update).not.toHaveProperty('settledRound')
    expect(operations.some((operation) => operation.type === 'delete')).toBe(false)
  })

  it('이미 나갔거나 종료된 방의 재요청은 부작용 없이 무시한다', () => {
    expect(planRoomExit({ ...room(), players: [player('p1', 0)], playerUids: ['p1'], leftUids: ['p2'] }, 'p2').kind).toBe('already_left')
    expect(planRoomExit({ ...room('game_cancelled'), endedByUid: 'p1' }, 'p2').kind).toBe('already_ended')
  })

  it.each([
    { remaining: player('p1', 0), expectedSlots: [0, 1] },
    { remaining: player('p2', 1), expectedSlots: [0, 1] },
  ])('빈 PLAYER 슬롯에 새 플레이어가 참가할 수 있다', async ({ remaining, expectedSlots }) => {
    const lobbyRoom = { ...room(), players: [remaining], playerUids: [remaining.uid] }
    const { db, operations } = mockFirestore(lobbyRoom)
    await joinRoom(db, 'new-player', 'ABC123', '새 플레이어')
    const update = operations.find((operation) => operation.type === 'update')?.data
    const players = update?.players as Array<{ slot: number; uid: string }>

    expect(players.map((item) => item.slot)).toEqual(expectedSlots)
    expect(update?.playerUids).toEqual(players.map((item) => item.uid))
    expect(players.find((item) => item.uid === 'new-player')?.slot).toBe(remaining.slot === 0 ? 1 : 0)
  })

  it('방 참가자가 아닌 UID의 나가기 요청을 거부한다', () => {
    expect(() => planRoomExit(room(), 'intruder')).toThrow('이 방의 플레이어가 아닙니다.')
  })
})
