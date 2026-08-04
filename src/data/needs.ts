/** Need (needs) definitions. Decay rates & thresholds govern autonomous behavior. */

export interface NeedDef {
  id: 'hunger' | 'rest' | 'joy' | 'mood' | 'temperature' | 'health';
  name: string;
  /** Fall per second (0-100 scale). */
  decayRate: number;
  /** Value below which the colonist autonomously seeks to satisfy this need. */
  seekThreshold: number;
  /** Value below which it becomes critical (forced seek regardless of job priority). */
  criticalThreshold: number;
  /** Optional: above this value the need is considered comfortable (for rise/fall). */
  goodThreshold?: number;
}

export const NEEDS: NeedDef[] = [
  { id: 'hunger', name: 'Hunger', decayRate: 0.6, seekThreshold: 40, criticalThreshold: 18 },
  { id: 'rest', name: 'Rest', decayRate: 0.45, seekThreshold: 35, criticalThreshold: 15 },
  { id: 'joy', name: 'Joy', decayRate: 0.18, seekThreshold: 20, criticalThreshold: 8 },
  { id: 'mood', name: 'Mood', decayRate: 0.0, seekThreshold: 0, criticalThreshold: 0 },
];

/** Colonist traits (personality) that modulate need decay & mood events. */
export interface TraitDef {
  id: string;
  name: string;
  description: string;
  /** Mood modifier (constant offset to equilibrium). */
  moodMod?: number;
  /** Multiplier applied to a need's decay (id=need). */
  needMod?: { need: string; mult: number }[];
  /** Skill multiplier. */
  skillMod?: { skill: string; mult: number }[];
}

export const TRAITS: Record<string, TraitDef> = {
  hardWorker: {
    id: 'hardWorker', name: 'Hard Worker',
    description: 'Works faster at every job.', moodMod: 2,
    skillMod: [{ skill: '*', mult: 1.15 }],
  },
  nightOwl: {
    id: 'nightOwl', name: 'Night Owl',
    description: 'Needs less sleep.', needMod: [{ need: 'rest', mult: 0.75 }],
  },
  gourmand: {
    id: 'gourmand', name: 'Gourmand',
    description: 'Doesn\'t last as long without food.', needMod: [{ need: 'hunger', mult: 1.3 }],
    moodMod: 3,
  },
  pessimist: {
    id: 'pessimist', name: 'Pessimist',
    description: 'Gets demoralised easily.', moodMod: -6,
  },
  brave: {
    id: 'brave', name: 'Brave',
    description: 'Shrugs off danger.', moodMod: 5,
  },
  skittish: {
    id: 'skittish', name: 'Skittish',
    description: 'Flees from threats quickly.', moodMod: -2,
  },
};
