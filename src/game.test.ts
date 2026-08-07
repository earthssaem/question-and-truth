import { describe, expect, it } from 'vitest'
import { awardAndAdvance, isValidOrder, makeInitialGame, resolveLocalBet, sameRanks, type Card } from './game'

describe('game rules', () => {
  it('같은 무늬의 카드는 오름차순으로만 배치한다', () => {
    const valid: Card[] = [
      { suit: 'spades', rank: '3' },
      { suit: 'hearts', rank: 'K' },
      { suit: 'spades', rank: '7' },
    ]
    const invalid: Card[] = [
      { suit: 'clubs', rank: 'Q' },
      { suit: 'clubs', rank: '4' },
    ]
    expect(isValidOrder(valid)).toBe(true)
    expect(isValidOrder(invalid)).toBe(false)
  })

  it('TRUTH는 무늬를 제외하고 값과 위치만 판정한다', () => {
    const cards: Card[] = [
      { suit: 'spades', rank: 'A' },
      { suit: 'clubs', rank: '7' },
    ]
    expect(sameRanks(cards, ['A', '7'])).toBe(true)
    expect(sameRanks(cards, ['A', '8'])).toBe(false)
  })

  it('한 플레이어의 카드 배열에는 동일한 카드가 중복될 수 없다', () => {
    const duplicate: Card[] = [
      { suit: 'hearts', rank: '7' },
      { suit: 'hearts', rank: '7' },
    ]
    expect(isValidOrder(duplicate)).toBe(false)
  })

  it('라운드 전환 한 번에 양쪽에 2칩을 지급한다', () => {
    const next = awardAndAdvance(makeInitialGame())
    expect(next.players.map((player) => player.tokens)).toEqual([12, 12])
    expect(next.round).toBe(2)
  })

  it('동점 베팅은 칩을 소모하고 +2 지급 후 다음 라운드로 이동한다', () => {
    const state = { ...makeInitialGame(), phase: 'betting' as const, bet: 3 }
    const next = resolveLocalBet(state, 3)

    expect(next.phase).toBe('betting')
    expect(next.round).toBe(2)
    expect(next.players.map((player) => player.tokens)).toEqual([9, 9])
    expect(next.winnerIndex).toBeNull()
    expect(next.result).toBe('tie')
  })

  it('베팅 수가 다르면 차감 후 승자에게만 행동권을 준다', () => {
    const state = { ...makeInitialGame(), phase: 'betting' as const, bet: 4 }
    const next = resolveLocalBet(state, 2)

    expect(next.phase).toBe('action_choice')
    expect(next.players.map((player) => player.tokens)).toEqual([6, 8])
    expect(next.winnerIndex).toBe(0)
    expect(next.opponentBet).toBeNull()
  })
})
