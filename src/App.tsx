import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, Clipboard, List, LogOut, Minus, Plus, ShieldAlert, Users, X } from 'lucide-react'
import {
  RANKS,
  awardAndAdvance,
  cardId,
  deck,
  isRed,
  isActionOwner,
  isJoinedOpponentId,
  isValidOrder,
  makeGameOverResult,
  makeBetOptions,
  makeInitialGame,
  playerSlotLabel,
  resolveLocalBet,
  sameRanks,
  suitSymbol,
  toggleSelectedCard,
  type Action,
  type Card,
  type GameState,
  type Rank,
} from './game'
import {
  chooseOnlineAction,
  confirmOnlineCards,
  createOnlineRoom,
  ensureAnonymousUser,
  finishOnlineQuestion,
  firebaseEnabled,
  joinOnlineRoom,
  leaveOnlineRoom,
  setOnlineReady,
  submitOnlineBet,
  submitOnlineTruth,
  watchMyState,
  watchOnlineRoom,
  type OnlineRoom,
} from './firebase'

type View = 'home' | 'lobby' | 'game'
const SESSION_ROOM_KEY = 'question-and-truth:room'
const SESSION_NICKNAME_KEY = 'question-and-truth:nickname'

const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const clearOnlineSession = () => {
  localStorage.removeItem(SESSION_ROOM_KEY)
  localStorage.removeItem(SESSION_NICKNAME_KEY)
}

function CardFace({ card, selected, compact, onClick }: { card: Card; selected?: boolean; compact?: boolean; onClick?: () => void }) {
  const symbol = suitSymbol(card.suit)
  return (
    <button
      className={`card ${isRed(card.suit) ? 'red' : ''} ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`}
      onClick={onClick}
      type="button"
      aria-label={`${symbol} ${card.rank}`}
    >
      <span className="card-index card-index-top"><b>{card.rank}</b><i>{symbol}</i></span>
      <strong className="card-suit">{symbol}</strong>
      <span className="card-index card-index-bottom"><b>{card.rank}</b><i>{symbol}</i></span>
    </button>
  )
}

function ChipIndicator({ tokens }: { tokens: number }) {
  return <span className="chip-indicator"><i className="chip-token" aria-hidden="true" /><strong>{tokens}</strong>개</span>
}

function WarningLight({ on }: { on: boolean }) {
  return (
    <span className={`warning-indicator ${on ? 'warning' : ''}`} aria-label={`칩 경고등 ${on ? '켜짐' : '꺼짐'}`}>
      <span>칩 경고등</span>
      <i className="status-light" aria-hidden="true" />
      <b>{on ? '켜짐' : '꺼짐'}</b>
    </span>
  )
}

function PlayerPanel({ player, slot, isMe, active }: { player: GameState['players'][number]; slot: 0 | 1; isMe: boolean; active?: boolean }) {
  return (
    <div className={`player-panel ${slot === 1 ? 'player-two' : ''} ${active ? 'active' : ''}`}>
      <div className="player-identity">
        <span className="game-player-role">{playerSlotLabel(slot)}</span>
        <strong>{player.nickname}</strong>
        <small>({isMe ? '나' : '상대'})</small>
      </div>
      <div className="player-meta">
        {active && <span className="turn-status"><i />현재 행동</span>}
        {isMe ? <ChipIndicator tokens={player.tokens} /> : <WarningLight on={player.warningOn} />}
      </div>
    </div>
  )
}

function LobbyPlayer({ role, player, present }: { role: string; player: GameState['players'][number]; present: boolean }) {
  const status = !present ? '입장 대기 중' : player.ready ? '준비 완료' : '입장 완료'
  return (
    <div className={`lobby-player ${!present ? 'waiting' : ''} ${player.ready ? 'ready' : ''}`}>
      <span className="lobby-role">{role}</span>
      <strong>{present ? player.nickname : '—'}</strong>
      <small className="lobby-status"><i aria-hidden="true" />{status}</small>
    </div>
  )
}

function ExitButton({ className = '', onClick }: { className?: string; onClick: () => void }) {
  return <button className={`exit-button ${className}`} type="button" onClick={onClick}><LogOut size={16} />나가기</button>
}

function AppFooter() {
  return <footer className="app-footer">© 2026 제작: 김연경(<a href="mailto:earthssaem@gmail.com">earthssaem@gmail.com</a>)</footer>
}

