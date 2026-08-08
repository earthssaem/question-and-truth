export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const

export type Suit = (typeof SUITS)[number]
export type Rank = (typeof RANKS)[number]
export type Phase = 'lobby' | 'card_selection' | 'betting' | 'bet_result' | 'action_choice' | 'question' | 'truth' | 'round_end' | 'game_over'
export type Action = 'QUESTION' | 'TRUTH'

export interface Card {
  suit: Suit
  rank: Rank
}

export interface Player {
  id: string
  nickname: string
  tokens: number
  warningOn: boolean
  ready: boolean
  confirmed: boolean
  betSubmitted: boolean
}

export interface GameState {
  phase: Phase
  round: number
  players: [Player, Player]
  myIndex: 0 | 1
  myCards: Card[]
  opponentCards: Card[]
  selectedCards: Card[]
  bet: number
  opponentBet: number | null
  winnerIndex: 0 | 1 | null
  action: Action | null
  truthGuess: Rank[]
  result: 'truth' | 'false' | 'tie' | null
  message: string
}

export const deck: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })))

export const cardId = (card: Card) => `${card.suit}-${card.rank}`
export const suitSymbol = (suit: Suit) => ({ spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' })[suit]
export const isRed = (suit: Suit) => suit === 'hearts' || suit === 'diamonds'

export function makeBetOptions(tokens: number): number[] {
  const maximum = Math.max(0, Math.floor(tokens))
  return Array.from({ length: maximum + 1 }, (_, amount) => amount)
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

export function isValidOrder(cards: Card[]): boolean {
  if (new Set(cards.map(cardId)).size !== cards.length) return false
  const lastRankBySuit = new Map<Suit, number>()
  for (const card of cards) {
    const rank = RANKS.indexOf(card.rank)
    const previous = lastRankBySuit.get(card.suit)
    if (previous !== undefined && rank < previous) return false
    lastRankBySuit.set(card.suit, rank)
  }
  return true
}

export function toggleSelectedCard(selected: Card[], card: Card, limit = 8): Card[] {
  const exists = selected.some((item) => cardId(item) === cardId(card))
  if (exists) return selected.filter((item) => cardId(item) !== cardId(card))
  if (selected.length >= limit) return selected
  return [...selected, card]
}

export function sameRanks(cards: Card[], guess: Rank[]): boolean {
  return cards.length === guess.length && cards.every((card, index) => card.rank === guess[index])
}

export function makeInitialGame(): GameState {
  const cards = shuffle(deck)
  return {
    phase: 'lobby',
    round: 1,
    players: [
      { id: 'me', nickname: 'PLAYER 1', tokens: 10, warningOn: false, ready: false, confirmed: false, betSubmitted: false },
      { id: 'opponent', nickname: 'PLAYER 2', tokens: 10, warningOn: false, ready: false, confirmed: false, betSubmitted: false },
    ],
    myIndex: 0,
    myCards: [],
    opponentCards: shuffle(cards.slice(8, 16)),
    selectedCards: [],
    bet: 0,
    opponentBet: null,
    winnerIndex: null,
    action: null,
    truthGuess: Array(8).fill('A') as Rank[],
    result: null,
    message: '상대가 들어오면 게임을 준비하세요.',
  }
}

export function awardAndAdvance(
  state: GameState,
  result: GameState['result'] = null,
  message = '새 라운드가 시작되었습니다.',
): GameState {
  const players = state.players.map((player) => {
    const tokens = player.tokens + 2
    return { ...player, tokens, warningOn: tokens <= 5, betSubmitted: false }
  }) as [Player, Player]
  return {
    ...state,
    phase: 'betting',
    round: state.round + 1,
    players,
    bet: 0,
    opponentBet: null,
    winnerIndex: null,
    action: null,
    truthGuess: Array(8).fill('A') as Rank[],
    result,
    message,
  }
}

export function resolveLocalBet(state: GameState, opponentBet: number): GameState {
  const opponentIndex = state.myIndex === 0 ? 1 : 0
  const bets = state.myIndex === 0 ? [state.bet, opponentBet] : [opponentBet, state.bet]
  const charged = state.players.map((player, index) => {
    const tokens = player.tokens - bets[index]
    return { ...player, tokens, warningOn: tokens <= 5 }
  }) as [Player, Player]

  if (state.bet === opponentBet) {
    return awardAndAdvance(
      { ...state, players: charged, opponentBet: null, winnerIndex: null },
      'tie',
      '베팅 동점. 행동 없이 라운드가 종료되어 두 플레이어에게 2 CHIP을 지급했습니다.',
    )
  }

  const winnerIndex = state.bet > opponentBet ? state.myIndex : opponentIndex
  return {
    ...state,
    phase: 'action_choice',
    players: charged,
    opponentBet: null,
    winnerIndex,
    result: null,
    message: winnerIndex === state.myIndex ? '행동을 선택하세요.' : '상대방의 차례입니다.',
  }
}
