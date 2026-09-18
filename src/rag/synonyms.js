/**
 * Multilingual query expansion for catalog RAG.
 * Groups are matched if ANY member appears; the whole group is added to the query.
 */

export const MOOD_SYNONYMS = {
  combat: [
    "combat", "fight", "battle", "attack", "initiative", "war", "boss",
    "戰鬥", "战斗", "打仗", "開戰", "开战", "攻擊", "攻击", "打交", "打緊交", "打架",
    "死咗", "死了", "死人", "死曬", "死晒", "殺死", "击杀", "擊殺", "流血", "流曬血",
    "戦い", "戦闘", "攻撃", "殺し"
  ],
  horror: [
    "horror", "dread", "undead", "ghost", "haunt", "fear", "abyss",
    "恐怖", "恐懼", "恐惧", "鬼", "亡靈", "亡灵", "陰森", "阴森",
    "ホラー", "恐怖", "呪い"
  ],
  tavern: [
    "tavern", "inn", "ale", "bar", "drink", "folk",
    "酒館", "酒馆", "酒吧", "旅館", "旅馆", "居酒屋"
  ],
  sad: [
    "sad", "grief", "funeral", "tears", "lament", "sorrow", "rain",
    "悲傷", "悲伤", "葬禮", "葬礼", "哀悼", "哭",
    "悲しみ", "涙"
  ],
  mystery: [
    "mystery", "clue", "secret", "whisper", "noir",
    "謎", "谜", "秘密", "線索", "线索", "ミステリー"
  ],
  tension: [
    "tension", "tense", "stealth", "sneak", "uneasy",
    "緊張", "紧张", "潛行", "潜行", "偷偷", "サスペンス"
  ],
  travel: [
    "travel", "road", "journey", "horse", "explore", "exploration",
    "旅行", "旅途", "道路", "探索", "旅"
  ],
  social: [
    "social", "court", "talk", "hub", "character",
    "社交", "宮廷", "宫廷", "会話"
  ],
  ambient: [
    "ambient", "calm", "peace", "camp", "underscore", "quiet",
    "氛圍", "氛围", "平靜", "平静", "安寧", "安宁", "アンビエント"
  ],
  epic: [
    "epic", "heroic", "climax", "victory", "triumph", "ascension",
    "史詩", "史诗", "高潮", "勝利", "胜利", "叙事詩"
  ]
};

const TOKEN_TO_MOOD = new Map();
for (const [mood, words] of Object.entries(MOOD_SYNONYMS)) {
  for (const word of words) TOKEN_TO_MOOD.set(word.toLowerCase(), mood);
}

export function moodFromToken(token = "") {
  return TOKEN_TO_MOOD.get(String(token).toLowerCase()) || "";
}

export function expandQuery(text = "", mood = "") {
  const blob = String(text || "");
  const lower = blob.toLowerCase();
  const extra = [];
  if (mood && MOOD_SYNONYMS[mood]) extra.push(mood, ...MOOD_SYNONYMS[mood]);
  for (const [key, words] of Object.entries(MOOD_SYNONYMS)) {
    if (words.some(word => lower.includes(word.toLowerCase()))) {
      extra.push(key, ...words);
    }
  }
  return uniqueTokens([blob, ...extra]);
}

export function uniqueTokens(parts) {
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    for (const token of tokenizeSearch(part)) {
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

export function tokenizeSearch(text = "") {
  const raw = String(text).toLowerCase();
  const latin = raw.split(/[^a-z0-9]+/g).filter(token => token.length > 1);
  const cjk = raw.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]{1,8}/g) || [];
  const grams = [];
  for (const chunk of cjk) {
    grams.push(chunk);
    if (chunk.length >= 2) {
      for (let i = 0; i < chunk.length - 1; i++) grams.push(chunk.slice(i, i + 2));
    }
  }
  return [...latin, ...grams];
}
