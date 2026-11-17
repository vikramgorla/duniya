// Pull to refresh (066), touch screens only: pull down at the top of the page and let go to drop the screen's cached
// data, reconnect the live stream and draw the screen again (recover). A small spinner follows the finger; with
// reduce motion it does not spin. Not inside dialogs or inner scroll boxes that are scrolled. Module of the panel.
import { $, S, h, recover } from './core.js';
const PULL = 64; // px of (damped) pull that arms the refresh
let y0 = null; let armed = false; let mark = null;
const reset = () => { y0 = null; armed = false; if (mark) mark.style.transform = ''; mark?.classList.remove('armed'); };
const blocked = (t) => window.scrollY > 0 || $('dialog[open]') || [...document.querySelectorAll('.thread, .ld-list, .tscroll, pre, textarea')].some((b) => b.contains(t) && b.scrollTop > 0);
if (matchMedia('(pointer: coarse)').matches) {
  document.addEventListener('touchstart', (e) => { y0 = S.user && e.touches.length === 1 && !blocked(e.target) ? e.touches[0].clientY : null; }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const d = Math.min((e.touches[0].clientY - y0) * 0.5, PULL + 16);
    if (d <= 4 || window.scrollY > 0) { if (mark) mark.style.transform = ''; armed = false; return; }
    mark ||= document.body.appendChild(h('div', { class: 'ptr', 'aria-hidden': 'true' }, h('span', { class: 'spinner' })));
    armed = d >= PULL;
    mark.classList.toggle('armed', armed);
    mark.style.transform = `translate(-50%, ${d}px) rotate(${d * 4}deg)`;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!armed) return reset();
    mark.classList.add('busy'); mark.style.transform = `translate(-50%, ${PULL}px)`;
    recover(true);
    setTimeout(() => { mark?.classList.remove('busy'); reset(); }, 700);
  }, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
}