function ExitConfirmModal({ lobby, pending, error, onCancel, onConfirm }: { lobby: boolean; pending: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel, pending])

  return (
    <div className="exit-modal-backdrop" onClick={() => { if (!pending) onCancel() }}>
      <section className="exit-modal" role="dialog" aria-modal="true" aria-labelledby="exit-modal-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="exit-modal-title">{lobby ? '방에서 나갈까요?' : '게임을 종료하고 나갈까요?'}</h2>
        <p>{lobby ? '현재 방에서 퇴장합니다.' : '나가면 현재 게임이 종료됩니다.'}</p>
        {error && <p className="exit-modal-error"><ShieldAlert size={15} />{error}</p>}
        <div className="exit-modal-actions">
          <button className="secondary" type="button" disabled={pending} onClick={onCancel}>취소</button>
          <button className={lobby ? 'primary' : 'exit-confirm-danger'} type="button" disabled={pending} onClick={onConfirm}>
            {pending ? (lobby ? '나가는 중...' : '종료하는 중...') : lobby ? '나가기' : '게임 종료'}
          </button>
        </div>
      </section>
    </div>
  )
}

function App() {
  const [view, setView] = useState<View>('home')
  const [nickname, setNickname] = useState('')
  const [roomInput, setRoomInput] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [game, setGame] = useState<GameState>(makeInitialGame)
  const [onlineUid, setOnlineUid] = useState('')
  const [error, setError] = useState('')
  const [exitOpen, setExitOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState('')

  const me = game.players[game.myIndex]
  const opponent = game.players[game.myIndex === 0 ? 1 : 0]
  const actionPhase = game.phase === 'action_choice' || game.phase === 'question' || game.phase === 'truth'
  const myAction = isActionOwner(game.myIndex, game.winnerIndex)
  const slotPresent = (slot: 0 | 1) => !firebaseEnabled || isJoinedOpponentId(game.players[slot].id)
  const bothPlayersJoined = slotPresent(0) && slotPresent(1)

  const returnHome = useCallback(() => {
    clearOnlineSession()
    setRoomCode('')
    setGame(makeInitialGame())
    setExitOpen(false)
    setLeaving(false)
    setLeaveError('')
    setError('')
    setView('home')
  }, [])

  const applyOnlineRoom = useCallback((room: OnlineRoom, uid: string) => {
    const roomPlayerIndex = room.players.findIndex((player) => player.uid === uid)
    if (roomPlayerIndex < 0) {
      returnHome()
      return
    }
    const roomPlayer = room.players[roomPlayerIndex]
    const myIndex = (roomPlayer.slot === 0 || roomPlayer.slot === 1 ? roomPlayer.slot : roomPlayerIndex) as 0 | 1
    if (room.phase === 'game_cancelled' && room.endedByUid === uid) {
      returnHome()
      return
    }
    setGame((current) => {
      const waitingPlayer = { id: 'waiting', nickname: '상대 플레이어', tokens: 0, warningOn: false, ready: false, confirmed: false, betSubmitted: false }
      const players: GameState['players'] = [{ ...waitingPlayer }, { ...waitingPlayer }]
      room.players.forEach((player, index) => {
        const slot = (player.slot === 0 || player.slot === 1 ? player.slot : index) as 0 | 1
        players[slot] = {
          id: player.uid,
          nickname: player.nickname,
          tokens: player.uid === uid ? current.players[current.myIndex].tokens : 0,
          warningOn: player.warningOn,
          ready: player.ready,
          confirmed: player.confirmed,
          betSubmitted: player.betSubmitted,
        }
      })
      const winnerPlayerIndex = room.winnerUid ? room.players.findIndex((player) => player.uid === room.winnerUid) : -1
      const endedPlayerIndex = room.endedByUid ? room.players.findIndex((player) => player.uid === room.endedByUid) : -1
      return {
        ...current,
        phase: room.phase,
        round: room.round,
        myIndex,
        players,
        opponentBet: null,
        winnerIndex: winnerPlayerIndex >= 0 ? (room.players[winnerPlayerIndex].slot ?? winnerPlayerIndex) as 0 | 1 : null,
        endedByIndex: endedPlayerIndex >= 0 ? (room.players[endedPlayerIndex].slot ?? endedPlayerIndex) as 0 | 1 : null,
        action: room.action,
        result: room.result,
        message: room.message,
        bet: room.round !== current.round ? 0 : current.bet,
      }
    })
    setView(room.phase === 'lobby' ? 'lobby' : 'game')
  }, [returnHome])

  useEffect(() => {
    if (!firebaseEnabled) return
    const savedRoom = localStorage.getItem(SESSION_ROOM_KEY) ?? ''
    const savedNickname = localStorage.getItem(SESSION_NICKNAME_KEY) ?? ''
    if (!/^[A-Z0-9]{6}$/.test(savedRoom)) return

    let active = true
    setNickname(savedNickname)
    void ensureAnonymousUser()
      .then((user) => {
        if (!active) return
        setOnlineUid(user.uid)
        setRoomCode(savedRoom)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '방에 다시 연결하지 못했습니다.')
      })
    return () => { active = false }
  }, [])

  const enterLobby = async (code?: string) => {
    if (!nickname.trim()) return
    setError('')
    let destination = code || randomCode()
    if (firebaseEnabled) {
      try {
        const user = await ensureAnonymousUser()
        setOnlineUid(user.uid)
        if (code) await joinOnlineRoom(code, nickname.trim())
        else destination = (await createOnlineRoom(nickname.trim())).code
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '방에 연결하지 못했습니다.')
        return
      }
      localStorage.setItem(SESSION_ROOM_KEY, destination)
      localStorage.setItem(SESSION_NICKNAME_KEY, nickname.trim())
    }
    setRoomCode(destination)
    setGame((current) => ({
      ...current,
      players: [{ ...current.players[0], nickname: nickname.trim() }, { ...current.players[1], nickname: '상대 플레이어' }],
    }))
    setView('lobby')
  }

  useEffect(() => {
    if (!firebaseEnabled || !roomCode || !onlineUid) return
    const handleConnectionError = (reason: Error) => {
      if (reason.message.includes('찾을 수 없습니다') || reason.message.includes('permission')) {
        returnHome()
        return
      }
      setError(reason.message)
    }
    const stopRoom = watchOnlineRoom(roomCode, (room) => applyOnlineRoom(room, onlineUid), handleConnectionError)
    const stopPrivate = watchMyState(roomCode, onlineUid, ({ cards, tokens }) => setGame((current) => ({
      ...current,
      myCards: cards,
      players: current.players.map((player, index) => index === current.myIndex
        ? { ...player, tokens, warningOn: tokens <= 5 }
        : player) as GameState['players'],
    })), handleConnectionError)
    return () => { stopRoom(); stopPrivate() }
  }, [applyOnlineRoom, onlineUid, returnHome, roomCode])

  const toggleReady = () => {
    if (!bothPlayersJoined) return
    if (firebaseEnabled) { void setOnlineReady(roomCode, !me.ready).catch((reason) => setError(reason.message)); return }
    setGame((current) => {
      const players = current.players.map((player, index) => index === current.myIndex ? { ...player, ready: !player.ready } : { ...player, ready: true }) as GameState['players']
      return { ...current, players, message: '두 플레이어가 준비되었습니다.' }
    })
  }

  const openExitConfirm = () => {
    setLeaveError('')
    setExitOpen(true)
  }

  const leaveRoom = async () => {
    if (leaving) return
    setLeaving(true)
    setLeaveError('')
    if (firebaseEnabled) {
      try {
        await leaveOnlineRoom(roomCode)
      } catch {
        setLeaveError('방에서 나가지 못했습니다. 다시 시도해주세요.')
        setLeaving(false)
        return
      }
    }
    returnHome()
  }

  useEffect(() => {
    if (firebaseEnabled || view !== 'lobby' || !game.players.every((player) => player.ready)) return
    const timer = window.setTimeout(() => {
      setGame((current) => ({ ...current, phase: 'card_selection', message: '52장 중 사용할 카드 8장을 고르세요.' }))
      setView('game')
    }, 500)
    return () => window.clearTimeout(timer)
  }, [game.players, view])

  const toggleCard = (card: Card) => {
    setGame((current) => ({ ...current, selectedCards: toggleSelectedCard(current.selectedCards, card) }))
  }

  const confirmCards = () => {
    if (game.selectedCards.length !== 8 || !isValidOrder(game.selectedCards)) return
    if (firebaseEnabled) { void confirmOnlineCards(roomCode, game.selectedCards).catch((reason) => setError(reason.message)); return }
    setGame((current) => ({
      ...current,
      phase: 'betting',
      myCards: current.selectedCards,
      players: current.players.map((player) => ({ ...player, confirmed: true })) as GameState['players'],
      message: '원하는 만큼 칩을 베팅하세요.',
    }))
  }

  const confirmBet = () => {
    const amount = Math.min(me.tokens, Math.max(0, game.bet))
    if (firebaseEnabled) { void submitOnlineBet(roomCode, amount).catch((reason) => setError(reason.message)); return }
    const opponentBet = Math.floor(Math.random() * (Math.min(opponent.tokens, 6) + 1))
    setGame((current) => resolveLocalBet({ ...current, bet: amount }, opponentBet))
  }

  const chooseAction = (action: Action) => {
    if (firebaseEnabled) { void chooseOnlineAction(roomCode, action).catch((reason) => setError(reason.message)); return }
    setGame((current) => ({
      ...current,
      action,
      phase: action === 'QUESTION' ? 'question' : 'truth',
      message: action === 'QUESTION' ? '상대에게 직접 질문하세요.' : '상대 카드의 값과 순서를 맞혀보세요.',
    }))
  }

  const endRound = (result: GameState['result'] = null) => {
    if (firebaseEnabled) { void finishOnlineQuestion(roomCode).catch((reason) => setError(reason.message)); return }
    setGame((current) => awardAndAdvance(
      current,
      result,
      result === 'false' ? 'FALSE. 진실 선언에 실패해 다음 라운드를 시작합니다.' : '질문이 완료되어 다음 라운드를 시작합니다.',
    ))
  }

  const declareTruth = () => {
    if (firebaseEnabled) { void submitOnlineTruth(roomCode, game.truthGuess).catch((reason) => setError(reason.message)); return }
    const result = sameRanks(game.opponentCards, game.truthGuess) ? 'truth' : 'false'
    setGame((current) => result === 'truth'
      ? { ...current, result, phase: 'game_over', message: '정답입니다. 게임이 종료되었습니다.' }
      : awardAndAdvance(current, 'false', 'FALSE. 진실 선언에 실패해 다음 라운드를 시작합니다.'))
  }

  const changeGuess = (index: number, rank: Rank) => {
    setGame((current) => ({ ...current, truthGuess: current.truthGuess.map((item, itemIndex) => itemIndex === index ? rank : item) }))
  }

  if (view === 'home') {
    return (
      <div className="app-frame">
        <main className="home-shell">
          <section className="home-panel">
          <header className="home-intro">
            <div className="suit-motif" aria-hidden="true"><span>♠</span><span>♥</span><span>♦</span><span>♣</span></div>
            <h1>질문과 진실</h1>
            <p className="home-copy">데블스플랜2 FINAL 3회전 게임</p>
          </header>
          <div className="home-actions">
            <div className="home-group player-setup">
              <label className="field-label" htmlFor="nickname">닉네임</label>
              <input id="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="이름을 입력하세요" />
            </div>
            <div className="home-group game-start">
              <p className="home-group-label">게임 시작</p>
              <button className="primary wide" type="button" disabled={!nickname.trim()} onClick={() => void enterLobby()}>방 만들기</button>
              <div className="home-divider"><span>또는</span></div>
              <label className="field-label" htmlFor="room-code">방 코드</label>
              <input
                id="room-code"
                className="room-input"
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="6자리 코드를 입력하세요"
              />
              <button className="secondary wide" type="button" disabled={!nickname.trim() || roomInput.length !== 6} onClick={() => void enterLobby(roomInput)}>방 참가하기</button>
            </div>
          </div>
          {error && <p className="form-error"><ShieldAlert size={14} /> {error}</p>}
          </section>
        </main>
        <AppFooter />
      </div>
    )
  }

  if (view === 'lobby') {
    return (
      <div className="app-frame">
        <main className="lobby-shell">
          <ExitButton className="lobby-exit-button" onClick={openExitConfirm} />
          <section className="lobby-panel">
          <h1>{bothPlayersJoined ? '두 플레이어가 입장했습니다' : '상대를 기다리는 중'}</h1>
          <div className="room-code"><span>방 코드</span><strong>{roomCode}</strong><button className="icon-button" title="방 코드 복사" type="button" onClick={() => { navigator.clipboard?.writeText(roomCode); setCopied(true) }}>{copied ? <Check /> : <Clipboard />}</button></div>
          <div className="versus">
            <LobbyPlayer role="PLAYER 1" player={game.players[0]} present={slotPresent(0)} />
            <b>VS</b>
            <LobbyPlayer role="PLAYER 2" player={game.players[1]} present={slotPresent(1)} />
          </div>
          <button className="primary wide" type="button" disabled={!bothPlayersJoined} onClick={toggleReady}>
            {me.ready ? <Check size={18} /> : <Users size={18} />}
            {!bothPlayersJoined ? '상대 입장 대기 중' : me.ready ? '준비 완료' : '준비'}
          </button>
          {error && <p className="form-error"><ShieldAlert size={14} /> {error}</p>}
          </section>
          {exitOpen && <ExitConfirmModal lobby pending={leaving} error={leaveError} onCancel={() => { if (!leaving) setExitOpen(false) }} onConfirm={() => void leaveRoom()} />}
        </main>
        <AppFooter />
      </div>
    )
  }

  return (
    <div className="app-frame">
      <main className="game-shell">
        <header className="game-header">
        <span className="game-meta"><b>{game.round}라운드</b><i>·</i>방 코드 {roomCode}</span>
        {game.phase !== 'game_over' && game.phase !== 'game_cancelled' && <ExitButton onClick={openExitConfirm} />}
        </header>
        <section className="scoreboard">
        <PlayerPanel player={game.players[0]} slot={0} isMe={game.myIndex === 0} active={actionPhase && game.winnerIndex === 0} />
        <span className="versus-small">VS</span>
        <PlayerPanel player={game.players[1]} slot={1} isMe={game.myIndex === 1} active={actionPhase && game.winnerIndex === 1} />
        </section>
        <section className={`stage stage-${game.phase}`}>
        {game.phase === 'card_selection' && (me.confirmed
          ? <Waiting text="상대가 카드 배열을 정하는 중..." />
          : <CardSelection selected={game.selectedCards} onToggle={toggleCard} onConfirm={confirmCards} />)}
        {game.phase === 'betting' && (me.betSubmitted
          ? <Waiting text="상대가 베팅하는 중..." />
          : <Betting game={game} setGame={setGame} onConfirm={confirmBet} />)}
        {game.phase === 'bet_result' && <Waiting text={game.message} />}
        {game.phase === 'action_choice' && (myAction
          ? <ActionChoice onChoose={chooseAction} />
          : <BetLoss />)}
        {game.phase === 'question' && (myAction
          ? <Question onDone={() => endRound()} />
          : <Waiting text="상대가 질문하는 중..." />)}
        {game.phase === 'truth' && (myAction
          ? <Truth guess={game.truthGuess} onChange={changeGuess} onDeclare={declareTruth} />
          : <Waiting text="상대가 진실에 도전하는 중..." />)}
        {game.phase === 'round_end' && <Waiting text={game.message} />}
        {game.phase === 'game_over' && <GameOver game={game} onHome={returnHome} />}
        {game.phase === 'game_cancelled' && <GameCancelled endedByMe={game.endedByIndex === game.myIndex} onHome={returnHome} />}
        </section>
        {game.phase !== 'card_selection' && game.myCards.length > 0 && <MyCards cards={game.myCards} />}
        {exitOpen && <ExitConfirmModal lobby={false} pending={leaving} error={leaveError} onCancel={() => { if (!leaving) setExitOpen(false) }} onConfirm={() => void leaveRoom()} />}
      </main>
      <AppFooter />
    </div>
  )
}

