function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function newest(localValue, remoteValue) {
  if (!localValue) return clone(remoteValue);
  if (!remoteValue) return clone(localValue);
  const localTime = Date.parse(localValue.updatedAt || '') || 0;
  const remoteTime = Date.parse(remoteValue.updatedAt || '') || 0;
  return clone(remoteTime > localTime ? remoteValue : localValue);
}

export function prepareLocalForCloud(store = {}, timestamp = new Date().toISOString()) {
  const prepared = clone(store) || {};
  for (const day of Object.values(prepared.history || {})) {
    for (const task of Object.values(day || {})) {
      const changed = Boolean(task?.completed) || Number(task?.actual || 0) > 0;
      if (changed && !task.updatedAt) task.updatedAt = timestamp;
    }
  }
  return prepared;
}

export function mergeStores(localStore = {}, remoteStore = {}) {
  const localHistory = localStore.history || {};
  const remoteHistory = remoteStore.history || {};
  const history = {};
  const dates = new Set([...Object.keys(localHistory), ...Object.keys(remoteHistory)]);
  for (const date of dates) {
    history[date] = {};
    const localDay = localHistory[date] || {};
    const remoteDay = remoteHistory[date] || {};
    const taskIds = new Set([...Object.keys(localDay), ...Object.keys(remoteDay)]);
    for (const taskId of taskIds) history[date][taskId] = newest(localDay[taskId], remoteDay[taskId]);
  }

  const activityMap = new Map();
  for (const item of [...(localStore.activities || []), ...(remoteStore.activities || [])]) {
    const key = `${item.at || ''}|${item.date || ''}|${item.text || ''}`;
    activityMap.set(key, clone(item));
  }
  const activities = [...activityMap.values()]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 100);

  return {
    ...clone(remoteStore),
    ...clone(localStore),
    history,
    activities,
    theme: localStore.theme || remoteStore.theme || 'light',
  };
}
