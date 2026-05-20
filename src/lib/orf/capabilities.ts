import type { OrfActionType, OrfRisk } from './schema';

export type OrfCapabilityKind =
  | 'text.note'
  | 'chat.message'
  | 'board.note'
  | 'board.drawing'
  | 'midi.sequence'
  | 'lilypond.score';

export type OrfCapabilityManifest = {
  actionType: OrfActionType;
  description: string;
  id: string;
  kind: OrfCapabilityKind;
  outputs: string[];
  risk: OrfRisk;
};

export type OrfSkillManifest = {
  capabilityIds: string[];
  description: string;
  id: string;
  name: string;
  outputs: string[];
  version: string;
};

export const ORF_CAPABILITIES: OrfCapabilityManifest[] = [
  {
    actionType: 'chat.message',
    description: 'Publish a clean Markdown message as Orf in the room chat.',
    id: 'room.chat.message',
    kind: 'chat.message',
    outputs: ['chat.message'],
    risk: 'low',
  },
  {
    actionType: 'notes.write',
    description: 'Append a Markdown note to the room notes pod.',
    id: 'room.notes.write',
    kind: 'text.note',
    outputs: ['notes.write'],
    risk: 'medium',
  },
  {
    actionType: 'lilypond.score',
    description: 'Write a complete LilyPond source block to LILY-CODE and optionally render it.',
    id: 'notation.lilypond.score',
    kind: 'lilypond.score',
    outputs: ['lilypond.score'],
    risk: 'medium',
  },
  {
    actionType: 'board.note',
    description: 'Place text on the whiteboard using normalized coordinates.',
    id: 'room.board.note',
    kind: 'board.note',
    outputs: ['board.note'],
    risk: 'medium',
  },
  {
    actionType: 'board.draw',
    description: 'Draw simple normalized strokes on the whiteboard.',
    id: 'room.board.draw',
    kind: 'board.drawing',
    outputs: ['board.draw'],
    risk: 'medium',
  },
  {
    actionType: 'midi.sequence',
    description: 'Play a bounded MIDI note sequence on Hyperpiano.',
    id: 'performance.hyperpiano.sequence',
    kind: 'midi.sequence',
    outputs: ['midi.sequence'],
    risk: 'high',
  },
];

export const ORF_SKILLS: OrfSkillManifest[] = [
  {
    capabilityIds: ['room.chat.message', 'room.notes.write'],
    description: 'Explain concepts using the active course/session context and optionally leave a note.',
    id: 'pedagogy.explain-concept',
    name: 'Explain Concept',
    outputs: ['chat.message', 'notes.write'],
    version: '0.1.0',
  },
  {
    capabilityIds: ['notation.lilypond.score', 'performance.hyperpiano.sequence', 'room.notes.write'],
    description: 'Compose a short musical cell, notate it, optionally play it, and leave a short explanation.',
    id: 'composition.generate-motif',
    name: 'Generate Motif',
    outputs: ['lilypond.score', 'midi.sequence', 'notes.write'],
    version: '0.1.0',
  },
  {
    capabilityIds: ['room.board.note', 'room.board.draw', 'room.chat.message'],
    description: 'Place diagrams or explanatory text on the room whiteboard.',
    id: 'room.draw-board',
    name: 'Draw Board',
    outputs: ['board.note', 'board.draw', 'chat.message'],
    version: '0.1.0',
  },
];

export const formatOrfCapabilityPrompt = () => {
  const capabilities = ORF_CAPABILITIES
    .map((capability) => `- ${capability.id} -> ${capability.actionType}: ${capability.description}`)
    .join('\n');
  const skills = ORF_SKILLS
    .map((skill) => `- ${skill.id} (${skill.version}): ${skill.description}`)
    .join('\n');
  return `Skills disponibles:\n${skills}\n\nCapabilities disponibles:\n${capabilities}`;
};
