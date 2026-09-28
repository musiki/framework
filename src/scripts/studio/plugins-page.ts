// Copy-to-clipboard for the plugin block examples on /studio/plugins.
// Reads text via `.textContent` (never innerHTML) so nothing from a
// plugin manifest is ever parsed as markup.
document.querySelectorAll<HTMLButtonElement>('.so-plugin-copy').forEach((button) => {
  const targetId = button.dataset.copyTarget;
  if (!targetId) return;
  const pre = document.getElementById(targetId);
  if (!pre) return;
  const copiedLabel = button.dataset.copiedLabel || button.textContent || '';
  const defaultLabel = button.textContent || '';
  button.addEventListener('click', async () => {
    const text = pre.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (older browser, insecure context, or
      // permission denied): fall back to a manual selection the user can
      // copy themselves.
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    button.dataset.copied = 'true';
    button.textContent = copiedLabel;
    setTimeout(() => {
      button.dataset.copied = 'false';
      button.textContent = defaultLabel;
    }, 1500);
  });
});
