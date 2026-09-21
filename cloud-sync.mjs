import { mergeStores } from './sync-core.mjs';

const config = window.ROUTINE_SYNC_CONFIG || {};
const library = window.supabase;
export const cloudAvailable = Boolean(config.url && config.publishableKey && library?.createClient);
export const cloud = cloudAvailable
  ? library.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 2 } },
    })
  : null;

let channel = null;
let pushTimer = null;

export async function currentUser() {
  if (!cloud) return null;
  const { data, error } = await cloud.auth.getSession();
  if (error) throw error;
  return data.session?.user || null;
}

export async function signIn(email, password) {
  if (!cloud) throw new Error('Cloud sync is not configured');
  const { data, error } = await cloud.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email, password) {
  if (!cloud) throw new Error('Cloud sync is not configured');
  const { data, error } = await cloud.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.href.split('#')[0].split('?')[0] },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!cloud) return;
  if (channel) {
    await cloud.removeChannel(channel);
    channel = null;
  }
  const { error } = await cloud.auth.signOut();
  if (error) throw error;
}

export async function pullAndMerge(localStore, userId) {
  if (!cloud || !userId) return localStore;
  const { data, error } = await cloud
    .from('routine_state')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return mergeStores(localStore, data?.data || {});
}

export async function pushStore(store, userId) {
  if (!cloud || !userId) return;
  const payload = JSON.parse(JSON.stringify(store));
  const { error } = await cloud.from('routine_state').upsert({
    user_id: userId,
    data: payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export function schedulePush(store, userId, onStatus) {
  if (!cloud || !userId) return;
  clearTimeout(pushTimer);
  onStatus?.('syncing');
  pushTimer = setTimeout(async () => {
    try {
      await pushStore(store, userId);
      onStatus?.('synced');
    } catch (error) {
      console.error('Cloud sync failed', error);
      onStatus?.('error', error);
    }
  }, 450);
}

export async function subscribeToRemote(userId, onRemote, onStatus) {
  if (!cloud || !userId) return;
  if (channel) await cloud.removeChannel(channel);
  channel = cloud.channel(`routine-${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'routine_state', filter: `user_id=eq.${userId}`,
    }, payload => {
      if (payload.new?.data) onRemote(payload.new.data);
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') onStatus?.('synced');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('error');
    });
}
