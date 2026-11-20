import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { AdminLayout, PermissionGuard } from '../../../layouts/AdminLayout';
import { AdminPageHeader, ErrorBanner, LoadingCards } from '../../../components/admin/ui';
import { useAdminSettings } from './useAdminSettings';
import { useSeoMeta } from '../../../lib/useSeoMeta';
import {
  DEFAULT_SEARCH_PLACEHOLDER_CONFIG,
  resolveSearchPlaceholderConfig,
  type SearchPlaceholderConfig,
  type SearchPlaceholderPhrase,
} from '../../../lib/searchPlaceholder';

type TimingSettingKey = 'typingSpeed' | 'deletingSpeed' | 'phrasePause' | 'transitionPause';

const TIMING_SETTINGS: Array<{
  key: TimingSettingKey;
  label: string;
  min: number;
  max: number;
}> = [
  { key: 'typingSpeed', label: 'Typing speed (ms)', min: 20, max: 250 },
  { key: 'deletingSpeed', label: 'Deleting speed (ms)', min: 20, max: 250 },
  { key: 'phrasePause', label: 'Phrase pause (ms)', min: 500, max: 10000 },
  { key: 'transitionPause', label: 'Transition pause (ms)', min: 0, max: 3000 },
];

function getAdminPlaceholderConfig(config: SearchPlaceholderConfig | undefined): SearchPlaceholderConfig {
  if (!config) return DEFAULT_SEARCH_PLACEHOLDER_CONFIG;
  return {
    ...resolveSearchPlaceholderConfig(config),
    phrases: config.phrases,
  };
}

