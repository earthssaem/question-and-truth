import { describe, expect, it } from 'vitest'
import { awardAndAdvance, isActionOwner, isValidOrder, makeBetOptions, makeInitialGame, resolveLocalBet, sameRanks, toggleSelectedCard, type Card, type GameState } from './game'

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

  it('카드를 클릭한 순서대로 슬롯에 넣고 중간 카드를 취소하면 앞으로 당긴다', () => {
    const first: Card = { suit: 'spades', rank: '3' }
    const second: Card = { suit: 'hearts', rank: '7' }
    const third: Card = { suit: 'diamonds', rank: 'Q' }
    let selected: Card[] = []

    selected = toggleSelectedCard(selected, first)
    selected = toggleSelectedCard(selected, second)
    selected = toggleSelectedCard(selected, third)
    expect(selected).toEqual([first, second, third])

    selected = toggleSelectedCard(selected, second)
    expect(selected).toEqual([first, third])
  })

  it('8개 슬롯이 유효하게 채워져야 확정할 수 있고 추가 선택은 무시한다', () => {
    const selected: Card[] = [
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: '2' },
      { suit: 'diamonds', rank: '3' },
      { suit: 'clubs', rank: '4' },
      { suit: 'spades', rank: '5' },
      { suit: 'hearts', rank: '6' },
      { suit: 'diamonds', rank: '7' },
      { suit: 'clubs', rank: '8' },
    ]
    const extra: Card = { suit: 'spades', rank: 'K' }

    expect(selected.length === 8 && isValidOrder(selected)).toBe(true)
    expect(toggleSelectedCard(selected, extra)).toEqual(selected)
    expect(selected.slice(0, 7).length === 8 && isValidOrder(selected.slice(0, 7))).toBe(false)
  })

  it('베팅 선택지는 0부터 현재 보유 칩까지만 만든다', () => {
    expect(makeBetOptions(7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(makeBetOptions(0)).toEqual([0])
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
    expect(next.bet).toBe(0)
  })

  it('0 대 0도 동점으로 처리하고 차감 없이 양쪽에 2칩을 지급한다', () => {
    const state = { ...makeInitialGame(), phase: 'betting' as const, bet: 0 }
    const next = resolveLocalBet(state, 0)

    expect(next.phase).toBe('betting')
    expect(next.round).toBe(2)
    expect(next.players.map((player) => player.tokens)).toEqual([12, 12])
    expect(next.result).toBe('tie')
  })

  it('0 대 3은 3을 베팅한 플레이어가 승리하고 0 베팅은 칩을 차감하지 않는다', () => {
    const state = { ...makeInitialGame(), phase: 'betting' as const, bet: 0 }
    const next = resolveLocalBet(state, 3)

    expect(next.phase).toBe('action_choice')
    expect(next.players.map((player) => player.tokens)).toEqual([10, 7])
    expect(next.winnerIndex).toBe(1)
  })

  it('보유 칩이 0인 플레이어도 0 베팅 후 정상적으로 동점을 정산한다', () => {
    const initial = makeInitialGame()
    const state = {
      ...initial,
      phase: 'betting' as const,
      bet: 0,
      players: initial.players.map((player) => ({ ...player, tokens: 0 })) as GameState['players'],
    }
    const next = resolveLocalBet(state, 0)

    expect(next.players.map((player) => player.tokens)).toEqual([2, 2])
    expect(next.result).toBe('tie')
  })

  it('베팅 수가 다르면 차감 후 승자에게만 행동권을 준다', () => {
    const state = { ...makeInitialGame(), phase: 'betting' as const, bet: 4 }
    const next = resolveLocalBet(state, 2)

    expect(next.phase).toBe('action_choice')
    expect(next.players.map((player) => player.tokens)).toEqual([6, 8])
    expect(next.winnerIndex).toBe(0)
    expect(next.opponentBet).toBeNull()
    expect(next.message).toBe('행동을 선택하세요.')
  })

  it('상대가 베팅에서 이기면 상대방 차례로 대기한다', () => {
    const state = { ...makeInitialGame(), phase: 'betting' as const, bet: 2 }
    const next = resolveLocalBet(state, 4)

    expect(next.phase).toBe('action_choice')
    expect(next.players.map((player) => player.tokens)).toEqual([8, 6])
    expect(next.winnerIndex).toBe(1)
    expect(next.message).toBe('상대방의 차례입니다.')
  })

  it('베팅 승자에게만 질문과 진실 행동을 허용한다', () => {
    expect(isActionOwner(0, 0)).toBe(true)
    expect(isActionOwner(0, 1)).toBe(false)
    expect(isActionOwner(0, null)).toBe(false)
  })
})