function CardSelection({ selected, onToggle, onConfirm }: { selected: Card[]; onToggle: (card: Card) => void; onConfirm: () => void }) {
  const valid = selected.length === 8 && isValidOrder(selected)
  return (
    <div className="selection">
      <div className="stage-heading"><p>나의 카드 구성</p><h2>카드 8장을 선택하세요</h2><span>{selected.length} / 8</span></div>
      <div className="deck-grid">
        {deck.map((card) => <CardFace key={cardId(card)} card={card} selected={selected.some((item) => cardId(item) === cardId(card))} compact onClick={() => onToggle(card)} />)}
      </div>
      <div className="selection-slots" aria-label="선택한 카드 배열">
        {Array.from({ length: 8 }, (_, index) => {
          const card = selected[index]
          return (
            <div className="selection-slot" key={index}>
              <span>{index + 1}</span>
              {card
                ? <CardFace card={card} compact onClick={() => onToggle(card)} />
                : <div className="empty-card-slot" aria-label={`${index + 1}번 빈 슬롯`} />}
            </div>
          )
        })}
      </div>
      <div className="selection-footer">
        <p className="error" aria-live="polite">{selected.length === 8 && !valid ? '같은 무늬는 왼쪽에서 오른쪽으로 오름차순이어야 합니다.' : ''}</p>
        <button className="primary" disabled={!valid} onClick={onConfirm}>배치 확정 <ChevronRight size={18} /></button>
      </div>
    </div>
  )
}