export function HeaderSettingsPage() {
  useSeoMeta({ title: 'Header Settings | NOVARA Admin', noIndex: true });
  const { config, loading, saving, error, load, savePatch } = useAdminSettings();

  const [showSearch, setShowSearch] = useState(true);
  const [showWishlist, setShowWishlist] = useState(true);
  const [showCategoryMenu, setShowCategoryMenu] = useState(true);
  const [stickyHeader, setStickyHeader] = useState(true);
  const [specialOfferLabel, setSpecialOfferLabel] = useState('Flash Deals');
  const [specialOfferUrl, setSpecialOfferUrl] = useState('/offers');
  const [searchPlaceholder, setSearchPlaceholder] = useState<SearchPlaceholderConfig>(
    () => resolveSearchPlaceholderConfig(undefined),
  );
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const h = config?.headerSettings;
    if (!h) return;
    setShowSearch(Boolean(h.showSearch ?? true));
    setShowWishlist(Boolean(h.showWishlist ?? true));
    setShowCategoryMenu(Boolean(h.showCategoryMenu ?? true));
    setStickyHeader(Boolean(h.stickyHeader ?? true));
    setSpecialOfferLabel(h.specialOfferLabel || 'Flash Deals');
    setSpecialOfferUrl(h.specialOfferUrl || '/offers');
    setSearchPlaceholder(getAdminPlaceholderConfig(h.searchPlaceholder));
  }, [config]);

  const updatePhrase = (index: number, patch: Partial<SearchPlaceholderPhrase>) => {
    setSearchPlaceholder((current) => ({
      ...current,
      phrases: current.phrases.map((phrase, phraseIndex) =>
        phraseIndex === index ? { ...phrase, ...patch } : phrase,
      ),
    }));
    setFormError(null);
  };

  const movePhrase = (index: number, direction: -1 | 1) => {
    setSearchPlaceholder((current) => {
      const next = [...current.phrases];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return {
        ...current,
        phrases: next.map((phrase, displayOrder) => ({ ...phrase, displayOrder })),
      };
    });
  };

  const addPhrase = () => {
    setSearchPlaceholder((current) => {
      if (current.phrases.length >= 20) return current;
      const phrase: SearchPlaceholderPhrase = {
        text: '',
        enabled: true,
        displayOrder: current.phrases.length,
      };
      return { ...current, phrases: [...current.phrases, phrase] };
    });
    setFormError(null);
  };

  const deletePhrase = (index: number) => {
    if (!window.confirm('Delete this search placeholder phrase?')) return;
    setSearchPlaceholder((current) => ({
      ...current,
      phrases: current.phrases
        .filter((_, phraseIndex) => phraseIndex !== index)
        .map((phrase, displayOrder) => ({ ...phrase, displayOrder })),
    }));
    setFormError(null);
  };

  const restoreChanges = () => {
    const h = config?.headerSettings;
    setShowSearch(Boolean(h?.showSearch ?? true));
    setShowWishlist(Boolean(h?.showWishlist ?? true));
    setShowCategoryMenu(Boolean(h?.showCategoryMenu ?? true));
    setStickyHeader(Boolean(h?.stickyHeader ?? true));
    setSpecialOfferLabel(h?.specialOfferLabel || 'Flash Deals');
    setSpecialOfferUrl(h?.specialOfferUrl || '/offers');
    setSearchPlaceholder(getAdminPlaceholderConfig(h?.searchPlaceholder));
    setFormError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      searchPlaceholder.phrases.some((phrase) => !phrase.text.trim())
    ) {
      setFormError('Every phrase must contain text before saving.');
      return;
    }

    const saved = await savePatch(
      {
        headerSettings: {
          showSearch,
          showWishlist,
          showCategoryMenu,
          stickyHeader,
          specialOfferLabel,
          specialOfferUrl,
          searchPlaceholder,
        },
      },
      'Header settings saved.',
    );
    if (saved) window.dispatchEvent(new CustomEvent('novara:navigation-updated'));
  };

  return (
    <AdminLayout>
      <PermissionGuard permission="cms.manage">
        <div className="space-y-5 max-w-[920px] mx-auto">
          <AdminPageHeader
            title="Header Settings"
            subtitle="Manage storefront header options and the animated search placeholder."
            breadcrumbs={[{ label: 'Website Management' }, { label: 'Header Settings' }]}
          />

          {error && <ErrorBanner message={error} onRetry={load} />}
          {loading ? (
            <LoadingCards count={2} />
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-6 shadow-xs space-y-5"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: 'Show Live Search Bar', val: showSearch, set: setShowSearch },
                  { label: 'Show Wishlist Heart Button', val: showWishlist, set: setShowWishlist },
                  { label: 'Show Category Browse Dropdown', val: showCategoryMenu, set: setShowCategoryMenu },
                  { label: 'Sticky Header on Scroll', val: stickyHeader, set: setStickyHeader },
                ].map((opt) => (
                  <label
                    key={opt.label}
                    className="flex items-center justify-between rounded-xl border border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/50 p-3.5 text-xs font-semibold cursor-pointer"
                  >
                    <span>{opt.label}</span>
                    <input
                      type="checkbox"
                      checked={opt.val}
                      onChange={(e) => opt.set(e.target.checked)}
                      className="h-4 w-4 rounded text-[#145CFF]"
                    />
                  </label>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-[#E4EAF5] dark:border-slate-800">
                <div>
                  <label className="mb-1 block text-xs font-semibold">Highlighted Promo Link Label</label>
                  <input
                    value={specialOfferLabel}
                    onChange={(e) => setSpecialOfferLabel(e.target.value)}
                    className="w-full h-10 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Highlighted Promo URL</label>
                  <input
                    value={specialOfferUrl}
                    onChange={(e) => setSpecialOfferUrl(e.target.value)}
                    className="w-full h-10 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 font-mono-tabular text-xs"
                  />
                </div>
              </div>

              <section className="space-y-4 border-t border-[#E4EAF5] pt-5 dark:border-slate-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold">Search Placeholder Animation</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Manage up to 20 Bengali or English phrases shown in the storefront search box.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={searchPlaceholder.animationEnabled}
                      onChange={(e) =>
                        setSearchPlaceholder((current) => ({ ...current, animationEnabled: e.target.checked }))
                      }
                      className="h-4 w-4 rounded text-[#145CFF]"
                    />
                    Enable typing animation
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {TIMING_SETTINGS.map((setting) => (
                    <div key={setting.key}>
                      <label htmlFor={`search-${setting.key}`} className="mb-1 block text-xs font-semibold">
                        {setting.label}
                      </label>
                      <input
                        id={`search-${setting.key}`}
                        type="number"
                        min={setting.min}
                        max={setting.max}
                        step={1}
                        required
                        value={searchPlaceholder[setting.key]}
                        onChange={(e) =>
                          setSearchPlaceholder((current) => ({
                            ...current,
                            [setting.key]: Number(e.target.value),
                          }))
                        }
                        className="h-10 w-full rounded-xl border border-[#E4EAF5] bg-[#F4F7FF] px-3 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  {searchPlaceholder.phrases.map((phrase, index) => (
                    <div
                      key={`${phrase.displayOrder}-${index}`}
                      className="rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-3 dark:border-slate-800 dark:bg-slate-900/50"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold">Phrase {index + 1}</span>
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={phrase.enabled}
                              onChange={(e) => updatePhrase(index, { enabled: e.target.checked })}
                              className="h-4 w-4 rounded text-[#145CFF]"
                            />
                            Enabled
                          </label>
                          <button
                            type="button"
                            aria-label={`Move phrase ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => movePhrase(index, -1)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-white disabled:opacity-30 dark:border-slate-700"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move phrase ${index + 1} down`}
                            disabled={index === searchPlaceholder.phrases.length - 1}
                            onClick={() => movePhrase(index, 1)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-white disabled:opacity-30 dark:border-slate-700"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete phrase ${index + 1}`}
                            onClick={() => deletePhrase(index)}
                            className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 dark:border-rose-900"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        required
                        maxLength={140}
                        rows={2}
                        value={phrase.text}
                        onChange={(e) => updatePhrase(index, { text: e.target.value })}
                        aria-label={`Search placeholder phrase ${index + 1}`}
                        className="w-full resize-y rounded-xl border border-[#E4EAF5] bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                      <div className="mt-1 flex items-start justify-between gap-2 text-[11px] text-slate-500">
                        <span dir="auto" className="min-w-0 flex-1 truncate">
                          Preview: {phrase.text || 'Your placeholder preview appears here'}
                        </span>
                        <span className="shrink-0">{phrase.text.length}/140</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={addPhrase}
                    disabled={searchPlaceholder.phrases.length >= 20}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#145CFF]/30 px-4 py-2 text-xs font-semibold text-[#145CFF] hover:bg-[#E9F0FD] disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                    Add phrase
                  </button>
                  <span className="text-xs text-slate-500">
                    {searchPlaceholder.phrases.filter((phrase) => phrase.enabled).length} enabled
                  </span>
                </div>
              </section>

              {formError && (
                <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={restoreChanges}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel changes
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#145CFF] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#0E47D9] disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Header Settings'}
                </button>
              </div>
            </form>
          )}
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
