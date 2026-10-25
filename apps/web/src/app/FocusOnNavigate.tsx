import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * On every route change: scroll to the top, move focus to the page's main landmark and
 * set the document title. The first render leaves focus where the browser put it.
 */
export function FocusOnNavigate({ title }: { title: string }) {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    const main = document.getElementById('main');
    if (main) main.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}
