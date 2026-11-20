import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Gift,
  Headphones,
  Home,
  Laptop,
  Package,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Watch,
} from 'lucide-react';
import type {
  BannerRecord,
  BrandItem,
  CategoryItem,
  HomepageConfigData,
  HomepageLayoutSection,
  ProductItem,
  PromotionalAdData,
} from '../../types/commerce';
import { ProductCard } from '../catalog/ProductCard';
import { ProductCardSkeletonGrid } from '../catalog/ProductCardSkeleton';
import { LoadingRegion, SkeletonBlock } from '../ui/Skeletons';
import { ResilientImage } from '../ui/ResilientImage';
import { DynamicBannerGroup } from '../banners/DynamicBannerRenderer';
import { getBannerGridColSpanClass, getCustomColSpanValue } from '../../lib/bannerBuilder';
import { UserAvatar } from '../ui/UserAvatar';

const ICON_MAP: Record<string, typeof Smartphone> = {
  Smartphone,
  Laptop,
  Headphones,
  Watch,
  Camera,
  Gamepad2,
  Home,
  Shirt,
  ShoppingBag,
  BookOpen,
  Sparkles,
};

export interface HomepageRenderContext {
  config: HomepageConfigData | null;
  slides: HomepageConfigData['heroSlides'];
  activeSlide: number;
  setActiveSlide: (idx: number) => void;
  promoCards: HomepageConfigData['promoBentoCards'];
  categories: Array<Pick<CategoryItem, 'id' | 'name' | 'slug' | 'iconName' | 'imageUrl'>>;
  brands: BrandItem[];
  banners: BannerRecord[];
  bannersByPlacement: Record<string, BannerRecord[]>;
  featuredProducts: ProductItem[];
  latestProducts: ProductItem[];
  bestSellers: ProductItem[];
  trendingProducts: ProductItem[];
  newArrivals: ProductItem[];
  premiumCollection: ProductItem[];
  sectionProducts: Record<string, ProductItem[]>;
  testimonials: Array<{
    id: string;
    userName: string;
    rating: number;
    title: string;
    comment: string;
    isVerifiedPurchase: boolean;
    createdAt?: string;
    customer?: {
      name?: string;
      avatarUrl?: string;
      avatarSources?: { google?: string; facebook?: string; uploaded?: string };
    } | null;
  }>;
  promotionalAd: PromotionalAdData | null;
  promotionalAds: PromotionalAdData[];
  collectionFilter: 'all' | 'electronics' | 'fashion' | 'home' | 'books';
  setCollectionFilter: (val: 'all' | 'electronics' | 'fashion' | 'home' | 'books') => void;
  categoryStripRef: React.Ref<HTMLDivElement>;
  scrollCategories: (dir: -1 | 1) => void;
  canScrollCategoriesPrevious?: boolean;
  canScrollCategoriesNext?: boolean;
  onTrackAdClick: (adId?: string) => void;
  loading?: boolean;
  previewMode?: boolean;
}

function getSectionProductsList(section: HomepageLayoutSection, ctx: HomepageRenderContext): ProductItem[] {
  const custom = ctx.sectionProducts[section.sectionId];
  if (Array.isArray(custom) && custom.length > 0) {
    return custom.slice(0, section.sourceReferences?.productCount || 8);
  }
  const mode = section.sourceReferences?.productSourceMode;
  const count = section.sourceReferences?.productCount || 8;
  switch (mode) {
    case 'bestsellers':
      return ctx.bestSellers.slice(0, count);
    case 'latest':
      return ctx.latestProducts.slice(0, count);
    case 'new_arrivals':
      return ctx.newArrivals.slice(0, count);
    case 'trending':
      return ctx.trendingProducts.slice(0, count);
    case 'featured':
    default:
      if (section.sectionType === 'best_sellers') return ctx.bestSellers.slice(0, count);
      if (section.sectionType === 'latest_products') return ctx.latestProducts.slice(0, count);
      if (section.sectionType === 'new_arrivals') return ctx.newArrivals.slice(0, count);
      if (section.sectionType === 'trending_products') return ctx.trendingProducts.slice(0, count);
      if (section.sectionType === 'product_collection') return ctx.premiumCollection.slice(0, count);
      return ctx.featuredProducts.slice(0, count);
  }
}

