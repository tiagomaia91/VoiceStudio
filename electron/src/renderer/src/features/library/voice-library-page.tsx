import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FingerprintIcon,
  LibraryBigIcon,
  PencilIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  StarIcon,
  TagIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { WorkspacePane } from '@/components/workspace-pane';
import { EditProfile } from '@/features/clone/edit-profile';
import { ProfilePreviewButton } from '@/features/clone/voices-sidebar';
import { formatRelative } from '@/features/clone/format';
import { readDraft, replaceRecipe, restoreDesignProfile, writeDraft } from '@/features/design/design-draft';
import { useBackendStatus } from '@/hooks/use-backend-status';
import { useProfiles } from '@/hooks/use-profiles';
import { useTtsReadiness } from '@/hooks/use-tts-readiness';
import { describeError } from '@/lib/api/client';
import {
  EMPTY_LIBRARY_META,
  LIBRARY_CATEGORIES,
  listLibraryMeta,
  parseTags,
  saveLibraryMeta,
  type LibraryCategory,
  type LibraryMeta,
  type LibraryMetaItem,
} from '@/lib/api/maia-library';
import type { Profile } from '@/lib/api/types';
import { runRendererTask } from '@/lib/global-error-recovery';
import { setCloneSetting } from '@/lib/store/clone-settings';
import { selectCloneProfile } from '@/lib/store/reference';
import { setWorkspace, useWorkspace } from '@/lib/store/workspace';
import { cn } from '@/lib/utils';
import { isBackendReachable } from '@shared/utils/backendStage';

const LIBRARY_KEY = ['maia-library'] as const;

type KindFilter = 'all' | 'favorites' | 'clone' | 'design';
type SortMode = 'recent' | 'name' | 'favorites';

function createdAtSeconds(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

function useLibraryMeta() {
  const status = useBackendStatus();
  return useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: listLibraryMeta,
    staleTime: 30_000,
    enabled: isBackendReachable(status.stage),
  });
}

function useSaveLibraryMeta() {
  const client = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ profileId, meta }: { profileId: string; meta: LibraryMeta }) =>
      saveLibraryMeta(profileId, meta),
    onMutate: async ({ profileId, meta }) => {
      await client.cancelQueries({ queryKey: LIBRARY_KEY });
      const previous = client.getQueryData<Record<string, LibraryMetaItem>>(LIBRARY_KEY);
      client.setQueryData<Record<string, LibraryMetaItem>>(LIBRARY_KEY, (current) => ({
        ...(current ?? {}),
        [profileId]: { ...meta, profile_id: profileId },
      }));
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) client.setQueryData(LIBRARY_KEY, context.previous);
      toast.error(t('voiceLibrary.save_failed', { message: describeError(error) }));
    },
    onSettled: () => void client.invalidateQueries({ queryKey: LIBRARY_KEY }),
  });
}

