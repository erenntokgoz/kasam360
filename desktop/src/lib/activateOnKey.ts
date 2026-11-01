import type { KeyboardEvent } from 'react';

/** İçinde başka düğme taşıyan tıklanabilir satırlar `button` olamaz; klavyeyle yine açılır. */
export const activateOnKey = (action: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};