function Betting({ game, setGame, onConfirm }: { game: GameState; setGame: React.Dispatch<React.SetStateAction<GameState>>; onConfirm: () => void }) {
  const maxBet = Math.max(0, game.players[game.myIndex].tokens)
  const bet = Math.min(maxBet, Math.max(0, game.bet))
  const options = makeBetOptions(maxBet)

  useEffect(() => {
    if (bet !== game.bet) setGame((current) => ({ ...current, bet }))
  }, [bet, game.bet, setGame])

  return (
    <div className="center-action betting-panel">
      {game.result === 'tie' && (
        <div className="previous-result" role="status">
          <strong>ROUND {Math.max(1, game.round - 1)} · 동점!</strong>
          <span>행동 없이 라운드 종료 · 두 플레이어 +2칩</span>
        </div>
      )}
      {game.result === 'false' && (
        <div className="previous-result failed" role="status">
          <strong>ROUND {Math.max(1, game.round - 1)} · 진실 도전 실패</strong>
          <span>정답이 아닙니다 · 두 플레이어 +2칩</span>
        </div>
      )}
      <h2>몇 개의 칩을 걸까요?</h2>
      <p>0개부터 보유한 칩까지 선택할 수 있습니다.</p>
      <div className="stepper">
        <button type="button" title="베팅 감소" disabled={bet === 0} onClick={() => setGame((current) => ({ ...current, bet: Math.max(0, current.bet - 1) }))}><Minus /></button>
        <div className="bet-amount">
          <i className="chip-token" aria-hidden="true" />
          <select className="bet-select" aria-label="베팅할 칩 수" value={bet} onChange={(event) => setGame((current) => ({ ...current, bet: Number(event.target.value) }))}>
            {options.map((amount) => <option value={amount} key={amount}>{amount}</option>)}
          </select>
          <span>칩</span>
        </div>
        <button type="button" title="베팅 증가" disabled={bet === maxBet} onClick={() => setGame((current) => ({ ...current, bet: Math.min(maxBet, current.bet + 1) }))}><Plus /></button>
      </div>
      <button className="primary" onClick={onConfirm}>이대로 베팅</button>
    </div>
  )
}