export function VoiceLibraryPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const library = useLibraryMeta();
  const saveMeta = useSaveLibraryMeta();
  const ttsBlocker = useTtsReadiness();
  const { editingProfileId } = useWorkspace();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [category, setCategory] = useState<LibraryCategory | 'all'>('all');
  const [client, setClient] = useState<string>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('recent');
  const [organizing, setOrganizing] = useState<Profile | null>(null);

  const allProfiles = profiles.data ?? [];
  const metaById = library.data ?? {};
  const metaFor = (id: string): LibraryMeta => metaById[id] ?? EMPTY_LIBRARY_META;

  const clients = useMemo(() => {
    const set = new Set<string>();
    for (const item of Object.values(metaById)) if (item.client) set.add(item.client);
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [metaById]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of Object.values(metaById))
      for (const value of item.tags ?? []) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  }, [metaById]);

  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = allProfiles.filter((profile) => {
      const meta = metaById[profile.id] ?? EMPTY_LIBRARY_META;
      if (kind === 'favorites' && !meta.favorite) return false;
      if ((kind === 'clone' || kind === 'design') && profile.kind !== kind) return false;
      if (category !== 'all' && meta.category !== category) return false;
      if (client !== 'all' && meta.client !== client) return false;
      if (tag && !meta.tags.includes(tag)) return false;
      if (!normalized) return true;
      const haystack = [
        profile.name,
        profile.instruct ?? '',
        profile.ref_text ?? '',
        profile.language ?? '',
        meta.client,
        meta.notes,
        meta.tags.join(' '),
        meta.category ? t(`voiceLibrary.category_${meta.category}`) : '',
      ]
        .join(' ')
        .toLocaleLowerCase();
      return haystack.includes(normalized);
    });
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR');
      if (sort === 'favorites') {
        const diff = Number(metaFor(b.id).favorite) - Number(metaFor(a.id).favorite);
        if (diff) return diff;
      }
      return createdAtSeconds(b.created_at) - createdAtSeconds(a.created_at);
    });
    // metaFor reads metaById, already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProfiles, metaById, query, kind, category, client, tag, sort, t]);

  const favoritesCount = allProfiles.filter((p) => metaById[p.id]?.favorite).length;
  const filtersActive =
    kind !== 'all' || category !== 'all' || client !== 'all' || tag !== null || query !== '';
  const editing = allProfiles.find((profile) => profile.id === editingProfileId);

  const clearFilters = () => {
    setQuery('');
    setKind('all');
    setCategory('all');
    setClient('all');
    setTag(null);
  };

  const toggleFavorite = (profile: Profile) => {
    const meta = metaFor(profile.id);
    saveMeta.mutate({ profileId: profile.id, meta: { ...meta, favorite: !meta.favorite } });
  };

  const applyVoice = (profile: Profile) => {
    if (profile.kind === 'design') {
      const current = readDraft();
      const restored = restoreDesignProfile(profile, current.seed);
      writeDraft(
        replaceRecipe(current, {
          attrs: restored.attrs,
          seed: restored.seed,
          profileId: restored.profileId,
        }),
      );
      setCloneSetting('language', restored.language);
      runRendererTask('Use library voice in design', () => navigate({ to: '/design' }));
      return;
    }
    selectCloneProfile(profile);
    runRendererTask('Use library voice in cloning', () => navigate({ to: '/clone' }));
  };

  const kindChips: { value: KindFilter; label: string; count?: number }[] = [
    { value: 'all', label: t('voiceLibrary.filter_all'), count: allProfiles.length },
    { value: 'favorites', label: t('voiceLibrary.filter_favorites'), count: favoritesCount },
    { value: 'clone', label: t('voiceLibrary.filter_cloned') },
    { value: 'design', label: t('voiceLibrary.filter_designed') },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader>
        <h1 className="flex items-center gap-2 text-sm font-medium">
          <LibraryBigIcon className="size-4 text-primary" aria-hidden="true" />
          {t('voiceLibrary.title')}
        </h1>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runRendererTask('Open voice cloning', () => navigate({ to: '/clone' }))}
          >
            <FingerprintIcon />
            <span className="hidden sm:inline">{t('voiceLibrary.new_clone')}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runRendererTask('Open voice design', () => navigate({ to: '/design' }))}
          >
            <WandSparklesIcon />
            <span className="hidden sm:inline">{t('voiceLibrary.new_design')}</span>
          </Button>
        </div>
      </WorkspaceHeader>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <section className="border-b border-border/50 px-4 py-5 sm:px-6">
            <p className="max-w-2xl text-sm text-muted-foreground">{t('voiceLibrary.subtitle')}</p>

            <div className="mt-4 flex flex-col gap-3">
              <div className="relative max-w-xl">
                <SearchIcon
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('voiceLibrary.search_placeholder')}
                  aria-label={t('voiceLibrary.search_placeholder')}
                  className="h-10 pl-9"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {kindChips.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={kind === chip.value}
                    onClick={() => setKind(chip.value)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                      kind === chip.value
                        ? 'border-primary/50 bg-primary/15 text-foreground'
                        : 'border-border/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    {chip.value === 'favorites' && <StarIcon className="size-3.5" aria-hidden="true" />}
                    {chip.label}
                    {chip.count !== undefined && (
                      <span className="tabular-nums text-muted-foreground">{chip.count}</span>
                    )}
                  </button>
                ))}

                <span className="mx-1 hidden h-5 w-px bg-border/60 sm:block" aria-hidden="true" />

                <NativeSelect
                  label={t('voiceLibrary.category')}
                  value={category}
                  onChange={(value) => setCategory(value as LibraryCategory | 'all')}
                  options={[
                    { value: 'all', label: t('voiceLibrary.all_categories') },
                    ...LIBRARY_CATEGORIES.map((value) => ({
                      value,
                      label: t(`voiceLibrary.category_${value}`),
                    })),
                  ]}
                />
                <NativeSelect
                  label={t('voiceLibrary.client')}
                  value={client}
                  onChange={setClient}
                  options={[
                    { value: 'all', label: t('voiceLibrary.all_clients') },
                    ...clients.map((value) => ({ value, label: value })),
                  ]}
                />
                <NativeSelect
                  label={t('voiceLibrary.sort')}
                  value={sort}
                  onChange={(value) => setSort(value as SortMode)}
                  options={[
                    { value: 'recent', label: t('voiceLibrary.sort_recent') },
                    { value: 'name', label: t('voiceLibrary.sort_name') },
                    { value: 'favorites', label: t('voiceLibrary.sort_favorites') },
                  ]}
                />
                {filtersActive && (
                  <Button size="sm" variant="ghost" onClick={clearFilters}>
                    <XIcon />
                    {t('voiceLibrary.clear_filters')}
                  </Button>
                )}
              </div>

              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <TagIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {allTags.slice(0, 24).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={tag === value}
                      onClick={() => setTag(tag === value ? null : value)}
                      className={cn(
                        'h-6 rounded-md px-2 text-xs transition-colors',
                        tag === value
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/70 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      #{value}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="px-4 py-5 sm:px-6">
            {profiles.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('preferences.loading')}
              </p>
            ) : profiles.isError ? (
              <div role="alert" className="text-sm">
                <p>{profiles.error.message}</p>
                <Button variant="ghost" onClick={() => void profiles.refetch()}>
                  {t('backend.retry')}
                </Button>
              </div>
            ) : allProfiles.length === 0 ? (
              <EmptyLibrary
                onClone={() => runRendererTask('Open voice cloning', () => navigate({ to: '/clone' }))}
                onDesign={() => runRendererTask('Open voice design', () => navigate({ to: '/design' }))}
              />
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                <p>{t('voiceLibrary.no_results')}</p>
                <Button className="mt-3" size="sm" variant="ghost" onClick={clearFilters}>
                  {t('voiceLibrary.clear_filters')}
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground tabular-nums">
                  {t('voiceLibrary.count', { count: items.length })}
                </p>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {items.map((profile) => {
                    const meta = metaFor(profile.id);
                    const design = profile.kind === 'design';
                    const canPreview =
                      Boolean(profile.ref_audio_path || profile.locked_audio_path) || design;
                    return (
                      <li
                        key={profile.id}
                        className={cn(
                          'group flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-4 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-[0_8px_24px_-16px_var(--primary)]',
                          editingProfileId === profile.id && 'border-primary/60',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <ProfileAvatar
                            name={profile.name}
                            imageUrl={profile.image_url}
                            className="size-11 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold" title={profile.name}>
                              {profile.name}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                {design ? (
                                  <WandSparklesIcon className="size-3" aria-hidden="true" />
                                ) : (
                                  <FingerprintIcon className="size-3" aria-hidden="true" />
                                )}
                                {t(design ? 'voiceLibrary.kind_design' : 'voiceLibrary.kind_clone')}
                              </span>
                              {profile.language && <span>{profile.language}</span>}
                              <span>{formatRelative(profile.created_at, i18n.language)}</span>
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-pressed={meta.favorite}
                            aria-label={t(
                              meta.favorite ? 'voiceLibrary.unfavorite' : 'voiceLibrary.favorite',
                            )}
                            title={t(
                              meta.favorite ? 'voiceLibrary.unfavorite' : 'voiceLibrary.favorite',
                            )}
                            onClick={() => toggleFavorite(profile)}
                            className={cn(
                              meta.favorite ? 'text-amber-400' : 'text-muted-foreground',
                            )}
                          >
                            <StarIcon className={cn(meta.favorite && 'fill-current')} />
                          </Button>
                        </div>

                        {(meta.category || meta.client || meta.tags.length > 0) && (
                          <div className="flex flex-wrap gap-1.5">
                            {meta.category && (
                              <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-foreground">
                                {t(`voiceLibrary.category_${meta.category}`)}
                              </span>
                            )}
                            {meta.client && (
                              <button
                                type="button"
                                onClick={() => setClient(meta.client)}
                                className="rounded-md border border-amber-400/40 px-2 py-0.5 text-xs text-amber-500 hover:bg-amber-400/10 dark:text-amber-300"
                              >
                                {meta.client}
                              </button>
                            )}
                            {meta.tags.slice(0, 4).map((value) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setTag(value)}
                                className="rounded-md bg-muted/70 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                              >
                                #{value}
                              </button>
                            ))}
                          </div>
                        )}

                        {(meta.notes || profile.instruct) && (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {meta.notes || profile.instruct}
                          </p>
                        )}

                        <div className="mt-auto flex items-center gap-1 border-t border-border/40 pt-3">
                          {canPreview && (
                            <ProfilePreviewButton
                              profile={profile}
                              ttsBlocker={ttsBlocker}
                              disabledLabel={t('engines.none_ready_title')}
                            />
                          )}
                          <Button size="sm" onClick={() => applyVoice(profile)}>
                            {t('voiceLibrary.use_voice')}
                          </Button>
                          <div className="ml-auto flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('voiceLibrary.organize')}
                              title={t('voiceLibrary.organize')}
                              onClick={() => setOrganizing(profile)}
                            >
                              <SlidersHorizontalIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('paneActions.edit')}
                              title={t('paneActions.edit')}
                              onClick={() => setWorkspace({ editingProfileId: profile.id, panel: null })}
                            >
                              <PencilIcon />
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </div>

        {editing && (
          <WorkspacePane
            layout="editor"
            title={t('paneActions.edit')}
            icon={PencilIcon}
            onClose={() => setWorkspace({ editingProfileId: null })}
          >
            <EditProfile
              key={editing.id}
              profile={editing}
              onDone={() => setWorkspace({ editingProfileId: null })}
            />
          </WorkspacePane>
        )}
      </div>

      <OrganizeDialog
        profile={organizing}
        meta={organizing ? metaFor(organizing.id) : EMPTY_LIBRARY_META}
        clients={clients}
        onClose={() => setOrganizing(null)}
        onSave={(meta) => {
          if (!organizing) return;
          saveMeta.mutate(
            { profileId: organizing.id, meta },
            { onSuccess: () => toast.success(t('voiceLibrary.saved')) },
          );
          setOrganizing(null);
        }}
      />
    </div>
  );
}

function NativeSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        title={label}
        className="h-8 max-w-48 rounded-full border border-border/60 bg-background/60 px-3 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyLibrary({ onClone, onDesign }: { onClone: () => void; onDesign: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-72 max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <LibraryBigIcon className="size-5" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">{t('voiceLibrary.empty_title')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('voiceLibrary.empty_desc')}</p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={onClone}>
          <FingerprintIcon />
          {t('voiceLibrary.new_clone')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDesign}>
          <WandSparklesIcon />
          {t('voiceLibrary.new_design')}
        </Button>
      </div>
    </div>
  );
}

function OrganizeDialog({
  profile,
  meta,
  clients,
  onClose,
  onSave,
}: {
  profile: Profile | null;
  meta: LibraryMeta;
  clients: string[];
  onClose: () => void;
  onSave: (meta: LibraryMeta) => void;
}) {
  return (
    <Dialog open={profile !== null} onOpenChange={(open) => !open && onClose()}>
      {profile && (
        <OrganizeForm
          key={profile.id}
          profile={profile}
          meta={meta}
          clients={clients}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Dialog>
  );
}

function OrganizeForm({
  profile,
  meta,
  clients,
  onClose,
  onSave,
}: {
  profile: Profile;
  meta: LibraryMeta;
  clients: string[];
  onClose: () => void;
  onSave: (meta: LibraryMeta) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<LibraryCategory | ''>(meta.category);
  const [clientName, setClientName] = useState(meta.client);
  const [tags, setTags] = useState(meta.tags.join(', '));
  const [notes, setNotes] = useState(meta.notes);
  const listId = `maia-clients-${profile.id}`;
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t('voiceLibrary.organize_title', { name: profile.name })}</DialogTitle>
        <DialogDescription>{t('voiceLibrary.organize_desc')}</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            category,
            client: clientName.trim(),
            tags: parseTags(tags),
            favorite: meta.favorite,
            notes: notes.trim(),
          });
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">
            {t('voiceLibrary.category')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {LIBRARY_CATEGORIES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(category === value ? '' : value)}
                className={cn(
                  'h-8 rounded-full border px-3 text-xs transition-colors',
                  category === value
                    ? 'border-primary/50 bg-primary/15 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`voiceLibrary.category_${value}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          {t('voiceLibrary.client')}
          <Input
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            placeholder={t('voiceLibrary.client_placeholder')}
            list={listId}
            maxLength={120}
          />
          <datalist id={listId}>
            {clients.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          {t('voiceLibrary.tags')}
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={t('voiceLibrary.tags_placeholder')}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          {t('voiceLibrary.notes')}
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('voiceLibrary.notes_placeholder')}
            maxLength={2000}
            rows={3}
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit">{t('common.save')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
