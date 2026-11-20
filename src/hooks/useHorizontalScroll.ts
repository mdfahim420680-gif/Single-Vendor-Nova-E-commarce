import { useCallback, useEffect, useRef, useState } from 'react';

export function useHorizontalScroll<T extends HTMLElement>() {
  const containerElementRef = useRef<T | null>(null);
  const [container, setContainer] = useState<T | null>(null);
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const containerRef = useCallback((element: T | null) => {
    containerElementRef.current = element;
    setContainer(element);
  }, []);

  const updateScrollState = useCallback(() => {
    const element = containerElementRef.current;
    if (!element) return;

    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    const nextCanScrollPrevious = element.scrollLeft > 1;
    const nextCanScrollNext = element.scrollLeft < maxScroll - 1;

    setCanScrollPrevious((current) =>
      current === nextCanScrollPrevious ? current : nextCanScrollPrevious,
    );
    setCanScrollNext((current) => (current === nextCanScrollNext ? current : nextCanScrollNext));
  }, []);

  useEffect(() => {
    if (!container) return;

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState);
    const observeSizeChanges = () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver.observe(container);
        Array.from(container.children).forEach((child) => resizeObserver.observe(child));
      }
      updateScrollState();
    };
    const mutationObserver = new MutationObserver(observeSizeChanges);

    container.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    resizeObserver?.observe(container);
    Array.from(container.children).forEach((child) => resizeObserver?.observe(child));
    mutationObserver.observe(container, { childList: true, subtree: true, characterData: true });
    updateScrollState();

    return () => {
      container.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [container, updateScrollState]);

  const scrollByItem = useCallback((direction: -1 | 1) => {
    const element = containerElementRef.current;
    if (!element) return;

    const viewportLeft = element.getBoundingClientRect().left + element.clientLeft;
    const firstVisibleItem = Array.from(element.children).find(
      (child) => child.getBoundingClientRect().right > viewportLeft + 1,
    );
    const itemWidth = firstVisibleItem?.getBoundingClientRect().width || element.clientWidth;
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const distance = Math.max(1, itemWidth + gap);
    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    const target = Math.max(0, Math.min(maxScroll, element.scrollLeft + direction * distance));

    if (Math.abs(target - element.scrollLeft) > 0.5) {
      element.scrollTo({ left: target, behavior: 'smooth' });
    }
  }, []);

  return {
    containerRef,
    canScrollPrevious,
    canScrollNext,
    scrollByItem,
  };
}
