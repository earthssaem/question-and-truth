import { describe, expect, it } from 'vitest'
import { cleanRoomCode, isValidBetAmount, isValidCardSelection, isValidTruthGuess, shouldWarn } from './game-service'

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
})
