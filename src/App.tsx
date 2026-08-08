import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clipboard, DoorOpen, Plus, ShieldAlert, Users } from 'lucide-react'
import {
  RANKS,
  awardAndAdvance,
  cardId,
  deck,
  isRed,
  isValidOrder,
  makeInitialGame,
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

function CardFace({ card, selected, compact, onClick }: { card: Card; selected?: boolean; compact?: boolean; onClick?: () => void }) {
  return (
    <button
      className={`card ${isRed(card.suit) ? 'red' : ''} ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`}
      onClick={onClick}
      type="button"
      aria-label={`${suitSymbol(card.suit)} ${card.rank}`}
    >
      <span>{card.rank}</span>
      <strong>{suitSymbol(card.suit)}</strong>
    </button>
  )
}

function PlayerPanel({ player, opponent }: { player: GameState['players'][number]; opponent?: boolean }) {
  return (
    <div className={`player-panel ${opponent ? 'opponent' : ''}`}>
      <div className="player-name">
        {opponent && <span className={`status-light ${player.warningOn ? 'warning' : ''}`} />}
        {player.nickname}
      </div>
      {!opponent && <div className="chip-count"><span className="chip-mini" /> {player.tokens} CHIP</div>}
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

  const me = game.players[game.myIndex]
  const opponent = game.players[game.myIndex === 0 ? 1 : 0]

  const clearOnlineSession = () => {
    localStorage.removeItem(SESSION_ROOM_KEY)
    localStorage.removeItem(SESSION_NICKNAME_KEY)
  }

  const applyOnlineRoom = (room: OnlineRoom, uid: string) => {
    const myIndex = Math.max(0, room.players.findIndex((player) => player.uid === uid)) as 0 | 1
    setGame((current) => {
      const players = room.players.map((player) => ({
        id: player.uid,
        nickname: player.nickname,
        tokens: player.uid === uid ? current.players[current.myIndex].tokens : 0,
        warningOn: player.warningOn,
        ready: player.ready,
        confirmed: player.confirmed,
        betSubmitted: player.betSubmitted,
      }))
      if (players.length === 1) players.push({ id: 'waiting', nickname: '상대 플레이어', tokens: 0, warningOn: false, ready: false, confirmed: false, betSubmitted: false })
      return {
        ...current,
        phase: room.phase,
        round: room.round,
        myIndex,
        players: [players[0], players[1]],
        opponentBet: null,
        winnerIndex: room.winnerUid ? (room.players.findIndex((player) => player.uid === room.winnerUid) as 0 | 1) : null,
        action: room.action,
        result: room.result,
        message: room.message,
      }
    })
    setView(room.phase === 'lobby' ? 'lobby' : 'game')
  }

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
      setError(reason.message)
      if (reason.message.includes('찾을 수 없습니다') || reason.message.includes('permission')) {
        clearOnlineSession()
        setRoomCode('')
        setView('home')
      }
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
  }, [onlineUid, roomCode])

  const toggleReady = () => {
    if (firebaseEnabled) { void setOnlineReady(roomCode, !me.ready).catch((reason) => setError(reason.message)); return }
    setGame((current) => {
      const players = current.players.map((player, index) => index === current.myIndex ? { ...player, ready: !player.ready } : { ...player, ready: true }) as GameState['players']
      return { ...current, players, message: '두 플레이어가 준비되었습니다.' }
    })
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
    if (firebaseEnabled) { void submitOnlineBet(roomCode, game.bet).catch((reason) => setError(reason.message)); return }
    const opponentBet = Math.min(opponent.tokens, Math.max(1, Math.floor(Math.random() * 6) + 1))
    setGame((current) => resolveLocalBet(current, opponentBet))
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

  const phaseLabel = useMemo(() => ({
    lobby: 'LOBBY', card_selection: 'CARD SELECTION', betting: 'SECRET BET', bet_result: 'BET RESULT', action_choice: '', question: 'QUESTION', truth: 'TRUTH', round_end: 'ROUND END', game_over: 'GAME OVER',
  })[game.phase], [game.phase])

  if (view === 'home') {
    return (
      <main className="home-shell">
        <section className="home-panel">
          <div className="brand-mark">Q<span>&</span>T</div>
          <p className="eyebrow">TWO PLAYER TABLE GAME</p>
          <h1>질문과 진실</h1>
          <p className="home-copy">카드를 숨기고, 칩을 걸고, 상대의 진실을 꿰뚫어 보세요.</p>
          <label className="field-label" htmlFor="nickname">닉네임</label>
          <input id="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="이름을 입력하세요" />
          <button className="primary wide" type="button" disabled={!nickname.trim()} onClick={() => void enterLobby()}><Plus size={18} /> 방 만들기</button>
          <div className="join-row">
            <input value={roomInput} onChange={(event) => setRoomInput(event.target.value.toUpperCase())} maxLength={6} placeholder="방 코드 6자리" />
            <button className="secondary" type="button" disabled={!nickname.trim() || roomInput.length !== 6} onClick={() => void enterLobby(roomInput)}><DoorOpen size={18} /> 참가</button>
          </div>
          {error && <p className="form-error"><ShieldAlert size={14} /> {error}</p>}
          <p className="demo-note">{firebaseEnabled ? '익명 인증으로 안전하게 연결됩니다.' : 'Firebase 설정 전에는 한 브라우저에서 전체 흐름을 확인하는 데모로 실행됩니다.'}</p>
        </section>
      </main>
    )
  }

  if (view === 'lobby') {
    return (
      <main className="lobby-shell">
        <section className="lobby-panel">
          <p className="eyebrow">PRIVATE ROOM</p>
          <h1>상대를 기다리는 중</h1>
          <div className="room-code"><span>방 코드</span><strong>{roomCode}</strong><button className="icon-button" title="방 코드 복사" type="button" onClick={() => { navigator.clipboard?.writeText(roomCode); setCopied(true) }}>{copied ? <Check /> : <Clipboard />}</button></div>
          <div className="versus">
            <div><span className="avatar">01</span><strong>{game.players[0].nickname}</strong><small>{game.players[0].ready ? '준비 완료' : '대기 중'}</small></div>
            <b>VS</b>
            <div><span className="avatar muted">02</span><strong>{game.players[1].nickname}</strong><small>{game.players[1].ready ? '준비 완료' : '입장 완료'}</small></div>
          </div>
          <button className="primary wide" type="button" onClick={toggleReady}>{me.ready ? <Check size={18} /> : <Users size={18} />} {me.ready ? '준비 완료' : '준비'}</button>
          {error && <p className="form-error"><ShieldAlert size={14} /> {error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <span className="round">ROUND <b>{game.round}</b></span>
        {phaseLabel && <span className="phase">{phaseLabel}</span>}
        <span className="room-small">ROOM {roomCode}</span>
      </header>
      <section className="scoreboard">
        <PlayerPanel player={me} />
        <span className="versus-small">VS</span>
        <PlayerPanel player={opponent} opponent />
      </section>
      <section className={`stage stage-${game.phase}`}>
        {game.phase === 'card_selection' && (me.confirmed
          ? <Waiting text="상대가 카드 배치를 확정하기를 기다리고 있습니다." />
          : <CardSelection selected={game.selectedCards} onToggle={toggleCard} onConfirm={confirmCards} />)}
        {game.phase === 'betting' && (me.betSubmitted
          ? <Waiting text="상대가 베팅을 완료하기를 기다리고 있습니다." />
          : <Betting game={game} setGame={setGame} onConfirm={confirmBet} />)}
        {game.phase === 'bet_result' && <Waiting text={game.message} />}
        {game.phase === 'action_choice' && (game.winnerIndex === game.myIndex
          ? <ActionChoice onChoose={chooseAction} />
          : <Waiting text="상대방의 차례입니다." />)}
        {game.phase === 'question' && <Question onDone={() => endRound()} />}
        {game.phase === 'truth' && <Truth guess={game.truthGuess} onChange={changeGuess} onDeclare={declareTruth} />}
        {game.phase === 'round_end' && <Waiting text={game.message} />}
        {game.phase === 'game_over' && <GameOver onHome={() => { clearOnlineSession(); setRoomCode(''); setGame(makeInitialGame()); setView('home') }} />}
      </section>
      {game.phase !== 'card_selection' && game.myCards.length > 0 && <MyCards cards={game.myCards} />}
    </main>
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
  return <div className="center-action"><p className="eyebrow">SECRET BET</p><h2>얼마를 걸겠습니까?</h2><p>{game.message || '두 플레이어의 베팅 수는 서로에게 공개되지 않습니다.'}</p><div className="stepper"><button title="베팅 감소" onClick={() => setGame((current) => ({ ...current, bet: Math.max(1, current.bet - 1) }))}><ChevronLeft /></button><div><strong>{game.bet}</strong><span>CHIP</span></div><button title="베팅 증가" onClick={() => setGame((current) => ({ ...current, bet: Math.min(game.players[game.myIndex].tokens, current.bet + 1) }))}><ChevronRight /></button></div><button className="primary" onClick={onConfirm}>베팅 확정</button></div>
}

function ActionChoice({ onChoose }: { onChoose: (action: Action) => void }) {
  return <div className="center-action"><h2>행동을 선택하세요.</h2><div className="action-grid"><button onClick={() => onChoose('QUESTION')}><span>Q</span><strong>QUESTION</strong><small>상대에게 직접 질문하기</small></button><button onClick={() => onChoose('TRUTH')}><span>T</span><strong>TRUTH</strong><small>카드 배열 선언하기</small></button></div></div>
}

function Question({ onDone }: { onDone: () => void }) {
  return <div className="center-action question"><span className="giant-letter">Q</span><p className="eyebrow">QUESTION</p><h2>상대에게 질문하세요.</h2><button className="primary" onClick={onDone}>질문 완료</button></div>
}

function Truth({ guess, onChange, onDeclare }: { guess: Rank[]; onChange: (index: number, rank: Rank) => void; onDeclare: () => void }) {
  return <div className="truth-panel"><div className="stage-heading"><p>TRUTH</p><h2>상대 카드의 값과 순서를 선언하세요</h2></div><div className="truth-grid">{guess.map((rank, index) => <label key={index}><span>{index + 1}</span><select value={rank} onChange={(event) => onChange(index, event.target.value as Rank)}>{RANKS.map((item) => <option key={item}>{item}</option>)}</select></label>)}</div><button className="primary" onClick={onDeclare}>TRUTH 선언</button></div>
}

function GameOver({ onHome }: { onHome: () => void }) {
  return <div className="center-action"><span className="result-mark">TRUTH</span><p className="eyebrow">GAME OVER</p><h2>정답입니다.</h2><p>상대의 카드 배열을 정확히 알아냈습니다.</p><button className="primary" onClick={onHome}>처음으로</button></div>
}

function Waiting({ text }: { text: string }) { return <div className="center-action waiting"><h2>{text}</h2></div> }

function MyCards({ cards }: { cards: Card[] }) {
  return <section className="my-cards"><p className="eyebrow">MY CARDS</p><div className="hand">{cards.map((card, index) => <div key={`${cardId(card)}-${index}`}><small>{index + 1}</small><CardFace card={card} compact /></div>)}</div></section>
}

export default App
