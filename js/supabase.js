(() => {
  const config = window.WEDDING_CONFIG;
  if (!config || !window.supabase) {
    console.error('Supabase configuration or library is missing.');
    return;
  }
  window.db = window.supabase.createClient(window.WEDDING_CONFIG.supabaseUrl, window.WEDDING_CONFIG.supabaseAnonKey);
})();
