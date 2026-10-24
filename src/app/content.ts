import tagsJson from '../../content/tags.json';
import { loadDictionary, type TagDictionary } from '../core/index.ts';

/** Content is bundled and parsed once at startup; core receives the parsed objects. */
export const TAGS: TagDictionary = loadDictionary(tagsJson);
