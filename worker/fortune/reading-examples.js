// Editorial examples, not outputs retrieved from mytarotapp or live AI.
export const READING_EXAMPLES = [
  {
    "id": "launch",
    "question": "Should I launch my idea now or keep working on it?",
    "names": [
      "The Magician",
      "Eight of Pentacles",
      "The Fool"
    ],
    "answer": "Launch a small version now. The thing holding this back may no longer be the work itself, but the hope that enough polishing will make being seen feel safe.\n\nThere’s a moment in this spread that feels like standing behind a closed shop door, rearranging the window while someone outside is waiting to come in. You have something to offer. The craft matters, but eventually the work needs a person on the other side of it. That first imperfect exchange can teach you more than another quiet month of getting everything right.\n\nSo make the opening smaller, not later. Choose one person, one useful promise and one version you can stand behind. You don’t have to announce who you’ll become. You only have to let someone meet what you’ve made."
  },
  {
    "id": "career",
    "question": "Should I leave my job to do something of my own?",
    "names": [
      "The Hanged Man",
      "The Emperor",
      "The Chariot"
    ],
    "answer": "Move toward your own thing, but give the decision a foundation before you give notice. This reading favors a deliberate departure over a dramatic escape.\n\nThe tension here is between two kinds of freedom: the relief of leaving something behind, and the deeper freedom of having something that can carry you forward. Imagine your first Monday on your own. The old meetings are gone, but the blank calendar is asking a question of its own: what have you built that makes this day yours?\n\nUse the restlessness as fuel. Make room for a real experiment while the structure of your job still supports you. A paying customer, a repeatable habit, a workable plan—look for evidence that you are being pulled toward a life you want. Then leaving becomes a decision you can stand on, rather than a feeling you need to outrun."
  },
  {
    "id": "connection",
    "question": "Is there potential with this person, or am I imagining it?",
    "names": [
      "The Lovers",
      "The High Priestess",
      "Six of Pentacles"
    ],
    "answer": "There may be potential here, but your imagination has been doing more of the work than the connection has. The next answer needs to come from them.\n\nThis spread has the feeling of a conversation that continues long after the other person has left: the glance you replay, the message you read twice, the little details that could mean everything or nothing. Your intuition deserves a place at the table. It just shouldn’t have to speak for both of you. A connection becomes real through the small things that move in both directions—attention returned, plans made, curiosity that reaches back.\n\nOffer one clear invitation and leave space for an honest response. You are not auditioning for their interest. You are finding out whether there is something here you can build together."
  }
];
export function findExample(question) { return READING_EXAMPLES.find(e => e.question.trim().toLowerCase() === question.trim().toLowerCase()); }
