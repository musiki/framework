import { query } from '../../db/pool';
import { createNoteAccessResolver, createNoteAccessDetail } from './access-core.ts';

export const getNoteAccess = createNoteAccessResolver(query);
export const getNoteAccessDetail = createNoteAccessDetail(query);
