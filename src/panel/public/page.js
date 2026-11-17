// Standalone server pages (064): the little behaviour they need, served as a file (no inline script, see page.css).
// Copy buttons: <button data-copy="value">. A form that continues by itself: <form data-autosubmit>.
// <body data-bounce>: reload once from this page so the SameSite=Strict session cookie comes along (admin MCP sign-in).
document.querySelectorAll('button[data-copy]').forEach((b) => {
  b.addEventListener('click', () => {
    const v = b.getAttribute('data-copy');
    const done = () => { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy'; }, 1600); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(v).then(done, () => {});
    else {
      const t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch { /* nothing to copy with */ }
      t.remove();
    }
  });
});
document.querySelector('form[data-autosubmit]')?.submit();
if (document.body.hasAttribute('data-bounce')) location.replace(`${location.href}${location.search ? '&' : '?'}_s=1`);