const HERO_SLIDE_TRANSITION_MS = 520;

function HomepageHeroCarousel({
  ctx,
}: {
  ctx: Pick<HomepageRenderContext, 'slides' | 'activeSlide' | 'setActiveSlide'>;
}) {
  const totalSlides = ctx.slides.length;
  const safeCurrentIdx =
    totalSlides > 0 ? ((ctx.activeSlide % totalSlides) + totalSlides) % totalSlides : 0;
  const [exitingIdx, setExitingIdx] = useState<number | null>(null);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [transitionKey, setTransitionKey] = useState(0);
  const exitTimerRef = useRef<number | null>(null);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearExitTimer(), [clearExitTimer]);

  const goToIndex = useCallback(
    (requestedIdx: number, dir: 'next' | 'prev') => {
      if (totalSlides <= 1) return;
      const nextIdx = ((requestedIdx % totalSlides) + totalSlides) % totalSlides;
      if (nextIdx === safeCurrentIdx) return;

      clearExitTimer();
      setExitingIdx(safeCurrentIdx);
      setDirection(dir);
      ctx.setActiveSlide(nextIdx);
      setTransitionKey((key) => key + 1);
      exitTimerRef.current = window.setTimeout(() => {
        setExitingIdx(null);
        exitTimerRef.current = null;
      }, HERO_SLIDE_TRANSITION_MS);
    },
    [clearExitTimer, ctx.setActiveSlide, safeCurrentIdx, totalSlides],
  );

  const handlePrevious = useCallback(
    () => goToIndex(safeCurrentIdx - 1, 'prev'),
    [goToIndex, safeCurrentIdx],
  );
  const handleNext = useCallback(
    () => goToIndex(safeCurrentIdx + 1, 'next'),
    [goToIndex, safeCurrentIdx],
  );

  if (totalSlides === 0) return null;

  const currentSlide = ctx.slides[safeCurrentIdx];
  const exitingSlide = exitingIdx !== null && exitingIdx !== safeCurrentIdx ? ctx.slides[exitingIdx] : null;

  const renderSlide = (slide: HomepageRenderContext['slides'][number]) => (
    <div className="grid grid-cols-1 items-center gap-6 px-5 py-8 md:px-8 md:py-10 lg:grid-cols-12">
      <div className="z-10 lg:col-span-5">
        {slide.badgeText && (
          <span className="inline-block rounded-full bg-[#1155EE] px-4 py-1 text-xs font-bold text-white shadow-xs">
            {slide.badgeText}
          </span>
        )}
        <h1 className="font-display mt-4 text-balance text-3xl font-extrabold leading-[1.1] tracking-tight text-[#0B1730] sm:text-4xl lg:text-[44px]">
          {slide.headlineLine1}
          {slide.headlineLine2 && <span className="block text-[#1155EE]">{slide.headlineLine2}</span>}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[#334155] sm:text-base">{slide.subtitle}</p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            to={slide.ctaUrl || '/shop'}
            className="inline-flex items-center gap-2 rounded-full bg-[#1155EE] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0B44CC]"
          >
            <span>{slide.ctaLabel || 'Shop Now'}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="lg:col-span-7">
        <div className="relative mx-auto aspect-[16/9] max-h-[340px] w-full overflow-hidden rounded-2xl shadow-sm">
          <ResilientImage
            src={slide.imageUrl}
            alt={`${slide.headlineLine1} ${slide.headlineLine2}`}
            loading="eager"
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div
      data-testid="homepage-hero-slider"
      data-active-index={safeCurrentIdx}
      data-slide-count={totalSlides}
      data-direction={direction}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured promotions"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#E4EEFD] via-[#EEF4FD] to-[#D7E4F8]"
    >
      <div className="relative">
        {exitingSlide ? (
          <>
            <div aria-hidden="true" className="invisible pointer-events-none">
              {renderSlide(currentSlide)}
            </div>
            <div
              key={`exit-${exitingIdx}-${transitionKey}`}
              aria-hidden="true"
              style={{ animationDuration: `${HERO_SLIDE_TRANSITION_MS}ms` }}
              className={`absolute inset-0 z-0 ${
                direction === 'next' ? 'novara-slide-exit-next' : 'novara-slide-exit-prev'
              }`}
            >
              {renderSlide(exitingSlide)}
            </div>
            <div
              key={`active-${safeCurrentIdx}-${transitionKey}`}
              style={{ animationDuration: `${HERO_SLIDE_TRANSITION_MS}ms` }}
              className={`absolute inset-0 z-10 ${
                direction === 'next' ? 'novara-slide-enter-next' : 'novara-slide-enter-prev'
              }`}
            >
              {renderSlide(currentSlide)}
            </div>
          </>
        ) : (
          renderSlide(currentSlide)
        )}
      </div>

      {totalSlides > 1 && (
        <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-1">
          <button
            type="button"
            onClick={handlePrevious}
            aria-label="Previous slide"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/90 text-[#0B1730] shadow-sm backdrop-blur-xs transition-all hover:border-[#1155EE] hover:bg-[#1155EE] hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1155EE] focus-visible:ring-offset-2"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            {ctx.slides.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => goToIndex(idx, idx >= safeCurrentIdx ? 'next' : 'prev')}
                aria-label={`View slide ${idx + 1}`}
                aria-current={safeCurrentIdx === idx ? 'true' : undefined}
                className={`h-2 rounded-full transition-all ${
                  safeCurrentIdx === idx ? 'w-6 bg-[#1155EE]' : 'w-2 bg-slate-400/50 hover:bg-slate-500'
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleNext}
            aria-label="Next slide"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/90 text-[#0B1730] shadow-sm backdrop-blur-xs transition-all hover:border-[#1155EE] hover:bg-[#1155EE] hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1155EE] focus-visible:ring-offset-2"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

export const HomepageSectionRenderer: React.FC<{
  section: HomepageLayoutSection;
  ctx: HomepageRenderContext;
}> = ({ section, ctx }) => {
  if (!section || section.enabled === false) return null;

  const vis = section.visibilitySettings || { desktop: true, tablet: true, mobile: true };
  const visClasses = [
    vis.mobile !== false ? 'block' : 'hidden',
    vis.tablet !== false ? 'md:block' : 'md:hidden',
    vis.desktop !== false ? 'lg:block' : 'lg:hidden',
  ].join(' ');

  const wrapperStyle: React.CSSProperties = {
    paddingTop: section.layoutSettings?.paddingY ? `${section.layoutSettings.paddingY}px` : undefined,
    paddingBottom: section.layoutSettings?.paddingY ? `${section.layoutSettings.paddingY}px` : undefined,
    backgroundColor: section.layoutSettings?.backgroundColor || undefined,
    backgroundImage: section.layoutSettings?.backgroundGradient || undefined,
    borderRadius:
      section.layoutSettings?.backgroundColor || section.layoutSettings?.backgroundGradient
        ? '16px'
        : undefined,
  };

  const renderSectionHeading = (title: string, subtitle?: string, ctaLabel?: string, ctaUrl?: string) => (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-1 rounded-full bg-[#1155EE]" aria-hidden="true" />
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B1730] sm:text-xl">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {ctaLabel && ctaUrl && (
        <Link
          to={ctaUrl}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1155EE] hover:underline"
        >
          <span>{ctaLabel}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );

  const renderBody = () => {
    switch (section.sectionType) {
      case 'hero_slider': {
        if (ctx.loading) {
          return (
            <LoadingRegion label="Loading homepage hero">
              <div className="grid min-h-[320px] grid-cols-1 items-center gap-6 rounded-2xl bg-gradient-to-r from-[#EEF4FD] to-[#E4EEFD] px-5 py-8 md:px-8 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-5">
                  <SkeletonBlock className="h-7 w-28 rounded-full" />
                  <SkeletonBlock className="h-11 w-11/12" />
                  <SkeletonBlock className="h-11 w-3/4" />
                  <SkeletonBlock className="h-5 w-full" />
                  <SkeletonBlock className="h-10 w-32 rounded-full" />
                </div>
                <SkeletonBlock className="aspect-[16/9] w-full rounded-2xl lg:col-span-7" />
              </div>
            </LoadingRegion>
          );
        }
        return <HomepageHeroCarousel ctx={ctx} />;
      }

      case 'featured_categories': {
        if (ctx.loading) {
          return (
            <LoadingRegion label="Loading categories">
              <div className="grid grid-cols-5 gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 sm:grid-cols-8">
                {Array.from({ length: 10 }).map((_, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-2">
                    <SkeletonBlock className="h-14 w-14 rounded-2xl" />
                    <SkeletonBlock className="h-3 w-16" />
                  </div>
                ))}
              </div>
            </LoadingRegion>
          );
        }
        if (ctx.categories.length === 0) return null;
        return (
          <section aria-label={section.title || 'Product categories'} className="relative rounded-2xl border border-slate-200/80 bg-white px-10 py-4 shadow-xs">
            <button
              type="button"
              onClick={() => ctx.scrollCategories(-1)}
              aria-label="Scroll categories left"
              disabled={ctx.canScrollCategoriesPrevious === false}
              className="absolute left-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-xs transition-all hover:border-[#1155EE] hover:bg-[#F4F8FF] hover:text-[#1155EE] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1155EE] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div
              ref={ctx.categoryStripRef}
              aria-label="Featured categories"
              className="horizontal-scroll-container flex items-stretch gap-3 py-1"
            >
              {ctx.categories.slice(0, 12).map((cat) => {
                const IconComp = (cat.iconName && ICON_MAP[cat.iconName]) || Package;
                return (
                  <Link
                    key={cat.id}
                    to={`/category/${cat.slug}`}
                    className="flex min-h-[112px] min-w-[118px] flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-transparent px-2 py-2.5 text-center transition-colors hover:border-blue-100 hover:bg-[#F4F8FF] sm:min-w-[126px]"
                  >
                    <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-[#E4ECFB] bg-[#EEF4FF] text-[#1155EE] sm:h-16 sm:w-16">
                      <ResilientImage
                        src={cat.imageUrl}
                        alt={cat.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        fallbackClassName="flex h-full w-full items-center justify-center bg-[#EEF4FF] text-[#1155EE]"
                        fallback={<IconComp className="h-6 w-6" />}
                      />
                    </span>
                    <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-[#0F1D3A]">
                      {cat.name}
                    </span>
                  </Link>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => ctx.scrollCategories(1)}
              aria-label="Scroll categories right"
              disabled={ctx.canScrollCategoriesNext === false}
              className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-xs transition-all hover:border-[#1155EE] hover:bg-[#F4F8FF] hover:text-[#1155EE] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1155EE] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </section>
        );
      }

      case 'promo_bento': {
        if (ctx.loading) {
          return (
            <LoadingRegion label="Loading promotions">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <SkeletonBlock key={idx} className="h-[168px] rounded-2xl" />
                ))}
              </div>
            </LoadingRegion>
          );
        }
        const heroBentoDynamic = ctx.banners.filter((b) => b.placement === 'hero_bento');
        if (heroBentoDynamic.length > 0 && heroBentoDynamic.some((b) => b.backgroundType && b.typographySettings)) {
          return <DynamicBannerGroup banners={heroBentoDynamic} />;
        }
        if (ctx.promoCards.length === 0) return null;
        return (
          <section aria-label={section.title || 'Promotional highlights'} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {ctx.promoCards.map((card, idx) => {
              const isIce = card.theme === 'ice-blue';
              const bgClass =
                card.theme === 'royal-blue'
                  ? 'bg-gradient-to-br from-[#0A1F5C] via-[#1144C8] to-[#1155EE] text-white'
                  : card.theme === 'midnight-navy'
                    ? 'bg-gradient-to-br from-[#071024] via-[#0F1D3A] to-[#172B52] text-white'
                    : 'bg-gradient-to-br from-[#DCEBFF] via-[#EAF2FF] to-[#F4F8FF] text-[#0B1730] border border-blue-100';

              return (
                <div
                  key={card.id || idx}
                  className={`relative flex min-h-[168px] items-center justify-between overflow-hidden rounded-2xl p-5 shadow-xs ${bgClass}`}
                >
                  <div className="z-10 max-w-[60%]">
                    <p className={`text-xs font-semibold ${isIce ? 'text-[#1155EE]' : 'text-blue-200'}`}>
                      {card.eyebrow}
                    </p>
                    <h3 className="font-display mt-1 text-xl font-extrabold leading-tight">{card.title}</h3>
                    <p className={`mt-1 text-xs ${isIce ? 'text-slate-600' : 'text-slate-200'}`}>{card.subtitle}</p>
                    <Link
                      to={card.ctaUrl || '/shop'}
                      className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                        isIce ? 'bg-[#1155EE] text-white hover:bg-[#0B44CC]' : 'bg-white text-[#0B1730] hover:bg-blue-50'
                      }`}
                    >
                      <span>{card.ctaLabel || 'Shop Now'}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <div className="h-32 w-32 shrink-0 overflow-hidden rounded-xl">
                    <ResilientImage src={card.imageUrl} alt={card.title} className="h-full w-full object-cover" />
                  </div>
                </div>
              );
            })}
          </section>
        );
      }

      case 'dynamic_banner': {
        const ids = section.sourceReferences?.bannerIds || [];
        const placement = section.sourceReferences?.bannerPlacement;
        const matched =
          ids.length > 0
            ? ctx.banners.filter((b) => ids.includes(b.id))
            : placement
              ? ctx.bannersByPlacement[placement] || ctx.banners.filter((b) => b.placement === placement)
              : [];
        if (matched.length === 0) return null;
        return (
          <section aria-label={section.title || 'Promotional banner'}>
            <DynamicBannerGroup banners={matched} />
          </section>
        );
      }

      case 'best_sellers':
      case 'featured_products':
      case 'new_arrivals':
      case 'latest_products':
      case 'trending_products': {
        const items = getSectionProductsList(section, ctx);
        if (!ctx.loading && items.length === 0) return null;
        const ctaUrl =
          section.contentSettings?.ctaUrl ||
          (section.sectionType === 'best_sellers'
            ? '/shop?sort=popular'
            : section.sectionType === 'new_arrivals'
              ? '/shop?sort=newest'
              : section.sectionType === 'trending_products'
                ? '/shop?sort=trending'
                : '/shop');
        const ctaLabel = section.contentSettings?.ctaLabel || 'View All';

        return (
          <section aria-label={section.title}>
            {renderSectionHeading(section.title, section.subtitle, ctaLabel, ctaUrl)}
            {ctx.loading ? (
              <LoadingRegion label={`Loading ${section.title || 'products'}`}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  <ProductCardSkeletonGrid count={8} />
                </div>
              </LoadingRegion>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                {items.map((prod) => (
                  <ProductCard key={prod.id} product={prod} />
                ))}
              </div>
            )}
          </section>
        );
      }

      case 'product_collection': {
        const baseItems = ctx.sectionProducts[section.sectionId]?.length
          ? ctx.sectionProducts[section.sectionId]
          : ctx.premiumCollection;
        const filtered = baseItems.filter((item) => {
          if (ctx.collectionFilter === 'all') return true;
          const catObj = typeof item.categoryId === 'object' ? item.categoryId : null;
          const slug = catObj?.slug || '';
          if (ctx.collectionFilter === 'electronics') {
            return (
              item.attributeGroup === 'electronics' ||
              ['mobiles-tablets', 'laptops-computers', 'audio-headphones', 'smart-watches'].includes(slug)
            );
          }
          if (ctx.collectionFilter === 'fashion') {
            return ['fashion-lifestyle', 'bags-wallets', 'shoes-footwear'].includes(slug);
          }
          if (ctx.collectionFilter === 'home') {
            return item.attributeGroup === 'home' || slug === 'home-appliances';
          }
          if (ctx.collectionFilter === 'books') {
            return item.attributeGroup === 'books' || slug === 'books-education';
          }
          return true;
        });

        if (!ctx.loading && baseItems.length === 0) return null;

        return (
          <section aria-label={section.title}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="h-6 w-1 rounded-full bg-[#1155EE]" aria-hidden="true" />
                <div>
                  <h2 className="font-display text-lg font-bold text-[#0B1730] sm:text-xl">{section.title}</h2>
                  {section.subtitle && <p className="text-xs text-slate-500">{section.subtitle}</p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'electronics', label: 'Electronics' },
                    { key: 'fashion', label: 'Fashion' },
                    { key: 'home', label: 'Home & Living' },
                    { key: 'books', label: 'Books' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => ctx.setCollectionFilter(tab.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      ctx.collectionFilter === tab.key
                        ? 'bg-[#1155EE] text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:text-[#0F1D3A]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            {filtered.length === 0 && !ctx.loading ? (
              <div className="rounded-xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
                No products match this collection filter yet.
              </div>
            ) : ctx.loading ? (
              <LoadingRegion label={`Loading ${section.title || 'product collection'}`}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8">
                  <ProductCardSkeletonGrid count={8} />
                </div>
              </LoadingRegion>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8">
                {filtered.map((prod) => (
                  <ProductCard key={prod.id} product={prod} compact showRating={false} />
                ))}
              </div>
            )}
          </section>
        );
      }

      case 'brand_showcase': {
        if (ctx.brands.length === 0) return null;
        return (
          <section aria-label={section.title || 'Featured Brands'}>
            {renderSectionHeading(section.title || 'Top Brands', section.subtitle, 'Explore Shop', '/shop')}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {ctx.brands.slice(0, 7).map((brand) => (
                <Link
                  key={brand.id}
                  to={`/shop?q=${encodeURIComponent(brand.name)}`}
                  className="flex flex-col items-center justify-center rounded-2xl border border-[#E4EAF5] bg-white p-4 text-center shadow-2xs transition-colors hover:border-[#145CFF]"
                >
                  <span className="font-display text-sm font-extrabold text-[#0A1F44]">{brand.name}</span>
                  {brand.description && (
                    <span className="mt-1 line-clamp-1 text-[10.5px] text-slate-500">{brand.description}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        );
      }

      case 'feature_banners': {
        const giftEnabled = ctx.config?.featureBanners?.giftBanner?.enabled !== false;
        const trustEnabled = ctx.config?.featureBanners?.trustBanner?.enabled !== false;
        if (!giftEnabled && !trustEnabled) return null;
        return (
          <section className={`grid grid-cols-1 gap-4 ${giftEnabled && trustEnabled ? 'lg:grid-cols-2' : ''}`}>
            {giftEnabled && (
              <div className="flex min-h-[136px] flex-col items-start justify-between gap-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-[#E6EFFD] to-[#F4F8FF] p-5 sm:flex-row sm:items-center sm:p-6">
                <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
                  <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-[#1155EE] text-white shadow-sm">
                    <Gift className="h-7 w-7 sm:h-8 sm:w-8" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#1155EE]">
                      {ctx.config?.featureBanners?.giftBanner?.title || 'Special Gift'}
                    </p>
                    <h3 className="font-display text-lg sm:text-xl font-extrabold text-[#0B1730]">
                      {ctx.config?.featureBanners?.giftBanner?.subtitle || 'For Our Valued Customers'}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600">
                      {ctx.config?.featureBanners?.giftBanner?.description || 'Get a Free Gift on Orders Over ৳5,000'}
                    </p>
                  </div>
                </div>
                <Link
                  to={ctx.config?.featureBanners?.giftBanner?.ctaUrl || '/shop'}
                  className="shrink-0 rounded-full bg-[#1155EE] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0B44CC]"
                >
                  {ctx.config?.featureBanners?.giftBanner?.ctaLabel || 'Shop Now'} →
                </Link>
              </div>
            )}

            {trustEnabled && (
              <div className="flex min-h-[136px] items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-[#071024] via-[#0F1D3A] to-[#132955] p-5 sm:p-6 text-white">
                <div className="flex min-w-0 items-start sm:items-center gap-3.5 sm:gap-4">
                  <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-[#1155EE]/25 text-[#5895FF] ring-1 ring-[#1155EE]/50">
                    <ShieldCheck className="h-7 w-7 sm:h-8 sm:w-8" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg sm:text-xl font-extrabold">
                      {ctx.config?.featureBanners?.trustBanner?.title || 'Premium Quality Guaranteed'}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-300">
                      {ctx.config?.featureBanners?.trustBanner?.subtitle || 'Shop with Confidence'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] font-medium text-blue-200">
                      {(ctx.config?.featureBanners?.trustBanner?.bullets || ['Easy Returns', 'Secure Payment', 'Trusted Store']).map(
                        (b) => (
                          <span key={b} className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#5895FF]" />
                            {b}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        );
      }

      case 'promotional_ad': {
        const placement = section.sourceReferences?.bannerPlacement || 'homepage_mid';
        const dynamicBanners = ctx.banners.filter((b) => b.placement === placement);
        return (
          <div className="space-y-4">
            {dynamicBanners.length > 0 && <DynamicBannerGroup banners={dynamicBanners} />}
            {ctx.promotionalAd && (
              <section aria-label={ctx.promotionalAd.title}>
                <a
                  href={ctx.promotionalAd.destinationUrl}
                  onClick={() => ctx.onTrackAdClick(ctx.promotionalAd?.id)}
                  className="block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition-opacity hover:opacity-95"
                >
                  <ResilientImage
                    src={ctx.promotionalAd.imageUrl}
                    alt={ctx.promotionalAd.altText}
                    className="max-h-[220px] w-full object-cover"
                  />
                </a>
              </section>
            )}
          </div>
        );
      }

      case 'custom_content': {
        const alignClass =
          section.layoutSettings?.contentAlign === 'center'
            ? 'text-center items-center'
            : section.layoutSettings?.contentAlign === 'right'
              ? 'text-right items-end'
              : 'text-left items-start';

        return (
          <section
            aria-label={section.title}
            className="rounded-2xl border border-[#E4EAF5] bg-white p-6 sm:p-8 shadow-xs"
            style={{
              backgroundColor: section.layoutSettings?.backgroundColor || undefined,
              backgroundImage: section.layoutSettings?.backgroundGradient || undefined,
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              <div className={`flex flex-col gap-3 ${section.contentSettings?.imageUrl ? 'md:col-span-7' : 'md:col-span-12'} ${alignClass}`}>
                {section.contentSettings?.badgeText && (
                  <span className="inline-flex rounded-full bg-[#145CFF] px-3 py-1 text-[11px] font-bold text-white">
                    {section.contentSettings.badgeText}
                  </span>
                )}
                <h2 className="font-display text-2xl font-extrabold text-[#0A1F44]">{section.title}</h2>
                {section.subtitle && <p className="text-sm text-slate-600">{section.subtitle}</p>}
                {section.contentSettings?.bodyText && (
                  <p className="text-xs leading-relaxed text-slate-500 max-w-2xl">
                    {section.contentSettings.bodyText}
                  </p>
                )}
                {section.contentSettings?.ctaLabel && (
                  <Link
                    to={section.contentSettings.ctaUrl || '/shop'}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#145CFF] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0E47D9]"
                  >
                    <span>{section.contentSettings.ctaLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
              {section.contentSettings?.imageUrl && (
                <div className="md:col-span-5 overflow-hidden rounded-2xl">
                  <ResilientImage
                    src={section.contentSettings.imageUrl}
                    alt={section.title}
                    className="h-56 w-full object-cover"
                  />
                </div>
              )}
            </div>
          </section>
        );
      }

      case 'testimonials': {
        if (!ctx.testimonials || ctx.testimonials.length === 0) return null;
        return (
          <section aria-label={section.title || 'Customer reviews'}>
            {renderSectionHeading(section.title || 'What Our Clients Say', section.subtitle, 'Browse Reviewed Items', '/shop')}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {ctx.testimonials.slice(0, 4).map((review) => (
                <article
                  key={review.id}
                  className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar
                        user={{
                          name: review.customer?.name || review.userName,
                          avatarUrl: review.customer?.avatarUrl,
                          avatarSources: review.customer?.avatarSources,
                        }}
                        size="md"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#0B1730]">{review.customer?.name || review.userName}</p>
                        {review.isVerifiedPurchase && (
                          <p className="text-[11px] font-medium text-emerald-700">Verified Buyer</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 text-amber-400">
                      {Array.from({ length: review.rating }).map((_, idx) => (
                        <Star key={idx} className="h-3.5 w-3.5 fill-amber-400" />
                      ))}
                    </div>
                  </div>
                  {review.createdAt && (
                    <p className="mt-2 text-[11px] text-slate-400">{new Date(review.createdAt).toLocaleDateString()}</p>
                  )}
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">&ldquo;{review.comment}&rdquo;</p>
                </article>
              ))}
            </div>
          </section>
        );
      }

      case 'newsletter': {
        return (
          <section className="rounded-2xl border border-[#DCE6F7] bg-gradient-to-r from-[#071B3A] to-[#145CFF] p-6 sm:p-8 text-white shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-extrabold">{section.title || 'Stay Updated with NOVARA'}</h2>
                <p className="mt-1 text-xs text-blue-100">
                  {section.subtitle || 'Subscribe for flash deal alerts, seasonal coupons, and exclusive tech launches.'}
                </p>
              </div>
              <Link
                to="/offers"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-xs font-bold text-[#0A1F44] hover:bg-blue-50 shrink-0"
              >
                <span>Explore Latest Deals</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>
        );
      }

      default:
        // Safe resilient fallback for unknown future section types
        return null;
    }
  };

  const rendered = renderBody();
  if (!rendered) return null;

  const spanClass = getBannerGridColSpanClass(section.widthMode);
  const customStyle: React.CSSProperties =
    section.widthMode === 'custom'
      ? ({
          '--banner-span': getCustomColSpanValue(section.customWidthPercent),
          ...wrapperStyle,
        } as React.CSSProperties)
      : wrapperStyle;

  return (
    <div
      data-section-id={section.sectionId}
      data-section-type={section.sectionType}
      className={`${section.widthMode === 'custom' ? 'banner-custom-col' : spanClass} ${visClasses}`}
      style={customStyle}
    >
      {rendered}
    </div>
  );
};
