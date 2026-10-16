import { apiJson } from '@/lib/api/client';

/** Maia Voice: metadados de organização da Biblioteca de Vozes (`/maia/library`). */
export const LIBRARY_CATEGORIES = [
  'anuncio',
  'narracao',
  'atendimento',
  'personagem',
  'institucional',
  'social',
  'outro',
] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export interface LibraryMeta {
  category: LibraryCategory | '';
  client: string;
  tags: string[];
  favorite: boolean;
  notes: string;
}

export interface LibraryMetaItem extends LibraryMeta {
  profile_id: string;
  updated_at?: number | null;
}

export const EMPTY_LIBRARY_META: LibraryMeta = {
  category: '',
  client: '',
  tags: [],
  favorite: false,
  notes: '',
};

export async function listLibraryMeta(): Promise<Record<string, LibraryMetaItem>> {
  const response = await apiJson<{ items: LibraryMetaItem[] }>('/maia/library');
  const byId: Record<string, LibraryMetaItem> = {};
  for (const item of response.items ?? []) byId[item.profile_id] = item;
  return byId;
}

export function saveLibraryMeta(profileId: string, meta: LibraryMeta): Promise<LibraryMetaItem> {
  return apiJson<LibraryMetaItem>(`/maia/library/${encodeURIComponent(profileId)}`, {
    method: 'PUT',
    body: JSON.stringify(meta),
  });
}

/** Normaliza tags digitadas como "anúncio, varejo; promo". */
export function parseTags(raw: string): string[] {
  const seen: string[] = [];
  for (const piece of raw.split(/[,;\n]/)) {
    const tag = piece.trim().replace(/\s+/g, ' ').toLocaleLowerCase().slice(0, 40);
    if (tag && !seen.includes(tag)) seen.push(tag);
  }
  return seen.slice(0, 20);
}
