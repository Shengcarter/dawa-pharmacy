// Applies the saved theme before first paint (kept external for the Content-Security-Policy).
try {
  var t = localStorage.getItem('dawa.theme');
  if (t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