function ActionTile({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return <button className="action-tile" type="button" onClick={onClick}><strong>{title}</strong><small>{description}</small></button>
}

function ResultNotice({ title, tone = 'neutral', children }: { title: string; tone?: 'neutral' | 'gold' | 'danger'; children?: React.ReactNode }) {
  return <div className={`result-notice ${tone}`} role="status"><strong>{title}</strong>{children}</div>
}

function ActionChoice({ onChoose }: { onChoose: (action: Action) => void }) {
  return <div className="center-action"><ResultNotice title="베팅 승리!" tone="gold"><p>이번 라운드, 무엇을 할까요?</p></ResultNotice><div className="action-grid"><ActionTile title="질문" description="상대에게 직접 질문하기" onClick={() => onChoose('QUESTION')} /><ActionTile title="진실" description="상대 카드 배열 선언하기" onClick={() => onChoose('TRUTH')} /></div></div>
}

function BetLoss() {
  return <div className="center-action waiting"><ResultNotice title="상대가 베팅에서 이겼어요."><p>상대가 고르는 중...</p></ResultNotice></div>
}

const QUESTION_GROUPS = [
  {
    label: 'SUM',
    korean: '합',
    questions: [
      [1, '선택한 카드 3장의 합은?'],
      [2, '선택한 카드 모양의 합은?'],
      [3, '알파벳 카드의 합은?'],
      [4, '숫자 카드의 합은?'],
    ],
  },
  {
    label: 'COUNT',
    korean: '장수',
    questions: [
      [5, '알파벳 카드의 장수는?'],
      [6, '숫자 카드의 장수는?'],
      [7, '특정 숫자/알파벳의 장수는?'],
    ],
  },
  {
    label: 'POSITION',
    korean: '위치',
    questions: [
      [8, '해당 모양 카드의 위치는?'],
      [9, '같은 숫자/알파벳 카드의 위치는?'],
      [10, '연속되는 숫자/알파벳 카드의 위치는?'],
      [11, '가장 큰 숫자 혹은 가장 작은 숫자의 위치는?'],
    ],
  },
] as const

function QuestionListModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="question-modal-backdrop" onClick={onClose}>
      <section className="question-modal" role="dialog" aria-modal="true" aria-labelledby="question-list-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="question-list-title">질문 목록</h2>
          <button className="question-modal-close" type="button" onClick={onClose}><X size={17} />닫기</button>
        </header>
        <div className="question-modal-body">
          <table className="question-table">
            <colgroup><col className="question-type-column" /><col className="question-number-column" /><col /></colgroup>
            <thead><tr><th scope="col">유형</th><th scope="col">번호</th><th scope="col">질문</th></tr></thead>
            <tbody>
              {QUESTION_GROUPS.flatMap((group) => group.questions.map(([number, question], index) => (
                <tr className={index === 0 ? 'question-group-start' : ''} key={number}>
                  {index === 0 && <th className="question-type" scope="rowgroup" rowSpan={group.questions.length}><b>{group.label}</b><span>({group.korean})</span></th>}
                  <td className="question-number">{number}</td>
                  <td>{question}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Question({ onDone }: { onDone: () => void }) {
  const [showQuestions, setShowQuestions] = useState(false)
  return (
    <>
      <div className="center-action question">
        <p className="eyebrow">질문</p>
        <h2>상대에게 질문하세요.</h2>
        <div className="question-actions">
          <button className="secondary" type="button" onClick={() => setShowQuestions(true)}><List size={18} />질문 보기</button>
          <button className="primary" type="button" onClick={onDone}><Check size={18} />질문 완료</button>
        </div>
      </div>
      {showQuestions && <QuestionListModal onClose={() => setShowQuestions(false)} />}
    </>
  )
}

function Truth({ guess, onChange, onDeclare }: { guess: Rank[]; onChange: (index: number, rank: Rank) => void; onDeclare: () => void }) {
  return <div className="truth-panel"><div className="stage-heading"><p>진실</p><h2>상대 카드의 값과 순서를 선언하세요</h2></div><div className="truth-grid">{guess.map((rank, index) => <label key={index}><span>{index + 1}</span><select value={rank} onChange={(event) => onChange(index, event.target.value as Rank)}>{RANKS.map((item) => <option key={item}>{item}</option>)}</select></label>)}</div><button className="primary" onClick={onDeclare}>진실 선언</button></div>
}

function GameOver({ game, onHome }: { game: GameState; onHome: () => void }) {
  const result = makeGameOverResult(game.players, game.myIndex, game.winnerIndex)
  return (
    <div className="center-action game-over">
      <p className="eyebrow">게임 종료</p>
      <ResultNotice title={result.winnerText} tone="gold">
        {result.isWinner && <span className="game-over-answer">정답입니다.</span>}
        <p>{result.detail}</p>
      </ResultNotice>
      <button className="primary" onClick={onHome}>처음으로</button>
    </div>
  )
}

function GameCancelled({ endedByMe, onHome }: { endedByMe: boolean; onHome: () => void }) {
  return (
    <div className="center-action game-cancelled">
      <p className="eyebrow">게임 종료</p>
      <ResultNotice title="게임이 종료되었습니다.">
        <p>{endedByMe ? '게임을 종료했습니다.' : '상대가 게임을 종료했습니다.'}</p>
      </ResultNotice>
      <button className="primary" type="button" onClick={onHome}>처음으로</button>
    </div>
  )
}

function Waiting({ text }: { text: string }) { return <div className="center-action waiting"><ResultNotice title={text} /></div> }

function MyCards({ cards }: { cards: Card[] }) {
  return <section className="my-cards"><p className="eyebrow"><span>내 카드</span></p><div className="hand">{cards.map((card, index) => <div key={`${cardId(card)}-${index}`}><small>{index + 1}</small><CardFace card={card} compact /></div>)}</div></section>
}

export default App
