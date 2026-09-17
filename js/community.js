// ===== みんなの作品(Supabase共有ギャラリー) =====
const Community = (() => {
  const SUPABASE_URL = 'https://kifnzvktwbomxthzvvgy.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZm56dmt0d2JvbXh0aHp2dmd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MzgxMzgsImV4cCI6MjA5MzQxNDEzOH0.M7nXP-u--6J_6rRpgz1cJj21_7KX6MtfTmZy77Xf_IE';
  const TABLE = 'utbe_patterns';
  const AUTHOR_KEY = 'utbe_author_name';
  const MAX_JSON_BYTES = 1900000; // DB側の上限(2,000,000バイト)より少し余裕を持たせる

  let client = null;
  function getClient() {
    if (!client && window.supabase) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  function getAuthorName() {
    try { return localStorage.getItem(AUTHOR_KEY) || ''; } catch (e) { return ''; }
  }
  function setAuthorName(name) {
    try { localStorage.setItem(AUTHOR_KEY, name); } catch (e) { /* noop */ }
  }

  async function fetchLatest(limit) {
    const c = getClient();
    if (!c) throw new Error('supabase not loaded');
    const { data, error } = await c
      .from(TABLE)
      .select('id,name,author,pattern,created_at')
      .order('created_at', { ascending: false })
      .limit(limit || 60);
    if (error) throw error;
    return data;
  }

  async function publish(pattern, author) {
    const c = getClient();
    if (!c) throw new Error('supabase not loaded');
    const json = JSON.stringify(pattern);
    if (new Blob([json]).size > MAX_JSON_BYTES) {
      throw new Error('too_large');
    }
    const row = {
      name: (pattern.name || '無題の攻撃').slice(0, 40),
      author: (author || '').slice(0, 20) || null,
      pattern: pattern,
    };
    const { data, error } = await c.from(TABLE).insert(row).select().single();
    if (error) throw error;
    return data;
  }

  return { getAuthorName, setAuthorName, fetchLatest, publish };
})();
