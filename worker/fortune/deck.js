// =====================
// Helper Functions
// =====================

// Normalize card names for file paths
function normalizeCardName(name) {
  return name
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/'/g, "");
}

// Small webp placeholder (keep this in /public/assets/faces/placeholder.webp)
const PLACEHOLDER = "/assets/faces/placeholder.webp";

// Build the face path (all faces are webp now)
function imagePath(cardName) {
  return `/assets/faces/webp/${normalizeCardName(cardName)}.webp`;
}

// Erika's signature meaning style
function erikaMeaning(meaning) {
  return `Erika says: ${meaning}`;
}

// =====================
// Tarot Deck
// =====================
const deck = {
  // ==== MAJOR ARCANA ====
  "The Fool": { upright: erikaMeaning("Adventurous, spontaneous, hopeful — a leap of faith calls you forward. Travel, fresh starts, and your inner child light the path."), reversed: erikaMeaning("Reckless or hesitant energy — be mindful before diving in without direction."), image: imagePath("The Fool") },
  "The Magician": { upright: erikaMeaning("Resourceful, powerful, and focused. You have *all* the tools to succeed — it’s time to act."), reversed: erikaMeaning("Energy feels scattered or manipulative. Realign before moving forward."), image: imagePath("The Magician") },
  "The High Priestess": { upright: erikaMeaning("Intuition is your superpower. Secrets surface, documents sign, wisdom flows through you."), reversed: erikaMeaning("Feeling disconnected from your own wisdom. Pause to realign with your inner knowing."), image: imagePath("The High Priestess") },
  "The Empress": { upright: erikaMeaning("Abundance, creativity, and nurturing energy surround you. You’re embodying self-worth."), reversed: erikaMeaning("Insecurity or creative block — nurture yourself first to restore flow."), image: imagePath("The Empress") },
  "The Emperor": { upright: erikaMeaning("Authority, structure, and leadership. A time for discipline and creating foundations that last."), reversed: erikaMeaning("Rigid control or over-dominance could be stifling growth — adjust your approach."), image: imagePath("The Emperor") },
  "The Hierophant": { upright: erikaMeaning("Tradition, spiritual guidance, and commitments. A teacher or mentor brings wisdom."), reversed: erikaMeaning("Breaking away from traditions or restrictive beliefs. Trust your unique path."), image: imagePath("The Hierophant") },
  "The Lovers": { upright: erikaMeaning("Romance, harmony, and soulmate energy. Choices from the heart bring alignment."), reversed: erikaMeaning("Conflict or imbalance in love or self-alignment. A choice must be made."), image: imagePath("The Lovers") },
  "The Chariot": { upright: erikaMeaning("Victory through determination. Movement forward, relocation, and triumph over obstacles."), reversed: erikaMeaning("Energy feels scattered. Focus and clarity are needed to move forward."), image: imagePath("The Chariot") },
  "Strength": { upright: erikaMeaning("Courage, compassion, and resilience. Your inner power is strong and healing confidence blooms."), reversed: erikaMeaning("Self-doubt or insecurity creeping in — reconnect to your courage."), image: imagePath("Strength") },
  "The Hermit": { upright: erikaMeaning("Wisdom through introspection. Time for spiritual study, inner guidance, or shadow work."), reversed: erikaMeaning("Isolation or feeling lost — remember that reflection is only part of the path."), image: imagePath("The Hermit") },
  "Wheel of Fortune": { upright: erikaMeaning("Cycles turn in your favor. Destiny, fortune, and karmic alignment shift in your favor."), reversed: erikaMeaning("Resistance to change can create stagnation. Trust the cycle."), image: imagePath("Wheel of Fortune") },
  "Justice": { upright: erikaMeaning("Truth, fairness, and karmic balance. Legal matters resolve justly."), reversed: erikaMeaning("Injustice or dishonesty present. Seek clarity and fairness."), image: imagePath("Justice") },
  "The Hanged Man": { upright: erikaMeaning("Pause, surrender, and new perspective. Redirection aligns you to your true path."), reversed: erikaMeaning("Indecision or resistance delays your progress."), image: imagePath("The Hanged Man") },
  "Death": { upright: erikaMeaning("Transformation, endings, and liberation. Ego death clears space for renewal."), reversed: erikaMeaning("Fear of change keeps you stuck. Release brings freedom."), image: imagePath("Death") },
  "Temperance": { upright: erikaMeaning("Balance, harmony, and integration. Healing flows through patience."), reversed: erikaMeaning("Excess or imbalance disrupts harmony. Adjust your mix."), image: imagePath("Temperance") },
  "The Devil": { upright: erikaMeaning("Attachment, intensity, and toxic ties. Notice where control or addiction is present."), reversed: erikaMeaning("Liberation and detachment release what no longer serves."), image: imagePath("The Devil") },
  "The Tower": { upright: erikaMeaning("Sudden change and disruption shake loose old structures. A breakthrough begins."), reversed: erikaMeaning("Disaster avoided, but inner change still needed."), image: imagePath("The Tower") },
  "The Star": { upright: erikaMeaning("Hope, inspiration, and deep healing. Connection to oneness restores faith."), reversed: erikaMeaning("Feeling disconnected or discouraged — reconnect to your light."), image: imagePath("The Star") },
  "The Moon": { upright: erikaMeaning("Mystery, dreams, and psychic awakening. Emotions bring guidance."), reversed: erikaMeaning("Confusion or fear clouds intuition — clarity is coming."), image: imagePath("The Moon") },
  "The Sun": { upright: erikaMeaning("Joy, success, and radiant energy. Celebration and vitality are here."), reversed: erikaMeaning("Pessimism dims your light — reconnect to joy."), image: imagePath("The Sun") },
  "Judgement": { upright: erikaMeaning("Renewal, accountability, and spiritual awakening call you forward."), reversed: erikaMeaning("Avoidance or regret stalls progress — face the truth."), image: imagePath("Judgement") },
  "The World": { upright: erikaMeaning("Completion, accomplishment, and karmic closure. A chapter ends in wholeness."), reversed: erikaMeaning("Unfinished business delays your fulfillment."), image: imagePath("The World") },

  // ==== WANDS ====
  "Ace of Wands": { upright: erikaMeaning("New spark, passion, and creative ignition arrive — take action."), reversed: erikaMeaning("Delay or creative block — find what excites you again."), image: imagePath("Ace of Wands") },
  "Two of Wands": { upright: erikaMeaning("Future planning, decisions, and vision. You’re at the threshold of expansion."), reversed: erikaMeaning("Fear of change holds you back — trust the next step."), image: imagePath("Two of Wands") },
  "Three of Wands": { upright: erikaMeaning("Expansion, foresight, and progress — opportunities are on the horizon."), reversed: erikaMeaning("Obstacles or delays — patience will still deliver results."), image: imagePath("Three of Wands") },
  "Four of Wands": { upright: erikaMeaning("Celebration, harmony, and homecoming. Joyful milestones arrive."), reversed: erikaMeaning("Instability at home or transition shifts foundations."), image: imagePath("Four of Wands") },
  "Five of Wands": { upright: erikaMeaning("Competition and tension bring growth — hold your ground."), reversed: erikaMeaning("Conflict eases, resolution restores harmony."), image: imagePath("Five of Wands") },
  "Six of Wands": { upright: erikaMeaning("Victory and recognition are yours — step into the spotlight."), reversed: erikaMeaning("Ego or lack of recognition disrupts confidence."), image: imagePath("Six of Wands") },
  "Seven of Wands": { upright: erikaMeaning("Perseverance and defending your ground pay off."), reversed: erikaMeaning("Feeling overwhelmed — release unnecessary battles."), image: imagePath("Seven of Wands") },
  "Eight of Wands": { upright: erikaMeaning("Fast momentum and swift change move things ahead."), reversed: erikaMeaning("Delays or chaos — slow down to realign."), image: imagePath("Eight of Wands") },
  "Nine of Wands": { upright: erikaMeaning("Resilience and persistence bring victory."), reversed: erikaMeaning("Burnout or paranoia drains your energy — rest is needed."), image: imagePath("Nine of Wands") },
  "Ten of Wands": { upright: erikaMeaning("Responsibility and hard work pay off, but lighten your load."), reversed: erikaMeaning("Overwhelm calls for delegation and release."), image: imagePath("Ten of Wands") },
  "Page of Wands": { upright: erikaMeaning("Curiosity, inspiration, and adventure spark new opportunities."), reversed: erikaMeaning("Immaturity or lack of direction — focus your energy."), image: imagePath("Page of Wands") },
  "Knight of Wands": { upright: erikaMeaning("Bold action and passionate pursuit of what excites you."), reversed: erikaMeaning("Impulsiveness or recklessness can disrupt progress."), image: imagePath("Knight of Wands") },
  "Queen of Wands": { upright: erikaMeaning("Magnetism, confidence, and warmth draw success your way."), reversed: erikaMeaning("Insecurity or jealousy dulls your natural radiance."), image: imagePath("Queen of Wands") },
  "King of Wands": { upright: erikaMeaning("Visionary leadership and bold moves bring expansion."), reversed: erikaMeaning("Arrogance or controlling tendencies limit your potential."), image: imagePath("King of Wands") },

  // ==== CUPS ====
  "Ace of Cups": { upright: erikaMeaning("Emotional openings, new love, and heart expansion — a fresh wave of connection flows in."), reversed: erikaMeaning("Blocked emotions or heartbreak — clear space for love again."), image: imagePath("Ace of Cups") },
  "Two of Cups": { upright: erikaMeaning("Soul connection, unity, and romantic partnership align."), reversed: erikaMeaning("Disharmony or imbalance needs addressing."), image: imagePath("Two of Cups") },
  "Three of Cups": { upright: erikaMeaning("Celebration, friendship, and joyful gatherings fill your cup."), reversed: erikaMeaning("Gossip or overindulgence disrupt harmony."), image: imagePath("Three of Cups") },
  "Four of Cups": { upright: erikaMeaning("Reflection and contemplation — new opportunities may be overlooked."), reversed: erikaMeaning("Fresh perspective opens your heart again."), image: imagePath("Four of Cups") },
  "Five of Cups": { upright: erikaMeaning("Loss or grief lingers, but healing and acceptance are within reach."), reversed: erikaMeaning("Emotional recovery opens new possibilities."), image: imagePath("Five of Cups") },
  "Six of Cups": { upright: erikaMeaning("Nostalgia and childhood memories bring comfort."), reversed: erikaMeaning("Living in the past stalls growth."), image: imagePath("Six of Cups") },
  "Seven of Cups": { upright: erikaMeaning("Many choices, dreams, and illusions — clarity will guide you."), reversed: erikaMeaning("Decisiveness cuts through confusion."), image: imagePath("Seven of Cups") },
  "Eight of Cups": { upright: erikaMeaning("Walking away or letting go to honor your soul’s call."), reversed: erikaMeaning("Fear of leaving creates emotional stagnation."), image: imagePath("Eight of Cups") },
  "Nine of Cups": { upright: erikaMeaning("Wishes fulfilled and emotional satisfaction flow to you."), reversed: erikaMeaning("Superficial fulfillment — seek deeper meaning."), image: imagePath("Nine of Cups") },
  "Ten of Cups": { upright: erikaMeaning("Emotional bliss, harmony, and joy with loved ones."), reversed: erikaMeaning("Relationship tension or imbalance needs love."), image: imagePath("Ten of Cups") },
  "Page of Cups": { upright: erikaMeaning("Creative inspiration, intuition, and emotional messages arrive."), reversed: erikaMeaning("Emotional immaturity or blocked creativity appears."), image: imagePath("Page of Cups") },
  "Knight of Cups": { upright: erikaMeaning("Romantic gestures, charm, and following your heart lead the way."), reversed: erikaMeaning("Moodiness or heartbreak slows progress."), image: imagePath("Knight of Cups") },
  "Queen of Cups": { upright: erikaMeaning("Compassion, intuition, and deep emotional connection guide you."), reversed: erikaMeaning("Emotional overwhelm or co-dependency may surface."), image: imagePath("Queen of Cups") },
  "King of Cups": { upright: erikaMeaning("Emotional maturity and balance bring stability in love."), reversed: erikaMeaning("Emotional repression or coldness creates distance."), image: imagePath("King of Cups") },

  // ==== SWORDS ====
  "Ace of Swords": { upright: erikaMeaning("Clarity, truth, and mental breakthroughs. A sharp insight shifts everything."), reversed: erikaMeaning("Confusion or misinformation clouds the way forward."), image: imagePath("Ace of Swords") },
  "Two of Swords": { upright: erikaMeaning("Indecision and stalemate. Trust your intuition when logic feels split."), reversed: erikaMeaning("Emotional overwhelm or avoidance — face what’s in front of you."), image: imagePath("Two of Swords") },
  "Three of Swords": { upright: erikaMeaning("Heartbreak or emotional pain — a truth that hurts but frees you."), reversed: erikaMeaning("Healing and release from past heartbreak."), image: imagePath("Three of Swords") },
  "Four of Swords": { upright: erikaMeaning("Rest, recovery, and retreat. Give your mind space to heal."), reversed: erikaMeaning("Restlessness or burnout — pause before pushing on."), image: imagePath("Four of Swords") },
  "Five of Swords": { upright: erikaMeaning("Conflict, tension, and power struggles — choose your battles."), reversed: erikaMeaning("Resolution and reconciliation follow conflict."), image: imagePath("Five of Swords") },
  "Six of Swords": { upright: erikaMeaning("Transition, moving on, and healing journeys bring peace."), reversed: erikaMeaning("Carrying baggage makes the crossing harder — let go."), image: imagePath("Six of Swords") },
  "Seven of Swords": { upright: erikaMeaning("Strategy, secrecy, or deception. Move wisely."), reversed: erikaMeaning("Truth revealed or coming clean clears the air."), image: imagePath("Seven of Swords") },
  "Eight of Swords": { upright: erikaMeaning("Feeling trapped or mentally blocked — liberation starts in the mind."), reversed: erikaMeaning("Freedom and fresh perspective arrive."), image: imagePath("Eight of Swords") },
  "Nine of Swords": { upright: erikaMeaning("Anxiety or overthinking clouds rest — release self-criticism."), reversed: erikaMeaning("Facing fears brings relief and healing."), image: imagePath("Nine of Swords") },
  "Ten of Swords": { upright: erikaMeaning("Painful ending or betrayal — the worst is over."), reversed: erikaMeaning("Recovery and release from past pain begin."), image: imagePath("Ten of Swords") },
  "Page of Swords": { upright: erikaMeaning("Curiosity, learning, and mental agility bring fresh insight."), reversed: erikaMeaning("Gossip or scattered thinking disrupts clarity."), image: imagePath("Page of Swords") },
  "Knight of Swords": { upright: erikaMeaning("Ambition and quick action. Seize the moment with bold clarity."), reversed: erikaMeaning("Impulsiveness or recklessness can backfire."), image: imagePath("Knight of Swords") },
  "Queen of Swords": { upright: erikaMeaning("Clarity, truth, and independence. Speak with wisdom."), reversed: erikaMeaning("Overcritical or coldness blocks connection."), image: imagePath("Queen of Swords") },
  "King of Swords": { upright: erikaMeaning("Logic, authority, and strategic thinking lead the way."), reversed: erikaMeaning("Misuse of power or manipulation clouds integrity."), image: imagePath("King of Swords") },

  // ==== PENTACLES ====
  "Ace of Pentacles": { upright: erikaMeaning("New opportunity, prosperity, and strong foundations begin."), reversed: erikaMeaning("Missed chances or instability — ground your plans."), image: imagePath("Ace of Pentacles") },
  "Two of Pentacles": { upright: erikaMeaning("Balance, adaptability, and juggling priorities with skill."), reversed: erikaMeaning("Overwhelm or disorganization requires rebalancing."), image: imagePath("Two of Pentacles") },
  "Three of Pentacles": { upright: erikaMeaning("Teamwork, collaboration, and skill development bring success."), reversed: erikaMeaning("Misalignment or lack of effort disrupts progress."), image: imagePath("Three of Pentacles") },
  "Four of Pentacles": { upright: erikaMeaning("Security, stability, and smart saving support growth."), reversed: erikaMeaning("Fear of loss or greed blocks abundance flow."), image: imagePath("Four of Pentacles") },
  "Five of Pentacles": { upright: erikaMeaning("Financial or emotional hardship — support is closer than you think."), reversed: erikaMeaning("Recovery and renewed hope restore stability."), image: imagePath("Five of Pentacles") },
  "Six of Pentacles": { upright: erikaMeaning("Generosity, giving, and balanced exchange flow in relationships and money."), reversed: erikaMeaning("Strings attached or imbalance in giving/receiving."), image: imagePath("Six of Pentacles") },
  "Seven of Pentacles": { upright: erikaMeaning("Patience, long-term investment, and steady growth pay off."), reversed: erikaMeaning("Impatience or wasted effort delays results."), image: imagePath("Seven of Pentacles") },
  "Eight of Pentacles": { upright: erikaMeaning("Mastery, dedication, and skill-building create excellence."), reversed: erikaMeaning("Perfectionism or burnout slows progress."), image: imagePath("Eight of Pentacles") },
  "Nine of Pentacles": { upright: erikaMeaning("Independence, luxury, and self-worth shine."), reversed: erikaMeaning("Over-dependence or insecurity clouds abundance."), image: imagePath("Nine of Pentacles") },
  "Ten of Pentacles": { upright: erikaMeaning("Legacy, family wealth, and lasting stability align."), reversed: erikaMeaning("Financial loss or broken tradition disrupts security."), image: imagePath("Ten of Pentacles") },
  "Page of Pentacles": { upright: erikaMeaning("Opportunity, ambition, and a learning mindset open new doors."), reversed: erikaMeaning("Lack of commitment or missed opportunity delays growth."), image: imagePath("Page of Pentacles") },
  "Knight of Pentacles": { upright: erikaMeaning("Reliability, responsibility, and steady progress build success."), reversed: erikaMeaning("Stagnation or over-caution slows momentum."), image: imagePath("Knight of Pentacles") },
  "Queen of Pentacles": { upright: erikaMeaning("Nurturing, grounded, and prosperous energy supports life balance."), reversed: erikaMeaning("Work-life imbalance or insecurity needs attention."), image: imagePath("Queen of Pentacles") },
  "King of Pentacles": { upright: erikaMeaning("Abundance, discipline, and wise leadership bring wealth."), reversed: erikaMeaning("Greed or rigidity blocks prosperity."), image: imagePath("King of Pentacles") }
};

export default deck;
